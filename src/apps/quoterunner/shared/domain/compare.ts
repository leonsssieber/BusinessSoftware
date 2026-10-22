import { round2 } from "./text";

export interface CompareItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
  allowSubstitutes: boolean;
}

export interface CompareBid {
  itemId: string;
  unitPrice: number | null;
  leadDays: number | null;
  substitute: string | null;
}

export interface CompareQuote {
  supplierId: string;
  supplierName: string;
  freight: number;
  lines: CompareBid[];
}

export interface CompareOptions {
  /** Date the materials are needed (YYYY-MM-DD). */
  needBy?: string | null;
  /** Today's date (YYYY-MM-DD), used to judge whether lead times make the need-by date. */
  today: string;
  /** Ignore bids whose lead time misses the need-by date. */
  excludeLate?: boolean;
  /** Accept substitute products on items that allow them. */
  allowSubstitutes?: boolean;
}

export interface Cell {
  unitPrice: number;
  ext: number;
  leadDays: number | null;
  substitute: string | null;
  late: boolean;
  /** Not counted in totals or awards (late with excludeLate, or a disallowed substitute). */
  excluded: boolean;
  best: boolean;
}

export interface Row {
  itemId: string;
  cells: Record<string, Cell | null>;
  bestSupplierId: string | null;
  bidCount: number;
  averageUnit: number | null;
  /** (highest − lowest) / lowest across eligible bids. */
  spread: number | null;
}

export interface SupplierSummary {
  supplierId: string;
  supplierName: string;
  quotedLines: number;
  subtotal: number;
  freight: number;
  total: number;
  complete: boolean;
  maxLeadDays: number | null;
  lateLines: number;
}

export interface Award {
  kind: "single" | "split" | "custom";
  /** itemId → supplierId */
  assignments: Record<string, string>;
  suppliers: string[];
  subtotal: number;
  freight: number;
  total: number;
  missingItemIds: string[];
}

export interface Comparison {
  rows: Row[];
  suppliers: SupplierSummary[];
  bestSingle: Award | null;
  bestSplit: Award | null;
  /** How much the split award saves over the best single supplier (only when both cover the same lines). */
  splitSavings: number | null;
  /**
   * What the best split award saves versus a typical quote: the average total of complete quotes
   * (freight included) when two or more suppliers quoted everything, otherwise the average bid per line.
   */
  savingsVsAverage: number | null;
}

const DAY_MS = 86_400_000;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

interface Eligible {
  supplierIdx: number;
  ext: number;
  unit: number;
}

