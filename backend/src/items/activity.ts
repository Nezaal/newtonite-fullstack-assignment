import type { Db } from "../db";

export interface ActivityInput {
  readonly action: string;
  readonly oldValue?: string | null;
  readonly newValue?: string | null;
  readonly note?: string | null;
}

const MAX_VALUE_LENGTH = 500;
const clip = (value: string | null | undefined): string | null =>
  value == null ? null : value.slice(0, MAX_VALUE_LENGTH);

// Writes history rows using the SAME transaction as the item change.
// If the change rolls back, the history rolls back with it, so they can never disagree.
export async function logActivity(tx: Db, itemId: number, userId: number, events: readonly ActivityInput[]): Promise<void> {
  if (events.length === 0) return;
  await tx.activityEvent.createMany({
    data: events.map((e) => ({
      itemId,
      userId,
      action: e.action,
      oldValue: clip(e.oldValue),
      newValue: clip(e.newValue),
      note: clip(e.note),
    })),
  });
}
