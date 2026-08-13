import "server-only";

export type KeysetCursor = {
  timestamp: string;
  key: string;
};

type SerializedCursor = { v: 1; t: string; k: string };

export function encodeKeysetCursor(cursor: KeysetCursor) {
  if (!validTimestamp(cursor.timestamp) || !validKey(cursor.key)) throw new Error("Invalid keyset cursor.");
  return Buffer.from(JSON.stringify({ v: 1, t: cursor.timestamp, k: cursor.key } satisfies SerializedCursor), "utf8")
    .toString("base64url");
}

export function decodeKeysetCursor(value: string | undefined): KeysetCursor | null {
  if (!value || !/^[a-zA-Z0-9_-]{8,512}$/.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<SerializedCursor>;
    if (parsed.v !== 1 || !validTimestamp(parsed.t) || !validKey(parsed.k)) return null;
    return { timestamp: parsed.t, key: parsed.k };
  } catch {
    return null;
  }
}

export function isKeysetCursor(value: string) {
  return decodeKeysetCursor(value) !== null;
}

export function isAfterDescendingCursor(timestamp: string, key: string, cursor: KeysetCursor | null) {
  if (!cursor) return true;
  return timestamp < cursor.timestamp || (timestamp === cursor.timestamp && key < cursor.key);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
}
