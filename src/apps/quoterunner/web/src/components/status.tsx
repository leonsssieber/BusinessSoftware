import { Badge, type Tone } from "@ui/components/display";
import { cn } from "@ui/cn";
import type { InvitationStatus, RfqStatus } from "../../../shared/types";

const RFQ: Record<RfqStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  open: { label: "Collecting quotes", tone: "brand" },
  awarded: { label: "Awarded", tone: "good" },
  closed: { label: "Closed", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export function RfqStatusBadge({ status }: { status: RfqStatus }) {
  const s = RFQ[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const INV: Record<InvitationStatus, { label: string; tone: Tone }> = {
  pending: { label: "Not sent", tone: "neutral" },
  sent: { label: "Sent", tone: "neutral" },
  viewed: { label: "Opened", tone: "warn" },
  quoted: { label: "Quoted", tone: "good" },
  declined: { label: "Declined", tone: "bad" },
};

export function InvitationBadge({ status }: { status: InvitationStatus }) {
  const s = INV[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** "3 of 4 answered" as a segmented bar: quoted, declined, waiting. */
export function ResponseMeter({ invited, responded, quoted }: { invited: number; responded: number; quoted: number }) {
  if (!invited) return <span className="text-sm text-muted">No suppliers yet</span>;
  const declined = responded - quoted;
  return (
    <div className="flex min-w-32 flex-col gap-1">
      <div className="flex h-1.5 gap-0.5" aria-hidden="true">
        {Array.from({ length: invited }).map((_, i) => (
          <span
            key={i}
            className={cn("h-full flex-1 rounded-full", i < quoted ? "bg-good" : i < quoted + declined ? "bg-bad/60" : "bg-line-strong")}
          />
        ))}
      </div>
      <span className="text-xs text-muted tabular">
        {responded} of {invited} answered
      </span>
    </div>
  );
}
