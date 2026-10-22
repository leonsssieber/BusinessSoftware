/** An error that maps to an HTTP response with a stable machine-readable code. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "bad_request", message, details);

export const unauthorized = (message = "Sign in to continue.") =>
  new HttpError(401, "unauthorized", message);

export const forbidden = (message = "You don't have access to this.") =>
  new HttpError(403, "forbidden", message);

export const notFound = (message = "Not found.") => new HttpError(404, "not_found", message);

export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, "conflict", message, details);

export const planLimit = (message: string, details?: unknown) =>
  new HttpError(402, "plan_limit", message, details);

export const tooManyRequests = (message = "Too many requests. Try again in a minute.") =>
  new HttpError(429, "rate_limited", message);

export const unavailable = (code: string, message: string) => new HttpError(503, code, message);
