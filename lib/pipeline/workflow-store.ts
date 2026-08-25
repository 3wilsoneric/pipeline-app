import "server-only";

import { randomUUID } from "node:crypto";

import type { TransactionSql } from "postgres";

import { getAssessment, listAssessments } from "@/lib/assessment/assessment-store";
import { pickAssessmentToolData, type AssessmentToolData } from "@/lib/assessment/assessment-tool-schema";
import type { AssessmentWorkflowStatus, PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import {
  getReferral,
  getReferralStoreReadiness,
  patchReferral,
  type ReferralActor,
  type ReferralMutation,
} from "@/lib/pipeline/referral-store";
import type {
  AdmissionDecision,
  AdmissionRequirement,
  AssessmentRecommendation,
  EhrHandoffRecord,
  Referral,
} from "@/lib/pipeline/referral-types";
import { normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import { normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import type {
  AdmissionDecisionInput,
  AssessmentRecommendationInput,
  WorkflowContext,
  WorkItemPatch,
} from "@/lib/pipeline/workflow-records";

export type ReferralWorkflowSnapshot = {
  referral: Referral;
  context: WorkflowContext;
  work_items: AdmissionRequirement[];
  decision: AdmissionDecision | null;
  recommendation: AssessmentRecommendation | null;
};

export type WorkflowRecordMutation<T> =
  | { ok: true; record: T; referral: Referral }
  | { ok: false; conflict: true; referral: Referral; record?: T }
  | { ok: false; blocked: true; referral: Referral; blockers: { code: string; label: string }[] };

type WorkItemRow = {
  work_item_id: string;
  type: AdmissionRequirement["type"];
  label: string;
  gate: AdmissionRequirement["requiredFor"];
  status: AdmissionRequirement["status"];
  owner_id: string | null;
  owner_name: string | null;
  due_at: Date | string | null;
  next_action: string;
  blocker: boolean;
  evidence_document_id: string | null;
  evidence_document_name: string | null;
  waiver_reason: string | null;
  field_key: string | null;
  requested_from: string | null;
  requested_at: Date | string | null;
  follow_up_at: Date | string | null;
  unavailable_reason: string | null;
  version: number;
  updated_at: Date | string;
};

type DecisionRow = {
  decision_id: string;
  outcome: AdmissionDecision["outcome"];
  reason_code: string | null;
  reason_note: string | null;
  decided_by: string;
  decided_by_name: string;
  decided_at: Date | string;
  version: number;
  recommendation_id: string | null;
  decided_by_role: string | null;
};

type RecommendationRow = {
  recommendation_id: string;
  referral_id: number | string;
  assessment_id: string;
  outcome: AssessmentRecommendation["outcome"];
  reason_code: string | null;
  reason_note: string;
  recommended_by: string;
  recommended_by_name: string;
  recommended_at: Date | string;
  version: number;
};

export async function getReferralWorkflowSnapshot(referralId: number): Promise<ReferralWorkflowSnapshot | null> {
  const referral = await getReferral(referralId);
  if (!referral) return null;

  if (getReferralStoreReadiness().mode !== "postgres") {
    const assessments = await listAssessments({ referralId, limit: 100 });
    const latestAssessment = assessments.assessments[0] ?? null;
    const decision = referral.admissionDecision ?? legacyDecision(referral);
    const recommendation = referral.assessmentRecommendation ?? null;
    const workItems = referral.requirements ?? [];
    return {
      referral,
      work_items: workItems,
      decision,
      recommendation,
      context: {
        assessmentExists: Boolean(latestAssessment) || Boolean(referral.assessment),
        assessmentComplete: latestAssessment ? latestAssessment.status === "complete" : Boolean(referral.assessment?.completedAt),
        assessmentSigned: Boolean(latestAssessment?.signed_at),
        assessmentStarted: Boolean(latestAssessment?.started_at),
        assessmentScheduleStatus: latestAssessment?.schedule_status ?? null,
        assessmentDate: latestAssessment?.assessment_date ?? referral.assessment?.scheduledDate ?? null,
        assessmentStatus: latestAssessment?.status ?? null,
        assessmentData: latestAssessment ? pickAssessmentToolData(latestAssessment) : null,
        requirements: workItems,
        decision,
        recommendation,
      },
    };
  }

  const sql = getPipelineSql();
  const [workItemRows, decisionRows, recommendationRows, assessmentRows] = await Promise.all([
    sql<WorkItemRow[]>`
      select work_item_id, type, label, gate, status, owner_id, owner_name, due_at,
             next_action, blocker, evidence_document_id, evidence_document_name, waiver_reason,
             field_key, requested_from, requested_at, follow_up_at, unavailable_reason,
             version, updated_at
      from pipeline.work_items
      where referral_id = ${referralId}
      order by created_at, work_item_id
    `,
    sql<DecisionRow[]>`
      select decision_id, outcome, reason_code, reason_note, decided_by,
             decided_by_name, decided_at, version, recommendation_id, decided_by_role
      from pipeline.admission_decisions
      where referral_id = ${referralId}
      limit 1
    `,
    sql<RecommendationRow[]>`
      select recommendation_id, referral_id, assessment_id, outcome, reason_code,
             reason_note, recommended_by, recommended_by_name, recommended_at, version
      from pipeline.assessment_recommendations
      where referral_id = ${referralId}
      order by recommended_at desc, recommendation_id desc
      limit 1
    `,
    sql<{ status: AssessmentWorkflowStatus; assessment_date: Date | string | null; signed_at: Date | string | null; started_at: Date | string | null; schedule_status: PipelineAssessmentRecord["schedule_status"]; data: AssessmentToolData }[]>`
      select status, assessment_date, signed_at, started_at, schedule_status, data
      from pipeline.assessments
      where referral_id = ${referralId}
      order by updated_at desc, assessment_id desc
      limit 1
    `,
  ]);
  const workItems = workItemRows.length > 0 ? workItemRows.map(mapWorkItem) : referral.requirements ?? [];
  const decision = decisionRows[0] ? mapDecision(decisionRows[0]) : referral.admissionDecision ?? legacyDecision(referral);
  const recommendation = recommendationRows[0]
    ? mapRecommendation(recommendationRows[0])
    : referral.assessmentRecommendation ?? null;

  const latestAssessment = assessmentRows[0] ?? null;
  return {
    referral,
    work_items: workItems,
    decision,
    recommendation,
    context: {
      assessmentExists: Boolean(latestAssessment) || Boolean(referral.assessment),
      assessmentComplete: latestAssessment ? latestAssessment.status === "complete" : Boolean(referral.assessment?.completedAt),
      assessmentSigned: Boolean(latestAssessment?.signed_at),
      assessmentStarted: Boolean(latestAssessment?.started_at),
      assessmentScheduleStatus: latestAssessment?.schedule_status ?? null,
      assessmentDate: latestAssessment?.assessment_date ? toIso(latestAssessment.assessment_date).slice(0, 10) : referral.assessment?.scheduledDate ?? null,
      assessmentStatus: latestAssessment?.status ?? null,
      assessmentData: latestAssessment ? pickAssessmentToolData(latestAssessment.data) : null,
      requirements: workItems,
      decision,
      recommendation,
    },
  };
}

export async function getReferralWorkflowContexts(referrals: Referral[]) {
  const contexts = new Map<number, WorkflowContext>();
  if (referrals.length === 0) return contexts;

  if (getReferralStoreReadiness().mode !== "postgres") {
    const snapshots = await Promise.all(referrals.map((referral) => getReferralWorkflowSnapshot(referral.id)));
    for (const snapshot of snapshots) {
      if (snapshot) contexts.set(snapshot.referral.id, snapshot.context);
    }
    return contexts;
  }

  const ids = referrals.map((referral) => referral.id);
  const sql = getPipelineSql();
  const [workItemRows, decisionRows, recommendationRows, assessmentRows] = await Promise.all([
    sql<(WorkItemRow & { referral_id: number | string })[]>`
      select referral_id, work_item_id, type, label, gate, status, owner_id, owner_name, due_at,
             next_action, blocker, evidence_document_id, evidence_document_name, waiver_reason,
             field_key, requested_from, requested_at, follow_up_at, unavailable_reason,
             version, updated_at
      from pipeline.work_items where referral_id = any(${ids}::bigint[])
      order by referral_id, created_at, work_item_id
    `,
    sql<(DecisionRow & { referral_id: number | string })[]>`
      select referral_id, decision_id, outcome, reason_code, reason_note, decided_by,
             decided_by_name, decided_at, version, recommendation_id, decided_by_role
      from pipeline.admission_decisions where referral_id = any(${ids}::bigint[])
    `,
    sql<RecommendationRow[]>`
      select distinct on (referral_id) recommendation_id, referral_id, assessment_id,
             outcome, reason_code, reason_note, recommended_by, recommended_by_name,
             recommended_at, version
      from pipeline.assessment_recommendations
      where referral_id = any(${ids}::bigint[])
      order by referral_id, recommended_at desc, recommendation_id desc
    `,
    sql<{ referral_id: number | string; status: AssessmentWorkflowStatus; assessment_date: Date | string | null; signed_at: Date | string | null; started_at: Date | string | null; schedule_status: PipelineAssessmentRecord["schedule_status"]; data: AssessmentToolData }[]>`
      select distinct on (referral_id) referral_id, status, assessment_date, signed_at, started_at, schedule_status, data
      from pipeline.assessments
      where referral_id = any(${ids}::bigint[])
      order by referral_id, updated_at desc, assessment_id desc
    `,
  ]);
  const workItemsByReferral = groupRowsByReferral(workItemRows);
  const decisionsByReferral = indexRowsByReferral(decisionRows);
  const recommendationsByReferral = indexRowsByReferral(recommendationRows);
  const assessmentsByReferral = indexRowsByReferral(assessmentRows);

  for (const referral of referrals) {
    const workItems = (workItemsByReferral.get(referral.id) ?? []).map(mapWorkItem);
    const decisionRow = decisionsByReferral.get(referral.id);
    const assessmentRow = assessmentsByReferral.get(referral.id);
    const recommendationRow = recommendationsByReferral.get(referral.id);
    contexts.set(referral.id, {
      assessmentExists: Boolean(assessmentRow) || Boolean(referral.assessment),
      assessmentComplete: assessmentRow ? assessmentRow.status === "complete" : Boolean(referral.assessment?.completedAt),
      assessmentSigned: Boolean(assessmentRow?.signed_at),
      assessmentStarted: Boolean(assessmentRow?.started_at),
      assessmentScheduleStatus: assessmentRow?.schedule_status ?? null,
      assessmentDate: assessmentRow?.assessment_date ? toIso(assessmentRow.assessment_date).slice(0, 10) : referral.assessment?.scheduledDate ?? null,
      assessmentStatus: assessmentRow?.status ?? null,
      assessmentData: assessmentRow ? pickAssessmentToolData(assessmentRow.data) : null,
      requirements: workItems.length > 0 ? workItems : referral.requirements ?? [],
      decision: decisionRow ? mapDecision(decisionRow) : referral.admissionDecision ?? legacyDecision(referral),
      recommendation: recommendationRow
        ? mapRecommendation(recommendationRow)
        : referral.assessmentRecommendation ?? null,
    });
  }
  return contexts;
}

function groupRowsByReferral<T extends { referral_id: number | string }>(rows: T[]) {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const referralId = Number(row.referral_id);
    grouped.set(referralId, [...(grouped.get(referralId) ?? []), row]);
  }
  return grouped;
}

function indexRowsByReferral<T extends { referral_id: number | string }>(rows: T[]) {
  return new Map(rows.map((row) => [Number(row.referral_id), row]));
}

export async function transitionReferral(
  referralId: number,
  targetStage: Referral["stage"],
  expectedVersion: number,
  expectedWorkflowVersion: number,
  actor: ReferralActor,
): Promise<ReferralMutation | null> {
  return patchReferral(
    referralId,
    {
      stage: targetStage,
      ...(targetStage === "Accepted / Admitted" ? { workflowStatus: "accepted" as const } : {}),
      ...(targetStage === "Declined" ? { workflowStatus: "declined" as const } : {}),
    },
    expectedVersion,
    actor,
    { workflow: expectedWorkflowVersion },
  );
}

export async function recordAssessmentRecommendation(
  referralId: number,
  input: AssessmentRecommendationInput,
  expectedVersion: number,
  expectedDecisionVersion: number,
  actor: ReferralActor,
  options: { allowSupervisorOverride?: boolean } = {},
): Promise<WorkflowRecordMutation<AssessmentRecommendation> | null> {
  const snapshot = await getReferralWorkflowSnapshot(referralId);
  if (!snapshot) return null;
  if (normalizeReferralSectionVersions(snapshot.referral.sectionVersions).decision !== expectedDecisionVersion) {
    return { ok: false, conflict: true, referral: snapshot.referral, record: snapshot.recommendation ?? undefined };
  }
  if (snapshot.decision) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "decision_already_recorded", label: "The supervisor decision has already been recorded." }],
    };
  }
  const assessment = await getAssessment(input.assessmentId);
  if (!assessment || assessment.referral_id !== referralId || !assessment.signed_at) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "signed_assessment_required", label: "Sign the assessment before submitting a recommendation." }],
    };
  }
  if (assessment.assessor_id !== actor.id && !options.allowSupervisorOverride) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "assigned_assessor_required", label: "Only the assigned assessor or a supervisor can submit this recommendation." }],
    };
  }
  if (input.outcome !== "accept" && !input.reasonNote?.trim()) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "recommendation_reason_required", label: "Record the clinical reason for this recommendation." }],
    };
  }

  if (getReferralStoreReadiness().mode !== "postgres") {
    const recommendation: AssessmentRecommendation = {
      recommendationId: snapshot.recommendation?.recommendationId ?? randomUUID(),
      assessmentId: input.assessmentId,
      outcome: input.outcome,
      reasonCode: input.reasonCode?.trim() ?? "",
      reasonNote: input.reasonNote?.trim() ?? "",
      recommendedBy: actor.id,
      recommendedByName: actor.name,
      recommendedAt: new Date().toISOString(),
      version: (snapshot.recommendation?.version ?? 0) + 1,
    };
    const mutation = await patchReferral(
      referralId,
      { assessmentRecommendation: recommendation, workflowStatus: "decision_pending" },
      expectedVersion,
      actor,
      { decision: expectedDecisionVersion, workflow: normalizeReferralSectionVersions(snapshot.referral.sectionVersions).workflow },
      { auditAction: "assessment_recommendation_submitted" },
    );
    if (!mutation) return null;
    if (!mutation.ok) {
      if ("conflict" in mutation) return { ok: false, conflict: true, referral: mutation.referral, record: snapshot.recommendation ?? undefined };
      return { ok: false, blocked: true, referral: mutation.referral, blockers: mutation.blockers };
    }
    return { ok: true, record: recommendation, referral: mutation.referral };
  }

  const sql = getPipelineSql();
  const result = await sql.begin(async (tx) => recordPostgresRecommendation(
    tx,
    referralId,
    input,
    expectedVersion,
    expectedDecisionVersion,
    actor,
    snapshot.referral,
    options,
  ));
  if (!result.ok) return result;
  const referral = await getReferral(referralId);
  return referral ? { ok: true, record: result.record, referral } : null;
}

