import "server-only";

import type { ReferralSort } from "@/lib/pipeline/referral-sort";
import { isReferralSort } from "@/lib/pipeline/referral-sort";

export type ReferralSortCursor = {
  sort: ReferralSort;
  value: string;
  key: string;
};

type SerializedReferralSortCursor = {
  v: 1;
  s: ReferralSort;
  x: string;
  k: string;
};

export function encodeReferralSortCursor(cursor: ReferralSortCursor) {
  if (!isReferralSort(cursor.sort) || !validValue(cursor.value) || !validKey(cursor.key)) {
    throw new Error("Invalid referral sort cursor.");
  }
  return Buffer.from(JSON.stringify({
    v: 1,
    s: cursor.sort,
    x: cursor.value,
    k: cursor.key,
  } satisfies SerializedReferralSortCursor), "utf8").toString("base64url");
}

export function decodeReferralSortCursor(
  value: string | undefined,
  expectedSort: ReferralSort,
): ReferralSortCursor | null {
  if (!value || !/^[a-zA-Z0-9_-]{8,1024}$/.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<SerializedReferralSortCursor>;
    if (
      parsed.v !== 1
      || !parsed.s
      || !isReferralSort(parsed.s)
      || parsed.s !== expectedSort
      || !validValue(parsed.x)
      || !validKey(parsed.k)
    ) return null;
    return { sort: parsed.s, value: parsed.x, key: parsed.k };
  } catch {
    return null;
  }
}

export function isReferralSortCursor(value: string, expectedSort: ReferralSort) {
  return decodeReferralSortCursor(value, expectedSort) !== null;
}

function validValue(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,20}$/.test(value);
}
