import bcrypt from "bcryptjs";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "../config";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { parseInput, sendData } from "../http";
import { signToken } from "./jwt";
import { currentUser } from "./types";

const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(200),
});

// Compared against when the email is unknown, so "no such user" takes as long as "wrong password".
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new HttpError(429, "TOO_MANY_ATTEMPTS", "Too many login attempts. Try again later.")),
});

export const loginRouter = Router();

loginRouter.post("/auth/login", loginLimiter, async (req, res) => {
  const { email, password } = parseInput(loginBody, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  // Same message for both cases, so the response doesn't reveal which emails exist.
  if (!user || !matches) throw new HttpError(401, "INVALID_CREDENTIALS", "Wrong email or password");
  sendData(res, {
    token: signToken(user.id),
    user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
  });
});

export const meRouter = Router();

meRouter.get("/me", async (req, res) => {
  const user = currentUser(req);
  // Admins can work in every team, so they see all teams.
  const teams = await prisma.team.findMany({
    where: user.isAdmin ? {} : { id: { in: [...user.roles.keys()] } },
    orderBy: { name: "asc" },
  });
  sendData(res, {
    user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
    teams: teams.map((t) => ({ id: t.id, name: t.name, role: user.isAdmin ? "LEAD" : user.roles.get(t.id) })),
  });
});
