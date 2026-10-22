import { Link, useNavigate } from "react-router";
import { AlertCircle, CheckCircle2, ClipboardPaste, FileText, Plus, Send, Truck } from "lucide-react";
import { useSession } from "@ui/auth";
import { ButtonLink } from "@ui/components/button";
import { Alert, Card, CardHeader, PageHeader, PageLoader, Stat, Table, TD, TH } from "@ui/components/display";
import { date, dateTime, money, relative } from "@ui/format";
import { useDocumentTitle, useResource } from "@ui/hooks";
import type { DashboardDto, SupplierDto } from "../../../shared/types";
import { ResponseMeter } from "../components/status";

const attentionIcon = {
  review: FileText,
  ready: CheckCircle2,
  overdue: AlertCircle,
  draft: Send,
};

function GettingStarted({ suppliers }: { suppliers: number }) {
  const steps = [
    { done: suppliers > 0, title: "Add your suppliers", body: "Name and email is enough. You can paste a list from a spreadsheet.", to: "/app/suppliers", icon: Truck },
    { done: false, title: "Paste a material list", body: "Copy it from a text, email or takeoff. We turn it into clean line items.", to: "/app/requests/new", icon: ClipboardPaste },
    { done: false, title: "Send it and compare", body: "Suppliers price it on a link or reply by email. You get one table with the best buy highlighted.", to: "/app/requests/new", icon: Send },
  ];
  return (
    <Card className="mb-6">
      <CardHeader title="Get your first quotes in today" description="Three steps. Most people finish the first request in about ten minutes." />
      <ol className="grid gap-px bg-line sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="bg-surface p-5">
            <Link to={s.to} className="group flex h-full flex-col gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className={`grid size-6 place-items-center rounded-full text-xs ${s.done ? "bg-good text-white" : "bg-brand-soft text-brand-ink"}`}>
                  {s.done ? "✓" : i + 1}
                </span>
                <span className="group-hover:underline">{s.title}</span>
              </span>
              <span className="text-sm text-muted">{s.body}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function Dashboard() {
  const session = useSession();
  const navigate = useNavigate();
  useDocumentTitle("Overview", "QuoteRunner");
  const dash = useResource<DashboardDto>("/api/dashboard");
  const suppliers = useResource<SupplierDto[]>("/api/suppliers");

  if (dash.loading && !dash.data) return <PageLoader />;
  if (dash.error || !dash.data) return <Alert tone="bad">{dash.error ?? "Could not load the overview."}</Alert>;
  const d = dash.data;
  const fresh = d.open.length === 0 && d.activity.length === 0;

  return (
    <div>
      <PageHeader
        eyebrow={session.org.name}
        title="Overview"
        actions={
          <ButtonLink to="/app/requests/new" icon={<Plus className="size-4" />}>
            New request
          </ButtonLink>
        }
      />

      {fresh ? <GettingStarted suppliers={suppliers.data?.length ?? 0} /> : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open requests" value={d.stats.openRequests} />
        <Stat label="Waiting on suppliers" value={d.stats.waitingOnSuppliers} sub={d.stats.avgResponseHours !== null ? `They answer in ${d.stats.avgResponseHours < 1 ? "under an hour" : `${d.stats.avgResponseHours} h`} on average` : undefined} />
        <Stat label="Quotes this month" value={d.stats.quotesThisMonth} />
        <Stat label="Saved this month" value={money(d.stats.savedThisMonth, { whole: true })} tone={d.stats.savedThisMonth > 0 ? "good" : undefined} sub="vs. the average complete quote" />
      </div>

      {d.attention.length ? (
        <Card className="mb-6">
          <CardHeader title="Needs your attention" />
          <ul className="divide-y divide-line">
            {d.attention.map((a, i) => {
              const Icon = attentionIcon[a.kind];
              return (
                <li key={`${a.rfqId}-${a.kind}-${i}`}>
                  <Link to={`/app/requests/${a.rfqId}`} className="flex items-start gap-3 px-5 py-3 hover:bg-surface-2">
                    <Icon className={`mt-0.5 size-4 shrink-0 ${a.kind === "ready" ? "text-good" : a.kind === "overdue" ? "text-warn" : "text-brand-ink"}`} aria-hidden="true" />
                    <span className="min-w-0 text-sm">
                      <span className="font-mono text-xs font-semibold text-muted">{a.label}</span> {a.message}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <CardHeader title="Open requests" actions={<Link className="text-sm font-medium text-brand-ink hover:underline" to="/app/requests">All requests</Link>} />
          {d.open.length ? (
            <Table>
              <thead>
                <tr>
                  <TH>Request</TH>
                  <TH>Due</TH>
                  <TH>Answers</TH>
                  <TH className="text-right">Best total</TH>
                </tr>
              </thead>
              <tbody>
                {d.open.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-surface-2" onClick={() => navigate(`/app/requests/${r.id}`)}>
                    <TD>
                      <Link to={`/app/requests/${r.id}`} className="font-medium hover:underline">
                        {r.title}
                      </Link>
                      <p className="text-xs text-muted">
                        <span className="font-mono">{r.label}</span>
                        {r.jobName ? ` · ${r.jobName}` : ""}
                      </p>
                    </TD>
                    <TD className="whitespace-nowrap text-muted">{r.dueAt ? dateTime(r.dueAt) : "—"}</TD>
                    <TD>
                      <ResponseMeter invited={r.invited} responded={r.responded} quoted={r.quoted} />
                    </TD>
                    <TD className="text-right font-mono tabular">{money(r.bestTotal)}</TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="px-5 py-8 text-sm text-muted">Nothing out for quotes right now.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" />
          {d.activity.length ? (
            <ul className="flex flex-col gap-3 px-5 py-4">
              {d.activity.map((a, i) => (
                <li key={i} className="text-sm">
                  <p>{a.message}</p>
                  <p className="text-xs text-muted" title={date(a.createdAt)}>
                    {a.rfqLabel ? <span className="font-mono">{a.rfqLabel} · </span> : null}
                    {relative(a.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-sm text-muted">Activity on your requests shows up here.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
