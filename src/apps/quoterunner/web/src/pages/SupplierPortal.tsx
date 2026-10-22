import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import { CheckCircle2, Send } from "lucide-react";
import { api, errorMessage } from "@ui/api";
import { Button } from "@ui/components/button";
import { Alert, Badge, Card, PageLoader } from "@ui/components/display";
import { Field, Input, Textarea } from "@ui/components/form";
import { cn } from "@ui/cn";
import { date, dateTime, money, priceInput } from "@ui/format";
import type { PortalDto } from "../../../shared/types";
import { Mark } from "../brand";

interface Line {
  unitPrice: string;
  leadDays: string;
  substitute: string;
  showSub: boolean;
}

const price = (v: string): number | null => {
  const t = v.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function SupplierPortal() {
  const { token = "" } = useParams();
  const [data, setData] = useState<PortalDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [meta, setMeta] = useState({ freight: "", validUntil: "", contactName: "", reference: "", notes: "" });
  const [editing, setEditing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");

  function hydrate(d: PortalDto) {
    setData(d);
    const next: Record<string, Line> = {};
    for (const item of d.items) {
      const l = d.quote?.lines.find((x) => x.itemId === item.id);
      next[item.id] = {
        unitPrice: priceInput(l?.unitPrice),
        leadDays: l?.leadDays != null ? String(l.leadDays) : "",
        substitute: l?.substitute ?? "",
        showSub: Boolean(l?.substitute),
      };
    }
    setLines(next);
    setMeta({
      freight: d.quote?.freight ? priceInput(d.quote.freight) : "",
      validUntil: d.quote?.validUntil ?? "",
      contactName: d.quote?.contactName ?? d.supplier.contactName ?? "",
      reference: d.quote?.reference ?? "",
      notes: d.quote?.notes ?? "",
    });
    setEditing(!d.quote && !d.declined);
  }

  useEffect(() => {
    api
      .get<PortalDto>(`/api/portal/${encodeURIComponent(token)}`)
      .then(hydrate)
      .catch((err) => setLoadError(errorMessage(err)));
  }, [token]);

  useEffect(() => {
    if (data) document.title = `${data.rfq.label} · ${data.company.name}`;
  }, [data]);

  const total = useMemo(() => {
    if (!data) return 0;
    let t = 0;
    for (const item of data.items) {
      const p = price(lines[item.id]?.unitPrice ?? "");
      if (p !== null) t += p * item.qty;
    }
    return t + (price(meta.freight) ?? 0);
  }, [data, lines, meta.freight]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20">
        <Alert tone="bad" title="This link doesn't work">
          {loadError}
        </Alert>
      </div>
    );
  }
  if (!data) return <PageLoader />;
  const open = data.rfq.acceptingQuotes;
  const priced = data.items.filter((i) => price(lines[i.id]?.unitPrice ?? "") !== null).length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!priced) {
      setError("Enter a price for at least one item, or tell the buyer you can't quote.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const d = await api.post<PortalDto>(`/api/portal/${encodeURIComponent(token)}/quote`, {
        lines: data!.items.map((item) => {
          const l = lines[item.id];
          const lead = l.leadDays.trim() ? Math.round(Number(l.leadDays)) : null;
          return {
            itemId: item.id,
            unitPrice: price(l.unitPrice),
            leadDays: lead !== null && Number.isFinite(lead) && lead >= 0 ? lead : null,
            substitute: l.showSub && l.substitute.trim() ? l.substitute.trim() : null,
          };
        }),
        freight: price(meta.freight) ?? 0,
        validUntil: meta.validUntil || null,
        contactName: meta.contactName || null,
        reference: meta.reference || null,
        notes: meta.notes || null,
      });
      hydrate(d);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const setLine = (id: string, patch: Partial<Line>) => setLines((x) => ({ ...x, [id]: { ...x[id], ...patch } }));

  return (
    <div className="min-h-dvh pb-28 sm:pb-12">
      <header className="border-b border-line bg-surface" style={{ paddingLeft: "max(16px, env(safe-area-inset-left))", paddingRight: "max(16px, env(safe-area-inset-right))" }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <p className="eyebrow">Request for quote from</p>
            <p className="truncate font-display text-xl font-bold">{data.company.name}</p>
          </div>
          <Badge tone="brand">{data.rfq.label}</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-4xl py-6" style={{ paddingLeft: "max(16px, env(safe-area-inset-left))", paddingRight: "max(16px, env(safe-area-inset-right))" }}>
        <h1 className="text-2xl font-semibold tracking-tight">{data.rfq.title}</h1>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {data.rfq.jobName ? (
            <div>
              <dt className="eyebrow">Job</dt>
              <dd>{data.rfq.jobName}</dd>
            </div>
          ) : null}
          {data.rfq.siteAddress ? (
            <div>
              <dt className="eyebrow">Deliver to</dt>
              <dd>{data.rfq.siteAddress}</dd>
            </div>
          ) : null}
          {data.rfq.needBy ? (
            <div>
              <dt className="eyebrow">Needed by</dt>
              <dd>{date(data.rfq.needBy)}</dd>
            </div>
          ) : null}
          {data.rfq.dueAt ? (
            <div>
              <dt className="eyebrow">Quotes due</dt>
              <dd>{dateTime(data.rfq.dueAt)}</dd>
            </div>
          ) : null}
        </dl>
        {data.rfq.notes ? <p className="mt-3 rounded-ui bg-surface-2 px-3 py-2 text-sm">{data.rfq.notes}</p> : null}

        <div className="mt-6 flex flex-col gap-4">
          {!open ? (
            <Alert tone="info" title="This request is closed">
              {data.company.name} is no longer taking quotes for it. Thank you for your time.
            </Alert>
          ) : null}
          {data.declined && open && !editing ? (
            <Alert tone="info" title="You declined this request" action={<Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Quote anyway</Button>}>
              {data.company.name} knows you can't quote it this time.
            </Alert>
          ) : null}
          {data.quote && !editing ? (
            <Alert
              tone="good"
              title={`${data.company.name} has your prices`}
              action={open ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Change prices</Button> : undefined}
            >
              Sent {dateTime(data.quote.receivedAt)}. Total {money(total)} including freight.
              {open ? " You can change your prices until the request closes." : ""}
            </Alert>
          ) : null}
        </div>

        <form onSubmit={submit} className="mt-6" noValidate>
          <Card className="overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1fr)_110px_96px_110px] gap-3 border-b border-line bg-surface-2 px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase md:grid">
              <span>Item</span>
              <span>Unit price</span>
              <span>Lead (days)</span>
              <span className="text-right">Amount</span>
            </div>
            <ul className="divide-y divide-line">
              {data.items.map((item, n) => {
                const l = lines[item.id];
                const p = price(l?.unitPrice ?? "");
                return (
                  <li key={item.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_110px_96px_110px] md:items-start">
                    <div className="min-w-0">
                      <p className="font-medium">
                        <span className="mr-2 text-xs text-muted tabular">{n + 1}</span>
                        {item.description}
                      </p>
                      <p className="text-sm text-muted">
                        <span className="font-mono tabular">
                          {item.qty.toLocaleString()} {item.unit}
                        </span>
                        {item.partNumber ? ` · part ${item.partNumber}` : ""}
                        {item.notes ? ` · ${item.notes}` : ""}
                      </p>
                      {item.allowSubstitutes ? (
                        l?.showSub ? (
                          <Input
                            aria-label={`Substitute for ${item.description}`}
                            disabled={!editing || !open}
                            value={l.substitute}
                            onChange={(e) => setLine(item.id, { substitute: e.target.value })}
                            placeholder="Brand and part you're offering instead"
                            className="mt-2 h-9 text-sm"
                          />
                        ) : editing && open ? (
                          <button type="button" className="mt-1 text-xs font-medium text-brand-ink hover:underline" onClick={() => setLine(item.id, { showSub: true })}>
                            Offer a substitute
                          </button>
                        ) : null
                      ) : (
                        <p className="mt-1 text-xs text-warn">Exact item only, no substitutes.</p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:contents">
                      <label className="flex flex-col gap-1 md:block">
                        <span className="text-xs text-muted md:sr-only">Unit price ($ per {item.unit})</span>
                        <Input
                          inputMode="decimal"
                          disabled={!editing || !open}
                          value={l?.unitPrice ?? ""}
                          onChange={(e) => setLine(item.id, { unitPrice: e.target.value })}
                          placeholder="0.00"
                          className="h-10 font-mono tabular"
                          aria-label={`Unit price for ${item.description}`}
                        />
                      </label>
                      <label className="flex flex-col gap-1 md:block">
                        <span className="text-xs text-muted md:sr-only">Lead time (days)</span>
                        <Input
                          inputMode="numeric"
                          disabled={!editing || !open}
                          value={l?.leadDays ?? ""}
                          onChange={(e) => setLine(item.id, { leadDays: e.target.value })}
                          placeholder="0 = stock"
                          className="h-10 font-mono tabular"
                          aria-label={`Lead time in days for ${item.description}`}
                        />
                      </label>
                    </div>
                    <p className={cn("font-mono text-sm tabular md:pt-2.5 md:text-right", p === null && "text-muted")}>
                      <span className="mr-2 text-xs text-muted md:hidden">Amount</span>
                      {p === null ? "—" : money(p * item.qty)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="mt-4 grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Freight / delivery charge" hint="Leave empty if delivery is free.">
              {(id) => <Input id={id} inputMode="decimal" disabled={!editing || !open} value={meta.freight} onChange={(e) => setMeta({ ...meta, freight: e.target.value })} className="font-mono" placeholder="0.00" />}
            </Field>
            <Field label="Prices valid until">
              {(id) => <Input id={id} type="date" disabled={!editing || !open} value={meta.validUntil} onChange={(e) => setMeta({ ...meta, validUntil: e.target.value })} />}
            </Field>
            <Field label="Your name">{(id) => <Input id={id} disabled={!editing || !open} value={meta.contactName} onChange={(e) => setMeta({ ...meta, contactName: e.target.value })} />}</Field>
            <Field label="Your quote number (optional)">{(id) => <Input id={id} disabled={!editing || !open} value={meta.reference} onChange={(e) => setMeta({ ...meta, reference: e.target.value })} />}</Field>
            <Field label="Notes for the buyer" className="sm:col-span-2">
              {(id) => <Textarea id={id} rows={2} disabled={!editing || !open} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} placeholder="Payment terms, minimum order, delivery days" />}
            </Field>
          </Card>

          {error ? <Alert tone="bad" className="mt-4">{error}</Alert> : null}

          {editing && open ? (
            <div
              className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 py-3 backdrop-blur sm:static sm:mt-4 sm:border-0 sm:bg-transparent sm:p-0"
              style={{ paddingLeft: "max(16px, env(safe-area-inset-left))", paddingRight: "max(16px, env(safe-area-inset-right))", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
            >
              <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
                <p className="text-sm">
                  <span className="text-muted">
                    {priced} of {data.items.length} priced ·{" "}
                  </span>
                  <span className="font-mono font-semibold tabular">{money(total)}</span>
                </p>
                <Button type="submit" loading={saving} icon={<Send className="size-4" />}>
                  {data.quote ? "Update quote" : "Send quote"}
                </Button>
              </div>
            </div>
          ) : null}
        </form>

        {open && !data.declined && editing ? (
          <div className="mt-8 text-sm">
            {declineOpen ? (
              <Card className="flex flex-col gap-3 p-4">
                <Field label="Can't quote this one? Let the buyer know (optional reason)">
                  {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Out of stock, outside our area…" />}
                </Field>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        hydrate(await api.post<PortalDto>(`/api/portal/${encodeURIComponent(token)}/decline`, { reason: reason || null }));
                        setDeclineOpen(false);
                      } catch (err) {
                        setError(errorMessage(err));
                      }
                    }}
                  >
                    Decline to quote
                  </Button>
                  <Button variant="ghost" onClick={() => setDeclineOpen(false)}>
                    Never mind
                  </Button>
                </div>
              </Card>
            ) : (
              <button type="button" className="text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => setDeclineOpen(true)}>
                Can't quote this one?
              </button>
            )}
          </div>
        ) : null}

        <footer className="mt-12 flex flex-wrap items-center gap-2 border-t border-line pt-6 text-xs text-muted">
          <Mark className="size-4" />
          <span>
            {data.company.name} collects quotes with QuoteRunner. No account needed to answer.{" "}
            <a href="/" className="font-medium text-brand-ink hover:underline">
              Send your own requests for free
            </a>
            .
          </span>
          {data.quote && !editing ? <CheckCircle2 className="ml-auto size-4 text-good" aria-hidden="true" /> : null}
        </footer>
      </main>
    </div>
  );
}
