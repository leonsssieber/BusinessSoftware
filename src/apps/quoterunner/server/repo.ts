import type { CoreContext, OrgRow } from "@core/server/context";
import { parseJson } from "@core/server/db";
import { notFound } from "@core/server/errors";
import { compareQuotes, type CompareOptions, type Comparison } from "../shared/domain/compare";
import { itemKey, round2 } from "../shared/domain/text";
import { poLabel, rfqLabel, type CompanySettings } from "../shared/product";
import type {
  ActivityDto,
  InvitationDto,
  InvitationStatus,
  LastPrice,
  PurchaseOrderDto,
  QuoteDto,
  RfqDetailDto,
  RfqItemDto,
  RfqStatus,
  RfqSummaryDto,
  SupplierDto,
} from "../shared/types";

export interface RfqRow {
  id: string;
  org_id: string;
  number: number;
  title: string;
  job_name: string | null;
  site_address: string | null;
  need_by: string | null;
  due_at: string | null;
  notes: string | null;
  status: RfqStatus;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  awarded_at: string | null;
}

export interface ItemRow {
  id: string;
  rfq_id: string;
  position: number;
  description: string;
  qty: number;
  unit: string;
  part_number: string | null;
  notes: string | null;
  allow_substitutes: number;
}

export interface SupplierRow {
  id: string;
  org_id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  categories: string;
  notes: string | null;
  archived: number;
  created_at: string;
}

export interface InvitationRow {
  id: string;
  rfq_id: string;
  supplier_id: string;
  token: string;
  status: InvitationStatus;
  sent_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  last_reminded_at: string | null;
  reminder_count: number;
  decline_reason: string | null;
}

export interface QuoteRow {
  id: string;
  rfq_id: string;
  supplier_id: string;
  source: QuoteDto["source"];
  status: QuoteDto["status"];
  freight: number;
  tax: number;
  valid_until: string | null;
  notes: string | null;
  contact_name: string | null;
  reference: string | null;
  received_at: string;
  raw_text: string | null;
}

interface QuoteLineRow {
  quote_id: string;
  item_id: string;
  unit_price: number | null;
  lead_days: number | null;
  substitute: string | null;
  note: string | null;
}

interface PoRow {
  id: string;
  org_id: string;
  rfq_id: string;
  supplier_id: string;
  number: number;
  status: "draft" | "sent";
  subtotal: number;
  freight: number;
  total: number;
  notes: string | null;
  created_at: string;
  sent_at: string | null;
}

export const today = (ctx: CoreContext) => ctx.now().toISOString().slice(0, 10);

export function companySettings(org: OrgRow): CompanySettings {
  return parseJson<CompanySettings>(org.settings, {});
}

export function portalUrl(ctx: CoreContext, token: string): string {
  return `${ctx.env.appUrl}/q/${token}`;
}

export function nextNumber(ctx: CoreContext, table: "rfqs" | "purchase_orders", orgId: string): number {
  const row = ctx.db.get<{ n: number | null }>(`SELECT MAX(number) AS n FROM ${table} WHERE org_id = ?`, orgId);
  return (row?.n ?? 0) + 1;
}

export function logActivity(ctx: CoreContext, orgId: string, rfqId: string | null, kind: string, message: string) {
  ctx.db.run(
    "INSERT INTO activity (org_id, rfq_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)",
    orgId,
    rfqId,
    kind,
    message,
    ctx.now().toISOString(),
  );
}

export function getRfqRow(ctx: CoreContext, orgId: string, id: string): RfqRow {
  const row = ctx.db.get<RfqRow>("SELECT * FROM rfqs WHERE id = ? AND org_id = ?", id, orgId);
  if (!row) throw notFound("Request not found.");
  return row;
}

export function getSupplierRow(ctx: CoreContext, orgId: string, id: string): SupplierRow {
  const row = ctx.db.get<SupplierRow>("SELECT * FROM suppliers WHERE id = ? AND org_id = ?", id, orgId);
  if (!row) throw notFound("Supplier not found.");
  return row;
}

export function listItems(ctx: CoreContext, rfqId: string): ItemRow[] {
  return ctx.db.all<ItemRow>("SELECT * FROM rfq_items WHERE rfq_id = ? ORDER BY position", rfqId);
}

