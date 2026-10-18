import type { Request } from "express";
import type { Role } from "../../generated/prisma/enums";
import { unauthorized } from "../errors";

export interface AuthUser {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly isAdmin: boolean;
  // Role in each team the user belongs to (team id -> role)
  readonly roles: ReadonlyMap<number, Role>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
