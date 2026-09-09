import { PipelineApiError, type PipelineCurrentUser } from "@/lib/auth/authenticated-fetch";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import {
  assessmentToolFieldDefinitions,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";
import type { TrainingAssessmentMode } from "@/lib/training/mock-assessment";

export const extractionOwnedFields = new Set<AssessmentToolFieldKey>([
  "assessor",
  "source_file",
  "match_confidence",
  "extraction_date",
]);

export type AssessmentFieldConflict = {
  field: AssessmentToolFieldKey;
  localValue: AssessmentToolData[AssessmentToolFieldKey];
  remoteValue: AssessmentToolData[AssessmentToolFieldKey];
  section: AssessmentToolSection;
};

export type AssessmentRemoteChange = {
  assessment: PipelineAssessmentRecord;
  conflicts: AssessmentFieldConflict[];
};

export function getPendingFields(assessment: PipelineAssessmentRecord | null) {
  if (!assessment) return [];
  return assessmentToolFieldDefinitions
    .filter((definition) => assessment.field_provenance[definition.key]?.at(-1)?.review_status === "pending")
    .map((definition) => definition.key);
}

export function latestPendingProvenance(
  assessment: PipelineAssessmentRecord,
  field: AssessmentToolFieldKey,
) {
  const latest = assessment.field_provenance[field]?.at(-1);
  return latest?.review_status === "pending" ? latest : undefined;
}

export function editableSectionData(data: AssessmentToolData, section: AssessmentToolSection) {
  return Object.fromEntries(
    assessmentToolFieldDefinitions
      .filter((definition) => definition.section === section && !extractionOwnedFields.has(definition.key))
      .map((definition) => [definition.key, data[definition.key]]),
  ) as Partial<AssessmentToolData>;
}

export function dirtyAssessmentSections(data: AssessmentToolData, base: AssessmentToolData) {
  const sections = new Set<AssessmentToolSection>();
  for (const definition of assessmentToolFieldDefinitions) {
    if (!extractionOwnedFields.has(definition.key) && !sameAssessmentValue(data[definition.key], base[definition.key])) {
      sections.add(definition.section);
    }
  }
  return sections;
}

export function sameAssessmentValue(
  left: AssessmentToolData[AssessmentToolFieldKey],
  right: AssessmentToolData[AssessmentToolFieldKey],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assessmentFromConflict(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const assessment = (payload as { assessment?: unknown }).assessment;
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) return null;
  const candidate = assessment as Partial<PipelineAssessmentRecord>;
  return typeof candidate.assessment_id === "string" && Number.isSafeInteger(candidate.version)
    ? assessment as PipelineAssessmentRecord
    : null;
}

export function assessmentOfflinePrincipal(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
) {
  if (trainingAssessmentMode) return "";
  return viewer?.id ?? viewer?.email ?? "";
}

function viewerHasAnyRole(viewer: PipelineCurrentUser | null, roles: readonly string[]) {
  return Boolean(viewer?.roles.some((role) => roles.includes(role)));
}

export function canSuperviseAssessment(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
) {
  if (trainingAssessmentMode) return true;
  return viewerHasAnyRole(viewer, ["admin", "assessment_coordinator"]);
}

export function canCreateAssessment(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
) {
  if (trainingAssessmentMode) return true;
  return viewerHasAnyRole(viewer, ["admin", "assessment_coordinator", "reviewer"]);
}

export function canEditAssessment(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
  selected: PipelineAssessmentRecord | null,
  canSupervise: boolean,
) {
  if (trainingAssessmentMode) return true;
  if (!viewer || !selected) return false;
  return selected.assessor_id === viewer.id || canSupervise;
}

export function canAddAssessmentAddendum(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
  selected: PipelineAssessmentRecord | null,
  canSupervise: boolean,
) {
  if (trainingAssessmentMode) return true;
  if (!viewer) return false;
  return selected?.signed_by?.id === viewer.id || canSupervise;
}

export function loadRecoveryDraftForLiveAssessment(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  loadRecoveryDraft: (assessment: PipelineAssessmentRecord, currentData: AssessmentToolData) => Promise<void>,
  assessment: PipelineAssessmentRecord,
  currentData: AssessmentToolData,
) {
  if (!trainingAssessmentMode) void loadRecoveryDraft(assessment, currentData);
}

export function canSaveAssessmentSection(
  assessment: PipelineAssessmentRecord | null,
  dirtySections: ReadonlySet<AssessmentToolSection>,
  section: AssessmentToolSection,
): assessment is PipelineAssessmentRecord {
  return Boolean(assessment && dirtySections.has(section));
}

export function hasSectionConflict(
  remoteChange: AssessmentRemoteChange | null,
  section: AssessmentToolSection,
) {
  return Boolean(remoteChange?.conflicts.some((conflict) => conflict.section === section));
}

export function isOfflineAssessmentSave(error: unknown, offlinePrincipal: string): error is PipelineApiError {
  return error instanceof PipelineApiError && error.status === 0 && Boolean(offlinePrincipal);
}

export function hasAssessmentScheduleInput(
  assessment: PipelineAssessmentRecord | null,
  scheduleStart: string,
): assessment is PipelineAssessmentRecord {
  return Boolean(assessment && scheduleStart);
}

export function nextAssessmentScheduleStatus(status: PipelineAssessmentRecord["schedule_status"]) {
  if (status === "scheduled") return "rescheduled" as const;
  if (status === "rescheduled") return "rescheduled" as const;
  return "scheduled" as const;
}

export function nullableTrimmedText(value: string) {
  return value.trim() || null;
}

export function assessmentRequiresSavedReferral(
  referralId: number | undefined,
  trainingAssessmentMode?: TrainingAssessmentMode,
) {
  return Boolean(!referralId && !trainingAssessmentMode);
}

export function assessmentSaveStatus({
  error,
  trainingAssessmentMode,
  dirty,
  message,
  networkOnline,
  pendingOfflineSaves,
}: {
  error: string;
  trainingAssessmentMode: TrainingAssessmentMode | undefined;
  dirty: boolean;
  message: string;
  networkOnline: boolean;
  pendingOfflineSaves: number;
}) {
  if (error) return error;
  if (trainingAssessmentMode) return trainingAssessmentSaveStatus(dirty, message);
  return liveAssessmentSaveStatus(dirty, message, networkOnline, pendingOfflineSaves);
}

function trainingAssessmentSaveStatus(dirty: boolean, message: string) {
  if (dirty) return "Saving practice changes...";
  return message || "Practice changes saved locally";
}

function liveAssessmentSaveStatus(
  dirty: boolean,
  message: string,
  networkOnline: boolean,
  pendingOfflineSaves: number,
) {
  if (!networkOnline) return `Offline${pendingOfflineSaves > 0 ? ` · ${pendingOfflineSaves} queued` : ""}`;
  if (pendingOfflineSaves > 0) {
    return `${pendingOfflineSaves} change${pendingOfflineSaves === 1 ? "" : "s"} waiting to sync`;
  }
  if (dirty) return "Saving changes...";
  return message || "All changes saved";
}
