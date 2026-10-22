import { useMemo, useState } from "react";
import { FileUp, Sparkles } from "lucide-react";
import { api, errorMessage } from "@ui/api";
import { Button } from "@ui/components/button";
import { Alert, Badge, Table, TD, TH } from "@ui/components/display";
import { Field, Input, Select, Textarea } from "@ui/components/form";
import { Modal } from "@ui/components/overlay";
import { useToast } from "@ui/components/toast";
import { cn } from "@ui/cn";
import { money, priceInput } from "@ui/format";
import type { ExtractResponse, QuoteDto, RfqDetailDto, SupplierDto } from "../../../shared/types";

interface LineState {
  unitPrice: string;
  leadDays: string;
  substitute: string;
  note: string;
  confidence?: number;
}

export interface QuoteDraft {
  supplierId: string;
  source: "manual" | "email";
  lines: Record<string, LineState>;
  freight: string;
  tax: string;
  validUntil: string;
  reference: string;
  contactName: string;
  notes: string;
  rawText?: string;
  method?: "ai" | "heuristic";
}

const s = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export function draftFromQuote(rfq: RfqDetailDto, supplierId: string, q?: QuoteDto | null): QuoteDraft {
  const lines: Record<string, LineState> = {};
  for (const item of rfq.items) {
    const l = q?.lines.find((x) => x.itemId === item.id);
    lines[item.id] = { unitPrice: priceInput(l?.unitPrice), leadDays: s(l?.leadDays), substitute: l?.substitute ?? "", note: l?.note ?? "" };
  }
  return {
    supplierId,
    source: q?.source === "email" ? "email" : "manual",
    lines,
    freight: q ? priceInput(q.freight) : "",
    tax: q ? priceInput(q.tax || null) : "",
    validUntil: q?.validUntil ?? "",
    reference: q?.reference ?? "",
    contactName: q?.contactName ?? "",
    notes: q?.notes ?? "",
  };
}

export function draftFromExtract(rfq: RfqDetailDto, supplierId: string, x: ExtractResponse, rawText: string): QuoteDraft {
  const lines: Record<string, LineState> = {};
  for (const item of rfq.items) {
    const l = x.lines.find((y) => y.itemId === item.id);
    lines[item.id] = {
      unitPrice: priceInput(l?.unitPrice),
      leadDays: s(l?.leadDays),
      substitute: l?.substitute ?? "",
      note: l?.note ?? "",
      confidence: l?.confidence,
    };
  }
  return {
    supplierId,
    source: "email",
    lines,
    freight: priceInput(x.freight),
    tax: priceInput(x.tax),
    validUntil: x.validUntil ?? "",
    reference: x.reference ?? "",
    contactName: x.contactName ?? "",
    notes: x.notes ?? "",
    rawText,
    method: x.method,
  };
}

