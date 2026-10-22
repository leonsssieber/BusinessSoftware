import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "@hono/node-server/serve-static";
import { AiError } from "./ai.js";
import { authRoutes, loadSession, SESSION_COOKIE } from "./auth.js";
import { billingRoutes } from "./billing.js";
import type { AppEnv, CoreContext } from "./context.js";
import { forbidden, HttpError, notFound } from "./errors.js";
import { MailError } from "./mail.js";
import { inviteRoutes, orgRoutes } from "./org.js";

export interface CoreAppOptions {
  ctx: CoreContext;
  /** Registers the product's routes on the `/api` router. */
  routes: (api: Hono<AppEnv>) => void;
  /** `/api` path prefixes that receive requests from other sites (webhooks, public portals). */
  csrfExempt?: string[];
  /** `/api` path prefixes that accept large bodies (file uploads). */
  largeBodyPaths?: string[];
  /** Directory with the built web app (index.html, app.html, assets/). Omit in development and tests. */
  staticRoot?: string | null;
  /** Extra numbers for the admin dashboard. */
  adminStats?: (ctx: CoreContext) => Record<string, unknown>;
}

const DEFAULT_BODY_LIMIT = 1024 * 1024;
const LARGE_BODY_LIMIT = 25 * 1024 * 1024;
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Blocks cross-site form and fetch requests that ride on the session cookie. Requests without a
 * session cookie carry no ambient credentials, so they pass (API tokens, webhooks).
 */
function csrfGuard(exempt: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!UNSAFE.has(c.req.method)) return next();
    const path = c.req.path;
    if (exempt.some((p) => path.startsWith(p))) return next();
    if (!getCookie(c, SESSION_COOKIE)) return next();
    const origin = c.req.header("origin") ?? (c.req.header("referer") ? new URL(c.req.header("referer")!).origin : null);
    const ctx = c.get("ctx");
    const allowed = new Set([new URL(ctx.env.appUrl).origin]);
    const host = c.req.header("host");
    if (host) {
      allowed.add(`http://${host}`);
      allowed.add(`https://${host}`);
    }
    if (!origin || !allowed.has(origin)) throw forbidden("Cross-site request blocked.");
    return next();
  };
}

export function createCoreApp(opts: CoreAppOptions): Hono<AppEnv> {
  const { ctx } = opts;
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
      referrerPolicy: "strict-origin-when-cross-origin",
      crossOriginEmbedderPolicy: false,
    }),
  );

  const large = opts.largeBodyPaths ?? [];
  app.use("/api/*", async (c, next) => {
    const max = large.some((p) => c.req.path.startsWith(p)) ? LARGE_BODY_LIMIT : DEFAULT_BODY_LIMIT;
    return bodyLimit({
      maxSize: max,
      onError: () => {
        throw new HttpError(413, "too_large", `The upload is too large. The limit is ${Math.round(max / 1024 / 1024)} MB.`);
      },
    })(c, next);
  });

  app.use("/api/*", csrfGuard(["/api/billing/webhook", ...(opts.csrfExempt ?? [])]));
  app.use("/api/*", loadSession);

  const api = new Hono<AppEnv>();
  api.get("/health", (c) => c.json({ ok: true, product: ctx.product.slug, ai: ctx.ai.available }));
  api.route("/auth", authRoutes());
  api.route("/org", orgRoutes());
  api.route("/invites", inviteRoutes());
  api.route("/billing", billingRoutes());

  api.get("/admin/stats", (c) => {
    const user = c.get("user");
    if (!user || !ctx.env.adminEmails.includes(user.email.toLowerCase())) throw notFound();
    const count = (sql: string, ...p: string[]) => ctx.db.get<{ n: number }>(sql, ...p)?.n ?? 0;
    const since30 = new Date(ctx.now().getTime() - 30 * 86_400_000).toISOString();
    const since7 = new Date(ctx.now().getTime() - 7 * 86_400_000).toISOString();
    const plans = ctx.db.all<{ plan: string; n: number }>(
      "SELECT plan, COUNT(*) AS n FROM orgs WHERE plan_status NOT IN ('canceled') GROUP BY plan",
    );
    const mrr = plans.reduce((sum, row) => {
      const p = ctx.product.plans.find((x) => x.id === row.plan);
      return sum + (p ? p.monthly * row.n : 0);
    }, 0);
    return c.json({
      users: count("SELECT COUNT(*) AS n FROM users"),
      orgs: count("SELECT COUNT(*) AS n FROM orgs"),
      signups7d: count("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", since7),
      signups30d: count("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", since30),
      plans,
      estimatedMrr: mrr,
      aiCalls30d: count("SELECT COUNT(*) AS n FROM ai_usage WHERE created_at >= ?", since30),
      ...(opts.adminStats?.(ctx) ?? {}),
    });
  });

  if (ctx.env.nodeEnv !== "production") {
    api.get("/dev/outbox", (c) =>
      c.json(
        ctx.db.all(
          "SELECT id, to_addr AS \"to\", subject, text_body AS text, created_at AS createdAt FROM outbox ORDER BY created_at DESC LIMIT 50",
        ),
      ),
    );
  }

  opts.routes(api);
  api.all("*", () => {
    throw notFound("No such API endpoint.");
  });
  app.route("/api", api);

  if (opts.staticRoot) {
    const root = opts.staticRoot;
    const appHtml = join(root, "app.html");
    const indexHtml = join(root, "index.html");
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.status === 200) c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    app.use("*", serveStatic({ root, rewriteRequestPath: (p) => (p === "/" ? "/index.html" : p) }));
    app.get("*", (c) => {
      const file = existsSync(appHtml) ? appHtml : indexHtml;
      c.header("Cache-Control", "no-cache");
      return c.html(readFileSync(file, "utf8"));
    });
  }

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
    }
    if (err instanceof AiError) {
      const status = err.code === "not_configured" ? 503 : err.code === "rate_limited" ? 503 : 502;
      return c.json({ error: { code: `ai_${err.code}`, message: err.message } }, status);
    }
    if (err instanceof MailError) {
      return c.json({ error: { code: "mail_failed", message: err.message } }, 502);
    }
    console.error(`[error] ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: { code: "internal", message: "Something went wrong on our side. Try again." } }, 500);
  });

  return app;
}
