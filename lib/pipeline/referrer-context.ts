type ReferrerContext = {
  source?: string;
  referrerName?: string;
  phone?: string;
  email?: string;
};

export function referralReferrerName(referral: ReferrerContext) {
  const name = referral.referrerName?.trim();
  return name || referralSourceName(referral);
}

export function referralSourceName(referral: ReferrerContext) {
  const source = referral.source?.trim();
  return source && !/^(referral packet|face sheet upload|unknown)$/i.test(source) ? source : null;
}

export function referralReferrerContact(referral: ReferrerContext) {
  return [referral.phone?.trim(), referral.email?.trim()].filter(Boolean).join(" · ") || null;
}
