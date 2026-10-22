import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "../cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className ?? "size-5")} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-muted" role="status">
      <Spinner />
      <span>{label}…</span>
    </div>
  );
}

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-ui border border-line bg-surface", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type Tone = "neutral" | "brand" | "good" | "warn" | "bad";

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "neutral" && "bg-surface-2 text-muted",
        tone === "brand" && "bg-brand-soft text-brand-ink",
        tone === "good" && "bg-good-soft text-good",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "bad" && "bg-bad-soft text-bad",
        className,
      )}
    >
      {children}
    </span>
  );
}

const alertIcons = { info: Info, good: CheckCircle2, warn: AlertTriangle, bad: XCircle };

export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "good" | "warn" | "bad";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = alertIcons[tone];
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-ui border px-4 py-3 text-sm",
        tone === "info" && "border-line bg-surface-2 text-fg",
        tone === "good" && "border-good/30 bg-good-soft text-fg",
        tone === "warn" && "border-warn/30 bg-warn-soft text-fg",
        tone === "bad" && "border-bad/30 bg-bad-soft text-fg",
        className,
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "info" && "text-muted",
          tone === "good" && "text-good",
          tone === "warn" && "text-warn",
          tone === "bad" && "text-bad",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title ? "mt-0.5" : "", "text-fg/90")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon ? <div className="mb-3 text-muted">{icon}</div> : null}
      <h3 className="text-base font-semibold">{title}</h3>
      {children ? <div className="mt-1 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-ui border border-line bg-surface px-4 py-3.5">
      <div className="eyebrow">{label}</div>
      <div
        className={cn(
          "mt-1 font-display text-2xl font-semibold tabular",
          tone === "good" && "text-good",
          tone === "warn" && "text-warn",
          tone === "bad" && "text-bad",
          tone === "brand" && "text-brand-ink",
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[13px] text-muted">{sub}</div> : null}
    </div>
  );
}

/** Horizontally scrollable table wrapper so wide tables never widen the page. */
export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function TH({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-line bg-surface-2 px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TD({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("border-b border-line px-3 py-2.5 align-top", className)} {...rest}>
      {children}
    </td>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-ui bg-surface-2", className)} />;
}

export function ProgressBar({ value, tone = "brand", label }: { value: number; tone?: Tone; label?: string }) {
  const pctValue = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
      aria-valuenow={Math.round(pctValue)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          tone === "brand" && "bg-brand",
          tone === "good" && "bg-good",
          tone === "warn" && "bg-warn",
          tone === "bad" && "bg-bad",
          tone === "neutral" && "bg-muted",
        )}
        style={{ width: `${pctValue}%` }}
      />
    </div>
  );
}
