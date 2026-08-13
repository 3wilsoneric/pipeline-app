import type { Referral, ReferralSection, ReferralSectionVersions } from "@/lib/pipeline/referral-types";

export type ReferralPresenceView = {
  lease_id: string;
  actor_id: string;
  actor_name: string;
  section: ReferralSection;
  expires_at: string;
  is_me: boolean;
};

export type ReferralChangeSnapshot = {
  changed: boolean;
  sequence: number;
  section_versions: ReferralSectionVersions;
  updated_at: string | null;
  updated_by: Referral["updatedBy"] | null;
  presence: ReferralPresenceView[];
};
