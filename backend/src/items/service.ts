import type { z } from "zod";
import type { Role } from "../../generated/prisma/enums";
import type { AuthUser } from "../auth/types";
import { prisma, type Db } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { runIdempotent, type IdempotentResult } from "../idempotency";
import { enqueueNotifications } from "../outbox/enqueue";
import { can, effectiveRole } from "../permissions/can";
import { logActivity } from "./activity";
import { itemInclude, toItemDto, type ItemDto } from "./dto";
import { assertVersion, failStale, loadDto, loadVisible } from "./loader";
import type { assignBody, createItemBody } from "./schemas";

export function createItem(
  user: AuthUser,
  input: z.infer<typeof createItemBody>,
  key: string | undefined,
): Promise<IdempotentResult> {
  return runIdempotent(user.id, key, async (tx) => {
    // No role in the team at all: act as if the team does not exist.
    if (effectiveRole(user, input.teamId) === null) throw notFound("Team not found");
    if (!can(user, "create", { teamId: input.teamId, assigneeId: null })) {
      throw forbidden("Viewers cannot create items");
    }
    const item = await tx.workItem.create({
      data: {
        teamId: input.teamId,
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        createdById: user.id,
      },
      include: itemInclude,
    });
    await logActivity(tx, item.id, user.id, [{ action: "created", newValue: "OPEN" }]);
    return { status: 201, body: { success: true, data: toItemDto(item, user), error: null } };
  });
}

// Two people claiming at once: the UPDATE only matches while nobody owns the item,
// and the database lets one of them through. The other matches 0 rows and gets a 409.
export function claimItem(user: AuthUser, id: number): Promise<ItemDto> {
  return prisma.$transaction(async (tx) => {
    const item = await loadVisible(tx, user, id);
    if (!can(user, "claim", item)) throw forbidden("Viewers cannot claim items");

    const claimed = await tx.workItem.updateMany({
      where: { id, assigneeId: null, status: "OPEN" },
      data: { assigneeId: user.id, version: { increment: 1 } },
    });
    if (claimed.count === 0) {
      const latest = await loadVisible(tx, user, id);
      const current = toItemDto(latest, user);
      if (latest.assignee) throw conflict("ALREADY_CLAIMED", `Already claimed by ${latest.assignee.name}`, { current });
      throw conflict("INVALID_STATE", "This item cannot be claimed in its current status", { current });
    }
    await logActivity(tx, id, user.id, [{ action: "assigned", newValue: String(user.id) }]);
    return loadDto(tx, user, id);
  });
}

// Gives up the owner. An In Progress item goes back to Open.
export function releaseItem(user: AuthUser, id: number): Promise<ItemDto> {
  return prisma.$transaction(async (tx) => {
    const item = await loadVisible(tx, user, id);
    if (!can(user, "release", item)) throw forbidden("Only the assignee or a Lead can release this item");
    if (item.assigneeId === null || (item.status !== "OPEN" && item.status !== "IN_PROGRESS")) {
      throw conflict("INVALID_STATE", "This item cannot be released right now", { current: toItemDto(item, user) });
    }
    const nextStatus = item.status === "IN_PROGRESS" ? "OPEN" : item.status;

    // Only matches if the owner and status are still what we just read.
    const released = await tx.workItem.updateMany({
      where: { id, assigneeId: item.assigneeId, status: item.status },
      data: { assigneeId: null, status: nextStatus, version: { increment: 1 } },
    });
    if (released.count === 0) return failStale(tx, user, id);

    await logActivity(tx, id, user.id, [
      { action: "assigned", oldValue: String(item.assigneeId), newValue: null },
      ...(nextStatus !== item.status ? [{ action: "status_changed", oldValue: item.status, newValue: nextStatus }] : []),
    ]);
    return loadDto(tx, user, id);
  });
}

// Someone can own an item only if they work in its team (Member or Lead) or are an Admin.
async function assertEligibleAssignee(tx: Db, teamId: number, assigneeId: number): Promise<void> {
  const target = await tx.user.findUnique({
    where: { id: assigneeId },
    include: { memberships: { where: { teamId } } },
  });
  const roles: Role[] = target?.memberships.map((m) => m.role) ?? [];
  const eligible = target !== null && (target.isAdmin || roles.some((r) => r !== "VIEWER"));
  if (!eligible) throw badRequest("That person is not a Member or Lead of this team", "ASSIGNEE_NOT_ELIGIBLE");
}

export function assignItem(user: AuthUser, id: number, input: z.infer<typeof assignBody>): Promise<ItemDto> {
  return prisma.$transaction(async (tx) => {
    const item = await loadVisible(tx, user, id);
    assertVersion(item, user, input.version);
    if (!can(user, "assign", item)) throw forbidden("Only a Lead can assign items");
    if (!["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL"].includes(item.status)) {
      throw conflict("INVALID_STATE", "Resolved or closed items cannot be reassigned", { current: toItemDto(item, user) });
    }
    if (item.assigneeId === input.assigneeId) return toItemDto(item, user); // nothing to do
    await assertEligibleAssignee(tx, item.teamId, input.assigneeId);

    const updated = await tx.workItem.updateMany({
      where: { id, version: item.version },
      data: { assigneeId: input.assigneeId, version: { increment: 1 } },
    });
    if (updated.count === 0) return failStale(tx, user, id);

    await logActivity(tx, id, user.id, [
      {
        action: "assigned",
        oldValue: item.assigneeId === null ? null : String(item.assigneeId),
        newValue: String(input.assigneeId),
      },
    ]);
    if (input.assigneeId !== user.id) {
      await enqueueNotifications(tx, "NOTIFY_ASSIGNED", [input.assigneeId], {
        itemId: id,
        itemTitle: item.title,
        actorName: user.name,
      });
    }
    return loadDto(tx, user, id);
  });
}
