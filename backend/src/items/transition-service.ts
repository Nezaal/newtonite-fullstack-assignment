import type { z } from "zod";
import type { AuthUser } from "../auth/types";
import { prisma, type Db } from "../db";
import { enqueueNotifications } from "../outbox/enqueue";
import { checkTransition, type TransitionRule } from "../permissions/transitions";
import { logActivity } from "./activity";
import type { ItemDto, ItemWithRelations } from "./dto";
import { assertVersion, failStale, loadDto, loadVisible } from "./loader";
import type { transitionBody } from "./schemas";

export function transitionItem(user: AuthUser, id: number, input: z.infer<typeof transitionBody>): Promise<ItemDto> {
  return prisma.$transaction(async (tx) => {
    const item = await loadVisible(tx, user, id);
    assertVersion(item, user, input.version);
    const rule = checkTransition(user, item, input.to, input.reason);

    // Matches only if nobody changed the item since we read it.
    const updated = await tx.workItem.updateMany({
      where: { id, version: item.version, status: item.status },
      data: { status: input.to, version: { increment: 1 } },
    });
    if (updated.count === 0) return failStale(tx, user, id);

    await logActivity(tx, id, user.id, [
      { action: "status_changed", oldValue: item.status, newValue: input.to, note: input.reason || null },
    ]);
    await queueNotifications(tx, user, item, rule, input.reason);
    return loadDto(tx, user, id);
  });
}

// Jobs are saved in the same transaction; the worker turns them into notifications later.
async function queueNotifications(
  tx: Db,
  user: AuthUser,
  item: ItemWithRelations,
  rule: TransitionRule,
  reason: string | undefined,
): Promise<void> {
  const base = { itemId: item.id, itemTitle: item.title, actorName: user.name };

  if (rule.to === "AWAITING_APPROVAL") {
    const leads = await tx.membership.findMany({ where: { teamId: item.teamId, role: "LEAD" } });
    const approvers = leads.map((m) => m.userId).filter((id) => id !== item.assigneeId && id !== user.id);
    await enqueueNotifications(tx, "NOTIFY_APPROVAL_NEEDED", approvers, base);
  }
  if (rule.kind === "reject" && item.assigneeId !== null && item.assigneeId !== user.id) {
    await enqueueNotifications(tx, "NOTIFY_REJECTED", [item.assigneeId], { ...base, reason });
  }
}
