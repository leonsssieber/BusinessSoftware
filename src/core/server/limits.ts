import type { Context } from "hono";
import type { AppEnv, CoreContext, OrgRow } from "./context.js";
import { planLimit } from "./errors.js";
import { findPlan, type PlanDef } from "./product.js";
import { aiCallsSince } from "./ai.js";

/** The plan an organization is entitled to right now. Lapsed subscriptions fall back to free. */
export function effectivePlan(ctx: CoreContext, org: OrgRow): PlanDef {
  const lapsed = org.plan_status === "canceled" || org.plan_status === "incomplete_expired";
  return findPlan(ctx.product, lapsed ? ctx.product.plans[0].id : org.plan);
}

export function limitFor(ctx: CoreContext, org: OrgRow, key: string): number | null {
  const plan = effectivePlan(ctx, org);
  return key in plan.limits ? plan.limits[key] : null;
}

/** Throws a 402 with an upgrade message if `used` has reached the plan's limit for `key`. */
export function assertWithinLimit(c: Context<AppEnv>, org: OrgRow, key: string, used: number): void {
  const ctx = c.get("ctx");
  const limit = limitFor(ctx, org, key);
  if (limit !== null && used >= limit) {
    const plan = effectivePlan(ctx, org);
    const label = ctx.product.limitLabels[key] ?? key;
    throw planLimit(`Your ${plan.name} plan includes ${limit} ${label}. Upgrade to get more.`, {
      limit: key,
      max: limit,
      plan: plan.id,
    });
  }
}

/** Throws a 402 unless the organization's plan has this feature flag (a limit of 1 or more, or unlimited). */
export function assertFeature(c: Context<AppEnv>, org: OrgRow, key: string): void {
  assertWithinLimit(c, org, key, 0);
}

export function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Throws a 402 if the organization used up this month's AI calls. */
export function assertAiQuota(c: Context<AppEnv>, org: OrgRow): void {
  const ctx = c.get("ctx");
  assertWithinLimit(c, org, "aiCallsPerMonth", aiCallsSince(ctx.db, org.id, startOfMonth(ctx.now())));
}

export function seatUsage(ctx: CoreContext, orgId: string): number {
  const members = ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ?", orgId)?.n ?? 0;
  const invites =
    ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM invites WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ?",
      orgId,
      ctx.now().toISOString(),
    )?.n ?? 0;
  return members + invites;
}
