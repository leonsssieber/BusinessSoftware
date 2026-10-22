export type Interval = "month" | "year";

export interface PlanDef {
  id: string;
  name: string;
  /** Display price in USD per month when billed monthly. */
  monthly: number;
  /** Display price in USD per year when billed yearly. */
  yearly: number;
  description: string;
  features: string[];
  /** Usage limits keyed by limit name. `null` means unlimited. */
  limits: Record<string, number | null>;
  /** Maximum members in the organization. `null` means unlimited. */
  seats: number | null;
  highlighted?: boolean;
}

export interface ProductInfo {
  slug: string;
  name: string;
  tagline: string;
  supportEmail: string;
  /** Hex color used in transactional emails. */
  emailAccent: string;
  plans: PlanDef[];
  /** Human labels for limit keys, used in upgrade messages, e.g. `{ rfqsPerMonth: "requests per month" }`. */
  limitLabels: Record<string, string>;
  trialDays?: number;
}

export function findPlan(product: ProductInfo, planId: string): PlanDef {
  return product.plans.find((p) => p.id === planId) ?? product.plans[0];
}
