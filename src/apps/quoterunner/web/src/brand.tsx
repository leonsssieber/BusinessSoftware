import type { Brand, NavItem } from "@ui/brand";
import { ClipboardList, Gauge, LineChart, PackageCheck, Truck } from "lucide-react";

export function Mark({ className = "size-7" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="var(--k-brand)" />
      <rect x="7" y="8" width="18" height="3" rx="1" fill="var(--k-brand-fg)" />
      <rect x="7" y="14.5" width="18" height="3" rx="1" fill="var(--k-accent)" />
      <rect x="7" y="21" width="11" height="3" rx="1" fill="var(--k-brand-fg)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark />
      <span className="font-display text-lg font-bold tracking-tight" style={{ fontStretch: "88%" }}>
        QuoteRunner
      </span>
    </span>
  );
}

export const brand: Brand = {
  name: "QuoteRunner",
  tagline: "Send one request. Get every supplier's price side by side.",
  logo: <Logo />,
  pitch: [
    "Email your material list to every supplier at once.",
    "Suppliers answer on a quote link, by email or with a PDF. No logins for them.",
    "See the cheapest way to buy, freight included, and send purchase orders in a click.",
  ],
};

export const nav: NavItem[] = [
  { to: "/app", label: "Overview", icon: Gauge, end: true },
  { to: "/app/requests", label: "Requests", icon: ClipboardList },
  { to: "/app/suppliers", label: "Suppliers", icon: Truck },
  { to: "/app/orders", label: "Purchase orders", icon: PackageCheck },
  { to: "/app/prices", label: "Price history", icon: LineChart },
];
