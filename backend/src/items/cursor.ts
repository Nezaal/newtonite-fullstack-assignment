import { badRequest } from "../errors";

// A cursor remembers where the previous page ended: (time, id).
// It is opaque to the client: base64 of a small JSON.
export interface Cursor {
  readonly t: string; // ISO timestamp
  readonly i: number; // id, to break ties between rows with the same timestamp
}

export function encodeCursor(time: Date, id: number): string {
  return Buffer.from(JSON.stringify({ t: time.toISOString(), i: id } satisfies Cursor)).toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const { t, i } = parsed as Partial<Cursor>;
    if (typeof t !== "string" || Number.isNaN(Date.parse(t)) || !Number.isInteger(i)) throw new Error("shape");
    return { t, i: i as number };
  } catch {
    throw badRequest("Invalid cursor", "INVALID_CURSOR");
  }
}
