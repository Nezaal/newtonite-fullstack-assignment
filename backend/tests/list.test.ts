import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { as, makeItem, resetDb, seedFixture, type Fixture } from "./helpers";

let f: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await seedFixture();
});

const idsOf = (res: { body: { data: { id: number }[] } }) => res.body.data.map((i) => i.id);

describe("filters", () => {
  it("filters by status, priority, type, team and assignee", async () => {
    const a = await makeItem({ teamId: f.teamA, createdById: f.leadA, status: "OPEN", priority: "URGENT", type: "INCIDENT" });
    const b = await makeItem({ teamId: f.teamA, createdById: f.leadA, status: "IN_PROGRESS", priority: "LOW", type: "TASK", assigneeId: f.memberA });
    await prisma.membership.create({ data: { userId: f.leadA, teamId: f.teamB, role: "MEMBER" } });
    const c = await makeItem({ teamId: f.teamB, createdById: f.leadB, status: "OPEN", priority: "LOW", type: "TASK" });
    const lead = as(f.leadA);

    expect(idsOf(await lead.get("/items?status=IN_PROGRESS"))).toEqual([b.id]);
    expect(idsOf(await lead.get("/items?priority=URGENT"))).toEqual([a.id]);
    expect(idsOf(await lead.get("/items?type=INCIDENT"))).toEqual([a.id]);
    expect(idsOf(await lead.get(`/items?teamId=${f.teamB}`))).toEqual([c.id]);
    expect(idsOf(await lead.get("/items?assignee=none")).sort()).toEqual([a.id, c.id].sort());
    expect(idsOf(await as(f.memberA).get("/items?assignee=me"))).toEqual([b.id]);
    expect(idsOf(await lead.get(`/items?assignee=${f.memberA}`))).toEqual([b.id]);
  });

  it("combines filters", async () => {
    await makeItem({ teamId: f.teamA, createdById: f.leadA, status: "OPEN", priority: "URGENT" });
    const hit = await makeItem({ teamId: f.teamA, createdById: f.leadA, status: "OPEN", priority: "URGENT", type: "INCIDENT" });
    await makeItem({ teamId: f.teamA, createdById: f.leadA, status: "OPEN", priority: "LOW", type: "INCIDENT" });
    expect(idsOf(await as(f.leadA).get("/items?status=OPEN&priority=URGENT&type=INCIDENT"))).toEqual([hit.id]);
  });
});

describe("search", () => {
  it("searches title and description, ignoring case, and matches the start of a word", async () => {
    const byTitle = await makeItem({ teamId: f.teamA, createdById: f.leadA, title: "Refund not received" });
    const byDescription = await makeItem({ teamId: f.teamA, createdById: f.leadA, title: "Customer call", description: "Wants a REFUND today" });
    await makeItem({ teamId: f.teamA, createdById: f.leadA, title: "Server outage" });
    const lead = as(f.leadA);

    expect(idsOf(await lead.get("/items?q=refund")).sort()).toEqual([byTitle.id, byDescription.id].sort());
    expect(idsOf(await lead.get("/items?q=REFU")).sort()).toEqual([byTitle.id, byDescription.id].sort());
    expect(idsOf(await lead.get("/items?q=refund+received"))).toEqual([byTitle.id]);
    expect(idsOf(await lead.get("/items?q=nothingmatches"))).toEqual([]);
  });

  it("cannot be broken by special characters", async () => {
    await makeItem({ teamId: f.teamA, createdById: f.leadA, title: "Plain item" });
    for (const q of ["'", "a & | ! b", "(((", "\\", "%_", ":*", "SELECT 1; --"]) {
      const res = await as(f.leadA).get("/items").query({ q });
      expect(res.status, q).toBe(200);
    }
  });

  it("does not return items from other teams", async () => {
    await makeItem({ teamId: f.teamB, createdById: f.leadB, title: "Refund for team B" });
    expect(idsOf(await as(f.leadA).get("/items?q=refund"))).toEqual([]);
  });
});

