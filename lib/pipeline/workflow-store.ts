import "server-only";

import { randomUUID } from "node:crypto";

import type { TransactionSql } from "postgres";

import {
  createAssessmentRevision,
  createAssessmentRevisionInTransaction,
  discardUncommittedAssessmentRevision,
  getAssessment,
  listAssessments,
} from "@/lib/assessment/assessment-store";
import { pickAssessmentToolData, type AssessmentToolData } from "@/lib/assessment/assessment-tool-schema";
import type { AssessmentWorkflowStatus, PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import {
  getReferral,
  getReferralMutationReplay,
  getReferralStoreReadiness,
  patchReferral,
  type ReferralActor,
  type ReferralMutation,
} from "@/lib/pipeline/referral-store";
import type {
  AdmissionDecision,
  AdmissionRequirement,
  AssessmentRecommendation,
  AssessmentReview,
  EhrHandoffRecord,
  Referral,
} from "@/lib/pipeline/referral-types";
import { normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import {
  getAdmissionDecisionBlockers,
  getEhrHandoffBlockers,
  getWorkItemAuditAction,
  normalizeWorkItem,
  validateWorkItem,
  workflowStatusAfterWorkItem,
  workItemChangedFields,
  type AdmissionDecisionInput,
  type AssessmentRecommendationInput,
  type AssessmentReviewChangesInput,
  type WorkflowContext,
  type WorkflowRecordSnapshot,
  type WorkItemPatch,
} from "@/lib/pipeline/workflow-records";

export type ReferralWorkflowSnapshot = WorkflowRecordSnapshot;

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
  review_id: string | null;
  review_version: number | null;
  assessment_id: string | null;
  assessment_version: number | null;
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

type ReviewRow = {
  review_id: string;
  referral_id: number | string;
  assessment_id: string;
  assessment_version: number | string;
  recommendation_id: string;
  recommendation_version: number | string;
  submission_number: number | string;
  status: AssessmentReview["status"];
  submitted_by: string;
  submitted_by_name: string;
  submitted_at: Date | string;
  due_at: Date | string;
  assigned_reviewer_id: string | null;
  assigned_reviewer_name: string;
  notification_status: AssessmentReview["notificationStatus"];
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: Date | string | null;
  review_note: string | null;
  successor_assessment_id: string | null;
  previous_review_id: string | null;
  version: number | string;
  updated_at: Date | string;
};

export async function getReferralWorkflowSnapshot(referralId: number): Promise<ReferralWorkflowSnapshot | null> {
  const referral = await getReferral(referralId);
  if (!referral) return null;

  if (getReferralStoreReadiness().mode !== "postgres") {
    const assessments = await listAssessments({ referralId, limit: 100 });
    const latestAssessment = assessments.assessments[0] ?? null;
    const decision = referral.admissionDecision ?? legacyDecision(referral);
    const recommendation = referral.assessmentRecommendation ?? null;
    const review = referral.assessmentReview ?? null;
    const reviews = referral.assessmentReviewHistory ?? (review ? [review] : []);
    const workItems = referral.requirements ?? [];
    return {
      referral,
      work_items: workItems,
      decision,
      recommendation,
      review,
      reviews,
      context: {
        assessmentExists: Boolean(latestAssessment) || Boolean(referral.assessment),
        assessmentId: latestAssessment?.assessment_id ?? null,
        assessmentCreatedAt: latestAssessment?.created_at ?? null,
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
        review,
      },
    };
  }

  const sql = getPipelineSql();
  const [workItemRows, decisionRows, recommendationRows, reviewRows, assessmentRows] = await Promise.all([
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
             decided_by_name, decided_at, version, recommendation_id, decided_by_role,
             review_id, review_version, assessment_id, assessment_version
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
    sql<ReviewRow[]>`
      select review_id, referral_id, assessment_id, assessment_version,
             recommendation_id, recommendation_version, submission_number, status,
             submitted_by, submitted_by_name, submitted_at, due_at,
             assigned_reviewer_id, assigned_reviewer_name, notification_status,
             reviewed_by, reviewed_by_name, reviewed_at, review_note,
             successor_assessment_id, previous_review_id, version, updated_at
      from pipeline.assessment_reviews
      where referral_id = ${referralId}
      order by submission_number desc, review_id desc
    `,
    sql<{ assessment_id: string; created_at: Date | string; status: AssessmentWorkflowStatus; assessment_date: Date | string | null; signed_at: Date | string | null; started_at: Date | string | null; schedule_status: PipelineAssessmentRecord["schedule_status"]; data: AssessmentToolData }[]>`
      select assessment_id, created_at, status, assessment_date, signed_at, started_at, schedule_status, data
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
  const reviews = reviewRows.map(mapReview);
  const review = reviews[0] ?? referral.assessmentReview ?? null;

  const latestAssessment = assessmentRows[0] ?? null;
  return {
    referral,
    work_items: workItems,
    decision,
    recommendation,
    review,
    reviews,
    context: {
      assessmentExists: Boolean(latestAssessment) || Boolean(referral.assessment),
      assessmentId: latestAssessment?.assessment_id ?? null,
      assessmentCreatedAt: latestAssessment?.created_at ? toIso(latestAssessment.created_at) : null,
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
      review,
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
  const [workItemRows, decisionRows, recommendationRows, reviewRows, assessmentRows] = await Promise.all([
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
             decided_by_name, decided_at, version, recommendation_id, decided_by_role,
             review_id, review_version, assessment_id, assessment_version
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
    sql<ReviewRow[]>`
      select distinct on (referral_id)
             review_id, referral_id, assessment_id, assessment_version,
             recommendation_id, recommendation_version, submission_number, status,
             submitted_by, submitted_by_name, submitted_at, due_at,
             assigned_reviewer_id, assigned_reviewer_name, notification_status,
             reviewed_by, reviewed_by_name, reviewed_at, review_note,
             successor_assessment_id, previous_review_id, version, updated_at
      from pipeline.assessment_reviews
      where referral_id = any(${ids}::bigint[])
      order by referral_id, submission_number desc, review_id desc
    `,
    sql<{ referral_id: number | string; assessment_id: string; created_at: Date | string; status: AssessmentWorkflowStatus; assessment_date: Date | string | null; signed_at: Date | string | null; started_at: Date | string | null; schedule_status: PipelineAssessmentRecord["schedule_status"]; data: AssessmentToolData }[]>`
      select distinct on (referral_id) referral_id, assessment_id, created_at, status, assessment_date, signed_at, started_at, schedule_status, data
      from pipeline.assessments
      where referral_id = any(${ids}::bigint[])
      order by referral_id, updated_at desc, assessment_id desc
    `,
  ]);
  const workItemsByReferral = groupRowsByReferral(workItemRows);
  const decisionsByReferral = indexRowsByReferral(decisionRows);
  const recommendationsByReferral = indexRowsByReferral(recommendationRows);
  const reviewsByReferral = indexRowsByReferral(reviewRows);
  const assessmentsByReferral = indexRowsByReferral(assessmentRows);

  for (const referral of referrals) {
    const workItems = (workItemsByReferral.get(referral.id) ?? []).map(mapWorkItem);
    const decisionRow = decisionsByReferral.get(referral.id);
    const assessmentRow = assessmentsByReferral.get(referral.id);
    const recommendationRow = recommendationsByReferral.get(referral.id);
    const reviewRow = reviewsByReferral.get(referral.id);
    contexts.set(referral.id, {
      assessmentExists: Boolean(assessmentRow) || Boolean(referral.assessment),
      assessmentId: assessmentRow?.assessment_id ?? null,
      assessmentCreatedAt: assessmentRow?.created_at ? toIso(assessmentRow.created_at) : null,
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
      review: reviewRow ? mapReview(reviewRow) : referral.assessmentReview ?? null,
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
  mutationId?: string,
): Promise<ReferralMutation | null> {
  return patchReferral(
    referralId,
    {
      stage: targetStage,
      ...(targetStage === "Accepted / Admitted" ? { workflowStatus: "admitted" as const } : {}),
      ...(targetStage === "Declined" ? { workflowStatus: "declined" as const } : {}),
    },
    expectedVersion,
    actor,
    { workflow: expectedWorkflowVersion },
    { mutationId, mutationScope: "referral_transition" },
  );
}

export async function recordAssessmentRecommendation(
  referralId: number,
  input: AssessmentRecommendationInput,
  expectedVersion: number,
  expectedDecisionVersion: number,
  actor: ReferralActor,
  options: { allowSupervisorOverride?: boolean; mutationId?: string } = {},
): Promise<WorkflowRecordMutation<AssessmentRecommendation> | null> {
  const replay = await getReferralMutationReplay(referralId, "assessment_recommendation", options.mutationId);
  if (replay?.assessmentRecommendation) {
    return { ok: true, record: replay.assessmentRecommendation, referral: replay };
  }
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
  const existingSubmission = snapshot.reviews.find((review) => review.assessmentId === input.assessmentId);
  if (existingSubmission) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "assessment_already_submitted", label: "This signed assessment revision has already been submitted for supervisor review." }],
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
    const now = new Date().toISOString();
    const recommendation: AssessmentRecommendation = {
      recommendationId: randomUUID(),
      assessmentId: input.assessmentId,
      outcome: input.outcome,
      reasonCode: input.reasonCode?.trim() ?? "",
      reasonNote: input.reasonNote?.trim() ?? "",
      recommendedBy: actor.id,
      recommendedByName: actor.name,
      recommendedAt: now,
      version: 1,
    };
    const review: AssessmentReview = {
      reviewId: randomUUID(),
      referralId,
      assessmentId: assessment.assessment_id,
      assessmentVersion: assessment.version,
      recommendationId: recommendation.recommendationId,
      recommendationVersion: recommendation.version,
      submissionNumber: Math.max(0, ...snapshot.reviews.map((item) => item.submissionNumber)) + 1,
      status: "submitted",
      submittedBy: actor.id,
      submittedByName: actor.name,
      submittedAt: now,
      dueAt: new Date(Date.parse(now) + 2 * 24 * 60 * 60 * 1_000).toISOString(),
      assignedReviewerName: "Head supervisor",
      notificationStatus: "pending",
      previousReviewId: snapshot.review?.reviewId,
      version: 1,
      updatedAt: now,
    };
    const mutation = await patchReferral(
      referralId,
      {
        assessmentRecommendation: recommendation,
        assessmentReview: review,
        assessmentReviewHistory: [...snapshot.reviews, review],
        workflowStatus: "recommendation_submitted",
      },
      expectedVersion,
      actor,
      { decision: expectedDecisionVersion, workflow: normalizeReferralSectionVersions(snapshot.referral.sectionVersions).workflow },
      {
        auditAction: "assessment_recommendation_submitted",
        mutationId: options.mutationId,
        mutationScope: "assessment_recommendation",
      },
    );
    if (!mutation) return null;
    if (!mutation.ok) {
      if ("conflict" in mutation) return { ok: false, conflict: true, referral: mutation.referral, record: snapshot.recommendation ?? undefined };
      return { ok: false, blocked: true, referral: mutation.referral, blockers: mutation.blockers };
    }
    return {
      ok: true,
      record: mutation.idempotentReplay
        ? mutation.referral.assessmentRecommendation ?? recommendation
        : recommendation,
      referral: mutation.referral,
    };
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
    options.mutationId,
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
  mutationId?: string,
): Promise<WorkflowRecordMutation<AdmissionDecision> | null> {
  const replay = await getReferralMutationReplay(referralId, "admission_decision", mutationId);
  if (replay?.admissionDecision) return { ok: true, record: replay.admissionDecision, referral: replay };
  const snapshot = await getReferralWorkflowSnapshot(referralId);
  if (!snapshot) return null;
  if (normalizeReferralSectionVersions(snapshot.referral.sectionVersions).decision !== expectedDecisionVersion) {
    return { ok: false, conflict: true, referral: snapshot.referral, record: snapshot.decision ?? undefined };
  }
  if (snapshot.decision) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "decision_already_recorded", label: "The final supervisor decision is immutable. Reopen through a governed correction workflow instead." }],
    };
  }
  const blockers = getAdmissionDecisionBlockers(snapshot, input);
  if (blockers.length > 0) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers,
    };
  }

  if (getReferralStoreReadiness().mode !== "postgres") {
    const now = new Date().toISOString();
    const decision: AdmissionDecision = {
      decisionId: randomUUID(),
      outcome: input.outcome,
      reasonCode: input.reasonCode?.trim() ?? "",
      reasonNote: input.reasonNote?.trim() ?? "",
      decidedBy: actor.id,
      decidedByName: actor.name,
      decidedAt: now,
      version: 1,
      recommendationId: snapshot.recommendation?.recommendationId,
      reviewId: snapshot.review?.reviewId,
      reviewVersion: snapshot.review ? snapshot.review.version + 1 : undefined,
      assessmentId: snapshot.review?.assessmentId ?? snapshot.context.assessmentId ?? undefined,
      assessmentVersion: snapshot.review?.assessmentVersion,
      decidedByRole: input.decidedByRole,
    };
    const review = snapshot.review ? {
      ...snapshot.review,
      status: input.outcome === "accepted" ? "approved_for_placement" as const : "not_accepted" as const,
      notificationStatus: "acknowledged" as const,
      reviewedBy: actor.id,
      reviewedByName: actor.name,
      reviewedAt: now,
      reviewNote: decision.reasonNote || undefined,
      version: snapshot.review.version + 1,
      updatedAt: now,
    } : null;
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
        ...(review ? {
          assessmentReview: review,
          assessmentReviewHistory: snapshot.reviews.map((item) => item.reviewId === review.reviewId ? review : item),
        } : {}),
        stage: targetStage,
        workflowStatus: input.outcome === "declined" ? "declined" : "approved_for_placement",
      },
      expectedVersion,
      actor,
      { decision: expectedDecisionVersion, workflow: sections.workflow },
      {
        auditAction: input.outcome === "declined"
          ? "admission_declined"
          : "admission_decision_recorded",
        ...(input.outcome === "declined"
          ? { auditReason: decision.reasonNote }
          : {}),
        mutationId,
        mutationScope: "admission_decision",
      },
    );
    if (!mutation) return null;
    if (!mutation.ok) {
      if ("conflict" in mutation) return { ok: false, conflict: true, referral: mutation.referral, record: snapshot.decision ?? undefined };
      return { ok: false, blocked: true, referral: mutation.referral, blockers: mutation.blockers };
    }
    return {
      ok: true,
      record: mutation.idempotentReplay ? mutation.referral.admissionDecision ?? decision : decision,
      referral: mutation.referral,
    };
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
    mutationId,
  ));
  if (!result.ok) return result;
  const referral = await getReferral(referralId);
  if (!referral) return null;
  return { ok: true, record: result.record, referral };
}

export async function requestAssessmentReviewChanges(
  referralId: number,
  input: AssessmentReviewChangesInput,
  expectedVersion: number,
  expectedDecisionVersion: number,
  expectedReviewVersion: number,
  actor: ReferralActor,
  mutationId?: string,
): Promise<WorkflowRecordMutation<AssessmentReview> | null> {
  const replay = await getReferralMutationReplay(referralId, "assessment_review_changes", mutationId);
  if (replay?.assessmentReview?.reviewId === input.reviewId
    && replay.assessmentReview.status === "changes_requested") {
    return { ok: true, record: replay.assessmentReview, referral: replay };
  }
  const snapshot = await getReferralWorkflowSnapshot(referralId);
  if (!snapshot) return null;
  const sections = normalizeReferralSectionVersions(snapshot.referral.sectionVersions);
  if (sections.decision !== expectedDecisionVersion) {
    return { ok: false, conflict: true, referral: snapshot.referral, record: snapshot.review ?? undefined };
  }
  const review = snapshot.review;
  if (!review || review.reviewId !== input.reviewId || review.version !== expectedReviewVersion) {
    return { ok: false, conflict: true, referral: snapshot.referral, record: review ?? undefined };
  }
  if (snapshot.decision || review.status !== "submitted") {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "review_not_open", label: "Only an open supervisor review can be returned for changes." }],
    };
  }
  const reason = input.reasonNote.trim();
  if (reason.length < 3) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "review_note_required", label: "Describe the specific corrections the assessor needs to make." }],
    };
  }
  const revisionMutationId = mutationId ? `${mutationId}:assessment` : `review-${review.reviewId}:${randomUUID()}`;
  if (getReferralStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const result = await sql.begin((tx) => recordPostgresReviewChanges(
      tx,
      referralId,
      review,
      reason,
      revisionMutationId,
      expectedVersion,
      expectedDecisionVersion,
      actor,
      snapshot.referral,
      mutationId,
    ));
    if (!result) return null;
    if (!result.ok) return result;
    const referral = await getReferral(referralId);
    return referral ? { ok: true, record: result.record, referral } : null;
  }

  const revisionResult = await createAssessmentRevision(review.assessmentId, actor, revisionMutationId);
  if (!revisionResult) return null;
  if (!revisionResult.ok) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: "blockers" in revisionResult ? revisionResult.blockers : [
        { code: "assessment_revision_conflict", label: "The assessment changed before its correction revision could be created." },
      ],
    };
  }
  const now = new Date().toISOString();
  const updatedReview: AssessmentReview = {
    ...review,
    status: "changes_requested",
    notificationStatus: "acknowledged",
    reviewedBy: actor.id,
    reviewedByName: actor.name,
    reviewedAt: now,
    reviewNote: reason,
    successorAssessmentId: revisionResult.assessment.assessment_id,
    version: review.version + 1,
    updatedAt: now,
  };

  const mutation = await patchReferral(
    referralId,
    {
      assessmentReview: updatedReview,
      assessmentReviewHistory: snapshot.reviews.map((item) => item.reviewId === review.reviewId ? updatedReview : item),
      workflowStatus: "changes_requested",
    },
    expectedVersion,
    actor,
    { decision: expectedDecisionVersion, workflow: sections.workflow },
    {
      auditAction: "assessment_review_changes_requested",
      auditReason: reason,
      mutationId,
      mutationScope: "assessment_review_changes",
    },
  );
  if (!mutation) {
    await requireDiscardedLocalRevision(revisionResult.assessment, review.assessmentId, revisionMutationId);
    return null;
  }
  if (!mutation.ok) {
    await requireDiscardedLocalRevision(revisionResult.assessment, review.assessmentId, revisionMutationId);
    if ("conflict" in mutation) return { ok: false, conflict: true, referral: mutation.referral, record: snapshot.review ?? undefined };
    return { ok: false, blocked: true, referral: mutation.referral, blockers: mutation.blockers };
  }
  return { ok: true, record: mutation.referral.assessmentReview ?? updatedReview, referral: mutation.referral };
}

export async function patchReferralWorkItem(
  referralId: number,
  workItemId: string,
  patch: WorkItemPatch,
  expectedVersion: number,
  actor: ReferralActor,
  auditReason = "",
  mutationId?: string,
): Promise<WorkflowRecordMutation<AdmissionRequirement> | null> {
  const replay = await getReferralMutationReplay(referralId, "work_item_patch", mutationId);
  const replayedWorkItem = replay?.requirements?.find((item) => item.id === workItemId);
  if (replay && replayedWorkItem) return { ok: true, record: replayedWorkItem, referral: replay };
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
      {
        auditAction: "work_item_updated",
        ...(auditReason ? { auditReason } : {}),
        mutationId,
        mutationScope: "work_item_patch",
      },
    );
    if (!mutation) return null;
    if (!mutation.ok) {
      if ("conflict" in mutation) return { ok: false, conflict: true, referral: mutation.referral, record: current };
      return { ok: false, blocked: true, referral: mutation.referral, blockers: mutation.blockers };
    }
    return {
      ok: true,
      record: mutation.idempotentReplay
        ? mutation.referral.requirements?.find((item) => item.id === workItemId) ?? next
        : next,
      referral: mutation.referral,
    };
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
    mutationId,
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
  mutationId?: string,
): Promise<WorkflowRecordMutation<EhrHandoffRecord> | null> {
  const replay = await getReferralMutationReplay(referralId, "ehr_handoff", mutationId);
  if (replay?.ehrHandoff) return { ok: true, record: replay.ehrHandoff, referral: replay };
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
      mutationId,
      mutationScope: "ehr_handoff",
    },
  );
  if (!mutation) return null;
  if (!mutation.ok) {
    if ("conflict" in mutation) return { ok: false, conflict: true, referral: mutation.referral, record: current };
    return { ok: false, blocked: true, referral: mutation.referral, blockers: mutation.blockers };
  }
  return {
    ok: true,
    record: mutation.idempotentReplay ? mutation.referral.ehrHandoff ?? record : record,
    referral: mutation.referral,
  };
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
  mutationId?: string,
): Promise<WorkflowRecordMutation<AssessmentRecommendation>> {
  if (await lockWorkflowMutation(tx, "assessment_recommendation", mutationId, referralId)) {
    const existing = await tx<RecommendationRow[]>`
      select recommendation_id, referral_id, assessment_id, outcome, reason_code,
             reason_note, recommended_by, recommended_by_name, recommended_at, version
      from pipeline.assessment_recommendations
      where referral_id = ${referralId}
      order by recommended_at desc, recommendation_id desc
      limit 1
    `;
    if (existing[0]) return { ok: true, record: mapRecommendation(existing[0]), referral: fallback };
  }
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
  const assessmentRows = await tx<{ assessment_id: string; assessor_id: string | null; signed_at: Date | string | null; version: number }[]>`
    select assessment_id, assessor_id, signed_at, version
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
  const priorReviewRows = await tx<ReviewRow[]>`
    select review_id, referral_id, assessment_id, assessment_version,
           recommendation_id, recommendation_version, submission_number, status,
           submitted_by, submitted_by_name, submitted_at, due_at,
           assigned_reviewer_id, assigned_reviewer_name, notification_status,
           reviewed_by, reviewed_by_name, reviewed_at, review_note,
           successor_assessment_id, previous_review_id, version, updated_at
    from pipeline.assessment_reviews
    where referral_id = ${referralId}
    order by submission_number desc, review_id desc
    limit 1
  `;
  if (priorReviewRows[0]?.assessment_id === input.assessmentId) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: [{ code: "assessment_already_submitted", label: "This signed assessment revision has already been submitted for supervisor review." }],
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
    returning recommendation_id, referral_id, assessment_id, outcome, reason_code,
              reason_note, recommended_by, recommended_by_name, recommended_at, version
  `;
  const recommendation = mapRecommendation(rows[0]);
  const reviewRows = await tx<ReviewRow[]>`
    insert into pipeline.assessment_reviews (
      referral_id, assessment_id, assessment_version, recommendation_id,
      recommendation_version, submission_number, status, submitted_by,
      submitted_by_name, submitted_at, due_at, assigned_reviewer_name,
      notification_status, previous_review_id
    ) values (
      ${referralId}, ${input.assessmentId}, ${Number(assessment.version)},
      ${recommendation.recommendationId}::uuid, ${recommendation.version},
      ${Number(priorReviewRows[0]?.submission_number ?? 0) + 1}, 'submitted',
      ${actor.id}, ${actor.name}, now(), now() + interval '2 days',
      'Head supervisor', 'pending', ${priorReviewRows[0]?.review_id ?? null}::uuid
    )
    returning review_id, referral_id, assessment_id, assessment_version,
              recommendation_id, recommendation_version, submission_number, status,
              submitted_by, submitted_by_name, submitted_at, due_at,
              assigned_reviewer_id, assigned_reviewer_name, notification_status,
              reviewed_by, reviewed_by_name, reviewed_at, review_note,
              successor_assessment_id, previous_review_id, version, updated_at
  `;
  const review = mapReview(reviewRows[0]);
  const sections = normalizeReferralSectionVersions(referralRow.section_versions);
  const data = isRecord(referralRow.data) ? referralRow.data : {};
  await tx`
    update pipeline.referrals
    set workflow_status = 'recommendation_submitted',
        data = ${tx.json({ ...data, assessmentRecommendation: recommendation, assessmentReview: review })},
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
  await writeWorkflowAudit(
    tx,
    "assessment_review",
    review.reviewId,
    "assessment_review_submitted",
    actor,
    review.version,
    ["assessmentId", "assessmentVersion", "recommendationId", "status", "dueAt"],
  );
  await saveWorkflowMutation(tx, "assessment_recommendation", mutationId, referralId);
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
  mutationId?: string,
): Promise<WorkflowRecordMutation<AdmissionDecision>> {
  if (await lockWorkflowMutation(tx, "admission_decision", mutationId, referralId)) {
    const existing = await tx<DecisionRow[]>`
      select decision_id, outcome, reason_code, reason_note, decided_by,
             decided_by_name, decided_at, version, recommendation_id, decided_by_role,
             review_id, review_version, assessment_id, assessment_version
      from pipeline.admission_decisions
      where referral_id = ${referralId}
      limit 1
    `;
    if (existing[0]) return { ok: true, record: mapDecision(existing[0]), referral: fallback };
  }
  const referralRows = await tx<{ version: number; stage: Referral["stage"]; data: unknown; section_versions: unknown }[]>`
    select version, stage, data, section_versions from pipeline.referrals where referral_id = ${referralId} and deleted_at is null for update
  `;
  const row = referralRows[0];
  if (!row) throw new Error("Referral not found.");
  if (Number(row.version) !== expectedVersion
    || normalizeReferralSectionVersions(row.section_versions).decision !== expectedDecisionVersion) {
    return { ok: false, conflict: true, referral: fallback };
  }
  const existingDecisionRows = await tx<{ exists: boolean }[]>`
    select exists(select 1 from pipeline.admission_decisions where referral_id = ${referralId}) as exists
  `;
  if (existingDecisionRows[0]?.exists) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: [{ code: "decision_already_recorded", label: "The final supervisor decision is immutable. Reopen through a governed correction workflow instead." }],
    };
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
  if (!recommendation) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: [{ code: "recommendation_required", label: "An assessor recommendation is required before supervisor review." }],
    };
  }
  const reviewRows = await tx<ReviewRow[]>`
    select review_id, referral_id, assessment_id, assessment_version,
           recommendation_id, recommendation_version, submission_number, status,
           submitted_by, submitted_by_name, submitted_at, due_at,
           assigned_reviewer_id, assigned_reviewer_name, notification_status,
           reviewed_by, reviewed_by_name, reviewed_at, review_note,
           successor_assessment_id, previous_review_id, version, updated_at
    from pipeline.assessment_reviews
    where referral_id = ${referralId}
    order by submission_number desc, review_id desc
    limit 1
    for update
  `;
  const review = reviewRows[0] ? mapReview(reviewRows[0]) : null;
  if (!review || review.status !== "submitted" || review.recommendationId !== recommendation.recommendationId) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: [{ code: "review_not_ready", label: "The latest submitted assessment review is not ready for a final decision." }],
    };
  }

  const decisionRows = await tx<DecisionRow[]>`
    insert into pipeline.admission_decisions (
      referral_id, outcome, reason_code, reason_note, decided_by, decided_by_name,
      decided_at, recommendation_id, decided_by_role, review_id, review_version,
      assessment_id, assessment_version
    ) values (
      ${referralId}, ${input.outcome}, ${input.reasonCode?.trim() || null},
      ${input.reasonNote?.trim() || null}, ${actor.id}, ${actor.name}, now(),
      ${recommendation.recommendationId}::uuid, ${input.decidedByRole ?? null},
      ${review.reviewId}::uuid, ${review.version + 1},
      ${review.assessmentId}, ${review.assessmentVersion}
    )
    returning decision_id, outcome, reason_code, reason_note, decided_by,
              decided_by_name, decided_at, version, recommendation_id, decided_by_role,
              review_id, review_version, assessment_id, assessment_version
  `;
  const decision = mapDecision(decisionRows[0]);
  const resolvedReview = {
    ...review,
    status: input.outcome === "accepted" ? "approved_for_placement" as const : "not_accepted" as const,
    notificationStatus: "acknowledged" as const,
    reviewedBy: actor.id,
    reviewedByName: actor.name,
    reviewedAt: decision.decidedAt,
    reviewNote: decision.reasonNote || undefined,
    version: review.version + 1,
    updatedAt: decision.decidedAt,
  };
  await tx`
    update pipeline.assessment_reviews
    set status = ${resolvedReview.status}, notification_status = 'acknowledged',
        reviewed_by = ${actor.id}, reviewed_by_name = ${actor.name}, reviewed_at = now(),
        review_note = ${decision.reasonNote || null}, version = version + 1, updated_at = now()
    where review_id = ${resolvedReview.reviewId}::uuid and version = ${resolvedReview.version - 1}
  `;
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
        data = ${tx.json({
          ...data,
          admissionDecision: decision,
          assessmentReview: resolvedReview,
        })},
        version = version + 1,
        section_versions = ${tx.json(nextSections)},
        closed_at = case when ${nextStage} in ('Accepted / Admitted', 'Declined') then now() else null end,
        workflow_status = ${input.outcome === "declined" ? "declined" : "approved_for_placement"},
        updated_by = ${actor.id},
        updated_by_name = ${actor.name},
        updated_at = now()
    where referral_id = ${referralId} and version = ${Number(row.version)}
  `;
  await writeWorkflowAudit(
    tx,
    "admission_decision",
    decision.decisionId,
    "admission_decision_recorded",
    actor,
    decision.version,
    ["outcome", "reasonCode", "reasonNote", "recommendationId"],
    "",
  );
  await writeWorkflowAudit(
    tx,
    "assessment_review",
    resolvedReview.reviewId,
    resolvedReview.status === "approved_for_placement"
      ? "assessment_review_approved"
      : "assessment_review_not_accepted",
    actor,
    resolvedReview.version,
    ["status", "reviewNote", "reviewedBy"],
    resolvedReview.reviewNote ?? "",
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
  await saveWorkflowMutation(tx, "admission_decision", mutationId, referralId);
  await bumpRevisions(tx);
  return { ok: true, record: decision, referral: fallback };
}

async function recordPostgresReviewChanges(
  tx: TransactionSql,
  referralId: number,
  currentReview: AssessmentReview,
  reason: string,
  revisionMutationId: string,
  expectedVersion: number,
  expectedDecisionVersion: number,
  actor: ReferralActor,
  fallback: Referral,
  mutationId?: string,
): Promise<WorkflowRecordMutation<AssessmentReview>> {
  if (await lockWorkflowMutation(tx, "assessment_review_changes", mutationId, referralId)) {
    const existing = await tx<ReviewRow[]>`
      select review_id, referral_id, assessment_id, assessment_version,
             recommendation_id, recommendation_version, submission_number, status,
             submitted_by, submitted_by_name, submitted_at, due_at,
             assigned_reviewer_id, assigned_reviewer_name, notification_status,
             reviewed_by, reviewed_by_name, reviewed_at, review_note,
             successor_assessment_id, previous_review_id, version, updated_at
      from pipeline.assessment_reviews
      where review_id = ${currentReview.reviewId}::uuid
    `;
    if (existing[0]) return { ok: true, record: mapReview(existing[0]), referral: fallback };
  }
  const referralRows = await tx<{ version: number; data: unknown; section_versions: unknown }[]>`
    select version, data, section_versions
    from pipeline.referrals
    where referral_id = ${referralId} and deleted_at is null
    for update
  `;
  const referralRow = referralRows[0];
  if (!referralRow) throw new Error("Referral not found.");
  const sections = normalizeReferralSectionVersions(referralRow.section_versions);
  if (Number(referralRow.version) !== expectedVersion || sections.decision !== expectedDecisionVersion) {
    return { ok: false, conflict: true, referral: fallback, record: currentReview };
  }
  const reviewRows = await tx<ReviewRow[]>`
    select review_id, referral_id, assessment_id, assessment_version,
           recommendation_id, recommendation_version, submission_number, status,
           submitted_by, submitted_by_name, submitted_at, due_at,
           assigned_reviewer_id, assigned_reviewer_name, notification_status,
           reviewed_by, reviewed_by_name, reviewed_at, review_note,
           successor_assessment_id, previous_review_id, version, updated_at
    from pipeline.assessment_reviews
    where review_id = ${currentReview.reviewId}::uuid and referral_id = ${referralId}
    for update
  `;
  const storedReview = reviewRows[0] ? mapReview(reviewRows[0]) : null;
  if (!storedReview || storedReview.version !== currentReview.version || storedReview.status !== "submitted") {
    return { ok: false, conflict: true, referral: fallback, record: storedReview ?? currentReview };
  }
  const decisions = await tx<{ exists: boolean }[]>`
    select exists(select 1 from pipeline.admission_decisions where referral_id = ${referralId}) as exists
  `;
  if (decisions[0]?.exists) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: [{ code: "decision_already_recorded", label: "A final supervisor decision has already been recorded." }],
    };
  }
  const revisionResult = await createAssessmentRevisionInTransaction(
    tx,
    currentReview.assessmentId,
    actor,
    revisionMutationId,
  );
  if (!revisionResult) throw new Error("The reviewed assessment no longer exists.");
  if (!revisionResult.ok) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: "blockers" in revisionResult ? revisionResult.blockers : [
        { code: "assessment_revision_conflict", label: "The assessment changed before its correction revision could be created." },
      ],
    };
  }
  const revision = revisionResult.assessment;
  const successorRows = await tx<{ assessment_id: string }[]>`
    select assessment_id
    from pipeline.assessments
    where assessment_id = ${revision.assessment_id}
      and referral_id = ${referralId}
      and supersedes_assessment_id = ${currentReview.assessmentId}
    limit 1
  `;
  if (!successorRows[0]) throw new Error("The correction assessment revision is missing or has invalid lineage.");

  const rows = await tx<ReviewRow[]>`
    update pipeline.assessment_reviews
    set status = 'changes_requested', notification_status = 'acknowledged',
        reviewed_by = ${actor.id}, reviewed_by_name = ${actor.name}, reviewed_at = now(),
        review_note = ${reason},
        successor_assessment_id = ${revision.assessment_id},
        version = version + 1, updated_at = now()
    where review_id = ${currentReview.reviewId}::uuid and version = ${currentReview.version}
    returning review_id, referral_id, assessment_id, assessment_version,
              recommendation_id, recommendation_version, submission_number, status,
              submitted_by, submitted_by_name, submitted_at, due_at,
              assigned_reviewer_id, assigned_reviewer_name, notification_status,
              reviewed_by, reviewed_by_name, reviewed_at, review_note,
              successor_assessment_id, previous_review_id, version, updated_at
  `;
  if (!rows[0]) return { ok: false, conflict: true, referral: fallback, record: currentReview };
  const review = mapReview(rows[0]);
  const data = isRecord(referralRow.data) ? referralRow.data : {};
  await tx`
    update pipeline.referrals
    set workflow_status = 'changes_requested',
        data = ${tx.json({ ...data, assessmentReview: review })},
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
    "assessment_review",
    review.reviewId,
    "assessment_review_changes_requested",
    actor,
    review.version,
    ["status", "reviewNote", "successorAssessmentId"],
    review.reviewNote ?? "",
  );
  await saveWorkflowMutation(tx, "assessment_review_changes", mutationId, referralId);
  await bumpRevisions(tx);
  return { ok: true, record: review, referral: fallback };
}

