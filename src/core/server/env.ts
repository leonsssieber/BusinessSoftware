import { join } from "node:path";

export interface CoreEnv {
  nodeEnv: "development" | "production" | "test";
  appUrl: string;
  port: number;
  dataDir: string;
  databasePath: string;
  trustProxy: boolean;
  secureCookies: boolean;
  anthropicApiKey: string | null;
  anthropicModel: string;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  /** Stripe price ids keyed `${planId}:${interval}`, e.g. `pro:month`. */
  stripePrices: Record<string, string>;
  mailProvider: "console" | "resend";
  resendApiKey: string | null;
  mailFrom: string;
  adminEmails: string[];
  inboundEmailSecret: string | null;
  inboundEmailDomain: string | null;
}

type Source = Record<string, string | undefined>;

function str(src: Source, key: string): string | null {
  const v = src[key]?.trim();
  return v ? v : null;
}

/**
 * Reads configuration from environment variables. `defaults` lets each product set its own
 * port and data directory; real environment variables always win.
 */
export function loadEnv(src: Source = process.env, defaults: { port: number; dataDir: string }): CoreEnv {
  const nodeEnv = (str(src, "NODE_ENV") ?? "development") as CoreEnv["nodeEnv"];
  const port = Number(str(src, "PORT") ?? defaults.port);
  const appUrl = (str(src, "APP_URL") ?? `http://localhost:${port}`).replace(/\/$/, "");
  const dataDir = str(src, "DATA_DIR") ?? defaults.dataDir;

  const stripePrices: Record<string, string> = {};
  for (const [key, value] of Object.entries(src)) {
    const m = /^STRIPE_PRICE_([A-Z0-9]+)_(MONTH|YEAR)$/.exec(key);
    if (m && value) stripePrices[`${m[1].toLowerCase()}:${m[2].toLowerCase()}`] = value.trim();
  }

  const resendApiKey = str(src, "RESEND_API_KEY");
  return {
    nodeEnv,
    appUrl,
    port,
    dataDir,
    databasePath: str(src, "DATABASE_PATH") ?? join(dataDir, "app.db"),
    trustProxy: str(src, "TRUST_PROXY") === "1",
    secureCookies: appUrl.startsWith("https://"),
    anthropicApiKey: str(src, "ANTHROPIC_API_KEY"),
    anthropicModel: str(src, "ANTHROPIC_MODEL") ?? "claude-opus-5-5",
    stripeSecretKey: str(src, "STRIPE_SECRET_KEY"),
    stripeWebhookSecret: str(src, "STRIPE_WEBHOOK_SECRET"),
    stripePrices,
    mailProvider: (str(src, "MAIL_PROVIDER") as CoreEnv["mailProvider"]) ?? (resendApiKey ? "resend" : "console"),
    resendApiKey,
    mailFrom: str(src, "MAIL_FROM") ?? "Studio <hello@example.com>",
    adminEmails: (str(src, "ADMIN_EMAILS") ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    inboundEmailSecret: str(src, "INBOUND_EMAIL_SECRET"),
    inboundEmailDomain: str(src, "INBOUND_EMAIL_DOMAIN"),
  };
}
