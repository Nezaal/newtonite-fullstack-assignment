import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "../config";
import { unauthorized } from "../errors";

export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, config.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: config.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
}

// Returns the user id inside a valid token. Anything wrong (bad, expired, tampered) is a 401.
export function verifyToken(token: string): number {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
    const userId = typeof payload === "object" ? Number(payload.sub) : NaN;
    if (!Number.isInteger(userId)) throw new Error("bad subject");
    return userId;
  } catch {
    throw unauthorized("Your session is invalid or has expired. Please log in again.");
  }
}
