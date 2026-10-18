import type { Request, Response } from "express";
import { z } from "zod";
import { currentUser } from "./auth/types";
import type { AuthUser } from "./auth/types";

export function sendData(res: Response, data: unknown, meta?: Record<string, unknown>, status = 200): void {
  res.status(status).json({ success: true, data, error: null, ...(meta ? { meta } : {}) });
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });

// Validates input. A failure throws a ZodError, which the error handler turns into a 400.
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  return schema.parse(input);
}

// The logged-in user plus the :id from the URL.
export function userAndId(req: Request): { user: AuthUser; id: number } {
  return { user: currentUser(req), id: parseInput(idParam, req.params).id };
}

export function idempotencyKey(req: Request): string | undefined {
  const raw = req.header("Idempotency-Key");
  if (raw === undefined) return undefined;
  return parseInput(z.string().trim().min(1).max(255), raw);
}