export function compareQuotes(items: CompareItem[], quotes: CompareQuote[], opts: CompareOptions): Comparison {
  const daysAvailable = opts.needBy ? daysBetween(opts.today, opts.needBy) : null;
  const allowSubs = opts.allowSubstitutes ?? true;

  const rows: Row[] = [];
  /** eligible[itemIndex] = bids that can be awarded */
  const eligible: Eligible[][] = [];

  for (const item of items) {
    const cells: Record<string, Cell | null> = {};
    const elig: Eligible[] = [];
    quotes.forEach((q, qi) => {
      const bid = q.lines.find((l) => l.itemId === item.id);
      if (!bid || bid.unitPrice === null || !Number.isFinite(bid.unitPrice)) {
        cells[q.supplierId] = null;
        return;
      }
      const ext = round2(bid.unitPrice * item.qty);
      const late = daysAvailable !== null && bid.leadDays !== null && bid.leadDays > daysAvailable;
      const subBlocked = Boolean(bid.substitute) && (!item.allowSubstitutes || !allowSubs);
      const excluded = subBlocked || (late && Boolean(opts.excludeLate));
      cells[q.supplierId] = { unitPrice: bid.unitPrice, ext, leadDays: bid.leadDays, substitute: bid.substitute, late, excluded, best: false };
      if (!excluded) elig.push({ supplierIdx: qi, ext, unit: bid.unitPrice });
    });
    let bestSupplierId: string | null = null;
    if (elig.length) {
      const min = Math.min(...elig.map((e) => e.ext));
      for (const e of elig) {
        if (e.ext === min) {
          const sid = quotes[e.supplierIdx].supplierId;
          cells[sid]!.best = true;
          bestSupplierId ??= sid;
        }
      }
    }
    const units = elig.map((e) => e.unit);
    rows.push({
      itemId: item.id,
      cells,
      bestSupplierId,
      bidCount: elig.length,
      averageUnit: units.length ? round2(units.reduce((a, b) => a + b, 0) / units.length) : null,
      spread: units.length >= 2 ? Math.max(...units) / Math.min(...units) - 1 : null,
    });
    eligible.push(elig);
  }

  const suppliers: SupplierSummary[] = quotes.map((q) => {
    let subtotal = 0;
    let quotedLines = 0;
    let lateLines = 0;
    let maxLead: number | null = null;
    rows.forEach((row) => {
      const cell = row.cells[q.supplierId];
      if (cell && !cell.excluded) {
        subtotal += cell.ext;
        quotedLines++;
      }
      if (cell?.late) lateLines++;
      if (cell?.leadDays != null) maxLead = Math.max(maxLead ?? 0, cell.leadDays);
    });
    const freight = quotedLines ? q.freight : 0;
    return {
      supplierId: q.supplierId,
      supplierName: q.supplierName,
      quotedLines,
      subtotal: round2(subtotal),
      freight: round2(freight),
      total: round2(subtotal + freight),
      complete: quotedLines === items.length,
      maxLeadDays: maxLead,
      lateLines,
    };
  });

  const bestSingle = pickBestSingle(items, suppliers, rows);
  const bestSplit = optimizeSplit(items, quotes, eligible);

  let splitSavings: number | null = null;
  if (bestSingle && bestSplit && bestSingle.missingItemIds.length === bestSplit.missingItemIds.length) {
    splitSavings = round2(bestSingle.total - bestSplit.total);
  }

  let savingsVsAverage: number | null = null;
  if (bestSplit) {
    const assigned: Record<string, number> = {};
    for (const item of items) {
      const sid = bestSplit.assignments[item.id];
      const cell = sid ? rows.find((r) => r.itemId === item.id)!.cells[sid] : null;
      if (cell) assigned[item.id] = cell.unitPrice;
    }
    savingsVsAverage = savingsAgainstAverage(items, rows, suppliers, assigned, bestSplit.total);
  }

  return { rows, suppliers, bestSingle, bestSplit, splitSavings, savingsVsAverage };
}

/**
 * Savings of an award (unit price per awarded item, and its total with freight) against the
 * average complete quote, or against the average bid per line when fewer than two quotes are complete.
 */
export function savingsAgainstAverage(
  items: CompareItem[],
  rows: Row[],
  suppliers: SupplierSummary[],
  awardedUnitPrices: Record<string, number>,
  awardedTotal: number,
): number | null {
  const complete = suppliers.filter((s) => s.complete);
  if (complete.length >= 2) {
    const avg = complete.reduce((sum, s) => sum + s.total, 0) / complete.length;
    return round2(avg - awardedTotal);
  }
  let saved = 0;
  let counted = 0;
  items.forEach((item, ii) => {
    const row = rows[ii];
    const unit = awardedUnitPrices[item.id];
    if (unit === undefined || row.bidCount < 2 || row.averageUnit === null) return;
    saved += (row.averageUnit - unit) * item.qty;
    counted++;
  });
  return counted ? round2(saved) : null;
}

