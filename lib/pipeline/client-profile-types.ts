import type { Referral } from "@/lib/pipeline/referral-types";
import type { ReferralProgress } from "@/lib/pipeline/referral-progress";

export type ClientProfileIdentity = {
  full_name: string;
  preferred_name?: string;
  dob: string;
  gender: string;
  phone: string;
  email: string;
  county: string;
  payer: string;
};

export type ClientProfileReferralSummary = {
  referral_id: number;
  created_at: string;
  community: string;
  stage: Referral["stage"];
  outcome: "active" | "accepted" | "declined";
  owner: string;
};

export type ClientProfileDocument = {
  id: string;
  name: string;
  category: "Initial packet" | "Assessment" | "Follow-up";
  status: "missing" | "uploaded" | "reviewed" | "expired";
  uploaded_at?: string;
  size_label?: string;
  next_step?: string;
};

export type ClientProfileActivity = {
  id: string;
  label: string;
  detail: string;
  occurred_at: string;
};

export type ClientProfile = {
  client_id: string;
  synthetic: boolean;
  identity: ClientProfileIdentity;
  current_referral: Referral;
  referral_history: ClientProfileReferralSummary[];
  documents: ClientProfileDocument[];
  activity: ClientProfileActivity[];
  progress: ReferralProgress;
  generated_at: string;
};

export type ClientProfileListItem = Pick<ClientProfile, "client_id" | "synthetic" | "identity"> & {
  referral_id: number;
  community: string;
  stage: Referral["stage"];
  owner: string;
  progress_percent: number;
  blocker_count: number;
  next_action: string | null;
  updated_at: string;
};
