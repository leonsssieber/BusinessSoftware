import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "./db.js";

export interface AiDocument {
  mediaType: "application/pdf";
  base64: string;
  title?: string;
}

export interface AiJsonRequest {
  /** Short label for usage metering, e.g. `quoterunner.parse_list`. */
  kind: string;
  /** Stable instructions. Kept identical across calls so the prefix can be cached. */
  system: string;
  /** The per-request text: the user's data and the exact output wanted. */
  input: string;
  documents?: AiDocument[];
  /** JSON schema for the reply. Every object needs `additionalProperties: false` and `required`. */
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  orgId?: string | null;
}

export interface AiClient {
  readonly available: boolean;
  readonly model: string | null;
  json<T>(req: AiJsonRequest): Promise<T>;
}

export type AiErrorCode =
  | "not_configured"
  | "refused"
  | "truncated"
  | "bad_output"
  | "rate_limited"
  | "auth"
  | "failed";

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

interface UsageDeps {
  db?: Db;
  now?: () => Date;
}

function recordUsage(
  deps: UsageDeps,
  row: { orgId: string | null; kind: string; model: string; input: number; output: number; ok: boolean },
) {
  if (!deps.db) return;
  deps.db.run(
    `INSERT INTO ai_usage (org_id, kind, model, input_tokens, output_tokens, ok, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    row.orgId,
    row.kind,
    row.model,
    row.input,
    row.output,
    row.ok,
    (deps.now?.() ?? new Date()).toISOString(),
  );
}

/**
 * Claude-backed client returning schema-constrained JSON.
 *
 * Uses structured outputs (`output_config.format`) so replies parse as the requested schema,
 * and opts into server-side fallbacks so a policy decline on the primary model is retried on
 * Anthropic's recommended substitute instead of failing the request.
 */
export function createAnthropicAi(
  opts: { apiKey: string; model: string; client?: Anthropic } & UsageDeps,
): AiClient {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  return {
    available: true,
    model: opts.model,
    async json<T>(req: AiJsonRequest): Promise<T> {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [
        ...(req.documents ?? []).map(
          (d): Anthropic.Beta.BetaContentBlockParam => ({
            type: "document",
            source: { type: "base64", media_type: d.mediaType, data: d.base64 },
            ...(d.title ? { title: d.title } : {}),
          }),
        ),
        { type: "text", text: req.input },
      ];

      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model: opts.model,
          max_tokens: req.maxTokens ?? 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content }],
          output_config: {
            effort: req.effort ?? "medium",
            format: { type: "json_schema", schema: req.schema },
          },
        });
      } catch (err) {
        recordUsage(opts, { orgId: req.orgId ?? null, kind: req.kind, model: opts.model, input: 0, output: 0, ok: false });
        if (err instanceof Anthropic.RateLimitError) {
          throw new AiError("rate_limited", "The AI service is busy. Try again in a minute.");
        }
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new AiError("auth", "The AI service rejected the API key. Check ANTHROPIC_API_KEY.");
        }
        if (err instanceof Anthropic.APIError) {
          throw new AiError("failed", `The AI service returned an error (${err.status ?? "network"}).`);
        }
        throw new AiError("failed", "Could not reach the AI service.");
      }

      recordUsage(opts, {
        orgId: req.orgId ?? null,
        kind: req.kind,
        model: response.model,
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        ok: response.stop_reason !== "refusal",
      });

      if (response.stop_reason === "refusal") {
        throw new AiError("refused", "The AI declined this request. Edit the input and try again.");
      }
      if (response.stop_reason === "max_tokens") {
        throw new AiError("truncated", "The input was too long to process in one go. Split it into smaller parts.");
      }
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new AiError("bad_output", "The AI reply could not be read. Try again.");
      }
    },
  };
}

/** Used when no API key is configured. Callers fall back to their built-in heuristics. */
export function createDisabledAi(): AiClient {
  return {
    available: false,
    model: null,
    async json<T>(): Promise<T> {
      throw new AiError("not_configured", "AI is not configured. Set ANTHROPIC_API_KEY to enable it.");
    },
  };
}

/** Test double: each `kind` maps to a handler that returns the parsed reply. */
export function createFakeAi(
  handlers: Record<string, (req: AiJsonRequest) => unknown>,
): AiClient & { calls: AiJsonRequest[] } {
  const calls: AiJsonRequest[] = [];
  return {
    available: true,
    model: "fake",
    calls,
    async json<T>(req: AiJsonRequest): Promise<T> {
      calls.push(req);
      const h = handlers[req.kind];
      if (!h) throw new AiError("failed", `No fake handler for ${req.kind}`);
      return (await h(req)) as T;
    },
  };
}

export function aiCallsSince(db: Db, orgId: string, since: Date): number {
  const row = db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM ai_usage WHERE org_id = ? AND created_at >= ?",
    orgId,
    since.toISOString(),
  );
  return row?.n ?? 0;
}
