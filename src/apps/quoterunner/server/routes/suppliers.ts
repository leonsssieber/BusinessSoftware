import { Hono } from "hono";
import { z } from "zod";
import { currentOrg, requireAuth } from "@core/server/auth";
import type { AppEnv } from "@core/server/context";
import { newId } from "@core/server/crypto";
import { badRequest } from "@core/server/errors";
import { body } from "@core/server/validate";
import { getSupplierRow, supplierStats, toSupplierDto, type SupplierRow } from "../repo";

const supplierSchema = z.object({
  name: z.string().trim().min(1, "Enter the supplier's name.").max(160),
  contactName: z.string().trim().max(120).nullish(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(/^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address.")
    .nullish(),
  phone: z.string().trim().max(40).nullish(),
  categories: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  notes: z.string().trim().max(2000).nullish(),
});

/** Splits one CSV line, honoring double-quoted fields. */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t" || ch === ";") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function supplierRoutes() {
  const r = new Hono<AppEnv>();
  r.use("*", requireAuth);

  r.get("/", (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const includeArchived = c.req.query("archived") === "1";
    const rows = ctx.db.all<SupplierRow>(
      `SELECT * FROM suppliers WHERE org_id = ? ${includeArchived ? "" : "AND archived = 0"} ORDER BY name COLLATE NOCASE`,
      org.id,
    );
    const stats = supplierStats(ctx, org.id);
    return c.json(rows.map((row) => toSupplierDto(row, stats.get(row.id))));
  });

  r.post("/", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const input = await body(c, supplierSchema);
    const id = newId("sup");
    ctx.db.run(
      `INSERT INTO suppliers (id, org_id, name, contact_name, email, phone, categories, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      org.id,
      input.name,
      input.contactName || null,
      input.email || null,
      input.phone || null,
      JSON.stringify(input.categories),
      input.notes || null,
      ctx.now().toISOString(),
    );
    return c.json(toSupplierDto(getSupplierRow(ctx, org.id, id)), 201);
  });

  r.patch("/:id", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const row = getSupplierRow(ctx, org.id, c.req.param("id"));
    const input = await body(c, supplierSchema.partial().extend({ archived: z.boolean().optional() }));
    const next = {
      name: input.name ?? row.name,
      contact_name: input.contactName !== undefined ? input.contactName || null : row.contact_name,
      email: input.email !== undefined ? input.email || null : row.email,
      phone: input.phone !== undefined ? input.phone || null : row.phone,
      categories: input.categories ? JSON.stringify(input.categories) : row.categories,
      notes: input.notes !== undefined ? input.notes || null : row.notes,
      archived: input.archived ?? Boolean(row.archived),
    };
    ctx.db.run(
      `UPDATE suppliers SET name = ?, contact_name = ?, email = ?, phone = ?, categories = ?, notes = ?, archived = ? WHERE id = ?`,
      next.name,
      next.contact_name,
      next.email,
      next.phone,
      next.categories,
      next.notes,
      next.archived,
      row.id,
    );
    return c.json(toSupplierDto(getSupplierRow(ctx, org.id, row.id), supplierStats(ctx, org.id).get(row.id)));
  });

  r.delete("/:id", (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const row = getSupplierRow(ctx, org.id, c.req.param("id"));
    const used = ctx.db.get("SELECT 1 FROM invitations WHERE supplier_id = ? LIMIT 1", row.id);
    if (used) {
      ctx.db.run("UPDATE suppliers SET archived = 1 WHERE id = ?", row.id);
      return c.json({ archived: true });
    }
    ctx.db.run("DELETE FROM suppliers WHERE id = ?", row.id);
    return c.json({ deleted: true });
  });

  /** Imports suppliers from CSV text: name, email, contact, phone, categories (separated by |). */
  r.post("/import", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const { csv } = await body(c, z.object({ csv: z.string().max(200_000) }));
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw badRequest("The file is empty.");
    let start = 0;
    let cols = { name: 0, email: 1, contact: 2, phone: 3, categories: 4 };
    const header = csvCells(lines[0]).map((h) => h.toLowerCase());
    if (header.some((h) => /name|email|supplier|vendor/.test(h))) {
      start = 1;
      const find = (re: RegExp, fallback: number) => {
        const i = header.findIndex((h) => re.test(h));
        return i >= 0 ? i : fallback;
      };
      cols = {
        name: find(/supplier|vendor|company|^name$/, 0),
        email: find(/e-?mail/, -1),
        contact: find(/contact|person|rep/, -1),
        phone: find(/phone|tel/, -1),
        categories: find(/categor|trade|type/, -1),
      };
    }
    const existing = new Set(
      ctx.db.all<{ name: string }>("SELECT name FROM suppliers WHERE org_id = ?", org.id).map((s) => s.name.toLowerCase()),
    );
    let created = 0;
    let skipped = 0;
    ctx.db.tx(() => {
      for (const line of lines.slice(start)) {
        const cells = csvCells(line);
        const name = cells[cols.name]?.trim();
        if (!name || existing.has(name.toLowerCase())) {
          skipped++;
          continue;
        }
        const email = cols.email >= 0 ? cells[cols.email]?.trim().toLowerCase() : "";
        ctx.db.run(
          `INSERT INTO suppliers (id, org_id, name, contact_name, email, phone, categories, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          newId("sup"),
          org.id,
          name.slice(0, 160),
          cols.contact >= 0 ? cells[cols.contact] || null : null,
          email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
          cols.phone >= 0 ? cells[cols.phone] || null : null,
          JSON.stringify(
            cols.categories >= 0
              ? (cells[cols.categories] ?? "")
                  .split("|")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [],
          ),
          ctx.now().toISOString(),
        );
        existing.add(name.toLowerCase());
        created++;
      }
    });
    return c.json({ created, skipped });
  });

  return r;
}
