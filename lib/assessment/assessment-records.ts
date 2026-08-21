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
  | "assessment_imported"
  | "assessment_updated"
  | "extraction_confirmed"
  | "assessment_completed"
  | "assessment_reopened";

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
  status: AssessmentWorkflowStatus;
  completed_at: string | null;
  created_by: AssessmentActor;
  updated_by: AssessmentActor;
  audit_events: AssessmentAuditEvent[];
  section_versions: AssessmentSectionVersions;
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
  canonical_client_id?: string | null;
  resident_key?: string | null;
  data: AssessmentToolData;
  status?: AssessmentWorkflowStatus;
  field_provenance?: Partial<Record<AssessmentToolFieldKey, AssessmentFieldProvenance[]>>;
  unmapped_fields?: UnmappedAssessmentField[];
};

export type AssessmentPatchInput = {
  data?: Partial<AssessmentToolData>;
  /** Server-resolved only. A canonical identity can be attached once and never changed. */
  canonical_client_id?: string | null;
  resident_key?: string | null;
  status?: AssessmentWorkflowStatus;
  accept_pending?: boolean;
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
