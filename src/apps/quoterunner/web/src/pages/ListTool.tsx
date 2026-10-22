import { useMemo, useState } from "react";
import { ClipboardCopy, Download, Sparkles } from "lucide-react";
import { buttonClass } from "@ui/components/button";
import { Alert, Card, Table, TD, TH } from "@ui/components/display";
import { Textarea } from "@ui/components/form";
import { cn } from "@ui/cn";
import { parseItemList } from "../../../shared/domain/parse";
import { Logo } from "../brand";

const SAMPLE = `Need for Maple St unit 4:
200' 3/4 EMT
50 3/4 EMT set screw connectors
(20) 4x4 boxes w/ mud rings
12/2 Romex - 3 rolls
25 Square D breaker part # QO120
Plywood 3/4 CDX: 40 sheets`;

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Free public tool: turns a messy material list into a clean RFQ table. Runs entirely in the browser. */
export function ListTool() {
  const [text, setText] = useState(SAMPLE);
  const [copied, setCopied] = useState(false);
  const items = useMemo(() => parseItemList(text), [text]);
  const flagged = items.filter((i) => i.needsReview).length;

  const emailText = useMemo(
    () =>
      [
        "Hi,",
        "",
        "Could you quote the following, with lead times?",
        "",
        ...items.map((i, n) => `${n + 1}. ${i.qty} ${i.unit}  ${i.description}${i.partNumber ? `  (part ${i.partNumber})` : ""}`),
        "",
        "Thanks,",
      ].join("\n"),
    [items],
  );

  function download() {
    const rows = [["Line", "Qty", "Unit", "Description", "Part number"], ...items.map((i, n) => [String(n + 1), String(i.qty), i.unit, i.description, i.partNumber ?? ""])];
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "material-list.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface" style={{ paddingLeft: "max(16px, env(safe-area-inset-left))", paddingRight: "max(16px, env(safe-area-inset-right))" }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between py-3">
          <a href="/">
            <Logo />
          </a>
          <a href="/signup" className={buttonClass("primary", "sm")}>
            Start free
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-5xl py-10" style={{ paddingLeft: "max(16px, env(safe-area-inset-left))", paddingRight: "max(16px, env(safe-area-inset-right))" }}>
        <p className="eyebrow">Free tool</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Material list cleaner</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Paste a list from a text, email or takeoff. Get clean lines with quantities, units and part numbers, ready to send to suppliers. Nothing leaves your browser.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="tool-input" className="text-sm font-medium">
              Your list
            </label>
            <Textarea id="tool-input" rows={14} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-sm" />
            <button type="button" className="self-start text-sm text-muted hover:text-fg" onClick={() => setText("")}>
              Clear
            </button>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {items.length} {items.length === 1 ? "line" : "lines"}
                {flagged ? <span className="text-warn"> · check {flagged} highlighted</span> : null}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={buttonClass("secondary", "sm")}
                  disabled={!items.length}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(emailText);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  <ClipboardCopy className="size-4" /> {copied ? "Copied" : "Copy as email"}
                </button>
                <button type="button" className={buttonClass("secondary", "sm")} disabled={!items.length} onClick={download}>
                  <Download className="size-4" /> CSV
                </button>
              </div>
            </div>
            <Card className="min-w-0">
              <Table>
                <thead>
                  <tr>
                    <TH className="text-right">Qty</TH>
                    <TH>Unit</TH>
                    <TH>Description</TH>
                    <TH>Part #</TH>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i, n) => (
                    <tr key={n} className={cn(i.needsReview && "bg-warn-soft/70")}>
                      <TD className="text-right font-mono tabular">{i.qty.toLocaleString()}</TD>
                      <TD className="text-muted">{i.unit}</TD>
                      <TD>{i.description}</TD>
                      <TD className="font-mono text-muted">{i.partNumber ?? ""}</TD>
                    </tr>
                  ))}
                  {!items.length ? (
                    <tr>
                      <TD colSpan={4} className="py-8 text-center text-muted">
                        Paste a list on the left.
                      </TD>
                    </tr>
                  ) : null}
                </tbody>
              </Table>
            </Card>
            {flagged ? <Alert tone="warn">Highlighted lines had no clear quantity, so they're set to 1. Fix them before sending.</Alert> : null}
          </div>
        </div>

        <Card className="mt-10 flex flex-wrap items-center gap-6 border-brand/30 bg-brand-soft/60 p-6">
          <Sparkles className="size-8 text-brand-ink" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">Send this list to all your suppliers at once</h2>
            <p className="mt-1 text-muted">
              QuoteRunner emails it, collects every price on one page, reads quotes that come back by email or PDF, and shows the cheapest way to buy, freight included.
            </p>
          </div>
          <a href="/signup" className={buttonClass("primary", "lg")}>
            Try it free
          </a>
        </Card>
      </main>
    </div>
  );
}
