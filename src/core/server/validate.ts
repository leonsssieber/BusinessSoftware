import type { Context } from "hono";
import { z } from "zod";
import { badRequest } from "./errors.js";

/** Validates `data` against `schema`, throwing a 400 that lists each invalid field. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    const first = fields[0];
    const message = first
      ? `${first.path ? `${first.path}: ` : ""}${first.message}`
      : "The request was not valid.";
    throw badRequest(message, { fields });
  }
  return result.data;
}

/** Reads and validates a JSON request body. */
export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw badRequest("The request body must be valid JSON.");
  }
  return parse(schema, data);
}

export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address.");

export const zPassword = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "Use at most 200 characters.");

export const zName = z.string().trim().min(1, "Required.").max(120);
