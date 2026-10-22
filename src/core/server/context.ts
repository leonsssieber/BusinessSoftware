import type Stripe from "stripe";
import type { AiClient } from "./ai.js";
import type { Db } from "./db.js";
import type { CoreEnv } from "./env.js";
import type { Mailer } from "./mail.js";
import type { ProductInfo } from "./product.js";

export type Role = "owner" | "admin" | "member";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
}

export interface OrgRow {
  id: string;
  name: string;
  plan: string;
  plan_status: string;
  plan_interval: string | null;
  plan_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  settings: string;
  created_at: string;
}

export interface CoreContext {
  env: CoreEnv;
  db: Db;
  mailer: Mailer;
  ai: AiClient;
  stripe: Stripe | null;
  product: ProductInfo;
  now: () => Date;
}

export interface AppVariables {
  ctx: CoreContext;
  user: UserRow | null;
  org: OrgRow | null;
  role: Role | null;
  sessionHash: string | null;
}

export type AppEnv = { Variables: AppVariables };

/** The signed-in user and their current organization, as returned to the browser. */
export interface SessionPayload {
  user: { id: string; email: string; name: string };
  org: { id: string; name: string; plan: string; planStatus: string; settings: Record<string, unknown> };
  role: Role;
  orgs: { id: string; name: string; role: Role }[];
  isAdmin: boolean;
}
