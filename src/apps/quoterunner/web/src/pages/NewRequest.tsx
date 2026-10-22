import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, errorMessage } from "@ui/api";
import { Button, ButtonLink } from "@ui/components/button";
import { Alert, Card, CardHeader, PageHeader } from "@ui/components/display";
import { Field, Input, Textarea } from "@ui/components/form";
import { useSession } from "@ui/auth";
import { useDocumentTitle } from "@ui/hooks";
import type { CompanySettings } from "../../../shared/product";
import type { RfqDetailDto } from "../../../shared/types";
import { draftProblems, fromDraft, ItemsEditor, type DraftItem } from "../components/ItemsEditor";

export function NewRequest() {
  useDocumentTitle("New request", "QuoteRunner");
  const navigate = useNavigate();
  const quoteDays = (useSession().org.settings as CompanySettings).defaultQuoteDays ?? 3;
  const [form, setForm] = useState({ title: "", jobName: "", siteAddress: "", needBy: "", dueAt: "", notes: "" });
  const [items, setItems] = useState<DraftItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = !form.title.trim() ? "Give the request a short title." : draftProblems(items);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const rfq = await api.post<RfqDetailDto>("/api/rfqs", {
        title: form.title,
        jobName: form.jobName || null,
        siteAddress: form.siteAddress || null,
        needBy: form.needBy || null,
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
        notes: form.notes || null,
        items: fromDraft(items),
      });
      navigate(`/app/requests/${rfq.id}?tab=suppliers`);
    } catch (err) {
      setError(errorMessage(err));
      setUpgrade(err instanceof ApiError && err.code === "plan_limit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader title="New request" description="List what you need. Next, you'll pick the suppliers to ask." />
      {error ? (
        <Alert tone="bad" className="mb-4" action={upgrade ? <ButtonLink size="sm" to="/app/settings/billing">See plans</ButtonLink> : undefined}>
          {error}
        </Alert>
      ) : null}
      <div className="grid gap-6 2xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="@container self-start">
          <CardHeader title="Details" />
          <div className="grid gap-4 p-5 @2xl:grid-cols-2">
            <Field label="Title" hint="Suppliers see this in the email subject.">
              {(id) => <Input id={id} value={form.title} onChange={set("title")} placeholder="Unit 4 rough-in material" required />}
            </Field>
            <Field label="Job name">{(id) => <Input id={id} value={form.jobName} onChange={set("jobName")} placeholder="Maple St apartments" />}</Field>
            <Field label="Deliver to">{(id) => <Input id={id} value={form.siteAddress} onChange={set("siteAddress")} placeholder="120 Maple St, Springfield" />}</Field>
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Needed by">{(id) => <Input id={id} type="date" value={form.needBy} onChange={set("needBy")} />}</Field>
                <Field label="Quotes due">{(id) => <Input id={id} type="datetime-local" value={form.dueAt} onChange={set("dueAt")} />}</Field>
              </div>
              <p className="text-xs text-muted">Leave the due date empty and suppliers get {quoteDays} {quoteDays === 1 ? "day" : "days"}.</p>
            </div>
            <Field label="Notes for suppliers" className="@2xl:col-span-2">
              {(id) => <Textarea id={id} rows={3} value={form.notes} onChange={set("notes")} placeholder="Deliver before 7am, call Mike on site." />}
            </Field>
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Items" description="Paste your list or type the lines. Untick “Subs OK” where only the exact product will do." />
          <div className="p-5">
            <ItemsEditor items={items} onChange={setItems} />
          </div>
        </Card>
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <ButtonLink variant="ghost" to="/app/requests">
          Cancel
        </ButtonLink>
        <Button type="submit" loading={saving}>
          Save and choose suppliers
        </Button>
      </div>
    </form>
  );
}
