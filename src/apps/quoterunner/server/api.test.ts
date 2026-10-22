import { describe, expect, it } from "vitest";
import { createFakeAi } from "@core/server/ai";
import { createTestContext, TestClient } from "@core/server/testing";
import { quoteRunnerProduct } from "../shared/product";
import { buildQuoteRunnerApp } from "./app";
import { quoteRunnerMigrations } from "./migrations";
import { reminderDue, sendDueReminders } from "./reminders";

function setup(opts: Parameters<typeof createTestContext>[0] extends infer T ? Partial<T> : never = {}) {
  const ctx = createTestContext({
    product: quoteRunnerProduct,
    migrations: quoteRunnerMigrations,
    env: { inboundEmailSecret: "inbound-secret", inboundEmailDomain: "in.example.com" },
    ...opts,
  });
  const app = buildQuoteRunnerApp(ctx);
  return { ctx, app, buyer: new TestClient(app), anon: new TestClient(app) };
}

const ITEMS = [
  { description: "3/4 EMT conduit", qty: 200, unit: "ft" },
  { description: "3/4 EMT set screw connectors", qty: 50, unit: "ea" },
  { description: "4x4 square box 1-1/2 deep", qty: 20, unit: "ea", partNumber: "52151", allowSubstitutes: false },
];

async function seed(buyer: TestClient) {
  await buyer.signup({ email: "dana@builder.com", name: "Dana Builder", orgName: "Builder Electric" });
  const mk = async (name: string, email: string | null) =>
    (await buyer.post("/api/suppliers", { name, email, contactName: `${name.split(" ")[0]} Rep`, categories: ["Electrical"] })).body;
  const north = await mk("Northside Electric Supply", "quotes@northside.example");
  const valley = await mk("Valley Wholesale", "sales@valley.example");
  const corner = await mk("Corner Hardware", null);
  const rfq = await buyer.post("/api/rfqs", {
    title: "Unit 4 rough-in",
    jobName: "Maple St apartments",
    siteAddress: "120 Maple St",
    needBy: "2026-10-30",
    dueAt: "2026-10-22T21:00:00.000Z",
    items: ITEMS,
  });
  expect(rfq.status).toBe(201);
  return { north, valley, corner, rfq: rfq.body };
}

