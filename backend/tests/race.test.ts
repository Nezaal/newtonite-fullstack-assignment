import { beforeEach, describe, expect, it, vi } from "vitest";

// A "gate" that holds requests at a chosen point until N of them have arrived, then lets them
// all go together. This forces a real race, so these tests prove the DATABASE guards work
// (not just the early checks that catch requests arriving one after the other).
const gate = vi.hoisted(() => ({
  parties: 0,
  arrived: 0,
  open: null as null | (() => void),
  passed: null as null | Promise<void>,
}));

async function waitAtGate(): Promise<void> {
  if (!gate.passed) return;
  gate.arrived += 1;
  if (gate.arrived >= gate.parties) gate.open?.();
  // Safety net so a broken test fails instead of hanging.
  await Promise.race([gate.passed, new Promise((resolve) => setTimeout(resolve, 5000))]);
}

function armGate(parties: number): void {
  gate.parties = parties;
  gate.arrived = 0;
  gate.passed = new Promise<void>((resolve) => (gate.open = resolve));
}

// Gate 1: right after an item is read (after the early checks would have run).
vi.mock("../src/items/loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/items/loader")>();
  return {
    ...actual,
    loadVisible: async (...args: Parameters<typeof actual.loadVisible>) => {
      const item = await actual.loadVisible(...args);
      await waitAtGate();
      return item;
    },
  };
});

import { prisma } from "../src/db";
import { as, eventsOf, itemRow, makeItem, resetDb, seedFixture, type Fixture } from "./helpers";

let f: Fixture;

beforeEach(async () => {
  gate.passed = null;
  await resetDb();
  f = await seedFixture();
});

describe("real races (both requests read the item before either writes)", () => {
  it("two claims: the database lets exactly one through", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA });
    armGate(2);

    const [a, b] = await Promise.all([
      as(f.memberA).post(`/items/${item.id}/claim`),
      as(f.member2A).post(`/items/${item.id}/claim`),
    ]);

    expect(gate.arrived).toBeGreaterThanOrEqual(2); // both really read before writing
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await itemRow(item.id)).version).toBe(2);
    expect((await eventsOf(item.id)).filter((e) => e.action === "assigned")).toHaveLength(1);
  });

  it("two edits with the same version: only one is saved", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA });
    armGate(2);

    const [a, b] = await Promise.all([
      as(f.leadA).patch(`/items/${item.id}`).send({ version: 1, title: "Edit one" }),
      as(f.lead2A).patch(`/items/${item.id}`).send({ version: 1, title: "Edit two" }),
    ]);

    expect(gate.arrived).toBeGreaterThanOrEqual(2);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe("VERSION_CONFLICT");
    expect(loser.body.error.current.version).toBe(2); // the loser is shown the winner's version
    expect((await itemRow(item.id)).version).toBe(2);
    expect((await eventsOf(item.id)).filter((e) => e.action === "title_changed")).toHaveLength(1);
  });

  it("approve and reject at the same moment: only one decision is recorded", async () => {
    const item = await makeItem({
      teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, status: "AWAITING_APPROVAL", type: "PAYMENT",
    });
    armGate(2);

    const [approve, reject] = await Promise.all([
      as(f.leadA).post(`/items/${item.id}/transition`).send({ version: 1, to: "RESOLVED" }),
      as(f.lead2A).post(`/items/${item.id}/transition`).send({ version: 1, to: "IN_PROGRESS", reason: "Missing receipt" }),
    ]);

    expect([approve.status, reject.status].sort()).toEqual([200, 409]);
    const row = await itemRow(item.id);
    expect(row.version).toBe(2);
    expect((await eventsOf(item.id)).filter((e) => e.action === "status_changed")).toHaveLength(1);
  });

  it("reassigning while the owner releases: the second one is told the item changed", async () => {
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, status: "IN_PROGRESS" });
    armGate(2);

    const [release, assign] = await Promise.all([
      as(f.memberA).post(`/items/${item.id}/release`),
      as(f.leadA).post(`/items/${item.id}/assign`).send({ version: 1, assigneeId: f.member2A }),
    ]);

    expect([release.status, assign.status].sort()).toEqual([200, 409]);
    expect((await itemRow(item.id)).version).toBe(2);
  });

  it("a failed transition leaves no history and no queued jobs behind", async () => {
    // Approval would queue jobs and write history; if the move is refused, none of it may remain.
    const item = await makeItem({ teamId: f.teamA, createdById: f.leadA, assigneeId: f.memberA, type: "PAYMENT", status: "IN_PROGRESS" });
    const refused = await as(f.memberA).post(`/items/${item.id}/transition`).send({ version: 1, to: "RESOLVED" });
    expect(refused.status).toBe(409); // Payments must go through approval
    expect(await eventsOf(item.id)).toHaveLength(0);
    expect(await prisma.outboxJob.count()).toBe(0);
  });
});
