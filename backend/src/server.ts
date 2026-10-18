import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./db";
import { logger } from "./logger";

const server = createApp().listen(config.PORT, () => {
  logger.info({ port: config.PORT }, "API listening");
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
