import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv, CoreContext, OrgRow, Role, SessionPayload, UserRow } from "./context.js";
import { hashPassword, newId, randomToken, sha256, verifyPassword } from "./crypto.js";
import { conflict, forbidden, HttpError, unauthorized } from "./errors.js";
import { renderEmail } from "./mail.js";
import { rateLimit } from "./ratelimit.js";
import { body, zEmail, zName, zPassword } from "./validate.js";
import { parseJson } from "./db.js";

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Creates a session row and returns the raw token to put in the cookie. */
export function createSession(ctx: CoreContext, userId: string, orgId: string | null): string {
  const token = randomToken(32);
  const now = ctx.now();
  ctx.db.run(
    `INSERT INTO sessions (id_hash, user_id, org_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)`,
    sha256(token),
    userId,
    orgId,
    now.toISOString(),
    addDays(now, SESSION_DAYS).toISOString(),
    now.toISOString(),
  );
  return token;
}

export function setSessionCookie(c: Context<AppEnv>, token: string) {
  const ctx = c.get("ctx");
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: ctx.env.secureCookies,
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

function clearSessionCookie(c: Context<AppEnv>) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Loads the user, current organization and role for the request, if a valid session exists. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  c.set("org", null);
  c.set("role", null);
  c.set("sessionHash", null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const ctx = c.get("ctx");
    const hash = sha256(token);
    const now = ctx.now();
    const session = ctx.db.get<{ user_id: string; org_id: string | null; expires_at: string; last_seen_at: string }>(
      "SELECT user_id, org_id, expires_at, last_seen_at FROM sessions WHERE id_hash = ?",
      hash,
    );
    if (session && session.expires_at > now.toISOString()) {
      const user = ctx.db.get<UserRow>("SELECT * FROM users WHERE id = ?", session.user_id);
      if (user) {
        let membership = session.org_id
          ? ctx.db.get<{ org_id: string; role: Role }>(
              "SELECT org_id, role FROM memberships WHERE org_id = ? AND user_id = ?",
              session.org_id,
              user.id,
            )
          : undefined;
        membership ??= ctx.db.get<{ org_id: string; role: Role }>(
          "SELECT org_id, role FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1",
          user.id,
        );
        const org = membership ? ctx.db.get<OrgRow>("SELECT * FROM orgs WHERE id = ?", membership.org_id) : undefined;
        c.set("user", user);
        c.set("org", org ?? null);
        c.set("role", membership?.role ?? null);
        c.set("sessionHash", hash);
        // Slide the expiry at most once a day to avoid a write per request.
        if (now.getTime() - Date.parse(session.last_seen_at) > DAY_MS) {
          ctx.db.run(
            "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?",
            now.toISOString(),
            addDays(now, SESSION_DAYS).toISOString(),
            hash,
          );
        }
      }
    } else if (session) {
      ctx.db.run("DELETE FROM sessions WHERE id_hash = ?", hash);
    }
  }
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) throw unauthorized();
  if (!c.get("org")) throw forbidden("Your account is not part of an organization.");
  await next();
};

const ROLE_RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export function requireRole(min: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const role = c.get("role");
    if (!role || ROLE_RANK[role] < ROLE_RANK[min]) {
      throw forbidden(min === "owner" ? "Only the account owner can do this." : "Only admins can do this.");
    }
    await next();
  };
}

/** The signed-in user (throws if absent). Use after `requireAuth`. */
export function currentUser(c: Context<AppEnv>): UserRow {
  const u = c.get("user");
  if (!u) throw unauthorized();
  return u;
}

/** The current organization (throws if absent). Use after `requireAuth`. */
export function currentOrg(c: Context<AppEnv>): OrgRow {
  const o = c.get("org");
  if (!o) throw forbidden("Your account is not part of an organization.");
  return o;
}

export function buildSessionPayload(ctx: CoreContext, user: UserRow, org: OrgRow, role: Role): SessionPayload {
  const orgs = ctx.db.all<{ id: string; name: string; role: Role }>(
    `SELECT o.id, o.name, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY o.name`,
    user.id,
  );
  return {
    user: { id: user.id, email: user.email, name: user.name },
    org: {
      id: org.id,
      name: org.name,
      plan: org.plan,
      planStatus: org.plan_status,
      settings: parseJson<Record<string, unknown>>(org.settings, {}),
    },
    role,
    orgs,
    isAdmin: ctx.env.adminEmails.includes(user.email.toLowerCase()),
  };
}