export function supplierStats(ctx: CoreContext, orgId: string): Map<string, SupplierDto["stats"]> {
  const rows = ctx.db.all<{ supplier_id: string; invited: number; quoted: number; avg_hours: number | null }>(
    `SELECT i.supplier_id,
            COUNT(*) AS invited,
            SUM(CASE WHEN i.status = 'quoted' THEN 1 ELSE 0 END) AS quoted,
            AVG(CASE WHEN i.responded_at IS NOT NULL AND i.sent_at IS NOT NULL
                     THEN (julianday(i.responded_at) - julianday(i.sent_at)) * 24 END) AS avg_hours
       FROM invitations i JOIN rfqs r ON r.id = i.rfq_id
      WHERE r.org_id = ? AND i.status != 'pending'
      GROUP BY i.supplier_id`,
    orgId,
  );
  const won = ctx.db.all<{ supplier_id: string; n: number }>(
    "SELECT supplier_id, COUNT(DISTINCT rfq_id) AS n FROM purchase_orders WHERE org_id = ? GROUP BY supplier_id",
    orgId,
  );
  const wonMap = new Map(won.map((w) => [w.supplier_id, w.n]));
  const out = new Map<string, SupplierDto["stats"]>();
  for (const r of rows) {
    out.set(r.supplier_id, {
      invited: r.invited,
      quoted: r.quoted,
      won: wonMap.get(r.supplier_id) ?? 0,
      avgResponseHours: r.avg_hours === null ? null : Math.round(r.avg_hours * 10) / 10,
    });
  }
  for (const [sid, n] of wonMap) if (!out.has(sid)) out.set(sid, { invited: 0, quoted: 0, won: n, avgResponseHours: null });
  return out;
}

export function toSupplierDto(row: SupplierRow, stats?: SupplierDto["stats"]): SupplierDto {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone,
    categories: parseJson<string[]>(row.categories, []),
    notes: row.notes,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
    stats: stats ?? { invited: 0, quoted: 0, won: 0, avgResponseHours: null },
  };
}

/** Most recent awarded price for each item key. */
export function lastPaidPrices(ctx: CoreContext, orgId: string, keys: string[]): Map<string, LastPrice> {
  const out = new Map<string, LastPrice>();
  if (!keys.length) return out;
  const unique = [...new Set(keys)];
  const placeholders = unique.map(() => "?").join(",");
  const rows = ctx.db.all<{ item_key: string; unit_price: number; observed_at: string; supplier_name: string | null }>(
    `SELECT ph.item_key, ph.unit_price, ph.observed_at, s.name AS supplier_name
       FROM price_history ph LEFT JOIN suppliers s ON s.id = ph.supplier_id
      WHERE ph.org_id = ? AND ph.awarded = 1 AND ph.item_key IN (${placeholders})
      ORDER BY ph.observed_at DESC`,
    orgId,
    ...unique,
  );
  for (const r of rows) {
    if (!out.has(r.item_key)) out.set(r.item_key, { unitPrice: r.unit_price, supplierName: r.supplier_name, date: r.observed_at.slice(0, 10) });
  }
  return out;
}

export function itemDtos(ctx: CoreContext, orgId: string, items: ItemRow[], withLastPaid: boolean): RfqItemDto[] {
  const last = withLastPaid ? lastPaidPrices(ctx, orgId, items.map((i) => itemKey(i.description, i.part_number))) : new Map();
  return items.map((i) => ({
    id: i.id,
    position: i.position,
    description: i.description,
    qty: i.qty,
    unit: i.unit,
    partNumber: i.part_number,
    notes: i.notes,
    allowSubstitutes: Boolean(i.allow_substitutes),
    lastPaid: last.get(itemKey(i.description, i.part_number)) ?? null,
  }));
}

export function invitationDtos(ctx: CoreContext, rfqId: string): InvitationDto[] {
  const rows = ctx.db.all<InvitationRow & { supplier_name: string; supplier_email: string | null; contact_name: string | null }>(
    `SELECT i.*, s.name AS supplier_name, s.email AS supplier_email, s.contact_name
       FROM invitations i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.rfq_id = ? ORDER BY s.name`,
    rfqId,
  );
  return rows.map((r) => ({
    id: r.id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    supplierEmail: r.supplier_email,
    contactName: r.contact_name,
    status: r.status,
    sentAt: r.sent_at,
    viewedAt: r.viewed_at,
    respondedAt: r.responded_at,
    lastRemindedAt: r.last_reminded_at,
    reminderCount: r.reminder_count,
    declineReason: r.decline_reason,
    portalUrl: portalUrl(ctx, r.token),
  }));
}