function pickBestSingle(items: CompareItem[], suppliers: SupplierSummary[], rows: Row[]): Award | null {
  const candidates = suppliers.filter((s) => s.quotedLines > 0);
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.quotedLines - a.quotedLines || a.total - b.total);
  const best = candidates[0];
  const assignments: Record<string, string> = {};
  const missing: string[] = [];
  items.forEach((item, ii) => {
    const cell = rows[ii].cells[best.supplierId];
    if (cell && !cell.excluded) assignments[item.id] = best.supplierId;
    else missing.push(item.id);
  });
  return {
    kind: "single",
    assignments,
    suppliers: [best.supplierId],
    subtotal: best.subtotal,
    freight: best.freight,
    total: best.total,
    missingItemIds: missing,
  };
}

/**
 * Cheapest way to buy the most lines, counting each supplier's freight once if it wins any line.
 * Exhaustive over supplier subsets for up to 12 suppliers; greedy improvement beyond that.
 */
function optimizeSplit(items: CompareItem[], quotes: CompareQuote[], eligible: Eligible[][]): Award | null {
  const n = quotes.length;
  if (!n || eligible.every((e) => e.length === 0)) return null;

  const evaluate = (allowed: (si: number) => boolean) => {
    const assign: number[] = [];
    let subtotal = 0;
    let covered = 0;
    const used = new Set<number>();
    for (let ii = 0; ii < items.length; ii++) {
      let best: Eligible | null = null;
      for (const e of eligible[ii]) {
        if (allowed(e.supplierIdx) && (!best || e.ext < best.ext)) best = e;
      }
      assign.push(best ? best.supplierIdx : -1);
      if (best) {
        subtotal += best.ext;
        covered++;
        used.add(best.supplierIdx);
      }
    }
    let freight = 0;
    for (const si of used) freight += quotes[si].freight;
    return { assign, subtotal, freight, total: subtotal + freight, covered, used };
  };

  let best = evaluate(() => true);
  if (n <= 12) {
    for (let mask = 1; mask < 1 << n; mask++) {
      const r = evaluate((si) => (mask & (1 << si)) !== 0);
      if (r.covered > best.covered || (r.covered === best.covered && r.total < best.total - 1e-9)) best = r;
    }
  } else {
    let improved = true;
    while (improved) {
      improved = false;
      for (const si of [...best.used]) {
        const without = new Set(best.used);
        without.delete(si);
        const r = evaluate((x) => without.has(x));
        if (r.covered === best.covered && r.total < best.total - 1e-9) {
          best = r;
          improved = true;
          break;
        }
      }
    }
  }

  const assignments: Record<string, string> = {};
  const missing: string[] = [];
  best.assign.forEach((si, ii) => {
    if (si >= 0) assignments[items[ii].id] = quotes[si].supplierId;
    else missing.push(items[ii].id);
  });
  return {
    kind: "split",
    assignments,
    suppliers: [...best.used].map((si) => quotes[si].supplierId),
    subtotal: round2(best.subtotal),
    freight: round2(best.freight),
    total: round2(best.total),
    missingItemIds: missing,
  };
}

/** Totals for a hand-picked award (itemId → supplierId). */
export function evaluateAward(items: CompareItem[], quotes: CompareQuote[], assignments: Record<string, string>): Award {
  let subtotal = 0;
  const used = new Set<string>();
  const missing: string[] = [];
  for (const item of items) {
    const sid = assignments[item.id];
    const bid = sid ? quotes.find((q) => q.supplierId === sid)?.lines.find((l) => l.itemId === item.id) : undefined;
    if (!sid || !bid || bid.unitPrice === null) {
      missing.push(item.id);
      continue;
    }
    subtotal += round2(bid.unitPrice * item.qty);
    used.add(sid);
  }
  const freight = [...used].reduce((sum, sid) => sum + (quotes.find((q) => q.supplierId === sid)?.freight ?? 0), 0);
  return {
    kind: "custom",
    assignments: Object.fromEntries(Object.entries(assignments).filter(([itemId]) => !missing.includes(itemId))),
    suppliers: [...used],
    subtotal: round2(subtotal),
    freight: round2(freight),
    total: round2(subtotal + freight),
    missingItemIds: missing,
  };
}
