import { prisma } from "./db";
import { logger } from "./logger";
import { startWorker } from "./outbox/runner";

// Separate process from the API: it turns saved outbox jobs into notifications.
const worker = startWorker();
logger.info("Worker started");

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Worker shutting down");
  await worker.stop(); // lets the current job finish
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
