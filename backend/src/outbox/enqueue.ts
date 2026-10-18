import { z } from "zod";
import type { Db } from "../db";

export const NOTIFICATION_KINDS = ["NOTIFY_ASSIGNED", "NOTIFY_APPROVAL_NEEDED", "NOTIFY_REJECTED"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notificationPayload = z.object({
  userId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  itemTitle: z.string(),
  actorName: z.string(),
  reason: z.string().optional(),
});
export type NotificationPayload = z.infer<typeof notificationPayload>;

// Saves a job in the SAME transaction as the change that caused it.
// If the change rolls back, the job disappears too. If it commits, the job is guaranteed to exist.
// One job = one recipient = one notification.
export async function enqueueNotifications(
  tx: Db,
  kind: NotificationKind,
  recipients: readonly number[],
  payload: Omit<NotificationPayload, "userId">,
): Promise<void> {
  if (recipients.length === 0) return;
  await tx.outboxJob.createMany({
    data: recipients.map((userId) => ({ type: kind, payload: { ...payload, userId } })),
  });
}
