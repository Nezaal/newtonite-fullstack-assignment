import type { RequestHandler } from "express";
import { prisma } from "../db";
import { unauthorized } from "../errors";
import { verifyToken } from "./jwt";
import type { AuthUser } from "./types";

export async function loadAuthUser(userId: number): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { memberships: true } });
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    roles: new Map(user.memberships.map((m) => [m.teamId, m.role])),
  };
}

// Checks the token, then loads the user's team roles fresh from the database on every request,
// so a removed user or a changed role takes effect immediately.
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized("Please log in");
  const user = await loadAuthUser(verifyToken(header.slice("Bearer ".length)));
  if (!user) throw unauthorized("This account no longer exists");
  req.user = user;
  next();
};
