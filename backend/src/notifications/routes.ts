import { Router } from "express";
import { prisma } from "../db";
import { currentUser } from "../auth/types";
import { notFound } from "../errors";
import { idParam, parseInput, sendData } from "../http";

export const notificationsRouter = Router();

const LIMIT = 50;

// Only ever the caller's own notifications.
notificationsRouter.get("/notifications", async (req, res) => {
  const user = currentUser(req);
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIMIT,
      include: { item: { select: { id: true, title: true } } },
    }),
    prisma.notification.count({ where: { userId: user.id, isRead: false } }),
  ]);
  sendData(
    res,
    rows.map((n) => ({ id: n.id, message: n.message, isRead: n.isRead, createdAt: n.createdAt, item: n.item })),
    { unreadCount: unread },
  );
});

notificationsRouter.post("/notifications/:id/read", async (req, res) => {
  const user = currentUser(req);
  const { id } = parseInput(idParam, req.params);
  // The userId in the filter means nobody can mark someone else's notification.
  const result = await prisma.notification.updateMany({ where: { id, userId: user.id }, data: { isRead: true } });
  if (result.count === 0) throw notFound("Notification not found");
  sendData(res, { id, isRead: true });
});
