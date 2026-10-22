import { Hono } from "hono";
import { z } from "zod";
import { currentOrg, requireAuth } from "@core/server/auth";
import type { AppEnv, CoreContext, OrgRow } from "@core/server/context";
import { safeEqual } from "@core/server/crypto";
import { notFound } from "@core/server/errors";
import { assertFeature, startOfMonth } from "@core/server/limits";
import { rateLimit } from "@core/server/ratelimit";
import { body } from "@core/server/validate";
import { savingsAgainstAverage } from "../../shared/domain/compare";
import { parseItemList } from "../../shared/domain/parse";
import { round2 } from "../../shared/domain/text";
import { rfqLabel } from "../../shared/product";
import type { DashboardDto, PriceRowDto } from "../../shared/types";
import { extractQuote } from "../ai";
import { buildComparison, listItems, logActivity, quoteDtos, rfqSummaries, today, type RfqRow } from "../repo";
import { loadByToken, notifyBuyer } from "./portal";
import { saveQuote } from "./rfqs";

/** What an award saved versus the average complete quote (freight included), never below zero. */
export function awardSavings(ctx: CoreContext, rfq: RfqRow): number {
  const items = listItems(ctx, rfq.id);
  const quotes = quoteDtos(ctx, rfq);
  const comparison = buildComparison(ctx, rfq, items, quotes);
  const lines = ctx.db.all<{ item_id: string; unit_price: number }>(
    `SELECT pl.item_id, pl.unit_price FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id WHERE po.rfq_id = ?`,
    rfq.id,
  );
  const total = ctx.db.get<{ t: number | null }>("SELECT SUM(total) AS t FROM purchase_orders WHERE rfq_id = ?", rfq.id)?.t ?? 0;
  const saved = savingsAgainstAverage(
    items.map((i) => ({ id: i.id, description: i.description, qty: i.qty, unit: i.unit, allowSubstitutes: Boolean(i.allow_substitutes) })),
    comparison.rows,
    comparison.suppliers,
    Object.fromEntries(lines.map((l) => [l.item_id, l.unit_price])),
    total,
  );
  return round2(Math.max(0, saved ?? 0));
}

function dashboard(ctx: CoreContext, org: OrgRow): DashboardDto {
  const monthStart = startOfMonth(ctx.now()).toISOString();
  const count = (sql: string, ...p: string[]) => ctx.db.get<{ n: number }>(sql, ...p)?.n ?? 0;
  const awarded = ctx.db.all<RfqRow>("SELECT * FROM rfqs WHERE org_id = ? AND status = 'awarded' AND awarded_at >= ?", org.id, monthStart);
  const avg = ctx.db.get<{ h: number | null }>(
    `SELECT AVG((julianday(i.responded_at) - julianday(i.sent_at)) * 24) AS h
       FROM invitations i JOIN rfqs r ON r.id = i.rfq_id
      WHERE r.org_id = ? AND i.responded_at IS NOT NULL AND i.sent_at IS NOT NULL AND i.responded_at >= ?`,
    org.id,
    new Date(ctx.now().getTime() - 90 * 86_400_000).toISOString(),
  )?.h;

  const openRows = ctx.db.all<RfqRow>("SELECT * FROM rfqs WHERE org_id = ? AND status = 'open' ORDER BY due_at", org.id);
  const open = rfqSummaries(ctx, openRows);
  const attention: DashboardDto["attention"] = [];
  const now = ctx.now().toISOString();
  for (const s of open) {
    if (s.needsReview) {
      attention.push({ kind: "review", rfqId: s.id, label: s.label, message: `Check ${s.needsReview === 1 ? "a quote" : `${s.needsReview} quotes`} read from email before awarding.` });
    }
    if (s.invited > 0 && s.responded === s.invited && s.quoted > 0) {
      attention.push({ kind: "ready", rfqId: s.id, label: s.label, message: `All ${s.invited} suppliers answered. Compare and award.` });
    } else if (s.dueAt && s.dueAt < now && s.responded < s.invited) {
      attention.push({ kind: "overdue", rfqId: s.id, label: s.label, message: `Due date passed with ${s.responded} of ${s.invited} answers.` });
    }
  }
  const drafts = ctx.db.all<RfqRow>(
    "SELECT * FROM rfqs WHERE org_id = ? AND status = 'draft' AND created_at < ? ORDER BY created_at",
    org.id,
    new Date(ctx.now().getTime() - 86_400_000).toISOString(),
  );
  for (const d of drafts.slice(0, 3)) {
    attention.push({ kind: "draft", rfqId: d.id, label: rfqLabel(d.number), message: `"${d.title}" hasn't been sent to suppliers yet.` });
  }

  const activity = ctx.db
    .all<{ kind: string; message: string; created_at: string; rfq_id: string | null; number: number | null }>(
      `SELECT a.kind, a.message, a.created_at, a.rfq_id, r.number FROM activity a LEFT JOIN rfqs r ON r.id = a.rfq_id
        WHERE a.org_id = ? ORDER BY a.id DESC LIMIT 15`,
      org.id,
    )
    .map((a) => ({ kind: a.kind, message: a.message, createdAt: a.created_at, rfqId: a.rfq_id, rfqLabel: a.number ? rfqLabel(a.number) : null }));

  return {
    stats: {
      openRequests: openRows.length,
      waitingOnSuppliers: count(
        `SELECT COUNT(*) AS n FROM invitations i JOIN rfqs r ON r.id = i.rfq_id WHERE r.org_id = ? AND r.status = 'open' AND i.status IN ('sent', 'viewed')`,
        org.id,
      ),
      quotesThisMonth: count(
        `SELECT COUNT(*) AS n FROM quotes q JOIN rfqs r ON r.id = q.rfq_id WHERE r.org_id = ? AND q.received_at >= ?`,
        org.id,
        monthStart,
      ),
      savedThisMonth: round2(awarded.reduce((sum, rfq) => sum + awardSavings(ctx, rfq), 0)),
      avgResponseHours: avg == null ? null : Math.round(avg * 10) / 10,
    },
    attention,
    open,
    activity,
  };
}