export async function recordAdmissionDecision(
  referralId: number,
  input: AdmissionDecisionInput,
  expectedVersion: number,
  expectedDecisionVersion: number,
  actor: ReferralActor,
): Promise<WorkflowRecordMutation<AdmissionDecision> | null> {
  const snapshot = await getReferralWorkflowSnapshot(referralId);
  if (!snapshot) return null;
  if (normalizeReferralSectionVersions(snapshot.referral.sectionVersions).decision !== expectedDecisionVersion) {
    return { ok: false, conflict: true, referral: snapshot.referral, record: snapshot.decision ?? undefined };
  }
  if (!snapshot.context.assessmentSigned) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "assessment_required", label: "Sign the assessment before recording the admission decision." }],
    };
  }
  if (!snapshot.recommendation && !input.overrideReason?.trim()) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "recommendation_required", label: "An assessor recommendation is required, or the supervisor must record an override reason." }],
    };
  }
  if (input.outcome === "declined" && !input.reasonNote?.trim()) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "decline_reason_required", label: "Record why there will be no admission." }],
    };
  }

  if (getReferralStoreReadiness().mode !== "postgres") {
    const now = new Date().toISOString();
    const decision: AdmissionDecision = {
      decisionId: snapshot.decision?.decisionId ?? randomUUID(),
      outcome: input.outcome,
      reasonCode: input.reasonCode?.trim() ?? "",
      reasonNote: input.reasonNote?.trim() ?? "",
      decidedBy: actor.id,
      decidedByName: actor.name,
      decidedAt: now,
      version: (snapshot.decision?.version ?? 0) + 1,
      recommendationId: snapshot.recommendation?.recommendationId,
      decidedByRole: input.decidedByRole,
    };
    const targetStage = input.outcome === "declined"
      ? "Declined"
      : snapshot.referral.stage === "Assessment"
        ? "Community Review"
        : snapshot.referral.stage;
    const sections = normalizeReferralSectionVersions(snapshot.referral.sectionVersions);
    const mutation = await patchReferral(
      referralId,
      {
        admissionDecision: decision,
        stage: targetStage,
        workflowStatus: input.outcome === "declined" ? "declined" : "decision_pending",
      },
      expectedVersion,
      actor,
      { decision: expectedDecisionVersion, workflow: sections.workflow },
      {
        auditAction: input.outcome === "declined"
          ? "admission_declined"
          : "admission_decision_recorded",
        ...((input.overrideReason?.trim() || input.outcome === "declined")
          ? { auditReason: input.overrideReason?.trim() || decision.reasonNote }
          : {}),
      },
    );
    if (!mutation) return null;
    if (!mutation.ok) {
      if ("conflict" in mutation) return { ok: false, conflict: true, referral: mutation.referral, record: snapshot.decision ?? undefined };
      return { ok: false, blocked: true, referral: mutation.referral, blockers: mutation.blockers };
    }
    return { ok: true, record: decision, referral: mutation.referral };
  }

  const sql = getPipelineSql();
  const result = await sql.begin(async (tx) => recordPostgresDecision(
    tx,
    referralId,
    input,
    expectedVersion,
    expectedDecisionVersion,
    actor,
    snapshot.referral,
  ));
  if (!result.ok) return result;
  const referral = await getReferral(referralId);
  if (!referral) return null;
  return { ok: true, record: result.record, referral };
}

