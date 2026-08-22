import type { ReferralStage } from "@/lib/pipeline/referral-workflow";
import type { PipelineCommunity } from "@/lib/pipeline/community-config";
import type { RequirementType } from "@/lib/pipeline/referral-types";
import type { AssessmentCompletionReport } from "@/lib/assessment/assessment-records";

export type OperationsWorkItem = {
  referral_id: number;
  client_id?: string;
  client_name: string;
  community: string;
  stage: ReferralStage;
  owner_id?: string;
  owner: string;
  priority: string;
  blocker_count: number;
  blockers: string[];
  missing_data: string[];
  next_action: string | null;
  action_required: boolean;
  waiting: boolean;
  age_hours: number;
  stale: boolean;
  due_soon: boolean;
  assessment_date?: string;
  assessment_complete: boolean;
  has_decision: boolean;
  completion_pct: number;
};

export type OperationsRequirementItem = {
  work_item_id: string;
  version: number;
  referral_id: number;
  client_name: string;
  community: string;
  label: string;
  status: string;
  owner_id?: string;
  owner: string;
  due_at: string | null;
  next_action: string;
  evidence_document_name: string | null;
  overdue: boolean;
  due_soon: boolean;
  unassigned: boolean;
  type: RequirementType;
  blocker: boolean;
};

export type ReferralWorklistBucket =
  | "all_actionable"
  | "unassigned"
  | "packet_review"
  | "assessment_due"
  | "decision_needed"
  | "missing_documents"
  | "follow_up"
  | "blocked";

export type ReferralWorklistItem = {
  referral_id: number;
  client_name: string;
  community: PipelineCommunity;
  stage: ReferralStage;
  owner: string;
  priority: string;
  categories: Exclude<ReferralWorklistBucket, "all_actionable">[];
  primary_category: Exclude<ReferralWorklistBucket, "all_actionable">;
  next_action: string;
  blockers: string[];
  missing_data: string[];
  urgency: MyQueueUrgency;
  due_at: string | null;
  last_activity_at: string;
  age_hours: number;
  completion_pct: number;
  missing_document_count: number;
};

export type ReferralWorklistSnapshot = {
  generated_at: string;
  total: number;
  counts: Record<ReferralWorklistBucket, number>;
  items: ReferralWorklistItem[];
};

export type OperationsAssessorLoad = {
  owner: string;
  active: number;
  blocked: number;
  stale: number;
  due_soon: number;
};

export type OperationsSystemCheck = {
  label: string;
  status: "ready" | "attention" | "not_connected";
  detail: string;
};

export type MyQueueUrgency = "overdue" | "blocked" | "due_soon" | "stale" | "normal";

export type MyQueueItem = {
  id: string;
  referral_id: number;
  client_name: string;
  community: string;
  stage: ReferralStage;
  next_action: string;
  urgency: MyQueueUrgency;
  due_at: string | null;
};

export type MyQueueSnapshot = {
  generated_at: string;
  owner: {
    id: string;
    name: string;
  };
  total: number;
  items: MyQueueItem[];
};

export type SupervisorExceptionKind =
  | "overdue_requirement"
  | "unassigned_referral"
  | "unassigned_requirement"
  | "blocked_referral"
  | "stale_referral"
  | "extraction_failed"
  | "extraction_conflict"
  | "decision_needed"
  | "resident_link_candidate"
  | "resident_link_collision"
  | "ehr_handoff_failed";

export type SupervisorExceptionItem = {
  id: string;
  kind: SupervisorExceptionKind;
  severity: "critical" | "attention" | "review";
  label: string;
  detail: string;
  referral_id: number | null;
  resident_link_id: string | null;
  client_name: string | null;
  community: string | null;
  owner: string | null;
  due_at: string | null;
  age_hours: number | null;
};

export type SupervisorExceptionSnapshot = {
  generated_at: string;
  total: number;
  counts: Partial<Record<SupervisorExceptionKind, number>>;
  items: SupervisorExceptionItem[];
};

export type OperationsSnapshot = {
  source: "referral_store" | "unavailable";
  generated_at: string;
  metrics: {
    active: number;
    needs_action: number;
    stale: number;
    unassigned: number;
    due_soon: number;
    open_requirements: number;
    overdue_requirements: number;
    decisions_needed: number;
    client_profiles: number | null;
    oldest_queue_age_hours: number;
  };
  work: OperationsWorkItem[];
  requirements: OperationsRequirementItem[];
  assessors: OperationsAssessorLoad[];
  assessment_report: AssessmentCompletionReport | null;
  funnel: { stage: ReferralStage; label: string; count: number }[];
  data_quality: {
    missing_owner: number;
    missing_packet: number;
    missing_assessment: number;
    missing_decision: number;
  };
  system: OperationsSystemCheck[];
};