export function quoteDtos(ctx: CoreContext, rfq: RfqRow, supplierId?: string): QuoteDto[] {
  const quotes = ctx.db.all<QuoteRow & { supplier_name: string }>(
    `SELECT q.*, s.name AS supplier_name FROM quotes q JOIN suppliers s ON s.id = q.supplier_id
      WHERE q.rfq_id = ? ${supplierId ? "AND q.supplier_id = ?" : ""} ORDER BY q.received_at`,
    ...(supplierId ? [rfq.id, supplierId] : [rfq.id]),
  );
  if (!quotes.length) return [];
  const lines = ctx.db.all<QuoteLineRow>(
    `SELECT ql.* FROM quote_lines ql JOIN quotes q ON q.id = ql.quote_id WHERE q.rfq_id = ?`,
    rfq.id,
  );
  const byQuote = new Map<string, QuoteLineRow[]>();
  for (const l of lines) {
    const list = byQuote.get(l.quote_id) ?? [];
    list.push(l);
    byQuote.set(l.quote_id, list);
  }
  return quotes.map((q) => ({
    id: q.id,
    supplierId: q.supplier_id,
    supplierName: q.supplier_name,
    source: q.source,
    status: q.status,
    freight: q.freight,
    tax: q.tax,
    validUntil: q.valid_until,
    notes: q.notes,
    contactName: q.contact_name,
    reference: q.reference,
    receivedAt: q.received_at,
    late: Boolean(rfq.due_at && q.received_at > rfq.due_at),
    lines: (byQuote.get(q.id) ?? []).map((l) => ({
      itemId: l.item_id,
      unitPrice: l.unit_price,
      leadDays: l.lead_days,
      substitute: l.substitute,
      note: l.note,
    })),
  }));
}

export function buildComparison(
  ctx: CoreContext,
  rfq: RfqRow,
  items: ItemRow[],
  quotes: QuoteDto[],
  opts: Partial<CompareOptions> = {},
): Comparison {
  return compareQuotes(
    items.map((i) => ({ id: i.id, description: i.description, qty: i.qty, unit: i.unit, allowSubstitutes: Boolean(i.allow_substitutes) })),
    quotes.map((q) => ({ supplierId: q.supplierId, supplierName: q.supplierName, freight: q.freight, lines: q.lines })),
    { today: today(ctx), needBy: rfq.need_by, excludeLate: false, allowSubstitutes: true, ...opts },
  );
}

export function poDtos(ctx: CoreContext, where: { orgId: string; rfqId?: string; poId?: string }): PurchaseOrderDto[] {
  const conds = ["po.org_id = ?"];
  const params: string[] = [where.orgId];
  if (where.rfqId) {
    conds.push("po.rfq_id = ?");
    params.push(where.rfqId);
  }
  if (where.poId) {
    conds.push("po.id = ?");
    params.push(where.poId);
  }
  const rows = ctx.db.all<
    PoRow & {
      supplier_name: string;
      supplier_email: string | null;
      rfq_number: number;
      rfq_title: string;
      job_name: string | null;
      site_address: string | null;
      need_by: string | null;
    }
  >(
    `SELECT po.*, s.name AS supplier_name, s.email AS supplier_email, r.number AS rfq_number, r.title AS rfq_title,
            r.job_name, r.site_address, r.need_by
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN rfqs r ON r.id = po.rfq_id
      WHERE ${conds.join(" AND ")}
      ORDER BY po.number DESC`,
    ...params,
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const lines = ctx.db.all<{ po_id: string; item_id: string; description: string; qty: number; unit: string; unit_price: number; substitute: string | null; position: number }>(
    `SELECT pl.*, ri.position FROM po_lines pl JOIN rfq_items ri ON ri.id = pl.item_id
      WHERE pl.po_id IN (${ids.map(() => "?").join(",")}) ORDER BY ri.position`,
    ...ids,
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    label: poLabel(r.number),
    rfqId: r.rfq_id,
    rfqLabel: rfqLabel(r.rfq_number),
    rfqTitle: r.rfq_title,
    jobName: r.job_name,
    siteAddress: r.site_address,
    needBy: r.need_by,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    supplierEmail: r.supplier_email,
    status: r.status,
    subtotal: r.subtotal,
    freight: r.freight,
    total: r.total,
    notes: r.notes,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    lines: lines
      .filter((l) => l.po_id === r.id)
      .map((l) => ({
        itemId: l.item_id,
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        unitPrice: l.unit_price,
        substitute: l.substitute,
        ext: round2(l.qty * l.unit_price),
      })),
  }));
}

