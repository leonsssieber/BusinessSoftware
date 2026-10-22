import { parseMoney, round2, similarity } from "./text";

export interface ExtractItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
  partNumber: string | null;
}

export interface ExtractedLine {
  itemId: string;
  unitPrice: number | null;
  leadDays: number | null;
  substitute: string | null;
  note: string | null;
  /** 0–1: how sure the reader is that this line belongs to the item. */
  confidence: number;
}

export interface ExtractedQuote {
  lines: ExtractedLine[];
  freight: number | null;
  tax: number | null;
  validUntil: string | null;
  reference: string | null;
  contactName: string | null;
  notes: string | null;
  method: "ai" | "heuristic";
}

const MONEY = /\$\s?\d[\d,]*(?:\.\d{1,4})?|\b\d[\d,]*\.\d{2,4}\b/g;
const LEAD = /\b(\d{1,3})(?:\s*(?:-|to|–)\s*(\d{1,3}))?\s*(business\s+days?|days?|d|wks?|weeks?)\b/i;
const IN_STOCK = /\b(?:in[-\s]?stock|from stock|on hand|available now|stock item)\b/i;
const NO_BID = /\b(?:no[-\s]?bid|n\/a|not available|unable to (?:quote|supply)|can'?t (?:quote|supply)|discontinued|no quote)\b/i;
const SUBSTITUTE = /\b(?:sub(?:stitute)?|alt(?:ernate)?|equivalent|equal to|in lieu of|instead of|or equal)\b/i;

function leadDaysIn(text: string): number | null {
  if (IN_STOCK.test(text)) return 0;
  const m = LEAD.exec(text);
  if (!m) return null;
  const hi = Number(m[2] ?? m[1]);
  const unit = m[3].toLowerCase();
  if (unit.startsWith("w")) return hi * 7;
  if (unit.startsWith("business")) return Math.ceil((hi * 7) / 5);
  return hi;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseLooseDate(raw: string, today: string): string | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(raw);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const t = Date.parse(`${raw} ${today.slice(0, 4)}`);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

/**
 * Reads a supplier's plain-text quote (an email body or text copied from a PDF) and maps
 * priced lines onto the RFQ items. Built for the common formats; anything it is unsure about
 * gets low confidence so the buyer reviews it before saving.
 */
export function extractQuoteHeuristic(text: string, items: ExtractItem[], today: string): ExtractedQuote {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s*\|\s*/g, "  ").trim())
    .filter(Boolean);

  let freight: number | null = null;
  let tax: number | null = null;
  let validUntil: string | null = null;
  let reference: string | null = null;
  let globalLead: number | null = null;

  interface Candidate {
    lineIdx: number;
    itemIdx: number;
    score: number;
  }
  const candidates: Candidate[] = [];
  const priced: { text: string; prices: number[] }[] = [];

  rawLines.forEach((line, lineIdx) => {
    const prices = (line.match(MONEY) ?? []).map(parseMoney).filter((n): n is number => n !== null);
    priced.push({ text: line, prices });

    if (/\b(freight|shipping|delivery)\b/i.test(line) && !/\blead\b/i.test(line)) {
      if (/\b(free|no charge|included|n\/c|prepaid)\b/i.test(line)) freight = 0;
      else if (prices.length) freight = prices[prices.length - 1];
      return;
    }
    if (/\btax\b/i.test(line) && prices.length && !/\bexcl/i.test(line)) {
      tax = prices[prices.length - 1];
      return;
    }
    if (/\b(sub ?total|grand total|total)\b/i.test(line) && !items.some((it) => similarity(line, it.description) > 0.5)) return;

    const valid = /valid\s+(?:until|thru|through|till)\s+([^.,;]+)/i.exec(line);
    if (valid) validUntil = parseLooseDate(valid[1], today);
    const validFor = /valid\s+for\s+(\d{1,3})\s+days/i.exec(line);
    if (validFor) validUntil = addDays(today, Number(validFor[1]));
    const ref = /\b(?:quote|quotation|ref(?:erence)?)\s*(?:#|no\.?|number)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i.exec(line);
    if (ref && !reference) reference = ref[1];

    if (!prices.length && !NO_BID.test(line)) {
      const lead = leadDaysIn(line);
      if (lead !== null && /\b(all|everything|items?|lead time|ship|delivery)\b/i.test(line)) globalLead = lead;
      return;
    }

    const lower = line.toLowerCase();
    items.forEach((item, itemIdx) => {
      const pn = item.partNumber?.toLowerCase();
      const score = pn && pn.length >= 3 && lower.includes(pn) ? 1 : similarity(line.replace(MONEY, " "), item.description);
      if (score >= 0.3) candidates.push({ lineIdx, itemIdx, score });
    });
  });

  // Each line prices one item and each item takes its best-matching line.
  candidates.sort((a, b) => b.score - a.score);
  const usedLines = new Set<number>();
  const byItem = new Map<number, Candidate>();
  for (const c of candidates) {
    if (usedLines.has(c.lineIdx) || byItem.has(c.itemIdx)) continue;
    usedLines.add(c.lineIdx);
    byItem.set(c.itemIdx, c);
  }

  const lines: ExtractedLine[] = items.map((item, itemIdx) => {
    const c = byItem.get(itemIdx);
    if (!c) return { itemId: item.id, unitPrice: null, leadDays: null, substitute: null, note: null, confidence: 0 };
    const { text: line, prices } = priced[c.lineIdx];
    if (NO_BID.test(line) && !prices.length) {
      return { itemId: item.id, unitPrice: null, leadDays: null, substitute: null, note: "Supplier did not quote this item.", confidence: c.score };
    }
    let unitPrice: number | null = null;
    let note: string | null = null;
    if (prices.length >= 2) {
      const sorted = [...prices].sort((a, b) => a - b);
      const lo = sorted[0];
      const hi = sorted[sorted.length - 1];
      unitPrice = Math.abs(lo * item.qty - hi) <= Math.max(0.02 * hi, 0.05) ? lo : prices[0];
    } else if (prices.length === 1) {
      const p = prices[0];
      const looksExtended = /\b(ext|extended|total|amount)\b/i.test(line) && item.qty > 1;
      unitPrice = looksExtended ? round2(p / item.qty) : p;
      if (looksExtended) note = `Converted from extended price ${p.toFixed(2)}.`;
    }
    const per100 = /\b(?:per|\/)\s*(?:100|c)\b|\bcft\b/i.test(line);
    if (unitPrice !== null && per100 && item.unit === "ft") {
      note = `Priced per 100 ft (${unitPrice.toFixed(2)}).`;
      unitPrice = round2(unitPrice / 100);
    }
    const sub = SUBSTITUTE.test(line) ? line.replace(MONEY, "").replace(/\s{2,}/g, " ").trim() : null;
    return {
      itemId: item.id,
      unitPrice,
      leadDays: leadDaysIn(line) ?? globalLead,
      substitute: sub,
      note,
      confidence: Math.round(c.score * 100) / 100,
    };
  });

  const contact = /(?:^|\n)\s*(?:thanks|thank you|regards|best|sincerely|cheers)[,!.]*\s*\n+\s*([A-Z][a-z]+(?:\s+[A-Z][a-z.]+){0,2})\s*(?:\n|$)/i.exec(text);
  return {
    lines,
    freight,
    tax,
    validUntil,
    reference,
    contactName: contact ? contact[1] : null,
    notes: null,
    method: "heuristic",
  };
}
