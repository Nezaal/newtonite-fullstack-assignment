import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { backoffMs, processNextJob } from "../src/outbox/processor";
import type { Handler } from "../src/outbox/handlers";
import { as, itemRow, makeItem, resetDb, seedFixture, type Fixture } from "./helpers";

let f: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await seedFixture();
});

const FAST = { baseDelayMs: 1000, maxDelayMs: 60_000, leaseMs: 30_000 };

async function requestApproval() {
  const item = await makeItem({
    teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, type: "PAYMENT", status: "IN_PROGRESS", title: "Refund #42",
  });
  const res = await as(f.memberA).post(`/items/${item.id}/transition`).send({ version: 1, to: "AWAITING_APPROVAL" });
  expect(res.status).toBe(200);
  return item;
}

describe("jobs are saved together with the change", () => {
  it("queues one job per Lead (not the assignee) when approval is requested", async () => {
    await requestApproval();
    const jobs = await prisma.outboxJob.findMany({ orderBy: { id: "asc" } });
    expect(jobs).toHaveLength(2); // leadA and lead2A
    expect(jobs.every((j) => j.type === "NOTIFY_APPROVAL_NEEDED" && j.status === "PENDING")).toBe(true);
    expect(jobs.map((j) => (j.payload as { userId: number }).userId).sort()).toEqual([f.leadA, f.lead2A].sort());
    expect(await prisma.notification.count()).toBe(0); // nothing is sent until the worker runs
  });

  it("queues a job when an item is assigned to someone else, but not for self-assignment", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    await as(f.leadA).post(`/items/${item.id}/assign`).send({ version: 1, assigneeId: f.leadA });
    expect(await prisma.outboxJob.count()).toBe(0);
    await as(f.leadA).post(`/items/${item.id}/assign`).send({ version: 2, assigneeId: f.memberA });
    const jobs = await prisma.outboxJob.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe("NOTIFY_ASSIGNED");
  });

  it("queues a job for the assignee when their item is rejected", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, type: "PAYMENT", status: "AWAITING_APPROVAL" });
    await as(f.leadA).post(`/items/${item.id}/transition`).send({ version: 1, to: "IN_PROGRESS", reason: "Missing receipt" });
    const job = await prisma.outboxJob.findFirstOrThrow();
    expect(job.type).toBe("NOTIFY_REJECTED");
    expect(job.payload).toMatchObject({ userId: f.memberA, reason: "Missing receipt" });
  });

  it("queues nothing when the change is refused", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, type: "PAYMENT", status: "IN_PROGRESS" });
    await as(f.member2A).post(`/items/${item.id}/transition`).send({ version: 1, to: "AWAITING_APPROVAL" }); // 403
    expect(await prisma.outboxJob.count()).toBe(0);
    expect((await itemRow(item.id)).status).toBe("IN_PROGRESS");
  });
});

