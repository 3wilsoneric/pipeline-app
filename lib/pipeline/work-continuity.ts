import { isAssessmentToolSection } from "@/lib/assessment/assessment-sections";
import type { AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import { referralCanvasFieldKeys, type ReferralCanvasFieldKey } from "@/lib/pipeline/referral-types";

export const pipelineWorkspaceViews = ["intake", "assessment", "chart", "workflow", "files", "activity"] as const;

export type PipelineWorkspaceView = (typeof pipelineWorkspaceViews)[number];

export type PipelineWorkspaceLocation = {
  view: PipelineWorkspaceView;
  assessmentSection?: AssessmentToolSection;
  intakeField?: ReferralCanvasFieldKey;
};

export type PipelineLastWorkspace = {
  referralId: number;
  location: PipelineWorkspaceLocation;
  visitedAt: string;
};

export type PipelineWorkContinuityState = {
  schema: 1;
  lastWorkspace?: PipelineLastWorkspace;
  assignmentTrackingStartedAt?: string;
  assignmentAcknowledgedThrough?: string;
  acknowledgedAssignmentIds: string[];
};

export type PipelineWorkContinuityPatch = {
  lastWorkspace?: PipelineLastWorkspace;
  initializeAssignmentTrackingAt?: string;
  acknowledgeAssignmentIds?: string[];
  acknowledgeAssignmentsThrough?: string;
};

const referralCanvasFieldKeySet = new Set<string>(referralCanvasFieldKeys);

export function emptyPipelineWorkContinuityState(): PipelineWorkContinuityState {
  return { schema: 1, acknowledgedAssignmentIds: [] };
}

export function parsePipelineWorkspaceLocation(value: unknown): PipelineWorkspaceLocation | null {
  const candidate = objectRecord(value);
  if (!candidate) return null;
  const view = pipelineWorkspaceViews.find((item) => item === candidate.view);
  if (!view) return null;
  if (view === "assessment") return parseAssessmentLocation(candidate);
  if (view === "intake") return parseIntakeLocation(candidate);
  return parseSimpleLocation(view, candidate);
}

export function parsePipelineWorkContinuityState(value: unknown): PipelineWorkContinuityState | null {
  const candidate = objectRecord(value);
  if (!candidate || candidate.schema !== 1) return null;
  const fields = parseContinuityStateFields(candidate);
  return fields ? { schema: 1, ...fields } : null;
}

export function parsePipelineWorkContinuityPatch(value: unknown): PipelineWorkContinuityPatch | null {
  const candidate = objectRecord(value);
  if (!candidate) return null;
  const patch = parseContinuityPatchFields(candidate);
  if (!patch || Object.keys(patch).length === 0) return null;
  return patch;
}

export function mergePipelineWorkContinuityState(
  current: PipelineWorkContinuityState,
  patch: PipelineWorkContinuityPatch,
): PipelineWorkContinuityState {
  const lastWorkspace = newerLastWorkspace(current.lastWorkspace, patch.lastWorkspace);
  const acknowledgedAssignmentIds = patch.acknowledgeAssignmentIds?.length
    ? [...new Set([...patch.acknowledgeAssignmentIds, ...current.acknowledgedAssignmentIds])].slice(0, 1_000)
    : current.acknowledgedAssignmentIds;
  return {
    schema: 1,
    ...(lastWorkspace ? { lastWorkspace } : {}),
    ...(current.assignmentTrackingStartedAt || patch.initializeAssignmentTrackingAt
      ? {
          assignmentTrackingStartedAt: earliestTimestamp(
            current.assignmentTrackingStartedAt,
            patch.initializeAssignmentTrackingAt,
          ),
        }
      : {}),
    ...(current.assignmentAcknowledgedThrough || patch.acknowledgeAssignmentsThrough
      ? {
          assignmentAcknowledgedThrough: latestTimestamp(
            current.assignmentAcknowledgedThrough,
            patch.acknowledgeAssignmentsThrough,
          ),
        }
      : {}),
    acknowledgedAssignmentIds,
  };
}

export function pipelineWorkspaceLocationFromSearchParams(params: URLSearchParams): PipelineWorkspaceLocation {
  const workspaceView = params.get("workspaceView");
  if (workspaceView && pipelineWorkspaceViews.includes(workspaceView as PipelineWorkspaceView)) {
    return parsePipelineWorkspaceLocation({ view: workspaceView }) ?? { view: "intake" };
  }
  const stage = params.get("workspaceStage");
  if (stage === "assessment") {
    return parsePipelineWorkspaceLocation({
      view: "assessment",
      assessmentSection: params.get("assessmentSection") ?? undefined,
    }) ?? { view: "assessment" };
  }
  if (stage === "chart") return { view: "chart" };
  return parsePipelineWorkspaceLocation({
    view: "intake",
    intakeField: params.get("workspaceField") ?? undefined,
  }) ?? { view: "intake" };
}

export function applyPipelineWorkspaceLocation(
  params: URLSearchParams,
  location: PipelineWorkspaceLocation,
) {
  params.delete("workspaceStage");
  params.delete("workspaceView");
  params.delete("assessmentSection");
  params.delete("workspaceField");
  if (location.view === "assessment") {
    params.set("workspaceStage", "assessment");
    if (location.assessmentSection) params.set("assessmentSection", location.assessmentSection);
  } else if (location.view === "chart") {
    params.set("workspaceStage", "chart");
  } else if (location.view === "intake") {
    if (location.intakeField) params.set("workspaceField", location.intakeField);
  } else {
    params.set("workspaceView", location.view);
  }
}

export function isReferralCanvasFieldKey(value: unknown): value is ReferralCanvasFieldKey {
  return typeof value === "string" && referralCanvasFieldKeySet.has(value);
}

function parseAssessmentLocation(candidate: Record<string, unknown>): PipelineWorkspaceLocation | null {
  if (candidate.intakeField !== undefined) return null;
  if (candidate.assessmentSection === undefined) return { view: "assessment" };
  return isAssessmentToolSection(candidate.assessmentSection)
    ? { view: "assessment", assessmentSection: candidate.assessmentSection }
    : null;
}

function parseIntakeLocation(candidate: Record<string, unknown>): PipelineWorkspaceLocation | null {
  if (candidate.assessmentSection !== undefined) return null;
  if (candidate.intakeField === undefined) return { view: "intake" };
  return isReferralCanvasFieldKey(candidate.intakeField)
    ? { view: "intake", intakeField: candidate.intakeField }
    : null;
}

function parseSimpleLocation(
  view: Exclude<PipelineWorkspaceView, "assessment" | "intake">,
  candidate: Record<string, unknown>,
): PipelineWorkspaceLocation | null {
  return candidate.assessmentSection === undefined && candidate.intakeField === undefined
    ? { view }
    : null;
}

function parseContinuityStateFields(candidate: Record<string, unknown>): Omit<PipelineWorkContinuityState, "schema"> | null {
  const acknowledgedAssignmentIds = parseAssignmentIds(candidate.acknowledgedAssignmentIds, 1_000);
  if (!acknowledgedAssignmentIds) return null;
  const last = parseOptionalLastWorkspaceField(candidate.lastWorkspace);
  const tracking = parseOptionalTimestampField("assignmentTrackingStartedAt", candidate.assignmentTrackingStartedAt);
  const acknowledgedThrough = parseOptionalTimestampField("assignmentAcknowledgedThrough", candidate.assignmentAcknowledgedThrough);
  if (!last || !tracking || !acknowledgedThrough) return null;
  return { acknowledgedAssignmentIds, ...last, ...tracking, ...acknowledgedThrough };
}

function parseContinuityPatchFields(candidate: Record<string, unknown>): PipelineWorkContinuityPatch | null {
  const last = parseOptionalLastWorkspaceField(candidate.lastWorkspace);
  const tracking = parseOptionalTimestampField("initializeAssignmentTrackingAt", candidate.initializeAssignmentTrackingAt);
  const ids = parseOptionalAssignmentIdsField(candidate.acknowledgeAssignmentIds);
  const acknowledgedThrough = parseOptionalTimestampField("acknowledgeAssignmentsThrough", candidate.acknowledgeAssignmentsThrough);
  if (!last || !tracking || !ids || !acknowledgedThrough) return null;
  return { ...last, ...tracking, ...ids, ...acknowledgedThrough };
}

function parseOptionalLastWorkspaceField(value: unknown): Pick<PipelineWorkContinuityPatch, "lastWorkspace"> | null {
  if (value === undefined) return {};
  const lastWorkspace = parseLastWorkspace(value);
  return lastWorkspace ? { lastWorkspace } : null;
}

function parseOptionalTimestampField<Key extends "assignmentTrackingStartedAt" | "assignmentAcknowledgedThrough" | "initializeAssignmentTrackingAt" | "acknowledgeAssignmentsThrough">(
  key: Key,
  value: unknown,
): Partial<Record<Key, string>> | null {
  if (value === undefined) return {};
  return isTimestamp(value) ? { [key]: value } as Partial<Record<Key, string>> : null;
}

function parseOptionalAssignmentIdsField(value: unknown): Pick<PipelineWorkContinuityPatch, "acknowledgeAssignmentIds"> | null {
  if (value === undefined) return {};
  const acknowledgeAssignmentIds = parseAssignmentIds(value, 50);
  if (!acknowledgeAssignmentIds) return null;
  return acknowledgeAssignmentIds.length ? { acknowledgeAssignmentIds } : {};
}

function parseAssignmentIds(value: unknown, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const ids = [...new Set(value)];
  return ids.every((id) => isBoundedText(id, 200)) ? ids as string[] : null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseLastWorkspace(value: unknown): PipelineLastWorkspace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PipelineLastWorkspace>;
  const location = parsePipelineWorkspaceLocation(candidate.location);
  if (!Number.isSafeInteger(candidate.referralId) || Number(candidate.referralId) < 1 || !location || !isTimestamp(candidate.visitedAt)) {
    return null;
  }
  return { referralId: Number(candidate.referralId), location, visitedAt: candidate.visitedAt as string };
}

function newerLastWorkspace(
  current: PipelineLastWorkspace | undefined,
  incoming: PipelineLastWorkspace | undefined,
) {
  if (!incoming) return current;
  if (!current) return incoming;
  return Date.parse(incoming.visitedAt) >= Date.parse(current.visitedAt) ? incoming : current;
}

function earliestTimestamp(current: string | undefined, incoming: string | undefined) {
  if (!current) return incoming as string;
  if (!incoming) return current;
  return Date.parse(current) <= Date.parse(incoming) ? current : incoming;
}

function latestTimestamp(current: string | undefined, incoming: string | undefined) {
  if (!current) return incoming as string;
  if (!incoming) return current;
  return Date.parse(current) >= Date.parse(incoming) ? current : incoming;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}
