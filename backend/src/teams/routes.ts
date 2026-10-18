import { Router } from "express";
import { prisma } from "../db";
import { notFound } from "../errors";
import { sendData, userAndId } from "../http";
import { effectiveRole } from "../permissions/can";

export const teamsRouter = Router();

// People in a team (for the "assign to" list). Teams you don't belong to look like they don't exist.
teamsRouter.get("/teams/:id/members", async (req, res) => {
  const { user, id } = userAndId(req);
  if (effectiveRole(user, id) === null) throw notFound("Team not found");

  const memberships = await prisma.membership.findMany({
    where: { teamId: id },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  sendData(res, memberships.map((m) => ({ id: m.user.id, name: m.user.name, role: m.role })));
});
