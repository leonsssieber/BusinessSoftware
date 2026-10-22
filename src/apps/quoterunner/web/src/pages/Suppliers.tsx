import { useMemo, useState } from "react";
import { Archive, FileSpreadsheet, Pencil, Plus, Truck } from "lucide-react";
import { api, errorMessage } from "@ui/api";
import { Button } from "@ui/components/button";
import { Alert, Badge, Card, EmptyState, PageHeader, PageLoader, Table, TD, TH } from "@ui/components/display";
import { Field, Input, Textarea } from "@ui/components/form";
import { Modal } from "@ui/components/overlay";
import { useToast } from "@ui/components/toast";
import { cn } from "@ui/cn";
import { useDocumentTitle, useResource } from "@ui/hooks";
import { SUPPLIER_CATEGORIES } from "../../../shared/product";
import type { SupplierDto } from "../../../shared/types";

interface FormState {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  categories: string[];
  notes: string;
}

const empty: FormState = { name: "", contactName: "", email: "", phone: "", categories: [], notes: "" };

function SupplierModal({ supplier, open, onClose, onSaved }: { supplier: SupplierDto | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<FormState>(
    supplier
      ? {
          name: supplier.name,
          contactName: supplier.contactName ?? "",
          email: supplier.email ?? "",
          phone: supplier.phone ?? "",
          categories: supplier.categories,
          notes: supplier.notes ?? "",
        }
      : empty,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = { ...f, contactName: f.contactName || null, email: f.email || null, phone: f.phone || null, notes: f.notes || null };
      if (supplier) await api.patch(`/api/suppliers/${supplier.id}`, payload);
      else await api.post("/api/suppliers", payload);
      toast.success(supplier ? "Supplier saved." : `Added ${f.name}.`);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? `Edit ${supplier.name}` : "Add a supplier"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!f.name.trim()}>
            Save supplier
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error ? <Alert tone="bad" className="sm:col-span-2">{error}</Alert> : null}
        <Field label="Company" className="sm:col-span-2">
          {(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Northside Electric Supply" />}
        </Field>
        <Field label="Quote email" hint="Requests go here.">
          {(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="quotes@supplier.com" />}
        </Field>
        <Field label="Contact person">{(id) => <Input id={id} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />}</Field>
        <Field label="Phone">{(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium">What they sell</p>
          <div className="flex flex-wrap gap-1.5">
            {SUPPLIER_CATEGORIES.map((c) => {
              const on = f.categories.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setF({ ...f, categories: on ? f.categories.filter((x) => x !== c) : [...f.categories, c] })}
                  className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-muted hover:text-fg")}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Notes" className="sm:col-span-2">
          {(id) => <Textarea id={id} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Account #, delivery days, who to call" />}
        </Field>
      </div>
    </Modal>
  );
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import suppliers"
      description="Paste rows from a spreadsheet or attach a CSV. Columns: name, email, contact, phone."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={!csv.trim()}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                const r = await api.post<{ created: number; skipped: number }>("/api/suppliers/import", { csv });
                toast.success(`Imported ${r.created} suppliers${r.skipped ? `, skipped ${r.skipped} duplicates or blank rows` : ""}.`);
                setCsv("");
                onDone();
                onClose();
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setSaving(false);
              }
            }}
          >
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <Textarea
          aria-label="Supplier rows"
          rows={8}
          className="font-mono text-sm"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={"Name,Email,Contact,Phone\nNorthside Electric Supply,quotes@northside.com,Marco Diaz,555-0101"}
        />
        <label className="text-sm text-muted">
          Or choose a file:{" "}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setCsv(await file.text());
            }}
          />
        </label>
      </div>
    </Modal>
  );
}

export function Suppliers() {
  useDocumentTitle("Suppliers", "QuoteRunner");
  const toast = useToast();
  const list = useResource<SupplierDto[]>("/api/suppliers");
  const [editing, setEditing] = useState<SupplierDto | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState("");
  const rows = useMemo(
    () => (list.data ?? []).filter((s) => !q || `${s.name} ${s.contactName ?? ""} ${s.email ?? ""} ${s.categories.join(" ")}`.toLowerCase().includes(q.toLowerCase())),
    [list.data, q],
  );

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Who you buy from. Response times and win rates fill in as they quote."
        actions={
          <>
            <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} onClick={() => setImporting(true)}>
              Import
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
              Add supplier
            </Button>
          </>
        }
      />
      {list.error ? <Alert tone="bad">{list.error}</Alert> : null}
      {list.loading && !list.data ? (
        <PageLoader />
      ) : list.data?.length ? (
        <Card>
          <div className="border-b border-line p-3">
            <Input aria-label="Search suppliers" placeholder="Search suppliers" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
          </div>
          <Table>
            <thead>
              <tr>
                <TH>Supplier</TH>
                <TH>Sells</TH>
                <TH className="text-right">Quoted</TH>
                <TH className="text-right">Won</TH>
                <TH className="text-right">Avg. answer</TH>
                <TH className="w-20">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <TD>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted">{[s.contactName, s.email ?? "no email", s.phone].filter(Boolean).join(" · ")}</p>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {s.categories.slice(0, 3).map((c) => (
                        <Badge key={c}>{c}</Badge>
                      ))}
                      {s.categories.length > 3 ? <Badge>+{s.categories.length - 3}</Badge> : null}
                    </div>
                  </TD>
                  <TD className="text-right tabular">{s.stats.invited ? `${s.stats.quoted} of ${s.stats.invited}` : "—"}</TD>
                  <TD className="text-right tabular">{s.stats.won || "—"}</TD>
                  <TD className="text-right tabular">{s.stats.avgResponseHours !== null ? `${s.stats.avgResponseHours} h` : "—"}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <button type="button" className="rounded-ui p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded-ui p-1.5 text-muted hover:bg-bad-soft hover:text-bad"
                        aria-label={`Remove ${s.name}`}
                        onClick={async () => {
                          try {
                            const r = await api.delete<{ archived?: boolean }>(`/api/suppliers/${s.id}`);
                            toast.success(r.archived ? `${s.name} archived. Past quotes are kept.` : `${s.name} removed.`);
                            await list.reload();
                          } catch (err) {
                            toast.error(errorMessage(err));
                          }
                        }}
                      >
                        <Archive className="size-4" />
                      </button>
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<Truck className="size-8" />}
            title="Add the suppliers you buy from"
            action={
              <div className="flex gap-2">
                <Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
                  Add supplier
                </Button>
                <Button variant="secondary" onClick={() => setImporting(true)}>
                  Import a list
                </Button>
              </div>
            }
          >
            A name and a quote email is enough. They don't need an account.
          </EmptyState>
        </Card>
      )}
      {editing !== undefined ? <SupplierModal key={editing?.id ?? "new"} supplier={editing} open onClose={() => setEditing(undefined)} onSaved={list.reload} /> : null}
      <ImportModal open={importing} onClose={() => setImporting(false)} onDone={list.reload} />
    </div>
  );
}
