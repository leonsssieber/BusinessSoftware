import { describe, expect, it } from "vitest";
import { compareQuotes, evaluateAward, type CompareItem, type CompareQuote } from "./compare";
import { extractQuoteHeuristic } from "./extract";

const items: CompareItem[] = [
  { id: "emt", description: "3/4 EMT conduit", qty: 200, unit: "ft", allowSubstitutes: true },
  { id: "conn", description: "3/4 EMT connectors", qty: 50, unit: "ea", allowSubstitutes: true },
  { id: "box", description: "4x4 boxes", qty: 20, unit: "ea", allowSubstitutes: false },
];

const quote = (supplierId: string, freight: number, prices: Record<string, number | null>, extra: Partial<Record<string, { leadDays?: number; substitute?: string }>> = {}): CompareQuote => ({
  supplierId,
  supplierName: supplierId.toUpperCase(),
  freight,
  lines: Object.entries(prices).map(([itemId, unitPrice]) => ({
    itemId,
    unitPrice,
    leadDays: extra[itemId]?.leadDays ?? null,
    substitute: extra[itemId]?.substitute ?? null,
  })),
});

describe("compareQuotes", () => {
  it("marks the cheapest bid per line and totals each supplier", () => {
    const c = compareQuotes(items, [quote("a", 0, { emt: 0.6, conn: 0.9, box: 2.5 }), quote("b", 0, { emt: 0.55, conn: 1.1, box: 2.4 })], { today: "2026-10-20" });
    expect(c.rows[0].bestSupplierId).toBe("b");
    expect(c.rows[1].bestSupplierId).toBe("a");
    expect(c.suppliers.find((s) => s.supplierId === "a")!.total).toBe(120 + 45 + 50);
    expect(c.suppliers.every((s) => s.complete)).toBe(true);
  });

  it("splits the order when it saves money and counts freight once per supplier", () => {
    const c = compareQuotes(
      items,
      [quote("a", 25, { emt: 0.6, conn: 0.9, box: 2.5 }), quote("b", 25, { emt: 0.4, conn: 1.1, box: 2.6 })],
      { today: "2026-10-20" },
    );
    // Single: a = 120+45+50+25 = 240, b = 80+55+52+25 = 212.
    expect(c.bestSingle!.suppliers).toEqual(["b"]);
    expect(c.bestSingle!.total).toBe(212);
    // Split: emt from b (80), conn from a (45), box from a (50) + both freights (50) = 225 > 212,
    // so the optimizer keeps everything with b.
    expect(c.bestSplit!.total).toBe(212);
    expect(c.splitSavings).toBe(0);
  });

  it("chooses a split when the savings beat the extra freight", () => {
    const c = compareQuotes(
      items,
      [quote("a", 10, { emt: 0.6, conn: 0.5, box: 2.5 }), quote("b", 10, { emt: 0.3, conn: 1.1, box: 2.6 })],
      { today: "2026-10-20" },
    );
    expect(c.bestSplit!.assignments).toEqual({ emt: "b", conn: "a", box: "a" });
    expect(c.bestSplit!.total).toBe(60 + 25 + 50 + 20);
    expect(c.splitSavings).toBeGreaterThan(0);
    expect(c.savingsVsAverage).toBeGreaterThan(0);
  });

  it("covers missing lines with other suppliers before saving money", () => {
    const c = compareQuotes(items, [quote("a", 0, { emt: 0.6, conn: null, box: 2.5 }), quote("b", 0, { emt: 0.7, conn: 1.0, box: null })], { today: "2026-10-20" });
    expect(c.bestSingle!.missingItemIds).toHaveLength(1);
    expect(c.bestSplit!.missingItemIds).toEqual([]);
    expect(c.bestSplit!.assignments).toEqual({ emt: "a", conn: "b", box: "a" });
  });

  it("excludes late bids when asked and substitutes where not allowed", () => {
    const quotes = [
      quote("fast", 0, { emt: 0.7, conn: 1, box: 3 }, { emt: { leadDays: 2 } }),
      quote("slow", 0, { emt: 0.5, conn: 1, box: 2 }, { emt: { leadDays: 30 }, box: { substitute: "Raco 4x4 equal" } }),
    ];
    const c = compareQuotes(items, quotes, { today: "2026-10-20", needBy: "2026-10-27", excludeLate: true });
    expect(c.rows[0].cells.slow!.late).toBe(true);
    expect(c.rows[0].bestSupplierId).toBe("fast");
    expect(c.rows[2].cells.slow!.excluded).toBe(true); // box does not allow substitutes
    expect(c.rows[2].bestSupplierId).toBe("fast");
  });

  it("evaluates a hand-picked award", () => {
    const quotes = [quote("a", 15, { emt: 0.6, conn: 0.9, box: 2.5 }), quote("b", 0, { emt: 0.55, conn: 1.1, box: 2.4 })];
    const a = evaluateAward(items, quotes, { emt: "b", conn: "a", box: "b" });
    expect(a.total).toBe(110 + 45 + 48 + 15);
    expect(a.suppliers.sort()).toEqual(["a", "b"]);
  });
});

describe("extractQuoteHeuristic", () => {
  const rfqItems = [
    { id: "emt", description: "3/4 EMT conduit", qty: 200, unit: "ft", partNumber: null },
    { id: "conn", description: "3/4 EMT set screw connectors", qty: 50, unit: "ea", partNumber: null },
    { id: "box", description: "4x4 square boxes 1-1/2 deep", qty: 20, unit: "ea", partNumber: "52151" },
    { id: "romex", description: "12/2 Romex NM-B 250ft", qty: 3, unit: "roll", partNumber: null },
  ];

  it("reads a typical supplier email", () => {
    const email = `Hi Dana,

Thanks for the RFQ. Pricing below, valid for 30 days.

3/4" EMT conduit - $0.62/ft - in stock
3/4 EMT SS connectors  50 @ $0.41 = $20.50
Raco 52151 4x4 box  $2.35 ea  lead 5-7 days
12/2 NM-B 250' roll - no bid, allocation

Freight: $35.00
Quote #Q-88213

Thanks,
Marco Diaz
Northside Electric Supply`;
    const q = extractQuoteHeuristic(email, rfqItems, "2026-10-20");
    const by = Object.fromEntries(q.lines.map((l) => [l.itemId, l]));
    expect(by.emt).toMatchObject({ unitPrice: 0.62, leadDays: 0 });
    expect(by.conn).toMatchObject({ unitPrice: 0.41 });
    expect(by.box).toMatchObject({ unitPrice: 2.35, leadDays: 7 });
    expect(by.romex.unitPrice).toBeNull();
    expect(q.freight).toBe(35);
    expect(q.reference).toBe("Q-88213");
    expect(q.validUntil).toBe("2026-11-19");
    expect(q.contactName).toBe("Marco Diaz");
  });

  it("converts per-100ft pricing and flags substitutes", () => {
    const q = extractQuoteHeuristic(
      `3/4 EMT conduit $62.00 per 100
4x4 box Steel City equal to 52151 $2.10`,
      rfqItems,
      "2026-10-20",
    );
    const by = Object.fromEntries(q.lines.map((l) => [l.itemId, l]));
    expect(by.emt.unitPrice).toBe(0.62);
    expect(by.box.substitute).toMatch(/Steel City/);
  });
});
