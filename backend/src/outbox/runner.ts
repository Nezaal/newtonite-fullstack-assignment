import { deleteExpiredKeys } from "../idempotency";
import { logger } from "../logger";
import { processNextJob } from "./processor";

const POLL_MS = 1_000;
const ERROR_PAUSE_MS = 5_000;
const CLEANUP_EVERY_MS = 10 * 60_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Keeps taking jobs until stopped. Drains the queue quickly, then polls once a second.
export function startWorker(): { stop: () => Promise<void> } {
  let running = true;
  let lastCleanup = 0;

  const loop = (async () => {
    while (running) {
      try {
        const handled = await processNextJob();
        if (!handled) await sleep(POLL_MS);

        if (Date.now() - lastCleanup > CLEANUP_EVERY_MS) {
          lastCleanup = Date.now();
          const removed = await deleteExpiredKeys();
          if (removed > 0) logger.info({ removed }, "Deleted expired idempotency keys");
        }
      } catch (error) {
        // e.g. the database is briefly down: log, wait, try again.
        logger.error({ err: error }, "Worker loop error");
        await sleep(ERROR_PAUSE_MS);
      }
    }
  })();

  return {
    stop: async () => {
      running = false;
      await loop;
    },
  };
}
