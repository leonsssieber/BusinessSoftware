import { useEffect, useMemo, useState } from "react";
import { Award as AwardIcon, Scale, Split } from "lucide-react";
import { api, errorMessage } from "@ui/api";
import { Button } from "@ui/components/button";
import { Alert, Badge, Card, EmptyState } from "@ui/components/display";
import { Checkbox } from "@ui/components/form";
import { useToast } from "@ui/components/toast";
import { cn } from "@ui/cn";
import { date, money } from "@ui/format";
import { evaluateAward } from "../../../shared/domain/compare";
import type { RfqDetailDto } from "../../../shared/types";

export interface CompareOptionsState {
  excludeLate: boolean;
  subs: boolean;
}

function lead(days: number | null) {
  if (days === null) return null;
  if (days === 0) return "stock";
  return `${days} d`;
}

export function ComparePanel({
  rfq,
  options,
  onOptions,
  onChange,
}: {
  rfq: RfqDetailDto;
  options: CompareOptionsState;
  onOptions: (o: CompareOptionsState) => void;
  onChange: (rfq: RfqDetailDto) => void;
}) {
  const toast = useToast();
  const c = rfq.comparison;
  const [assignments, setAssignments] = useState<Record<string, string>>(c.bestSplit?.assignments ?? {});
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAssignments(c.bestSplit?.assignments ?? {});
  }, [c.bestSplit]);

  const quotes = useMemo(
    () => rfq.quotes.map((q) => ({ supplierId: q.supplierId, supplierName: q.supplierName, freight: q.freight, lines: q.lines })),
    [rfq.quotes],
  );
  const items = useMemo(
    () => rfq.items.map((i) => ({ id: i.id, description: i.description, qty: i.qty, unit: i.unit, allowSubstitutes: i.allowSubstitutes })),
    [rfq.items],
  );
  const selection = useMemo(() => evaluateAward(items, quotes, assignments), [items, quotes, assignments]);
  const names = new Map(rfq.quotes.map((q) => [q.supplierId, q.supplierName]));
  const awarded = rfq.status === "awarded";
  const reviewPending = rfq.quotes.filter((q) => q.status === "needs_review");

  const same = (a: Record<string, string> | undefined) =>
    a && Object.keys(a).length === Object.keys(assignments).length && Object.entries(a).every(([k, v]) => assignments[k] === v);
  const mode = same(c.bestSplit?.assignments) ? "split" : same(c.bestSingle?.assignments) ? "single" : "custom";

  if (!rfq.quotes.length) {
    return (
      <Card>
        <EmptyState icon={<Scale className="size-8" />} title="No quotes yet">
          Quotes appear here as suppliers answer. You can also type in a quote someone gave you by phone.
        </EmptyState>
      </Card>
    );
  }

  async function award() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.post<RfqDetailDto>(`/api/rfqs/${rfq.id}/award`, { assignments: selection.assignments, notifyOthers: notify });
      toast.success(`Created ${updated.purchaseOrders.length} purchase ${updated.purchaseOrders.length === 1 ? "order" : "orders"}.`);
      onChange(updated);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {awarded ? (
        <Alert tone="good" title={`Awarded ${date(rfq.awardedAt)}`}>
          Purchase orders are on the Orders tab. Cancel them there if you need to award again.
        </Alert>
      ) : null}
      {reviewPending.length && !awarded ? (
        <Alert tone="warn">
          {reviewPending.map((q) => q.supplierName).join(", ")} {reviewPending.length === 1 ? "was" : "were"} read from email. Check those prices on the Suppliers tab before you award.
        </Alert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <button
          type="button"
          disabled={awarded || !c.bestSingle}
          onClick={() => c.bestSingle && setAssignments(c.bestSingle.assignments)}
          className={cn("rounded-ui border bg-surface p-4 text-left transition-colors hover:border-brand/60 disabled:cursor-default", mode === "single" ? "border-brand ring-1 ring-brand/40" : "border-line")}
        >
          <span className="eyebrow flex items-center gap-1.5">
            <AwardIcon className="size-3.5" aria-hidden="true" /> Best single supplier
          </span>
          {c.bestSingle ? (
            <>
              <p className="mt-1 font-semibold">{names.get(c.bestSingle.suppliers[0])}</p>
              <p className="font-mono text-xl font-semibold tabular">{money(c.bestSingle.total)}</p>
              <p className="text-xs text-muted">
                {c.bestSingle.missingItemIds.length ? `Missing ${c.bestSingle.missingItemIds.length} of ${rfq.items.length} items` : "Covers every item"} · freight included
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">No usable bids.</p>
          )}
        </button>
        <button
          type="button"
          disabled={awarded || !c.bestSplit}
          onClick={() => c.bestSplit && setAssignments(c.bestSplit.assignments)}
          className={cn("rounded-ui border bg-surface p-4 text-left transition-colors hover:border-brand/60 disabled:cursor-default", mode === "split" ? "border-brand ring-1 ring-brand/40" : "border-line")}
        >
          <span className="eyebrow flex items-center gap-1.5">
            <Split className="size-3.5" aria-hidden="true" /> Cheapest way to buy
          </span>
          {c.bestSplit ? (
            <>
              <p className="mt-1 font-semibold">
                {c.bestSplit.suppliers.length === 1 ? names.get(c.bestSplit.suppliers[0]) : `${c.bestSplit.suppliers.length} suppliers`}
              </p>
              <p className="font-mono text-xl font-semibold tabular">{money(c.bestSplit.total)}</p>
              <p className="text-xs text-muted">
                {c.splitSavings && c.splitSavings > 0 ? `${money(c.splitSavings)} less than the best single supplier` : "Splitting the order doesn't save more"}
              </p>
            </>
          ) : null}
        </button>
        <div className="rounded-ui border border-line bg-brand-soft/50 p-4">
          <span className="eyebrow">Your selection</span>
          <p className="mt-1 font-semibold">
            {selection.suppliers.length === 1 ? names.get(selection.suppliers[0]) : `${selection.suppliers.length} suppliers`}
            {mode === "custom" ? <span className="ml-2 align-middle text-xs font-normal text-muted">picked by hand</span> : null}
          </p>
          <p className="font-mono text-xl font-semibold tabular">{money(selection.total)}</p>
          <p className="text-xs text-muted">
            {selection.missingItemIds.length ? `${selection.missingItemIds.length} items without a supplier · ` : ""}
            {c.savingsVsAverage !== null && c.savingsVsAverage > 0 && mode === "split" ? `${money(c.savingsVsAverage)} under the average quote` : "Click a price to change who gets that item"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Checkbox
          label="Hide bids that can't make the need-by date"
          checked={options.excludeLate}
          disabled={!rfq.needBy}
          onChange={(e) => onOptions({ ...options, excludeLate: e.target.checked })}
        />
        <Checkbox label="Accept substitutes where allowed" checked={options.subs} onChange={(e) => onOptions({ ...options, subs: e.target.checked })} />
      </div>

      <Card className="min-w-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-56 border-b border-line bg-surface-2 px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted uppercase">Item</th>
                {rfq.quotes.map((q) => (
                  <th key={q.supplierId} className="min-w-36 border-b border-l border-line bg-surface-2 px-3 py-2 text-left align-bottom">
                    <span className="block truncate text-sm font-semibold text-fg">{q.supplierName}</span>
                    <span className="flex gap-1">
                      {q.status === "needs_review" ? <Badge tone="warn">Check</Badge> : null}
                      {q.late ? <Badge tone="warn">Late</Badge> : null}
                      {q.validUntil ? <span className="text-xs text-muted">valid to {date(q.validUntil)}</span> : null}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rfq.items.map((item, n) => {
                const row = c.rows[n];
                return (
                  <tr key={item.id}>
                    <td className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2.5 align-top">
                      <p className="font-medium">{item.description}</p>
                      <p className="text-xs text-muted tabular">
                        {item.qty.toLocaleString()} {item.unit}
                        {row?.spread !== null && row?.spread !== undefined && row.spread > 0.05 ? ` · prices differ ${Math.round(row.spread * 100)}%` : ""}
                      </p>
                    </td>
                    {rfq.quotes.map((q) => {
                      const cell = row?.cells[q.supplierId];
                      if (!cell) {
                        return (
                          <td key={q.supplierId} className="border-b border-l border-line px-3 py-2.5 text-muted">
                            —
                          </td>
                        );
                      }
                      const selected = assignments[item.id] === q.supplierId;
                      return (
                        <td key={q.supplierId} className={cn("border-b border-l border-line p-1 align-top", cell.best && !cell.excluded && "bg-accent-soft")}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={`${q.supplierName}, ${item.description}, ${money(cell.unitPrice)} each`}
                            disabled={awarded || cell.excluded}
                            onClick={() => setAssignments((a) => ({ ...a, [item.id]: q.supplierId }))}
                            className={cn(
                              "w-full rounded-[3px] px-2 py-1.5 text-left transition-colors",
                              selected ? "ring-2 ring-brand" : "hover:bg-surface-2/70",
                              cell.excluded && "opacity-45",
                            )}
                          >
                            <span className="block font-mono font-semibold tabular">{money(cell.unitPrice)}</span>
                            <span className="block font-mono text-xs text-muted tabular">{money(cell.ext)}</span>
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              {lead(cell.leadDays) ? <span className="text-xs text-muted">{lead(cell.leadDays)}</span> : null}
                              {cell.substitute ? (
                                <span title={cell.substitute}>
                                  <Badge tone="warn">sub</Badge>
                                </span>
                              ) : null}
                              {cell.late ? <Badge tone="bad">late</Badge> : null}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {(["Items quoted", "Freight", "Total"] as const).map((label) => (
                <tr key={label} className={label === "Total" ? "font-semibold" : ""}>
                  <td className="sticky left-0 z-10 border-b border-line bg-surface-2 px-3 py-2 text-xs tracking-wide text-muted uppercase">{label}</td>
                  {rfq.quotes.map((q) => {
                    const s = c.suppliers.find((x) => x.supplierId === q.supplierId)!;
                    return (
                      <td key={q.supplierId} className="border-b border-l border-line bg-surface-2 px-3 py-2 font-mono tabular">
                        {label === "Items quoted" ? `${s.quotedLines} of ${rfq.items.length}` : label === "Freight" ? money(s.freight) : money(s.total)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </Card>

      {!awarded && rfq.status !== "cancelled" ? (
        <Card className="flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              Award {Object.keys(selection.assignments).length} of {rfq.items.length} items for <span className="font-mono tabular">{money(selection.total)}</span>
            </p>
            <p className="text-sm text-muted">Creates one purchase order per supplier. You can review each before emailing it.</p>
          </div>
          <Checkbox label="Thank the other suppliers by email" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <Button onClick={award} loading={saving} disabled={!Object.keys(selection.assignments).length} icon={<AwardIcon className="size-4" />}>
            Award and create POs
          </Button>
          {error ? <Alert tone="bad" className="w-full">{error}</Alert> : null}
        </Card>
      ) : null}
    </div>
  );
}
