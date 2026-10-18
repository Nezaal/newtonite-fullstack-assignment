import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "./logger";

// An error we expect and know how to explain to the client.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    // Extra fields sent to the client, e.g. the latest item on a 409.
    readonly extra: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST", extra = {}) => new HttpError(400, code, message, extra);
export const unauthorized = (message = "Please log in") => new HttpError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You are not allowed to do this") => new HttpError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new HttpError(404, "NOT_FOUND", message);
export const conflict = (code: string, message: string, extra = {}) => new HttpError(409, code, message, extra);

function errorBody(code: string, message: string, extra: Readonly<Record<string, unknown>> = {}) {
  return { success: false, data: null, error: { code, message, ...extra } };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(errorBody("NOT_FOUND", "Route not found"));
};

// Express 5 passes errors from async handlers here automatically.
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json(errorBody(error.code, error.message, error.extra));
    return;
  }
  if (error instanceof ZodError) {
    const details = error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    res.status(400).json(errorBody("VALIDATION_ERROR", "Some fields are invalid", { details }));
    return;
  }
  if (typeof error === "object" && error !== null && (error as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json(errorBody("BAD_JSON", "Request body is not valid JSON"));
    return;
  }
  // Unknown problem: log the details here, tell the client nothing sensitive.
  logger.error({ err: error }, "Unhandled error");
  res.status(500).json(errorBody("INTERNAL_ERROR", "Something went wrong. Please try again."));
};
