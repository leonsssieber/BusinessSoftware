import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv, CoreContext, OrgRow, UserRow } from "@core/server/context";
import { conflict, HttpError } from "@core/server/errors";
import { rateLimit } from "@core/server/ratelimit";
import { body } from "@core/server/validate";
import { rfqLabel } from "../../shared/product";
import type { PortalDto } from "../../shared/types";
import { quoteReceivedEmail } from "../emails";
import { companySettings, listItems, logActivity, quoteDtos, type InvitationRow, type RfqRow, type SupplierRow } from "../repo";
import { quoteSchema, saveQuote } from "./rfqs";

export interface Loaded {
  inv: InvitationRow;
  rfq: RfqRow;
  supplier: SupplierRow;
  org: OrgRow;
}

/** Finds the invitation, request, supplier and buyer organization behind a quote link token. */
export function loadByToken(ctx: CoreContext, token: string): Loaded {
  const inv = token.length >= 16 ? ctx.db.get<InvitationRow>("SELECT * FROM invitations WHERE token = ?", token) : undefined;
  if (!inv) throw new HttpError(404, "link_invalid", "This quote link isn't valid. Ask the buyer to send it again.");
  const rfq = ctx.db.get<RfqRow>("SELECT * FROM rfqs WHERE id = ?", inv.rfq_id)!;
  const supplier = ctx.db.get<SupplierRow>("SELECT * FROM suppliers WHERE id = ?", inv.supplier_id)!;
  const org = ctx.db.get<OrgRow>("SELECT * FROM orgs WHERE id = ?", rfq.org_id)!;
  return { inv, rfq, supplier, org };
}

const accepting = (rfq: RfqRow) => rfq.status === "open";

function portalDto(c: Context<AppEnv>, l: Loaded): PortalDto {
  const ctx = c.get("ctx");
  const settings = companySettings(l.org);
  const items = listItems(ctx, l.rfq.id);
  const [quote] = quoteDtos(ctx, l.rfq, l.supplier.id);
  return {
    company: { name: l.org.name, address: settings.companyAddress ?? null, phone: settings.companyPhone ?? null },
    supplier: { name: l.supplier.name, contactName: l.supplier.contact_name },
    rfq: {
      label: rfqLabel(l.rfq.number),
      title: l.rfq.title,
      jobName: l.rfq.job_name,
      siteAddress: l.rfq.site_address,
      needBy: l.rfq.need_by,
      dueAt: l.rfq.due_at,
      notes: l.rfq.notes,
      acceptingQuotes: accepting(l.rfq),
    },
    items: items.map((i) => ({
      id: i.id,
      description: i.description,
      qty: i.qty,
      unit: i.unit,
      partNumber: i.part_number,
      notes: i.notes,
      allowSubstitutes: Boolean(i.allow_substitutes),
    })),
    quote: quote ?? null,
    declined: l.inv.status === "declined",
  };
}

export async function notifyBuyer(ctx: CoreContext, l: Loaded, via: "portal" | "email") {
  const counts = ctx.db.get<{ total: number; done: number }>(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('quoted', 'declined') THEN 1 ELSE 0 END) AS done FROM invitations WHERE rfq_id = ?`,
    l.rfq.id,
  )!;
  const buyer = l.rfq.created_by ? ctx.db.get<UserRow>("SELECT * FROM users WHERE id = ?", l.rfq.created_by) : undefined;
  if (!buyer) return;
  const mail = quoteReceivedEmail(ctx, { rfq: l.rfq, supplierName: l.supplier.name, via, allIn: counts.total > 0 && counts.done === counts.total });
  try {
    await ctx.mailer.send({ to: buyer.email, orgId: l.org.id, ...mail });
  } catch (err) {
    console.error(`[portal] notify buyer failed: ${(err as Error).message}`);
  }
}

/** Public pages for suppliers. The random token in the link is the only credential. */
export function portalRoutes() {
  const r = new Hono<AppEnv>();
  const load = (c: Context<AppEnv>) => loadByToken(c.get("ctx"), c.req.param("token") ?? "");
  const limit = rateLimit({ bucket: "portal", limit: 60, windowMs: 60_000 });

  r.get("/:token", limit, (c) => {
    const ctx = c.get("ctx");
    const l = load(c);
    if (l.inv.status === "sent" || l.inv.status === "pending") {
      ctx.db.run("UPDATE invitations SET status = 'viewed', viewed_at = COALESCE(viewed_at, ?) WHERE id = ?", ctx.now().toISOString(), l.inv.id);
      if (!l.inv.viewed_at) logActivity(ctx, l.org.id, l.rfq.id, "viewed", `${l.supplier.name} opened the request.`);
    }
    return c.json(portalDto(c, l));
  });

  r.post("/:token/quote", rateLimit({ bucket: "portal-write", limit: 20, windowMs: 60_000 }), async (c) => {
    const l = load(c);
    if (!accepting(l.rfq)) throw conflict("This request is no longer taking quotes.");
    const input = await body(c, quoteSchema);
    const priced = input.lines.filter((x) => x.unitPrice !== null).length;
    if (!priced) throw new HttpError(400, "bad_request", "Enter a price for at least one item, or decline to quote.");
    saveQuote(c, l.org, l.rfq, l.supplier, input, "portal");
    await notifyBuyer(c.get("ctx"), l, "portal");
    return c.json(portalDto(c, load(c)));
  });

  r.post("/:token/decline", rateLimit({ bucket: "portal-write", limit: 20, windowMs: 60_000 }), async (c) => {
    const ctx = c.get("ctx");
    const l = load(c);
    if (!accepting(l.rfq)) throw conflict("This request is no longer taking quotes.");
    const { reason } = await body(c, z.object({ reason: z.string().trim().max(500).nullish() }));
    ctx.db.run(
      "UPDATE invitations SET status = 'declined', responded_at = ?, decline_reason = ? WHERE id = ?",
      ctx.now().toISOString(),
      reason || null,
      l.inv.id,
    );
    logActivity(ctx, l.org.id, l.rfq.id, "declined", `${l.supplier.name} declined to quote${reason ? `: "${reason}"` : "."}`);
    return c.json(portalDto(c, load(c)));
  });

  return r;
}