export async function patchReferralWorkItem(
  referralId: number,
  workItemId: string,
  patch: WorkItemPatch,
  expectedVersion: number,
  actor: ReferralActor,
  auditReason = "",
): Promise<WorkflowRecordMutation<AdmissionRequirement> | null> {
  const snapshot = await getReferralWorkflowSnapshot(referralId);
  if (!snapshot) return null;
  const current = snapshot.work_items.find((item) => item.id === workItemId);
  if (!current) return null;
  if ((current.version ?? 1) !== expectedVersion) {
    return { ok: false, conflict: true, referral: snapshot.referral, record: current };
  }
  const now = new Date().toISOString();
  const next = normalizeWorkItem({
    ...current,
    ...patch,
    ownerId: snapshot.referral.ownerId,
    owner: snapshot.referral.owner,
    requestedAt: patch.status === "requested" && current.status !== "requested"
      ? patch.requestedAt ?? now
      : patch.requestedAt ?? current.requestedAt,
    id: current.id,
    version: (current.version ?? 1) + 1,
    updatedAt: now,
  });
  const blocker = validateWorkItem(next);
  if (blocker) {
    return { ok: false, blocked: true, referral: snapshot.referral, blockers: [blocker] };
  }

  if (getReferralStoreReadiness().mode !== "postgres") {
    const requirements = snapshot.work_items.map((item) => item.id === workItemId ? next : item);
    const workflowStatus = workflowStatusAfterWorkItem(snapshot, requirements);
    const mutation = await patchReferral(
      referralId,
      { requirements, workflowStatus },
      snapshot.referral.version,
      actor,
      undefined,
      { auditAction: "work_item_updated", ...(auditReason ? { auditReason } : {}) },
    );
    if (!mutation) return null;
    if (!mutation.ok) {
      if ("conflict" in mutation) return { ok: false, conflict: true, referral: mutation.referral, record: current };
      return { ok: false, blocked: true, referral: mutation.referral, blockers: mutation.blockers };
    }
    return { ok: true, record: next, referral: mutation.referral };
  }

  const sql = getPipelineSql();
  const requirements = snapshot.work_items.map((item) => item.id === workItemId ? next : item);
  const workflowStatus = workflowStatusAfterWorkItem(snapshot, requirements);
  const result = await sql.begin(async (tx) => patchPostgresWorkItem(
    tx,
    referralId,
    workItemId,
    current,
    next,
    expectedVersion,
    actor,
    snapshot.referral,
    auditReason,
    workflowStatus,
  ));
  if (!result.ok) return result;
  const referral = await getReferral(referralId);
  if (!referral) return null;
  return { ok: true, record: result.record, referral };
}

