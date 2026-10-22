import { Hono, type Context } from "hono";
import { z } from "zod";
import { currentOrg, currentUser, requireAuth } from "@core/server/auth";
import type { AppEnv, OrgRow } from "@core/server/context";
import { newId, randomToken } from "@core/server/crypto";
import { badRequest, conflict, notFound } from "@core/server/errors";
import { assertWithinLimit, limitFor, startOfMonth } from "@core/server/limits";
import { rateLimit } from "@core/server/ratelimit";
import { body } from "@core/server/validate";
import { evaluateAward } from "../../shared/domain/compare";
import { canonicalUnit, itemKey, round2 } from "../../shared/domain/text";
import { rfqLabel } from "../../shared/product";
import type { RfqSummaryDto } from "../../shared/types";
import { extractQuote, parseList } from "../ai";
import { notSelectedEmail, reminderEmail, rfqEmail } from "../emails";
import {
  companySettings,
  getRfqRow,
  getSupplierRow,
  listItems,
  logActivity,
  nextNumber,
  portalUrl,
  quoteDtos,
  recordQuotePrices,
  rfqDetail,
  rfqSummaries,
  today,
  type InvitationRow,
  type RfqRow,
  type SupplierRow,
} from "../repo";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.");
const isoDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Enter a valid date and time.");

const itemSchema = z.object({
  description: z.string().trim().min(1, "Describe the item.").max(500),
  qty: z.number().positive("Quantity must be more than zero.").max(10_000_000),
  unit: z.string().trim().min(1).max(20),
  partNumber: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(500).nullish(),
  allowSubstitutes: z.boolean().default(true),
});

const rfqSchema = z.object({
  title: z.string().trim().min(1, "Give the request a short title.").max(200),
  jobName: z.string().trim().max(200).nullish(),
  siteAddress: z.string().trim().max(300).nullish(),
  needBy: isoDate.nullish(),
  dueAt: isoDateTime.nullish(),
  notes: z.string().trim().max(4000).nullish(),
  items: z.array(itemSchema).min(1, "Add at least one item.").max(300, "A request can have up to 300 items."),
});

const quoteLineSchema = z.object({
  itemId: z.string().min(1),
  unitPrice: z.number().min(0).max(100_000_000).nullable(),
  leadDays: z.number().int().min(0).max(3650).nullable().default(null),
  substitute: z.string().trim().max(500).nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
});

export const quoteSchema = z.object({
  lines: z.array(quoteLineSchema).max(300),
  freight: z.number().min(0).max(10_000_000).default(0),
  tax: z.number().min(0).max(10_000_000).default(0),
  validUntil: isoDate.nullish(),
  notes: z.string().trim().max(4000).nullish(),
  contactName: z.string().trim().max(120).nullish(),
  reference: z.string().trim().max(120).nullish(),
});

