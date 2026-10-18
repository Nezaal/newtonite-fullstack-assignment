import "dotenv/config";
import { defineConfig } from "vitest/config";

const TEST_DB_NAME = "newtonite_test";

// Tests use their own database so they can never touch the demo data.
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
const testUrl = withDatabase(adminUrl, TEST_DB_NAME);

// Read by tests/global-setup.ts (runs in this main process).
process.env.TEST_ADMIN_DATABASE_URL = adminUrl;
process.env.TEST_DATABASE_URL = testUrl;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // All test files share one database, so run them one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testUrl,
      JWT_SECRET: "test-secret-for-automated-tests-only",
      JWT_EXPIRES_IN: "1h",
      RATE_LIMIT_MAX: "1000000",
      LOGIN_RATE_LIMIT_MAX: "1000000",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/worker.ts"],
    },
  },
});
