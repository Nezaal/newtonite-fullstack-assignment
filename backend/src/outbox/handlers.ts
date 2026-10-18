import { isUniqueViolation, prisma } from "../db";
import { notificationPayload, type NotificationKind, type NotificationPayload } from "./enqueue";

export interface JobRow {
  readonly id: number;
  readonly type: string;
  readonly payload: unknown;
  readonly attempts: number;
}

export type Handler = (job: JobRow) => Promise<void>;

function messageFor(kind: NotificationKind, p: NotificationPayload): string {
  switch (kind) {
    case "NOTIFY_ASSIGNED":
      return `${p.actorName} assigned you "${p.itemTitle}"`;
    case "NOTIFY_APPROVAL_NEEDED":
      return `"${p.itemTitle}" needs your approval`;
    case "NOTIFY_REJECTED":
      return `${p.actorName} sent back "${p.itemTitle}"${p.reason ? `: ${p.reason}` : ""}`;
  }
}

// Safe to run twice for the same job: notifications.job_id is UNIQUE, so the second insert
// is refused by the database and we treat that as "already done".
function notificationHandler(kind: NotificationKind): Handler {
  return async (job) => {
    const payload = notificationPayload.parse(job.payload);
    try {
      await prisma.notification.create({
        data: { userId: payload.userId, itemId: payload.itemId, jobId: job.id, message: messageFor(kind, payload) },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  };
}

export const defaultHandlers: Readonly<Record<string, Handler>> = {
  NOTIFY_ASSIGNED: notificationHandler("NOTIFY_ASSIGNED"),
  NOTIFY_APPROVAL_NEEDED: notificationHandler("NOTIFY_APPROVAL_NEEDED"),
  NOTIFY_REJECTED: notificationHandler("NOTIFY_REJECTED"),
};
