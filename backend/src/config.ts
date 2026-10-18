import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("8h"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  // Requests per minute per IP, for the whole API.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  // Login attempts per 15 minutes per IP.
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  // Number of proxies in front of the API (1 behind nginx).
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

export type Config = z.infer<typeof schema>;

// Fail at startup with a clear message, instead of failing later in a random place.
function load(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment settings:\n${problems}`);
  }
  return result.data;
}

export const config: Config = load();
