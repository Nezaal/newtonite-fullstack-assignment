import type { Prisma } from "../generated/prisma/client";
import { isUniqueViolation, prisma, type Db } from "./db";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface IdempotentResult {
  readonly response: StoredResponse;
  readonly replayed: boolean;
}

const asJson = (value: StoredResponse): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

// Runs `work` once per (user, key). A repeat of the same key returns the stored response
// instead of doing the work again. The key is saved in the SAME transaction as the work,
// so either both are saved or neither is. Keys older than 24 hours are ignored.
export async function runIdempotent(
  userId: number,
  key: string | undefined,
  work: (tx: Db) => Promise<StoredResponse>,
): Promise<IdempotentResult> {
  if (!key) {
    return { response: await prisma.$transaction(work), replayed: false };
  }

  const where = { userId_key: { userId, key } };
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.idempotencyKey.findUnique({ where });
      if (existing) {
        if (Date.now() - existing.createdAt.getTime() < IDEMPOTENCY_TTL_MS) {
          return { response: existing.response as unknown as StoredResponse, replayed: true };
        }
        await tx.idempotencyKey.delete({ where }); // expired: start fresh
      }
      const response = await work(tx);
      await tx.idempotencyKey.create({ data: { userId, key, response: asJson(response) } });
      return { response, replayed: false };
    });
  } catch (error) {
    // Two identical requests arrived at the same moment. The database lets only one save the key;
    // this one lost, its work was rolled back, so return what the winner saved.
    if (isUniqueViolation(error)) {
      const stored = await prisma.idempotencyKey.findUnique({ where });
      if (stored) return { response: stored.response as unknown as StoredResponse, replayed: true };
    }
    throw error;
  }
}

export async function deleteExpiredKeys(now = new Date()): Promise<number> {
  const result = await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_TTL_MS) } },
  });
  return result.count;
}
