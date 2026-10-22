import { useEffect, useState } from "react";
import { LineChart, Lock } from "lucide-react";
import { useSession } from "@ui/auth";
import { ButtonLink } from "@ui/components/button";
import { Alert, Card, EmptyState, PageHeader, PageLoader, Table, TD, TH } from "@ui/components/display";
import { Input } from "@ui/components/form";
import { date, money } from "@ui/format";
import { useDocumentTitle, useResource } from "@ui/hooks";
import type { PriceRowDto } from "../../../shared/types";

/** Small line of quoted prices over time; awarded prices are filled dots. */
function Sparkline({ points }: { points: PriceRowDto["history"] }) {
  if (points.length < 2) return <span className="text-xs text-muted">—</span>;
  const w = 120;
  const h = 32;
  const pad = 4;
  const ys = points.map((p) => p.unitPrice);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (points.length - 1);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.unitPrice).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Prices from ${money(min)} to ${money(max)}`}>
      <path d={d} fill="none" stroke="var(--k-muted)" strokeWidth="1.25" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.unitPrice)} r={p.awarded ? 2.6 : 1.6} fill={p.awarded ? "var(--k-brand)" : "var(--k-surface)"} stroke={p.awarded ? "var(--k-brand)" : "var(--k-muted)"} strokeWidth="1" />
      ))}
    </svg>
  );
}

export function Prices() {
  useDocumentTitle("Price history", "QuoteRunner");
  const session = useSession();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const locked = session.org.plan === "free";
  const rows = useResource<PriceRowDto[]>(locked ? null : `/api/prices${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`);

  return (
    <div>
      <PageHeader title="Price history" description="Every price your suppliers quoted, and what you actually paid." />
      {locked ? (
        <Card>
          <EmptyState
            icon={<Lock className="size-8" />}
            title="Price history is on the Pro plan"
            action={<ButtonLink to="/app/settings/billing">See plans</ButtonLink>}
          >
            See the last price you paid for any item while you build a request, and spot suppliers whose prices creep up. Your quotes are already being recorded.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Input aria-label="Search items" placeholder="Search items, e.g. EMT" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-sm" />
          {rows.error ? <Alert tone="bad">{rows.error}</Alert> : null}
          {rows.loading && !rows.data ? (
            <PageLoader />
          ) : rows.data?.length ? (
            <Card>
              <Table>
                <thead>
                  <tr>
                    <TH>Item</TH>
                    <TH className="text-right">Last paid</TH>
                    <TH className="text-right">Lowest in 12 months</TH>
                    <TH>Trend</TH>
                    <TH className="text-right">Quotes</TH>
                  </tr>
                </thead>
                <tbody>
                  {rows.data.map((r) => (
                    <tr key={r.itemKey}>
                      <TD>
                        <p className="font-medium">{r.description}</p>
                        <p className="text-xs text-muted">per {r.unit}</p>
                      </TD>
                      <TD className="text-right">
                        {r.lastPaid ? (
                          <>
                            <p className="font-mono tabular">{money(r.lastPaid.unitPrice)}</p>
                            <p className="text-xs text-muted">
                              {r.lastPaid.supplierName} · {date(r.lastPaid.date)}
                            </p>
                          </>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD className="text-right">
                        {r.lowest ? (
                          <>
                            <p className="font-mono tabular">{money(r.lowest.unitPrice)}</p>
                            <p className="text-xs text-muted">{r.lowest.supplierName}</p>
                          </>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD>
                        <Sparkline points={r.history} />
                      </TD>
                      <TD className="text-right tabular text-muted">{r.observations}</TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : (
            <Card>
              <EmptyState icon={<LineChart className="size-8" />} title={debounced ? "No items match" : "No prices yet"}>
                Prices are recorded automatically from every quote you receive.
              </EmptyState>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
