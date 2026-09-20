import { canEditWorkspace } from "@/lib/pipeline/referral-ownership";
import { PipelineApiError, type PipelineCurrentUser } from "@/lib/auth/authenticated-fetch";
import { isAssessmentFinalized, type AssessmentPatchInput, type PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type { AssessmentDraftWorkbookSources } from "@/lib/pipeline/user-workspace-state-types";
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

// One PATCH has one source. Keep manual answers and different workbook copies
// separate when a recovered section is flushed through the normal save queue.
export function assessmentSaveGroups(data: Partial<AssessmentToolData>, currentData: AssessmentToolData, sources: AssessmentDraftWorkbookSources) {
  const groups = new Map<string, AssessmentPatchInput & { data: Partial<AssessmentToolData> }>();
  for (const [key, value] of Object.entries(data)) {
    const field = key as AssessmentToolFieldKey;
    const source = sameAssessmentValue(value, currentData[field]) ? sources[field] : undefined;
    const sourceKey = source ? JSON.stringify(source) : "manual";
    let group = groups.get(sourceKey);
    if (!group) { group = { data: {}, ...(source ? { workbook_restore: source } : {}) }; groups.set(sourceKey, group); }
    group.data[field] = value as never;
  }
  return [...groups.values()];
}

export function acknowledgeAssessmentWorkbookSave(sources: AssessmentDraftWorkbookSources, local: AssessmentToolData, sent: Partial<AssessmentToolData>, source: AssessmentPatchInput["workbook_restore"]) {
  const remaining = { ...sources };
  if (!source) return remaining;
  for (const [key, value] of Object.entries(sent)) {
    const field = key as AssessmentToolFieldKey;
    if (sources[field]?.export_id === source.export_id && sources[field]?.exported_at === source.exported_at && sameAssessmentValue(local[field], value)) delete remaining[field];
  }
  return remaining;
}

export function sameAssessmentValue(
  left: AssessmentToolData[AssessmentToolFieldKey],
  right: AssessmentToolData[AssessmentToolFieldKey],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function canRebaseAssessmentAnswers(
  base: PipelineAssessmentRecord,
  latest: PipelineAssessmentRecord,
  answers: Partial<AssessmentToolData>,
) {
  if (base.assessment_id !== latest.assessment_id || latest.version <= base.version || isAssessmentFinalized(latest)) return false;
  // Renaming also checks the referral's identity; never retry that lifecycle race.
  if (answers.resident_name !== undefined) return false;
  return Object.entries(answers).every(([key, value]) => {
    const field = key as AssessmentToolFieldKey;
    return sameAssessmentValue(base[field], latest[field]) || sameAssessmentValue(value, latest[field]);
  });
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

export function canSuperviseAssessment(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
) {
  if (trainingAssessmentMode) return true;
  return canEditWorkspace(viewer);
}

export function canCreateAssessment(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
) {
  if (trainingAssessmentMode) return true;
  return canEditWorkspace(viewer);
}

export function canEditAssessment(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
  selected: PipelineAssessmentRecord | null,
  canSupervise: boolean,
) {
  if (isAssessmentFinalized(selected)) return false;
  if (trainingAssessmentMode) return true;
  if (!viewer || !selected) return false;
  void canSupervise;
  return canEditWorkspace(viewer);
}

export function canAddAssessmentAddendum(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
  selected: PipelineAssessmentRecord | null,
  canSupervise: boolean,
) {
  if (!isAssessmentFinalized(selected)) return false;
  if (trainingAssessmentMode) return true;
  if (!viewer) return false;
  void canSupervise;
  return Boolean(selected && canEditWorkspace(viewer));
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
  captured = false,
): assessment is PipelineAssessmentRecord {
  return Boolean(assessment && (captured || dirtySections.has(section)));
}

export function hasSectionConflict(
  remoteChange: AssessmentRemoteChange | null,
  section: AssessmentToolSection,
  fields?: Partial<AssessmentToolData>,
) {
  return Boolean(remoteChange?.conflicts.some((conflict) => conflict.section === section
    && (!fields || Object.hasOwn(fields, conflict.field))));
}

export function isOfflineAssessmentSave(error: unknown, offlinePrincipal: string): error is PipelineApiError {
  return error instanceof PipelineApiError && (error.status === 0 || error.status === 429 || error.status >= 500) && Boolean(offlinePrincipal);
}

export function hasAssessmentScheduleInput(
  assessment: PipelineAssessmentRecord | null,
  scheduleStart: string,
): assessment is PipelineAssessmentRecord {
  return Boolean(assessment && scheduleStart);
}

export function hasActiveAssessmentSchedule(
  assessment: Pick<PipelineAssessmentRecord, "scheduled_start_at" | "schedule_status"> | null,
) {
  return Boolean(assessment?.scheduled_start_at
    && (assessment.schedule_status === "scheduled" || assessment.schedule_status === "rescheduled"));
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
  if (dirty) return message === "Saving last changes..." ? message : "Saving practice changes...";
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
  if (dirty) {
    if (message.startsWith("Restored answers") || message === "Saving changes..." || message === "Saving last changes...") return message;
    return "Changes not yet saved";
  }
  return message || "All changes saved";
}
