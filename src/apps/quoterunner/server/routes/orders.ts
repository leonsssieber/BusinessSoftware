import { Hono } from "hono";
import { z } from "zod";
import { currentOrg, currentUser, requireAuth } from "@core/server/auth";
import type { AppEnv } from "@core/server/context";
import { badRequest, notFound } from "@core/server/errors";
import { assertFeature } from "@core/server/limits";
import { body } from "@core/server/validate";
import { purchaseOrderEmail } from "../emails";
import { logActivity, poDtos, type SupplierRow } from "../repo";

export function orderRoutes() {
  const r = new Hono<AppEnv>();
  r.use("*", requireAuth);

  r.get("/", (c) => c.json(poDtos(c.get("ctx"), { orgId: currentOrg(c).id })));

  r.get("/:id", (c) => {
    const [po] = poDtos(c.get("ctx"), { orgId: currentOrg(c).id, poId: c.req.param("id") });
    if (!po) throw notFound("Purchase order not found.");
    return c.json(po);
  });

  r.post("/:id/send", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    assertFeature(c, org, "poEmail");
    const { message } = await body(c, z.object({ message: z.string().trim().max(2000).nullish() }));
    const [po] = poDtos(ctx, { orgId: org.id, poId: c.req.param("id") });
    if (!po) throw notFound("Purchase order not found.");
    const supplier = ctx.db.get<SupplierRow>("SELECT * FROM suppliers WHERE id = ?", po.supplierId)!;
    if (!supplier.email) throw badRequest(`${supplier.name} has no email address. Add one on the Suppliers page.`);
    const user = currentUser(c);
    await ctx.mailer.send({ to: supplier.email, orgId: org.id, replyTo: user.email, ...purchaseOrderEmail(ctx, { org, po, supplier, message }) });
    ctx.db.run("UPDATE purchase_orders SET status = 'sent', sent_at = ? WHERE id = ?", ctx.now().toISOString(), po.id);
    logActivity(ctx, org.id, po.rfqId, "po_sent", `${user.name} emailed ${po.label} to ${supplier.name}.`);
    const [fresh] = poDtos(ctx, { orgId: org.id, poId: po.id });
    return c.json(fresh);
  });

  /** Cancels a purchase order. When the last one goes, the request reopens for a new award. */
  r.delete("/:id", (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const [po] = poDtos(ctx, { orgId: org.id, poId: c.req.param("id") });
    if (!po) throw notFound("Purchase order not found.");
    ctx.db.tx(() => {
      ctx.db.run("DELETE FROM purchase_orders WHERE id = ?", po.id);
      ctx.db.run("DELETE FROM price_history WHERE rfq_id = ? AND supplier_id = ? AND awarded = 1", po.rfqId, po.supplierId);
      const left = ctx.db.get("SELECT 1 FROM purchase_orders WHERE rfq_id = ? LIMIT 1", po.rfqId);
      if (!left) ctx.db.run("UPDATE rfqs SET status = 'open', awarded_at = NULL WHERE id = ?", po.rfqId);
      logActivity(ctx, org.id, po.rfqId, "po_cancelled", `${currentUser(c).name} cancelled ${po.label}.`);
    });
    return c.json({ ok: true });
  });

  return r;
}