describe("cursor pagination", () => {
  it("walks through every item exactly once, newest updated first", async () => {
    const base = Date.now() - 1_000_000;
    const created = [];
    for (let n = 0; n < 23; n++) {
      // Several items share the same timestamp, to test the tie-break by id.
      created.push(await makeItem({ teamId: f.teamA, createdById: f.leadA, updatedAt: new Date(base + Math.floor(n / 3) * 1000) }));
    }
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: { body: { data: { id: number }[]; meta: { nextCursor: string | null } } } = await as(f.leadA)
        .get("/items")
        .query({ limit: 5, ...(cursor ? { cursor } : {}) });
      seen.push(...res.body.data.map((i) => i.id));
      cursor = res.body.meta.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(5); // 5+5+5+5+3
    expect(new Set(seen).size).toBe(23);
    const expected = [...created].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id).map((i) => i.id);
    expect(seen).toEqual(expected);
  });

  it("does not repeat or skip items when something changes between pages", async () => {
    const base = Date.now() - 1_000_000;
    const items = [];
    for (let n = 0; n < 12; n++) items.push(await makeItem({ teamId: f.teamA, createdById: f.leadA, updatedAt: new Date(base + n * 1000) }));
    const lead = as(f.leadA);

    const page1 = await lead.get("/items?limit=4");
    // Between pages, an item from the old end is edited, so it jumps to the top of the list.
    const oldest = items[0];
    await prisma.workItem.update({ where: { id: oldest.id }, data: { title: "Edited meanwhile" } });
    // ...and a brand new item appears.
    const fresh = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    const page2 = await lead.get(`/items?limit=4&cursor=${page1.body.meta.nextCursor}`);
    const page3 = await lead.get(`/items?limit=4&cursor=${page2.body.meta.nextCursor}`);

    const all = [...idsOf(page1), ...idsOf(page2), ...idsOf(page3)];
    expect(new Set(all).size).toBe(all.length); // no repeats
    expect(all).not.toContain(fresh.id); // new items appear at the top, not in later pages
    // Everything that was not touched is still seen once, in order.
    const untouched = items.filter((i) => i.id !== oldest.id).map((i) => i.id).reverse();
    expect(all.filter((id) => id !== oldest.id)).toEqual(untouched);
  });

  it("returns no cursor when everything fits on one page", async () => {
    await makeItem({ teamId: f.teamA, createdById: f.leadA });
    const res = await as(f.leadA).get("/items?limit=10");
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it("rejects a broken cursor and a limit that is too big", async () => {
    expect((await as(f.leadA).get("/items?cursor=garbage")).status).toBe(400);
    expect((await as(f.leadA).get("/items?limit=101")).status).toBe(400);
    expect((await as(f.leadA).get("/items?limit=0")).status).toBe(400);
  });

  it("paginates history too", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    for (let n = 0; n < 7; n++) await as(f.leadA).post(`/items/${item.id}/comments`).send({ body: `c${n}` });
    const page1 = await as(f.leadA).get(`/items/${item.id}/activity?limit=3`);
    const page2 = await as(f.leadA).get(`/items/${item.id}/activity?limit=3&cursor=${page1.body.meta.nextCursor}`);
    const page3 = await as(f.leadA).get(`/items/${item.id}/activity?limit=3&cursor=${page2.body.meta.nextCursor}`);
    const all = [...page1.body.data, ...page2.body.data, ...page3.body.data].map((e: { id: number }) => e.id);
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(7);
    expect(page3.body.meta.nextCursor).toBeNull();
  });
});

describe("dashboard views", () => {
  it("counts match what the list returns for the same view", async () => {
    const past = new Date(Date.now() - 86_400_000);
    await makeItem({ teamId: f.teamA, createdById: f.leadA, priority: "URGENT", status: "OPEN" }); // unassigned urgent
    await makeItem({ teamId: f.teamA, createdById: f.leadA, priority: "LOW", status: "OPEN", dueDate: past }); // overdue
    await makeItem({ teamId: f.teamA, createdById: f.leadA, status: "IN_PROGRESS", assigneeId: f.leadA, dueDate: past }); // mine + overdue
    await makeItem({ teamId: f.teamA, createdById: f.leadA, status: "CLOSED", assigneeId: f.leadA, dueDate: past }); // finished: nothing
    await makeItem({ teamId: f.teamA, createdById: f.leadA, type: "PAYMENT", status: "AWAITING_APPROVAL", assigneeId: f.memberA }); // needs approval
    await makeItem({ teamId: f.teamA, createdById: f.leadA, type: "PAYMENT", status: "AWAITING_APPROVAL", assigneeId: f.leadA }); // mine (counts as assigned), but not mine to approve

    const lead = as(f.leadA);
    const dash = (await lead.get("/dashboard")).body.data;
    expect(dash).toEqual({ assigned_to_me: 2, unassigned_urgent: 1, awaiting_my_approval: 1, overdue: 2 });
    for (const [view, count] of Object.entries(dash)) {
      const res = await lead.get(`/items?view=${view}&limit=100`);
      expect(res.body.data, view).toHaveLength(count as number);
    }
  });

  it("only Leads (and Admins) get items awaiting approval", async () => {
    await makeItem({ teamId: f.teamA, createdById: f.leadA, type: "PAYMENT", status: "AWAITING_APPROVAL", assigneeId: f.memberA });
    expect((await as(f.memberA).get("/dashboard")).body.data.awaiting_my_approval).toBe(0);
    expect((await as(f.member2A).get("/dashboard")).body.data.awaiting_my_approval).toBe(0);
    expect((await as(f.lead2A).get("/dashboard")).body.data.awaiting_my_approval).toBe(1);
    expect((await as(f.admin).get("/dashboard")).body.data.awaiting_my_approval).toBe(1);
    expect((await as(f.leadB).get("/dashboard")).body.data.awaiting_my_approval).toBe(0); // other team
  });
});

describe("input validation", () => {
  it("rejects bad input with a clear 400 and field details", async () => {
    const res = await as(f.memberA).post("/items").send({ teamId: f.teamA, title: "   ", type: "NOT_A_TYPE" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(["title", "type"]);
  });

  it("rejects an over-long title, a bad id, a bad date and broken JSON", async () => {
    const member = as(f.memberA);
    expect((await member.post("/items").send({ teamId: f.teamA, title: "x".repeat(201), type: "TASK" })).status).toBe(400);
    expect((await member.get("/items/abc")).status).toBe(400);
    expect((await member.post("/items").send({ teamId: f.teamA, title: "ok", type: "TASK", dueDate: "tomorrow" })).status).toBe(400);
    const broken = await member.post("/items").set("Content-Type", "application/json").send("{not json");
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe("BAD_JSON");
  });

  it("does not leak internal details on unexpected errors", async () => {
    const res = await as(f.memberA).get("/items/2147483648"); // bigger than the id column
    expect([400, 404, 500]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|SELECT|stack|at \w+ \(/i);
  });
});
