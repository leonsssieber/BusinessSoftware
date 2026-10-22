import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, OrgRow, Role } from "./context.js";
import { acceptInvite, buildSessionPayload, currentOrg, currentUser, findOpenInvite, requireAuth, requireRole } from "./auth.js";
import { newId, randomToken, sha256 } from "./crypto.js";
import { badRequest, conflict, forbidden, HttpError, notFound, planLimit } from "./errors.js";
import { effectivePlan, seatUsage } from "./limits.js";
import { renderEmail } from "./mail.js";
import { body, zEmail, zName } from "./validate.js";
import { parseJson } from "./db.js";

const INVITE_DAYS = 7;

export function orgRoutes() {
  const r = new Hono<AppEnv>();
  r.use("*", requireAuth);

  r.get("/", (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const members = ctx.db.all<{ userId: string; name: string; email: string; role: Role; joinedAt: string }>(
      `SELECT u.id AS userId, u.name, u.email, m.role, m.created_at AS joinedAt
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ? ORDER BY m.created_at`,
      org.id,
    );
    const invites = ctx.db.all<{ id: string; email: string; role: Role; createdAt: string; expiresAt: string }>(
      `SELECT id, email, role, created_at AS createdAt, expires_at AS expiresAt FROM invites
       WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at`,
      org.id,
      ctx.now().toISOString(),
    );
    const plan = effectivePlan(ctx, org);
    return c.json({
      org: { id: org.id, name: org.name, settings: parseJson(org.settings, {}) },
      members,
      invites,
      seats: { used: seatUsage(ctx, org.id), limit: plan.seats },
    });
  });

  r.patch("/", requireRole("admin"), async (c) => {
    const ctx = c.get("ctx");
    const { name } = await body(c, z.object({ name: zName }));
    ctx.db.run("UPDATE orgs SET name = ? WHERE id = ?", name, currentOrg(c).id);
    return c.json({ ok: true });
  });

  /** Merges product-specific settings into the organization's settings document. */
  r.patch("/settings", requireRole("admin"), async (c) => {
    const ctx = c.get("ctx");
    const { settings } = await body(c, z.object({ settings: z.record(z.string(), z.unknown()) }));
    const org = currentOrg(c);
    const merged = { ...parseJson<Record<string, unknown>>(org.settings, {}), ...settings };
    const json = JSON.stringify(merged);
    if (json.length > 20_000) throw badRequest("Settings are too large.");
    ctx.db.run("UPDATE orgs SET settings = ? WHERE id = ?", json, org.id);
    return c.json({ settings: merged });
  });

  r.post("/invites", requireRole("admin"), async (c) => {
    const ctx = c.get("ctx");
    const input = await body(c, z.object({ email: zEmail, role: z.enum(["admin", "member"]).default("member") }));
    const org = currentOrg(c);
    const user = currentUser(c);
    const plan = effectivePlan(ctx, org);
    if (plan.seats !== null && seatUsage(ctx, org.id) >= plan.seats) {
      throw planLimit(`Your ${plan.name} plan includes ${plan.seats} ${plan.seats === 1 ? "user" : "users"}. Upgrade to add teammates.`, {
        limit: "seats",
        max: plan.seats,
        plan: plan.id,
      });
    }
    const existing = ctx.db.get(
      `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND u.email = ?`,
      org.id,
      input.email,
    );
    if (existing) throw conflict(`${input.email} is already on your team.`);

    const token = randomToken(32);
    const id = newId("inv");
    const now = ctx.now();
    ctx.db.run("DELETE FROM invites WHERE org_id = ? AND email = ? AND accepted_at IS NULL", org.id, input.email);
    ctx.db.run(
      `INSERT INTO invites (id, org_id, email, role, token_hash, invited_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      org.id,
      input.email,
      input.role,
      sha256(token),
      user.id,
      now.toISOString(),
      new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString(),
    );
    const url = `${ctx.env.appUrl}/invite/${encodeURIComponent(token)}`;
    const mail = renderEmail({
      productName: ctx.product.name,
      accent: ctx.product.emailAccent,
      heading: `${user.name} invited you to ${org.name}`,
      paragraphs: [
        `${user.name} (${user.email}) invited you to join ${org.name} on ${ctx.product.name}. The invite works for ${INVITE_DAYS} days.`,
      ],
      button: { label: "Accept invite", url },
    });
    await ctx.mailer.send({
      to: input.email,
      subject: `Join ${org.name} on ${ctx.product.name}`,
      orgId: org.id,
      ...mail,
    });
    return c.json({ id, email: input.email, role: input.role }, 201);
  });

  r.delete("/invites/:id", requireRole("admin"), (c) => {
    const ctx = c.get("ctx");
    const res = ctx.db.run("DELETE FROM invites WHERE id = ? AND org_id = ?", c.req.param("id"), currentOrg(c).id);
    if (!res.changes) throw notFound("Invite not found.");
    return c.json({ ok: true });
  });

  r.patch("/members/:userId", requireRole("owner"), async (c) => {
    const ctx = c.get("ctx");
    const { role } = await body(c, z.object({ role: z.enum(["owner", "admin", "member"]) }));
    const org = currentOrg(c);
    const target = c.req.param("userId");
    if (target === currentUser(c).id) throw badRequest("You can't change your own role.");
    const res = ctx.db.run("UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?", role, org.id, target);
    if (!res.changes) throw notFound("Member not found.");
    return c.json({ ok: true });
  });

  r.delete("/members/:userId", async (c) => {
    const ctx = c.get("ctx");
    const org = currentOrg(c);
    const me = currentUser(c);
    const target = c.req.param("userId");
    const role = c.get("role");
    const targetRole = ctx.db.get<{ role: Role }>(
      "SELECT role FROM memberships WHERE org_id = ? AND user_id = ?",
      org.id,
      target,
    )?.role;
    if (!targetRole) throw notFound("Member not found.");
    const leavingSelf = target === me.id;
    if (!leavingSelf && role !== "owner" && role !== "admin") throw forbidden("Only admins can remove teammates.");
    if (targetRole === "owner") {
      const owners = ctx.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner'",
        org.id,
      )!.n;
      if (owners <= 1) throw badRequest("Every team needs an owner. Make someone else the owner first.");
      if (!leavingSelf && role !== "owner") throw forbidden("Only an owner can remove another owner.");
    }
    ctx.db.run("DELETE FROM memberships WHERE org_id = ? AND user_id = ?", org.id, target);
    return c.json({ ok: true });
  });

  return r;
}

/** Invite lookup and acceptance. Lookup is public so the invite page can show who invited you. */
export function inviteRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/:token", (c) => {
    const ctx = c.get("ctx");
    const invite = findOpenInvite(ctx, c.req.param("token"));
    if (!invite) throw new HttpError(404, "invite_invalid", "This invite link has expired or was already used.");
    const org = ctx.db.get<{ name: string }>("SELECT name FROM orgs WHERE id = ?", invite.org_id);
    return c.json({ orgName: org?.name ?? "", email: invite.email, role: invite.role });
  });

  r.post("/:token/accept", requireAuth, (c) => {
    const ctx = c.get("ctx");
    const invite = findOpenInvite(ctx, c.req.param("token"));
    if (!invite) throw new HttpError(404, "invite_invalid", "This invite link has expired or was already used.");
    const user = currentUser(c);
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw forbidden(`This invite is for ${invite.email}. Sign in with that account to accept it.`);
    }
    acceptInvite(ctx, invite, user.id);
    ctx.db.run("UPDATE sessions SET org_id = ? WHERE id_hash = ?", invite.org_id, c.get("sessionHash"));
    const org = ctx.db.get<OrgRow>("SELECT * FROM orgs WHERE id = ?", invite.org_id)!;
    return c.json(buildSessionPayload(ctx, user, org, invite.role));
  });

  return r;
}
