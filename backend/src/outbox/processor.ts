import { prisma } from "../db";
import { defaultHandlers, type Handler, type JobRow } from "./handlers";

export interface ProcessOptions {
  readonly now?: Date;
  readonly maxAttempts?: number;
  // First retry waits this long; each next retry waits twice as long (capped).
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  // How long a worker "owns" a job it picked up. If it crashes, the job reappears after this.
  readonly leaseMs?: number;
  readonly handlers?: Readonly<Record<string, Handler>>;
}

const DEFAULTS = {
  maxAttempts: 5,
  baseDelayMs: 2_000,
  maxDelayMs: 5 * 60_000,
  leaseMs: 30_000,
};

export const backoffMs = (attempts: number, baseDelayMs: number, maxDelayMs: number): number =>
  Math.min(baseDelayMs * 2 ** Math.max(attempts - 1, 0), maxDelayMs);

// Picks one due job and "leases" it: attempts goes up and run_after moves into the future.
// FOR UPDATE SKIP LOCKED means two workers never get the same job. If this worker dies mid-job,
// the lease runs out and the job is picked up again (so handlers must be safe to run twice).
async function claimNextJob(now: Date, leaseMs: number): Promise<JobRow | null> {
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const rows = await prisma.$queryRaw<JobRow[]>`
    UPDATE outbox_jobs
    SET attempts = attempts + 1, run_after = ${leaseUntil.toISOString()}::timestamp
    WHERE id = (
      SELECT id FROM outbox_jobs
      WHERE status = 'PENDING' AND run_after <= ${now.toISOString()}::timestamp
      ORDER BY run_after, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, attempts`;
  return rows[0] ?? null;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 1000);

// Returns true if a job was handled (successfully or not), false if nothing was due.
export async function processNextJob(options: ProcessOptions = {}): Promise<boolean> {
  const { maxAttempts, baseDelayMs, maxDelayMs, leaseMs } = { ...DEFAULTS, ...options };
  const handlers = options.handlers ?? defaultHandlers;
  const now = options.now ?? new Date();

  const job = await claimNextJob(now, leaseMs);
  if (!job) return false;

  // Reached when a worker kept crashing on this job: stop retrying it forever.
  if (job.attempts > maxAttempts) {
    await prisma.outboxJob.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: "Gave up: too many attempts (the worker may have crashed while running it)" },
    });
    return true;
  }

  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`No handler for job type "${job.type}"`);
    await handler(job);
    await prisma.outboxJob.update({ where: { id: job.id }, data: { status: "DONE", lastError: null } });
  } catch (error) {
    const exhausted = job.attempts >= maxAttempts;
    await prisma.outboxJob.update({
      where: { id: job.id },
      data: exhausted
        ? { status: "FAILED", lastError: messageOf(error) }
        : {
            lastError: messageOf(error),
            runAfter: new Date(now.getTime() + backoffMs(job.attempts, baseDelayMs, maxDelayMs)),
          },
    });
  }
  return true;
}