function insertItems(c: Context<AppEnv>, rfqId: string, items: z.infer<typeof itemSchema>[]) {
  const ctx = c.get("ctx");
  items.forEach((it, i) => {
    ctx.db.run(
      `INSERT INTO rfq_items (id, rfq_id, position, description, qty, unit, part_number, notes, allow_substitutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("itm"),
      rfqId,
      i + 1,
      it.description,
      it.qty,
      canonicalUnit(it.unit) ?? it.unit.toLowerCase(),
      it.partNumber || null,
      it.notes || null,
      it.allowSubstitutes,
    );
  });
}

function detail(c: Context<AppEnv>, org: OrgRow, id: string) {
  const ctx = c.get("ctx");
  return rfqDetail(ctx, org, id, {
    excludeLate: c.req.query("excludeLate") === "1",
    allowSubstitutes: c.req.query("subs") !== "0",
    withLastPaid: limitFor(ctx, org, "priceHistory") !== 0,
  });
}

/** Saves a supplier's quote (from the portal, an import, or manual entry) and updates the invitation. */
export function saveQuote(
  c: Context<AppEnv>,
  org: OrgRow,
  rfq: RfqRow,
  supplier: SupplierRow,
  input: z.infer<typeof quoteSchema>,
  source: "portal" | "email" | "manual",
  opts: { status?: "submitted" | "needs_review"; rawText?: string | null } = {},
) {
  const ctx = c.get("ctx");
  const items = listItems(ctx, rfq.id);
  const itemIds = new Set(items.map((i) => i.id));
  const lines = input.lines.filter((l) => itemIds.has(l.itemId));
  const now = ctx.now().toISOString();
  ctx.db.tx(() => {
    const existing = ctx.db.get<{ id: string }>("SELECT id FROM quotes WHERE rfq_id = ? AND supplier_id = ?", rfq.id, supplier.id);
    const quoteId = existing?.id ?? newId("quo");
    if (existing) {
      ctx.db.run(
        `UPDATE quotes SET source = ?, status = ?, freight = ?, tax = ?, valid_until = ?, notes = ?, contact_name = ?, reference = ?,
           received_at = ?, raw_text = COALESCE(?, raw_text) WHERE id = ?`,
        source,
        opts.status ?? "submitted",
        input.freight,
        input.tax,
        input.validUntil ?? null,
        input.notes || null,
        input.contactName || null,
        input.reference || null,
        now,
        opts.rawText ?? null,
        quoteId,
      );
      ctx.db.run("DELETE FROM quote_lines WHERE quote_id = ?", quoteId);
    } else {
      ctx.db.run(
        `INSERT INTO quotes (id, rfq_id, supplier_id, source, status, freight, tax, valid_until, notes, contact_name, reference, received_at, raw_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        quoteId,
        rfq.id,
        supplier.id,
        source,
        opts.status ?? "submitted",
        input.freight,
        input.tax,
        input.validUntil ?? null,
        input.notes || null,
        input.contactName || null,
        input.reference || null,
        now,
        opts.rawText ?? null,
      );
    }
    for (const l of lines) {
      ctx.db.run(
        "INSERT INTO quote_lines (quote_id, item_id, unit_price, lead_days, substitute, note) VALUES (?, ?, ?, ?, ?, ?)",
        quoteId,
        l.itemId,
        l.unitPrice,
        l.leadDays,
        l.substitute || null,
        l.note || null,
      );
    }
    const inv = ctx.db.get<InvitationRow>("SELECT * FROM invitations WHERE rfq_id = ? AND supplier_id = ?", rfq.id, supplier.id);
    if (inv) {
      ctx.db.run("UPDATE invitations SET status = 'quoted', responded_at = ? WHERE id = ?", now, inv.id);
    } else {
      ctx.db.run(
        `INSERT INTO invitations (id, rfq_id, supplier_id, token, status, responded_at) VALUES (?, ?, ?, ?, 'quoted', ?)`,
        newId("inv"),
        rfq.id,
        supplier.id,
        randomToken(24),
        now,
      );
    }
    recordQuotePrices(ctx, org.id, rfq.id, supplier.id, items, lines);
    const priced = lines.filter((l) => l.unitPrice !== null).length;
    const how = source === "portal" ? "entered prices online" : source === "email" ? "replied by email" : "quote was entered";
    logActivity(ctx, org.id, rfq.id, "quote", `${supplier.name} ${how} (${priced} of ${items.length} items priced).`);
  });
}

