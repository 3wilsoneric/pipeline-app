import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { getClinicalDataReadiness } from "@/lib/clinical/clinical-data";
import { getExtractionBackendReadiness } from "@/lib/extraction/backend-config";
import { getReferralProgress, type ReferralProgress } from "@/lib/pipeline/referral-progress";
import {
  activeReferralFlowStates,
  referralFlowStateForWorkspaceFocus,
  type ActiveReferralFlowState,
} from "@/lib/pipeline/referral-flow";
import { isAssignedToUser, normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import { scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { referralWorklistBuckets } from "@/lib/pipeline/referral-worklist-filter";
import {
  getReferralStoreReadiness,
  listReferrals,
} from "@/lib/pipeline/referral-store";
import {
  boardStages,
  getStageLabel,
} from "@/lib/pipeline/referral-workflow";
import type { Referral } from "@/lib/pipeline/referral-types";
import {
  hasInitialDocument,
  hasManualIntakeAuthorization,
  resolveReferralWorkflowStatus,
} from "@/lib/pipeline/workflow-status";
import { getReferralWorkflowContexts } from "@/lib/pipeline/workflow-store";
import type { WorkflowContext } from "@/lib/pipeline/workflow-records";
import { isDocumentRequirementType } from "@/lib/pipeline/document-requirements";
import { isRequirementStatusResolved } from "@/lib/pipeline/workspace-state";
import type {
  MyQueueItem,
  MyQueueSnapshot,
  MyQueueUrgency,
  HomeWorkflowSummary,
  OperationsAssessorLoad,
  OperationsRequirementItem,
  OperationsSnapshot,
  OperationsSystemCheck,
  OperationsWorkItem,
  ReferralWorklistBucket,
  ReferralWorklistItem,
  ReferralWorklistSnapshot,
} from "@/lib/pipeline/operations-types";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";
import {
  getResidentLinkStoreReadiness,
  listResidentLinks,
} from "@/lib/pipeline/resident-link-store";
import type { PipelineResidentLink } from "@/lib/pipeline/resident-link-records";
import { getAssessmentCompletionReport } from "@/lib/assessment/assessment-store";
import type { AssessmentCompletionReport } from "@/lib/assessment/assessment-records";
import { listWorkspaceMembers } from "@/lib/pipeline/workspace-members";
import type {
  SupervisorExceptionItem,
  SupervisorExceptionSnapshot,
} from "@/lib/pipeline/operations-types";

export async function getOperationsSnapshot(user?: PipelineUser): Promise<OperationsSnapshot> {
  const operational = await loadOperationalWork(user);
  return buildOperationsSnapshot(operational, null);
}

export async function getOperationsDashboardSnapshot(
  user: PipelineUser,
  includeSupervisorQueue: boolean,
  assessmentReportMonth = currentReportMonth(),
) {
  const operational = await loadOperationalWork(user);
  const assessmentReport = includeSupervisorQueue
    ? await getTeamAssessmentCompletionReport(user, assessmentReportMonth)
    : null;
  return {
    snapshot: buildOperationsSnapshot(operational, assessmentReport),
    supervisorQueue: includeSupervisorQueue
      ? await buildSupervisorExceptionSnapshot(operational)
      : null,
  };
}

function buildOperationsSnapshot(
  operational: Awaited<ReturnType<typeof loadOperationalWork>>,
  assessmentReport: AssessmentCompletionReport | null,
): OperationsSnapshot {
  const {
    activeWork,
    now,
    openRequirements,
    referralReadiness,
    source,
    work,
  } = operational;
  const extractionReadiness = getExtractionBackendReadiness();
  const clinicalReadiness = getClinicalDataReadiness();
  const assessors = buildAssessorLoad(activeWork);
  const funnel = boardStages.map((stage) => ({
    stage,
    label: getStageLabel(stage),
    count: work.filter((item) => item.stage === stage).length,
  }));
  const oldestQueueAgeHours = Math.max(0, ...activeWork.map((item) => item.age_hours));
  recordPipelineMetric("pipeline.queue.oldest_age", oldestQueueAgeHours * 60 * 60 * 1_000, "milliseconds", {
    operation: "operations_snapshot",
    result: source,
  });

  return {
    source,
    generated_at: now.toISOString(),
    metrics: {
      active: activeWork.length,
      open_tasks: openRequirements.length,
      stale: activeWork.filter((item) => item.stale).length,
      unassigned: activeWork.filter((item) => item.owner === "Unassigned").length,
      due_soon: activeWork.filter((item) => item.due_soon).length,
      open_requirements: openRequirements.length,
      overdue_requirements: openRequirements.filter((item) => item.overdue).length,
      decisions_needed: activeWork.filter((item) => ["assessment_signed", "recommendation_submitted", "decision_pending"].includes(item.workflow_status) && !item.has_decision).length,
      client_profiles: null,
      oldest_queue_age_hours: oldestQueueAgeHours,
    },
    work: activeWork
      .sort(compareWork)
      .slice(0, 12),
    requirements: openRequirements
      .sort(compareRequirementWork)
      .slice(0, 20),
    assessors,
    assessment_report: assessmentReport,
    funnel,
    data_quality: {
      missing_owner: activeWork.filter((item) => item.owner === "Unassigned").length,
      missing_packet: activeWork.filter((item) => item.workflow_status === "intake_documents_needed").length,
      missing_assessment: activeWork.filter((item) => ["ready_to_schedule", "assessment_scheduled", "assessment_in_progress", "waiting_for_information", "assessment_ready_to_sign"].includes(item.workflow_status) && !item.assessment_complete).length,
      missing_decision: activeWork.filter((item) => ["assessment_signed", "recommendation_submitted", "decision_pending"].includes(item.workflow_status) && !item.has_decision).length,
    },
    system: [
      storeCheck(referralReadiness),
      backendCheck("Packet extraction", extractionReadiness.ready, extractionReadiness.ready ? "Configured" : "Needs configuration"),
      clinicalCheck(clinicalReadiness),
    ],
  };
}

async function getTeamAssessmentCompletionReport(user: PipelineUser, month: string) {
  const [report, members] = await Promise.all([
    getAssessmentCompletionReport(month),
    listWorkspaceMembers(user),
  ]);
  const rows = new Map(report.rows.map((row) => [
    row.assessor_id ?? `legacy:${row.assessor_name.toLocaleLowerCase()}`,
    row,
  ]));
  for (const member of members) {
    if (!member.roles.some((role) => ["admin", "assessment_coordinator", "reviewer"].includes(role))) continue;
    if (!rows.has(member.principal_id)) {
      rows.set(member.principal_id, {
        assessor_id: member.principal_id,
        assessor_name: member.display_name,
        completed_assessments: 0,
        average_duration_minutes: null,
      });
    }
  }
  const mergedRows = [...rows.values()].sort((left, right) =>
    right.completed_assessments - left.completed_assessments
      || left.assessor_name.localeCompare(right.assessor_name));
  return { ...report, rows: mergedRows };
}

function currentReportMonth() {
  return new Date().toISOString().slice(0, 7);
}

export async function getMyQueueSnapshot(user: { id: string; name: string }): Promise<MyQueueSnapshot> {
  return buildMyQueueSnapshot(await loadOperationalWork(), user);
}

export async function getHomeWorkflowSummary(user: PipelineUser): Promise<HomeWorkflowSummary> {
  const operational = await loadOperationalWork(user);
  const requirementsByReferral = groupRequirementsByReferral(operational.openRequirements);
  const referralsById = new Map(operational.referrals.map((referral) => [referral.id, referral]));
  const workByReferral = new Map(operational.activeWork.map((work) => [work.referral_id, work]));
  const activeItems = operational.activeWork.map((work) =>
    toReferralWorklistItem(
      work,
      referralsById.get(work.referral_id)!,
      requirementsByReferral.get(work.referral_id) ?? [],
    ),
  ).sort(compareReferralWorklistItems);
  const readyToSchedule = activeItems.filter((item) =>
    workByReferral.get(item.referral_id)?.flow_state === "ready_to_schedule",
  );
  const dataCompletion = activeItems.filter((item) =>
    item.missing_data.length > 0 || item.missing_document_count > 0,
  );
  const overallCompletion = operational.activeWork.length === 0
    ? null
    : Math.round(
        operational.activeWork.reduce((total, item) => total + item.completion_pct, 0)
        / operational.activeWork.length,
      );
  const flowCounts = Object.fromEntries(
    activeReferralFlowStates.map(({ key }) => [key, 0]),
  ) as Record<ActiveReferralFlowState, number>;
  for (const item of operational.activeWork) {
    const flowState = item.flow_state;
    if (flowState !== "complete") flowCounts[flowState] += 1;
  }

  return {
    generated_at: operational.now.toISOString(),
    active_total: operational.activeWork.length,
    unassigned_total: operational.activeWork.filter((item) => item.owner === "Unassigned").length,
    overall_completion_pct: overallCompletion,
    flow_counts: flowCounts,
    active_items: activeItems,
    ready_to_schedule: {
      total: readyToSchedule.length,
      items: readyToSchedule.slice(0, 6),
    },
    data_completion: {
      total: dataCompletion.length,
      items: dataCompletion.slice(0, 6),
    },
    current_work: buildMyQueueSnapshot(operational, user),
  };
}

function buildMyQueueSnapshot(
  operational: Awaited<ReturnType<typeof loadOperationalWork>>,
  user: { id: string; name: string },
): MyQueueSnapshot {
  const { activeWork, now, openRequirements, work } = operational;
  const ownedWork = activeWork.filter((item) => item.action_required && isAssignedToUser({
    ownerId: item.owner_id,
    owner: item.owner,
  }, user));
  const ownedRequirements = openRequirements.filter((item) =>
    isAssignedToUser({ ownerId: item.owner_id, owner: item.owner }, user),
  );
  const workByReferral = new Map(ownedWork.map((item) => [item.referral_id, item]));
  const requirementsByReferral = new Map<number, OperationsRequirementItem[]>();

  for (const requirement of ownedRequirements) {
    const current = requirementsByReferral.get(requirement.referral_id) ?? [];
    current.push(requirement);
    requirementsByReferral.set(requirement.referral_id, current);
  }

  const referralIds = new Set([
    ...workByReferral.keys(),
    ...requirementsByReferral.keys(),
  ]);
  const ranked = [...referralIds].flatMap((referralId) => {
    const referralWork = workByReferral.get(referralId) ?? work.find((item) => item.referral_id === referralId);
    if (!referralWork) return [];
    const requirement = [...(requirementsByReferral.get(referralId) ?? [])]
      .sort(compareRequirementWork)[0];
    const urgency = queueUrgency(referralWork, requirement);
    const item: MyQueueItem = {
      id: `referral:${referralId}`,
      referral_id: referralId,
      client_name: referralWork.client_name,
      community: referralWork.community,
      stage: referralWork.stage,
      next_action: requirement?.next_action.trim()
        || requirement?.label
        || referralWork.next_action?.trim()
        || "Review the referral and record the next step.",
      urgency,
      due_at: requirement?.due_at ?? referralWork.assignment_due_at,
    };
    return [{ item, ageHours: referralWork.age_hours }];
  }).sort((left, right) => {
    return queueUrgencyRank(right.item.urgency) - queueUrgencyRank(left.item.urgency)
      || (left.item.due_at ?? "9999").localeCompare(right.item.due_at ?? "9999")
      || right.ageHours - left.ageHours
      || left.item.client_name.localeCompare(right.item.client_name);
  });

  return {
    generated_at: now.toISOString(),
    owner: { id: user.id, name: user.name },
    total: ranked.length,
    items: ranked.slice(0, 25).map(({ item }) => item),
  };
}

export async function getReferralWorklistSnapshot(user?: PipelineUser): Promise<ReferralWorklistSnapshot> {
  const { operational, allItems } = await loadReferralWorklistData(user);
  const buckets = referralWorklistBuckets.map(({ value }) => value);
  const counts = Object.fromEntries(buckets.map((bucket) => [
    bucket,
    allItems.filter((item) => matchesReferralWorklistBucket(item, bucket)).length,
  ])) as Record<ReferralWorklistBucket, number>;

  return {
    generated_at: operational.now.toISOString(),
    total: allItems.length,
    counts,
    items: allItems.slice(0, 500),
  };
}

export async function getReferralWorklistReferrals(
  bucket: ReferralWorklistBucket,
  limit = 200,
  user?: PipelineUser,
) {
  const { operational, allItems, referralsById } = await loadReferralWorklistData(user);
  const selected = allItems.filter((item) => matchesReferralWorklistBucket(item, bucket));
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  return {
    generated_at: operational.now.toISOString(),
    total: selected.length,
    referrals: selected
      .slice(0, boundedLimit)
      .map((item) => referralsById.get(item.referral_id))
      .filter((referral): referral is Referral => Boolean(referral)),
  };
}

async function loadReferralWorklistData(user?: PipelineUser) {
  const operational = await loadOperationalWork(user);
  const referralsById = new Map(operational.referrals.map((referral) => [referral.id, referral]));
  const requirementsByReferral = groupRequirementsByReferral(operational.openRequirements);

  const worklistWork = operational.work.filter((work) =>
    work.action_required || (requirementsByReferral.get(work.referral_id) ?? []).length > 0,
  );
  const allItems = worklistWork.map((work) => {
    const referral = referralsById.get(work.referral_id)!;
    return toReferralWorklistItem(work, referral, requirementsByReferral.get(work.referral_id) ?? []);
  }).sort(compareReferralWorklistItems);
  return { operational, allItems, referralsById };
}

function groupRequirementsByReferral(requirements: OperationsRequirementItem[]) {
  const grouped = new Map<number, OperationsRequirementItem[]>();
  for (const requirement of requirements) {
    grouped.set(requirement.referral_id, [
      ...(grouped.get(requirement.referral_id) ?? []),
      requirement,
    ]);
  }
  return grouped;
}

function matchesReferralWorklistBucket(item: ReferralWorklistItem, bucket: ReferralWorklistBucket) {
  return bucket === "all_actionable" || item.categories.includes(bucket);
}

export async function getSupervisorExceptionSnapshot(): Promise<SupervisorExceptionSnapshot> {
  const operational = await loadOperationalWork();
  return buildSupervisorExceptionSnapshot(operational);
}

async function buildSupervisorExceptionSnapshot(
  operational: Awaited<ReturnType<typeof loadOperationalWork>>,
): Promise<SupervisorExceptionSnapshot> {
  const items: SupervisorExceptionItem[] = [];
  const referralById = new Map(operational.referrals.map((referral) => [referral.id, referral]));

  for (const requirement of operational.openRequirements) {
    if (requirement.overdue) {
      items.push(requirementException(requirement, "overdue_requirement", "critical", "Requirement is overdue"));
    } else if (requirement.unassigned) {
      items.push(requirementException(requirement, "unassigned_requirement", "attention", "Requirement has no owner"));
    }
  }
  for (const work of operational.activeWork) {
    if (work.owner === "Unassigned") items.push(workException(work, "unassigned_referral", "critical", "Referral has no owner"));
    if (work.assignment_overdue) items.push(workException(work, "assignment_overdue", "critical", "Assigned referral is overdue"));
    if (work.blocker_count > 0) items.push(workException(work, "blocked_referral", "critical", "Referral is blocked"));
    if (work.stale) items.push(workException(work, "stale_referral", "attention", "Referral has gone stale"));
    if (["assessment_signed", "recommendation_submitted", "decision_pending"].includes(work.workflow_status) && !work.has_decision) {
      items.push(workException(work, "decision_needed", "attention", "Admission decision is needed"));
    }
    const referral = referralById.get(work.referral_id);
    if (referral?.packetStatus === "failed") {
      items.push(workException(work, "extraction_failed", "critical", "Packet extraction failed"));
    } else if (referral?.packetFields?.some((field) => field.is_conflict)) {
      items.push(workException(work, "extraction_conflict", "attention", "Extracted fields need conflict review"));
    }
  }

  // Accepted referrals leave active work, but a failed downstream handoff still
  // needs an owner and recovery path until it is retried or resolved.
  for (const work of operational.work) {
    const referral = referralById.get(work.referral_id);
    if (referral?.ehrHandoff?.status === "failed") {
      items.push(workException(work, "ehr_handoff_failed", "critical", "EHR handoff failed", referral.ehrHandoff.failureReason));
    }
  }

  const candidateLinks = await loadCandidateResidentLinks();
  const collisionIds = residentLinkCollisionIds(candidateLinks);
  for (const link of candidateLinks) {
    const referral = link.referral_id ? referralById.get(link.referral_id) : undefined;
    const collision = collisionIds.has(link.link_id);
    items.push({
      id: `${collision ? "resident_link_collision" : "resident_link_candidate"}:${link.link_id}`,
      kind: collision ? "resident_link_collision" : "resident_link_candidate",
      severity: collision ? "critical" : "review",
      label: collision ? "Resident link collision needs review" : "Resident link needs confirmation",
      detail: collision
        ? "More than one active candidate points at the same client or governed resident key."
        : "Confirm or reject the proposed Alamo roster link.",
      referral_id: link.referral_id,
      resident_link_id: link.link_id,
      client_name: referral?.name ?? null,
      community: referral?.community ?? link.community_id,
      owner: referral?.owner ?? null,
      due_at: null,
      age_hours: ageHours(link.updated_at, operational.now),
    });
  }

  const sorted = dedupeExceptions(items).sort(compareSupervisorExceptions);
  const counts: SupervisorExceptionSnapshot["counts"] = {};
  for (const item of sorted) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  recordPipelineMetric("pipeline.queue.supervisor_exceptions", sorted.length, "count", {
    operation: "supervisor_queue",
    result: sorted.length > 0 ? "attention" : "clear",
  });
  return {
    generated_at: operational.now.toISOString(),
    total: sorted.length,
    counts,
    items: sorted.slice(0, 250),
  };
}

async function loadOperationalWork(user?: PipelineUser) {
  const referralReadiness = getReferralStoreReadiness();
  let referrals: Referral[] = [];
  let source: OperationsSnapshot["source"] = "unavailable";

  if (referralReadiness.ready) {
    referrals = await loadOperationalReferrals(user);
    source = "referral_store";
  }

  const now = new Date();
  const workflowContexts = await getReferralWorkflowContexts(referrals);
  const progressByReferral = new Map(referrals.map((referral) => [
    referral.id,
    getReferralProgress(referral, workflowContexts.get(referral.id)),
  ]));
  const work = referrals.map((referral) =>
    toWorkItem(referral, now, workflowContexts.get(referral.id), progressByReferral.get(referral.id)!),
  );
  const activeWork = work.filter((item) => item.flow_state !== "complete");
  const requirements = referrals.flatMap((referral) =>
    toRequirementWork(
      referral,
      workflowContexts.get(referral.id),
      progressByReferral.get(referral.id)!,
      now,
    ),
  );
  const openRequirements = requirements.filter((item) => !isRequirementStatusResolved(item.status));

  return {
    activeWork,
    now,
    openRequirements,
    referralReadiness,
    source,
    work,
    referrals,
  };
}

async function loadCandidateResidentLinks() {
  if (!getResidentLinkStoreReadiness().ready) return [];
  const links: PipelineResidentLink[] = [];
  let cursor: string | undefined;
  do {
    const page = await listResidentLinks({ status: "candidate", limit: 200, cursor });
    links.push(...page.links);
    cursor = page.next_cursor ?? undefined;
  } while (cursor && links.length < 5_000);
  if (cursor) {
    throw new Error("The resident-link candidate queue exceeded its safe reporting capacity.");
  }
  return links;
}

function residentLinkCollisionIds(links: PipelineResidentLink[]) {
  const byClient = groupLinks(links, (link) => link.pipeline_client_id);
  const byResident = groupLinks(links, (link) => `${link.community_id}:${link.resident_key}`);
  return new Set(
    [...byClient.values(), ...byResident.values()]
      .filter((group) => group.length > 1)
      .flatMap((group) => group.map((link) => link.link_id)),
  );
}

function groupLinks(links: PipelineResidentLink[], key: (link: PipelineResidentLink) => string) {
  const groups = new Map<string, PipelineResidentLink[]>();
  for (const link of links) groups.set(key(link), [...(groups.get(key(link)) ?? []), link]);
  return groups;
}

function requirementException(
  item: OperationsRequirementItem,
  kind: SupervisorExceptionItem["kind"],
  severity: SupervisorExceptionItem["severity"],
  label: string,
): SupervisorExceptionItem {
  return {
    id: `${kind}:${item.work_item_id}`,
    kind,
    severity,
    label,
    detail: item.next_action || item.label,
    referral_id: item.referral_id,
    resident_link_id: null,
    client_name: item.client_name,
    community: item.community,
    owner: item.owner,
    due_at: item.due_at,
    age_hours: null,
  };
}

function workException(
  item: OperationsWorkItem,
  kind: SupervisorExceptionItem["kind"],
  severity: SupervisorExceptionItem["severity"],
  label: string,
  detail?: string,
): SupervisorExceptionItem {
  return {
    id: `${kind}:${item.referral_id}`,
    kind,
    severity,
    label,
    detail: detail?.trim() || item.next_action || "Review the referral and record the next step.",
    referral_id: item.referral_id,
    resident_link_id: null,
    client_name: item.client_name,
    community: item.community,
    owner: item.owner,
    due_at: item.assignment_due_at,
    age_hours: item.age_hours,
  };
}

function dedupeExceptions(items: SupervisorExceptionItem[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function compareSupervisorExceptions(left: SupervisorExceptionItem, right: SupervisorExceptionItem) {
  const rank = { critical: 3, attention: 2, review: 1 };
  return rank[right.severity] - rank[left.severity]
    || (left.due_at ?? "9999").localeCompare(right.due_at ?? "9999")
    || (right.age_hours ?? 0) - (left.age_hours ?? 0)
    || left.label.localeCompare(right.label);
}

function ageHours(value: string, now: Date) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : Math.max(0, Math.round(((now.getTime() - date.getTime()) / 36e5) * 10) / 10);
}

function queueUrgency(
  work: OperationsWorkItem,
  requirement?: OperationsRequirementItem,
): MyQueueUrgency {
  if (requirement?.overdue) return "overdue";
  if (work.assignment_overdue) return "overdue";
  if (work.blocker_count > 0) return "blocked";
  if (requirement?.due_soon || work.due_soon) return "due_soon";
  if (work.stale) return "stale";
  return "normal";
}

function queueUrgencyRank(urgency: MyQueueUrgency) {
  return {
    overdue: 5,
    blocked: 4,
    due_soon: 3,
    stale: 2,
    normal: 1,
  }[urgency];
}

function toWorkItem(
  referral: Referral,
  now: Date,
  context?: WorkflowContext,
  progress = getReferralProgress(referral, context),
): OperationsWorkItem {
  const updatedAt = new Date(referral.updatedAt ?? referral.createdAt);
  const ageHours = Number.isNaN(updatedAt.getTime())
    ? 0
    : Math.max(0, Math.round(((now.getTime() - updatedAt.getTime()) / 36e5) * 10) / 10);
  const staleLimit = referral.priority === "urgent" ? 12 : referral.priority === "high" ? 24 : 48;
  const assessmentDate = context?.assessmentDate ?? referral.assessment?.scheduledDate;
  const assessmentTime = assessmentDate ? new Date(`${assessmentDate}T12:00:00`) : null;
  const dueSoon = Boolean(
    assessmentTime &&
      !Number.isNaN(assessmentTime.getTime()) &&
      !(context?.assessmentComplete ?? referral.assessment?.completedAt) &&
      assessmentTime.getTime() <= now.getTime() + 72 * 36e5,
  );
  const normalizedOwner = normalizeOwnerName(referral.owner);
  const storedWorkflowStatus = referral.workflowStatus ?? resolveReferralWorkflowStatus(referral);
  const workflowStatus = !["accepted", "declined", "closed"].includes(storedWorkflowStatus)
    && (normalizedOwner === "Unassigned" || !referral.ownerId?.trim())
      ? "intake_unassigned"
      : storedWorkflowStatus;
  const flowState = referralFlowStateForWorkspaceFocus(progress.state.focus);
  const assignmentDeadlineApplies = [
    "intake_unassigned",
    "intake_documents_needed",
    "profile_incomplete",
    "ready_to_schedule",
  ].includes(workflowStatus);
  const assignmentDueTime = referral.assignmentDueAt ? new Date(referral.assignmentDueAt).getTime() : Number.NaN;
  const assignmentOverdue = assignmentDeadlineApplies && Number.isFinite(assignmentDueTime) && assignmentDueTime < now.getTime();
  const assignmentDueSoon = assignmentDeadlineApplies && Number.isFinite(assignmentDueTime)
    && assignmentDueTime >= now.getTime()
    && assignmentDueTime <= now.getTime() + 72 * 36e5;
  return {
    referral_id: referral.id,
    client_id: referral.clientId,
    client_name: referral.name,
    community: referral.community,
    stage: referral.stage,
    workflow_status: workflowStatus,
    flow_state: flowState,
    assignment_state: progress.state.assignment,
    assessment_state: progress.state.assessment,
    outcome_state: progress.state.outcome,
    document_state: progress.state.documents,
    profile_state: progress.state.profile,
    assessment_is_reassessment: progress.state.assessment_is_reassessment,
    owner_id: referral.ownerId,
    owner: normalizedOwner,
    priority: referral.priority,
    blocker_count: progress.blockers.length,
    blockers: progress.blockers,
    missing_data: progress.open_items,
    next_action: progress.next_action,
    action_required: progress.action_required,
    waiting: progress.waiting,
    age_hours: ageHours,
    stale: ageHours > staleLimit,
    due_soon: dueSoon || assignmentDueSoon,
    assignment_due_at: assignmentDeadlineApplies && Number.isFinite(assignmentDueTime)
      ? new Date(assignmentDueTime).toISOString()
      : null,
    assignment_overdue: assignmentOverdue,
    assessment_date: assessmentDate ?? undefined,
    assessment_complete: Boolean(context?.assessmentComplete ?? referral.assessment?.completedAt),
    has_decision: Boolean(context?.decision ?? referral.admissionDecision),
    completion_pct: progress.overall.percent,
  };
}

async function loadOperationalReferrals(user?: PipelineUser) {
  const scope = user ? scopeReferralListOptions(user, {}) : {};
  const [active, accepted, reassessments] = await Promise.all([
    loadReferralPages({ ...scope, activeOnly: true }),
    loadReferralPages({ ...scope, stage: "Accepted / Admitted" }),
    loadReferralPages({ ...scope, postOutcomeAssessment: true }),
  ]);
  return [
    ...new Map(
      [...active, ...accepted, ...reassessments].map((referral) => [referral.id, referral]),
    ).values(),
  ];
}

async function loadReferralPages(
  filter: Parameters<typeof listReferrals>[0],
) {
  const referrals: Referral[] = [];
  let cursor: string | undefined;

  do {
    const page = await listReferrals({ ...filter, limit: 200, cursor, includeTotal: false });
    referrals.push(...page.referrals);
    cursor = page.next_cursor;
  } while (cursor && referrals.length < 5_000);

  if (cursor) {
    throw new Error("The operational workspace report exceeded its safe reporting capacity.");
  }

  return referrals;
}

function toRequirementWork(
  referral: Referral,
  context: WorkflowContext | undefined,
  progress: ReferralProgress,
  now: Date,
): OperationsRequirementItem[] {
  const activeRequirementIds = new Set(progress.state.active_requirement_ids);
  return (context?.requirements ?? referral.requirements ?? [])
    .filter((requirement) => activeRequirementIds.has(requirement.id))
    .map((requirement) => {
      const dueTime = requirement.dueAt ? new Date(requirement.dueAt).getTime() : Number.NaN;
      const isOpen = !isRequirementStatusResolved(requirement.status);
      return {
        work_item_id: requirement.id,
        version: requirement.version ?? 1,
        referral_id: referral.id,
        client_name: referral.name,
        community: referral.community,
        label: requirement.label,
        status: requirement.status,
        owner_id: requirement.ownerId,
        owner: normalizeOwnerName(requirement.owner),
        due_at: Number.isFinite(dueTime) ? new Date(dueTime).toISOString() : null,
        next_action: requirement.nextStep,
        evidence_document_name: requirement.evidenceDocumentName ?? null,
        overdue: isOpen && Number.isFinite(dueTime) && dueTime < now.getTime(),
        due_soon: isOpen && Number.isFinite(dueTime) && dueTime >= now.getTime() && dueTime <= now.getTime() + 72 * 36e5,
        unassigned: normalizeOwnerName(requirement.owner) === "Unassigned",
        type: requirement.type,
        blocker: requirement.blocker,
      };
    });
}

function toReferralWorklistItem(
  work: OperationsWorkItem,
  referral: Referral,
  requirements: OperationsRequirementItem[],
): ReferralWorklistItem {
  const categories: ReferralWorklistItem["categories"] = [];
  const missingDocuments = requirements.filter((requirement) =>
    isDocumentRequirementType(requirement.type),
  );
  const extractionConflict = Boolean(referral.packetFields?.some((field) => field.is_conflict));
  const explicitBlocked = referral.packetStatus === "failed"
    || extractionConflict
    || requirements.some((requirement) => requirement.blocker && (requirement.overdue || requirement.status === "expired"));

  if (work.assignment_state === "unassigned") categories.push("unassigned");
  if (work.outcome_state === "pending" && ["New", "Packet Needed", "Packet Review"].includes(work.stage)) {
    categories.push("packet_review");
  }
  if (["scheduled", "assessment"].includes(work.flow_state)) categories.push("assessment_due");
  if (work.outcome_state === "pending" && ["ready_to_sign", "signed"].includes(work.assessment_state)) {
    categories.push("decision_needed");
  }
  if (work.document_state !== "complete" || missingDocuments.length > 0) categories.push("missing_documents");
  if (work.flow_state === "complete_chart") categories.push("follow_up");
  if (explicitBlocked) categories.push("blocked");

  const primaryOrder: ReferralWorklistItem["categories"] = [
    "blocked",
    "unassigned",
    "decision_needed",
    "assessment_due",
    "packet_review",
    "missing_documents",
    "follow_up",
  ];
  const primaryCategory = primaryOrder.find((category) => categories.includes(category)) ?? "follow_up";
  if (categories.length === 0) categories.push(primaryCategory);
  const orderedRequirements = [...requirements].sort(compareRequirementWork);
  const nextRequirement = orderedRequirements[0];
  const dueAt = orderedRequirements
    .map((requirement) => requirement.due_at)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
  const urgency: MyQueueUrgency = orderedRequirements.some((requirement) => requirement.overdue)
    ? "overdue"
    : explicitBlocked
      ? "blocked"
      : work.due_soon || orderedRequirements.some((requirement) => requirement.due_soon)
        ? "due_soon"
        : work.stale
          ? "stale"
          : "normal";
  const nextAction = referral.packetStatus === "failed"
    ? "Retry packet extraction"
    : extractionConflict
      ? "Resolve conflicting extracted values"
      : work.next_action?.trim() || nextRequirement?.next_action.trim() || nextRequirement?.label || "Review the referral and record the next step";

  return {
    referral_id: work.referral_id,
    client_name: work.client_name,
    community: referral.community,
    stage: work.stage,
    workflow_status: work.workflow_status,
    flow_state: work.flow_state,
    assignment_state: work.assignment_state,
    assessment_state: work.assessment_state,
    outcome_state: work.outcome_state,
    document_state: work.document_state,
    profile_state: work.profile_state,
    assessment_is_reassessment: work.assessment_is_reassessment,
    owner: work.owner,
    priority: work.priority,
    categories,
    primary_category: primaryCategory,
    next_action: nextAction,
    blockers: work.blockers,
    missing_data: work.missing_data,
    urgency,
    due_at: dueAt,
    last_activity_at: referral.updatedAt ?? referral.createdAt,
    age_hours: work.age_hours,
    completion_pct: work.completion_pct,
    missing_document_count: missingDocuments.length + Number(
      !hasInitialDocument(referral) && !hasManualIntakeAuthorization(referral),
    ),
  };
}

function compareReferralWorklistItems(left: ReferralWorklistItem, right: ReferralWorklistItem) {
  return queueUrgencyRank(right.urgency) - queueUrgencyRank(left.urgency)
    || priorityRank(right.priority) - priorityRank(left.priority)
    || (left.due_at ?? "9999").localeCompare(right.due_at ?? "9999")
    || right.age_hours - left.age_hours
    || left.client_name.localeCompare(right.client_name);
}

function priorityRank(priority: string) {
  return priority === "urgent" ? 3 : priority === "high" ? 2 : 1;
}

function buildAssessorLoad(work: OperationsWorkItem[]): OperationsAssessorLoad[] {
  const byOwner = new Map<string, OperationsAssessorLoad>();
  for (const item of work) {
    if (item.owner === "Unassigned") continue;
    const current = byOwner.get(item.owner) ?? { owner: item.owner, active: 0, blocked: 0, stale: 0, due_soon: 0 };
    current.active += 1;
    if (item.blocker_count > 0) current.blocked += 1;
    if (item.stale) current.stale += 1;
    if (item.due_soon) current.due_soon += 1;
    byOwner.set(item.owner, current);
  }
  return [...byOwner.values()].sort((left, right) => right.active - left.active || left.owner.localeCompare(right.owner));
}

function compareWork(left: OperationsWorkItem, right: OperationsWorkItem) {
  return Number(right.stale) - Number(left.stale)
    || Number(right.due_soon) - Number(left.due_soon)
    || right.blocker_count - left.blocker_count
    || right.age_hours - left.age_hours;
}

function compareRequirementWork(left: OperationsRequirementItem, right: OperationsRequirementItem) {
  return Number(right.overdue) - Number(left.overdue)
    || Number(right.unassigned) - Number(left.unassigned)
    || Number(right.due_soon) - Number(left.due_soon)
    || (left.due_at ?? "9999").localeCompare(right.due_at ?? "9999")
    || left.label.localeCompare(right.label);
}

function storeCheck(readiness: ReturnType<typeof getReferralStoreReadiness>): OperationsSystemCheck {
  if (!readiness.ready) return { label: "Referral data", status: "attention", detail: readiness.message ?? "Unavailable" };
  return {
    label: "Referral data",
    status: readiness.multi_instance_safe ? "ready" : "attention",
    detail: readiness.multi_instance_safe ? "Connected" : "Local single-instance mode",
  };
}

function backendCheck(label: string, ready: boolean, detail: string): OperationsSystemCheck {
  return { label, status: ready ? "ready" : "attention", detail };
}

function clinicalCheck(readiness: ReturnType<typeof getClinicalDataReadiness>): OperationsSystemCheck {
  if (readiness.mode === "demo_snapshot") {
    return {
      label: "Clinical roster",
      status: readiness.ready ? "attention" : "not_connected",
      detail: readiness.ready ? "One-time demo snapshot" : "Demo snapshot unavailable",
    };
  }
  if (!readiness.required) return { label: "Clinical roster", status: "not_connected", detail: "Not connected" };
  return {
    label: "Clinical roster",
    status: readiness.ready ? "ready" : "attention",
    detail: readiness.ready ? "Fresh" : "Needs attention",
  };
}
