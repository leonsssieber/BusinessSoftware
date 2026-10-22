import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { tooManyRequests } from "./errors.js";
import type { AppEnv } from "./context.js";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function clientIp(c: Context<AppEnv>): string {
  if (c.get("ctx")?.env.trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Fixed-window, in-memory rate limiter. Good enough for one server process; swap for a shared
 * store before running several instances behind a load balancer.
 */
export function rateLimit(opts: {
  bucket: string;
  limit: number;
  windowMs: number;
  key?: (c: Context<AppEnv>) => string;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get("ctx")?.env.nodeEnv === "test" && !c.req.header("x-test-rate-limit")) return next();
    const id = `${opts.bucket}:${opts.key ? opts.key(c) : clientIp(c)}`;
    const now = Date.now();
    const b = buckets.get(id);
    if (!b || b.resetAt <= now) {
      buckets.set(id, { count: 1, resetAt: now + opts.windowMs });
    } else {
      b.count++;
      if (b.count > opts.limit) {
        c.header("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
        throw tooManyRequests();
      }
    }
    if (buckets.size > 50_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return next();
  };
}

export function resetRateLimits(): void {
  buckets.clear();
}
