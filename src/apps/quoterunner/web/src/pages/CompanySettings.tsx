import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@ui/api";
import { useAuth, useSession } from "@ui/auth";
import { Button } from "@ui/components/button";
import { Card, CardHeader } from "@ui/components/display";
import { Field, Input, Textarea } from "@ui/components/form";
import { useToast } from "@ui/components/toast";
import type { CompanySettings as Settings } from "../../../shared/product";

export function CompanySettings() {
  const session = useSession();
  const { refresh } = useAuth();
  const toast = useToast();
  const initial = session.org.settings as Settings;
  const [f, setF] = useState({
    companyAddress: initial.companyAddress ?? "",
    companyPhone: initial.companyPhone ?? "",
    deliveryInstructions: initial.deliveryInstructions ?? "",
    poTerms: initial.poTerms ?? "",
    defaultQuoteDays: String(initial.defaultQuoteDays ?? 3),
  });
  const [saving, setSaving] = useState(false);
  const canEdit = session.role !== "member";

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const days = Math.min(30, Math.max(1, Math.round(Number(f.defaultQuoteDays) || 3)));
      await api.patch("/api/org/settings", { settings: { ...f, defaultQuoteDays: days } });
      await refresh();
      toast.success("Company details saved.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <Card>
        <CardHeader title="Company details" description="Shown to suppliers on requests and purchase orders." />
        <fieldset disabled={!canEdit} className="grid gap-4 p-5 md:grid-cols-2">
          <Field label="Address" hint="Also the default ship-to address.">
            {(id) => <Textarea id={id} rows={3} value={f.companyAddress} onChange={(e) => setF({ ...f, companyAddress: e.target.value })} />}
          </Field>
          <Field label="Phone">{(id) => <Input id={id} type="tel" value={f.companyPhone} onChange={(e) => setF({ ...f, companyPhone: e.target.value })} />}</Field>
          <Field label="Delivery instructions" hint="Printed on every purchase order.">
            {(id) => <Textarea id={id} rows={3} value={f.deliveryInstructions} onChange={(e) => setF({ ...f, deliveryInstructions: e.target.value })} placeholder="Call the site lead 30 minutes before arrival." />}
          </Field>
          <Field label="Purchase order terms">
            {(id) => <Textarea id={id} rows={3} value={f.poTerms} onChange={(e) => setF({ ...f, poTerms: e.target.value })} placeholder="Net 30. Packing slip must show the PO number." />}
          </Field>
          <Field label="Days suppliers get to quote" hint="Used when a request has no due date.">
            {(id) => <Input id={id} type="number" min={1} max={30} value={f.defaultQuoteDays} onChange={(e) => setF({ ...f, defaultQuoteDays: e.target.value })} className="max-w-28" />}
          </Field>
        </fieldset>
        {canEdit ? (
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button type="submit" loading={saving}>
              Save company details
            </Button>
          </div>
        ) : (
          <p className="border-t border-line px-5 py-3 text-sm text-muted">Only admins can change company details.</p>
        )}
      </Card>
    </form>
  );
}