describe("QuoteRunner request flow", () => {
  it("sends a request, collects portal, email and declined responses, compares and awards", async () => {
    const { ctx, app, buyer, anon } = setup();
    const { north, valley, corner, rfq } = await seed(buyer);
    expect(rfq.label).toBe("RFQ-0001");
    expect(rfq.items).toHaveLength(3);

    const invited = await buyer.post(`/api/rfqs/${rfq.id}/invitations`, { supplierIds: [north.id, valley.id, corner.id] });
    expect(invited.body.invitations).toHaveLength(3);

    const sent = await buyer.post(`/api/rfqs/${rfq.id}/send`, { message: "Need these by Friday." });
    expect(sent.status).toBe(200);
    expect(sent.body.sent).toBe(2);
    expect(sent.body.manual).toEqual([expect.objectContaining({ supplierName: "Corner Hardware" })]);
    expect(sent.body.rfq.status).toBe("open");
    const emails = ctx.mailer.messages.filter((m) => m.subject.startsWith("RFQ RFQ-0001"));
    expect(emails.map((m) => m.to).sort()).toEqual(["quotes@northside.example", "sales@valley.example"]);
    expect(emails[0].replyTo).toMatch(/^quotes\+[A-Za-z0-9_-]+@in\.example\.com$/);
    expect(emails[0].text).toContain("Need these by Friday.");

    const invs = sent.body.rfq.invitations as { supplierName: string; portalUrl: string }[];
    const tokenOf = (name: string) => invs.find((i) => i.supplierName === name)!.portalUrl.split("/q/")[1];

    // Northside quotes through the portal.
    const portal = await anon.get(`/api/portal/${tokenOf("Northside Electric Supply")}`);
    expect(portal.status).toBe(200);
    expect(portal.body.company.name).toBe("Builder Electric");
    expect(portal.body.items).toHaveLength(3);
    const ids = portal.body.items.map((i: { id: string }) => i.id);
    const submitted = await anon.post(`/api/portal/${tokenOf("Northside Electric Supply")}/quote`, {
      lines: [
        { itemId: ids[0], unitPrice: 0.62, leadDays: 0 },
        { itemId: ids[1], unitPrice: 0.45, leadDays: 0 },
        { itemId: ids[2], unitPrice: 2.4, leadDays: 2 },
      ],
      freight: 25,
      contactName: "Marco",
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.quote.lines).toHaveLength(3);
    expect(ctx.mailer.messages.at(-1)!.to).toBe("dana@builder.com");

    // Corner Hardware declines.
    expect((await anon.post(`/api/portal/${tokenOf("Corner Hardware")}/decline`, { reason: "No stock" })).status).toBe(200);

    // Valley replies by email; the webhook reads it.
    const inbound = await app.request("/api/inbound/email?secret=inbound-secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: "sales@valley.example",
        To: `Quotes <quotes+${tokenOf("Valley Wholesale")}@in.example.com>`,
        Subject: "Re: RFQ RFQ-0001",
        TextBody: `Pricing:
3/4 EMT conduit $0.55/ft in stock
3/4 EMT set screw connectors $0.52 ea
52151 4x4 box $2.30 ea 1 week
Freight $40.00

On Tue, Oct 20, 2026 Dana wrote:
> 200 ft 3/4 EMT conduit`,
      }),
    });
    expect(await inbound.json()).toMatchObject({ matched: true, read: true, method: "heuristic" });

    const detail = (await buyer.get(`/api/rfqs/${rfq.id}`)).body;
    expect(detail.responded).toBe(3);
    const valleyQuote = detail.quotes.find((q: { supplierName: string }) => q.supplierName === "Valley Wholesale");
    expect(valleyQuote.status).toBe("needs_review");
    expect(valleyQuote.freight).toBe(40);
    const c = detail.comparison;
    // Northside: 124 + 22.5 + 48 + 25 = 219.5 ; Valley: 110 + 26 + 46 + 40 = 222
    expect(c.bestSingle.suppliers).toEqual([north.id]);
    expect(c.bestSingle.total).toBe(219.5);
    // Splitting adds a second freight charge, so buying everything from Northside stays cheapest.
    expect(c.bestSplit.total).toBe(219.5);

    expect((await buyer.post(`/api/rfqs/${rfq.id}/quotes/${valley.id}/approve`)).status).toBe(200);

    const assignments = Object.fromEntries(ids.map((id: string) => [id, north.id]));
    const awarded = await buyer.post(`/api/rfqs/${rfq.id}/award`, { assignments, notifyOthers: true });
    expect(awarded.status).toBe(200);
    expect(awarded.body.status).toBe("awarded");
    expect(awarded.body.purchaseOrders).toHaveLength(1);
    expect(awarded.body.purchaseOrders[0]).toMatchObject({ label: "PO-0001", total: 219.5, status: "draft" });
    expect(ctx.mailer.messages.some((m) => m.to === "sales@valley.example" && /thanks for your quote/i.test(m.subject))).toBe(true);

    // Award savings show on the dashboard (average bid minus awarded price).
    const dash = (await buyer.get("/api/dashboard")).body;
    expect(dash.stats.savedThisMonth).toBeGreaterThan(0);

    // Emailing POs and price history are paid features.
    const poId = awarded.body.purchaseOrders[0].id;
    expect((await buyer.post(`/api/orders/${poId}/send`, {})).status).toBe(402);
    expect((await buyer.get("/api/prices")).status).toBe(402);
    await buyer.post("/api/billing/dev-plan", { plan: "pro" });
    const po = await buyer.post(`/api/orders/${poId}/send`, {});
    expect(po.body.status).toBe("sent");
    expect(ctx.mailer.messages.at(-1)!.subject).toBe("Purchase order PO-0001 from Builder Electric");
    const prices = (await buyer.get("/api/prices")).body;
    const emt = prices.find((p: { description: string }) => p.description === "3/4 EMT conduit");
    expect(emt.lastPaid.unitPrice).toBe(0.62);
    expect(emt.lowest.unitPrice).toBe(0.55);

    // Portal closes once the request is awarded.
    const late = await anon.post(`/api/portal/${tokenOf("Corner Hardware")}/quote`, { lines: [{ itemId: ids[0], unitPrice: 0.5 }] });
    expect(late.status).toBe(409);
  });

  it("enforces free plan limits on requests and suppliers", async () => {
    const { buyer } = setup();
    const { rfq } = await seed(buyer);
    for (let i = 0; i < 2; i++) expect((await buyer.post("/api/rfqs", { title: `Job ${i}`, items: ITEMS })).status).toBe(201);
    const fourth = await buyer.post("/api/rfqs", { title: "One too many", items: ITEMS });
    expect(fourth.status).toBe(402);
    expect(fourth.body.error.message).toMatch(/3 requests per month/);

    const s4 = (await buyer.post("/api/suppliers", { name: "Fourth Supply", email: "x@y.example" })).body;
    const all = (await buyer.get("/api/suppliers")).body.map((s: { id: string }) => s.id);
    const tooMany = await buyer.post(`/api/rfqs/${rfq.id}/invitations`, { supplierIds: all });
    expect(tooMany.status).toBe(402);
    expect(all).toContain(s4.id);
  });

  it("keeps other companies' requests and supplier links private", async () => {
    const { buyer, app } = setup();
    const { rfq } = await seed(buyer);
    const other = new TestClient(app);
    await other.signup({ email: "eve@other.com" });
    expect((await other.get(`/api/rfqs/${rfq.id}`)).status).toBe(404);
    expect((await other.get("/api/suppliers")).body).toEqual([]);
    expect((await new TestClient(app).get("/api/portal/not-a-real-token-123456")).status).toBe(404);
  });

  it("rejects inbound email without the secret", async () => {
    const { app } = setup();
    const res = await app.request("/api/inbound/email?secret=wrong", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(404);
  });

  it("parses lists with AI when available and counts it against the monthly quota", async () => {
    const ai = createFakeAi({
      "quoterunner.parse_list": () => ({
        items: [{ description: "3/4 EMT", qty: 200, unit: "ft", part_number: null, needs_review: false }],
      }),
    });
    const { buyer, ctx } = setup({ ai });
    await buyer.signup();
    const res = await buyer.post("/api/rfqs/parse-list", { text: "two hundred feet of 3/4 emt" });
    expect(res.body).toEqual({ method: "ai", items: [{ description: "3/4 EMT", qty: 200, unit: "ft", partNumber: null, needsReview: false }] });
    expect(ai.calls).toHaveLength(1);
    // Free plan has 10 AI calls a month; usage is recorded by the real client, so simulate it here.
    for (let i = 0; i < 10; i++) {
      ctx.db.run("INSERT INTO ai_usage (org_id, kind, created_at) VALUES (?, 'x', ?)", (await buyer.get("/api/auth/me")).body.org.id, ctx.now().toISOString());
    }
    const fallback = await buyer.post("/api/rfqs/parse-list", { text: "200' 3/4 EMT" });
    expect(fallback.body.method).toBe("heuristic");
  });

  it("offers the free list tool without an account", async () => {
    const { anon } = setup();
    const res = await anon.post("/api/tools/parse-list", { text: "200' 3/4 EMT\n50 connectors" });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
  });
});