export function rfqRoutes() {
  const r = new Hono<AppEnv>();
  r.use("*", requireAuth);

  r.get("/", (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const status = c.req.query("status");
    const rows = ctx.db.all<RfqRow>(
      `SELECT * FROM rfqs WHERE org_id = ? ${status && status !== "all" ? "AND status = ?" : ""} ORDER BY number DESC LIMIT 200`,
      ...(status && status !== "all" ? [org.id, status] : [org.id]),
    );
    return c.json(rfqSummaries(ctx, rows) satisfies RfqSummaryDto[]);
  });

  r.post("/parse-list", rateLimit({ bucket: "qr-parse", limit: 30, windowMs: 60_000 }), async (c) => {
    const org = currentOrg(c);
    const { text } = await body(c, z.object({ text: z.string().min(1, "Paste your list first.").max(30_000) }));
    return c.json(await parseList(c, org, text));
  });

  r.post("/", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const user = currentUser(c);
    const input = await body(c, rfqSchema);
    const used = ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM rfqs WHERE org_id = ? AND created_at >= ?",
      org.id,
      startOfMonth(ctx.now()).toISOString(),
    )!.n;
    assertWithinLimit(c, org, "rfqsPerMonth", used);
    const id = newId("rfq");
    ctx.db.tx(() => {
      const number = nextNumber(ctx, "rfqs", org.id);
      ctx.db.run(
        `INSERT INTO rfqs (id, org_id, number, title, job_name, site_address, need_by, due_at, notes, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
        id,
        org.id,
        number,
        input.title,
        input.jobName || null,
        input.siteAddress || null,
        input.needBy ?? null,
        input.dueAt ? new Date(input.dueAt).toISOString() : null,
        input.notes || null,
        user.id,
        ctx.now().toISOString(),
      );
      insertItems(c, id, input.items);
      logActivity(ctx, org.id, id, "created", `${user.name} created ${rfqLabel(number)} with ${input.items.length} items.`);
    });
    return c.json(detail(c, org, id), 201);
  });

  r.get("/:id", (c) => c.json(detail(c, currentOrg(c), c.req.param("id"))));

  r.patch("/:id", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    const input = await body(c, rfqSchema.partial());
    if (input.items) {
      const hasQuotes = ctx.db.get("SELECT 1 FROM quotes WHERE rfq_id = ? LIMIT 1", rfq.id);
      if (hasQuotes) throw conflict("Items can't change after quotes arrive. Copy this request into a new one instead.");
    }
    if (rfq.status === "awarded" || rfq.status === "cancelled") throw conflict("This request is closed and can't be edited.");
    ctx.db.tx(() => {
      ctx.db.run(
        `UPDATE rfqs SET title = ?, job_name = ?, site_address = ?, need_by = ?, due_at = ?, notes = ? WHERE id = ?`,
        input.title ?? rfq.title,
        input.jobName !== undefined ? input.jobName || null : rfq.job_name,
        input.siteAddress !== undefined ? input.siteAddress || null : rfq.site_address,
        input.needBy !== undefined ? input.needBy ?? null : rfq.need_by,
        input.dueAt !== undefined ? (input.dueAt ? new Date(input.dueAt).toISOString() : null) : rfq.due_at,
        input.notes !== undefined ? input.notes || null : rfq.notes,
        rfq.id,
      );
      if (input.items) {
        ctx.db.run("DELETE FROM rfq_items WHERE rfq_id = ?", rfq.id);
        insertItems(c, rfq.id, input.items);
      }
    });
    return c.json(detail(c, org, rfq.id));
  });

  r.post("/:id/status", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    const { status } = await body(c, z.object({ status: z.enum(["open", "closed", "cancelled"]) }));
    if (rfq.status === "awarded" && status !== "closed") throw conflict("Cancel its purchase orders before reopening an awarded request.");
    if (status === "open" && !rfq.sent_at) throw badRequest("Send the request to suppliers to open it.");
    ctx.db.run("UPDATE rfqs SET status = ? WHERE id = ?", status, rfq.id);
    logActivity(ctx, org.id, rfq.id, "status", `${currentUser(c).name} marked the request ${status}.`);
    return c.json(detail(c, org, rfq.id));
  });

  r.post("/:id/duplicate", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const user = currentUser(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    const used = ctx.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM rfqs WHERE org_id = ? AND created_at >= ?",
      org.id,
      startOfMonth(ctx.now()).toISOString(),
    )!.n;
    assertWithinLimit(c, org, "rfqsPerMonth", used);
    const items = listItems(ctx, rfq.id);
    const id = newId("rfq");
    ctx.db.tx(() => {
      const number = nextNumber(ctx, "rfqs", org.id);
      ctx.db.run(
        `INSERT INTO rfqs (id, org_id, number, title, job_name, site_address, notes, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
        id,
        org.id,
        number,
        `${rfq.title} (copy)`,
        rfq.job_name,
        rfq.site_address,
        rfq.notes,
        user.id,
        ctx.now().toISOString(),
      );
      insertItems(
        c,
        id,
        items.map((i) => ({ description: i.description, qty: i.qty, unit: i.unit, partNumber: i.part_number, notes: i.notes, allowSubstitutes: Boolean(i.allow_substitutes) })),
      );
      logActivity(ctx, org.id, id, "created", `${user.name} copied ${rfqLabel(rfq.number)} into ${rfqLabel(number)}.`);
    });
    return c.json(detail(c, org, id), 201);
  });

  r.delete("/:id", (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    if (rfq.status !== "draft") throw conflict("Only drafts can be deleted. Cancel the request instead.");
    ctx.db.run("DELETE FROM rfqs WHERE id = ?", rfq.id);
    return c.json({ ok: true });
  });

  /** Adds suppliers to the request without emailing them yet. */
  r.post("/:id/invitations", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    if (rfq.status === "awarded" || rfq.status === "cancelled" || rfq.status === "closed") throw conflict("This request is closed.");
    const { supplierIds } = await body(c, z.object({ supplierIds: z.array(z.string().min(1)).min(1).max(100) }));
    const existing = ctx.db.all<{ supplier_id: string }>("SELECT supplier_id FROM invitations WHERE rfq_id = ?", rfq.id).map((x) => x.supplier_id);
    const fresh = [...new Set(supplierIds)].filter((id) => !existing.includes(id));
    if (fresh.length) {
      const limit = limitFor(ctx, org, "suppliersPerRfq");
      if (limit !== null && existing.length + fresh.length > limit) {
        assertWithinLimit(c, org, "suppliersPerRfq", existing.length + fresh.length - 1);
      }
    }
    ctx.db.tx(() => {
      for (const sid of fresh) {
        getSupplierRow(ctx, org.id, sid);
        ctx.db.run(
          "INSERT INTO invitations (id, rfq_id, supplier_id, token, status) VALUES (?, ?, ?, ?, 'pending')",
          newId("inv"),
          rfq.id,
          sid,
          randomToken(24),
        );
      }
    });
    return c.json(detail(c, org, rfq.id));
  });

  r.delete("/:id/invitations/:invitationId", (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    const inv = ctx.db.get<InvitationRow>("SELECT * FROM invitations WHERE id = ? AND rfq_id = ?", c.req.param("invitationId"), rfq.id);
    if (!inv) throw notFound("Invitation not found.");
    if (ctx.db.get("SELECT 1 FROM quotes WHERE rfq_id = ? AND supplier_id = ?", rfq.id, inv.supplier_id)) {
      throw conflict("This supplier already quoted. Delete the quote first.");
    }
    ctx.db.run("DELETE FROM invitations WHERE id = ?", inv.id);
    return c.json(detail(c, org, rfq.id));
  });

  /** Emails the request to invited suppliers that haven't received it (or to the ones listed). */
  r.post("/:id/send", rateLimit({ bucket: "qr-send", limit: 30, windowMs: 60_000 }), async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const user = currentUser(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    if (rfq.status === "awarded" || rfq.status === "cancelled" || rfq.status === "closed") throw conflict("This request is closed.");
    const input = await body(c, z.object({ invitationIds: z.array(z.string()).optional(), message: z.string().trim().max(2000).nullish() }));
    const items = listItems(ctx, rfq.id);
    if (!items.length) throw badRequest("Add items before sending.");
    const invitations = ctx.db
      .all<InvitationRow>("SELECT * FROM invitations WHERE rfq_id = ?", rfq.id)
      .filter((i) => (input.invitationIds ? input.invitationIds.includes(i.id) : i.status === "pending"));
    if (!invitations.length) throw badRequest("Pick at least one supplier to send to.");

    const now = ctx.now();
    let dueAt = rfq.due_at;
    if (!dueAt) {
      const days = companySettings(org).defaultQuoteDays ?? 3;
      const d = new Date(now.getTime() + days * 86_400_000);
      d.setUTCHours(21, 0, 0, 0);
      dueAt = d.toISOString();
    }
    ctx.db.run(
      "UPDATE rfqs SET status = 'open', due_at = ?, sent_at = COALESCE(sent_at, ?) WHERE id = ?",
      dueAt,
      now.toISOString(),
      rfq.id,
    );
    const fresh = { ...rfq, due_at: dueAt, status: "open" as const };

    const sent: string[] = [];
    const manual: { supplierName: string; portalUrl: string }[] = [];
    for (const inv of invitations) {
      const supplier = ctx.db.get<SupplierRow>("SELECT * FROM suppliers WHERE id = ?", inv.supplier_id)!;
      const url = portalUrl(ctx, inv.token);
      if (supplier.email) {
        const replyTo = ctx.env.inboundEmailDomain ? `quotes+${inv.token}@${ctx.env.inboundEmailDomain}` : null;
        const mail = rfqEmail(ctx, { org, rfq: fresh, items, supplier, portalUrl: url, message: input.message, replyTo });
        await ctx.mailer.send({ to: supplier.email, orgId: org.id, replyTo: replyTo ?? user.email, ...mail });
        sent.push(supplier.name);
      } else {
        manual.push({ supplierName: supplier.name, portalUrl: url });
      }
      ctx.db.run(
        "UPDATE invitations SET status = CASE WHEN status = 'pending' THEN 'sent' ELSE status END, sent_at = COALESCE(sent_at, ?) WHERE id = ?",
        now.toISOString(),
        inv.id,
      );
    }
    if (sent.length) logActivity(ctx, org.id, rfq.id, "sent", `${user.name} emailed the request to ${sent.join(", ")}.`);
    if (manual.length) logActivity(ctx, org.id, rfq.id, "sent", `Quote links ready for ${manual.map((m) => m.supplierName).join(", ")} (no email on file).`);
    return c.json({ sent: sent.length, manual, rfq: detail(c, org, rfq.id) });
  });

  r.post("/:id/remind", rateLimit({ bucket: "qr-remind", limit: 10, windowMs: 60_000 }), async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    if (rfq.status !== "open") throw conflict("Only open requests can send reminders.");
    const waiting = ctx.db.all<InvitationRow & { name: string; email: string | null }>(
      `SELECT i.*, s.name, s.email FROM invitations i JOIN suppliers s ON s.id = i.supplier_id
        WHERE i.rfq_id = ? AND i.status IN ('sent', 'viewed')`,
      rfq.id,
    );
    const now = ctx.now().toISOString();
    const reminded: string[] = [];
    for (const inv of waiting) {
      if (!inv.email) continue;
      const supplier = ctx.db.get<SupplierRow>("SELECT * FROM suppliers WHERE id = ?", inv.supplier_id)!;
      const mail = reminderEmail(ctx, { org, rfq, supplier, portalUrl: portalUrl(ctx, inv.token), final: false });
      await ctx.mailer.send({ to: inv.email, orgId: org.id, ...mail });
      ctx.db.run("UPDATE invitations SET reminder_count = reminder_count + 1, last_reminded_at = ? WHERE id = ?", now, inv.id);
      reminded.push(inv.name);
    }
    if (reminded.length) logActivity(ctx, org.id, rfq.id, "reminder", `${currentUser(c).name} reminded ${reminded.join(", ")}.`);
    return c.json({ reminded: reminded.length, rfq: detail(c, org, rfq.id) });
  });

  /** Reads a supplier's quote from pasted text or a PDF and returns a draft for review. Nothing is saved. */
  r.post("/:id/extract", rateLimit({ bucket: "qr-extract", limit: 20, windowMs: 60_000 }), async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    const input = await body(
      c,
      z
        .object({ text: z.string().max(60_000).nullish(), pdfBase64: z.string().max(14_000_000).nullish() })
        .refine((v) => Boolean(v.text?.trim() || v.pdfBase64), "Paste the quote or attach a PDF."),
    );
    const extracted = await extractQuote(c, org, { text: input.text, pdfBase64: input.pdfBase64, items: listItems(ctx, rfq.id), today: today(ctx) });
    return c.json({ ...extracted, aiAvailable: ctx.ai.available });
  });

  r.put("/:id/quotes/:supplierId", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    if (rfq.status === "cancelled") throw conflict("This request was cancelled.");
    const supplier = getSupplierRow(ctx, org.id, c.req.param("supplierId"));
    const input = await body(c, quoteSchema.extend({ source: z.enum(["manual", "email"]).default("manual"), rawText: z.string().max(60_000).nullish() }));
    saveQuote(c, org, rfq, supplier, input, input.source, { rawText: input.rawText });
    return c.json(detail(c, org, rfq.id));
  });

  r.post("/:id/quotes/:supplierId/approve", (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    const res = ctx.db.run("UPDATE quotes SET status = 'submitted' WHERE rfq_id = ? AND supplier_id = ?", rfq.id, c.req.param("supplierId"));
    if (!res.changes) throw notFound("Quote not found.");
    return c.json(detail(c, org, rfq.id));
  });

  r.delete("/:id/quotes/:supplierId", (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    if (rfq.status === "awarded") throw conflict("Cancel the purchase orders before deleting quotes.");
    const supplierId = c.req.param("supplierId");
    ctx.db.tx(() => {
      ctx.db.run("DELETE FROM quotes WHERE rfq_id = ? AND supplier_id = ?", rfq.id, supplierId);
      ctx.db.run("DELETE FROM price_history WHERE rfq_id = ? AND supplier_id = ? AND awarded = 0", rfq.id, supplierId);
      ctx.db.run(
        "UPDATE invitations SET status = CASE WHEN sent_at IS NULL THEN 'pending' ELSE 'sent' END, responded_at = NULL WHERE rfq_id = ? AND supplier_id = ?",
        rfq.id,
        supplierId,
      );
    });
    return c.json(detail(c, org, rfq.id));
  });

  /** Awards lines to suppliers and creates one draft purchase order per winning supplier. */
  r.post("/:id/award", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const user = currentUser(c);
    const rfq = getRfqRow(ctx, org.id, c.req.param("id"));
    if (rfq.status === "awarded") throw conflict("This request was already awarded. Cancel its purchase orders to award again.");
    if (rfq.status === "cancelled") throw conflict("This request was cancelled.");
    const input = await body(
      c,
      z.object({
        assignments: z.record(z.string(), z.string()),
        notifyOthers: z.boolean().default(false),
        notes: z.string().trim().max(2000).nullish(),
      }),
    );
    const items = listItems(ctx, rfq.id);
    const quotes = quoteDtos(ctx, rfq);
    const compareItems = items.map((i) => ({ id: i.id, description: i.description, qty: i.qty, unit: i.unit, allowSubstitutes: Boolean(i.allow_substitutes) }));
    const award = evaluateAward(compareItems, quotes, input.assignments);
    if (!Object.keys(award.assignments).length) throw badRequest("Choose a supplier for at least one item.");
    const unknown = Object.keys(input.assignments).filter((id) => !items.some((i) => i.id === id));
    if (unknown.length) throw badRequest("Some awarded items aren't on this request.");

    const now = ctx.now().toISOString();
    const created: string[] = [];
    ctx.db.tx(() => {
      for (const supplierId of award.suppliers) {
        const quote = quotes.find((q) => q.supplierId === supplierId)!;
        const lines = items
          .filter((i) => award.assignments[i.id] === supplierId)
          .map((i) => {
            const bid = quote.lines.find((l) => l.itemId === i.id)!;
            return { item: i, unitPrice: bid.unitPrice!, substitute: bid.substitute };
          });
        const subtotal = round2(lines.reduce((s, l) => s + round2(l.unitPrice * l.item.qty), 0));
        const freight = quote.freight;
        const poId = newId("po");
        const number = nextNumber(ctx, "purchase_orders", org.id);
        ctx.db.run(
          `INSERT INTO purchase_orders (id, org_id, rfq_id, supplier_id, number, status, subtotal, freight, total, notes, created_at)
           VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
          poId,
          org.id,
          rfq.id,
          supplierId,
          number,
          subtotal,
          freight,
          round2(subtotal + freight),
          input.notes || null,
          now,
        );
        for (const l of lines) {
          ctx.db.run(
            "INSERT INTO po_lines (po_id, item_id, description, qty, unit, unit_price, substitute) VALUES (?, ?, ?, ?, ?, ?, ?)",
            poId,
            l.item.id,
            l.item.description,
            l.item.qty,
            l.item.unit,
            l.unitPrice,
            l.substitute,
          );
          ctx.db.run(
            `INSERT INTO price_history (org_id, item_key, description, unit, unit_price, supplier_id, rfq_id, awarded, observed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            org.id,
            itemKey(l.item.description, l.item.part_number),
            l.item.description,
            l.item.unit,
            l.unitPrice,
            supplierId,
            rfq.id,
            now,
          );
        }
        created.push(quote.supplierName);
      }
      ctx.db.run("UPDATE rfqs SET status = 'awarded', awarded_at = ? WHERE id = ?", now, rfq.id);
      logActivity(
        ctx,
        org.id,
        rfq.id,
        "awarded",
        `${user.name} awarded ${rfqLabel(rfq.number)} to ${created.join(" and ")} for ${award.total.toLocaleString("en-US", { style: "currency", currency: "USD" })}.`,
      );
    });

    if (input.notifyOthers) {
      const losers = quotes.filter((q) => !award.suppliers.includes(q.supplierId));
      for (const q of losers) {
        const supplier = ctx.db.get<SupplierRow>("SELECT * FROM suppliers WHERE id = ?", q.supplierId)!;
        if (!supplier.email) continue;
        await ctx.mailer.send({ to: supplier.email, orgId: org.id, ...notSelectedEmail(ctx, { org, rfq, supplier }) });
      }
    }
    return c.json(detail(c, org, rfq.id));
  });

  return r;
}

