import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { getAssessmentCompletionReport } from "@/lib/assessment/assessment-store";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import { getReferralProgress } from "@/lib/pipeline/referral-progress";
import { getAssessmentCalendar } from "@/lib/pipeline/calendar-store";
import {
  type OperationsReportDefinition,
  type OperationsReportColumn,
  type OperationsReportFilters,
  type OperationsReportId,
  type OperationsReportResponse,
  type OperationsReportResult,
  type OperationsReportRow,
} from "@/lib/pipeline/operations-report-types";
import { getSupervisorExceptionSnapshot } from "@/lib/pipeline/operations-snapshot";
import { isAssessorUser, scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { listReferralFacets, listReferrals } from "@/lib/pipeline/referral-store";
import { getStageLabel, isClosedReferralStage } from "@/lib/pipeline/referral-workflow";
import type { AdmissionRequirement, Referral } from "@/lib/pipeline/referral-types";
import { resolveReferralWorkflowStatus, workflowStatusLabels } from "@/lib/pipeline/workflow-status";

const previewLimit = 500;
const exportLimit = 5_000;

const reportCatalog: OperationsReportDefinition[] = [
  {
    id: "active_referrals",
    label: "Active referrals",
    description: "Current owner, stage, next action, and age.",
    filters: ["community", "owner"],
  },
  {
    id: "missing_documents",
    label: "Missing documents",
    description: "Open referrals still waiting on required packet items.",
    filters: ["community", "owner"],
  },
  {
    id: "assessment_schedule",
    label: "Assessment schedule",
    description: "Scheduled assessments and follow-ups for the selected month.",
    filters: ["month", "community", "owner"],
  },
  {
    id: "assessment_completion",
    label: "Assessment completion",
    description: "Signed assessments and average completion time by staff member.",
    filters: ["month"],
  },
  {
    id: "decisions",
    label: "Admission decisions",
    description: "Accepted and declined decisions recorded in the selected month.",
    filters: ["month", "community", "owner"],
  },
  {
    id: "ehr_handoff",
    label: "EHR handoff queue",
    description: "Accepted referrals and their current handoff state.",
    filters: ["community", "owner"],
  },
  {
    id: "supervisor_exceptions",
    label: "Supervisor exceptions",
    description: "Overdue, blocked, unassigned, failed, or conflicted work.",
    filters: ["community", "owner"],
    supervisor_only: true,
  },
];

const documentRequirementTypes = new Set([
  "medication_list",
  "tb_test",
  "signed_admission_agreement",
  "conservatorship_document",
  "lic_602",
  "lic_601_603",
  "provider_form",
  "face_sheet",
]);

export function getOperationsReportCatalog(user: PipelineUser) {
  const supervisor = user.roles.some((role) => role === "admin" || role === "assessment_coordinator");
  return reportCatalog.filter((definition) => !definition.supervisor_only || supervisor);
}

export async function getOperationsReport(
  user: PipelineUser,
  filters: OperationsReportFilters,
  options: { export?: boolean } = {},
): Promise<OperationsReportResponse> {
  const catalog = getOperationsReportCatalog(user);
  const definition = catalog.find((item) => item.id === filters.report_id);
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
  if (!getPipelineDatabaseReadiness().ready) return;
  const sql = getPipelineSql();
  await sql`
    insert into pipeline.audit_events (
      entity_type, entity_id, action, actor_id, actor_name, changed_fields, metadata
    ) values (
      'operations_report',
      ${`${response.filters.report_id}:${response.filters.month}`},
      'operations_report_exported',
      ${user.id},
      ${user.name},
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
  if (reportId === "active_referrals") return activeReferralRows(referrals);
  if (reportId === "missing_documents") return missingDocumentRows(referrals);
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
  return ["decisions", "ehr_handoff"].includes(reportId) ? "all" : "active";
}

function activeReferralRows(referrals: Referral[]) {
  return referrals
    .filter((referral) => !isClosedReferralStage(referral.stage))
    .map((referral) => {
      const workflowStatus = referral.workflowStatus ?? resolveReferralWorkflowStatus(referral);
      const progress = getReferralProgress(referral);
      return referralRow(referral, {
        client: referral.name,
        community: referral.community,
        stage: getStageLabel(referral.stage),
        status: workflowStatusLabels[workflowStatus],
        owner: referral.owner || "Unassigned",
        next_action: progress.next_action ?? "Review referral",
        age_days: ageDays(referral.updatedAt ?? referral.createdAt),
        last_activity: referral.updatedAt ?? referral.createdAt,
      });
    })
    .sort((left, right) => Number(right.values.age_days) - Number(left.values.age_days));
}

function missingDocumentRows(referrals: Referral[]) {
  return referrals.flatMap((referral) => {
    if (isClosedReferralStage(referral.stage)) return [];
    const missing = missingDocumentRequirements(referral);
    if (referral.documentStatus === "Missing" && missing.length === 0) missing.push("Initial referral packet");
    if (missing.length === 0) return [];
    const progress = getReferralProgress(referral);
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
    column("client", "Client"), column("community", "Community"), column("stage", "Stage"),
    column("status", "Status"), column("owner", "Owner"), column("next_action", "Next action"),
    column("age_days", "Age", "right"), column("last_activity", "Last activity", "left", "datetime"),
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

function missingDocumentRequirements(referral: Referral) {
  return (referral.requirements ?? [])
    .filter((requirement) => documentRequirementTypes.has(requirement.type) && isRequirementOpen(requirement))
    .map((requirement) => requirement.label);
}

function isRequirementOpen(requirement: AdmissionRequirement) {
  return !["received", "reviewed", "waived", "not_applicable"].includes(requirement.status);
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