function priceRows(ctx: CoreContext, org: OrgRow, q: string | undefined): PriceRowDto[] {
  const rows = ctx.db.all<{ item_key: string; description: string; unit: string; unit_price: number; awarded: number; observed_at: string; supplier_name: string | null }>(
    `SELECT ph.item_key, ph.description, ph.unit, ph.unit_price, ph.awarded, ph.observed_at, s.name AS supplier_name
       FROM price_history ph LEFT JOIN suppliers s ON s.id = ph.supplier_id
      WHERE ph.org_id = ? ${q ? "AND ph.description LIKE ?" : ""}
      ORDER BY ph.observed_at DESC LIMIT 5000`,
    ...(q ? [org.id, `%${q}%`] : [org.id]),
  );
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = groups.get(row.item_key) ?? [];
    list.push(row);
    groups.set(row.item_key, list);
  }
  const yearAgo = new Date(ctx.now().getTime() - 365 * 86_400_000).toISOString();
  return [...groups.entries()]
    .map(([key, list]) => {
      const paid = list.find((x) => x.awarded);
      const recent = list.filter((x) => x.observed_at >= yearAgo);
      const low = recent.reduce<(typeof list)[number] | null>((m, x) => (!m || x.unit_price < m.unit_price ? x : m), null);
      return {
        itemKey: key,
        description: list[0].description,
        unit: list[0].unit,
        lastPaid: paid ? { unitPrice: paid.unit_price, supplierName: paid.supplier_name, date: paid.observed_at.slice(0, 10) } : null,
        lowest: low ? { unitPrice: low.unit_price, supplierName: low.supplier_name, date: low.observed_at.slice(0, 10) } : null,
        observations: list.length,
        history: list
          .slice(0, 24)
          .reverse()
          .map((x) => ({ unitPrice: x.unit_price, date: x.observed_at.slice(0, 10), awarded: Boolean(x.awarded), supplierName: x.supplier_name })),
      };
    })
    .sort((a, b) => b.observations - a.observations || a.description.localeCompare(b.description))
    .slice(0, 300);
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "  ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#36;/g, "$")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

/** Drops the quoted original message so only the supplier's reply is read. */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*On .{3,120}wrote:\s*$/i.test(line) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^\s*From:\s.+@/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