function payloadFor(ctx: CoreContext, userId: string, orgId: string): SessionPayload {
  const user = ctx.db.get<UserRow>("SELECT * FROM users WHERE id = ?", userId)!;
  const org = ctx.db.get<OrgRow>("SELECT * FROM orgs WHERE id = ?", orgId)!;
  const m = ctx.db.get<{ role: Role }>("SELECT role FROM memberships WHERE org_id = ? AND user_id = ?", orgId, userId)!;
  return buildSessionPayload(ctx, user, org, m.role);
}

interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  role: Role;
  expires_at: string;
  accepted_at: string | null;
}

export function findOpenInvite(ctx: CoreContext, token: string): InviteRow | undefined {
  const invite = ctx.db.get<InviteRow>("SELECT * FROM invites WHERE token_hash = ?", sha256(token));
  if (!invite || invite.accepted_at || invite.expires_at <= ctx.now().toISOString()) return undefined;
  return invite;
}

export function acceptInvite(ctx: CoreContext, invite: InviteRow, userId: string) {
  ctx.db.tx(() => {
    ctx.db.run(
      `INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      invite.org_id,
      userId,
      invite.role,
      ctx.now().toISOString(),
    );
    ctx.db.run("UPDATE invites SET accepted_at = ? WHERE id = ?", ctx.now().toISOString(), invite.id);
  });
}

const signupSchema = z.object({
  name: zName,
  email: zEmail,
  password: zPassword,
  orgName: z.string().trim().max(120).optional(),
  inviteToken: z.string().max(200).optional(),
});

const loginSchema = z.object({ email: zEmail, password: z.string().min(1).max(200) });

export function authRoutes() {
  const r = new Hono<AppEnv>();
  const authLimit = rateLimit({ bucket: "auth", limit: 20, windowMs: 15 * 60_000 });

  r.post("/signup", authLimit, async (c) => {
    const ctx = c.get("ctx");
    const input = await body(c, signupSchema);
    if (ctx.db.get("SELECT 1 FROM users WHERE email = ?", input.email)) {
      throw conflict("An account with this email already exists. Sign in instead.");
    }
    const invite = input.inviteToken ? findOpenInvite(ctx, input.inviteToken) : undefined;
    if (input.inviteToken && !invite) throw new HttpError(400, "invite_invalid", "This invite link has expired or was already used.");
    if (invite && invite.email.toLowerCase() !== input.email) {
      throw new HttpError(400, "invite_email_mismatch", `This invite is for ${invite.email}. Sign up with that address.`);
    }

    const passwordHash = await hashPassword(input.password);
    const now = ctx.now().toISOString();
    const userId = newId("usr");
    const orgId = ctx.db.tx(() => {
      ctx.db.run(
        "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        userId,
        input.email,
        input.name,
        passwordHash,
        now,
      );
      if (invite) {
        acceptInvite(ctx, invite, userId);
        return invite.org_id;
      }
      const id = newId("org");
      ctx.db.run(
        "INSERT INTO orgs (id, name, created_at) VALUES (?, ?, ?)",
        id,
        input.orgName?.trim() || `${input.name.split(" ")[0]}'s company`,
        now,
      );
      ctx.db.run(
        "INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
        id,
        userId,
        now,
      );
      return id;
    });
    const token = createSession(ctx, userId, orgId);
    setSessionCookie(c, token);
    return c.json(payloadFor(ctx, userId, orgId), 201);
  });

  r.post("/login", authLimit, async (c) => {
    const ctx = c.get("ctx");
    const input = await body(c, loginSchema);
    const user = ctx.db.get<UserRow>("SELECT * FROM users WHERE email = ?", input.email);
    const ok = user ? await verifyPassword(input.password, user.password_hash) : false;
    if (!user || !ok) throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
    const m = ctx.db.get<{ org_id: string }>(
      "SELECT org_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1",
      user.id,
    );
    if (!m) throw forbidden("Your account is not part of an organization.");
    setSessionCookie(c, createSession(ctx, user.id, m.org_id));
    return c.json(payloadFor(ctx, user.id, m.org_id));
  });

  r.post("/logout", async (c) => {
    const hash = c.get("sessionHash");
    if (hash) c.get("ctx").db.run("DELETE FROM sessions WHERE id_hash = ?", hash);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  r.get("/me", async (c) => {
    const user = c.get("user");
    const org = c.get("org");
    const role = c.get("role");
    if (!user || !org || !role) throw unauthorized();
    return c.json(buildSessionPayload(c.get("ctx"), user, org, role));
  });

  r.patch("/me", requireAuth, async (c) => {
    const ctx = c.get("ctx");
    const input = await body(c, z.object({ name: zName }));
    const user = currentUser(c);
    ctx.db.run("UPDATE users SET name = ? WHERE id = ?", input.name, user.id);
    return c.json(payloadFor(ctx, user.id, currentOrg(c).id));
  });

  r.post("/switch-org", requireAuth, async (c) => {
    const ctx = c.get("ctx");
    const { orgId } = await body(c, z.object({ orgId: z.string().min(1) }));
    const user = currentUser(c);
    const m = ctx.db.get("SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ?", orgId, user.id);
    if (!m) throw forbidden("You are not a member of that organization.");
    ctx.db.run("UPDATE sessions SET org_id = ? WHERE id_hash = ?", orgId, c.get("sessionHash"));
    return c.json(payloadFor(ctx, user.id, orgId));
  });

  r.post("/password/change", requireAuth, async (c) => {
    const ctx = c.get("ctx");
    const input = await body(c, z.object({ current: z.string().min(1).max(200), next: zPassword }));
    const user = currentUser(c);
    if (!(await verifyPassword(input.current, user.password_hash))) {
      throw new HttpError(400, "invalid_credentials", "Your current password is incorrect.");
    }
    ctx.db.run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(input.next), user.id);
    ctx.db.run("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?", user.id, c.get("sessionHash"));
    return c.json({ ok: true });
  });

  r.post("/password/forgot", rateLimit({ bucket: "forgot", limit: 5, windowMs: 15 * 60_000 }), async (c) => {
    const ctx = c.get("ctx");
    const { email } = await body(c, z.object({ email: zEmail }));
    const user = ctx.db.get<UserRow>("SELECT * FROM users WHERE email = ?", email);
    if (user) {
      const token = randomToken(32);
      ctx.db.run(
        "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        sha256(token),
        user.id,
        new Date(ctx.now().getTime() + 60 * 60_000).toISOString(),
      );
      const url = `${ctx.env.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
      const mail = renderEmail({
        productName: ctx.product.name,
        accent: ctx.product.emailAccent,
        heading: "Reset your password",
        paragraphs: [
          `Someone asked to reset the password for ${user.email}. If it was you, use the button below. The link works for one hour.`,
          "If you didn't ask for this, you can ignore this email.",
        ],
        button: { label: "Choose a new password", url },
      });
      await ctx.mailer.send({ to: user.email, subject: `Reset your ${ctx.product.name} password`, ...mail });
    }
    return c.json({ ok: true });
  });

  r.post("/password/reset", authLimit, async (c) => {
    const ctx = c.get("ctx");
    const input = await body(c, z.object({ token: z.string().min(10).max(200), password: zPassword }));
    const row = ctx.db.get<{ user_id: string; expires_at: string; used_at: string | null }>(
      "SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?",
      sha256(input.token),
    );
    if (!row || row.used_at || row.expires_at <= ctx.now().toISOString()) {
      throw new HttpError(400, "reset_invalid", "This reset link has expired or was already used. Request a new one.");
    }
    const passwordHash = await hashPassword(input.password);
    ctx.db.tx(() => {
      ctx.db.run("UPDATE users SET password_hash = ? WHERE id = ?", passwordHash, row.user_id);
      ctx.db.run("UPDATE password_resets SET used_at = ? WHERE token_hash = ?", ctx.now().toISOString(), sha256(input.token));
      ctx.db.run("DELETE FROM sessions WHERE user_id = ?", row.user_id);
    });
    const m = ctx.db.get<{ org_id: string }>(
      "SELECT org_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1",
      row.user_id,
    );
    if (!m) throw forbidden("Your account is not part of an organization.");
    setSessionCookie(c, createSession(ctx, row.user_id, m.org_id));
    return c.json(payloadFor(ctx, row.user_id, m.org_id));
  });

  return r;
}
