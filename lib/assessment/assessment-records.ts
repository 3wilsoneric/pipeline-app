import type {
  AssessmentFieldProvenance,
  AssessmentToolData,
  AssessmentToolFieldKey,
  AssessmentToolRecord,
  UnmappedAssessmentField,
} from "./assessment-tool-schema";

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
  resident_key?: string | null;
  data: AssessmentToolData;
  status?: AssessmentWorkflowStatus;
  field_provenance?: Partial<Record<AssessmentToolFieldKey, AssessmentFieldProvenance[]>>;
  unmapped_fields?: UnmappedAssessmentField[];
};

export type AssessmentPatchInput = {
  data?: Partial<AssessmentToolData>;
  resident_key?: string | null;
  status?: AssessmentWorkflowStatus;
  accept_pending?: boolean;
};
