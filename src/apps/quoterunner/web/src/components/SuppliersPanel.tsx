import { useMemo, useState } from "react";
import { Bell, Check, Copy, FileInput, Pencil, Plus, Send, Trash2, UserPlus } from "lucide-react";
import { api, ApiError, errorMessage } from "@ui/api";
import { Button, ButtonLink } from "@ui/components/button";
import { Alert, Badge, Card, CardHeader, EmptyState } from "@ui/components/display";
import { Field, Input, Textarea } from "@ui/components/form";
import { Modal } from "@ui/components/overlay";
import { useToast } from "@ui/components/toast";
import { dateTime, money, relative } from "@ui/format";
import type { RfqDetailDto, SupplierDto } from "../../../shared/types";
import { InvitationBadge } from "./status";
import { draftFromQuote, ImportQuoteModal, QuoteEditorModal, type QuoteDraft } from "./QuoteEditor";

function AddSuppliersModal({
  rfq,
  suppliers,
  open,
  onClose,
  onDone,
  onSupplierCreated,
}: {
  rfq: RfqDetailDto;
  suppliers: SupplierDto[];
  open: boolean;
  onClose: () => void;
  onDone: (rfq: RfqDetailDto) => void;
  onSupplierCreated: () => void;
}) {
  const toast = useToast();
  const invited = new Set(rfq.invitations.map((i) => i.supplierId));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSup, setNewSup] = useState({ name: "", email: "" });
  const [creating, setCreating] = useState(false);

  const visible = suppliers.filter(
    (s) => !s.archived && (!q || s.name.toLowerCase().includes(q.toLowerCase()) || s.categories.some((c) => c.toLowerCase().includes(q.toLowerCase()))),
  );

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.post<RfqDetailDto>(`/api/rfqs/${rfq.id}/invitations`, { supplierIds: [...picked] });
      toast.success(`Added ${picked.size} ${picked.size === 1 ? "supplier" : "suppliers"}.`);
      setPicked(new Set());
      onDone(updated);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function create() {
    if (!newSup.name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const s = await api.post<SupplierDto>("/api/suppliers", { name: newSup.name, email: newSup.email || null });
      setPicked((p) => new Set(p).add(s.id));
      setNewSup({ name: "", email: "" });
      onSupplierCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose suppliers"
      description="They get an email with a quote link once you send."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} loading={saving} disabled={!picked.size}>
            Add {picked.size || ""} {picked.size === 1 ? "supplier" : "suppliers"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <Input aria-label="Search suppliers" placeholder="Search by name or trade" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto rounded-ui border border-line">
          {visible.length ? (
            visible.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                <input
                  id={`pick-${s.id}`}
                  type="checkbox"
                  className="size-4 accent-[var(--k-brand)]"
                  disabled={invited.has(s.id)}
                  checked={invited.has(s.id) || picked.has(s.id)}
                  onChange={(e) =>
                    setPicked((p) => {
                      const n = new Set(p);
                      if (e.target.checked) n.add(s.id);
                      else n.delete(s.id);
                      return n;
                    })
                  }
                />
                <label htmlFor={`pick-${s.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.name}</span>
                  <span className="block truncate text-xs text-muted">{s.email ?? "No email: you'll get a link to send yourself"}</span>
                </label>
                {invited.has(s.id) ? <Badge>On request</Badge> : s.categories[0] ? <Badge>{s.categories[0]}</Badge> : null}
              </li>
            ))
          ) : (
            <li className="px-3 py-6 text-center text-sm text-muted">No suppliers match. Add one below.</li>
          )}
        </ul>
        <div className="rounded-ui bg-surface-2 p-3">
          <p className="mb-2 text-sm font-medium">New supplier</p>
          <div className="flex flex-wrap items-end gap-2">
            <Input aria-label="Supplier name" placeholder="Supplier name" value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} className="min-w-40 flex-1" />
            <Input aria-label="Supplier email" type="email" placeholder="quotes@supplier.com" value={newSup.email} onChange={(e) => setNewSup({ ...newSup, email: e.target.value })} className="min-w-48 flex-1" />
            <Button variant="secondary" onClick={create} loading={creating} disabled={!newSup.name.trim()} icon={<Plus className="size-4" />}>
              Add
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function SuppliersPanel({
  rfq,
  suppliers,
  onChange,
  reloadSuppliers,
}: {
  rfq: RfqDetailDto;
  suppliers: SupplierDto[];
  onChange: (rfq: RfqDetailDto) => void;
  reloadSuppliers: () => void;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [manual, setManual] = useState<{ supplierName: string; portalUrl: string }[]>([]);
  const [editor, setEditor] = useState<{ draft: QuoteDraft; name: string; key: number } | null>(null);
  const [importFor, setImportFor] = useState<string | null | undefined>(undefined);
  const [limitHit, setLimitHit] = useState<string | null>(null);

  const closed = rfq.status === "awarded" || rfq.status === "cancelled" || rfq.status === "closed";
  const toSend = rfq.invitations.filter((i) => i.status === "pending");
  const totals = useMemo(() => new Map(rfq.comparison.suppliers.map((s) => [s.supplierId, s])), [rfq.comparison.suppliers]);

  async function send() {
    setPending("send");
    try {
      const res = await api.post<{ sent: number; manual: { supplierName: string; portalUrl: string }[]; rfq: RfqDetailDto }>(`/api/rfqs/${rfq.id}/send`, {
        message: message || null,
      });
      onChange(res.rfq);
      setManual(res.manual);
      setSendOpen(false);
      setMessage("");
      toast.success(res.sent ? `Emailed ${res.sent} ${res.sent === 1 ? "supplier" : "suppliers"}.` : "Quote links are ready.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  async function act(key: string, fn: () => Promise<RfqDetailDto | void>, done?: string) {
    setPending(key);
    try {
      const updated = await fn();
      if (updated) onChange(updated);
      if (done) toast.success(done);
    } catch (err) {
      if (err instanceof ApiError && err.code === "plan_limit") setLimitHit(err.message);
      else toast.error(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {limitHit ? (
        <Alert tone="warn" action={<ButtonLink size="sm" to="/app/settings/billing">See plans</ButtonLink>}>
          {limitHit}
        </Alert>
      ) : null}
      {manual.length ? (
        <Alert tone="info" title="Send these links yourself">
          <ul className="mt-1 flex flex-col gap-1">
            {manual.map((m) => (
              <li key={m.portalUrl} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.supplierName}:</span>
                <code className="min-w-0 truncate font-mono text-xs">{m.portalUrl}</code>
                <button type="button" className="text-brand-ink hover:underline" onClick={() => copy(m.portalUrl)}>
                  Copy
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Suppliers"
          description={
            rfq.invitations.length
              ? `${rfq.responded} of ${rfq.invited} answered${rfq.dueAt ? ` · quotes due ${dateTime(rfq.dueAt)}` : ""}`
              : "Pick who should quote this request."
          }
          actions={
            <>
              {!closed ? (
                <Button variant="secondary" size="sm" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
                  Add suppliers
                </Button>
              ) : null}
              <Button variant="secondary" size="sm" icon={<FileInput className="size-4" />} onClick={() => setImportFor(null)} disabled={!suppliers.length}>
                Read a quote
              </Button>
              {rfq.status === "open" && rfq.invitations.some((i) => i.status === "sent" || i.status === "viewed") ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Bell className="size-4" />}
                  loading={pending === "remind"}
                  onClick={() =>
                    act("remind", async () => {
                      const res = await api.post<{ reminded: number; rfq: RfqDetailDto }>(`/api/rfqs/${rfq.id}/remind`);
                      toast.success(res.reminded ? `Reminded ${res.reminded} ${res.reminded === 1 ? "supplier" : "suppliers"}.` : "Nobody to remind by email.");
                      return res.rfq;
                    })
                  }
                >
                  Remind
                </Button>
              ) : null}
              {toSend.length && !closed ? (
                <Button size="sm" icon={<Send className="size-4" />} onClick={() => setSendOpen(true)}>
                  Send to {toSend.length}
                </Button>
              ) : null}
            </>
          }
        />
        {rfq.invitations.length ? (
          <ul className="divide-y divide-line">
            {rfq.invitations.map((inv) => {
              const quote = rfq.quotes.find((q) => q.supplierId === inv.supplierId);
              const sum = totals.get(inv.supplierId);
              return (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <div className="min-w-48 flex-1">
                    <p className="font-medium">{inv.supplierName}</p>
                    <p className="text-xs text-muted">
                      {inv.supplierEmail ?? "No email on file"}
                      {inv.respondedAt ? ` · answered ${relative(inv.respondedAt)}` : inv.viewedAt ? ` · opened ${relative(inv.viewedAt)}` : inv.sentAt ? ` · sent ${relative(inv.sentAt)}` : ""}
                      {inv.reminderCount ? ` · reminded ${inv.reminderCount}×` : ""}
                    </p>
                    {inv.declineReason ? <p className="text-xs text-bad">“{inv.declineReason}”</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <InvitationBadge status={inv.status} />
                    {quote?.status === "needs_review" ? <Badge tone="warn">Check prices</Badge> : null}
                    {quote?.late ? <Badge tone="warn">Late</Badge> : null}
                  </div>
                  <div className="w-28 text-right font-mono text-sm tabular">{sum && sum.quotedLines ? money(sum.total) : "—"}</div>
                  <div className="flex items-center gap-1">
                    {quote?.status === "needs_review" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Check className="size-4" />}
                        loading={pending === `ok-${inv.id}`}
                        onClick={() => act(`ok-${inv.id}`, () => api.post<RfqDetailDto>(`/api/rfqs/${rfq.id}/quotes/${inv.supplierId}/approve`), "Marked as checked.")}
                      >
                        Prices are right
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Pencil className="size-4" />}
                      onClick={() => setEditor({ draft: draftFromQuote(rfq, inv.supplierId, quote), name: inv.supplierName, key: Date.now() })}
                    >
                      {quote ? "Edit quote" : "Enter quote"}
                    </Button>
                    <button type="button" className="rounded-ui p-2 text-muted hover:bg-surface-2 hover:text-fg" title="Copy quote link" aria-label={`Copy quote link for ${inv.supplierName}`} onClick={() => copy(inv.portalUrl)}>
                      <Copy className="size-4" />
                    </button>
                    {!quote && !closed ? (
                      <button
                        type="button"
                        className="rounded-ui p-2 text-muted hover:bg-bad-soft hover:text-bad"
                        aria-label={`Remove ${inv.supplierName}`}
                        title="Remove from request"
                        onClick={() => act(`rm-${inv.id}`, () => api.delete<RfqDetailDto>(`/api/rfqs/${rfq.id}/invitations/${inv.id}`))}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title="No suppliers on this request yet"
            action={
              <Button icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
                Add suppliers
              </Button>
            }
          >
            Ask at least three. Prices on the same list often differ by 10–20% between suppliers.
          </EmptyState>
        )}
      </Card>

      <AddSuppliersModal
        rfq={rfq}
        suppliers={suppliers}
        open={adding}
        onClose={() => setAdding(false)}
        onDone={onChange}
        onSupplierCreated={reloadSuppliers}
      />

      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title={`Send to ${toSend.length} ${toSend.length === 1 ? "supplier" : "suppliers"}`}
        description="Each gets an email with the item list and a personal link to enter prices."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSendOpen(false)}>
              Cancel
            </Button>
            <Button onClick={send} loading={pending === "send"} icon={<Send className="size-4" />}>
              Send request
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <ul className="text-sm">
            {toSend.map((i) => (
              <li key={i.id}>
                {i.supplierName} <span className="text-muted">{i.supplierEmail ? `· ${i.supplierEmail}` : "· no email, you'll get a link"}</span>
              </li>
            ))}
          </ul>
          <Field label="Message (optional)">
            {(id) => <Textarea id={id} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="We need this delivered Thursday morning." />}
          </Field>
          {!rfq.dueAt ? <p className="text-xs text-muted">No due date set, so suppliers get 3 days.</p> : null}
        </div>
      </Modal>

      {editor ? (
        <QuoteEditorModal key={editor.key} rfq={rfq} draft={editor.draft} supplierName={editor.name} open onClose={() => setEditor(null)} onSaved={onChange} />
      ) : null}
      {importFor !== undefined ? (
        <ImportQuoteModal
          rfq={rfq}
          suppliers={suppliers}
          open
          initialSupplierId={importFor ?? undefined}
          onClose={() => setImportFor(undefined)}
          onExtracted={(draft, name) => {
            setImportFor(undefined);
            setEditor({ draft, name, key: Date.now() });
          }}
        />
      ) : null}
    </div>
  );
}
