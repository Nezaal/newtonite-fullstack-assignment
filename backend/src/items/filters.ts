import { Prisma } from "../../generated/prisma/client";
import type { AuthUser } from "../auth/types";
import type { ListQuery, View } from "./schemas";

const TRUE = Prisma.sql`TRUE`;
const FALSE = Prisma.sql`FALSE`;
const NOT_FINISHED = Prisma.sql`w.status NOT IN ('RESOLVED', 'CLOSED')`;

const teamIn = (ids: readonly number[]): Prisma.Sql =>
  ids.length === 0 ? FALSE : Prisma.sql`w.team_id IN (${Prisma.join(ids)})`;

// Only items from the user's teams. Admins see everything.
function scope(user: AuthUser): Prisma.Sql {
  return user.isAdmin ? TRUE : teamIn([...user.roles.keys()]);
}

function leadTeams(user: AuthUser): Prisma.Sql {
  if (user.isAdmin) return TRUE;
  return teamIn([...user.roles].filter(([, role]) => role === "LEAD").map(([teamId]) => teamId));
}

function viewFilter(user: AuthUser, view: View, now: Date): Prisma.Sql {
  switch (view) {
    case "assigned_to_me":
      return Prisma.sql`w.assignee_id = ${user.id} AND ${NOT_FINISHED}`;
    case "unassigned_urgent":
      return Prisma.sql`w.assignee_id IS NULL AND w.priority = 'URGENT' AND w.status = 'OPEN'`;
    case "awaiting_my_approval":
      return Prisma.sql`w.status = 'AWAITING_APPROVAL' AND w.assignee_id IS DISTINCT FROM ${user.id} AND ${leadTeams(user)}`;
    case "overdue":
      return Prisma.sql`w.due_date < ${now.toISOString()}::timestamp AND ${NOT_FINISHED}`;
  }
}

// "refund pay" -> "refund:* & pay:*", so typing part of a word still finds it.
// Only letters and digits are kept, so the text can never break the search syntax.
export function toTsQuery(text: string): string | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
  return words.length === 0 ? null : words.map((w) => `${w}:*`).join(" & ");
}

// One place that decides which items a user sees for a given filter set.
// The list and the dashboard counts both use it, so their numbers always agree.
// The search expression must match the GIN index created in the first migration.
export function buildWhere(user: AuthUser, filters: Partial<ListQuery>, now: Date): Prisma.Sql {
  const tsQuery = filters.q ? toTsQuery(filters.q) : null;
  const parts: Prisma.Sql[] = [
    scope(user),
    ...(filters.view ? [viewFilter(user, filters.view, now)] : []),
    ...(filters.teamId ? [Prisma.sql`w.team_id = ${filters.teamId}`] : []),
    ...(filters.status ? [Prisma.sql`w.status = ${filters.status}::"Status"`] : []),
    ...(filters.priority ? [Prisma.sql`w.priority = ${filters.priority}::"Priority"`] : []),
    ...(filters.type ? [Prisma.sql`w.type = ${filters.type}::"ItemType"`] : []),
    ...(filters.assignee === "me" ? [Prisma.sql`w.assignee_id = ${user.id}`] : []),
    ...(filters.assignee === "none" ? [Prisma.sql`w.assignee_id IS NULL`] : []),
    ...(typeof filters.assignee === "number" ? [Prisma.sql`w.assignee_id = ${filters.assignee}`] : []),
    ...(tsQuery
      ? [Prisma.sql`to_tsvector('english', w.title || ' ' || w.description) @@ to_tsquery('english', ${tsQuery})`]
      : []),
  ];
  return Prisma.join(parts.map((p) => Prisma.sql`(${p})`), " AND ");
}
