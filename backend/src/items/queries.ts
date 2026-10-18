import { Prisma } from "../../generated/prisma/client";
import type { AuthUser } from "../auth/types";
import { prisma } from "../db";
import { decodeCursor, encodeCursor } from "./cursor";
import { buildWhere } from "./filters";
import { VIEWS, type ListQuery, type View } from "./schemas";

interface ListRow {
  id: number;
  title: string;
  type: string;
  priority: string;
  status: string;
  version: number;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  teamId: number;
  teamName: string;
  assigneeId: number | null;
  assigneeName: string | null;
}

export interface ItemSummary {
  id: number;
  title: string;
  type: string;
  priority: string;
  status: string;
  version: number;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  team: { id: number; name: string };
  assignee: { id: number; name: string } | null;
}

function toSummary(row: ListRow): ItemSummary {
  const { teamId, teamName, assigneeId, assigneeName, ...rest } = row;
  return {
    ...rest,
    team: { id: teamId, name: teamName },
    assignee: assigneeId === null ? null : { id: assigneeId, name: assigneeName ?? "" },
  };
}

// Newest-updated first. The cursor is "everything after (updated_at, id) of the last row seen",
// so pages stay correct even when items change while the user is paging.
// Uses the (team_id, updated_at, id) index; no OFFSET, so page 100 costs the same as page 1.
export async function listItems(
  user: AuthUser,
  query: ListQuery,
  now = new Date(),
): Promise<{ items: ItemSummary[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const after = cursor
    ? Prisma.sql`AND (w.updated_at, w.id) < (${cursor.t}::timestamp, ${cursor.i}::int)`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<ListRow[]>`
    SELECT w.id, w.title, w.type, w.priority, w.status, w.version,
           w.due_date AS "dueDate", w.created_at AS "createdAt", w.updated_at AS "updatedAt",
           w.team_id AS "teamId", t.name AS "teamName",
           w.assignee_id AS "assigneeId", u.name AS "assigneeName"
    FROM work_items w
    JOIN teams t ON t.id = w.team_id
    LEFT JOIN users u ON u.id = w.assignee_id
    WHERE ${buildWhere(user, query, now)} ${after}
    ORDER BY w.updated_at DESC, w.id DESC
    LIMIT ${query.limit + 1}`;

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > query.limit && last ? encodeCursor(last.updatedAt, last.id) : null;
  return { items: page.map(toSummary), nextCursor };
}

export async function dashboardCounts(user: AuthUser, now = new Date()): Promise<Record<View, number>> {
  const counts = await Promise.all(
    VIEWS.map(async (view) => {
      const [row] = await prisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM work_items w WHERE ${buildWhere(user, { view }, now)}`;
      return [view, row?.count ?? 0] as const;
    }),
  );
  return Object.fromEntries(counts) as Record<View, number>;
}