const inboundSchema = z
  .object({
    From: z.string().optional(),
    To: z.string().optional(),
    Cc: z.string().optional(),
    Subject: z.string().optional(),
    TextBody: z.string().optional(),
    HtmlBody: z.string().optional(),
    Attachments: z.array(z.object({ Name: z.string().optional(), Content: z.string(), ContentType: z.string().optional() })).optional(),
    from: z.string().optional(),
    to: z.union([z.string(), z.array(z.string())]).optional(),
    cc: z.union([z.string(), z.array(z.string())]).optional(),
    subject: z.string().optional(),
    text: z.string().optional(),
    html: z.string().optional(),
    attachments: z.array(z.object({ filename: z.string().optional(), content: z.string(), contentType: z.string().optional() })).optional(),
  })
  .passthrough();

export function miscRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/dashboard", requireAuth, (c) => c.json(dashboard(c.get("ctx"), currentOrg(c))));

  r.get("/prices", requireAuth, (c) => {
    const org = currentOrg(c);
    assertFeature(c, org, "priceHistory");
    const q = c.req.query("q")?.trim().slice(0, 100) || undefined;
    return c.json(priceRows(c.get("ctx"), org, q));
  });

  /** Free tool on the public site: tidies a material list without an account. */
  r.post("/tools/parse-list", rateLimit({ bucket: "tool-parse", limit: 20, windowMs: 60_000 }), async (c) => {
    const { text } = await body(c, z.object({ text: z.string().min(1, "Paste your list first.").max(20_000) }));
    return c.json({ items: parseItemList(text).slice(0, 300), method: "heuristic" });
  });

  /**
   * Inbound email webhook (Postmark's inbound JSON or a generic {from,to,subject,text,html,attachments}).
   * Suppliers reply to quotes+<token>@INBOUND_EMAIL_DOMAIN; the token routes the reply to its request.
   */
  r.post("/inbound/email", async (c) => {
    const ctx = c.get("ctx");
    const secret = ctx.env.inboundEmailSecret;
    const given = c.req.query("secret") ?? c.req.header("x-inbound-secret") ?? "";
    if (!secret || !safeEqual(given, secret)) throw notFound();
    const p = await body(c, inboundSchema);
    const addresses = [p.To, p.Cc, ...(Array.isArray(p.to) ? p.to : [p.to]), ...(Array.isArray(p.cc) ? p.cc : [p.cc])].filter(Boolean).join(" ");
    const subject = p.Subject ?? p.subject ?? "";
    const token = /quotes\+([A-Za-z0-9_-]{16,})@/i.exec(addresses)?.[1] ?? /\[ref:([A-Za-z0-9_-]{16,})\]/.exec(subject)?.[1];
    if (!token) return c.json({ ok: true, matched: false });

    let loaded;
    try {
      loaded = loadByToken(ctx, token);
    } catch {
      return c.json({ ok: true, matched: false });
    }
    const { org, rfq, supplier } = loaded;
    if (rfq.status === "cancelled") return c.json({ ok: true, matched: true, ignored: "cancelled" });

    const rawText = p.TextBody ?? p.text ?? (p.HtmlBody ?? p.html ? htmlToText(p.HtmlBody ?? p.html ?? "") : "");
    const text = stripQuotedReply(rawText);
    const pdf =
      p.Attachments?.find((a) => /pdf/i.test(a.ContentType ?? a.Name ?? ""))?.Content ??
      p.attachments?.find((a) => /pdf/i.test(a.contentType ?? a.filename ?? ""))?.content ??
      null;

    let extracted;
    try {
      extracted = await extractQuote(c, org, { text, pdfBase64: pdf, items: listItems(ctx, rfq.id), today: today(ctx) });
    } catch (err) {
      logActivity(ctx, org.id, rfq.id, "email", `${supplier.name} replied by email, but the quote couldn't be read: ${(err as Error).message}`);
      return c.json({ ok: true, matched: true, read: false });
    }
    saveQuote(
      c,
      org,
      rfq,
      supplier,
      {
        lines: extracted.lines.map((l) => ({ itemId: l.itemId, unitPrice: l.unitPrice, leadDays: l.leadDays, substitute: l.substitute, note: l.note })),
        freight: extracted.freight ?? 0,
        tax: extracted.tax ?? 0,
        validUntil: extracted.validUntil,
        notes: extracted.notes,
        contactName: extracted.contactName,
        reference: extracted.reference,
      },
      "email",
      { status: "needs_review", rawText: text.slice(0, 60_000) },
    );
    await notifyBuyer(ctx, loaded, "email");
    return c.json({ ok: true, matched: true, read: true, method: extracted.method });
  });

  return r;
}
