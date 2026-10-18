import type { Prisma } from "../../generated/prisma/client";
import type { AuthUser } from "../auth/types";
import { can } from "../permissions/can";
import { availableTransitions } from "../permissions/transitions";

export const itemInclude = {
  team: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.WorkItemInclude;

export type ItemWithRelations = Prisma.WorkItemGetPayload<{ include: typeof itemInclude }>;

// What the item detail endpoint sends: the item plus what *this user* may do with it.
// The buttons in the UI follow `actions`, but the server re-checks every request anyway.
export function toItemDto(item: ItemWithRelations, user: AuthUser) {
  const assigned = item.assigneeId !== null;
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    type: item.type,
    priority: item.priority,
    status: item.status,
    version: item.version,
    dueDate: item.dueDate,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    team: item.team,
    assignee: item.assignee,
    createdBy: item.createdBy,
    actions: {
      edit: can(user, "edit", item) && item.status !== "CLOSED",
      claim: can(user, "claim", item) && !assigned && item.status === "OPEN",
      release: can(user, "release", item) && assigned && (item.status === "OPEN" || item.status === "IN_PROGRESS"),
      assign: can(user, "assign", item) && ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL"].includes(item.status),
      moveTeam: can(user, "moveTeam", item) && (item.status === "OPEN" || item.status === "IN_PROGRESS"),
      comment: can(user, "comment", item),
    },
    transitions: availableTransitions(user, item),
  };
}

export type ItemDto = ReturnType<typeof toItemDto>;
