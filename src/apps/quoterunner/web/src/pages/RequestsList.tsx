import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ClipboardList, Plus } from "lucide-react";
import { ButtonLink } from "@ui/components/button";
import { Alert, Card, EmptyState, PageHeader, PageLoader, Table, TD, TH } from "@ui/components/display";
import { Tabs } from "@ui/components/overlay";
import { date, money } from "@ui/format";
import { useDocumentTitle, useResource } from "@ui/hooks";
import type { RfqSummaryDto } from "../../../shared/types";
import { ResponseMeter, RfqStatusBadge } from "../components/status";

type Filter = "open" | "draft" | "awarded" | "all";

export function RequestsList() {
  useDocumentTitle("Requests", "QuoteRunner");
  const [filter, setFilter] = useState<Filter>("all");
  const list = useResource<RfqSummaryDto[]>(`/api/rfqs?status=${filter}`);
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="Requests"
        description="Each request is one material list sent to your suppliers for prices."
        actions={
          <ButtonLink to="/app/requests/new" icon={<Plus className="size-4" />}>
            New request
          </ButtonLink>
        }
      />
      <Tabs<Filter>
        className="mb-4"
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "all", label: "All" },
          { id: "open", label: "Collecting quotes" },
          { id: "draft", label: "Drafts" },
          { id: "awarded", label: "Awarded" },
        ]}
      />
      {list.error ? <Alert tone="bad">{list.error}</Alert> : null}
      {list.loading && !list.data ? (
        <PageLoader />
      ) : list.data && list.data.length ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <TH>Request</TH>
                <TH>Status</TH>
                <TH>Items</TH>
                <TH>Answers</TH>
                <TH>Need by</TH>
                <TH className="text-right">Total</TH>
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
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
                  <TD>
                    <RfqStatusBadge status={r.status} />
                  </TD>
                  <TD className="tabular text-muted">{r.itemCount}</TD>
                  <TD>
                    <ResponseMeter invited={r.invited} responded={r.responded} quoted={r.quoted} />
                  </TD>
                  <TD className="whitespace-nowrap text-muted">{date(r.needBy)}</TD>
                  <TD className="text-right font-mono tabular">{money(r.awardedTotal ?? r.bestTotal)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<ClipboardList className="size-8" />}
            title={filter === "all" ? "No requests yet" : "Nothing here"}
            action={
              <ButtonLink to="/app/requests/new" icon={<Plus className="size-4" />}>
                Create a request
              </ButtonLink>
            }
          >
            Paste a material list, pick suppliers, and QuoteRunner collects their prices for you.
          </EmptyState>
        </Card>
      )}
    </div>
  );
}
