import type { AuthUser } from "../auth/types";
import type { Role } from "../../generated/prisma/enums";

export type Action =
  | "view"
  | "comment"
  | "create"
  | "claim"
  | "release"
  | "edit"
  | "transition"
  | "assign"
  | "approve"
  | "moveTeam";

// The only facts about an item that permissions depend on.
export interface ItemScope {
  readonly teamId: number;
  readonly assigneeId: number | null;
}

const RANK: Readonly<Record<Role, number>> = { VIEWER: 0, MEMBER: 1, LEAD: 2 };

// The user's role in a team. An Admin counts as Lead in every team. null = no access to the team.
export function effectiveRole(user: AuthUser, teamId: number): Role | null {
  if (user.isAdmin) return "LEAD";
  return user.roles.get(teamId) ?? null;
}

// THE permission check. Every endpoint calls this, so the rules live in exactly one place.
// "own" means the item is assigned to the user. The role powers are summarised in the README; tests/permissions.test.ts holds the full matrix.
export function can(user: AuthUser, action: Action, item: ItemScope): boolean {
  const role = effectiveRole(user, item.teamId);
  if (role === null) return false;

  const atLeast = (minimum: Role) => RANK[role] >= RANK[minimum];
  const isOwn = item.assigneeId === user.id;

  switch (action) {
    case "view":
    case "comment":
      return true;
    case "create":
    case "claim":
      return atLeast("MEMBER");
    case "release":
    case "edit":
    case "transition":
      return atLeast("LEAD") || (atLeast("MEMBER") && isOwn);
    case "assign":
    case "moveTeam":
      return atLeast("LEAD");
    case "approve":
      // Nobody approves their own item, not even an Admin.
      return atLeast("LEAD") && !isOwn;
  }
}
