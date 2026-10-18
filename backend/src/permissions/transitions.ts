import type { ItemType, Status } from "../../generated/prisma/enums";
import type { AuthUser } from "../auth/types";
import { badRequest, conflict, forbidden } from "../errors";
import { can, type ItemScope } from "./can";

export type TransitionKind = "normal" | "approve" | "reject";

export interface TransitionRule {
  readonly to: Status;
  readonly kind: TransitionKind;
}

export interface TransitionItem extends ItemScope {
  readonly type: ItemType;
  readonly status: Status;
}

export const needsApproval = (type: ItemType): boolean => type === "PAYMENT" || type === "COMPLIANCE";

// The allowed moves. Anything not listed here is rejected by the server.
// (In Progress -> Open is not here: it happens through "release".)
export function nextStatuses(type: ItemType, from: Status): readonly TransitionRule[] {
  switch (from) {
    case "OPEN":
      return [{ to: "IN_PROGRESS", kind: "normal" }];
    case "IN_PROGRESS":
      return needsApproval(type)
        ? [{ to: "AWAITING_APPROVAL", kind: "normal" }]
        : [{ to: "RESOLVED", kind: "normal" }];
    case "AWAITING_APPROVAL":
      return [
        { to: "RESOLVED", kind: "approve" },
        { to: "IN_PROGRESS", kind: "reject" },
      ];
    case "RESOLVED":
      return [
        { to: "IN_PROGRESS", kind: "normal" }, // reopen
        { to: "CLOSED", kind: "normal" },
      ];
    case "CLOSED":
      return [];
  }
}

// Throws the right error if this user cannot make this move now. Returns the rule if they can.
export function checkTransition(user: AuthUser, item: TransitionItem, to: Status, reason?: string): TransitionRule {
  const rule = nextStatuses(item.type, item.status).find((r) => r.to === to);
  if (!rule) {
    throw conflict("INVALID_TRANSITION", `A ${labelOf(item.status)} item cannot move to ${labelOf(to)}`);
  }

  if (rule.kind === "normal") {
    if (!can(user, "transition", item)) throw forbidden("Only the assignee or a Lead can change the status");
  } else if (!can(user, "approve", item)) {
    const own = item.assigneeId === user.id;
    throw forbidden(own ? "You cannot approve or reject your own item" : "Only a Lead can approve or reject");
  }

  if (rule.kind === "reject" && !reason?.trim()) {
    throw badRequest("A reason is required when rejecting", "REASON_REQUIRED");
  }
  if (item.status === "OPEN" && item.assigneeId === null) {
    throw conflict("ASSIGNEE_REQUIRED", "Assign someone (or claim the item) before starting work");
  }
  return rule;
}

export interface AvailableTransition {
  readonly to: Status;
  readonly kind: TransitionKind;
  readonly requiresReason: boolean;
  readonly blockedReason: string | null;
}

// For the UI: the moves this user could try on this item right now.
export function availableTransitions(user: AuthUser, item: TransitionItem): AvailableTransition[] {
  return nextStatuses(item.type, item.status).flatMap((rule) => {
    const permitted = rule.kind === "normal" ? can(user, "transition", item) : can(user, "approve", item);
    if (!permitted) return [];
    const needsOwner = item.status === "OPEN" && item.assigneeId === null;
    return [
      {
        to: rule.to,
        kind: rule.kind,
        requiresReason: rule.kind === "reject",
        blockedReason: needsOwner ? "Assign someone or claim it first" : null,
      },
    ];
  });
}

function labelOf(status: Status): string {
  return status
    .split("_")
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(" ");
}
