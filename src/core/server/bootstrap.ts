import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import type Stripe from "stripe";
import { createAnthropicAi, createDisabledAi, type AiClient } from "./ai.js";
import { createStripe } from "./billing.js";
import type { AppEnv, CoreContext } from "./context.js";
import { Db, type Migration } from "./db.js";
import type { CoreEnv } from "./env.js";
import { createConsoleMailer, createResendMailer, type Mailer } from "./mail.js";
import { coreMigrations } from "./migrations.js";
import type { ProductInfo } from "./product.js";

export interface ContextOptions {
  env: CoreEnv;
  product: ProductInfo;
  migrations: Migration[];
  db?: Db;
  mailer?: Mailer;
  ai?: AiClient;
  stripe?: Stripe | null;
  now?: () => Date;
}

/** Opens the database, applies migrations and wires mail, AI and billing from the environment. */
export function createCoreContext(opts: ContextOptions): CoreContext {
  const now = opts.now ?? (() => new Date());
  const db = opts.db ?? new Db(opts.env.databasePath);
  db.migrate("core", coreMigrations);
  db.migrate(opts.product.slug, opts.migrations);

  const mailer =
    opts.mailer ??
    (opts.env.mailProvider === "resend" && opts.env.resendApiKey
      ? createResendMailer({ db, now, apiKey: opts.env.resendApiKey, from: opts.env.mailFrom })
      : createConsoleMailer({ db, now, quiet: opts.env.nodeEnv === "test" }));

  const ai =
    opts.ai ??
    (opts.env.anthropicApiKey
      ? createAnthropicAi({ apiKey: opts.env.anthropicApiKey, model: opts.env.anthropicModel, db, now })
      : createDisabledAi());

  const stripe = opts.stripe === undefined ? createStripe(opts.env.stripeSecretKey) : opts.stripe;
  return { env: opts.env, db, mailer, ai, stripe, product: opts.product, now };
}

/** Loads `.env` from the working directory if present (real environment variables win). */
export function loadDotEnv(path = ".env"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export interface Job {
  name: string;
  everyMs: number;
  run: (ctx: CoreContext) => Promise<void> | void;
}

/** Runs background jobs on fixed intervals. Errors are logged and never stop the loop. */
export function startJobs(ctx: CoreContext, jobs: Job[]): () => void {
  const timers = jobs.map((job) =>
    setInterval(async () => {
      try {
        await job.run(ctx);
      } catch (err) {
        console.error(`[job] ${job.name} failed`, err);
      }
    }, job.everyMs),
  );
  return () => timers.forEach(clearInterval);
}

export function startServer(app: Hono<AppEnv>, ctx: CoreContext, stopJobs?: () => void) {
  const server = serve({ fetch: app.fetch, port: ctx.env.port }, (info) => {
    console.log(`${ctx.product.name} listening on http://localhost:${info.port} (public URL ${ctx.env.appUrl})`);
    console.log(
      `  AI: ${ctx.ai.available ? ctx.ai.model : "off (set ANTHROPIC_API_KEY)"} | billing: ${ctx.stripe ? "Stripe" : "off"} | mail: ${ctx.mailer.provider}`,
    );
  });
  const shutdown = () => {
    stopJobs?.();
    server.close(() => {
      ctx.db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}