export async function updateEhrHandoff(
  referralId: number,
  action: "queue" | "mark_sent" | "mark_failed" | "retry",
  expectedVersion: number,
  expectedDecisionVersion: number,
  actor: ReferralActor,
  failureReason = "",
): Promise<WorkflowRecordMutation<EhrHandoffRecord> | null> {
  const snapshot = await getReferralWorkflowSnapshot(referralId);
  if (!snapshot) return null;
  const sectionVersion = normalizeReferralSectionVersions(snapshot.referral.sectionVersions).decision;
  if (sectionVersion !== expectedDecisionVersion) {
    return { ok: false, conflict: true, referral: snapshot.referral, record: snapshot.referral.ehrHandoff };
  }

  const current = snapshot.referral.ehrHandoff;
  const blockers = getEhrHandoffBlockers(snapshot, action, failureReason);
  if (blockers.length > 0) {
    return { ok: false, blocked: true, referral: snapshot.referral, blockers };
  }

  const now = new Date().toISOString();
  const base: EhrHandoffRecord = {
    status: "ready",
    version: (current?.version ?? 0) + 1,
    updatedAt: now,
    ...(current?.queuedAt ? { queuedAt: current.queuedAt } : {}),
    ...(current?.queuedBy ? { queuedBy: current.queuedBy } : {}),
    ...(current?.queuedByName ? { queuedByName: current.queuedByName } : {}),
    ...(current?.sentAt ? { sentAt: current.sentAt } : {}),
  };
  const record: EhrHandoffRecord = action === "mark_sent"
    ? { ...base, status: "sent", sentAt: now }
    : action === "mark_failed"
      ? { ...base, status: "failed", failureReason: failureReason.trim() }
      : {
          ...base,
          status: "queued",
          queuedAt: now,
          queuedBy: actor.id,
          queuedByName: actor.name,
        };

  const mutation = await patchReferral(
    referralId,
    { ehrHandoff: record },
    expectedVersion,
    actor,
    { decision: expectedDecisionVersion },
    {
      auditAction: {
        queue: "ehr_handoff_queued",
        retry: "ehr_handoff_retried",
        mark_sent: "ehr_handoff_sent",
        mark_failed: "ehr_handoff_failed",
      }[action],
      ...(failureReason.trim() ? { auditReason: failureReason.trim() } : {}),
    },
  );
  if (!mutation) return null;
  if (!mutation.ok) {
    if ("conflict" in mutation) return { ok: false, conflict: true, referral: mutation.referral, record: current };
    return { ok: false, blocked: true, referral: mutation.referral, blockers: mutation.blockers };
  }
  return { ok: true, record, referral: mutation.referral };
}

