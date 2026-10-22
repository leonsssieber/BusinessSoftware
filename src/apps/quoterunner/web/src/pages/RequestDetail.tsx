import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft, Copy, Pencil, XCircle } from "lucide-react";
import { api, errorMessage } from "@ui/api";
import { Button, ButtonLink } from "@ui/components/button";
import { Alert, Badge, Card, CardHeader, PageLoader, Table, TD, TH } from "@ui/components/display";
import { Tabs } from "@ui/components/overlay";
import { useToast } from "@ui/components/toast";
import { date, dateTime, money, relative } from "@ui/format";
import { useDocumentTitle, useResource } from "@ui/hooks";
import type { RfqDetailDto, SupplierDto } from "../../../shared/types";
import { ComparePanel, type CompareOptionsState } from "../components/ComparePanel";
import { draftProblems, fromDraft, ItemsEditor, toDraft, type DraftItem } from "../components/ItemsEditor";
import { RfqStatusBadge } from "../components/status";
import { SuppliersPanel } from "../components/SuppliersPanel";

type Tab = "items" | "suppliers" | "compare" | "orders" | "activity";

function ItemsPanel({ rfq, onChange }: { rfq: RfqDetailDto; onChange: (r: RfqDetailDto) => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const canEdit = !rfq.quotes.length && rfq.status !== "awarded" && rfq.status !== "cancelled";
  const hasLastPaid = rfq.items.some((i) => i.lastPaid);

  if (editing) {
    return (
      <Card>
        <CardHeader title="Edit items" />
        <div className="p-5">
          <ItemsEditor items={items} onChange={setItems} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              loading={saving}
              onClick={async () => {
                const problem = draftProblems(items);
                if (problem) return toast.error(problem);
                setSaving(true);
                try {
                  onChange(await api.patch<RfqDetailDto>(`/api/rfqs/${rfq.id}`, { items: fromDraft(items) }));
                  setEditing(false);
                  toast.success("Items saved.");
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save items
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={`${rfq.items.length} items`}
        description={canEdit ? undefined : rfq.quotes.length ? "Items are locked because quotes have arrived." : undefined}
        actions={
          canEdit ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<Pencil className="size-4" />}
              onClick={() => {
                setItems(rfq.items.map((i) => toDraft(i)));
                setEditing(true);
              }}
            >
              Edit items
            </Button>
          ) : null
        }
      />
      <Table>
        <thead>
          <tr>
            <TH className="w-10">#</TH>
            <TH className="w-28 text-right">Qty</TH>
            <TH>Item</TH>
            <TH>Part #</TH>
            <TH>Subs</TH>
            {hasLastPaid ? <TH className="text-right">Last paid</TH> : null}
          </tr>
        </thead>
        <tbody>
          {rfq.items.map((i) => (
            <tr key={i.id}>
              <TD className="text-muted tabular">{i.position}</TD>
              <TD className="text-right font-mono tabular whitespace-nowrap">
                {i.qty.toLocaleString()} <span className="text-muted">{i.unit}</span>
              </TD>
              <TD className="font-medium">{i.description}</TD>
              <TD className="font-mono text-muted">{i.partNumber ?? "—"}</TD>
              <TD>{i.allowSubstitutes ? <span className="text-muted">OK</span> : <Badge tone="warn">Exact only</Badge>}</TD>
              {hasLastPaid ? (
                <TD className="text-right">
                  {i.lastPaid ? (
                    <span title={`${i.lastPaid.supplierName ?? ""} · ${date(i.lastPaid.date)}`} className="font-mono tabular">
                      {money(i.lastPaid.unitPrice)}
                    </span>
                  ) : (
                    "—"
                  )}
                </TD>
              ) : null}
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

export function RequestDetail() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [options, setOptions] = useState<CompareOptionsState>({ excludeLate: false, subs: true });
  const query = `?excludeLate=${options.excludeLate ? 1 : 0}&subs=${options.subs ? 1 : 0}`;
  const res = useResource<RfqDetailDto>(`/api/rfqs/${id}${query}`);
  const suppliers = useResource<SupplierDto[]>("/api/suppliers");
  const rfq = res.data;
  useDocumentTitle(rfq ? `${rfq.label} ${rfq.title}` : "Request", "QuoteRunner");

  const defaultTab: Tab = !rfq
    ? "items"
    : rfq.status === "awarded"
      ? "orders"
      : rfq.quotes.length
        ? "compare"
        : rfq.invitations.length || rfq.status === "draft"
          ? "suppliers"
          : "items";
  const tab = (params.get("tab") as Tab) || defaultTab;
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });

  useEffect(() => {
    if (rfq && params.get("tab") === "orders" && !rfq.purchaseOrders.length) setTab(defaultTab);
  }, [rfq?.id]);

  if (res.loading && !rfq) return <PageLoader />;
  if (res.error || !rfq) return <Alert tone="bad">{res.error ?? "Request not found."}</Alert>;

  const setRfq = (r: RfqDetailDto) => res.setData(r);

  return (
    <div>
      <Link to="/app/requests" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Requests
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-muted">{rfq.label}</span>
            <RfqStatusBadge status={rfq.status} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{rfq.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {[
              rfq.jobName,
              rfq.siteAddress,
              rfq.needBy ? `needed by ${date(rfq.needBy)}` : null,
              rfq.dueAt ? `quotes due ${dateTime(rfq.dueAt)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {rfq.notes ? <p className="mt-1 max-w-2xl text-sm">{rfq.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Copy className="size-4" />}
            onClick={async () => {
              try {
                const copy = await api.post<RfqDetailDto>(`/api/rfqs/${rfq.id}/duplicate`);
                navigate(`/app/requests/${copy.id}?tab=items`);
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
          >
            Copy into new request
          </Button>
          {rfq.status === "open" || rfq.status === "draft" ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<XCircle className="size-4" />}
              onClick={async () => {
                try {
                  if (rfq.status === "draft") {
                    await api.delete(`/api/rfqs/${rfq.id}`);
                    toast.success("Draft deleted.");
                    navigate("/app/requests");
                  } else {
                    setRfq(await api.post<RfqDetailDto>(`/api/rfqs/${rfq.id}/status`, { status: "cancelled" }));
                    toast.success("Request cancelled. Suppliers can no longer quote.");
                  }
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              {rfq.status === "draft" ? "Delete draft" : "Cancel request"}
            </Button>
          ) : null}
        </div>
      </div>

      <Tabs<Tab>
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "items", label: "Items", count: rfq.items.length },
          { id: "suppliers", label: "Suppliers", count: rfq.invitations.length },
          { id: "compare", label: "Compare", count: rfq.quotes.length },
          ...(rfq.purchaseOrders.length ? [{ id: "orders" as Tab, label: "Purchase orders", count: rfq.purchaseOrders.length }] : []),
          { id: "activity", label: "Activity" },
        ]}
      />

      {tab === "items" ? <ItemsPanel rfq={rfq} onChange={setRfq} /> : null}
      {tab === "suppliers" ? <SuppliersPanel rfq={rfq} suppliers={suppliers.data ?? []} onChange={setRfq} reloadSuppliers={suppliers.reload} /> : null}
      {tab === "compare" ? <ComparePanel rfq={rfq} options={options} onOptions={setOptions} onChange={(r) => { setRfq(r); setTab("orders"); }} /> : null}
      {tab === "orders" ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <TH>Purchase order</TH>
                <TH>Supplier</TH>
                <TH>Status</TH>
                <TH className="text-right">Total</TH>
              </tr>
            </thead>
            <tbody>
              {rfq.purchaseOrders.map((po) => (
                <tr key={po.id} className="cursor-pointer hover:bg-surface-2" onClick={() => navigate(`/app/orders/${po.id}`)}>
                  <TD>
                    <Link to={`/app/orders/${po.id}`} className="font-mono font-semibold hover:underline">
                      {po.label}
                    </Link>
                    <p className="text-xs text-muted">{po.lines.length} lines · created {relative(po.createdAt)}</p>
                  </TD>
                  <TD>{po.supplierName}</TD>
                  <TD>{po.status === "sent" ? <Badge tone="good">Sent {date(po.sentAt)}</Badge> : <Badge>Draft</Badge>}</TD>
                  <TD className="text-right font-mono tabular">{money(po.total)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex justify-end border-t border-line p-4">
            <ButtonLink size="sm" variant="secondary" to="/app/orders">
              All purchase orders
            </ButtonLink>
          </div>
        </Card>
      ) : null}
      {tab === "activity" ? (
        <Card>
          <ol className="flex flex-col gap-4 px-5 py-5">
            {rfq.activity.map((a, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                <div>
                  <p>{a.message}</p>
                  <p className="text-xs text-muted">{dateTime(a.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}
