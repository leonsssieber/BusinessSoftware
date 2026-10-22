import { useState } from "react";
import { ClipboardPaste, Plus, Sparkles, Trash2 } from "lucide-react";
import { api, errorMessage } from "@ui/api";
import { Button } from "@ui/components/button";
import { Alert, Table, TD, TH } from "@ui/components/display";
import { Input, Select, Textarea } from "@ui/components/form";
import { cn } from "@ui/cn";
import type { ParsedItem } from "../../../shared/domain/parse";
import { UNITS } from "../../../shared/domain/text";

export interface DraftItem {
  key: string;
  description: string;
  qty: string;
  unit: string;
  partNumber: string;
  allowSubstitutes: boolean;
  needsReview?: boolean;
}

let seq = 0;
export const newKey = () => `k${Date.now()}-${seq++}`;

export function toDraft(i: { description: string; qty: number; unit: string; partNumber: string | null; allowSubstitutes?: boolean; needsReview?: boolean }): DraftItem {
  return {
    key: newKey(),
    description: i.description,
    qty: String(i.qty),
    unit: i.unit,
    partNumber: i.partNumber ?? "",
    allowSubstitutes: i.allowSubstitutes ?? true,
    needsReview: i.needsReview,
  };
}

export function fromDraft(items: DraftItem[]) {
  return items
    .filter((i) => i.description.trim())
    .map((i) => ({
      description: i.description.trim(),
      qty: Number(i.qty),
      unit: i.unit,
      partNumber: i.partNumber.trim() || null,
      allowSubstitutes: i.allowSubstitutes,
    }));
}

export function draftProblems(items: DraftItem[]): string | null {
  const real = items.filter((i) => i.description.trim());
  if (!real.length) return "Add at least one item.";
  const bad = real.findIndex((i) => !(Number(i.qty) > 0));
  if (bad >= 0) return `Line ${bad + 1} needs a quantity above zero.`;
  return null;
}

export function ItemsEditor({ items, onChange, parseUrl = "/api/rfqs/parse-list" }: { items: DraftItem[]; onChange: (items: DraftItem[]) => void; parseUrl?: string }) {
  const [paste, setPaste] = useState("");
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<{ tone: "info" | "bad" | "warn"; text: string } | null>(null);

  const update = (key: string, patch: Partial<DraftItem>) =>
    onChange(items.map((i) => (i.key === key ? { ...i, ...patch, needsReview: patch.qty !== undefined || patch.description !== undefined ? false : i.needsReview } : i)));

  async function read() {
    if (!paste.trim()) return;
    setReading(true);
    setNote(null);
    try {
      const res = await api.post<{ items: ParsedItem[]; method: "ai" | "heuristic" }>(parseUrl, { text: paste });
      const drafts = res.items.map((p) => toDraft(p));
      const keep = items.filter((i) => i.description.trim());
      onChange([...keep, ...drafts]);
      setPaste("");
      const flagged = drafts.filter((d) => d.needsReview).length;
      setNote({
        tone: flagged ? "warn" : "info",
        text: `Read ${drafts.length} ${drafts.length === 1 ? "line" : "lines"}${res.method === "ai" ? " with AI" : ""}.${flagged ? ` Check the ${flagged} highlighted ${flagged === 1 ? "line" : "lines"}: the quantity was a guess.` : ""}`,
      });
    } catch (err) {
      setNote({ tone: "bad", text: errorMessage(err) });
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-ui border border-dashed border-line-strong bg-surface-2/60 p-4">
        <label htmlFor="paste-list" className="mb-2 flex items-center gap-2 text-sm font-medium">
          <ClipboardPaste className="size-4 text-brand-ink" aria-hidden="true" /> Paste a material list
        </label>
        <Textarea
          id="paste-list"
          rows={5}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"200' 3/4 EMT\n50 3/4 EMT connectors\n(20) 4x4 boxes w/ mud rings\n12/2 Romex - 3 rolls"}
          className="font-mono text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">One item per line, from a text, email, takeoff or spreadsheet.</p>
          <Button size="sm" onClick={read} loading={reading} disabled={!paste.trim()} icon={<Sparkles className="size-4" />}>
            Read list
          </Button>
        </div>
      </div>
      {note ? <Alert tone={note.tone === "bad" ? "bad" : note.tone === "warn" ? "warn" : "info"}>{note.text}</Alert> : null}

      {items.length ? (
        <Table>
          <thead>
            <tr>
              <TH className="w-8">#</TH>
              <TH className="w-24">Qty</TH>
              <TH className="w-28">Unit</TH>
              <TH>Description</TH>
              <TH className="w-36">Part #</TH>
              <TH className="w-20 text-center">Subs OK</TH>
              <TH className="w-10">
                <span className="sr-only">Remove</span>
              </TH>
            </tr>
          </thead>
          <tbody>
            {items.map((it, n) => (
              <tr key={it.key} className={cn(it.needsReview && "bg-warn-soft/70")}>
                <TD className="pt-4 text-xs text-muted tabular">{n + 1}</TD>
                <TD>
                  <Input
                    aria-label={`Quantity, line ${n + 1}`}
                    inputMode="decimal"
                    value={it.qty}
                    onChange={(e) => update(it.key, { qty: e.target.value })}
                    className={cn("h-9 min-w-20 font-mono tabular", it.needsReview && "border-warn")}
                  />
                </TD>
                <TD>
                  <Select aria-label={`Unit, line ${n + 1}`} value={it.unit} onChange={(e) => update(it.key, { unit: e.target.value })} className="h-9 min-w-24">
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                    {!UNITS.includes(it.unit) ? <option value={it.unit}>{it.unit}</option> : null}
                  </Select>
                </TD>
                <TD className="min-w-56">
                  <Input aria-label={`Description, line ${n + 1}`} value={it.description} onChange={(e) => update(it.key, { description: e.target.value })} className="h-9" />
                </TD>
                <TD>
                  <Input aria-label={`Part number, line ${n + 1}`} value={it.partNumber} onChange={(e) => update(it.key, { partNumber: e.target.value })} className="h-9 min-w-32 font-mono" />
                </TD>
                <TD className="text-center">
                  <input
                    type="checkbox"
                    aria-label={`Accept substitutes, line ${n + 1}`}
                    checked={it.allowSubstitutes}
                    onChange={(e) => update(it.key, { allowSubstitutes: e.target.checked })}
                    className="mt-2.5 size-4 accent-[var(--k-brand)]"
                  />
                </TD>
                <TD>
                  <button
                    type="button"
                    className="mt-1 rounded-ui p-1.5 text-muted hover:bg-bad-soft hover:text-bad"
                    aria-label={`Remove line ${n + 1}`}
                    onClick={() => onChange(items.filter((x) => x.key !== it.key))}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus className="size-4" />}
          onClick={() => onChange([...items, { key: newKey(), description: "", qty: "1", unit: "ea", partNumber: "", allowSubstitutes: true }])}
        >
          Add a line
        </Button>
      </div>
    </div>
  );
}
