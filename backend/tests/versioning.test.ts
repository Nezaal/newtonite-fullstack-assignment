import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { as, eventsOf, itemRow, makeItem, resetDb, seedFixture, type Fixture } from "./helpers";

let f: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await seedFixture();
});

describe("stale edits (version check)", () => {
  it("accepts an edit with the current version and bumps the version", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, title: "Old" });
    const res = await as(f.memberA).patch(`/items/${item.id}`).send({ version: 1, title: "New" });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("New");
    expect(res.body.data.version).toBe(2);
  });

  it("rejects an edit with an old version, returns the latest item, and changes nothing", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, title: "Original" });
    await as(f.leadA).patch(`/items/${item.id}`).send({ version: 1, title: "Changed by lead" }); // now version 2

    const stale = await as(f.memberA).patch(`/items/${item.id}`).send({ version: 1, title: "My old edit" });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(stale.body.error.current.title).toBe("Changed by lead");
    expect(stale.body.error.current.version).toBe(2);
    const row = await itemRow(item.id);
    expect(row.title).toBe("Changed by lead");
    expect(row.version).toBe(2);
    expect((await eventsOf(item.id)).filter((e) => e.action === "title_changed")).toHaveLength(1);
  });

  it("lets only one of two simultaneous edits with the same version through", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA });

    const [a, b] = await Promise.all([
      as(f.leadA).patch(`/items/${item.id}`).send({ version: 1, title: "From lead A" }),
      as(f.lead2A).patch(`/items/${item.id}`).send({ version: 1, title: "From lead two" }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = await itemRow(item.id);
    expect(row.version).toBe(2);
    expect(["From lead A", "From lead two"]).toContain(row.title);
  });

  it("applies the version check to assign and transition too", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA });
    await as(f.leadA).patch(`/items/${item.id}`).send({ version: 1, priority: "HIGH" }); // version 2

    const assign = await as(f.leadA).post(`/items/${item.id}/assign`).send({ version: 1, assigneeId: f.member2A });
    const move = await as(f.memberA).post(`/items/${item.id}/transition`).send({ version: 1, to: "IN_PROGRESS" });

    expect(assign.status).toBe(409);
    expect(move.status).toBe(409);
    const row = await itemRow(item.id);
    expect(row.assigneeId).toBe(f.memberA);
    expect(row.status).toBe("OPEN");
  });

  it("requires a version on edits", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA });
    const res = await as(f.memberA).patch(`/items/${item.id}`).send({ title: "No version" });
    expect(res.status).toBe(400);
  });

  it("does not bump the version when nothing really changed", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, title: "Same" });
    const res = await as(f.memberA).patch(`/items/${item.id}`).send({ version: 1, title: "Same" });
    expect(res.status).toBe(200);
    expect((await itemRow(item.id)).version).toBe(1);
    expect(await eventsOf(item.id)).toHaveLength(0);
  });

  it("logs one history row per changed field, in the same change as the version bump", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, title: "A", priority: "LOW" });
    await as(f.memberA).patch(`/items/${item.id}`).send({ version: 1, title: "B", priority: "URGENT" });
    const events = await eventsOf(item.id);
    expect(events.map((e) => e.action).sort()).toEqual(["priority_changed", "title_changed"]);
    expect(events.find((e) => e.action === "priority_changed")).toMatchObject({ oldValue: "LOW", newValue: "URGENT" });
    expect((await itemRow(item.id)).version).toBe(2);
  });

  it("closed items cannot be edited", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, status: "CLOSED" });
    const res = await as(f.leadA).patch(`/items/${item.id}`).send({ version: 1, title: "Nope" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ITEM_CLOSED");
  });

  it("moving to another team (Lead only) clears the owner and reopens the item", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, status: "IN_PROGRESS" });
    // This Lead has a role in both teams.
    await prisma.membership.create({ data: { userId: f.leadA, teamId: f.teamB, role: "MEMBER" } });

    const res = await as(f.leadA).patch(`/items/${item.id}`).send({ version: 1, teamId: f.teamB });
    expect(res.status).toBe(200);
    const row = await itemRow(item.id);
    expect(row).toMatchObject({ teamId: f.teamB, assigneeId: null, status: "OPEN", version: 2 });
    expect((await eventsOf(item.id)).map((e) => e.action)).toEqual(["team_changed", "assigned", "status_changed"]);
  });

  it("a Member cannot move an item to another team", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA });
    const res = await as(f.memberA).patch(`/items/${item.id}`).send({ version: 1, teamId: f.teamB });
    expect(res.status).toBe(403);
    expect((await itemRow(item.id)).teamId).toBe(f.teamA);
  });

  it("a Lead cannot dump an item into a team they have no role in", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    const res = await as(f.leadA).patch(`/items/${item.id}`).send({ version: 1, teamId: f.teamB });
    expect(res.status).toBe(404);
    expect((await itemRow(item.id)).teamId).toBe(f.teamA);
  });
});
