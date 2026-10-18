import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { as, itemRow, makeItem, resetDb, seedFixture, type Fixture } from "./helpers";

let f: Fixture;
let itemId: number;

beforeEach(async () => {
  await resetDb();
  f = await seedFixture();
  itemId = (await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, title: "Secret Alpha item" })).id;
});

describe("an outsider (not in the item's team) cannot see or touch the item", () => {
  it("gets 404 (not 403) on every read", async () => {
    const outsider = as(f.memberB);
    for (const path of [`/items/${itemId}`, `/items/${itemId}/activity`, `/items/${itemId}/comments`]) {
      const res = await outsider.get(path);
      expect(res.status, path).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/Secret Alpha/);
    }
  });

  it("gets 404 on every write, and nothing changes", async () => {
    const outsider = as(f.leadB); // even a Lead of another team
    const attempts = [
      outsider.patch(`/items/${itemId}`).send({ version: 1, title: "Hacked" }),
      outsider.post(`/items/${itemId}/claim`),
      outsider.post(`/items/${itemId}/release`),
      outsider.post(`/items/${itemId}/assign`).send({ version: 1, assigneeId: f.leadB }),
      outsider.post(`/items/${itemId}/transition`).send({ version: 1, to: "IN_PROGRESS" }),
      outsider.post(`/items/${itemId}/comments`).send({ body: "Hi" }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

    const row = await itemRow(itemId);
    expect(row).toMatchObject({ title: "Secret Alpha item", assigneeId: f.memberA, status: "OPEN", version: 1 });
    expect(await prisma.comment.count()).toBe(0);
    expect(await prisma.activityEvent.count()).toBe(0);
  });

  it("gives the same 404 for an item that does not exist, so existence is not revealed", async () => {
    const real = await as(f.memberB).get(`/items/${itemId}`);
    const fake = await as(f.memberB).get("/items/99999");
    expect(real.status).toBe(fake.status);
    expect(real.body).toEqual(fake.body);
  });

  it("does not show the item in lists, search or dashboard counts", async () => {
    const list = await as(f.memberB).get("/items");
    expect(list.body.data).toEqual([]);
    const search = await as(f.memberB).get("/items?q=secret");
    expect(search.body.data).toEqual([]);
    const byTeam = await as(f.memberB).get(`/items?teamId=${f.teamA}`); // asking for the other team's items
    expect(byTeam.body.data).toEqual([]);
    const dash = await as(f.memberB).get("/dashboard");
    expect(Object.values(dash.body.data).every((n) => n === 0)).toBe(true);
  });

  it("cannot create items in a team they do not belong to", async () => {
    const res = await as(f.memberB).post("/items").send({ teamId: f.teamA, title: "Sneaky", type: "TASK" });
    expect(res.status).toBe(404);
    expect(await prisma.workItem.count()).toBe(1);
  });

  it("cannot list the members of another team", async () => {
    expect((await as(f.memberB).get(`/teams/${f.teamA}/members`)).status).toBe(404);
    expect((await as(f.memberA).get(`/teams/${f.teamA}/members`)).status).toBe(200);
  });
});

describe("roles inside the team", () => {
  it("a Viewer can read and comment, but cannot create, claim or edit", async () => {
    const viewer = as(f.viewerA);
    expect((await viewer.get(`/items/${itemId}`)).status).toBe(200);
    expect((await viewer.post(`/items/${itemId}/comments`).send({ body: "I am watching" })).status).toBe(201);
    expect((await viewer.post("/items").send({ teamId: f.teamA, title: "x", type: "TASK" })).status).toBe(403);
    expect((await viewer.patch(`/items/${itemId}`).send({ version: 1, title: "x" })).status).toBe(403);
  });

  it("a Member can create, and edit their own item but not someone else's", async () => {
    const created = await as(f.member2A).post("/items").send({ teamId: f.teamA, title: "Mine", type: "TASK" });
    expect(created.status).toBe(201);
    expect(created.body.data.createdBy.id).toBe(f.member2A);
    expect(created.body.data.status).toBe("OPEN");

    const notMine = await as(f.member2A).patch(`/items/${itemId}`).send({ version: 1, title: "Not mine" });
    expect(notMine.status).toBe(403);
    const mine = await as(f.memberA).patch(`/items/${itemId}`).send({ version: 1, title: "Mine now" });
    expect(mine.status).toBe(200);
  });

  it("a Lead can edit any item in the team", async () => {
    const res = await as(f.leadA).patch(`/items/${itemId}`).send({ version: 1, priority: "URGENT" });
    expect(res.status).toBe(200);
  });

  it("an Admin can work in every team", async () => {
    const admin = as(f.admin);
    expect((await admin.get(`/items/${itemId}`)).status).toBe(200);
    const other = await makeItem({ teamId: f.teamB, createdById: f.leadB });
    expect((await admin.get(`/items/${other.id}`)).status).toBe(200);
    expect((await admin.post(`/items/${other.id}/claim`)).status).toBe(200);
  });

  it("tells the UI what the user may do (actions follow the same rules)", async () => {
    const asMember = await as(f.member2A).get(`/items/${itemId}`);
    expect(asMember.body.data.actions).toMatchObject({ edit: false, assign: false, claim: false, comment: true });
    const asLead = await as(f.leadA).get(`/items/${itemId}`);
    expect(asLead.body.data.actions).toMatchObject({ edit: true, assign: true, release: true });
  });
});

describe("notifications are private", () => {
  it("only the owner can see or mark their notification", async () => {
    const job = await prisma.outboxJob.create({ data: { type: "NOTIFY_ASSIGNED", payload: {}, status: "DONE" } });
    const note = await prisma.notification.create({ data: { userId: f.memberA, itemId, jobId: job.id, message: "Hi" } });

    expect((await as(f.member2A).get("/notifications")).body.data).toEqual([]);
    expect((await as(f.member2A).post(`/notifications/${note.id}/read`)).status).toBe(404);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: note.id } })).isRead).toBe(false);

    expect((await as(f.memberA).get("/notifications")).body.meta.unreadCount).toBe(1);
    expect((await as(f.memberA).post(`/notifications/${note.id}/read`)).status).toBe(200);
    expect((await as(f.memberA).get("/notifications")).body.meta.unreadCount).toBe(0);
  });
});

describe("comments", () => {
  it("adds a comment and a matching history row, newest comment first", async () => {
    await as(f.memberA).post(`/items/${itemId}/comments`).send({ body: "First" });
    await as(f.leadA).post(`/items/${itemId}/comments`).send({ body: "Second" });
    const list = await as(f.viewerA).get(`/items/${itemId}/comments`);
    expect(list.body.data.map((c: { body: string }) => c.body)).toEqual(["Second", "First"]);
    expect(await prisma.activityEvent.count({ where: { itemId, action: "commented" } })).toBe(2);
  });
});
