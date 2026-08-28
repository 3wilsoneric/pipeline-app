import type {
  AssessmentFieldProvenance,
  AssessmentToolData,
  AssessmentToolFieldKey,
  AssessmentToolRecord,
  UnmappedAssessmentField,
} from "./assessment-tool-schema";
import type { AssessmentSectionVersions } from "./assessment-sections";

export type AssessmentWorkflowStatus = "draft" | "needs_review" | "complete";

export type AssessmentActor = {
  id: string;
  name: string;
};

export type AssessmentAuditAction =
  | "assessment_created"
  | "assessment_assigned"
  | "assessment_imported"
  | "assessment_updated"
  | "extraction_confirmed"
  | "assessment_completed"
  | "assessment_reopened"
  | "assessment_scheduled"
  | "assessment_rescheduled"
  | "assessment_cancelled"
  | "assessment_no_show"
  | "assessment_started"
  | "assessment_signed"
  | "assessment_addendum_added";

export type AssessmentScheduleStatus =
  | "unscheduled"
  | "scheduled"
  | "rescheduled"
  | "cancelled"
  | "no_show"
  | "completed";

export type AssessmentScheduleMethod = "in_person" | "phone" | "zoom" | "record_review";

export type AssessmentScheduleUpdate = {
  start_at: string | null;
  duration_minutes: number | null;
  method: AssessmentScheduleMethod | null;
  location: string | null;
  status: Exclude<AssessmentScheduleStatus, "completed">;
};

export type AssessmentAddendum = {
  addendum_id: string;
  assessment_id: string;
  version: number;
  note: string;
  reason_code: string;
  authored_by: string;
  authored_by_name: string;
  created_at: string;
};

export type AssessmentAuditEvent = {
  event_id: string;
  assessment_id: string;
  referral_id: number;
  action: AssessmentAuditAction;
  actor_id: string;
  actor_name: string;
  changed_fields: AssessmentToolFieldKey[];
  created_at: string;
};

export type PipelineAssessmentRecord = AssessmentToolRecord & {
  referral_id: number;
  assessor_id: string | null;
  status: AssessmentWorkflowStatus;
  completed_at: string | null;
  created_by: AssessmentActor;
  updated_by: AssessmentActor;
  audit_events: AssessmentAuditEvent[];
  section_versions: AssessmentSectionVersions;
  scheduled_start_at?: string | null;
  scheduled_duration_minutes?: number | null;
  scheduled_method?: AssessmentScheduleMethod | null;
  scheduled_location?: string | null;
  schedule_status?: AssessmentScheduleStatus;
  started_at?: string | null;
  signed_at?: string | null;
  signed_by?: AssessmentActor | null;
  signature_version?: number;
  addenda?: AssessmentAddendum[];
};

export type AssessmentListResponse = {
  assessments: PipelineAssessmentRecord[];
  total: number;
  revision: number;
  next_cursor: string | null;
  generated_at: string;
  store: {
    mode: "local_file" | "postgres";
    multi_instance_safe: boolean;
  };
};

export type AssessmentCreateInput = {
  referral_id: number;
  /** Server-resolved from the referral's authoritative assignment. */
  assigned_assessor?: AssessmentActor | null;
  canonical_client_id?: string | null;
  resident_key?: string | null;
  data: AssessmentToolData;
  status?: AssessmentWorkflowStatus;
  field_provenance?: Partial<Record<AssessmentToolFieldKey, AssessmentFieldProvenance[]>>;
  unmapped_fields?: UnmappedAssessmentField[];
};

export type AssessmentPatchInput = {
  data?: Partial<AssessmentToolData>;
  /** Server-resolved only. Browser requests supply an active workspace member ID. */
  assigned_assessor?: AssessmentActor | null;
  /** Server-resolved only. A canonical identity can be attached once and never changed. */
  canonical_client_id?: string | null;
  resident_key?: string | null;
  status?: AssessmentWorkflowStatus;
  accept_pending?: boolean;
  review_extraction?: Array<{
    field: AssessmentToolFieldKey;
    action: "accept" | "reject";
  }>;
  /** Server-only lifecycle commands. Browser payload validation rejects these fields. */
  schedule?: AssessmentScheduleUpdate;
  mark_started?: boolean;
  signer?: AssessmentActor;
};

export type AssessmentCompletionReportRow = {
  assessor_id: string | null;
  assessor_name: string;
  /** Signed clinical encounters in the selected month. */
  completed_assessments: number;
  average_duration_minutes: number | null;
};

export type AssessmentCompletionReport = {
  month: string;
  period_start: string;
  period_end: string;
  total_completed: number;
  rows: AssessmentCompletionReportRow[];
  generated_at: string;
};

export function preserveCanonicalClientId(
  current: string | null | undefined,
  incoming: string | null | undefined,
) {
  const currentValue = current?.trim() || null;
  const incomingValue = incoming?.trim() || null;
  if (currentValue && incomingValue && currentValue !== incomingValue) {
    throw new Error("An assessment's canonical client identity cannot be changed.");
  }
  return currentValue ?? incomingValue;
}
