export const referralSorts = [
  "updated_desc",
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