describe("reminders", () => {
  const rfq = { status: "open" as const, due_at: "2026-10-23T21:00:00.000Z" };
  const inv = { status: "sent" as const, sent_at: "2026-10-20T15:00:00.000Z", reminder_count: 0, last_reminded_at: null };

  it("nudges halfway to the due date, then gives a last call", () => {
    expect(reminderDue(inv, rfq, new Date("2026-10-21T15:00:00Z"))).toBeNull();
    expect(reminderDue(inv, rfq, new Date("2026-10-22T21:00:00Z"))).toBe("first");
    expect(reminderDue({ ...inv, reminder_count: 1, last_reminded_at: "2026-10-22T21:00:00Z" }, rfq, new Date("2026-10-23T22:00:00Z"))).toBe("final");
    expect(reminderDue({ ...inv, reminder_count: 2 }, rfq, new Date("2026-10-23T22:00:00Z"))).toBeNull();
    expect(reminderDue({ ...inv, status: "quoted" as never }, rfq, new Date("2026-10-22T21:00:00Z"))).toBeNull();
  });

  it("sends due reminders only on plans that include them", async () => {
    const { ctx, buyer } = setup();
    const { north, rfq } = await seed(buyer);
    await buyer.post(`/api/rfqs/${rfq.id}/invitations`, { supplierIds: [north.id] });
    await buyer.post(`/api/rfqs/${rfq.id}/send`, {});
    ctx.clock.set("2026-10-22T10:00:00Z");
    expect(await sendDueReminders(ctx)).toBe(0);
    await buyer.post("/api/billing/dev-plan", { plan: "pro" });
    expect(await sendDueReminders(ctx)).toBe(1);
    expect(ctx.mailer.messages.at(-1)!.subject).toMatch(/^Reminder: RFQ RFQ-0001/);
    expect(await sendDueReminders(ctx)).toBe(0);
  });
});
