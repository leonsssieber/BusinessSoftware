import { canonicalUnit, UNIT_PATTERN } from "./text";

export interface ParsedItem {
  description: string;
  qty: number;
  unit: string;
  partNumber: string | null;
  /** True when the parser had to guess (no quantity found, or an ambiguous one). */
  needsReview: boolean;
}

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const UNIT = `(?:${UNIT_PATTERN})`;

const LEADING = new RegExp(
  String.raw`^\(?(${NUM})\)?` + // quantity, optionally in parentheses
    String.raw`(?![\/"\d]|[x×]\d|\s+[x×]\s*\d|-\d|\.\d)` + // not a size like 3/4, 2x4, 2 x 4, 1-1/2 or 3"
    String.raw`\s*('|${UNIT}(?![a-z0-9]))?\.?` + // optional unit, including 200' for feet
    String.raw`\s*(?:[x×](?=\s)|[-–:@])?\s*` + // optional separator: "12x ", "10 - ", "5: "
    String.raw`(?:of\s+)?(.+)$`,
  "i",
);

const TRAILING_PAREN = new RegExp(String.raw`^(.+?)\s*\((${NUM})\s*(${UNIT})?\.?\)$`, "i");
const TRAILING_SEP = new RegExp(
  String.raw`^(.+?)\s*(?:[-–,:@]|\s[x×]|\bqty\.?|\bquantity|\bqty:)\s*(${NUM})\s*('|${UNIT}(?![a-z0-9]))?\.?$`,
  "i",
);
const TRAILING_UNIT = new RegExp(String.raw`^(.+?)\s+(${NUM})\s*('|${UNIT})\.?$`, "i");

const PART_LABELED =
  /\b(?:part\s*(?:no\.?|#|number)|p\/n|pn|sku|item\s*#|cat(?:alog)?\s*#|mfr\.?\s*#|model\s*#?)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-./]{2,})/i;
const PART_HASH = /(?:^|\s)#([A-Za-z0-9][A-Za-z0-9\-./]{4,})/;

const HEADER = /^(?:qty|quantity|item|items|description|desc|part|unit|uom|material|materials|list)\b[\s\w#./|-]*$/i;

function num(s: string): number {
  return Number(s.replace(/,/g, ""));
}

function cleanLine(raw: string): string {
  return raw
    .replace(/\[\s?[xX]?\s?\]/g, " ")
    .replace(/^\s*(?:[-*•·>]+|\d{1,3}[.)](?=\s))\s*/, "")
    .replace(/[  ]+/g, " ")
    .replace(/[;,]+\s*$/, "")
    .trim();
}

function tidyDescription(s: string): string {
  return s
    .replace(/^(?:of|x|×|-|–|:)\s+/i, "")
    .replace(/\s*[-–,:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unitOf(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw === "'") return "ft";
  return canonicalUnit(raw);
}

function fromCells(cells: string[]): ParsedItem | null {
  const trimmed = cells.map((c) => c.trim()).filter(Boolean);
  if (!trimmed.length) return null;
  let qty: number | null = null;
  let unit: string | null = null;
  let partNumber: string | null = null;
  const text: string[] = [];
  for (const cell of trimmed) {
    if (qty === null && new RegExp(`^(?:${NUM})$`).test(cell)) {
      qty = num(cell);
      continue;
    }
    if (unit === null && canonicalUnit(cell)) {
      unit = canonicalUnit(cell);
      continue;
    }
    if (partNumber === null && /^[A-Za-z0-9][A-Za-z0-9\-./]{3,}$/.test(cell) && /\d/.test(cell) && /[A-Za-z-]/.test(cell) && !/\s/.test(cell)) {
      partNumber = cell;
      continue;
    }
    text.push(cell);
  }
  const description = tidyDescription(text.sort((a, b) => b.length - a.length)[0] ?? partNumber ?? "");
  if (!description) return null;
  return { description, qty: qty ?? 1, unit: unit ?? "ea", partNumber, needsReview: qty === null || qty === 0 };
}

/** Turns one line of a pasted material list into a line item, or null if the line has no content. */
export function parseLine(raw: string): ParsedItem | null {
  if (raw.includes("\t")) return fromCells(raw.split("\t"));
  let line = cleanLine(raw);
  if (!line || HEADER.test(line)) return null;

  let partNumber: string | null = null;
  const labeled = PART_LABELED.exec(line);
  if (labeled) {
    partNumber = labeled[1];
    line = (line.slice(0, labeled.index) + line.slice(labeled.index + labeled[0].length)).trim();
  } else {
    const hash = PART_HASH.exec(line);
    if (hash && /\d/.test(hash[1]) && /[A-Za-z]/.test(hash[1])) {
      partNumber = hash[1];
      line = (line.slice(0, hash.index) + line.slice(hash.index + hash[0].length)).trim();
    }
  }
  line = tidyDescription(line);
  if (!line) return null;

  const lead = LEADING.exec(line);
  if (lead && tidyDescription(lead[3]).length > 0) {
    const qty = num(lead[1]);
    return {
      description: tidyDescription(lead[3]),
      qty,
      unit: unitOf(lead[2]) ?? "ea",
      partNumber,
      needsReview: qty === 0,
    };
  }

  const paren = TRAILING_PAREN.exec(line);
  if (paren) {
    const qty = num(paren[2]);
    return { description: tidyDescription(paren[1]), qty, unit: unitOf(paren[3]) ?? "ea", partNumber, needsReview: qty === 0 };
  }

  const sep = TRAILING_SEP.exec(line);
  if (sep && tidyDescription(sep[1])) {
    const qty = num(sep[2]);
    const unit = unitOf(sep[3]);
    const description = tidyDescription(sep[1]);
    // "Hex bolt 1/2-13 x 3" could be a length, not a quantity.
    const ambiguous = !unit && /\s[x×]\s*\d/.test(line.slice(sep[1].length - 1)) && /\d/.test(description);
    return { description, qty, unit: unit ?? "ea", partNumber, needsReview: ambiguous || qty === 0 };
  }

  const tail = TRAILING_UNIT.exec(line);
  if (tail && tidyDescription(tail[1])) {
    const qty = num(tail[2]);
    return { description: tidyDescription(tail[1]), qty, unit: unitOf(tail[3]) ?? "ea", partNumber, needsReview: qty === 0 };
  }

  return { description: line, qty: 1, unit: "ea", partNumber, needsReview: true };
}

/** Parses a pasted material list (emails, texts, spreadsheet rows) into RFQ line items. */
export function parseItemList(text: string): ParsedItem[] {
  return text
    .split(/\r?\n/)
    .map(parseLine)
    .filter((x): x is ParsedItem => x !== null && x.description.length > 0);
}
