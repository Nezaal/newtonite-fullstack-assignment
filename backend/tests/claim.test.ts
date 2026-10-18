import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { as, eventsOf, itemRow, makeItem, resetDb, seedFixture, type Fixture } from "./helpers";

let f: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await seedFixture();
});

describe("claiming an item", () => {
  it("lets exactly one of two simultaneous claims win; the other gets 409", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });

    const [first, second] = await Promise.all([
      as(f.memberA).post(`/items/${item.id}/claim`),
      as(f.member2A).post(`/items/${item.id}/claim`),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = first.status === 200 ? f.memberA : f.member2A;
    const loser = first.status === 200 ? second : first;
    expect(loser.body.error.code).toBe("ALREADY_CLAIMED");
    expect(loser.body.error.message).toMatch(/already claimed by/i);

    const row = await itemRow(item.id);
    expect(row.assigneeId).toBe(winner);
    expect(row.version).toBe(2); // bumped once, not twice
    expect((await eventsOf(item.id)).filter((e) => e.action === "assigned")).toHaveLength(1);
  });

  it("stays correct with many people claiming at once", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    const claimers = [f.memberA, f.member2A, f.leadA, f.lead2A, f.admin];

    const results = await Promise.all(claimers.map((id) => as(id).post(`/items/${item.id}/claim`)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(claimers.length - 1);
    expect((await itemRow(item.id)).version).toBe(2);
  });

  it("rejects a claim on an item that already has an owner", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA });
    const res = await as(f.member2A).post(`/items/${item.id}/claim`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_CLAIMED");
    expect((await itemRow(item.id)).assigneeId).toBe(f.memberA);
  });

  it("does not let a Viewer claim", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    const res = await as(f.viewerA).post(`/items/${item.id}/claim`);
    expect(res.status).toBe(403);
    expect((await itemRow(item.id)).assigneeId).toBeNull();
  });

  it("does not let an outsider claim, and hides the item (404)", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    const res = await as(f.memberB).post(`/items/${item.id}/claim`);
    expect(res.status).toBe(404);
    expect((await itemRow(item.id)).assigneeId).toBeNull();
  });

  it("release gives the item back: In Progress goes to Open and the owner is cleared", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, status: "IN_PROGRESS" });
    const res = await as(f.memberA).post(`/items/${item.id}/release`);
    expect(res.status).toBe(200);
    const row = await itemRow(item.id);
    expect(row.assigneeId).toBeNull();
    expect(row.status).toBe("OPEN");
    const actions = (await eventsOf(item.id)).map((e) => e.action);
    expect(actions).toEqual(["assigned", "status_changed"]);
  });

  it("a Member cannot release someone else's item, but a Lead can", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, status: "IN_PROGRESS" });
    expect((await as(f.member2A).post(`/items/${item.id}/release`)).status).toBe(403);
    expect((await as(f.leadA).post(`/items/${item.id}/release`)).status).toBe(200);
  });

  it("rolls back the claim if writing the history fails (same transaction)", async () => {
    // Make the history insert fail (a temporary DB rule blocks "assigned" rows) after the item was already updated.
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    await prisma.$executeRawUnsafe(`ALTER TABLE activity_events ADD CONSTRAINT test_block CHECK (action <> 'assigned') NOT VALID`);
    try {
      const res = await as(f.memberA).post(`/items/${item.id}/claim`);
      expect(res.status).toBe(500);
      const row = await itemRow(item.id);
      expect(row.assigneeId).toBeNull(); // the claim was undone together with the failed history write
      expect(row.version).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE activity_events DROP CONSTRAINT test_block`);
    }
  });
});
