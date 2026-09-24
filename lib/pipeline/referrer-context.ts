type ReferrerContext = {
  referrerName?: string;
  phone?: string;
  email?: string;
};

export function referralReferrerName(referral: ReferrerContext) {
  const name = referral.referrerName?.trim();
  return name || null;
}

export function referralReferrerContact(referral: ReferrerContext) {
  return [referral.phone?.trim(), referral.email?.trim()].filter(Boolean).join(" · ") || null;
}
