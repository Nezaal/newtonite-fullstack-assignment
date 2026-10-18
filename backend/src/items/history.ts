import type { AuthUser } from "../auth/types";
import { prisma } from "../db";
import { forbidden } from "../errors";
import { runIdempotent, type IdempotentResult } from "../idempotency";
import { can } from "../permissions/can";
import { logActivity } from "./activity";
import { decodeCursor, encodeCursor } from "./cursor";
import { loadVisible } from "./loader";

interface PageInput {
  readonly cursor?: string;
  readonly limit: number;
}

// Newest first. "After the cursor" = older than (createdAt, id) of the last row of the previous page.
type OlderThan = { OR?: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: number } }> };

function olderThan(cursor: string | undefined): OlderThan {
  if (!cursor) return {};
  const { t, i } = decodeCursor(cursor);
  const time = new Date(t);
  return { OR: [{ createdAt: { lt: time } }, { createdAt: time, id: { lt: i } }] };
}

function pageOf<T extends { id: number; createdAt: Date }>(rows: T[], limit: number) {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { page, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

const userSelect = { select: { id: true, name: true } } as const;

export async function listActivity(user: AuthUser, itemId: number, input: PageInput) {
  await loadVisible(prisma, user, itemId); // 404 if the user cannot see the item

  const rows = await prisma.activityEvent.findMany({
    where: { itemId, ...olderThan(input.cursor) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    include: { user: userSelect },
  });
  const { page, nextCursor } = pageOf(rows, input.limit);

  // "assigned" events store user ids; turn them into names for display.
  const ids = page
    .filter((e) => e.action === "assigned")
    .flatMap((e) => [e.oldValue, e.newValue])
    .filter((v): v is string => v !== null)
    .map(Number)
    .filter(Number.isInteger);
  const people = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  const nameOf = new Map(people.map((p) => [String(p.id), p.name]));
  const label = (action: string, value: string | null) =>
    action === "assigned" && value !== null ? (nameOf.get(value) ?? `User ${value}`) : value;

  const events = page.map((e) => ({
    id: e.id,
    action: e.action,
    oldValue: label(e.action, e.oldValue),
    newValue: label(e.action, e.newValue),
    note: e.note,
    createdAt: e.createdAt,
    user: e.user,
  }));
  return { events, nextCursor };
}

export async function listComments(user: AuthUser, itemId: number, input: PageInput) {
  await loadVisible(prisma, user, itemId);
  const rows = await prisma.comment.findMany({
    where: { itemId, ...olderThan(input.cursor) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    include: { user: userSelect },
  });
  const { page, nextCursor } = pageOf(rows, input.limit);
  return { comments: page.map(toCommentDto), nextCursor };
}

function toCommentDto(c: { id: number; body: string; createdAt: Date; user: { id: number; name: string } }) {
  return { id: c.id, body: c.body, createdAt: c.createdAt, user: c.user };
}

export function addComment(user: AuthUser, itemId: number, body: string, key: string | undefined): Promise<IdempotentResult> {
  return runIdempotent(user.id, key, async (tx) => {
    const item = await loadVisible(tx, user, itemId);
    if (!can(user, "comment", item)) throw forbidden();
    const comment = await tx.comment.create({ data: { itemId, userId: user.id, body }, include: { user: userSelect } });
    await logActivity(tx, itemId, user.id, [{ action: "commented", newValue: body }]);
    return { status: 201, body: { success: true, data: toCommentDto(comment), error: null } };
  });
}
