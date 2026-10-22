import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createCoreApp } from "./http.js";
import { createTestContext, TestClient } from "./testing.js";
import type { ProductInfo } from "./product.js";
import type { AppEnv } from "./context.js";
import { requireAuth, currentOrg } from "./auth.js";
import { assertWithinLimit } from "./limits.js";

const product: ProductInfo = {
  slug: "testapp",
  name: "TestApp",
  tagline: "Testing",
  supportEmail: "help@example.com",
  emailAccent: "#225588",
  limitLabels: { widgets: "widgets" },
  plans: [
    { id: "free", name: "Free", monthly: 0, yearly: 0, description: "", features: [], limits: { widgets: 1 }, seats: 1 },
    { id: "pro", name: "Pro", monthly: 49, yearly: 490, description: "", features: [], limits: { widgets: null }, seats: 3 },
  ],
};

function setup(env: Record<string, unknown> = {}) {
  const ctx = createTestContext({ product, migrations: [], env });
  const app = createCoreApp({
    ctx,
    routes: (api: Hono<AppEnv>) => {
      api.post("/widgets", requireAuth, (c) => {
        assertWithinLimit(c, currentOrg(c), "widgets", 1);
        return c.json({ ok: true });
      });
    },
  });
  return { ctx, app, client: new TestClient(app) };
}

