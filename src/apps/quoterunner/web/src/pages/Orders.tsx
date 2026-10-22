import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Mail, PackageCheck, Printer, Trash2 } from "lucide-react";
import { api, ApiError, errorMessage } from "@ui/api";
import { useSession } from "@ui/auth";
import { Button, ButtonLink } from "@ui/components/button";
import { Alert, Badge, Card, EmptyState, PageHeader, PageLoader, Table, TD, TH } from "@ui/components/display";
import { Field, Textarea } from "@ui/components/form";
import { Modal } from "@ui/components/overlay";
import { useToast } from "@ui/components/toast";
import { date, money } from "@ui/format";
import { useDocumentTitle, useResource } from "@ui/hooks";
import type { CompanySettings } from "../../../shared/product";
import type { PurchaseOrderDto } from "../../../shared/types";

export function Orders() {
  useDocumentTitle("Purchase orders", "QuoteRunner");
  const list = useResource<PurchaseOrderDto[]>("/api/orders");
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader title="Purchase orders" description="Created when you award a request. Email them to suppliers or print them." />
      {list.error ? <Alert tone="bad">{list.error}</Alert> : null}
      {list.loading && !list.data ? (
        <PageLoader />
      ) : list.data?.length ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <TH>PO</TH>
                <TH>Supplier</TH>
                <TH>Request</TH>
                <TH>Status</TH>
                <TH className="text-right">Total</TH>
              </tr>
            </thead>
            <tbody>
              {list.data.map((po) => (
                <tr key={po.id} className="cursor-pointer hover:bg-surface-2" onClick={() => navigate(`/app/orders/${po.id}`)}>
                  <TD>
                    <Link to={`/app/orders/${po.id}`} className="font-mono font-semibold hover:underline">
                      {po.label}
                    </Link>
                    <p className="text-xs text-muted">{date(po.createdAt)}</p>
                  </TD>
                  <TD>{po.supplierName}</TD>
                  <TD>
                    <p>{po.rfqTitle}</p>
                    <p className="font-mono text-xs text-muted">{po.rfqLabel}</p>
                  </TD>
                  <TD>{po.status === "sent" ? <Badge tone="good">Sent</Badge> : <Badge>Draft</Badge>}</TD>
                  <TD className="text-right font-mono tabular">{money(po.total)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Card>
          <EmptyState icon={<PackageCheck className="size-8" />} title="No purchase orders yet">
            Award a request on its Compare tab and the purchase orders show up here.
          </EmptyState>
        </Card>
      )}
    </div>
  );
}

export function OrderDetail() {
  const { id = "" } = useParams();
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const po = useResource<PurchaseOrderDto>(`/api/orders/${id}`);
  const [sendOpen, setSendOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  useDocumentTitle(po.data?.label ?? "Purchase order", "QuoteRunner");
  const settings = session.org.settings as CompanySettings;

  if (po.loading && !po.data) return <PageLoader />;
  if (po.error || !po.data) return <Alert tone="bad">{po.error ?? "Purchase order not found."}</Alert>;
  const o = po.data;

  return (
    <div>
      <div className="no-print">
        <Link to="/app/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Purchase orders
        </Link>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold">{o.label}</h1>
            {o.status === "sent" ? <Badge tone="good">Sent {date(o.sentAt)}</Badge> : <Badge>Draft</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>
              Print or save PDF
            </Button>
            <Button icon={<Mail className="size-4" />} onClick={() => setSendOpen(true)}>
              {o.status === "sent" ? "Send again" : "Email to supplier"}
            </Button>
            <Button
              variant="ghost"
              icon={<Trash2 className="size-4" />}
              loading={busy === "cancel"}
              onClick={async () => {
                setBusy("cancel");
                try {
                  await api.delete(`/api/orders/${o.id}`);
                  toast.success(`${o.label} cancelled.`);
                  navigate(`/app/requests/${o.rfqId}?tab=compare`);
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setBusy(null);
                }
              }}
            >
              Cancel PO
            </Button>
          </div>
        </div>
        {limit ? (
          <Alert tone="warn" className="mb-4" action={<ButtonLink size="sm" to="/app/settings/billing">See plans</ButtonLink>}>
            {limit} You can still print it or save it as a PDF.
          </Alert>
        ) : null}
      </div>

      <Card className="mx-auto max-w-4xl p-6 sm:p-10 print:border-0 print:p-0">
        <div className="flex flex-wrap justify-between gap-6 border-b border-line pb-6">
          <div>
            <p className="font-display text-xl font-bold">{session.org.name}</p>
            <p className="text-sm whitespace-pre-line text-muted">{[settings.companyAddress, settings.companyPhone].filter(Boolean).join("\n")}</p>
          </div>
          <div className="text-right">
            <p className="eyebrow">Purchase order</p>
            <p className="font-mono text-2xl font-semibold">{o.label}</p>
            <p className="text-sm text-muted">Date {date(o.createdAt)}</p>
            <p className="text-sm text-muted">
              Ref. {o.rfqLabel}
              {o.jobName ? ` · ${o.jobName}` : ""}
            </p>
          </div>
        </div>
        <div className="grid gap-6 border-b border-line py-6 sm:grid-cols-3">
          <div>
            <p className="eyebrow mb-1">Supplier</p>
            <p className="font-medium">{o.supplierName}</p>
            <p className="text-sm text-muted">{o.supplierEmail}</p>
          </div>
          <div>
            <p className="eyebrow mb-1">Ship to</p>
            <p className="text-sm">{o.siteAddress ?? settings.companyAddress ?? "—"}</p>
          </div>
          <div>
            <p className="eyebrow mb-1">Needed by</p>
            <p className="text-sm">{date(o.needBy)}</p>
          </div>
        </div>
        <Table className="my-6">
          <thead>
            <tr>
              <TH className="w-10">#</TH>
              <TH>Item</TH>
              <TH className="text-right">Qty</TH>
              <TH className="text-right">Unit price</TH>
              <TH className="text-right">Amount</TH>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l, n) => (
              <tr key={l.itemId}>
                <TD className="text-muted tabular">{n + 1}</TD>
                <TD>
                  {l.description}
                  {l.substitute ? <p className="text-xs text-warn">Substitute: {l.substitute}</p> : null}
                </TD>
                <TD className="text-right font-mono tabular whitespace-nowrap">
                  {l.qty.toLocaleString()} {l.unit}
                </TD>
                <TD className="text-right font-mono tabular">{money(l.unitPrice)}</TD>
                <TD className="text-right font-mono tabular">{money(l.ext)}</TD>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="ml-auto flex w-full max-w-xs flex-col gap-1 font-mono text-sm tabular">
          <div className="flex justify-between">
            <span className="text-muted">Subtotal</span>
            <span>{money(o.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Freight</span>
            <span>{money(o.freight)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-1 text-base font-semibold">
            <span>Total</span>
            <span>{money(o.total)}</span>
          </div>
          <p className="text-right text-xs text-muted">Before sales tax</p>
        </div>
        {settings.deliveryInstructions || settings.poTerms || o.notes ? (
          <div className="mt-8 flex flex-col gap-2 border-t border-line pt-6 text-sm">
            {settings.deliveryInstructions ? <p><strong>Delivery:</strong> {settings.deliveryInstructions}</p> : null}
            {settings.poTerms ? <p><strong>Terms:</strong> {settings.poTerms}</p> : null}
            {o.notes ? <p><strong>Notes:</strong> {o.notes}</p> : null}
          </div>
        ) : null}
      </Card>

      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title={`Email ${o.label} to ${o.supplierName}`}
        description={o.supplierEmail ? `Goes to ${o.supplierEmail}. Replies come back to you.` : "This supplier has no email address yet."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSendOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy === "send"}
              disabled={!o.supplierEmail}
              icon={<Mail className="size-4" />}
              onClick={async () => {
                setBusy("send");
                try {
                  po.setData(await api.post<PurchaseOrderDto>(`/api/orders/${o.id}/send`, { message: message || null }));
                  toast.success(`Sent ${o.label} to ${o.supplierName}.`);
                  setSendOpen(false);
                } catch (err) {
                  if (err instanceof ApiError && err.code === "plan_limit") {
                    setLimit(err.message);
                    setSendOpen(false);
                  } else toast.error(errorMessage(err));
                } finally {
                  setBusy(null);
                }
              }}
            >
              Send PO
            </Button>
          </>
        }
      >
        <Field label="Message (optional)">
          {(fid) => <Textarea id={fid} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please confirm the ship date." />}
        </Field>
      </Modal>
    </div>
  );
}