async function recordPostgresRecommendation(
  tx: TransactionSql,
  referralId: number,
  input: AssessmentRecommendationInput,
  expectedVersion: number,
  expectedDecisionVersion: number,
  actor: ReferralActor,
  fallback: Referral,
  options: { allowSupervisorOverride?: boolean },
): Promise<WorkflowRecordMutation<AssessmentRecommendation>> {
  const referralRows = await tx<{ version: number; data: unknown; section_versions: unknown }[]>`
    select version, data, section_versions
    from pipeline.referrals
    where referral_id = ${referralId} and deleted_at is null
    for update
  `;
  const referralRow = referralRows[0];
  if (!referralRow) throw new Error("Referral not found.");
  if (Number(referralRow.version) !== expectedVersion
    || normalizeReferralSectionVersions(referralRow.section_versions).decision !== expectedDecisionVersion) {
    return { ok: false, conflict: true, referral: fallback };
  }
  const assessmentRows = await tx<{ assessment_id: string; assessor_id: string | null; signed_at: Date | string | null }[]>`
    select assessment_id, assessor_id, signed_at
    from pipeline.assessments
    where assessment_id = ${input.assessmentId} and referral_id = ${referralId}
    for update
  `;
  const assessment = assessmentRows[0];
  if (!assessment?.signed_at) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: [{ code: "signed_assessment_required", label: "Sign the assessment before submitting a recommendation." }],
    };
  }
  if (assessment.assessor_id !== actor.id && !options.allowSupervisorOverride) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: [{ code: "assigned_assessor_required", label: "Only the assigned assessor or a supervisor can submit this recommendation." }],
    };
  }
  const decisionRows = await tx<{ exists: boolean }[]>`
    select exists(select 1 from pipeline.admission_decisions where referral_id = ${referralId}) as exists
  `;
  if (decisionRows[0]?.exists) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: [{ code: "decision_already_recorded", label: "The supervisor decision has already been recorded." }],
    };
  }
  const rows = await tx<RecommendationRow[]>`
    insert into pipeline.assessment_recommendations (
      referral_id, assessment_id, outcome, reason_code, reason_note,
      recommended_by, recommended_by_name, recommended_at
    ) values (
      ${referralId}, ${input.assessmentId}, ${input.outcome},
      ${input.reasonCode?.trim() || null}, ${input.reasonNote?.trim() || ""},
      ${actor.id}, ${actor.name}, now()
    )
    on conflict (assessment_id) do update set
      outcome = excluded.outcome,
      reason_code = excluded.reason_code,
      reason_note = excluded.reason_note,
      recommended_by = excluded.recommended_by,
      recommended_by_name = excluded.recommended_by_name,
      recommended_at = now(),
      version = pipeline.assessment_recommendations.version + 1,
      updated_at = now()
    returning recommendation_id, referral_id, assessment_id, outcome, reason_code,
              reason_note, recommended_by, recommended_by_name, recommended_at, version
  `;
  const recommendation = mapRecommendation(rows[0]);
  const sections = normalizeReferralSectionVersions(referralRow.section_versions);
  const data = isRecord(referralRow.data) ? referralRow.data : {};
  await tx`
    update pipeline.referrals
    set workflow_status = 'decision_pending',
        data = ${tx.json({ ...data, assessmentRecommendation: recommendation })},
        version = version + 1,
        section_versions = ${tx.json({
          ...sections,
          decision: sections.decision + 1,
          workflow: sections.workflow + 1,
        })},
        updated_by = ${actor.id}, updated_by_name = ${actor.name}, updated_at = now()
    where referral_id = ${referralId} and version = ${expectedVersion}
  `;
  await writeWorkflowAudit(
    tx,
    "assessment_recommendation",
    recommendation.recommendationId,
    "assessment_recommendation_submitted",
    actor,
    recommendation.version,
    ["outcome", "reasonCode", "reasonNote"],
  );
  await bumpRevisions(tx);
  return { ok: true, record: recommendation, referral: fallback };
}