async function requireDiscardedLocalRevision(
  revision: PipelineAssessmentRecord,
  sourceAssessmentId: string,
  mutationId: string,
) {
  const discarded = await discardUncommittedAssessmentRevision(
    revision.assessment_id,
    sourceAssessmentId,
    mutationId,
  );
  if (!discarded) {
    throw new Error("The rejected assessment correction could not be rolled back safely.");
  }
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
  mutationId?: string,
): Promise<WorkflowRecordMutation<AdmissionRequirement>> {
  if (await lockWorkflowMutation(tx, "work_item_patch", mutationId, referralId)) {
    const existing = await tx<WorkItemRow[]>`
      select work_item_id, type, label, gate, status, owner_id, owner_name, due_at,
             next_action, blocker, evidence_document_id, evidence_document_name, waiver_reason,
             field_key, requested_from, requested_at, follow_up_at, unavailable_reason,
             version, updated_at
      from pipeline.work_items
      where referral_id = ${referralId} and work_item_id = ${workItemId}::uuid
    `;
    if (existing[0]) return { ok: true, record: mapWorkItem(existing[0]), referral: fallback };
  }
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
  await saveWorkflowMutation(tx, "work_item_patch", mutationId, referralId);
  await bumpRevisions(tx);
  return { ok: true, record, referral: fallback };
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

async function lockWorkflowMutation(
  tx: TransactionSql,
  scope: string,
  mutationId: string | undefined,
  referralId: number,
) {
  if (!mutationId) return false;
  await tx`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${mutationId}`}, 0))`;
  const existing = await tx<{ entity_id: string }[]>`
    select entity_id from pipeline.idempotency_keys
    where scope = ${scope} and mutation_id = ${mutationId}
  `;
  return existing[0]?.entity_id === String(referralId);
}

async function saveWorkflowMutation(
  tx: TransactionSql,
  scope: string,
  mutationId: string | undefined,
  referralId: number,
) {
  if (!mutationId) return;
  await tx`
    insert into pipeline.idempotency_keys (scope, mutation_id, entity_type, entity_id)
    values (${scope}, ${mutationId}, 'referral', ${String(referralId)})
    on conflict (scope, mutation_id) do nothing
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
    reviewId: row.review_id ?? undefined,
    reviewVersion: row.review_version === null ? undefined : Number(row.review_version),
    assessmentId: row.assessment_id ?? undefined,
    assessmentVersion: row.assessment_version === null ? undefined : Number(row.assessment_version),
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

function mapReview(row: ReviewRow): AssessmentReview {
  return {
    reviewId: row.review_id,
    referralId: Number(row.referral_id),
    assessmentId: row.assessment_id,
    assessmentVersion: Number(row.assessment_version),
    recommendationId: row.recommendation_id,
    recommendationVersion: Number(row.recommendation_version),
    submissionNumber: Number(row.submission_number),
    status: row.status,
    submittedBy: row.submitted_by,
    submittedByName: row.submitted_by_name,
    submittedAt: toIso(row.submitted_at),
    dueAt: toIso(row.due_at),
    assignedReviewerId: row.assigned_reviewer_id ?? undefined,
    assignedReviewerName: row.assigned_reviewer_name,
    notificationStatus: row.notification_status,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedByName: row.reviewed_by_name ?? undefined,
    reviewedAt: row.reviewed_at ? toIso(row.reviewed_at) : undefined,
    reviewNote: row.review_note ?? undefined,
    successorAssessmentId: row.successor_assessment_id ?? undefined,
    previousReviewId: row.previous_review_id ?? undefined,
    version: Number(row.version),
    updatedAt: toIso(row.updated_at),
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

function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