const num = (v: string): number | null => {
  const t = v.replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Enter or review one supplier's prices for every line of the request. */
export function QuoteEditorModal({
  rfq,
  draft,
  supplierName,
  open,
  onClose,
  onSaved,
}: {
  rfq: RfqDetailDto;
  draft: QuoteDraft;
  supplierName: string;
  open: boolean;
  onClose: () => void;
  onSaved: (rfq: RfqDetailDto) => void;
}) {
  const toast = useToast();
  const [d, setD] = useState(draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => {
    let sum = 0;
    for (const item of rfq.items) {
      const p = num(d.lines[item.id]?.unitPrice ?? "");
      if (p !== null) sum += p * item.qty;
    }
    return sum + (num(d.freight) ?? 0);
  }, [d, rfq.items]);

  const setLine = (id: string, patch: Partial<LineState>) => setD((x) => ({ ...x, lines: { ...x.lines, [id]: { ...x.lines[id], ...patch, confidence: undefined } } }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.put<RfqDetailDto>(`/api/rfqs/${rfq.id}/quotes/${d.supplierId}`, {
        source: d.source,
        rawText: d.rawText ?? null,
        lines: rfq.items.map((item) => {
          const l = d.lines[item.id];
          const lead = l.leadDays.trim() ? Math.round(Number(l.leadDays)) : null;
          return {
            itemId: item.id,
            unitPrice: num(l.unitPrice),
            leadDays: lead !== null && Number.isFinite(lead) && lead >= 0 ? lead : null,
            substitute: l.substitute.trim() || null,
            note: l.note.trim() || null,
          };
        }),
        freight: num(d.freight) ?? 0,
        tax: num(d.tax) ?? 0,
        validUntil: d.validUntil || null,
        reference: d.reference || null,
        contactName: d.contactName || null,
        notes: d.notes || null,
      });
      toast.success(`Saved ${supplierName}'s quote.`);
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const unsure = Object.values(d.lines).filter((l) => l.confidence !== undefined && l.confidence < 0.6 && l.unitPrice).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`${supplierName}: quote`}
      description={d.method ? `Read ${d.method === "ai" ? "with AI" : "automatically"}. Check the prices, then save.` : "Enter the supplier's price for each line. Leave a price empty if they didn't quote it."}
      footer={
        <>
          <span className="mr-auto self-center font-mono text-sm tabular">Total with freight: {money(total)}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save quote
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="bad">{error}</Alert> : null}
        {unsure ? <Alert tone="warn">{unsure} highlighted {unsure === 1 ? "price was" : "prices were"} hard to match. Check them against the supplier's quote.</Alert> : null}
        <Table>
          <thead>
            <tr>
              <TH>Item</TH>
              <TH className="w-28">Unit price</TH>
              <TH className="w-24">Lead days</TH>
              <TH className="min-w-40">Substitute offered</TH>
            </tr>
          </thead>
          <tbody>
            {rfq.items.map((item) => {
              const l = d.lines[item.id];
              const flagged = l.confidence !== undefined && l.confidence < 0.6 && l.unitPrice !== "";
              return (
                <tr key={item.id} className={cn(flagged && "bg-warn-soft/70")}>
                  <TD>
                    <p className="font-medium">{item.description}</p>
                    <p className="text-xs text-muted">
                      {item.qty} {item.unit}
                      {item.partNumber ? ` · ${item.partNumber}` : ""}
                      {l.note ? ` · ${l.note}` : ""}
                    </p>
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Unit price for ${item.description}`}
                      inputMode="decimal"
                      value={l.unitPrice}
                      onChange={(e) => setLine(item.id, { unitPrice: e.target.value })}
                      className="h-9 font-mono tabular"
                      placeholder="—"
                    />
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Lead time in days for ${item.description}`}
                      inputMode="numeric"
                      value={l.leadDays}
                      onChange={(e) => setLine(item.id, { leadDays: e.target.value })}
                      className="h-9 font-mono tabular"
                      placeholder="0 = stock"
                    />
                  </TD>
                  <TD>
                    <Input
                      aria-label={`Substitute for ${item.description}`}
                      value={l.substitute}
                      onChange={(e) => setLine(item.id, { substitute: e.target.value })}
                      className="h-9"
                      placeholder={item.allowSubstitutes ? "As specified" : "Exact item required"}
                    />
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Freight / delivery">{(id) => <Input id={id} inputMode="decimal" value={d.freight} onChange={(e) => setD({ ...d, freight: e.target.value })} className="font-mono" placeholder="0.00" />}</Field>
          <Field label="Tax">{(id) => <Input id={id} inputMode="decimal" value={d.tax} onChange={(e) => setD({ ...d, tax: e.target.value })} className="font-mono" placeholder="0.00" />}</Field>
          <Field label="Valid until">{(id) => <Input id={id} type="date" value={d.validUntil} onChange={(e) => setD({ ...d, validUntil: e.target.value })} />}</Field>
          <Field label="Their quote #">{(id) => <Input id={id} value={d.reference} onChange={(e) => setD({ ...d, reference: e.target.value })} />}</Field>
          <Field label="Contact">{(id) => <Input id={id} value={d.contactName} onChange={(e) => setD({ ...d, contactName: e.target.value })} />}</Field>
          <Field label="Notes" className="sm:col-span-1">{(id) => <Input id={id} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />}</Field>
        </div>
      </div>
    </Modal>
  );
}

/** Paste a supplier's email or attach their PDF; the quote is read into a draft to review. */
export function ImportQuoteModal({
  rfq,
  suppliers,
  open,
  initialSupplierId,
  onClose,
  onExtracted,
}: {
  rfq: RfqDetailDto;
  suppliers: SupplierDto[];
  open: boolean;
  initialSupplierId?: string;
  onClose: () => void;
  onExtracted: (draft: QuoteDraft, supplierName: string) => void;
}) {
  const [supplierId, setSupplierId] = useState(initialSupplierId ?? rfq.invitations[0]?.supplierId ?? suppliers[0]?.id ?? "");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => {
    const invited = new Set(rfq.invitations.map((i) => i.supplierId));
    return [...suppliers].sort((a, b) => Number(invited.has(b.id)) - Number(invited.has(a.id)) || a.name.localeCompare(b.name));
  }, [rfq.invitations, suppliers]);

  async function read() {
    setReading(true);
    setError(null);
    try {
      let pdfBase64: string | null = null;
      if (file) {
        if (file.size > 10 * 1024 * 1024) throw new Error("The PDF is larger than 10 MB.");
        pdfBase64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
          r.onerror = () => reject(new Error("Couldn't read the file."));
          r.readAsDataURL(file);
        });
      }
      const x = await api.post<ExtractResponse>(`/api/rfqs/${rfq.id}/extract`, { text: text || null, pdfBase64 });
      const name = suppliers.find((sp) => sp.id === supplierId)?.name ?? "Supplier";
      onExtracted(draftFromExtract(rfq, supplierId, x, text), name);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setReading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Read a quote from email or PDF"
      description="Paste the supplier's reply or attach their PDF. You'll check the prices before anything is saved."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={read} loading={reading} disabled={!supplierId || (!text.trim() && !file)} icon={<Sparkles className="size-4" />}>
            Read quote
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <Field label="Supplier">
          {(id) => (
            <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {options.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Quote text" hint="Paste the email body, or text copied from their PDF or spreadsheet.">
          {(id) => <Textarea id={id} rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-sm" />}
        </Field>
        <label className="flex cursor-pointer items-center gap-3 rounded-ui border border-dashed border-line-strong px-4 py-3 text-sm hover:bg-surface-2">
          <FileUp className="size-4 text-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{file ? file.name : "Attach their PDF quote (needs AI)"}</span>
          {file ? <Badge>{Math.round(file.size / 1024)} KB</Badge> : null}
          <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>
    </Modal>
  );
}
