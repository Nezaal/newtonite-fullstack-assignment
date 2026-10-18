import cors from "cors";
import express, { type Express } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { authenticate } from "./auth/middleware";
import { loginRouter, meRouter } from "./auth/routes";
import { config } from "./config";
import { dashboardRouter } from "./dashboard/routes";
import { prisma } from "./db";
import { errorHandler, HttpError, notFoundHandler } from "./errors";
import { itemsRouter } from "./items/routes";
import { notificationsRouter } from "./notifications/routes";
import { teamsRouter } from "./teams/routes";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);

  app.use(helmet());
  app.use(
    cors({
      origin: config.CORS_ORIGIN.split(",").map((o) => o.trim()),
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
      exposedHeaders: ["Idempotent-Replayed"],
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.RATE_LIMIT_MAX,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new HttpError(429, "RATE_LIMITED", "Too many requests. Slow down a little.")),
    }),
  );

  // Public: health check and login.
  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "database unavailable" });
    }
  });
  app.use(loginRouter);

  // Everything below needs a valid token.
  app.use(authenticate);
  app.use(meRouter);
  app.use(dashboardRouter);
  app.use(itemsRouter);
  app.use(teamsRouter);
  app.use(notificationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
