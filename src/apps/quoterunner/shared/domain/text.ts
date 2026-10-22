/** Canonical units and the spellings buyers use for them. */
const UNIT_SYNONYMS: Record<string, string[]> = {
  ea: ["ea", "each", "pc", "pcs", "piece", "pieces", "unit", "units", "qty"],
  ft: ["ft", "feet", "foot", "lf", "lin ft", "linear ft", "linear feet", "'"],
  box: ["box", "boxes", "bx"],
  roll: ["roll", "rolls", "rl", "rls"],
  case: ["case", "cases", "cs"],
  pack: ["pack", "packs", "pk", "pkg", "pkgs"],
  bag: ["bag", "bags"],
  gal: ["gal", "gals", "gallon", "gallons"],
  lb: ["lb", "lbs", "pound", "pounds"],
  sheet: ["sheet", "sheets", "sht", "shts"],
  bundle: ["bundle", "bundles", "bdl", "bdls"],
  pair: ["pair", "pairs", "pr"],
  set: ["set", "sets"],
  m: ["m", "meter", "meters", "metre", "metres"],
  kg: ["kg", "kgs", "kilogram", "kilograms"],
  ton: ["ton", "tons"],
  yd: ["yd", "yds", "yard", "yards"],
  sqft: ["sqft", "sq ft", "sf", "square feet"],
  cuyd: ["cuyd", "cu yd", "cy", "cubic yards"],
  tube: ["tube", "tubes"],
  can: ["can", "cans"],
  spool: ["spool", "spools", "reel", "reels"],
  stick: ["stick", "sticks", "length", "lengths", "lgth"],
  lot: ["lot", "lots", "ls", "lump sum"],
};

export const UNITS = Object.keys(UNIT_SYNONYMS);

const SYNONYM_TO_UNIT = new Map<string, string>();
for (const [unit, words] of Object.entries(UNIT_SYNONYMS)) {
  SYNONYM_TO_UNIT.set(unit, unit);
  for (const w of words) SYNONYM_TO_UNIT.set(w, unit);
}

/** Maps a unit spelling to its canonical form, or null if it is not a known unit. */
export function canonicalUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ").trim();
  return SYNONYM_TO_UNIT.get(key) ?? null;
}

/** Regex alternation of every unit spelling, longest first so "sq ft" wins over "ft". */
export const UNIT_PATTERN = [...SYNONYM_TO_UNIT.keys()]
  .filter((u) => u !== "'")
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"))
  .join("|");

const STOPWORDS = new Set(["the", "of", "for", "with", "and", "a", "an", "to", "in", "per", "w", "w/"]);

/** Normalizes a product description so the same item matches across requests and suppliers. */
export function itemKey(description: string, partNumber?: string | null): string {
  const pn = partNumber?.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (pn && pn.length >= 3) return `pn:${pn}`;
  return tokens(description).join(" ");
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    // Inches are the default unit for trade sizes, so 3/4" and 3/4in both become 3/4.
    .replace(/(\d)\s*(?:"|''|in\b|inch(?:es)?\b)/g, "$1")
    .replace(/(\d)\s*(?:'|ft\b|feet\b|foot\b)/g, "$1ft")
    .replace(/(\d)\s*[x×]\s*(\d)/g, "$1x$2")
    .replace(/[^a-z0-9/.\sx-]/g, " ")
    .replace(/(?<!\d)[.-]|[.-](?!\d)/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Token-overlap similarity in [0, 1] with a boost for shared size tokens like "3/4in". */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  let sizeShared = 0;
  for (const t of ta) {
    if (tb.has(t)) {
      shared++;
      if (/\d/.test(t)) sizeShared++;
    }
  }
  const jaccard = shared / (ta.size + tb.size - shared);
  // Sizes are the strongest signal in trade line items ("3/4in EMT" vs "1in EMT").
  const sizeBonus = sizeShared > 0 ? 0.15 : 0;
  const sizeConflict = [...ta].some((t) => /\d/.test(t)) && [...tb].some((t) => /\d/.test(t)) && sizeShared === 0;
  return Math.max(0, Math.min(1, jaccard + sizeBonus - (sizeConflict ? 0.2 : 0)));
}

/** Parses "$1,234.50", "1234.5", "1.234,50"-free US style money strings. */
export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[$\s,]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
