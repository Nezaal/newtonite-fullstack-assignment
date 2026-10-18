import type { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import type { AuthUser } from "../auth/types";
import { prisma, type Db } from "../db";
import { conflict, forbidden, notFound } from "../errors";
import { can, effectiveRole } from "../permissions/can";
import { logActivity, type ActivityInput } from "./activity";
import { toItemDto, type ItemDto, type ItemWithRelations } from "./dto";
import { assertVersion, failStale, loadDto, loadVisible } from "./loader";
import type { patchItemBody } from "./schemas";

type PatchInput = z.infer<typeof patchItemBody>;

interface Change {
  readonly data: Prisma.WorkItemUncheckedUpdateManyInput;
  readonly events: readonly ActivityInput[];
}

const NO_CHANGE: Change = { data: {}, events: [] };

function mergeChanges(pieces: readonly Change[]): Change {
  return {
    data: Object.assign({}, ...pieces.map((p) => p.data)),
    events: pieces.flatMap((p) => p.events),
  };
}

// Plain field edits. Only fields that really changed produce a change and a history row.
function planFieldChanges(item: ItemWithRelations, input: PatchInput): Change {
  const nextDue = input.dueDate === undefined ? undefined : input.dueDate === null ? null : new Date(input.dueDate);
  const dueChanged = nextDue !== undefined && (nextDue?.getTime() ?? null) !== (item.dueDate?.getTime() ?? null);

  const pieces: (Change | false)[] = [
    input.title !== undefined &&
      input.title !== item.title && {
        data: { title: input.title },
        events: [{ action: "title_changed", oldValue: item.title, newValue: input.title }],
      },
    input.description !== undefined &&
      input.description !== item.description && {
        data: { description: input.description },
        events: [{ action: "description_changed", oldValue: item.description, newValue: input.description }],
      },
    input.priority !== undefined &&
      input.priority !== item.priority && {
        data: { priority: input.priority },
        events: [{ action: "priority_changed", oldValue: item.priority, newValue: input.priority }],
      },
    dueChanged && {
      data: { dueDate: nextDue },
      events: [
        { action: "due_date_changed", oldValue: item.dueDate?.toISOString() ?? null, newValue: nextDue?.toISOString() ?? null },
      ],
    },
  ];
  return mergeChanges(pieces.filter((p): p is Change => p !== false));
}

// Moving to another team is a Lead action. The old assignee may not belong to the new team,
// so the item goes back to Open with no owner.
async function planTeamMove(tx: Db, user: AuthUser, item: ItemWithRelations, destTeamId: number): Promise<Change> {
  if (!can(user, "moveTeam", item)) throw forbidden("Only a Lead can move items to another team");
  if (item.status !== "OPEN" && item.status !== "IN_PROGRESS") {
    throw conflict("INVALID_STATE", "Only Open or In Progress items can be moved to another team", {
      current: toItemDto(item, user),
    });
  }
  const dest = await tx.team.findUnique({ where: { id: destTeamId } });
  if (!dest || effectiveRole(user, destTeamId) === null) throw notFound("Team not found");
  if (!can(user, "create", { teamId: destTeamId, assigneeId: null })) {
    throw forbidden("You can only move items into a team where you are a Member or Lead");
  }

  const events: ActivityInput[] = [{ action: "team_changed", oldValue: item.team.name, newValue: dest.name }];
  if (item.assigneeId !== null) events.push({ action: "assigned", oldValue: String(item.assigneeId), newValue: null });
  if (item.status !== "OPEN") events.push({ action: "status_changed", oldValue: item.status, newValue: "OPEN" });
  return { data: { teamId: destTeamId, assigneeId: null, status: "OPEN" }, events };
}

export function patchItem(user: AuthUser, id: number, input: PatchInput): Promise<ItemDto> {
  return prisma.$transaction(async (tx) => {
    const item = await loadVisible(tx, user, id);
    assertVersion(item, user, input.version);
    if (!can(user, "edit", item)) throw forbidden("Only the assignee or a Lead can edit this item");
    if (item.status === "CLOSED") {
      throw conflict("ITEM_CLOSED", "Closed items cannot be changed", { current: toItemDto(item, user) });
    }

    const fields = planFieldChanges(item, input);
    const move =
      input.teamId !== undefined && input.teamId !== item.teamId
        ? await planTeamMove(tx, user, item, input.teamId)
        : NO_CHANGE;
    const events = [...fields.events, ...move.events];
    if (events.length === 0) return toItemDto(item, user); // nothing really changed

    const updated = await tx.workItem.updateMany({
      where: { id, version: item.version },
      data: { ...fields.data, ...move.data, version: { increment: 1 } },
    });
    if (updated.count === 0) return failStale(tx, user, id);

    await logActivity(tx, id, user.id, events);
    return loadDto(tx, user, id);
  });
}
