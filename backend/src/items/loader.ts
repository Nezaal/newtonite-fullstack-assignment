import type { Db } from "../db";
import type { AuthUser } from "../auth/types";
import { HttpError, notFound } from "../errors";
import { can } from "../permissions/can";
import { itemInclude, toItemDto, type ItemDto, type ItemWithRelations } from "./dto";

// Loads an item the user is allowed to see. Missing item and "not your team" look identical (404),
// so a stranger cannot find out which items exist.
export async function loadVisible(db: Db, user: AuthUser, id: number): Promise<ItemWithRelations> {
  const item = await db.workItem.findUnique({ where: { id }, include: itemInclude });
  if (!item || !can(user, "view", item)) throw notFound("Item not found");
  return item;
}

export async function loadDto(db: Db, user: AuthUser, id: number): Promise<ItemDto> {
  return toItemDto(await loadVisible(db, user, id), user);
}

const STALE_MESSAGE = "Someone else changed this item. Review the latest version and try again.";

// 409 that carries the latest item, so the client can show it. No automatic merging.
export function staleError(item: ItemWithRelations, user: AuthUser): HttpError {
  return new HttpError(409, "VERSION_CONFLICT", STALE_MESSAGE, { current: toItemDto(item, user) });
}

// Early check: the client edited an old copy.
export function assertVersion(item: ItemWithRelations, user: AuthUser, expected: number): void {
  if (item.version !== expected) throw staleError(item, user);
}

// Late check: the database update matched 0 rows, so someone changed the item after we read it.
export async function failStale(db: Db, user: AuthUser, id: number): Promise<never> {
  throw staleError(await loadVisible(db, user, id), user);
}
