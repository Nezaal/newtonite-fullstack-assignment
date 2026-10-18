import { execSync } from "node:child_process";
import { PrismaClient } from "../generated/prisma/client";

const TEST_DB_NAME = "newtonite_test";

// Runs once before all tests: make sure the test database exists and has the latest tables.
export default async function setup(): Promise<void> {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl || !testUrl) throw new Error("Test database URLs are missing (see vitest.config.ts)");

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const found = await admin.$queryRaw<{ exists: number }[]>`SELECT 1 AS exists FROM pg_database WHERE datname = ${TEST_DB_NAME}`;
    if (found.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
  } finally {
    await admin.$disconnect();
  }

  // Apply the same migrations the real app uses.
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}
