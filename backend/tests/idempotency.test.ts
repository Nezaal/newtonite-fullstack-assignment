import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { deleteExpiredKeys, IDEMPOTENCY_TTL_MS } from "../src/idempotency";
import { as, makeItem, resetDb, seedFixture, type Fixture } from "./helpers";

let f: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await seedFixture();
});

const newItem = (teamId: number) => ({ teamId, title: "Printer is on fire", type: "INCIDENT", priority: "URGENT" });

describe("Idempotency-Key on create item", () => {
  it("creates one item and returns the same response when the key is sent twice", async () => {
    const first = await as(f.memberA).post("/items").set("Idempotency-Key", "key-1").send(newItem(f.teamA));
    const second = await as(f.memberA).post("/items").set("Idempotency-Key", "key-1").send(newItem(f.teamA));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(first.headers["idempotent-replayed"]).toBe("false");
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(await prisma.workItem.count()).toBe(1);
    expect(await prisma.activityEvent.count()).toBe(1); // one "created" event, not two
  });

  it("creates only one item when two identical requests arrive at the same moment", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => as(f.memberA).post("/items").set("Idempotency-Key", "race").send(newItem(f.teamA))),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await prisma.workItem.count()).toBe(1);
    expect(await prisma.activityEvent.count()).toBe(1);
  });

  it("creates two items when the keys differ, or when no key is sent", async () => {
    await as(f.memberA).post("/items").set("Idempotency-Key", "a").send(newItem(f.teamA));
    await as(f.memberA).post("/items").set("Idempotency-Key", "b").send(newItem(f.teamA));
    await as(f.memberA).post("/items").send(newItem(f.teamA));
    expect(await prisma.workItem.count()).toBe(3);
  });

  it("keeps keys separate per user", async () => {
    const a = await as(f.memberA).post("/items").set("Idempotency-Key", "same").send(newItem(f.teamA));
    const b = await as(f.member2A).post("/items").set("Idempotency-Key", "same").send(newItem(f.teamA));
    expect(b.body.data.id).not.toBe(a.body.data.id);
    expect(await prisma.workItem.count()).toBe(2);
  });

  it("does not save the key when the request fails, so a retry can succeed", async () => {
    const denied = await as(f.viewerA).post("/items").set("Idempotency-Key", "viewer-key").send(newItem(f.teamA));
    expect(denied.status).toBe(403);
    expect(await prisma.idempotencyKey.count()).toBe(0);
  });

  it("forgets keys after 24 hours", async () => {
    const first = await as(f.memberA).post("/items").set("Idempotency-Key", "old").send(newItem(f.teamA));
    await prisma.idempotencyKey.updateMany({ data: { createdAt: new Date(Date.now() - IDEMPOTENCY_TTL_MS - 60_000) } });

    const again = await as(f.memberA).post("/items").set("Idempotency-Key", "old").send(newItem(f.teamA));

    expect(again.status).toBe(201);
    expect(again.body.data.id).not.toBe(first.body.data.id);
    expect(again.headers["idempotent-replayed"]).toBe("false");
  });

  it("the cleanup removes only expired keys", async () => {
    await as(f.memberA).post("/items").set("Idempotency-Key", "fresh").send(newItem(f.teamA));
    await as(f.memberA).post("/items").set("Idempotency-Key", "stale").send(newItem(f.teamA));
    await prisma.idempotencyKey.updateMany({
      where: { key: "stale" },
      data: { createdAt: new Date(Date.now() - IDEMPOTENCY_TTL_MS - 60_000) },
    });
    expect(await deleteExpiredKeys()).toBe(1);
    expect((await prisma.idempotencyKey.findMany()).map((k) => k.key)).toEqual(["fresh"]);
  });

  it("rejects an empty key", async () => {
    const res = await as(f.memberA).post("/items").set("Idempotency-Key", "   ").send(newItem(f.teamA));
    expect(res.status).toBe(400);
  });
});

describe("Idempotency-Key on add comment", () => {
  it("adds one comment when the same key is sent twice", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    const send = () => as(f.viewerA).post(`/items/${item.id}/comments`).set("Idempotency-Key", "c-1").send({ body: "Hello" });

    const [first, second] = [await send(), await send()];

    expect(first.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await prisma.comment.count()).toBe(1);
    expect(await prisma.activityEvent.count({ where: { action: "commented" } })).toBe(1);
  });

  it("adds one comment when a double click sends two requests at once", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    await Promise.all(
      Array.from({ length: 4 }, () =>
        as(f.memberA).post(`/items/${item.id}/comments`).set("Idempotency-Key", "dbl").send({ body: "Once please" }),
      ),
    );
    expect(await prisma.comment.count()).toBe(1);
  });
});
