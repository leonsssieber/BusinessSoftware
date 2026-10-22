import type { Db } from "./db.js";
import { newId } from "./crypto.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  orgId?: string | null;
}

export interface SentMail {
  id: string;
  status: "sent" | "logged";
}

export interface Mailer {
  readonly provider: "console" | "resend" | "memory";
  send(msg: MailMessage): Promise<SentMail>;
}

export class MailError extends Error {}

interface OutboxDeps {
  db: Db;
  now: () => Date;
}

function record(
  deps: OutboxDeps,
  msg: MailMessage,
  provider: string,
  status: string,
  providerId: string | null,
  error: string | null,
): string {
  const id = newId("mail");
  deps.db.run(
    `INSERT INTO outbox (id, org_id, to_addr, subject, text_body, html_body, reply_to, provider, provider_id, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    msg.orgId ?? null,
    msg.to,
    msg.subject,
    msg.text,
    msg.html ?? null,
    msg.replyTo ?? null,
    provider,
    providerId,
    status,
    error,
    deps.now().toISOString(),
  );
  return id;
}

/** Development mailer: stores every message in the outbox table and prints a one-line summary. */
export function createConsoleMailer(deps: OutboxDeps & { quiet?: boolean }): Mailer {
  return {
    provider: "console",
    async send(msg) {
      const id = record(deps, msg, "console", "logged", null, null);
      if (!deps.quiet) console.log(`[mail] to=${msg.to} subject="${msg.subject}" (stored in outbox ${id})`);
      return { id, status: "logged" };
    },
  };
}

/** Production mailer using the Resend HTTP API. Every attempt is also recorded in the outbox. */
export function createResendMailer(
  deps: OutboxDeps & { apiKey: string; from: string; fetchImpl?: typeof fetch },
): Mailer {
  const doFetch = deps.fetchImpl ?? fetch;
  return {
    provider: "resend",
    async send(msg) {
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: deps.from,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          reply_to: msg.replyTo,
        }),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 500);
        record(deps, msg, "resend", "failed", null, `${res.status} ${detail}`);
        throw new MailError(`Email to ${msg.to} failed (${res.status}).`);
      }
      const body = (await res.json()) as { id?: string };
      const id = record(deps, msg, "resend", "sent", body.id ?? null, null);
      return { id, status: "sent" };
    },
  };
}

/** Test mailer that keeps messages in memory. */
export function createMemoryMailer(): Mailer & { messages: MailMessage[] } {
  const messages: MailMessage[] = [];
  return {
    provider: "memory",
    messages,
    async send(msg) {
      messages.push(msg);
      return { id: `mem_${messages.length}`, status: "logged" };
    },
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface EmailContent {
  productName: string;
  accent: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Optional preformatted block, e.g. a table of line items rendered as plain text. */
  table?: { headers: string[]; rows: string[][] };
  footer?: string;
}

/** Renders a small, client-safe transactional email as both HTML and plain text. */
export function renderEmail(c: EmailContent): { html: string; text: string } {
  const p = c.paragraphs
    .map((t) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(t)}</p>`)
    .join("");
  const table = c.table
    ? `<table style="border-collapse:collapse;width:100%;margin:6px 0 18px;font-size:14px">
        <thead><tr>${c.table.headers
          .map((h) => `<th style="text-align:left;border-bottom:2px solid #d9dde3;padding:6px 8px">${escapeHtml(h)}</th>`)
          .join("")}</tr></thead>
        <tbody>${c.table.rows
          .map(
            (r) =>
              `<tr>${r
                .map((cell) => `<td style="border-bottom:1px solid #eceff3;padding:6px 8px;vertical-align:top">${escapeHtml(cell)}</td>`)
                .join("")}</tr>`,
          )
          .join("")}</tbody></table>`
    : "";
  const button = c.button
    ? `<p style="margin:20px 0"><a href="${escapeHtml(c.button.url)}" style="background:${c.accent};color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:6px;font-weight:600;display:inline-block">${escapeHtml(c.button.label)}</a></p>`
    : "";
  const footer = escapeHtml(c.footer ?? `Sent by ${c.productName}.`);
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2330">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px 28px 20px;border-top:4px solid ${c.accent}">
<p style="margin:0 0 18px;font-weight:700;color:${c.accent};letter-spacing:.02em">${escapeHtml(c.productName)}</p>
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(c.heading)}</h1>
${p}${table}${button}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">${footer}</p>
</div></body></html>`;

  const textTable = c.table
    ? [c.table.headers.join(" | "), ...c.table.rows.map((r) => r.join(" | "))].join("\n") + "\n\n"
    : "";
  const text = [
    c.heading,
    "",
    ...c.paragraphs.flatMap((t) => [t, ""]),
    textTable,
    c.button ? `${c.button.label}: ${c.button.url}\n` : "",
    c.footer ?? `Sent by ${c.productName}.`,
  ].join("\n");
  return { html, text };
}
