import { describe, expect, it } from "vitest";
import { parseItemList, parseLine } from "./parse";
import { itemKey, similarity } from "./text";

function one(line: string) {
  const r = parseLine(line);
  if (!r) throw new Error(`no item for "${line}"`);
  return r;
}

describe("parseLine", () => {
  it.each([
    ["200' 3/4 EMT", 200, "ft", "3/4 EMT"],
    ["200ft of 3/4 EMT", 200, "ft", "3/4 EMT"],
    ["(10) 4x4 boxes", 10, "ea", "4x4 boxes"],
    ["10 - 4x4 deep boxes", 10, "ea", "4x4 deep boxes"],
    ["100 wire nuts, yellow", 100, "ea", "wire nuts, yellow"],
    ["5 gal paint, primer", 5, "gal", "paint, primer"],
    ["2.5 gal sealer", 2.5, "gal", "sealer"],
    ["3 rolls 12/2 Romex 250'", 3, "roll", "12/2 Romex 250'"],
    ["12x 2x4x8 studs", 12, "ea", "2x4x8 studs"],
    ["1,000 ft #12 THHN black", 1000, "ft", "#12 THHN black"],
    ["50 ea 3/4 EMT set screw connectors", 50, "ea", "3/4 EMT set screw connectors"],
  ])("reads a leading quantity: %s", (line, qty, unit, description) => {
    expect(one(line)).toMatchObject({ qty, unit, description, needsReview: false });
  });

  it.each([
    ["3/4 EMT x 200ft", 200, "ft", "3/4 EMT"],
    ["12/2 Romex - 3 rolls", 3, "roll", "12/2 Romex"],
    ['3/4" EMT connectors (50)', 50, "ea", '3/4" EMT connectors'],
    ["1/2 PVC 90s qty 24", 24, "ea", "1/2 PVC 90s"],
    ["Romex 14/2 250ft", 250, "ft", "Romex 14/2"],
    ["Plywood 3/4 CDX: 40 sheets", 40, "sheet", "Plywood 3/4 CDX"],
  ])("reads a trailing quantity: %s", (line, qty, unit, description) => {
    expect(one(line)).toMatchObject({ qty, unit, description });
  });

  it("does not mistake sizes for quantities", () => {
    expect(one("3/4 EMT connectors")).toMatchObject({ qty: 1, needsReview: true, description: "3/4 EMT connectors" });
    expect(one("2x4 stud")).toMatchObject({ qty: 1, needsReview: true });
    expect(one('1-1/2" PVC coupling')).toMatchObject({ qty: 1, needsReview: true });
  });

  it("flags an ambiguous trailing number without a unit", () => {
    expect(one("Hex bolt 1/2-13 x 3")).toMatchObject({ qty: 3, needsReview: true });
  });

  it("pulls out part numbers", () => {
    expect(one("25 Square D breaker part # QO120")).toMatchObject({ qty: 25, partNumber: "QO120", description: "Square D breaker" });
    expect(one("4 LED troffer 2x4 SKU: LT24-40K")).toMatchObject({ qty: 4, partNumber: "LT24-40K" });
    expect(one("6 GFCI receptacles #GFR15W")).toMatchObject({ qty: 6, partNumber: "GFR15W", description: "GFCI receptacles" });
  });

  it("strips bullets, numbering and checkboxes", () => {
    expect(one("- 200' 3/4 EMT")).toMatchObject({ qty: 200 });
    expect(one("1. 40 sheets 1/2 drywall")).toMatchObject({ qty: 40, unit: "sheet", description: "1/2 drywall" });
    expect(one("[ ] 12 hangers")).toMatchObject({ qty: 12, description: "hangers" });
  });

  it("reads spreadsheet rows pasted with tabs", () => {
    expect(one("24\tea\t3/4 EMT straps\tTE-34")).toMatchObject({ qty: 24, unit: "ea", description: "3/4 EMT straps", partNumber: "TE-34" });
  });
});

describe("parseItemList", () => {
  it("parses a messy job list and skips headers and blanks", () => {
    const items = parseItemList(`Qty Description
    200' 3/4 EMT

    50 3/4 EMT connectors
    50 3/4 couplings
    (20) 4x4 boxes w/ mud rings
    12/2 Romex - 3 rolls`);
    expect(items.map((i) => [i.qty, i.unit, i.description])).toEqual([
      [200, "ft", "3/4 EMT"],
      [50, "ea", "3/4 EMT connectors"],
      [50, "ea", "3/4 couplings"],
      [20, "ea", "4x4 boxes w/ mud rings"],
      [3, "roll", "12/2 Romex"],
    ]);
  });
});

describe("item matching", () => {
  it("normalizes descriptions so the same item matches", () => {
    expect(itemKey('3/4" EMT Conduit')).toBe(itemKey("3/4in emt conduit"));
    expect(itemKey("anything", "QO-120")).toBe("pn:qo120");
  });

  it("scores the right item highest and penalizes size conflicts", () => {
    const right = similarity("3/4 EMT set screw connector", '3/4" EMT connector set screw steel');
    const wrongSize = similarity("1 EMT set screw connector", '3/4" EMT connector set screw steel');
    const unrelated = similarity("4x4 box", '3/4" EMT connector set screw steel');
    expect(right).toBeGreaterThan(0.5);
    expect(right).toBeGreaterThan(wrongSize);
    expect(wrongSize).toBeGreaterThan(unrelated);
  });
});
