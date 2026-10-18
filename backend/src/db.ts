import { Prisma, PrismaClient } from "../generated/prisma/client";

export const prisma = new PrismaClient();

// Works for both the normal client and the client inside prisma.$transaction(...)
export type Db = Prisma.TransactionClient;

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
