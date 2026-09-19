import { normalizeCalendarDate } from "./calendar-date";

export const referralSorts = [
  "updated_desc",
  "received_desc",
  "created_desc",
  "created_asc",
  "owner_asc",
  "community_asc",
  "client_asc",
] as const;

export type ReferralSort = (typeof referralSorts)[number];

export function isReferralSort(value: string): value is ReferralSort {
  return referralSorts.includes(value as ReferralSort);
}

/** Prefer the recorded receipt date; older undated records use their creation day. */
export function referralReceivedDate(referral: { date?: string; createdAt: string }) {
  return normalizeCalendarDate(referral.date) ?? referral.createdAt.slice(0, 10);
}