async function recordPostgresDecision(
  tx: TransactionSql,
  referralId: number,
  input: AdmissionDecisionInput,
  expectedVersion: number,
  expectedDecisionVersion: number,
  actor: ReferralActor,
  fallback: Referral,
): Promise<WorkflowRecordMutation<AdmissionDecision>> {
  const referralRows = await tx<{ version: number; stage: Referral["stage"]; data: unknown; section_versions: unknown }[]>`
    select version, stage, data, section_versions from pipeline.referrals where referral_id = ${referralId} and deleted_at is null for update
  `;
  const row = referralRows[0];
  if (!row) throw new Error("Referral not found.");
  if (Number(row.version) !== expectedVersion
    || normalizeReferralSectionVersions(row.section_versions).decision !== expectedDecisionVersion) {
    return { ok: false, conflict: true, referral: fallback };
  }
  const assessmentRows = await tx<{ signed: boolean }[]>`
    select exists(
      select 1 from pipeline.assessments
      where referral_id = ${referralId} and signed_at is not null
    ) as signed
  `;
  const data = isRecord(row.data) ? row.data : {};
  if (!assessmentRows[0]?.signed) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: [{ code: "assessment_required", label: "Sign the assessment before recording the admission decision." }],
    };
  }
  const recommendationRows = await tx<RecommendationRow[]>`
    select recommendation_id, referral_id, assessment_id, outcome, reason_code,
           reason_note, recommended_by, recommended_by_name, recommended_at, version
    from pipeline.assessment_recommendations
    where referral_id = ${referralId}
    order by recommended_at desc, recommendation_id desc
    limit 1
  `;
  const recommendation = recommendationRows[0] ? mapRecommendation(recommendationRows[0]) : null;
  if (!recommendation && !input.overrideReason?.trim()) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: [{ code: "recommendation_required", label: "An assessor recommendation is required, or the supervisor must record an override reason." }],
    };
  }

  const decisionRows = await tx<DecisionRow[]>`
    insert into pipeline.admission_decisions (
      referral_id, outcome, reason_code, reason_note, decided_by, decided_by_name,
      decided_at, recommendation_id, decided_by_role
    ) values (
      ${referralId}, ${input.outcome}, ${input.reasonCode?.trim() || null},
      ${input.reasonNote?.trim() || null}, ${actor.id}, ${actor.name}, now(),
      ${recommendation?.recommendationId ?? null}::uuid, ${input.decidedByRole ?? null}
    )
    on conflict (referral_id) do update set
      outcome = excluded.outcome,
      reason_code = excluded.reason_code,
      reason_note = excluded.reason_note,
      decided_by = excluded.decided_by,
      decided_by_name = excluded.decided_by_name,
      decided_at = now(),
      recommendation_id = excluded.recommendation_id,
      decided_by_role = excluded.decided_by_role,
      version = pipeline.admission_decisions.version + 1,
      updated_at = now()
    returning decision_id, outcome, reason_code, reason_note, decided_by,
              decided_by_name, decided_at, version, recommendation_id, decided_by_role
  `;
  const decision = mapDecision(decisionRows[0]);
  const currentSections = normalizeReferralSectionVersions(row.section_versions);
  const nextStage = input.outcome === "declined"
    ? "Declined"
    : row.stage === "Assessment"
      ? "Community Review"
      : row.stage;
  const stageChanged = nextStage !== row.stage;
  const nextSections = {
    ...currentSections,
    decision: currentSections.decision + 1,
    workflow: stageChanged ? currentSections.workflow + 1 : currentSections.workflow,
  };
  await tx`
    update pipeline.referrals
    set stage = ${nextStage},
        data = ${tx.json({ ...data, admissionDecision: decision })},
        version = version + 1,
        section_versions = ${tx.json(nextSections)},
        closed_at = case when ${nextStage} in ('Accepted / Admitted', 'Declined') then now() else null end,
        workflow_status = ${input.outcome === "declined" ? "declined" : "decision_pending"},
        updated_by = ${actor.id},
        updated_by_name = ${actor.name},
        updated_at = now()
    where referral_id = ${referralId} and version = ${Number(row.version)}
  `;
  await writeWorkflowAudit(
    tx,
    "admission_decision",
    decision.decisionId,
    input.overrideReason?.trim() ? "admission_decision_overridden" : "admission_decision_recorded",
    actor,
    decision.version,
    ["outcome", "reasonCode", "reasonNote", "recommendationId"],
    input.overrideReason?.trim() ?? "",
  );
  if (stageChanged) {
    await tx`
      insert into pipeline.audit_events (
        entity_type, entity_id, action, actor_id, actor_name,
        from_version, to_version, changed_fields, metadata
      ) values (
        'referral', ${String(referralId)},
        ${input.outcome === "declined" ? "admission_declined" : "assessment_completed"},
        ${actor.id}, ${actor.name}, ${Number(row.version)}, ${Number(row.version) + 1},
        ${["stage"]},
        ${tx.json({ from_stage: row.stage, to_stage: nextStage })}
      )
    `;
  }
  await bumpRevisions(tx);
  return { ok: true, record: decision, referral: fallback };
}

