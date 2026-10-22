import type { CoreContext, OrgRow } from "@core/server/context";
import { limitFor } from "@core/server/limits";
import { reminderEmail } from "./emails";
import { logActivity, portalUrl, type InvitationRow, type RfqRow, type SupplierRow } from "./repo";
import { rfqLabel } from "../shared/product";

const HOUR = 3_600_000;

/**
 * When to nudge a supplier who hasn't answered: once halfway to the due date (but no earlier
 * than a day before it), and a last call right after the due time passes.
 */
export function reminderDue(
  inv: Pick<InvitationRow, "status" | "sent_at" | "reminder_count" | "last_reminded_at">,
  rfq: Pick<RfqRow, "status" | "due_at">,
  now: Date,
): "first" | "final" | null {
  if (rfq.status !== "open" || !rfq.due_at || !inv.sent_at) return null;
  if (inv.status !== "sent" && inv.status !== "viewed") return null;
  const due = Date.parse(rfq.due_at);
  const sent = Date.parse(inv.sent_at);
  const t = now.getTime();
  if (due <= sent) return null;
  const firstAt = Math.max(sent + (due - sent) / 2, due - 24 * HOUR);
  if (inv.reminder_count === 0 && t >= firstAt && t < due) return "first";
  const sinceLast = inv.last_reminded_at ? t - Date.parse(inv.last_reminded_at) : Infinity;
  if (inv.reminder_count <= 1 && t >= due && t < due + 24 * HOUR && sinceLast >= 6 * HOUR) return "final";
  return null;
}

/** Background job: sends due reminders for organizations whose plan includes them. */
export async function sendDueReminders(ctx: CoreContext): Promise<number> {
  const now = ctx.now();
  const rows = ctx.db.all<InvitationRow & { rfq_status: RfqRow["status"]; due_at: string; org_id: string }>(
    `SELECT i.*, r.status AS rfq_status, r.due_at, r.org_id
       FROM invitations i JOIN rfqs r ON r.id = i.rfq_id
      WHERE r.status = 'open' AND r.due_at IS NOT NULL AND i.status IN ('sent', 'viewed') AND i.reminder_count < 2`,
  );
  let sent = 0;
  for (const inv of rows) {
    const kind = reminderDue(inv, { status: inv.rfq_status, due_at: inv.due_at }, now);
    if (!kind) continue;
    const org = ctx.db.get<OrgRow>("SELECT * FROM orgs WHERE id = ?", inv.org_id);
    if (!org || limitFor(ctx, org, "autoReminders") === 0) continue;
    const supplier = ctx.db.get<SupplierRow>("SELECT * FROM suppliers WHERE id = ?", inv.supplier_id);
    const rfq = ctx.db.get<RfqRow>("SELECT * FROM rfqs WHERE id = ?", inv.rfq_id);
    if (!supplier?.email || !rfq) continue;
    const mail = reminderEmail(ctx, { org, rfq, supplier, portalUrl: portalUrl(ctx, inv.token), final: kind === "final" });
    try {
      await ctx.mailer.send({ to: supplier.email, orgId: org.id, ...mail });
    } catch (err) {
      console.error(`[reminders] ${supplier.email}: ${(err as Error).message}`);
      continue;
    }
    ctx.db.run(
      "UPDATE invitations SET reminder_count = reminder_count + 1, last_reminded_at = ? WHERE id = ?",
      now.toISOString(),
      inv.id,
    );
    logActivity(ctx, org.id, rfq.id, "reminder", `Sent ${kind === "final" ? "a last-call" : "a"} reminder to ${supplier.name} for ${rfqLabel(rfq.number)}.`);
    sent++;
  }
  return sent;
}