describe("the worker", () => {
  it("turns jobs into notifications the right people can read", async () => {
    await requestApproval();
    expect(await processNextJob()).toBe(true);
    expect(await processNextJob()).toBe(true);
    expect(await processNextJob()).toBe(false); // queue is empty

    expect(await prisma.outboxJob.count({ where: { status: "DONE" } })).toBe(2);
    const mine = await as(f.leadA).get("/notifications");
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].message).toBe('"Refund #42" needs your approval');
    expect(mine.body.meta.unreadCount).toBe(1);
    expect((await as(f.memberA).get("/notifications")).body.data).toEqual([]); // the assignee gets none
  });

  it("running the same job twice creates only one notification", async () => {
    await requestApproval();
    await processNextJob();
    const job = await prisma.outboxJob.findFirstOrThrow({ where: { status: "DONE" } });

    // Pretend the worker crashed before it could mark the job DONE: the job comes back.
    await prisma.outboxJob.update({ where: { id: job.id }, data: { status: "PENDING", runAfter: new Date(0) } });
    await processNextJob();

    expect(await prisma.notification.count({ where: { jobId: job.id } })).toBe(1);
    expect((await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DONE");
  });

  it("retries a failing job with growing waits, then marks it FAILED after the maximum attempts", async () => {
    const job = await prisma.outboxJob.create({ data: { type: "BROKEN", payload: {} } });
    const failing: Handler = async () => {
      throw new Error("boom");
    };
    const opts = { ...FAST, maxAttempts: 3, handlers: { BROKEN: failing } };
    const start = new Date();

    // Attempt 1 fails: retry in 1s.
    await processNextJob({ ...opts, now: start });
    let row = await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "PENDING", attempts: 1, lastError: "boom" });
    expect(row.runAfter.getTime()).toBe(start.getTime() + 1000);

    // Not due yet: the worker leaves it alone.
    expect(await processNextJob({ ...opts, now: new Date(start.getTime() + 500) })).toBe(false);

    // Attempt 2 fails: wait doubles to 2s.
    const second = new Date(start.getTime() + 1500);
    await processNextJob({ ...opts, now: second });
    row = await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "PENDING", attempts: 2 });
    expect(row.runAfter.getTime()).toBe(second.getTime() + 2000);

    // Attempt 3 fails: out of attempts, so it is FAILED and never retried again.
    await processNextJob({ ...opts, now: new Date(second.getTime() + 2500) });
    row = await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 3, lastError: "boom" });
    expect(await processNextJob({ ...opts, now: new Date(second.getTime() + 999_999) })).toBe(false);
  });

  it("a job that fails once and then works ends up DONE", async () => {
    const job = await prisma.outboxJob.create({ data: { type: "FLAKY", payload: {} } });
    let calls = 0;
    const flaky: Handler = async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary");
    };
    const opts = { ...FAST, handlers: { FLAKY: flaky } };
    const start = new Date();
    await processNextJob({ ...opts, now: start });
    await processNextJob({ ...opts, now: new Date(start.getTime() + 5000) });
    expect(await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "DONE", attempts: 2, lastError: null });
  });

  it("marks a job with an unknown type as failed instead of crashing", async () => {
    const job = await prisma.outboxJob.create({ data: { type: "NO_SUCH_TYPE", payload: {} } });
    await processNextJob({ ...FAST, maxAttempts: 1 });
    const row = await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toMatch(/No handler/);
  });

  it("marks a job with a corrupt payload as failed", async () => {
    const job = await prisma.outboxJob.create({ data: { type: "NOTIFY_ASSIGNED", payload: { nonsense: true } } });
    await processNextJob({ ...FAST, maxAttempts: 1 });
    expect((await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
    expect(await prisma.notification.count()).toBe(0);
  });

  it("a job taken by a worker that then crashes comes back after the lease ends", async () => {
    await requestApproval();
    const start = new Date();
    // Worker 1 takes a job and "crashes": simulate by claiming through a handler that never finishes the DB update.
    const hang: Handler = () => new Promise<void>(() => undefined);
    void processNextJob({ ...FAST, now: start, handlers: { NOTIFY_APPROVAL_NEEDED: hang } });
    await new Promise((r) => setTimeout(r, 300));

    // Meanwhile another worker takes the *other* job, but not the leased one.
    expect(await processNextJob({ ...FAST, now: new Date(start.getTime() + 1000) })).toBe(true);
    expect(await processNextJob({ ...FAST, now: new Date(start.getTime() + 1000) })).toBe(false);

    // After the lease (30s) the abandoned job is picked up again and finished.
    expect(await processNextJob({ ...FAST, now: new Date(start.getTime() + 31_000) })).toBe(true);
    expect(await prisma.outboxJob.count({ where: { status: "DONE" } })).toBe(2);
    expect(await prisma.notification.count()).toBe(2);
  });

  it("two workers never take the same job", async () => {
    for (let i = 0; i < 6; i++) {
      await prisma.outboxJob.create({ data: { type: "NOTIFY_ASSIGNED", payload: { userId: f.memberA, itemId: 1, itemTitle: "t", actorName: "a" } } });
    }
    // The item does not exist, so we use a handler that just counts.
    const seen: number[] = [];
    const record: Handler = async (job) => {
      seen.push(job.id);
    };
    const opts = { ...FAST, handlers: { NOTIFY_ASSIGNED: record } };
    await Promise.all(Array.from({ length: 12 }, () => processNextJob(opts)));
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it("gives up on a job that keeps crashing its worker", async () => {
    const job = await prisma.outboxJob.create({ data: { type: "NOTIFY_ASSIGNED", payload: {}, attempts: 5 } });
    await processNextJob({ ...FAST, maxAttempts: 5 });
    expect(await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "FAILED" });
  });

  it("the wait between retries doubles but never passes the cap", () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, 1000, 60_000))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(20, 1000, 60_000)).toBe(60_000);
  });
});
