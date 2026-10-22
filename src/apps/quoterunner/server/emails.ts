import type { CoreContext, OrgRow } from "@core/server/context";
import { renderEmail } from "@core/server/mail";
import { rfqLabel } from "../shared/product";
import type { PurchaseOrderDto } from "../shared/types";
import { companySettings, type ItemRow, type RfqRow, type SupplierRow } from "./repo";

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null;
const fmtMoney = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

function greeting(s: SupplierRow): string {
  return s.contact_name ? `Hi ${s.contact_name.split(" ")[0]},` : `Hello ${s.name} team,`;
}

function itemTable(items: ItemRow[]) {
  return {
    headers: ["#", "Qty", "Unit", "Item", "Part #"],
    rows: items.map((i, n) => [String(n + 1), qty(i.qty), i.unit, i.description + (i.allow_substitutes ? "" : " (no substitutes)"), i.part_number ?? ""]),
  };
}

export function rfqEmail(
  ctx: CoreContext,
  o: { org: OrgRow; rfq: RfqRow; items: ItemRow[]; supplier: SupplierRow; portalUrl: string; message?: string | null; replyTo?: string | null },
) {
  const company = o.org.name;
  const settings = companySettings(o.org);
  const due = fmtDate(o.rfq.due_at);
  const needBy = fmtDate(o.rfq.need_by);
  const paragraphs = [
    greeting(o.supplier),
    `${company} is asking for your price on the ${o.items.length === 1 ? "item" : `${o.items.length} items`} below${o.rfq.job_name ? ` for the ${o.rfq.job_name} job` : ""}.`,
    [due ? `Quotes are due ${due}.` : null, needBy ? `Needed on site by ${needBy}.` : null, o.rfq.site_address ? `Deliver to ${o.rfq.site_address}.` : null]
      .filter(Boolean)
      .join(" "),
    ...(o.message ? [o.message] : []),
    ...(o.rfq.notes ? [`Notes: ${o.rfq.notes}`] : []),
    o.replyTo
      ? "Enter your prices with the button below, or reply to this email with your quote attached. Either works."
      : "Enter your prices with the button below. It takes a couple of minutes and you don't need an account.",
  ].filter((p) => p.trim());
  const { html, text } = renderEmail({
    productName: company,
    accent: ctx.product.emailAccent,
    heading: `Request for quote ${rfqLabel(o.rfq.number)}: ${o.rfq.title}`,
    paragraphs,
    table: itemTable(o.items),
    button: { label: "Enter your prices", url: o.portalUrl },
    footer: `Sent by ${company}${settings.companyPhone ? ` · ${settings.companyPhone}` : ""} using ${ctx.product.name}.`,
  });
  return { subject: `RFQ ${rfqLabel(o.rfq.number)} from ${company}: ${o.rfq.title}`, html, text };
}

export function reminderEmail(ctx: CoreContext, o: { org: OrgRow; rfq: RfqRow; supplier: SupplierRow; portalUrl: string; final: boolean }) {
  const due = fmtDate(o.rfq.due_at);
  const { html, text } = renderEmail({
    productName: o.org.name,
    accent: ctx.product.emailAccent,
    heading: o.final ? `Last call: quote for ${o.rfq.title}` : `Reminder: quote for ${o.rfq.title}`,
    paragraphs: [
      greeting(o.supplier),
      o.final
        ? `${o.org.name} is choosing a supplier for ${rfqLabel(o.rfq.number)} soon. If you'd like to be considered, please send your prices now.`
        : `Just a reminder that ${o.org.name} would like your prices for ${rfqLabel(o.rfq.number)}${due ? ` by ${due}` : ""}.`,
      "If you can't quote this one, you can say so with one click on the same page.",
    ],
    button: { label: "Enter your prices", url: o.portalUrl },
  });
  return { subject: `${o.final ? "Last call" : "Reminder"}: RFQ ${rfqLabel(o.rfq.number)} from ${o.org.name}`, html, text };
}

