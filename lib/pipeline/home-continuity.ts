import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import type { HomeContinuitySnapshot, HomeResumeItem } from "@/lib/pipeline/home-briefing-types";
import type { HomeWorkflowSummary, ReferralWorklistItem } from "@/lib/pipeline/operations-types";
import { getPipelineWorkContinuityState } from "@/lib/pipeline/work-continuity-store";
import type { PipelineWorkContinuityState, PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import {
  getUserWorkspaceStateReadiness,
  listUserWorkspaceState,
  type UserWorkspaceState,
} from "@/lib/pipeline/user-workspace-state-store";
import {
  isNewReferralDraftKey,
  parsePipelineAssessmentDraft,
  parsePipelineReferralDraft,
  type PipelineAssessmentDraft,
  type PipelineReferralDraft,
} from "@/lib/pipeline/user-workspace-state-types";
import { referralCanvasFieldKeys } from "@/lib/pipeline/referral-types";
import { listWorkspaceActivity } from "@/lib/pipeline/workspace-activity";

export async function getHomeContinuity(
  user: PipelineUser,
  workflow: HomeWorkflowSummary,
  generatedAt: string,
): Promise<HomeContinuitySnapshot> {
  if (!getUserWorkspaceStateReadiness().ready) return unavailableContinuity();

  const fallbackTrackingStart = new Date(Date.parse(generatedAt) - 86_400_000).toISOString();
  try {
    const [continuityRecord, referralDraftRecords, assessmentDraftRecords] = await Promise.all([
      getPipelineWorkContinuityState(user.id),
      listUserWorkspaceState<PipelineReferralDraft>(user.id, "referral_draft", 100),
      listUserWorkspaceState<PipelineAssessmentDraft>(user.id, "assessment_draft", 100),
    ]);
    const state = continuityRecord.state;
    const trackingStart = assignmentTrackingStart(state, fallbackTrackingStart);
    const assignments = await loadNewAssignments(user, trackingStart);
    const acknowledged = new Set(state.acknowledgedAssignmentIds);
    const activeById = new Map(workflow.active_items.map((item) => [item.referral_id, item]));
    const candidates = [
      ...referralDraftResumeItems(referralDraftRecords, activeById),
      ...assessmentDraftResumeItems(assessmentDraftRecords, activeById),
      ...lastWorkspaceResumeItems(state, activeById),
    ];

    return {
      resume_items: dedupeAndRankResumeItems(candidates).slice(0, 3),
      new_assignments: (assignments?.items ?? []).filter((item) => !acknowledged.has(item.event_id)).slice(0, 6),
      assignment_tracking_started_at: trackingStart,
      needs_assignment_tracking_initialization: !state.assignmentTrackingStartedAt,
      unavailable: !assignments,
    };
  } catch {
    return unavailableContinuity();
  }
}

async function loadNewAssignments(user: PipelineUser, since: string) {
  try {
    return await listWorkspaceActivity(user, { scope: "assigned", since, limit: 100 });
  } catch {
    // Assignment activity is an enhancement; a feed outage must not hide a
    // recoverable draft or the user's last active workspace.
    return null;
  }
}

function assignmentTrackingStart(state: PipelineWorkContinuityState, fallback: string) {
  const baseline = state.assignmentTrackingStartedAt ?? fallback;
  return state.assignmentAcknowledgedThrough
    && Date.parse(state.assignmentAcknowledgedThrough) > Date.parse(baseline)
    ? state.assignmentAcknowledgedThrough
    : baseline;
}

function referralDraftResumeItems(
  records: UserWorkspaceState<PipelineReferralDraft>[],
  activeById: Map<number, ReferralWorklistItem>,
) {
  const items: HomeResumeItem[] = [];
  for (const record of records) {
    const draft = parsePipelineReferralDraft(record.payload);
    if (!draft || !hasRecoverableReferralWork(draft)) continue;
    if (isNewReferralDraftKey(record.state_key)) {
      items.push(newReferralResumeItem(record, draft));
      continue;
    }
    const referralId = parseReferralId(record.state_key);
    const work = referralId ? activeById.get(referralId) : undefined;
    if (!referralId || !work) continue;
    items.push({
      id: `referral-draft:${referralId}`,
      kind: "referral_draft",
      ...resumeIdentity(work),
      detail: "Unsaved intake changes",
      updated_at: record.updated_at,
      referral_id: referralId,
      location: intakeDraftLocation(draft),
    });
  }
  return items;
}

function newReferralResumeItem(
  record: UserWorkspaceState<PipelineReferralDraft>,
  draft: PipelineReferralDraft,
): HomeResumeItem {
  return {
    id: `new:${record.state_key}`,
    kind: "new_referral",
    client_name: draft.fields.name.value.trim() || "New referral",
    community: draft.fields.community.value.trim(),
    detail: "Unsaved intake",
    updated_at: record.updated_at,
    draft_key: record.state_key as `new-${string}`,
    location: intakeDraftLocation(draft),
    completed_fields: referralCanvasFieldKeys.filter((key) => draft.fields[key].value.trim()).length,
    total_fields: referralCanvasFieldKeys.length,
  };
}

function intakeDraftLocation(draft: PipelineReferralDraft): PipelineWorkspaceLocation {
  return { view: "intake", ...(draft.lastFocus ? { intakeField: draft.lastFocus } : {}) };
}

function assessmentDraftResumeItems(
  records: UserWorkspaceState<PipelineAssessmentDraft>[],
  activeById: Map<number, ReferralWorklistItem>,
) {
  const items: HomeResumeItem[] = [];
  for (const record of records) {
    const draft = parsePipelineAssessmentDraft(record.payload);
    const work = draft?.referralId ? activeById.get(draft.referralId) : undefined;
    if (!draft?.referralId || draft.dirtySections.length === 0 || !work) continue;
    items.push({
      id: `assessment-draft:${draft.assessmentId}`,
      kind: "assessment_draft",
      ...resumeIdentity(work),
      detail: "Unsaved assessment changes",
      updated_at: record.updated_at,
      referral_id: draft.referralId,
      location: {
        view: "assessment",
        assessmentSection: draft.activeSection ?? draft.dirtySections[0],
      },
    });
  }
  return items;
}

function lastWorkspaceResumeItems(
  state: PipelineWorkContinuityState,
  activeById: Map<number, ReferralWorklistItem>,
): HomeResumeItem[] {
  const recent = state.recentWorkspaces?.length
    ? state.recentWorkspaces
    : state.lastWorkspace ? [state.lastWorkspace] : [];
  return recent.flatMap((last) => {
    const work = activeById.get(last.referralId);
    return work ? [{
      id: `last-workspace:${last.referralId}`,
      kind: "last_workspace" as const,
      ...resumeIdentity(work),
      detail: resumeDetail(last.location),
      updated_at: last.visitedAt,
      referral_id: last.referralId,
      location: last.location,
    }] : [];
  });
}

function unavailableContinuity(): HomeContinuitySnapshot {
  return {
    resume_items: [],
    new_assignments: [],
    assignment_tracking_started_at: null,
    needs_assignment_tracking_initialization: false,
    unavailable: true,
  };
}

function hasRecoverableReferralWork(draft: PipelineReferralDraft) {
  return draft.dirtyKeys.length > 0
    || Boolean(draft.initialPacketName?.trim())
    || referralCanvasFieldKeys.some((key) => draft.fields[key].value.trim().length > 0);
}

function parseReferralId(value: string) {
  if (!/^[1-9]\d{0,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function resumeIdentity(work: ReferralWorklistItem) {
  return { client_name: work.client_name, community: work.community };
}

function resumeDetail(location: PipelineWorkspaceLocation) {
  if (location.view === "assessment") return "Continue assessment";
  if (location.view === "files") return "Continue document review";
  if (location.view === "workflow") return "Continue workflow review";
  if (location.view === "chart") return "Continue chart review";
  if (location.view === "activity") return "Continue activity review";
  return "Continue intake";
}

function dedupeAndRankResumeItems(items: HomeResumeItem[]) {
  const kindRank: Record<HomeResumeItem["kind"], number> = {
    assessment_draft: 4,
    referral_draft: 4,
    new_referral: 4,
    last_workspace: 1,
  };
  const ranked = [...items].sort((left, right) =>
    kindRank[right.kind] - kindRank[left.kind]
      || Date.parse(right.updated_at) - Date.parse(left.updated_at),
  );
  const seenReferrals = new Set<number>();
  return ranked.filter((item) => {
    if (!item.referral_id) return true;
    if (seenReferrals.has(item.referral_id)) return false;
    seenReferrals.add(item.referral_id);
    return true;
  });
}