describe("accounts", () => {
  it("signs up, reads the session, logs out and logs back in", async () => {
    const { client } = setup();
    const me = await client.signup({ email: "owner@example.com", name: "Olive Owner", orgName: "Olive Plumbing" });
    expect(me.user.email).toBe("owner@example.com");
    expect(me.org.name).toBe("Olive Plumbing");
    expect(me.role).toBe("owner");

    expect((await client.get("/api/auth/me")).status).toBe(200);
    expect((await client.post("/api/auth/logout")).status).toBe(200);
    expect((await client.get("/api/auth/me")).status).toBe(401);

    const bad = await client.post("/api/auth/login", { email: "owner@example.com", password: "wrong password!" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("invalid_credentials");

    const ok = await client.post("/api/auth/login", { email: "OWNER@example.com", password: "correct horse battery" });
    expect(ok.status).toBe(200);
    expect(ok.body.org.name).toBe("Olive Plumbing");
  });

  it("rejects duplicate emails and weak passwords", async () => {
    const { client, app } = setup();
    await client.signup({ email: "a@example.com" });
    const dup = await new TestClient(app).post("/api/auth/signup", {
      name: "Again",
      email: "a@example.com",
      password: "correct horse battery",
    });
    expect(dup.status).toBe(409);
    const weak = await new TestClient(app).post("/api/auth/signup", {
      name: "Weak",
      email: "weak@example.com",
      password: "short",
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error.message).toMatch(/at least 10/);
  });

  it("resets a forgotten password with the emailed link", async () => {
    const { client, ctx, app } = setup();
    await client.signup({ email: "forgot@example.com" });
    await client.post("/api/auth/logout");
    expect((await client.post("/api/auth/password/forgot", { email: "forgot@example.com" })).status).toBe(200);
    const mail = ctx.mailer.messages.at(-1)!;
    const token = /token=([^\s"&]+)/.exec(mail.text)![1];
    const anon = new TestClient(app);
    const reset = await anon.post("/api/auth/password/reset", { token: decodeURIComponent(token), password: "a brand new password" });
    expect(reset.status).toBe(200);
    const again = await anon.post("/api/auth/password/reset", { token: decodeURIComponent(token), password: "another new password" });
    expect(again.status).toBe(400);
    expect((await anon.post("/api/auth/login", { email: "forgot@example.com", password: "a brand new password" })).status).toBe(200);
  });

  it("does not reveal whether an email exists when asking for a reset", async () => {
    const { client, ctx } = setup();
    const res = await client.post("/api/auth/password/forgot", { email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(ctx.mailer.messages).toHaveLength(0);
  });

  it("blocks cross-site writes that carry the session cookie", async () => {
    const { client } = setup();
    await client.signup();
    const res = await client.request("PATCH", "/api/auth/me", { name: "Mallory" }, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("expires sessions after 30 days", async () => {
    const { client, ctx } = setup();
    await client.signup();
    ctx.clock.advance(31 * 86_400_000);
    expect((await client.get("/api/auth/me")).status).toBe(401);
  });
});

describe("teams", () => {
  it("invites a teammate who signs up through the link, within the seat limit", async () => {
    const { client, ctx, app } = setup();
    await client.signup({ email: "boss@example.com", orgName: "Boss Co" });

    const free = await client.post("/api/org/invites", { email: "mate@example.com" });
    expect(free.status).toBe(402);
    expect(free.body.error.code).toBe("plan_limit");

    await client.post("/api/billing/dev-plan", { plan: "pro" });
    const inv = await client.post("/api/org/invites", { email: "mate@example.com", role: "member" });
    expect(inv.status).toBe(201);
    const link = /invite\/([^\s"]+)/.exec(ctx.mailer.messages.at(-1)!.text)![1];
    const token = decodeURIComponent(link);

    const mate = new TestClient(app);
    const info = await mate.get(`/api/invites/${encodeURIComponent(token)}`);
    expect(info.body.orgName).toBe("Boss Co");
    const me = await mate.post("/api/auth/signup", {
      name: "Mate",
      email: "mate@example.com",
      password: "correct horse battery",
      inviteToken: token,
    });
    expect(me.status).toBe(201);
    expect(me.body.org.name).toBe("Boss Co");
    expect(me.body.role).toBe("member");

    const team = await client.get("/api/org");
    expect(team.body.members).toHaveLength(2);
    expect(team.body.invites).toHaveLength(0);

    const forbidden = await mate.post("/api/org/invites", { email: "x@example.com" });
    expect(forbidden.status).toBe(403);
  });

  it("keeps at least one owner", async () => {
    const { client } = setup();
    const me = await client.signup();
    const res = await client.delete(`/api/org/members/${me.user.id}`);
    expect(res.status).toBe(400);
  });
});

describe("plans and billing", () => {
  it("enforces plan limits and lifts them after an upgrade", async () => {
    const { client } = setup();
    await client.signup();
    const blocked = await client.post("/api/widgets");
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.message).toBe("Your Free plan includes 1 widgets. Upgrade to get more.");
    await client.post("/api/billing/dev-plan", { plan: "pro" });
    expect((await client.post("/api/widgets")).status).toBe(200);
  });

  it("applies Stripe subscription webhooks to the organization", async () => {
    const secret = "whsec_test_secret";
    const { client, ctx, app } = setup({
      stripeWebhookSecret: secret,
      stripePrices: { "pro:month": "price_pro_month" },
    });
    (ctx as any).stripe = new Stripe("sk_test_dummy");
    const me = await client.signup();

    const event = {
      id: "evt_1",
      object: "event",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          object: "subscription",
          customer: "cus_1",
          status: "active",
          metadata: { orgId: me.org.id },
          items: {
            data: [
              {
                id: "si_1",
                price: { id: "price_pro_month", recurring: { interval: "month" } },
                current_period_end: 1_800_000_000,
              },
            ],
          },
        },
      },
    };
    const payload = JSON.stringify(event);
    const sig = ctx.stripe!.webhooks.generateTestHeaderString({ payload, secret });
    const res = await app.request("/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": sig, "Content-Type": "application/json" },
      body: payload,
    });
    expect(res.status).toBe(200);
    const billing = await client.get("/api/billing");
    expect(billing.body.plan).toBe("pro");
    expect(billing.body.hasSubscription).toBe(true);

    const replay = await app.request("/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": sig, "Content-Type": "application/json" },
      body: payload,
    });
    expect(await replay.json()).toMatchObject({ duplicate: true });

    const forged = await app.request("/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=bad", "Content-Type": "application/json" },
      body: payload,
    });
    expect(forged.status).toBe(400);
  });
});
