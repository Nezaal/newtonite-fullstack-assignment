import { beforeEach, describe, expect, it } from "vitest";
import type { Status } from "../generated/prisma/enums";
import { as, eventsOf, itemRow, makeItem, resetDb, seedFixture, type Fixture } from "./helpers";

let f: Fixture;

beforeEach(async () => {
  await resetDb();
  f = await seedFixture();
});

// Moves an item using its current version.
async function move(userId: number, itemId: number, to: Status, reason?: string) {
  const { version } = await itemRow(itemId);
  return as(userId).post(`/items/${itemId}/transition`).send({ version, to, ...(reason ? { reason } : {}) });
}

describe("status workflow", () => {
  it("rejects a jump from Open straight to Closed", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA });
    const res = await move(f.leadA, item.id, "CLOSED");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
    expect((await itemRow(item.id)).status).toBe("OPEN");
  });

  it("will not start work on an item nobody owns", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    const res = await move(f.leadA, item.id, "IN_PROGRESS");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ASSIGNEE_REQUIRED");
  });

  it("a normal item goes Open -> In Progress -> Resolved -> Closed without approval", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, type: "INCIDENT" });
    for (const to of ["IN_PROGRESS", "RESOLVED", "CLOSED"] as const) {
      expect((await move(f.memberA, item.id, to)).status).toBe(200);
    }
    expect((await itemRow(item.id)).status).toBe("CLOSED");
    expect((await eventsOf(item.id)).map((e) => e.newValue)).toEqual(["IN_PROGRESS", "RESOLVED", "CLOSED"]);
  });

  it.each(["PAYMENT", "COMPLIANCE"] as const)("%s items cannot skip approval", async (type) => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, type, status: "IN_PROGRESS" });
    const skip = await move(f.leadA, item.id, "RESOLVED");
    expect(skip.status).toBe(409);
    expect((await move(f.memberA, item.id, "AWAITING_APPROVAL")).status).toBe(200);
  });

  it("a normal item cannot go through the approval step", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, type: "TASK", status: "IN_PROGRESS" });
    expect((await move(f.memberA, item.id, "AWAITING_APPROVAL")).status).toBe(409);
  });

  it("Closed is final", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, status: "CLOSED" });
    for (const to of ["OPEN", "IN_PROGRESS", "RESOLVED"] as const) {
      expect((await move(f.admin, item.id, to)).status).toBe(409);
    }
    expect((await itemRow(item.id)).status).toBe("CLOSED");
  });

  it("Resolved can be reopened", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, status: "RESOLVED" });
    expect((await move(f.memberA, item.id, "IN_PROGRESS")).status).toBe(200);
  });

  it("a Member cannot move someone else's item, a Viewer cannot move anything", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA });
    expect((await move(f.member2A, item.id, "IN_PROGRESS")).status).toBe(403);
    expect((await move(f.viewerA, item.id, "IN_PROGRESS")).status).toBe(403);
    expect((await itemRow(item.id)).status).toBe("OPEN");
  });
});

describe("approval", () => {
  const awaiting = () =>
    makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, type: "PAYMENT", status: "AWAITING_APPROVAL" });

  it("a Lead who is not the assignee can approve", async () => {
    const item = await awaiting();
    expect((await move(f.leadA, item.id, "RESOLVED")).status).toBe(200);
    expect((await itemRow(item.id)).status).toBe("RESOLVED");
  });

  it("an Admin can approve", async () => {
    const item = await awaiting();
    expect((await move(f.admin, item.id, "RESOLVED")).status).toBe(200);
  });

  it("a Member cannot approve, not even their own item", async () => {
    const item = await awaiting();
    expect((await move(f.memberA, item.id, "RESOLVED")).status).toBe(403);
    expect((await move(f.member2A, item.id, "RESOLVED")).status).toBe(403);
    expect((await itemRow(item.id)).status).toBe("AWAITING_APPROVAL");
  });

  it("nobody approves their own item, even a Lead", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.leadA, type: "COMPLIANCE", status: "AWAITING_APPROVAL" });
    const res = await move(f.leadA, item.id, "RESOLVED");
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/your own/i);
    expect((await move(f.lead2A, item.id, "RESOLVED")).status).toBe(200); // another Lead can
  });

  it("an outsider Lead cannot approve (and does not even see the item)", async () => {
    const item = await awaiting();
    expect((await move(f.leadB, item.id, "RESOLVED")).status).toBe(404);
  });

  it("rejecting needs a reason, sends the item back to In Progress, and stores the reason", async () => {
    const item = await awaiting();
    const noReason = await move(f.leadA, item.id, "IN_PROGRESS");
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.code).toBe("REASON_REQUIRED");

    expect((await move(f.leadA, item.id, "IN_PROGRESS", "Receipt is missing")).status).toBe(200);
    expect((await itemRow(item.id)).status).toBe("IN_PROGRESS");
    const event = (await eventsOf(item.id)).find((e) => e.note);
    expect(event).toMatchObject({ oldValue: "AWAITING_APPROVAL", newValue: "IN_PROGRESS", note: "Receipt is missing" });
  });

  it("only the assignee-or-Lead rule applies to requesting approval", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, type: "PAYMENT", status: "IN_PROGRESS" });
    expect((await move(f.member2A, item.id, "AWAITING_APPROVAL")).status).toBe(403);
    expect((await move(f.memberA, item.id, "AWAITING_APPROVAL")).status).toBe(200);
  });
});

describe("assigning", () => {
  it("a Lead can assign a Member, with a history row", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    const res = await as(f.leadA).post(`/items/${item.id}/assign`).send({ version: 1, assigneeId: f.member2A });
    expect(res.status).toBe(200);
    expect(res.body.data.assignee.id).toBe(f.member2A);
    expect((await eventsOf(item.id))[0]).toMatchObject({ action: "assigned", newValue: String(f.member2A) });
  });

  it("a Member cannot assign (not even to themselves through assign)", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    const res = await as(f.memberA).post(`/items/${item.id}/assign`).send({ version: 1, assigneeId: f.memberA });
    expect(res.status).toBe(403);
  });

  it("cannot assign to a Viewer, to someone in another team, or to nobody real", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    for (const assigneeId of [f.viewerA, f.memberB, 999999]) {
      const res = await as(f.leadA).post(`/items/${item.id}/assign`).send({ version: 1, assigneeId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("ASSIGNEE_NOT_ELIGIBLE");
    }
    expect((await itemRow(item.id)).assigneeId).toBeNull();
  });

  it("cannot assign a resolved or closed item", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, status: "RESOLVED" });
    const res = await as(f.leadA).post(`/items/${item.id}/assign`).send({ version: 1, assigneeId: f.member2A });
    expect(res.status).toBe(409);
  });
});
