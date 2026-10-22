import type { Context } from "hono";
import { AiError } from "@core/server/ai";
import type { AppEnv, OrgRow } from "@core/server/context";
import { HttpError } from "@core/server/errors";
import { assertAiQuota } from "@core/server/limits";
import { extractQuoteHeuristic, type ExtractedQuote } from "../shared/domain/extract";
import { parseItemList, type ParsedItem } from "../shared/domain/parse";
import { canonicalUnit, UNITS } from "../shared/domain/text";
import type { ItemRow } from "./repo";

const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });

const PARSE_SYSTEM = `You turn messy material lists from contractors and machine shops into clean request-for-quote line items.

The buyer pastes whatever they have: a text from the field, a takeoff, an email, rows copied from a spreadsheet. Return one line item per distinct product, in the order given.

- description: the product as the buyer wrote it, with sizes, specs, colors and brand kept. Fix obvious typos but do not rename products or expand trade abbreviations such as EMT, PVC, THHN or NM-B.
- qty: the quantity to buy, as a number. A number that is part of the product (3/4", 2x4, 12/2, #10) is not the quantity.
- unit: the unit the quantity is counted in.
- part_number: a manufacturer part number, SKU or catalog number if one is given, else null.
- needs_review: true when you had to guess the quantity or unit, or the line is unclear.

Skip headers, greetings and notes that are not products. Never add items that are not in the text.`;

const EXTRACT_SYSTEM = `You read a supplier's quote and map it onto the buyer's request-for-quote line items.

The quote can be an email, text pasted from a PDF or spreadsheet, or an attached PDF. The buyer's lines are listed with references like L1, L2. For every buyer line, return one entry:

- item_ref: the buyer line reference.
- unit_price: the supplier's price per the buyer's unit, as a number. If the supplier priced per a different unit (per 100 ft, per box of 25, per case), convert it to the buyer's unit and say so in note. If only an extended total is given, divide by the buyer's quantity. Use null when the supplier gave no price for this line or declined it.
- lead_days: days until the supplier can ship. In stock = 0. Convert weeks to days. Null if not stated.
- substitute: if the supplier quoted a different product or brand than requested, describe what they offered. Null if they quoted what was asked.
- note: anything the buyer must know about this line (minimum order, backorder, price conversion), else null.
- confidence: 0 to 1, how sure you are that the price belongs to this line.

Also return freight (a delivery or freight charge; 0 if the quote says free delivery; null if not mentioned), tax, valid_until (YYYY-MM-DD), reference (the supplier's quote number), contact_name and notes (payment terms or conditions worth knowing).

Only use numbers that appear in the quote. Never estimate a price.`;

const parseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "qty", "unit", "part_number", "needs_review"],
        properties: {
          description: { type: "string" },
          qty: { type: "number" },
          unit: { type: "string", enum: UNITS },
          part_number: nullable("string"),
          needs_review: { type: "boolean" },
        },
      },
    },
  },
};

const extractSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lines", "freight", "tax", "valid_until", "reference", "contact_name", "notes"],
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_ref", "unit_price", "lead_days", "substitute", "note", "confidence"],
        properties: {
          item_ref: { type: "string" },
          unit_price: nullable("number"),
          lead_days: nullable("integer"),
          substitute: nullable("string"),
          note: nullable("string"),
          confidence: { type: "number" },
        },
      },
    },
    freight: nullable("number"),
    tax: nullable("number"),
    valid_until: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
    reference: nullable("string"),
    contact_name: nullable("string"),
    notes: nullable("string"),
  },
};

function aiUsable(c: Context<AppEnv>, org: OrgRow): boolean {
  const ctx = c.get("ctx");
  if (!ctx.ai.available) return false;
  try {
    assertAiQuota(c, org);
    return true;
  } catch {
    return false;
  }
}

