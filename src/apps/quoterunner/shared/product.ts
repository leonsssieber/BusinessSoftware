import type { ProductInfo } from "@core/server/product";

export const quoteRunnerProduct: ProductInfo = {
  slug: "quoterunner",
  name: "QuoteRunner",
  tagline: "Every supplier's price, side by side.",
  supportEmail: "support@quoterunner.app",
  emailAccent: "#2a4a9b",
  trialDays: 14,
  limitLabels: {
    rfqsPerMonth: "requests per month",
    suppliersPerRfq: "suppliers per request",
    aiCallsPerMonth: "AI quote reads per month",
    autoReminders: "automatic reminders",
    priceHistory: "price history",
    poEmail: "purchase orders by email",
  },
  plans: [
    {
      id: "free",
      name: "Free",
      monthly: 0,
      yearly: 0,
      description: "Try it on a real job.",
      features: [
        "3 requests a month",
        "Up to 3 suppliers per request",
        "Supplier quote links and side-by-side comparison",
        "10 AI quote reads a month",
      ],
      limits: { rfqsPerMonth: 3, suppliersPerRfq: 3, aiCallsPerMonth: 10, autoReminders: 0, priceHistory: 0, poEmail: 0 },
      seats: 1,
    },
    {
      id: "pro",
      name: "Pro",
      monthly: 149,
      yearly: 1490,
      highlighted: true,
      description: "For the person who buys materials every week.",
      features: [
        "Unlimited requests",
        "Up to 25 suppliers per request",
        "Automatic reminders to slow suppliers",
        "Purchase orders emailed to suppliers",
        "Price history and last-paid prices",
        "500 AI quote reads a month",
        "2 users",
      ],
      limits: { rfqsPerMonth: null, suppliersPerRfq: 25, aiCallsPerMonth: 500, autoReminders: null, priceHistory: null, poEmail: null },
      seats: 2,
    },
    {
      id: "team",
      name: "Team",
      monthly: 299,
      yearly: 2990,
      description: "For estimators, PMs and purchasing working together.",
      features: ["Everything in Pro", "Up to 50 suppliers per request", "10 users", "2,000 AI quote reads a month", "Priority support"],
      limits: { rfqsPerMonth: null, suppliersPerRfq: 50, aiCallsPerMonth: 2000, autoReminders: null, priceHistory: null, poEmail: null },
      seats: 10,
    },
  ],
};

/** Company details used on supplier emails and purchase orders (stored in the org settings). */
export interface CompanySettings {
  companyAddress?: string;
  companyPhone?: string;
  poTerms?: string;
  deliveryInstructions?: string;
  /** Days suppliers get to quote when a request has no due date. */
  defaultQuoteDays?: number;
}

export const SUPPLIER_CATEGORIES = [
  "Electrical",
  "Plumbing",
  "HVAC",
  "Lumber & building materials",
  "Steel & metals",
  "Fasteners & hardware",
  "Concrete & masonry",
  "Paint & coatings",
  "Tools & equipment rental",
  "Safety & PPE",
  "MRO & industrial supply",
  "Machining stock",
] as const;

export const rfqLabel = (n: number) => `RFQ-${String(n).padStart(4, "0")}`;
export const poLabel = (n: number) => `PO-${String(n).padStart(4, "0")}`;