export function rfqSummaries(ctx: CoreContext, rows: RfqRow[]): RfqSummaryDto[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");
  const counts = ctx.db.all<{ rfq_id: string; invited: number; responded: number; quoted: number }>(
    `SELECT rfq_id, COUNT(*) AS invited,
            SUM(CASE WHEN status IN ('quoted', 'declined') THEN 1 ELSE 0 END) AS responded,
            SUM(CASE WHEN status = 'quoted' THEN 1 ELSE 0 END) AS quoted
       FROM invitations WHERE rfq_id IN (${ph}) GROUP BY rfq_id`,
    ...ids,
  );
  const itemCounts = ctx.db.all<{ rfq_id: string; n: number }>(
    `SELECT rfq_id, COUNT(*) AS n FROM rfq_items WHERE rfq_id IN (${ph}) GROUP BY rfq_id`,
    ...ids,
  );
  const review = ctx.db.all<{ rfq_id: string; n: number }>(
    `SELECT rfq_id, COUNT(*) AS n FROM quotes WHERE status = 'needs_review' AND rfq_id IN (${ph}) GROUP BY rfq_id`,
    ...ids,
  );
  const awarded = ctx.db.all<{ rfq_id: string; total: number }>(
    `SELECT rfq_id, SUM(total) AS total FROM purchase_orders WHERE rfq_id IN (${ph}) GROUP BY rfq_id`,
    ...ids,
  );
  const cMap = new Map(counts.map((c) => [c.rfq_id, c]));
  const iMap = new Map(itemCounts.map((c) => [c.rfq_id, c.n]));
  const rMap = new Map(review.map((c) => [c.rfq_id, c.n]));
  const aMap = new Map(awarded.map((c) => [c.rfq_id, c.total]));

  return rows.map((r) => {
    const c = cMap.get(r.id);
    let bestTotal: number | null = null;
    if ((c?.quoted ?? 0) > 0) {
      const items = listItems(ctx, r.id);
      const comparison = buildComparison(ctx, r, items, quoteDtos(ctx, r));
      bestTotal = comparison.bestSplit?.missingItemIds.length === 0 ? comparison.bestSplit.total : null;
    }
    return {
      id: r.id,
      number: r.number,
      label: rfqLabel(r.number),
      title: r.title,
      jobName: r.job_name,
      status: r.status,
      needBy: r.need_by,
      dueAt: r.due_at,
      createdAt: r.created_at,
      sentAt: r.sent_at,
      awardedAt: r.awarded_at,
      itemCount: iMap.get(r.id) ?? 0,
      invited: c?.invited ?? 0,
      responded: c?.responded ?? 0,
      quoted: c?.quoted ?? 0,
      needsReview: rMap.get(r.id) ?? 0,
      bestTotal,
      awardedTotal: aMap.has(r.id) ? round2(aMap.get(r.id)!) : null,
    };
  });
}

export function activityFor(ctx: CoreContext, rfqId: string): ActivityDto[] {
  return ctx.db
    .all<{ kind: string; message: string; created_at: string }>(
      "SELECT kind, message, created_at FROM activity WHERE rfq_id = ? ORDER BY id DESC LIMIT 100",
      rfqId,
    )
    .map((a) => ({ kind: a.kind, message: a.message, createdAt: a.created_at }));
}

export function rfqDetail(
  ctx: CoreContext,
  org: OrgRow,
  id: string,
  opts: { excludeLate?: boolean; allowSubstitutes?: boolean; withLastPaid: boolean },
): RfqDetailDto {
  const rfq = getRfqRow(ctx, org.id, id);
  const items = listItems(ctx, rfq.id);
  const quotes = quoteDtos(ctx, rfq);
  const [summary] = rfqSummaries(ctx, [rfq]);
  return {
    ...summary,
    siteAddress: rfq.site_address,
    notes: rfq.notes,
    items: itemDtos(ctx, org.id, items, opts.withLastPaid),
    invitations: invitationDtos(ctx, rfq.id),
    quotes,
    comparison: buildComparison(ctx, rfq, items, quotes, { excludeLate: opts.excludeLate, allowSubstitutes: opts.allowSubstitutes }),
    purchaseOrders: poDtos(ctx, { orgId: org.id, rfqId: rfq.id }),
    activity: activityFor(ctx, rfq.id),
  };
}

/**
 * Records quoted unit prices for price history. A supplier's earlier observations for the same
 * request are replaced so revised quotes don't double count.
 */
export function recordQuotePrices(
  ctx: CoreContext,
  orgId: string,
  rfqId: string,
  supplierId: string,
  items: ItemRow[],
  lines: { itemId: string; unitPrice: number | null }[],
) {
  ctx.db.run("DELETE FROM price_history WHERE rfq_id = ? AND supplier_id = ? AND awarded = 0", rfqId, supplierId);
  const now = ctx.now().toISOString();
  for (const l of lines) {
    const item = items.find((i) => i.id === l.itemId);
    if (!item || l.unitPrice === null) continue;
    ctx.db.run(
      `INSERT INTO price_history (org_id, item_key, description, unit, unit_price, supplier_id, rfq_id, awarded, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      orgId,
      itemKey(item.description, item.part_number),
      item.description,
      item.unit,
      l.unitPrice,
      supplierId,
      rfqId,
      now,
    );
  }
}
