import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type {
  ClinicalClientResponse,
  ClinicalResident,
} from "@/lib/clinical/clinical-contracts";
import type {
  AdmissionRequirement,
  Referral,
  ReferralFile,
} from "./referral-types";
import type { PipelineResidentLink } from "./resident-link-records";
import type { ClientHistoryProjection } from "./client-history-contracts";

export type UnifiedProfileLinkSuggestion = {
  referral_id: number;
  pipeline_client_id: string;
  client_name: string;
  community: Referral["community"];
  stage: Referral["stage"];
  received_at: string;
  confidence: number;
  match_method: "resident_number_exact" | "exact_name_dob" | "compatible_name_dob";
  reasons: string[];
};

export type UnifiedProfileConnection = {
  status: "unavailable" | "unlinked" | "candidate" | "confirmed" | "pipeline_only";
  confirmed_link: PipelineResidentLink | null;
  candidates: PipelineResidentLink[];
  suggestions: UnifiedProfileLinkSuggestion[];
  message: string;
};

export type UnifiedClientProfileResponse = Omit<ClinicalClientResponse, "source"> & {
  source: "alamo_platform" | "pipeline";
  profile_origin: "alamo_platform" | "pipeline";
  resident: ClinicalResident | null;
  history: ClientHistoryProjection;
  pipeline: {
    permissions: {
      can_create_identity_candidate: boolean;
      can_review_identity: boolean;
    };
    connection: UnifiedProfileConnection;
    referrals: Referral[];
    assessments: PipelineAssessmentRecord[];
    requirements: AdmissionRequirement[];
    documents: ReferralFile[];
    summary: {
      referral_count: number;
      active_referral_count: number;
      assessment_count: number;
      latest_assessment_status: PipelineAssessmentRecord["status"] | null;
      latest_assessment_completion_pct: number | null;
      open_requirement_count: number;
      blocker_count: number;
      document_count: number;
      actions_needed: string[];
    };
  };
};
