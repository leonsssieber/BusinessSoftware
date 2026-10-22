import { Hono } from "hono";
import Stripe from "stripe";
import { z } from "zod";
import type { AppEnv, CoreContext, OrgRow } from "./context.js";
import { currentOrg, currentUser, requireAuth, requireRole } from "./auth.js";
import { badRequest, HttpError, unavailable } from "./errors.js";
import { effectivePlan } from "./limits.js";
import { body } from "./validate.js";
import type { Interval } from "./product.js";

export function createStripe(secretKey: string | null): Stripe | null {
  return secretKey ? new Stripe(secretKey) : null;
}

function priceFor(ctx: CoreContext, planId: string, interval: Interval): string | undefined {
  return ctx.env.stripePrices[`${planId}:${interval}`];
}

function planForPrice(ctx: CoreContext, priceId: string | undefined): string | undefined {
  if (!priceId) return undefined;
  const entry = Object.entries(ctx.env.stripePrices).find(([, id]) => id === priceId);
  return entry?.[0].split(":")[0];
}

/** Copies a Stripe subscription's state onto the organization it belongs to. */
export function applySubscription(ctx: CoreContext, sub: Stripe.Subscription, orgIdHint?: string | null): void {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const orgId =
    orgIdHint ||
    sub.metadata?.orgId ||
    ctx.db.get<{ id: string }>("SELECT id FROM orgs WHERE stripe_customer_id = ?", customerId)?.id;
  if (!orgId) return;

  const item = sub.items.data[0];
  const ended = sub.status === "canceled" || sub.status === "incomplete_expired";
  const plan = ended ? ctx.product.plans[0].id : planForPrice(ctx, item?.price.id) ?? sub.metadata?.plan ?? ctx.product.plans[0].id;
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null;
  ctx.db.run(
    `UPDATE orgs SET plan = ?, plan_status = ?, plan_interval = ?, plan_period_end = ?,
       stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`,
    plan,
    sub.status,
    item?.price.recurring?.interval ?? null,
    periodEnd,
    customerId,
    ended ? null : sub.id,
    orgId,
  );
}

function billingSummary(ctx: CoreContext, org: OrgRow) {
  const plan = effectivePlan(ctx, org);
  return {
    plan: plan.id,
    status: org.plan_status,
    interval: org.plan_interval,
    periodEnd: org.plan_period_end,
    hasSubscription: Boolean(org.stripe_subscription_id),
    stripeEnabled: Boolean(ctx.stripe),
    devPlanSwitch: !ctx.stripe && ctx.env.nodeEnv !== "production",
    plans: ctx.product.plans.map((p) => ({
      ...p,
      purchasable: {
        month: Boolean(priceFor(ctx, p.id, "month")),
        year: Boolean(priceFor(ctx, p.id, "year")),
      },
    })),
    limitLabels: ctx.product.limitLabels,
    trialDays: ctx.product.trialDays ?? 0,
  };
}

export function billingRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/", requireAuth, (c) => c.json(billingSummary(c.get("ctx"), currentOrg(c))));

  r.post("/checkout", requireAuth, requireRole("admin"), async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.stripe) throw unavailable("billing_disabled", "Billing is not set up yet. Set STRIPE_SECRET_KEY to enable it.");
    const input = await body(c, z.object({ plan: z.string().min(1), interval: z.enum(["month", "year"]).default("month") }));
    const org = currentOrg(c);
    const user = currentUser(c);
    const price = priceFor(ctx, input.plan, input.interval);
    if (!price) throw badRequest(`The ${input.plan} plan is not available for ${input.interval}ly billing.`);
    if (org.stripe_subscription_id) {
      throw new HttpError(409, "already_subscribed", "You already have a subscription. Change it from Manage billing.");
    }
    const session = await ctx.stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      client_reference_id: org.id,
      ...(org.stripe_customer_id ? { customer: org.stripe_customer_id } : { customer_email: user.email }),
      allow_promotion_codes: true,
      subscription_data: {
        metadata: { orgId: org.id, plan: input.plan },
        ...(ctx.product.trialDays ? { trial_period_days: ctx.product.trialDays } : {}),
      },
      metadata: { orgId: org.id, plan: input.plan },
      success_url: `${ctx.env.appUrl}/app/settings/billing?checkout=success`,
      cancel_url: `${ctx.env.appUrl}/app/settings/billing?checkout=cancelled`,
    });
    return c.json({ url: session.url });
  });

  r.post("/portal", requireAuth, requireRole("admin"), async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.stripe) throw unavailable("billing_disabled", "Billing is not set up yet.");
    const org = currentOrg(c);
    if (!org.stripe_customer_id) throw badRequest("There is no subscription to manage yet.");
    const portal = await ctx.stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${ctx.env.appUrl}/app/settings/billing`,
    });
    return c.json({ url: portal.url });
  });

  /** Local development only: switch plans without Stripe so paid features can be tried. */
  r.post("/dev-plan", requireAuth, requireRole("admin"), async (c) => {
    const ctx = c.get("ctx");
    if (ctx.stripe || ctx.env.nodeEnv === "production") {
      throw new HttpError(404, "not_found", "Not found.");
    }
    const { plan } = await body(c, z.object({ plan: z.string().min(1) }));
    if (!ctx.product.plans.some((p) => p.id === plan)) throw badRequest("Unknown plan.");
    const org = currentOrg(c);
    ctx.db.run("UPDATE orgs SET plan = ?, plan_status = 'active' WHERE id = ?", plan, org.id);
    return c.json(billingSummary(ctx, { ...org, plan, plan_status: "active" }));
  });

  r.post("/webhook", async (c) => {
    const ctx = c.get("ctx");
    if (!ctx.stripe || !ctx.env.stripeWebhookSecret) {
      throw unavailable("billing_disabled", "Billing webhooks are not configured.");
    }
    const signature = c.req.header("stripe-signature");
    if (!signature) throw badRequest("Missing Stripe signature.");
    const raw = await c.req.text();
    let event: Stripe.Event;
    try {
      event = ctx.stripe.webhooks.constructEvent(raw, signature, ctx.env.stripeWebhookSecret);
    } catch {
      throw badRequest("Invalid Stripe signature.");
    }
    const seen = ctx.db.run(
      "INSERT INTO stripe_events (id, type, created_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
      event.id,
      event.type,
      ctx.now().toISOString(),
    );
    if (!seen.changes) return c.json({ received: true, duplicate: true });

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const sub = await ctx.stripe.subscriptions.retrieve(subId);
          applySubscription(ctx, sub, session.client_reference_id);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        applySubscription(ctx, event.data.object);
        break;
      default:
        break;
    }
    return c.json({ received: true });
  });

  return r;
}
