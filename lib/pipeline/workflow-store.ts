import "server-only";

import { randomUUID } from "node:crypto";

import type { TransactionSql } from "postgres";

import { listAssessments } from "@/lib/assessment/assessment-store";
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
  EhrHandoffRecord,
  Referral,
} from "@/lib/pipeline/referral-types";
import { normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import { normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import type {
  AdmissionDecisionInput,
  WorkflowContext,
  WorkItemPatch,
} from "@/lib/pipeline/workflow-records";

export type ReferralWorkflowSnapshot = {
  referral: Referral;
  context: WorkflowContext;
  work_items: AdmissionRequirement[];
  decision: AdmissionDecision | null;
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
  owner_name: string | null;
  due_at: Date | string | null;
  next_action: string;
  blocker: boolean;
  evidence_document_id: string | null;
  evidence_document_name: string | null;
  waiver_reason: string | null;
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
};

export async function getReferralWorkflowSnapshot(referralId: number): Promise<ReferralWorkflowSnapshot | null> {
  const referral = await getReferral(referralId);
  if (!referral) return null;

  if (getReferralStoreReadiness().mode !== "postgres") {
    const assessments = await listAssessments({ referralId, limit: 100 });
    const decision = referral.admissionDecision ?? legacyDecision(referral);
    const workItems = referral.requirements ?? [];
    return {
      referral,
      work_items: workItems,
      decision,
      context: {
        assessmentExists: assessments.assessments.length > 0 || Boolean(referral.assessment),
        assessmentComplete: assessments.assessments.some((assessment) => assessment.status === "complete") || Boolean(referral.assessment?.completedAt),
        assessmentDate: assessments.assessments[0]?.assessment_date ?? referral.assessment?.scheduledDate ?? null,
        requirements: workItems,
        decision,
      },
    };
  }

  const sql = getPipelineSql();
  const [workItemRows, decisionRows, assessmentRows] = await Promise.all([
    sql<WorkItemRow[]>`
      select work_item_id, type, label, gate, status, owner_name, due_at,
             next_action, blocker, evidence_document_id, evidence_document_name, waiver_reason, version, updated_at
      from pipeline.work_items
      where referral_id = ${referralId}
      order by created_at, work_item_id
    `,
    sql<DecisionRow[]>`
      select decision_id, outcome, reason_code, reason_note, decided_by,
             decided_by_name, decided_at, version
      from pipeline.admission_decisions
      where referral_id = ${referralId}
      limit 1
    `,
    sql<{ assessment_count: number | string; complete: boolean; assessment_date: Date | string | null }[]>`
      select count(*) as assessment_count,
             coalesce(bool_or(status = 'complete'), false) as complete,
             max(assessment_date) as assessment_date
      from pipeline.assessments where referral_id = ${referralId}
    `,
  ]);
  const workItems = workItemRows.length > 0 ? workItemRows.map(mapWorkItem) : referral.requirements ?? [];
  const decision = decisionRows[0] ? mapDecision(decisionRows[0]) : referral.admissionDecision ?? legacyDecision(referral);

  return {
    referral,
    work_items: workItems,
    decision,
    context: {
      assessmentExists: Number(assessmentRows[0]?.assessment_count ?? 0) > 0 || Boolean(referral.assessment),
      assessmentComplete: assessmentRows[0]?.complete || Boolean(referral.assessment?.completedAt),
      assessmentDate: assessmentRows[0]?.assessment_date ? toIso(assessmentRows[0].assessment_date).slice(0, 10) : referral.assessment?.scheduledDate ?? null,
      requirements: workItems,
      decision,
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
  const [workItemRows, decisionRows, assessmentRows] = await Promise.all([
    sql<(WorkItemRow & { referral_id: number | string })[]>`
      select referral_id, work_item_id, type, label, gate, status, owner_name, due_at,
             next_action, blocker, evidence_document_name, waiver_reason, version, updated_at
      from pipeline.work_items where referral_id = any(${ids}::bigint[])
      order by referral_id, created_at, work_item_id
    `,
    sql<(DecisionRow & { referral_id: number | string })[]>`
      select referral_id, decision_id, outcome, reason_code, reason_note, decided_by,
             decided_by_name, decided_at, version
      from pipeline.admission_decisions where referral_id = any(${ids}::bigint[])
    `,
    sql<{ referral_id: number | string; assessment_count: number | string; complete: boolean; assessment_date: Date | string | null }[]>`
      select referral_id, count(*) as assessment_count, bool_or(status = 'complete') as complete, max(assessment_date) as assessment_date
      from pipeline.assessments where referral_id = any(${ids}::bigint[])
      group by referral_id
    `,
  ]);

  for (const referral of referrals) {
    const workItems = workItemRows
      .filter((row) => Number(row.referral_id) === referral.id)
      .map(mapWorkItem);
    const decisionRow = decisionRows.find((row) => Number(row.referral_id) === referral.id);
    const assessmentRow = assessmentRows.find((row) => Number(row.referral_id) === referral.id);
    contexts.set(referral.id, {
      assessmentExists: Number(assessmentRow?.assessment_count ?? 0) > 0 || Boolean(referral.assessment),
      assessmentComplete: assessmentRow?.complete || Boolean(referral.assessment?.completedAt),
      assessmentDate: assessmentRow?.assessment_date ? toIso(assessmentRow.assessment_date).slice(0, 10) : referral.assessment?.scheduledDate ?? null,
      requirements: workItems.length > 0 ? workItems : referral.requirements ?? [],
      decision: decisionRow ? mapDecision(decisionRow) : referral.admissionDecision ?? legacyDecision(referral),
    });
  }
  return contexts;
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
    { stage: targetStage },
    expectedVersion,
    actor,
    { workflow: expectedWorkflowVersion },
  );
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
  if (!snapshot.context.assessmentComplete) {
    return {
      ok: false,
      blocked: true,
      referral: snapshot.referral,
      blockers: [{ code: "assessment_required", label: "Complete the assessment before recording the admission decision." }],
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
    };
    const mutation = await patchReferral(
      referralId,
      { admissionDecision: decision },
      expectedVersion,
      actor,
      { decision: expectedDecisionVersion },
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
): Promise<WorkflowRecordMutation<AdmissionRequirement> | null> {
  const snapshot = await getReferralWorkflowSnapshot(referralId);
  if (!snapshot) return null;
  const current = snapshot.work_items.find((item) => item.id === workItemId);
  if (!current) return null;
  if ((current.version ?? 1) !== expectedVersion) {
    return { ok: false, conflict: true, referral: snapshot.referral, record: current };
  }

  const next = normalizeWorkItem({
    ...current,
    ...patch,
    id: current.id,
    version: (current.version ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  });
  const blocker = validateWorkItem(next);
  if (blocker) {
    return { ok: false, blocked: true, referral: snapshot.referral, blockers: [blocker] };
  }

  if (getReferralStoreReadiness().mode !== "postgres") {
    const requirements = snapshot.work_items.map((item) => item.id === workItemId ? next : item);
    const mutation = await patchReferral(
      referralId,
      { requirements },
      snapshot.referral.version,
      actor,
    );
    if (!mutation) return null;
    if (!mutation.ok) {
      if ("conflict" in mutation) return { ok: false, conflict: true, referral: mutation.referral, record: current };
      return { ok: false, blocked: true, referral: mutation.referral, blockers: mutation.blockers };
    }
    return { ok: true, record: next, referral: mutation.referral };
  }

  const sql = getPipelineSql();
  const result = await sql.begin(async (tx) => patchPostgresWorkItem(tx, referralId, workItemId, current, next, expectedVersion, actor, snapshot.referral));
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

async function recordPostgresDecision(
  tx: TransactionSql,
  referralId: number,
  input: AdmissionDecisionInput,
  expectedDecisionVersion: number,
  actor: ReferralActor,
  fallback: Referral,
): Promise<WorkflowRecordMutation<AdmissionDecision>> {
  const referralRows = await tx<{ version: number; data: unknown; section_versions: unknown }[]>`
    select version, data, section_versions from pipeline.referrals where referral_id = ${referralId} for update
  `;
  const row = referralRows[0];
  if (!row) throw new Error("Referral not found.");
  if (normalizeReferralSectionVersions(row.section_versions).decision !== expectedDecisionVersion) {
    return { ok: false, conflict: true, referral: fallback };
  }
  const assessmentRows = await tx<{ complete: boolean }[]>`
    select exists(
      select 1 from pipeline.assessments
      where referral_id = ${referralId} and status = 'complete'
    ) as complete
  `;
  const data = isRecord(row.data) ? row.data : {};
  const legacyAssessment = isRecord(data.assessment) ? data.assessment : null;
  if (!assessmentRows[0]?.complete && !legacyAssessment?.completedAt) {
    return {
      ok: false,
      blocked: true,
      referral: fallback,
      blockers: [{ code: "assessment_required", label: "Complete the assessment before recording the admission decision." }],
    };
  }

  const decisionRows = await tx<DecisionRow[]>`
    insert into pipeline.admission_decisions (
      referral_id, outcome, reason_code, reason_note, decided_by, decided_by_name, decided_at
    ) values (
      ${referralId}, ${input.outcome}, ${input.reasonCode?.trim() || null},
      ${input.reasonNote?.trim() || null}, ${actor.id}, ${actor.name}, now()
    )
    on conflict (referral_id) do update set
      outcome = excluded.outcome,
      reason_code = excluded.reason_code,
      reason_note = excluded.reason_note,
      decided_by = excluded.decided_by,
      decided_by_name = excluded.decided_by_name,
      decided_at = now(),
      version = pipeline.admission_decisions.version + 1,
      updated_at = now()
    returning decision_id, outcome, reason_code, reason_note, decided_by,
              decided_by_name, decided_at, version
  `;
  const decision = mapDecision(decisionRows[0]);
  await tx`
    update pipeline.referrals
    set data = ${tx.json({ ...data, admissionDecision: decision })},
        version = version + 1,
        section_versions = jsonb_set(
          section_versions,
          '{decision}',
          to_jsonb(coalesce((section_versions->>'decision')::integer, 1) + 1)
        ),
        updated_by = ${actor.id},
        updated_by_name = ${actor.name},
        updated_at = now()
    where referral_id = ${referralId} and version = ${Number(row.version)}
  `;
  await writeWorkflowAudit(tx, "admission_decision", decision.decisionId, "admission_decision_recorded", actor, decision.version, ["outcome", "reasonCode", "reasonNote"]);
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
): Promise<WorkflowRecordMutation<AdmissionRequirement>> {
  const referralRows = await tx<{ version: number; data: unknown }[]>`
    select version, data from pipeline.referrals where referral_id = ${referralId} for update
  `;
  if (!referralRows[0]) throw new Error("Referral not found.");
  const rows = await tx<WorkItemRow[]>`
    update pipeline.work_items
    set status = ${next.status}, owner_name = ${next.owner || null},
        due_at = ${next.dueAt ? new Date(next.dueAt) : null}, next_action = ${next.nextStep},
        blocker = ${next.blocker}, evidence_document_id = ${next.evidenceDocumentId ?? null}::uuid,
        evidence_document_name = ${next.evidenceDocumentName ?? null},
        waiver_reason = ${next.waiverReason ?? null}, version = version + 1, updated_at = now()
    where referral_id = ${referralId} and work_item_id = ${workItemId}::uuid and version = ${expectedVersion}
    returning work_item_id, type, label, gate, status, owner_name, due_at,
              next_action, blocker, evidence_document_id, evidence_document_name, waiver_reason, version, updated_at
  `;
  if (!rows[0]) {
    const currentRows = await tx<WorkItemRow[]>`
      select work_item_id, type, label, gate, status, owner_name, due_at,
             next_action, blocker, evidence_document_id, evidence_document_name, waiver_reason, version, updated_at
      from pipeline.work_items
      where referral_id = ${referralId} and work_item_id = ${workItemId}::uuid
    `;
    return { ok: false, conflict: true, referral: fallback, record: currentRows[0] ? mapWorkItem(currentRows[0]) : undefined };
  }
  const record = mapWorkItem(rows[0]);
  const allRows = await tx<WorkItemRow[]>`
    select work_item_id, type, label, gate, status, owner_name, due_at,
           next_action, blocker, evidence_document_id, evidence_document_name, waiver_reason, version, updated_at
    from pipeline.work_items where referral_id = ${referralId} order by created_at, work_item_id
  `;
  const data = isRecord(referralRows[0].data) ? referralRows[0].data : {};
  await tx`
    update pipeline.referrals
    set data = ${tx.json({ ...data, requirements: allRows.map(mapWorkItem) })},
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
  );
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
) {
  await tx`
    insert into pipeline.audit_events (
      entity_type, entity_id, action, actor_id, actor_name,
      from_version, to_version, changed_fields
    ) values (
      ${entityType}, ${entityId}, ${action}, ${actor.id}, ${actor.name},
      ${version > 1 ? version - 1 : null}, ${version}, ${changedFields}
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
    owner: row.owner_name ?? "",
    dueAt: row.due_at ? toIso(row.due_at) : "",
    nextStep: row.next_action,
    blocker: row.blocker,
    evidenceDocumentId: row.evidence_document_id ?? undefined,
    evidenceDocumentName: row.evidence_document_name ?? undefined,
    waiverReason: row.waiver_reason ?? undefined,
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
    owner: normalizeOwnerName(item.owner),
    dueAt: item.dueAt,
    nextStep: item.nextStep.trim(),
    evidenceDocumentId: item.evidenceDocumentId?.trim() || undefined,
    evidenceDocumentName: item.evidenceDocumentName?.trim() || undefined,
    waiverReason: item.waiverReason?.trim() || undefined,
  };
}

function validateWorkItem(item: AdmissionRequirement) {
  if (item.status === "waived" && !item.waiverReason) {
    return { code: "waiver_reason_required", label: "Record why this requirement is being waived." };
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
      item.requiredFor === "ehr_export" && item.blocker && !["received", "reviewed", "waived"].includes(item.status),
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
  ];
  return fields.filter((field) => current[field] !== next[field]);
}

function getWorkItemAuditAction(
  current: AdmissionRequirement,
  next: AdmissionRequirement,
  changedFields: Array<keyof AdmissionRequirement>,
) {
  if (next.status === "waived" && current.status !== "waived") return "work_item_waived";
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