async function patchPostgresWorkItem(
  tx: TransactionSql,
  referralId: number,
  workItemId: string,
  current: AdmissionRequirement,
  next: AdmissionRequirement,
  expectedVersion: number,
  actor: ReferralActor,
  fallback: Referral,
  auditReason: string,
  workflowStatus: Referral["workflowStatus"],
): Promise<WorkflowRecordMutation<AdmissionRequirement>> {
  const referralRows = await tx<{ version: number; data: unknown }[]>`
    select version, data from pipeline.referrals where referral_id = ${referralId} and deleted_at is null for update
  `;
  if (!referralRows[0]) throw new Error("Referral not found.");
  const rows = await tx<WorkItemRow[]>`
    update pipeline.work_items
    set status = ${next.status}, owner_id = ${next.ownerId || null}, owner_name = ${next.owner || null},
        due_at = ${next.dueAt ? new Date(next.dueAt) : null}, next_action = ${next.nextStep},
        blocker = ${next.blocker}, evidence_document_id = ${next.evidenceDocumentId ?? null}::uuid,
        evidence_document_name = ${next.evidenceDocumentName ?? null},
        waiver_reason = ${next.waiverReason ?? null}, field_key = ${next.fieldKey ?? null},
        requested_from = ${next.requestedFrom ?? null},
        requested_at = ${next.requestedAt ? new Date(next.requestedAt) : null},
        follow_up_at = ${next.followUpAt ? new Date(next.followUpAt) : null},
        unavailable_reason = ${next.unavailableReason ?? null},
        version = version + 1, updated_at = now()
    where referral_id = ${referralId} and work_item_id = ${workItemId}::uuid and version = ${expectedVersion}
    returning work_item_id, type, label, gate, status, owner_id, owner_name, due_at,
              next_action, blocker, evidence_document_id, evidence_document_name, waiver_reason,
              field_key, requested_from, requested_at, follow_up_at, unavailable_reason,
              version, updated_at
  `;
  if (!rows[0]) {
    const currentRows = await tx<WorkItemRow[]>`
      select work_item_id, type, label, gate, status, owner_id, owner_name, due_at,
             next_action, blocker, evidence_document_id, evidence_document_name, waiver_reason,
             field_key, requested_from, requested_at, follow_up_at, unavailable_reason,
             version, updated_at
      from pipeline.work_items
      where referral_id = ${referralId} and work_item_id = ${workItemId}::uuid
    `;
    return { ok: false, conflict: true, referral: fallback, record: currentRows[0] ? mapWorkItem(currentRows[0]) : undefined };
  }
  const record = mapWorkItem(rows[0]);
  const allRows = await tx<WorkItemRow[]>`
    select work_item_id, type, label, gate, status, owner_id, owner_name, due_at,
           next_action, blocker, evidence_document_id, evidence_document_name, waiver_reason,
           field_key, requested_from, requested_at, follow_up_at, unavailable_reason,
           version, updated_at
    from pipeline.work_items where referral_id = ${referralId} order by created_at, work_item_id
  `;
  const data = isRecord(referralRows[0].data) ? referralRows[0].data : {};
  await tx`
    update pipeline.referrals
    set data = ${tx.json({ ...data, requirements: allRows.map(mapWorkItem) })},
        workflow_status = ${workflowStatus ?? "intake_unassigned"},
        version = version + 1,
        section_versions = jsonb_set(
          section_versions,
          '{workflow}',
          to_jsonb(coalesce((section_versions->>'workflow')::integer, 1) + 1)
        ),
        updated_by = ${actor.id},
        updated_by_name = ${actor.name},
        updated_at = now()
    where referral_id = ${referralId}
  `;
  const changedFields = workItemChangedFields(current, record);
  await writeWorkflowAudit(
    tx,
    "work_item",
    record.id,
    getWorkItemAuditAction(current, record, changedFields),
    actor,
    record.version ?? 1,
    changedFields,
    auditReason,
  );
  await bumpRevisions(tx);
  return { ok: true, record, referral: fallback };
}

function workflowStatusAfterWorkItem(
  snapshot: ReferralWorkflowSnapshot,
  requirements: AdmissionRequirement[],
): Referral["workflowStatus"] {
  const current = snapshot.referral.workflowStatus;
  if (current && ["accepted", "declined", "closed"].includes(current)) return current;
  if (snapshot.recommendation) return "decision_pending";
  if (snapshot.context.assessmentSigned) return "assessment_signed";
  if (snapshot.context.assessmentComplete) return "assessment_ready_to_sign";
  if (snapshot.context.assessmentExists) {
    const waiting = requirements.some((requirement) =>
      requirement.blocker
        && requirement.status === "requested"
        && ["profile_completion", "pre_assessment", "admission_decision"].includes(requirement.requiredFor),
    );
    if (waiting) return "waiting_for_information";
    if (!snapshot.context.assessmentStarted) {
      if (snapshot.context.assessmentScheduleStatus === "scheduled" || snapshot.context.assessmentScheduleStatus === "rescheduled") {
        return "assessment_scheduled";
      }
      return "ready_to_schedule";
    }
    return "assessment_in_progress";
  }
  return current;
}

async function writeWorkflowAudit(
  tx: TransactionSql,
  entityType: string,
  entityId: string,
  action: string,
  actor: ReferralActor,
  version: number,
  changedFields: string[],
  auditReason = "",
) {
  await tx`
    insert into pipeline.audit_events (
      entity_type, entity_id, action, actor_id, actor_name,
      from_version, to_version, changed_fields, metadata
    ) values (
      ${entityType}, ${entityId}, ${action}, ${actor.id}, ${actor.name},
      ${version > 1 ? version - 1 : null}, ${version}, ${changedFields},
      ${tx.json(auditReason ? { reason: auditReason } : {})}
    )
  `;
}

async function bumpRevisions(tx: TransactionSql) {
  await tx`
    update pipeline.store_revisions
    set revision = revision + 1, updated_at = now()
    where store_name in ('referrals', 'workflow')
  `;
}

function mapWorkItem(row: WorkItemRow): AdmissionRequirement {
  return normalizeWorkItem({
    id: row.work_item_id,
    version: Number(row.version),
    type: row.type,
    label: row.label,
    status: row.status,
    requiredFor: row.gate,
    ownerId: row.owner_id ?? undefined,
    owner: row.owner_name ?? "",
    dueAt: row.due_at ? toIso(row.due_at) : "",
    nextStep: row.next_action,
    blocker: row.blocker,
    evidenceDocumentId: row.evidence_document_id ?? undefined,
    evidenceDocumentName: row.evidence_document_name ?? undefined,
    waiverReason: row.waiver_reason ?? undefined,
    fieldKey: row.field_key ?? undefined,
    requestedFrom: row.requested_from ?? undefined,
    requestedAt: row.requested_at ? toIso(row.requested_at) : undefined,
    followUpAt: row.follow_up_at ? toIso(row.follow_up_at) : undefined,
    unavailableReason: row.unavailable_reason ?? undefined,
    updatedAt: toIso(row.updated_at),
  });
}

function mapDecision(row: DecisionRow): AdmissionDecision {
  return {
    decisionId: row.decision_id,
    outcome: row.outcome,
    reasonCode: row.reason_code ?? "",
    reasonNote: row.reason_note ?? "",
    decidedBy: row.decided_by,
    decidedByName: row.decided_by_name,
    decidedAt: toIso(row.decided_at),
    version: Number(row.version),
    recommendationId: row.recommendation_id ?? undefined,
    decidedByRole: row.decided_by_role ?? undefined,
  };
}