/** Parses a pasted list with Claude when available, falling back to the built-in parser. */
export async function parseList(
  c: Context<AppEnv>,
  org: OrgRow,
  text: string,
): Promise<{ items: ParsedItem[]; method: "ai" | "heuristic" }> {
  const ctx = c.get("ctx");
  if (aiUsable(c, org)) {
    try {
      const out = await ctx.ai.json<{ items: { description: string; qty: number; unit: string; part_number: string | null; needs_review: boolean }[] }>({
        kind: "quoterunner.parse_list",
        system: PARSE_SYSTEM,
        input: `Material list:\n\n${text}`,
        schema: parseSchema,
        effort: "low",
        maxTokens: 8000,
        orgId: org.id,
      });
      const items = out.items
        .filter((i) => i.description?.trim())
        .map((i) => ({
          description: i.description.trim(),
          qty: Number.isFinite(i.qty) && i.qty > 0 ? i.qty : 1,
          unit: canonicalUnit(i.unit) ?? "ea",
          partNumber: i.part_number?.trim() || null,
          needsReview: Boolean(i.needs_review) || !(i.qty > 0),
        }));
      if (items.length) return { items, method: "ai" };
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
    }
  }
  return { items: parseItemList(text), method: "heuristic" };
}

/**
 * Reads a supplier quote from text and/or a PDF. Uses Claude when available; otherwise the
 * built-in reader handles plain text and a PDF without AI is rejected with a clear message.
 */
export async function extractQuote(
  c: Context<AppEnv>,
  org: OrgRow,
  input: { text?: string | null; pdfBase64?: string | null; items: ItemRow[]; today: string },
): Promise<ExtractedQuote> {
  const ctx = c.get("ctx");
  const text = input.text?.trim() ?? "";
  const items = input.items;
  if (aiUsable(c, org)) {
    const refs = items.map((_, i) => `L${i + 1}`);
    const listing = items
      .map((it, i) => `${refs[i]}: ${it.qty} ${it.unit} — ${it.description}${it.part_number ? ` (part ${it.part_number})` : ""}${it.allow_substitutes ? "" : " [no substitutes]"}`)
      .join("\n");
    try {
      const out = await ctx.ai.json<{
        lines: { item_ref: string; unit_price: number | null; lead_days: number | null; substitute: string | null; note: string | null; confidence: number }[];
        freight: number | null;
        tax: number | null;
        valid_until: string | null;
        reference: string | null;
        contact_name: string | null;
        notes: string | null;
      }>({
        kind: "quoterunner.extract_quote",
        system: EXTRACT_SYSTEM,
        input: `Today is ${input.today}.\n\nBuyer's lines:\n${listing}\n\nSupplier quote:\n${text || "(see the attached PDF)"}`,
        documents: input.pdfBase64 ? [{ mediaType: "application/pdf", base64: input.pdfBase64, title: "Supplier quote" }] : undefined,
        schema: extractSchema,
        effort: "medium",
        maxTokens: 12000,
        orgId: org.id,
      });
      const byRef = new Map(out.lines.map((l) => [l.item_ref.trim().toUpperCase(), l]));
      return {
        lines: items.map((it, i) => {
          const l = byRef.get(refs[i]);
          return {
            itemId: it.id,
            unitPrice: l && typeof l.unit_price === "number" && l.unit_price >= 0 ? l.unit_price : null,
            leadDays: l && typeof l.lead_days === "number" && l.lead_days >= 0 ? Math.round(l.lead_days) : null,
            substitute: l?.substitute?.trim() || null,
            note: l?.note?.trim() || null,
            confidence: l ? Math.max(0, Math.min(1, l.confidence ?? 0)) : 0,
          };
        }),
        freight: typeof out.freight === "number" && out.freight >= 0 ? out.freight : null,
        tax: typeof out.tax === "number" && out.tax >= 0 ? out.tax : null,
        validUntil: out.valid_until && /^\d{4}-\d{2}-\d{2}$/.test(out.valid_until) ? out.valid_until : null,
        reference: out.reference?.trim() || null,
        contactName: out.contact_name?.trim() || null,
        notes: out.notes?.trim() || null,
        method: "ai",
      };
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      if (!text) throw new HttpError(502, `ai_${err.code}`, `${err.message} You can also paste the quote text instead.`);
    }
  }
  if (!text) {
    throw new HttpError(
      400,
      "pdf_needs_ai",
      ctx.ai.available
        ? "You've used this month's AI quote reads. Paste the quote text instead, or upgrade for more."
        : "Reading PDFs needs AI, which isn't set up. Paste the quote text instead.",
    );
  }
  return extractQuoteHeuristic(
    text,
    items.map((i) => ({ id: i.id, description: i.description, qty: i.qty, unit: i.unit, partNumber: i.part_number })),
    input.today,
  );
}
