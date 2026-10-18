import { describe, expect, it } from "vitest";
import type { Role } from "../generated/prisma/enums";
import type { AuthUser } from "../src/auth/types";
import { can, effectiveRole, type Action } from "../src/permissions/can";
import { availableTransitions, checkTransition, nextStatuses } from "../src/permissions/transitions";

const TEAM = 1;
const OTHER_TEAM = 2;

const user = (id: number, roles: [number, Role][], isAdmin = false): AuthUser => ({
  id,
  name: `User ${id}`,
  email: `u${id}@test.com`,
  isAdmin,
  roles: new Map(roles),
});

const viewer = user(1, [[TEAM, "VIEWER"]]);
const member = user(2, [[TEAM, "MEMBER"]]);
const lead = user(3, [[TEAM, "LEAD"]]);
const admin = user(4, [], true);
const outsider = user(5, [[OTHER_TEAM, "LEAD"]]);

const someoneElsesItem = { teamId: TEAM, assigneeId: 99 };
const ownItem = (u: AuthUser) => ({ teamId: TEAM, assigneeId: u.id });

describe("can(): the permission matrix", () => {
  // [action, viewer, member, lead, admin] on an item assigned to somebody else
  const matrix: [Action, boolean, boolean, boolean, boolean][] = [
    ["view", true, true, true, true],
    ["comment", true, true, true, true],
    ["create", false, true, true, true],
    ["claim", false, true, true, true],
    ["release", false, false, true, true],
    ["edit", false, false, true, true],
    ["transition", false, false, true, true],
    ["assign", false, false, true, true],
    ["approve", false, false, true, true],
    ["moveTeam", false, false, true, true],
  ];

  it.each(matrix)("%s on someone else's item", (action, v, m, l, a) => {
    expect(can(viewer, action, someoneElsesItem)).toBe(v);
    expect(can(member, action, someoneElsesItem)).toBe(m);
    expect(can(lead, action, someoneElsesItem)).toBe(l);
    expect(can(admin, action, someoneElsesItem)).toBe(a);
  });

  it("gives a Member the 'own item' powers, but only on their own items", () => {
    for (const action of ["release", "edit", "transition"] as const) {
      expect(can(member, action, ownItem(member))).toBe(true);
    }
    expect(can(member, "assign", ownItem(member))).toBe(false);
    expect(can(member, "moveTeam", ownItem(member))).toBe(false);
    expect(can(member, "approve", ownItem(member))).toBe(false);
  });

  it("never lets anyone approve their own item, not even a Lead or Admin", () => {
    expect(can(lead, "approve", ownItem(lead))).toBe(false);
    expect(can(admin, "approve", ownItem(admin))).toBe(false);
  });

  it("gives a Viewer nothing even on an item assigned to them", () => {
    expect(can(viewer, "edit", ownItem(viewer))).toBe(false);
    expect(can(viewer, "transition", ownItem(viewer))).toBe(false);
  });

  it("denies everything to someone with no role in the team", () => {
    const actions: Action[] = ["view", "comment", "create", "claim", "release", "edit", "transition", "assign", "approve", "moveTeam"];
    for (const action of actions) expect(can(outsider, action, someoneElsesItem)).toBe(false);
  });

  it("uses the role in the item's own team (Lead elsewhere does not help)", () => {
    expect(effectiveRole(outsider, TEAM)).toBeNull();
    expect(effectiveRole(outsider, OTHER_TEAM)).toBe("LEAD");
  });
});

describe("workflow rules", () => {
  const item = (over: Partial<Parameters<typeof checkTransition>[1]>) => ({
    teamId: TEAM, assigneeId: member.id, type: "TASK" as const, status: "OPEN" as const, ...over,
  });

  it("lists exactly the allowed moves", () => {
    expect(nextStatuses("TASK", "OPEN").map((r) => r.to)).toEqual(["IN_PROGRESS"]);
    expect(nextStatuses("TASK", "IN_PROGRESS").map((r) => r.to)).toEqual(["RESOLVED"]);
    expect(nextStatuses("PAYMENT", "IN_PROGRESS").map((r) => r.to)).toEqual(["AWAITING_APPROVAL"]);
    expect(nextStatuses("COMPLIANCE", "IN_PROGRESS").map((r) => r.to)).toEqual(["AWAITING_APPROVAL"]);
    expect(nextStatuses("INCIDENT", "AWAITING_APPROVAL").map((r) => r.to).sort()).toEqual(["IN_PROGRESS", "RESOLVED"]);
    expect(nextStatuses("TASK", "RESOLVED").map((r) => r.to).sort()).toEqual(["CLOSED", "IN_PROGRESS"]);
    expect(nextStatuses("TASK", "CLOSED")).toEqual([]);
  });

  it("rejects moves that are not on the list", () => {
    expect(() => checkTransition(lead, item({ status: "OPEN" }), "CLOSED")).toThrow(/cannot move/);
    expect(() => checkTransition(lead, item({ status: "OPEN" }), "RESOLVED")).toThrow(/cannot move/);
    expect(() => checkTransition(lead, item({ status: "CLOSED" }), "IN_PROGRESS")).toThrow(/cannot move/);
    expect(() => checkTransition(lead, item({ type: "TASK", status: "IN_PROGRESS" }), "AWAITING_APPROVAL")).toThrow();
    expect(() => checkTransition(lead, item({ type: "PAYMENT", status: "IN_PROGRESS" }), "RESOLVED")).toThrow();
  });

  it("needs an owner before work starts", () => {
    expect(() => checkTransition(lead, item({ assigneeId: null }), "IN_PROGRESS")).toThrow(/Assign someone/);
  });

  it("requires a reason to reject, but not to approve", () => {
    const awaiting = item({ type: "PAYMENT", status: "AWAITING_APPROVAL" });
    expect(() => checkTransition(lead, awaiting, "IN_PROGRESS")).toThrow(/reason is required/);
    expect(() => checkTransition(lead, awaiting, "IN_PROGRESS", "   ")).toThrow(/reason is required/);
    expect(checkTransition(lead, awaiting, "IN_PROGRESS", "Missing receipt").kind).toBe("reject");
    expect(checkTransition(lead, awaiting, "RESOLVED").kind).toBe("approve");
  });

  it("only a Lead (not the assignee) can approve", () => {
    const awaiting = item({ type: "PAYMENT", status: "AWAITING_APPROVAL" });
    const otherMember = user(6, [[TEAM, "MEMBER"]]);
    expect(() => checkTransition(otherMember, awaiting, "RESOLVED")).toThrow(/Only a Lead/);
    expect(() => checkTransition(member, awaiting, "RESOLVED")).toThrow(/your own item/); // member is the assignee
    const leadsOwn = item({ type: "PAYMENT", status: "AWAITING_APPROVAL", assigneeId: lead.id });
    expect(() => checkTransition(lead, leadsOwn, "RESOLVED")).toThrow(/your own item/);
    expect(checkTransition(admin, awaiting, "RESOLVED").to).toBe("RESOLVED");
  });

  it("offers the UI only moves the user may try", () => {
    const awaiting = item({ type: "PAYMENT", status: "AWAITING_APPROVAL" });
    expect(availableTransitions(member, awaiting)).toEqual([]);
    expect(availableTransitions(lead, awaiting).map((t) => t.to).sort()).toEqual(["IN_PROGRESS", "RESOLVED"]);
    expect(availableTransitions(viewer, item({ status: "OPEN" }))).toEqual([]);
  });
});