function mapRecommendation(row: RecommendationRow): AssessmentRecommendation {
  return {
    recommendationId: row.recommendation_id,
    assessmentId: row.assessment_id,
    outcome: row.outcome,
    reasonCode: row.reason_code ?? "",
    reasonNote: row.reason_note,
    recommendedBy: row.recommended_by,
    recommendedByName: row.recommended_by_name,
    recommendedAt: toIso(row.recommended_at),
    version: Number(row.version),
  };
}

function legacyDecision(referral: Referral): AdmissionDecision | null {
  const value = referral.assessment?.postAssessment;
  if (!value || value.decision === "pending") return null;
  return {
    decisionId: `legacy-${referral.id}`,
    outcome: value.decision === "accepted" ? "accepted" : "declined",
    reasonCode: "",
    reasonNote: value.reason,
    decidedBy: "legacy",
    decidedByName: "Legacy record",
    decidedAt: referral.assessment?.completedAt ?? referral.updatedAt ?? referral.createdAt,
    version: 1,
  };
}

function normalizeWorkItem(item: AdmissionRequirement): AdmissionRequirement {
  return {
    ...item,
    ownerId: item.ownerId?.trim() || undefined,
    owner: normalizeOwnerName(item.owner),
    dueAt: item.dueAt,
    nextStep: item.nextStep.trim(),
    evidenceDocumentId: item.evidenceDocumentId?.trim() || undefined,
    evidenceDocumentName: item.evidenceDocumentName?.trim() || undefined,
    waiverReason: item.waiverReason?.trim() || undefined,
    fieldKey: item.fieldKey?.trim() || undefined,
    requestedFrom: item.requestedFrom?.trim() || undefined,
    requestedAt: item.requestedAt?.trim() || undefined,
    followUpAt: item.followUpAt?.trim() || undefined,
    unavailableReason: item.unavailableReason?.trim() || undefined,
  };
}

function validateWorkItem(item: AdmissionRequirement) {
  if (item.status === "waived" && !item.waiverReason) {
    return { code: "waiver_reason_required", label: "Record why this requirement is being waived." };
  }
  if (item.status === "requested" && !item.requestedFrom) {
    return { code: "requested_from_required", label: "Record who is expected to provide the missing information." };
  }
  if (item.status === "requested" && !item.followUpAt) {
    return { code: "follow_up_required", label: "Set a follow-up date for requested information." };
  }
  if (["unavailable", "not_applicable"].includes(item.status) && !item.unavailableReason) {
    return {
      code: "availability_reason_required",
      label: item.status === "unavailable"
        ? "Record why this information is unavailable."
        : "Record why this requirement does not apply.",
    };
  }
  if (!item.nextStep) return { code: "next_action_required", label: "Every open requirement needs a next action." };
  if (!item.dueAt) return { code: "due_date_required", label: "Every open requirement needs a due date." };
  return null;
}

function getEhrHandoffBlockers(
  snapshot: ReferralWorkflowSnapshot,
  action: "queue" | "mark_sent" | "mark_failed" | "retry",
  failureReason: string,
) {
  const current = snapshot.referral.ehrHandoff;
  if (action === "mark_failed" && !failureReason.trim()) {
    return [{ code: "ehr_failure_reason_required", label: "Record why the EHR handoff failed." }];
  }
  if ((action === "mark_sent" || action === "mark_failed") && current?.status !== "queued") {
    return [{ code: "ehr_handoff_not_queued", label: "Queue the EHR handoff before recording its result." }];
  }
  if (action === "retry" && current?.status !== "failed") {
    return [{ code: "ehr_handoff_not_failed", label: "Only a failed EHR handoff can be retried." }];
  }
  if (action === "queue" || action === "retry") {
    if (snapshot.referral.stage !== "Accepted / Admitted" || snapshot.decision?.outcome !== "accepted") {
      return [{ code: "accepted_referral_required", label: "Accept the referral before queueing the EHR handoff." }];
    }
    const incomplete = snapshot.work_items.filter((item) =>
      item.requiredFor === "ehr_export" && item.blocker && !["received", "reviewed", "waived", "not_applicable"].includes(item.status),
    );
    if (incomplete.length > 0) {
      return incomplete.map((item) => ({ code: `requirement:${item.type}`, label: `${item.label} is still required for EHR handoff.` }));
    }
    if (current?.status === "sent") {
      return [{ code: "ehr_handoff_already_sent", label: "This EHR handoff has already been recorded as sent." }];
    }
  }
  return [];
}

function workItemChangedFields(current: AdmissionRequirement, next: AdmissionRequirement) {
  const fields: Array<keyof AdmissionRequirement> = [
    "status",
    "owner",
    "dueAt",
    "nextStep",
    "blocker",
    "evidenceDocumentId",
    "evidenceDocumentName",
    "waiverReason",
    "fieldKey",
    "requestedFrom",
    "requestedAt",
    "followUpAt",
    "unavailableReason",
  ];
  return fields.filter((field) => current[field] !== next[field]);
}

function getWorkItemAuditAction(
  current: AdmissionRequirement,
  next: AdmissionRequirement,
  changedFields: Array<keyof AdmissionRequirement>,
) {
  if (next.status === "waived" && current.status !== "waived") return "work_item_waived";
  if (next.status === "requested" && current.status !== "requested") return "work_item_requested";
  if (next.status === "unavailable" && current.status !== "unavailable") return "work_item_unavailable";
  if (next.status === "not_applicable" && current.status !== "not_applicable") return "work_item_not_applicable";
  if (changedFields.includes("evidenceDocumentId") || changedFields.includes("evidenceDocumentName")) return "work_item_evidence_recorded";
  if (changedFields.includes("owner")) return "work_item_reassigned";
  if (changedFields.includes("dueAt") || changedFields.includes("nextStep")) return "work_item_circle_back_updated";
  return "work_item_updated";
}

function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
