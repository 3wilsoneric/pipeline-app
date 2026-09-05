import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { getAssessmentCompletionReport } from "@/lib/assessment/assessment-store";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import { isDocumentRequirementType } from "@/lib/pipeline/document-requirements";
import { getReferralProgress } from "@/lib/pipeline/referral-progress";
import { getAssessmentCalendar } from "@/lib/pipeline/calendar-store";
import {
  type OperationsReportDefinition,
  type OperationsReportColumn,
  type OperationsReportFilters,
  type OperationsReportId,
  type OperationsReportMetric,
  type OperationsReportResponse,
  type OperationsReportResult,
  type OperationsReportRow,
} from "@/lib/pipeline/operations-report-types";
import { getSupervisorExceptionSnapshot } from "@/lib/pipeline/operations-snapshot";
import { canAccessOperationsReports } from "@/lib/pipeline/report-access";
import { isAssessorUser, scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { listReferralFacets, listReferrals } from "@/lib/pipeline/referral-store";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { WorkflowContext } from "@/lib/pipeline/workflow-records";
import { getReferralWorkflowContexts } from "@/lib/pipeline/workflow-store";
import {
  isRequirementResolved,
  type WorkspaceStateProjection,
} from "@/lib/pipeline/workspace-state";

const previewLimit = 500;
const exportLimit = 5_000;

const reportCatalog: OperationsReportDefinition[] = [
  {
    id: "active_referrals",
    label: "Current workflow",
    description: "Current workspaces by assignment, workflow focus, age, and next recorded action.",
    cadence: "Current",
    audience: "Assessment team",
    filters: ["community", "owner"],
  },
  {
    id: "workspace_inventory",
    label: "Workspaces",
    description: "Every accessible workspace with its assignment, location, assessment state, and recorded materials.",
    cadence: "Current",
    audience: "Operations",
    filters: ["community", "owner"],
  },
  {
    id: "document_coverage",
    label: "Documents",
    description: "Recorded files and required-document coverage across accessible workspaces.",
    cadence: "Current",
    audience: "Assessment team",
    filters: ["community", "owner"],
  },
  {
    id: "intake_review",
    label: "Intake extraction review",
    description: "Extracted fields, completed reviews, pending corrections, and conflicts retained on each workspace.",
    cadence: "Current",
    audience: "Assessment team",
    filters: ["community", "owner"],
  },
  {
    id: "assessor_workload",
    label: "Team workload",
    description: "Current assignments, overdue targets, assessment work, and oldest workspace by assessor.",
    cadence: "Current",
    audience: "Supervisors",
    filters: ["community", "owner"],
  },
  {
    id: "missing_documents",
    label: "Missing documents",
    description: "Open referrals still waiting on required packet items.",
    cadence: "Current",
    audience: "Assessment team",
    filters: ["community", "owner"],
  },
  {
    id: "assessment_schedule",
    label: "Assessment calendar",
    description: "Scheduled assessments and follow-ups for the selected month.",
    cadence: "Monthly",
    audience: "Assessment team",
    filters: ["month", "community", "owner"],
  },
  {
    id: "assessment_completion",
    label: "Completed assessments",
    description: "Signed assessments and average completion time by staff member.",
    cadence: "Monthly",
    audience: "Supervisors",
    filters: ["month"],
  },
  {
    id: "decisions",
    label: "Admission decisions",
    description: "Accepted and declined decisions recorded in the selected month.",
    cadence: "Monthly",
    audience: "Supervisors",
    filters: ["month", "community", "owner"],
  },
  {
    id: "ehr_handoff",
    label: "EHR handoff queue",
    description: "Accepted referrals and their current handoff state.",
    cadence: "Current",
    audience: "Operations",
    filters: ["community", "owner"],
  },
  {
    id: "supervisor_exceptions",
    label: "Supervisor exceptions",
    description: "Overdue, blocked, unassigned, failed, or conflicted work.",
    cadence: "Current",
    audience: "Supervisors",
    filters: ["community", "owner"],
    supervisor_only: true,
  },
];

const visibleReportIds = new Set<OperationsReportId>([
  "workspace_inventory",
  "document_coverage",
  "assessment_schedule",
  "assessment_completion",
  "assessor_workload",
]);

export function getOperationsReportCatalog(user: PipelineUser) {
  if (!canAccessOperationsReports(user.roles)) return [];
  return reportCatalog.filter((definition) => (
    visibleReportIds.has(definition.id)
  ));
}

export async function getOperationsReport(
  user: PipelineUser,
  filters: OperationsReportFilters,
  options: { export?: boolean } = {},
): Promise<OperationsReportResponse> {
  if (!canAccessOperationsReports(user.roles)) throw new ReportAccessError();
  const catalog = getOperationsReportCatalog(user);
  const definition = reportCatalog.find((item) => item.id === filters.report_id);
  if (!definition) throw new ReportAccessError();

  const [facets, completeReport] = await Promise.all([
    listReferralFacets("", scopeReferralListOptions(user, {
      workspaceStatus: workspaceScopeForReport(definition.id),
    })),
    buildReport(user, definition, filters),
  ]);
  const limit = options.export ? exportLimit : previewLimit;
  const report: OperationsReportResult = {
    ...completeReport,
    rows: completeReport.rows.slice(0, limit),
    truncated: completeReport.rows.length > limit,
    row_count: completeReport.rows.length,
  };

  return {
    catalog,
    facets: {
      communities: facets.communities,
      owners: facets.owners,
    },
    filters,
    report,
  };
}

export async function recordOperationsReportExport(
  user: PipelineUser,
  response: OperationsReportResponse,
) {
  if (!canAccessOperationsReports(user.roles)) throw new ReportAccessError();
  if (!getPipelineDatabaseReadiness().ready) return;
  const actor = pipelineAuditActor(user);
  const sql = getPipelineSql();
  await sql`
    insert into pipeline.audit_events (
      entity_type, entity_id, action, actor_id, actor_name, changed_fields, metadata
    ) values (
      'operations_report',
      ${`${response.filters.report_id}:${response.filters.month}`},
      'operations_report_exported',
      ${actor.id},
      ${actor.name},
      ${[] as string[]},
      ${sql.json({
        report_id: response.filters.report_id,
        month: response.filters.month,
        community: response.filters.community || null,
        owner: response.filters.owner || null,
        row_count: response.report.row_count,
      })}
    )
  `;
}

export function operationsReportCsv(response: OperationsReportResponse) {
  const header = response.report.columns.map((column) => column.label);
  const rows = response.report.rows.map((row) =>
    response.report.columns.map((column) => row.values[column.key] ?? ""),
  );
  return [header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

export class ReportAccessError extends Error {
  constructor() {
    super("This report is not available for the signed-in role.");
    this.name = "ReportAccessError";
  }
}

async function buildReport(
  user: PipelineUser,
  definition: OperationsReportDefinition,
  filters: OperationsReportFilters,
): Promise<OperationsReportResult> {
  const rows = await reportRows(user, definition.id, filters);
  return {
    definition,
    columns: reportColumns(definition.id),
    metrics: reportMetrics(definition.id, rows),
    rows,
    row_count: rows.length,
    truncated: false,
    generated_at: new Date().toISOString(),
  };
}

async function reportRows(
  user: PipelineUser,
  reportId: OperationsReportId,
  filters: OperationsReportFilters,
): Promise<OperationsReportRow[]> {
  if (reportId === "assessment_schedule") return assessmentScheduleRows(user, filters);
  if (reportId === "assessment_completion") return assessmentCompletionRows(user, filters);
  if (reportId === "supervisor_exceptions") return supervisorExceptionRows(filters);

  const referrals = await loadReportReferrals(user, filters, workspaceScopeForReport(reportId));
  const contexts = await getReferralWorkflowContexts(referrals);
  if (reportId === "active_referrals") return activeReferralRows(referrals, contexts);
  if (reportId === "workspace_inventory") return workspaceInventoryRows(referrals, contexts);
  if (reportId === "document_coverage") return documentCoverageRows(referrals, contexts);
  if (reportId === "intake_review") return intakeReviewRows(referrals);
  if (reportId === "assessor_workload") return assessorWorkloadRows(referrals, contexts);
  if (reportId === "missing_documents") return missingDocumentRows(referrals, contexts);
  if (reportId === "decisions") return decisionRows(referrals, filters.month);
  return ehrHandoffRows(referrals);
}

async function loadReportReferrals(
  user: PipelineUser,
  filters: OperationsReportFilters,
  workspaceStatus: "active" | "all",
) {
  const referrals: Referral[] = [];
  let cursor: string | undefined;
  do {
    const page = await listReferrals(scopeReferralListOptions(user, {
      workspaceStatus,
      community: filters.community || undefined,
      owner: filters.owner || undefined,
      includeTotal: false,
      limit: 200,
      cursor,
    }));
    referrals.push(...page.referrals);
    cursor = page.next_cursor;
  } while (cursor && referrals.length < exportLimit);
  if (cursor) throw new Error("This report exceeds the 5,000-row export limit. Narrow the filters and run it again.");
  return referrals;
}

function workspaceScopeForReport(reportId: OperationsReportId): "active" | "all" {
  return ["workspace_inventory", "document_coverage", "intake_review", "decisions", "ehr_handoff"].includes(reportId)
    ? "all"
    : "active";
}

function activeReferralRows(referrals: Referral[], contexts: Map<number, WorkflowContext>) {
  return referrals
    .map((referral) => ({ referral, progress: getReferralProgress(referral, contexts.get(referral.id)) }))
    .filter(({ progress }) => progress.state.focus !== "complete")
    .map(({ referral, progress }) => {
      return referralRow(referral, {
        client: referral.name,
        community: referral.community,
        status: workspaceFocusLabel(progress.state),
        owner: referral.owner || "Unassigned",
        next_action: progress.next_action ?? "Review referral",
        age_days: ageDays(referral.updatedAt ?? referral.createdAt),
        last_activity: referral.updatedAt ?? referral.createdAt,
      });
    })
    .sort((left, right) => Number(right.values.age_days) - Number(left.values.age_days));
}

function workspaceInventoryRows(referrals: Referral[], contexts: Map<number, WorkflowContext>) {
  return referrals
    .map((referral) => {
      const state = getReferralProgress(referral, contexts.get(referral.id)).state;
      return referralRow(referral, {
        client: referral.name,
        community: referral.community,
        county: referral.county ?? "",
        owner: referral.owner || "Unassigned",
        created: referral.createdAt,
        assessment: assessmentStatusLabel(state),
        materials: recordedMaterialCount(referral),
        updated: referral.updatedAt ?? referral.createdAt,
      });
    })
    .sort((left, right) => String(right.values.updated).localeCompare(String(left.values.updated)));
}

function documentCoverageRows(referrals: Referral[], contexts: Map<number, WorkflowContext>) {
  return referrals.map((referral) => {
    const context = contexts.get(referral.id);
    const progress = getReferralProgress(referral, context);
    const activeIds = new Set(progress.state.active_requirement_ids);
    const requirements = (context?.requirements ?? referral.requirements ?? [])
      .filter((requirement) => activeIds.has(requirement.id) && isDocumentRequirementType(requirement.type));
    const ready = requirements.filter(isRequirementResolved).length;
    const missing = requirements.filter((requirement) => !isRequirementResolved(requirement));
    return referralRow(referral, {
      client: referral.name,
      community: referral.community,
      owner: referral.owner || "Unassigned",
      materials: recordedMaterialCount(referral),
      packet: referral.documentStatus,
      ready: requirements.length ? `${ready} of ${requirements.length}` : "Not configured",
      missing: missing.map((requirement) => requirement.label).join("; "),
      missing_count: missing.length,
    });
  }).sort((left, right) => Number(right.values.missing_count) - Number(left.values.missing_count));
}

function intakeReviewRows(referrals: Referral[]) {
  return referrals.flatMap((referral) => {
    const fields = referral.packetFields ?? [];
    if (!fields.length) return [];
    const reviewed = fields.filter((field) => field.review_status === "accepted" || field.review_status === "edited").length;
    const pending = fields.filter((field) => field.review_status === "pending").length;
    const rejected = fields.filter((field) => field.review_status === "rejected").length;
    const conflicts = fields.filter((field) => field.is_conflict).length;
    return [referralRow(referral, {
      client: referral.name,
      community: referral.community,
      owner: referral.owner || "Unassigned",
      extracted: fields.length,
      reviewed,
      pending,
      rejected,
      conflicts,
      readiness: referral.packetReadiness?.ready ? "Ready" : "Review required",
    })];
  }).sort((left, right) => Number(right.values.pending) - Number(left.values.pending));
}

function assessorWorkloadRows(referrals: Referral[], contexts: Map<number, WorkflowContext>) {
  const owners = new Map<string, Array<{ referral: Referral; state: WorkspaceStateProjection }>>();
  for (const referral of referrals) {
    const state = getReferralProgress(referral, contexts.get(referral.id)).state;
    if (state.focus === "complete") continue;
    const owner = referral.owner?.trim() || "Unassigned";
    owners.set(owner, [...(owners.get(owner) ?? []), { referral, state }]);
  }
  return [...owners.entries()].map(([owner, assignments]) => {
    const overdue = assignments.filter(({ referral }) => isPast(referral.assignmentDueAt)).length;
    const assessmentWork = assignments.filter(({ state }) => (
      ["ready_to_schedule", "scheduled", "assessment"].includes(state.focus)
    )).length;
    const waiting = assignments.filter(({ state }) => state.assessment === "waiting_for_information").length;
    return {
      row_id: `owner:${owner.toLocaleLowerCase()}`,
      referral_id: null,
      client_name: null,
      community: null,
      values: {
        owner,
        assigned: assignments.length,
        assessment_work: assessmentWork,
        waiting,
        overdue,
        oldest_days: Math.max(...assignments.map(({ referral }) => ageDays(referral.createdAt))),
      },
    };
  }).sort((left, right) => Number(right.values.assigned) - Number(left.values.assigned));
}

function missingDocumentRows(referrals: Referral[], contexts: Map<number, WorkflowContext>) {
  return referrals.flatMap((referral) => {
    const context = contexts.get(referral.id);
    const progress = getReferralProgress(referral, context);
    if (progress.state.focus === "complete") return [];
    const missing = missingDocumentRequirements(referral, context, progress.state);
    if (progress.state.outcome === "pending" && referral.documentStatus === "Missing" && missing.length === 0) {
      missing.push("Initial referral packet");
    }
    if (missing.length === 0) return [];
    return [referralRow(referral, {
      client: referral.name,
      community: referral.community,
      missing_documents: missing.join("; "),
      count: missing.length,
      owner: referral.owner || "Unassigned",
      next_action: progress.next_action ?? "Request missing documents",
    })];
  }).sort((left, right) => Number(right.values.count) - Number(left.values.count));
}

async function assessmentScheduleRows(user: PipelineUser, filters: OperationsReportFilters) {
  const { from, to } = monthRange(filters.month);
  const calendar = await getAssessmentCalendar(user, { from, to });
  return calendar.events
    .filter((event) => !filters.community || event.community === filters.community)
    .filter((event) => !filters.owner || event.owner.toLocaleLowerCase() === filters.owner.toLocaleLowerCase())
    .map((event) => ({
      row_id: event.id,
      referral_id: event.referralId,
      client_name: event.clientName,
      community: event.community,
      values: {
        date: event.startsAt ?? event.date,
        client: event.clientName,
        community: event.community,
        owner: event.owner,
        type: event.kind === "assessment" ? "Assessment" : "Follow-up",
        method: scheduleMethodLabel(event.method),
        status: event.status.replaceAll("_", " "),
      },
    }));
}

async function assessmentCompletionRows(user: PipelineUser, filters: OperationsReportFilters) {
  const report = await getAssessmentCompletionReport(filters.month);
  return report.rows
    .filter((row) => !isAssessorUser(user) || row.assessor_id === user.id || row.assessor_name === user.name)
    .map((row) => ({
      row_id: row.assessor_id ?? `legacy:${row.assessor_name}`,
      referral_id: null,
      client_name: null,
      community: null,
      values: {
        staff: row.assessor_name,
        signed: row.completed_assessments,
        average_minutes: row.average_duration_minutes,
      },
    }));
}

function decisionRows(referrals: Referral[], month: string) {
  return referrals.flatMap((referral) => {
    const decision = referral.admissionDecision;
    if (!decision || !decision.decidedAt.startsWith(month)) return [];
    return [referralRow(referral, {
      decision_date: decision.decidedAt,
      client: referral.name,
      community: referral.community,
      outcome: decision.outcome === "accepted" ? "Accepted" : "Declined",
      owner: referral.owner || "Unassigned",
      decided_by: decision.decidedByName,
    })];
  }).sort((left, right) => String(right.values.decision_date).localeCompare(String(left.values.decision_date)));
}

function ehrHandoffRows(referrals: Referral[]) {
  return referrals
    .filter((referral) => referral.stage === "Accepted / Admitted" || referral.admissionDecision?.outcome === "accepted")
    .map((referral) => referralRow(referral, {
      client: referral.name,
      community: referral.community,
      handoff_status: ehrStatusLabel(referral.ehrHandoff?.status ?? "not_ready"),
      owner: referral.owner || "Unassigned",
      updated: referral.ehrHandoff?.updatedAt ?? referral.updatedAt ?? referral.createdAt,
      failure: referral.ehrHandoff?.failureReason ?? "",
    }))
    .sort((left, right) => handoffRank(String(left.values.handoff_status)) - handoffRank(String(right.values.handoff_status)));
}

async function supervisorExceptionRows(filters: OperationsReportFilters) {
  const snapshot = await getSupervisorExceptionSnapshot();
  return snapshot.items
    .filter((item) => !filters.community || item.community === filters.community)
    .filter((item) => !filters.owner || item.owner?.toLocaleLowerCase() === filters.owner.toLocaleLowerCase())
    .map((item) => ({
      row_id: item.id,
      referral_id: item.referral_id,
      client_name: item.client_name,
      community: item.community,
      values: {
        urgency: item.severity === "critical" ? "Critical" : item.severity === "attention" ? "Attention" : "Review",
        issue: item.label,
        client: item.client_name ?? "System queue",
        community: item.community ?? "",
        owner: item.owner ?? "Unassigned",
        due: item.due_at,
      },
    }));
}

function reportColumns(reportId: OperationsReportId): OperationsReportColumn[] {
  if (reportId === "active_referrals") return [
    column("client", "Client"), column("community", "Community"), column("status", "Workflow"),
    column("owner", "Owner"), column("next_action", "Next action"),
    column("age_days", "Age", "right"), column("last_activity", "Last activity", "left", "datetime"),
  ];
  if (reportId === "workspace_inventory") return [
    column("client", "Client"), column("county", "County"), column("community", "Community"),
    column("owner", "Owner"), column("assessment", "Assessment"),
    column("materials", "Documents", "right"), column("created", "Created", "left", "date"),
    column("updated", "Updated", "left", "datetime"),
  ];
  if (reportId === "document_coverage") return [
    column("client", "Client"), column("community", "Community"), column("owner", "Owner"),
    column("materials", "Materials", "right"), column("packet", "Initial packet"),
    column("ready", "Required documents"), column("missing", "Still needed"),
  ];
  if (reportId === "intake_review") return [
    column("client", "Client"), column("community", "Community"), column("owner", "Owner"),
    column("extracted", "Extracted", "right"), column("reviewed", "Reviewed", "right"),
    column("pending", "Pending", "right"), column("rejected", "Rejected", "right"),
    column("conflicts", "Conflicts", "right"), column("readiness", "Readiness"),
  ];
  if (reportId === "assessor_workload") return [
    column("owner", "Assessor"), column("assigned", "Open", "right"),
    column("assessment_work", "Assessment work", "right"), column("waiting", "Waiting", "right"),
    column("overdue", "Overdue", "right"), column("oldest_days", "Oldest", "right"),
  ];
  if (reportId === "missing_documents") return [
    column("client", "Client"), column("community", "Community"), column("missing_documents", "Missing"),
    column("count", "Count", "right"), column("owner", "Owner"), column("next_action", "Next action"),
  ];
  if (reportId === "assessment_schedule") return [
    column("date", "Date and time", "left", "datetime"), column("client", "Client"),
    column("community", "Community"), column("owner", "Assessor"), column("type", "Type"),
    column("method", "Method"), column("status", "Status"),
  ];
  if (reportId === "assessment_completion") return [
    column("staff", "Staff member"), column("signed", "Signed", "right"),
    column("average_minutes", "Average time", "right", "duration"),
  ];
  if (reportId === "decisions") return [
    column("decision_date", "Decision date", "left", "datetime"), column("client", "Client"),
    column("community", "Community"), column("outcome", "Outcome"), column("owner", "Owner"),
    column("decided_by", "Decision maker"),
  ];
  if (reportId === "ehr_handoff") return [
    column("client", "Client"), column("community", "Community"), column("handoff_status", "Handoff"),
    column("owner", "Owner"), column("updated", "Updated", "left", "datetime"), column("failure", "Failure"),
  ];
  return [
    column("urgency", "Urgency"), column("issue", "Issue"), column("client", "Client"),
    column("community", "Community"), column("owner", "Owner"), column("due", "Due", "left", "datetime"),
  ];
}

function reportMetrics(reportId: OperationsReportId, rows: OperationsReportRow[]): OperationsReportMetric[] {
  const sum = (key: string) => rows.reduce((total, row) => total + numericValue(row.values[key]), 0);
  const distinct = (key: string) => new Set(rows.map((row) => String(row.values[key] ?? "").trim()).filter(Boolean)).size;
  if (reportId === "active_referrals") return [
    metric("Current work", rows.length, "Every accessible workspace with recorded work still in motion."),
    metric("Unassigned", countValue(rows, "owner", "Unassigned"), "Current work without a recorded assessor."),
    metric("Communities", distinct("community"), "Distinct destination communities represented."),
    metric("Average age", `${average(rows.map((row) => numericValue(row.values.age_days)))} days`, "Days since the latest recorded workspace activity."),
  ];
  if (reportId === "workspace_inventory") return [
    metric("Workspaces", rows.length, "Every accessible workspace in the current scope."),
    metric("Assigned", percent(rows.length - countValue(rows, "owner", "Unassigned"), rows.length), "Share with a recorded owner."),
    metric("Documents", sum("materials"), "Recorded documents attached to these workspaces."),
    metric("Communities", distinct("community"), "Distinct destination communities represented."),
  ];
  if (reportId === "document_coverage") return [
    metric("Workspaces", rows.length, "Accessible workspaces included in the inventory."),
    metric("With materials", rows.filter((row) => numericValue(row.values.materials) > 0).length, "Workspaces with at least one recorded material."),
    metric("Missing required items", sum("missing_count"), "Open required-document items across these workspaces."),
    metric("Requirements complete", rows.filter((row) => numericValue(row.values.missing_count) === 0).length, "Workspaces with no open configured document requirements."),
  ];
  if (reportId === "intake_review") return [
    metric("Workspaces extracted", rows.length, "Workspaces retaining structured intake extraction."),
    metric("Fields extracted", sum("extracted"), "Structured fields retained from source documents."),
    metric("Pending review", sum("pending"), "Extracted fields still awaiting human review."),
    metric("Conflicts", sum("conflicts"), "Fields with competing extraction candidates."),
  ];
  if (reportId === "assessor_workload") return [
    metric("Current assignments", sum("assigned"), "Current workspace work across the visible team."),
    metric("Assignees", rows.filter((row) => row.values.owner !== "Unassigned").length, "People with at least one current assignment."),
    metric("Assessment work", sum("assessment_work"), "Workspaces ready to schedule through ready to sign."),
    metric("Overdue", sum("overdue"), "Assignments past their recorded assignment target."),
  ];
  if (reportId === "missing_documents") return [
    metric("Workspaces waiting", rows.length, "Current workspaces with at least one missing required document."),
    metric("Required items missing", sum("count"), "Total open document requirements."),
    metric("Unassigned", countValue(rows, "owner", "Unassigned"), "Waiting workspaces without an owner."),
    metric("Communities", distinct("community"), "Communities affected by missing documents."),
  ];
  if (reportId === "assessment_schedule") return [
    metric("Calendar items", rows.length, "Assessments and follow-ups in the selected month."),
    metric("Assessments", countValue(rows, "type", "Assessment"), "Scheduled assessment events."),
    metric("Follow-ups", countValue(rows, "type", "Follow-up"), "Scheduled follow-up events."),
    metric("Assignees", distinct("owner"), "Distinct owners represented on the calendar."),
  ];
  if (reportId === "assessment_completion") return [
    metric("Signed assessments", sum("signed"), "Assessments signed in the selected month."),
    metric("Staff members", rows.length, "Staff with at least one signed assessment."),
    metric("Average time", `${average(rows.map((row) => numericValue(row.values.average_minutes)))} min`, "Unweighted average of the displayed staff averages."),
  ];
  if (reportId === "decisions") return [
    metric("Recorded decisions", rows.length, "Decisions explicitly recorded in the selected month."),
    metric("Accepted", countValue(rows, "outcome", "Accepted"), "Recorded accepted decisions."),
    metric("Declined", countValue(rows, "outcome", "Declined"), "Recorded declined decisions."),
    metric("Decision makers", distinct("decided_by"), "Distinct staff who recorded a decision."),
  ];
  if (reportId === "ehr_handoff") return [
    metric("Accepted workspaces", rows.length, "Accepted or admitted workspaces in the handoff view."),
    metric("Ready", countValue(rows, "handoff_status", "Ready"), "Records explicitly marked ready."),
    metric("Queued", countValue(rows, "handoff_status", "Queued"), "Records explicitly queued."),
    metric("Failed", countValue(rows, "handoff_status", "Failed"), "Recorded handoff failures."),
  ];
  return [
    metric("Exceptions", rows.length, "Current exception records in the supervisor view."),
    metric("Critical", countValue(rows, "urgency", "Critical"), "Exceptions marked critical."),
    metric("Attention", countValue(rows, "urgency", "Attention"), "Exceptions requiring attention."),
    metric("Unassigned", countValue(rows, "owner", "Unassigned"), "Exceptions without a recorded owner."),
  ];
}

function column(
  key: string,
  label: string,
  align: "left" | "right" = "left",
  format?: "date" | "datetime" | "duration",
): OperationsReportColumn {
  return { key, label, align, ...(format ? { format } : {}) };
}

function referralRow(referral: Referral, values: OperationsReportRow["values"]): OperationsReportRow {
  return {
    row_id: `referral:${referral.id}`,
    referral_id: referral.id,
    client_name: referral.name,
    community: referral.community,
    values,
  };
}

function missingDocumentRequirements(
  referral: Referral,
  context: WorkflowContext | undefined,
  state: WorkspaceStateProjection,
) {
  const activeIds = new Set(state.active_requirement_ids);
  return (context?.requirements ?? referral.requirements ?? [])
    .filter((requirement) => (
      activeIds.has(requirement.id)
      && isDocumentRequirementType(requirement.type)
      && !isRequirementResolved(requirement)
    ))
    .map((requirement) => requirement.label);
}

function recordedMaterialCount(referral: Referral) {
  if ((referral.sourceMaterialCount ?? 0) > 0) return referral.sourceMaterialCount ?? 0;
  return referral.documentStatus === "Missing" ? 0 : 1;
}

function assessmentStatusLabel(state: WorkspaceStateProjection) {
  return {
    not_started: "Not started",
    unscheduled: "Not scheduled",
    scheduled: "Scheduled",
    in_progress: "In progress",
    waiting_for_information: "Waiting for information",
    ready_to_sign: "Ready to sign",
    signed: "Signed",
  }[state.assessment];
}

function workspaceFocusLabel(state: WorkspaceStateProjection) {
  if (state.assessment_is_reassessment) {
    if (state.focus === "ready_to_schedule") return "Reassessment to schedule";
    if (state.focus === "scheduled") return "Reassessment scheduled";
    if (state.focus === "assessment") return "Reassessment in progress";
  }
  return {
    ready_to_schedule: state.assignment === "unassigned" ? "Needs assignment" : "Ready to schedule",
    scheduled: "Scheduled",
    assessment: "Assessment in progress",
    follow_up: state.outcome === "accepted" ? "Accepted · follow-up" : "Follow-up",
    complete: "Complete",
  }[state.focus];
}

function isPast(value?: string) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

function numericValue(value: string | number | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function countValue(rows: OperationsReportRow[], key: string, expected: string) {
  return rows.filter((row) => String(row.values[key] ?? "") === expected).length;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function percent(numerator: number, denominator: number) {
  return denominator ? `${Math.round((numerator / denominator) * 100)}%` : "0%";
}

function metric(label: string, value: string | number, detail: string): OperationsReportMetric {
  return { label, value: String(value), detail };
}

function monthRange(month: string) {
  const from = `${month}-01`;
  const end = new Date(`${from}T00:00:00.000Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { from, to: end.toISOString().slice(0, 10) };
}

function ageDays(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000)) : 0;
}

function scheduleMethodLabel(value?: string) {
  return {
    in_person: "In person",
    phone: "Phone",
    zoom: "Zoom",
    video: "Zoom",
    record_review: "Record review",
  }[value ?? ""] ?? "Not set";
}

function ehrStatusLabel(value: string) {
  return {
    not_ready: "Not ready",
    ready: "Ready",
    queued: "Queued",
    sent: "Sent",
    failed: "Failed",
  }[value] ?? "Not ready";
}

function handoffRank(value: string) {
  const ranks: Record<string, number> = { Failed: 0, Ready: 1, Queued: 2, "Not ready": 3, Sent: 4 };
  return ranks[value] ?? 5;
}

function csvCell(value: string | number | null) {
  let text = value === null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
