import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type { ClinicalResidentResponse } from "@/lib/clinical/clinical-contracts";
import type {
  AdmissionRequirement,
  Referral,
  ReferralFile,
} from "./referral-types";
import type { PipelineResidentLink } from "./resident-link-records";
import type { ClientHistoryProjection } from "./client-history-contracts";

export type UnifiedProfileConnection = {
  status: "unlinked" | "candidate" | "confirmed";
  confirmed_link: PipelineResidentLink | null;
  candidates: PipelineResidentLink[];
  message: string;
};

export type UnifiedClientProfileResponse = ClinicalResidentResponse & {
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
