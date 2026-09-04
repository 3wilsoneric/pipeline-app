import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { createEmptyAssessmentToolData } from "@/lib/assessment/assessment-tool-schema";
import { defaultAssessmentSectionVersions } from "@/lib/assessment/assessment-sections";

export type TrainingAssessmentMode = "schedule" | "interview";

const trainingActor = {
  id: "pipeline-training-assessor",
  name: "Training Assessor",
};

export function buildTrainingAssessment(mode: TrainingAssessmentMode): PipelineAssessmentRecord {
  const now = new Date();
  const scheduledStart = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
  scheduledStart.setMinutes(0, 0, 0);
  const startedAt = mode === "interview" ? now.toISOString() : null;
  const data = {
    ...createEmptyAssessmentToolData(),
    resident_number: "TRAINING-001",
    resident_name: "Taylor Rivera",
    date_of_birth: "1988-02-14",
    community: "San Pablo",
    assessment_date: now.toISOString().slice(0, 10),
    assessor: trainingActor.name,
    referral_received_date: now.toISOString().slice(0, 10),
    referrer_name: "Jordan Lee",
    referrer_contact: "Synthetic county program",
    current_location: "Training Stabilization Center",
    time_at_current_location: "Two weeks",
    referring_facility: "Training Stabilization Center",
    prior_setting_bucket: "Acute psychiatric setting",
    county: "Alameda County",
    primary_diagnosis: "Schizoaffective disorder",
    current_symptoms: "Synthetic case: mood is stable today; the client reports intermittent anxiety during transitions.",
    cognition_orientation: "Alert and oriented to person, place, time, and situation.",
    mobility: "Independent",
    medication_adherence: "Yes",
    family_involvement: "A sibling participates in planning with the client's permission.",
    discharge_planning_goals: "Build a stable routine and transition to an appropriate residential setting.",
    source_file: "Synthetic training packet",
    match_confidence: 1,
    extraction_date: now.toISOString(),
  };

  return {
    ...data,
    assessment_id: `pipeline-training-${mode}`,
    canonical_client_id: null,
    resident_key: null,
    version: 1,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    field_provenance: {},
    unmapped_fields: [],
    referral_id: 0,
    assessor_id: trainingActor.id,
    status: "draft",
    completed_at: null,
    created_by: trainingActor,
    updated_by: trainingActor,
    audit_events: [],
    section_versions: defaultAssessmentSectionVersions(),
    scheduled_start_at: mode === "interview" ? scheduledStart.toISOString() : null,
    scheduled_duration_minutes: mode === "interview" ? 60 : null,
    scheduled_method: mode === "interview" ? "in_person" : null,
    scheduled_location: mode === "interview" ? "Training interview room" : null,
    schedule_status: mode === "interview" ? "scheduled" : "unscheduled",
    started_at: startedAt,
    signed_at: null,
    signed_by: null,
    signature_version: 0,
    addenda: [],
  };
}