export function quoteReceivedEmail(ctx: CoreContext, o: { rfq: RfqRow; supplierName: string; via: "portal" | "email"; allIn: boolean }) {
  const url = `${ctx.env.appUrl}/app/requests/${o.rfq.id}`;
  const heading = o.allIn ? `All quotes are in for ${rfqLabel(o.rfq.number)}` : `${o.supplierName} sent a quote`;
  const { html, text } = renderEmail({
    productName: ctx.product.name,
    accent: ctx.product.emailAccent,
    heading,
    paragraphs: [
      o.via === "email"
        ? `${o.supplierName} replied by email to ${rfqLabel(o.rfq.number)} (${o.rfq.title}). We read the prices into your comparison; check them before you award.`
        : `${o.supplierName} entered prices for ${rfqLabel(o.rfq.number)} (${o.rfq.title}).`,
      ...(o.allIn ? ["Every supplier you invited has answered, so you can compare and award now."] : []),
    ],
    button: { label: o.allIn ? "Compare quotes" : "Open the request", url },
  });
  return { subject: heading, html, text };
}

export function purchaseOrderEmail(ctx: CoreContext, o: { org: OrgRow; po: PurchaseOrderDto; supplier: SupplierRow; message?: string | null }) {
  const settings = companySettings(o.org);
  const lines = o.po.lines.map((l, n) => [
    String(n + 1),
    qty(l.qty),
    l.unit,
    l.description + (l.substitute ? ` — substitute: ${l.substitute}` : ""),
    fmtMoney(l.unitPrice),
    fmtMoney(l.ext),
  ]);
  const paragraphs = [
    greeting(o.supplier),
    `${o.org.name} is placing purchase order ${o.po.label} with you, based on your quote for ${o.po.rfqLabel} (${o.po.rfqTitle}).`,
    [
      o.po.jobName ? `Job: ${o.po.jobName}.` : null,
      o.po.siteAddress ? `Deliver to: ${o.po.siteAddress}.` : null,
      o.po.needBy ? `Needed by ${fmtDate(o.po.needBy)}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    `Subtotal ${fmtMoney(o.po.subtotal)}, freight ${fmtMoney(o.po.freight)}, total ${fmtMoney(o.po.total)} (before tax).`,
    ...(settings.deliveryInstructions ? [`Delivery instructions: ${settings.deliveryInstructions}`] : []),
    ...(settings.poTerms ? [`Terms: ${settings.poTerms}`] : []),
    ...(o.message ? [o.message] : []),
    "Please reply to confirm the order and expected ship date.",
  ].filter((p) => p.trim());
  const { html, text } = renderEmail({
    productName: o.org.name,
    accent: ctx.product.emailAccent,
    heading: `Purchase order ${o.po.label}`,
    paragraphs,
    table: { headers: ["#", "Qty", "Unit", "Item", "Unit price", "Amount"], rows: lines },
    footer: [o.org.name, settings.companyAddress, settings.companyPhone].filter(Boolean).join(" · "),
  });
  return { subject: `Purchase order ${o.po.label} from ${o.org.name}`, html, text };
}

export function notSelectedEmail(ctx: CoreContext, o: { org: OrgRow; rfq: RfqRow; supplier: SupplierRow }) {
  const { html, text } = renderEmail({
    productName: o.org.name,
    accent: ctx.product.emailAccent,
    heading: `Thanks for quoting ${rfqLabel(o.rfq.number)}`,
    paragraphs: [
      greeting(o.supplier),
      `Thank you for your quote on ${o.rfq.title}. We went with another supplier on this one, and we'll keep asking you on future jobs.`,
    ],
    footer: `Sent by ${o.org.name} using ${ctx.product.name}.`,
  });
  return { subject: `RFQ ${rfqLabel(o.rfq.number)}: thanks for your quote`, html, text };
}
