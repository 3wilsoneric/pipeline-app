import "server-only";

import { admissionFlowCohort, admissionFlowStartDate } from "./admission-flow-cohort";
export { admissionFlowCohort } from "./admission-flow-cohort";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { getAssessmentCompletionReport, listAssessments } from "@/lib/assessment/assessment-store";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { ClinicalDataError, getClinicalRoster } from "@/lib/clinical/clinical-data";
import type { ClinicalResident } from "@/lib/clinical/clinical-contracts";
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
  isClientDataReport,
  clientDataReportIds,
} from "@/lib/pipeline/operations-report-types";
import { getSupervisorExceptionSnapshot } from "@/lib/pipeline/operations-snapshot";
import { canAccessExecutiveAdmissionFlow, canAccessOperationsReports } from "@/lib/pipeline/report-access";
import { scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { getReferralStoreReadiness, listLocalReferralAuditEvents, listReferralFacets, listReferrals, listReferralFiles } from "@/lib/pipeline/referral-store";
import type { Referral } from "@/lib/pipeline/referral-types";
import { workflowStatusLabels } from "@/lib/pipeline/workflow-status";
import { normalizeCalendarDate } from "@/lib/pipeline/calendar-date";
import { admissionFlowToday } from "@/lib/pipeline/admission-flow-day";
import { getConfirmedReferralClinicalIdentities } from "./client-workspace-store";
import { buildClientDataReport, reviewedReportFields, type ClientReportEvidence } from "./client-data-reports";
import { listReferralContacts } from "./contact-store";
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
    id: "clients_by_community", label: "Clients by community",
    description: "Distinct clients by known community. Monthly views use documented admission dates, not workspace creation dates.",
    cadence: "Current", audience: "Supervisors", filters: ["month", "community", "county", "client_scope"],
  },
  {
    id: "referral_sources", label: "Referral sources",
    description: "Documented referring facilities and contacts, with distinct clients and their referral episodes.",
    cadence: "Current", audience: "Supervisors", filters: ["month", "community", "county", "client_scope"],
  },
  {
    id: "client_care_needs", label: "Client care needs",
    description: "Recorded care needs from reviewed fields, signed assessments, and resident profiles.",
    cadence: "Current", audience: "Supervisors", filters: ["community", "county", "client_scope", "care_topic"],
  },
  {
    id: "chart_completeness", label: "Chart completeness",
    description: "Core chart fields, linked documents, signed assessments, and applicable document requirements by client.",
    cadence: "Current", audience: "Supervisors", filters: ["community", "county", "client_scope"],
  },
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
    label: "Assessor workload",
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
    description: "Signed assessments and linked Accepted decisions by staff member. Accepted is recorded to date.",
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
    id: "admission_flow", label: "Admission flow",
    description: "Received-to-actual-admission timing, current waits, recorded holds, and date coverage. Planned moves and acceptance are not admissions.",
    cadence: "Current", audience: "Executives", filters: ["month", "community", "owner"], supervisor_only: true,
  },
  {
    id: "ehr_handoff",
    label: "ElderMark entry status",
    description: "Accepted referrals and their manually recorded ElderMark entry status.",
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

const visibleReportIds: OperationsReportId[] = [
  ...clientDataReportIds,
  "assessment_completion",
  "assessor_workload",
  "assessment_schedule",
  "decisions",
  "admission_flow",
];

export function getOperationsReportCatalog(user: PipelineUser) {
  if (!canAccessOperationsReports(user)) return [];
  return visibleReportIds.flatMap((id) => reportCatalog.filter((definition) => definition.id === id &&
    (id !== "admission_flow" || canAccessExecutiveAdmissionFlow(user))));
}

export async function getOperationsReport(
  user: PipelineUser,
  filters: OperationsReportFilters,
  options: { export?: boolean; request?: Request } = {},
): Promise<OperationsReportResponse> {
  if (!canAccessOperationsReports(user)) throw new ReportAccessError();
  if (filters.report_id === "admission_flow" && !canAccessExecutiveAdmissionFlow(user)) throw new ReportAccessError();
  const catalog = getOperationsReportCatalog(user);
  const definition = reportCatalog.find((item) => item.id === filters.report_id);
  if (!definition) throw new ReportAccessError();

  if (isClientDataReport(definition.id)) {
    const referrals = await loadReportReferrals(user, { ...filters, community: "", owner: "" }, "all");
    const evidence = await clientReportEvidence(referrals, definition.id);
    const { residents, notes } = await reportResidents(options.request, definition.id);
    const identities = await getConfirmedReferralClinicalIdentities(referrals);
    for (const [id, identity] of identities) {
      const item = evidence.get(id);
      if (item) item.residentKey = identity.residentKey;
    }
    const { counties, communities, ...completeReport } = buildClientDataReport(definition, filters, referrals, evidence, residents, notes);
    const limit = exportLimit;
    if (completeReport.rows.length > exportLimit) throw new Error("This report exceeds the 5,000-row limit. Narrow the filters and run it again.");
    return {
      catalog, filters,
      facets: { communities, counties, owners: [] },
      report: { ...completeReport, rows: completeReport.rows.slice(0, limit), truncated: completeReport.rows.length > limit },
    };
  }

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
  if (!canAccessOperationsReports(user)) throw new ReportAccessError();
  if (response.filters.report_id === "admission_flow" && !canAccessExecutiveAdmissionFlow(user)) throw new ReportAccessError();
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
        county: response.filters.county || null,
        client_scope: response.filters.client_scope ?? null,
        care_topic: response.filters.care_topic ?? null,
        row_count: response.report.row_count,
      })}
    )
  `;
}

async function reportResidents(request: Request | undefined, reportId: OperationsReportId) {
  if (!["clients_by_community", "client_care_needs"].includes(reportId)) return { residents: [], notes: [] };
  try {
    return await readReportResidents(request);
  } catch (error) {
    if (!(error instanceof ClinicalDataError)) throw error;
    return { residents: [], notes: ["Resident data is unavailable. This report includes client workspaces only."] };
  }
}

async function readReportResidents(request: Request | undefined) {
    const residents: ClinicalResident[] = [];
    const notes: string[] = [];
    let cursor: string | undefined;
    let snapshot: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await getClinicalRoster(request, { limit: 200, cursor });
      appendResidentReportPage(residents, notes, page, snapshot, seen);
      snapshot = page.snapshot_id;
      cursor = page.next_cursor ?? undefined;
      if (cursor) seen.add(cursor);
    } while (cursor);
    return { residents, notes };
}

function appendResidentReportPage(residents: ClinicalResident[], notes: string[], page: Awaited<ReturnType<typeof getClinicalRoster>>, snapshot: string | undefined, seen: Set<string>) {
  if (snapshot && snapshot !== page.snapshot_id) throw new Error("Resident data changed while the report loaded. Run it again.");
  residents.push(...page.residents);
  if (page.freshness.warning && !notes.includes(page.freshness.warning)) notes.push(page.freshness.warning);
  if (!notes.some((note) => note.startsWith("Resident data as of"))) notes.push(`Resident data as of ${page.data_as_of}.`);
  if (page.next_cursor && (seen.has(page.next_cursor) || residents.length >= exportLimit)) throw new Error("The resident report exceeds its supported size or pagination is invalid.");
}

async function clientReportEvidence(referrals: Referral[], reportId: OperationsReportId) {
  const evidence = new Map<number, ClientReportEvidence>(referrals.map((referral) => [referral.id, {
    fields: reviewedReportFields(referral.packetFields ?? []), documentCount: 0, requirements: referral.requirements ?? [],
  }]));
  if (!referrals.length || reportId === "clients_by_community") return evidence;
  if (getReferralStoreReadiness().mode !== "postgres") {
    await populateLocalReportEvidence(referrals, reportId, evidence);
  } else {
    await populatePostgresReportEvidence(referrals, reportId, evidence);
  }
  return evidence;
}

async function populateLocalReportEvidence(referrals: Referral[], reportId: OperationsReportId, evidence: Map<number, ClientReportEvidence>) {
    if (reportId === "referral_sources") {
      for (const referral of referrals) {
        const contact = (await listReferralContacts(referral.id)).find((item) => item.role === "referral_source");
        if (contact) evidence.get(referral.id)!.fields["report.referral_source"] = contact.contact.organization || `${contact.contact.firstName} ${contact.contact.lastName}`.trim();
      }
      return;
    }
    await localReportDocumentCounts(referrals, evidence);
    await localReportAssessments(evidence);
}

async function localReportDocumentCounts(referrals: Referral[], evidence: Map<number, ClientReportEvidence>) {
    let cursor: string | undefined;
    const filesByClient = new Map<string, Set<string>>();
    do {
      const page = await listReferralFiles({ limit: 200, cursor });
      for (const file of page.files) {
        if (file.identityStatus && file.identityStatus !== "linked") continue;
        const ref = referrals.find((item) => item.id === file.referralId);
        const key = reportFileClientKey(file, ref);
        if (!key) continue;
        const files = filesByClient.get(key) ?? new Set<string>();
        files.add(file.id);
        filesByClient.set(key, files);
      }
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    for (const referral of referrals) evidence.get(referral.id)!.documentCount = filesByClient.get(referral.clientId ?? `referral:${referral.id}`)?.size ?? 0;
}

function reportFileClientKey(file: Awaited<ReturnType<typeof listReferralFiles>>["files"][number], ref: Referral | undefined) {
  return file.clientId ?? ref?.clientId ?? (ref ? `referral:${ref.id}` : "");
}

async function localReportAssessments(evidence: Map<number, ClientReportEvidence>) {
    let cursor: string | undefined;
    do {
      const page = await listAssessments({ limit: 200, cursor });
      for (const assessment of page.assessments) {
        const item = assessment.referral_id ? evidence.get(assessment.referral_id) : undefined;
        if (item && assessment.status === "complete" && assessment.signed_at && (!item.assessment || String(assessment.signed_at) > String(item.assessment.signed_at))) item.assessment = assessment;
      }
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
}

async function populatePostgresReportEvidence(referrals: Referral[], reportId: OperationsReportId, evidence: Map<number, ClientReportEvidence>) {
  const ids = referrals.map((referral) => referral.id);
  await postgresReportFields(ids, evidence);
  if (reportId === "referral_sources") return postgresReportSources(ids, evidence);
  if (reportId === "chart_completeness") await postgresReportDocumentCounts(ids, evidence);
  await postgresReportAssessments(ids, evidence);
  if (reportId === "chart_completeness") {
    const contexts = await getReferralWorkflowContexts(referrals);
    for (const [id, item] of evidence) item.requirements = contexts.get(id)?.requirements ?? [];
  }
}

async function postgresReportFields(ids: number[], evidence: Map<number, ClientReportEvidence>) {
  const sql = getPipelineSql();
  const fields = await sql<{ referral_id: number | string; field_key: string; final_value: unknown }[]>`
    select field.referral_id, field.field_key, field.final_value
    from pipeline.referral_fields field
    left join pipeline.documents source on source.document_id = field.source_document_id
    where field.referral_id = any(${ids}::bigint[])
      and field.review_status in ('confirmed', 'edited')
      and field.final_value is not null
      and (field.source_document_id is null or source.deleted_at is null)
  `;
  for (const field of fields) evidence.get(Number(field.referral_id))!.fields[field.field_key] = field.final_value;
}

async function postgresReportSources(ids: number[], evidence: Map<number, ClientReportEvidence>) {
    const sql = getPipelineSql();
    const contacts = await sql<{ referral_id: number | string; source: string }[]>`
      select distinct on (link.referral_id) link.referral_id,
        coalesce(nullif(btrim(contact.organization), ''), btrim(concat_ws(' ', contact.first_name, contact.last_name))) as source
      from pipeline.referral_contacts link join pipeline.contacts contact using (contact_id)
      where link.referral_id = any(${ids}::bigint[]) and link.role = 'referral_source'
      order by link.referral_id, link.updated_at desc, link.referral_contact_id desc
    `;
    for (const contact of contacts) evidence.get(Number(contact.referral_id))!.fields["report.referral_source"] = contact.source;
}

async function postgresReportDocumentCounts(ids: number[], evidence: Map<number, ClientReportEvidence>) {
  const sql = getPipelineSql();
  const counts = await sql<{ referral_id: number | string; documents: number | string }[]>`
    with requested as (
      select referral_id, person_id from pipeline.referrals where referral_id = any(${ids}::bigint[])
    ), linked_documents as (
      select requested.referral_id, document.document_id
      from requested join pipeline.documents document on document.person_id = requested.person_id
      where document.deleted_at is null and document.identity_status = 'linked' and document.processing_status not in ('reserved', 'quarantined')
      union
      select requested.referral_id, document.document_id
      from requested join pipeline.documents document on document.referral_id = requested.referral_id
      where document.deleted_at is null and document.identity_status = 'linked' and document.processing_status not in ('reserved', 'quarantined')
      union
      select requested.referral_id, document.document_id
      from requested join pipeline.resident_links link on link.person_id = requested.person_id and link.status = 'confirmed'
      join pipeline.documents document on document.canonical_client_id = link.resident_key
      where document.deleted_at is null and document.identity_status = 'linked' and document.processing_status not in ('reserved', 'quarantined')
    )
    select requested.referral_id, count(linked_documents.document_id)::integer as documents
    from requested left join linked_documents using (referral_id) group by requested.referral_id
  `;
  for (const count of counts) evidence.get(Number(count.referral_id))!.documentCount = Number(count.documents);
}

async function postgresReportAssessments(ids: number[], evidence: Map<number, ClientReportEvidence>) {
  const sql = getPipelineSql();
  const assessments = await sql<{ referral_id: number | string; assessment_id: string; data: PipelineAssessmentRecord; signed_at: string; status: "complete" }[]>`
    select distinct on (referral_id) referral_id, assessment_id, data, signed_at::text, status
    from pipeline.assessments
    where referral_id = any(${ids}::bigint[]) and status = 'complete' and signed_at is not null
    order by referral_id, signed_at desc, assessment_id desc
  `;
  for (const assessment of assessments) evidence.get(Number(assessment.referral_id))!.assessment = { ...assessment.data, assessment_id: assessment.assessment_id, status: assessment.status, signed_at: assessment.signed_at };
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
    super("Reports are not available for this account.");
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
    ...(definition.id === "admission_flow" ? { summary: admissionFlowWeekSummary(rows) } : {}),
    rows,
    row_count: rows.length,
    truncated: false,
    generated_at: new Date().toISOString(),
    ...(definition.id === "admission_flow" ? { notes: [
      `Since launch includes all Pipeline workspaces created from ${admissionFlowStartDate}, regardless of outcome. Imported and historical charts are excluded; new referrals started from older charts are included.`,
      "Only staff-confirmed actual admission dates count as admissions. Planned dates and accepted decisions do not.",
      "Assessment and ready dates are shown only when recorded. Blank intervals are excluded, never estimated.",
      "Hold reasons are manually entered observations, not a complete or automatic measure of avoidable days.",
      "First change is the first audited change after creation; it is not proof of first contact with the client or referral source.",
      "Early outcomes after move-in require linked clinical stay data and are not inferred from referral records.",
      "A selected month groups this cohort by its original received dates, including referrals still open. Earlier received dates remain intact for wait-time calculations; they do not determine whether a workspace is included.",
      "Recent cohorts still contain open cases. Do not treat a shorter admitted-case median alone as faster overall throughput.",
      "Weekly rows group referrals by received week. Admission share is provisional while a cohort remains open.",
      "Open waiting phases are inferred from recorded milestone dates; missing dates are shown as missing evidence, not proof a step did not happen.",
    ] } : {}),
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
  if (reportId === "admission_flow") {
    const [assessmentDates, activity] = await Promise.all([admissionFlowAssessmentDates(referrals), admissionFlowAudit(referrals)]);
    return admissionFlowRows(referrals, assessmentDates, activity);
  }
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
    referrals.push(...(filters.report_id === "admission_flow"
      ? admissionFlowCohort(page.referrals, filters.month)
      : page.referrals));
    cursor = page.next_cursor;
  } while (cursor && referrals.length < exportLimit);
  if (cursor) throw new Error("This report exceeds the 5,000-row export limit. Narrow the filters and run it again.");
  return referrals;
}

function workspaceScopeForReport(reportId: OperationsReportId): "active" | "all" {
  return ["workspace_inventory", "document_coverage", "intake_review", "decisions", "ehr_handoff", "admission_flow"].includes(reportId)
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

async function assessmentCompletionRows(_user: PipelineUser, filters: OperationsReportFilters) {
  const report = await getAssessmentCompletionReport(filters.month);
  return report.rows
    .map((row) => ({
      row_id: row.assessor_id ?? `legacy:${row.assessor_name}`,
      referral_id: null,
      client_name: null,
      community: null,
      values: {
        staff: row.assessor_name,
        signed: row.completed_assessments,
        accepted: row.accepted_clients,
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

type AdmissionFlowAudit = { firstChange: string | null; lastWorkflowChange: string | null; reschedules: number; handoffs: number };

async function admissionFlowAssessmentDates(referrals: Referral[]) {
  const dates = new Map<number, string[]>();
  if (!referrals.length) return dates;
  if (getReferralStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<{ referral_id: number | string; assessment_date: Date | string }[]>`
      select referral_id, assessment_date from pipeline.assessments
      where referral_id = any(${referrals.map((referral) => referral.id)}::bigint[]) and assessment_date is not null
      order by referral_id, assessment_date
    `;
    for (const row of rows) dates.set(Number(row.referral_id), [...(dates.get(Number(row.referral_id)) ?? []),
      typeof row.assessment_date === "string" ? row.assessment_date.slice(0, 10) : row.assessment_date.toISOString().slice(0, 10)]);
    return dates;
  }
  await Promise.all(referrals.map(async (referral) => {
    const assessments = (await listAssessments({ referralId: referral.id, limit: 100 })).assessments;
    dates.set(referral.id, assessments.map((assessment) => assessment.assessment_date).filter((date): date is string => Boolean(date)).sort());
  }));
  return dates;
}

async function admissionFlowAudit(referrals: Referral[]) {
  const result = new Map<number, AdmissionFlowAudit>();
  if (!referrals.length) return result;
  const ids = referrals.map((referral) => referral.id);
  if (getReferralStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<{ referral_id: number | string; first_change: Date | string | null; last_workflow_change: Date | string | null; reschedules: number | string; handoffs: number | string }[]>`
      select entity_id::bigint as referral_id,
        min(created_at) filter (where action <> 'referral_created') as first_change,
        max(created_at) filter (where 'workflowStatus' = any(changed_fields) or action = 'referral_stage_changed') as last_workflow_change,
        count(*) filter (where action in ('assessment_rescheduled', 'assessment_cancelled', 'assessment_no_show', 'changes_requested')) as reschedules,
        count(*) filter (where action in ('referral_reassigned', 'referral_unassigned')) as handoffs
      from pipeline.audit_events
      where entity_type = 'referral' and entity_id = any(${ids.map(String)}::text[])
      group by entity_id
    `;
    for (const row of rows) result.set(Number(row.referral_id), {
      firstChange: row.first_change ? new Date(row.first_change).toISOString() : null,
      lastWorkflowChange: row.last_workflow_change ? new Date(row.last_workflow_change).toISOString() : null,
      reschedules: Number(row.reschedules), handoffs: Number(row.handoffs),
    });
    return result;
  }
  await Promise.all(referrals.map(async (referral) => {
    const events = (await listLocalReferralAuditEvents(referral.id)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    result.set(referral.id, {
      firstChange: events.find((event) => event.action !== "referral_created")?.created_at ?? null,
      lastWorkflowChange: events.filter((event) => event.changed_fields.includes("workflowStatus") || event.action === "referral_stage_changed").at(-1)?.created_at ?? null,
      reschedules: events.filter((event) => ["assessment_rescheduled", "assessment_cancelled", "assessment_no_show", "changes_requested"].includes(event.action)).length,
      handoffs: events.filter((event) => ["referral_reassigned", "referral_unassigned"].includes(event.action)).length,
    });
  }));
  return result;
}

export function admissionFlowRows(referrals: Referral[], assessmentDates: Map<number, string[]>, activity: Map<number, AdmissionFlowAudit>) {
  const today = admissionFlowToday();
  return referrals.map((referral) => {
    const audit = activity.get(referral.id);
    const received = normalizeCalendarDate(referral.date);
    const admitted = normalizeCalendarDate(referral.actualAdmissionDate);
    const assessed = (assessmentDates.get(referral.id) ?? []).map(normalizeCalendarDate)
      .find((date) => date && (!received || date >= received) && date <= (admitted ?? today)) ?? null;
    const ready = normalizeCalendarDate(referral.admissionFlow?.readyToMoveInDate);
    const activeHold = referral.admissionFlow?.holds?.find((hold) => !hold.endedAt);
    const declined = referral.stage === "Declined" || referral.admissionDecision?.outcome === "declined";
    const open = !admitted && !referral.placementCancellation && !declined;
    const state = admitted ? "Admitted" : referral.placementCancellation ? "Did not move in" :
      declined ? "Declined" : ready ? "Ready, awaiting arrival" :
      referral.workflowStatus ? workflowStatusLabels[referral.workflowStatus] : referral.stage;
    const waitingPhase = !open ? "" : ready ? "Ready, awaiting arrival" : assessed ? "Assessment recorded, not ready" : "No assessment date recorded";
    const elapsed = (start: string | null, end: string | null) => start && end && end >= start
      ? Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) : null;
    return referralRow(referral, {
      client: referral.name,
      community: referral.community,
      county: referral.county ?? "",
      source: referral.source ?? "",
      owner: referral.owner || "Unassigned",
      state,
      group: received ? receivedWeek(received) : "Date missing",
      waiting_phase: waitingPhase,
      assessment_date: assessed,
      days_since_receipt: open ? elapsed(received, today) : null,
      first_change_days: elapsed(received, audit?.firstChange?.slice(0, 10) ?? null),
      assessment_days: elapsed(received, assessed),
      assessment_to_arrival_days: elapsed(assessed, admitted),
      assessment_to_ready_days: elapsed(assessed, ready),
      ready_wait_days: ready ? elapsed(ready, admitted ?? (open ? today : null)) : null,
      ready_to_arrive_days: elapsed(ready, admitted),
      total_days: elapsed(received, admitted),
      hold: activeHold ? `${activeHold.reason.replaceAll("_", " ")} · ${activeHold.responsibleParty.replaceAll("_", " ")} · ${elapsed(activeHold.startedAt.slice(0, 10), today) ?? 0} days` : "",
      rework: `${audit?.reschedules ?? 0} / ${audit?.handoffs ?? 0}`,
      ready_date: ready,
      current_step_days: open ? elapsed(audit?.lastWorkflowChange?.slice(0, 10) ?? null, today) : null,
      received_date: received,
      actual_admission_date: admitted,
    });
  }).sort((a, b) => Number(b.values.days_since_receipt ?? -1) - Number(a.values.days_since_receipt ?? -1)
    || String(b.values.actual_admission_date ?? "").localeCompare(String(a.values.actual_admission_date ?? "")));
}

function receivedWeek(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

export function admissionFlowWeekSummary(rows: OperationsReportRow[]) {
  const groups = new Map<string, OperationsReportRow[]>();
  for (const row of rows) {
    const week = String(row.values.group);
    if (!groups.has(week)) groups.set(week, []);
    groups.get(week)!.push(row);
  }
  return {
    columns: [column("group", "Received week", "left", "date"), column("received", "Received", "right"),
      column("admitted", "Arrived", "right"), column("open", "Still open", "right"),
      column("closed_without_arrival", "Other outcomes", "right"), column("arrival_share", "Arrival share", "right"),
      column("median_days", "Median days to arrival", "right"), column("p90_days", "90th percentile", "right")],
    rows: [...groups].sort(([left], [right]) => right.localeCompare(left)).map(([group, cohort]) => {
      const admitted = cohort.filter((row) => row.values.state === "Admitted");
      const open = cohort.filter((row) => row.values.waiting_phase !== "");
      return {
        row_id: `received-week:${group}`, referral_id: null, client_name: null, community: null,
        values: { group, received: cohort.length, admitted: admitted.length, open: open.length,
          closed_without_arrival: cohort.length - admitted.length - open.length,
          arrival_share: `${Math.round(admitted.length / cohort.length * 100)}%`,
          median_days: medianMetric(admitted.map((row) => row.values.total_days)),
          p90_days: distributionMetric(admitted.map((row) => row.values.total_days), "p90") },
      };
    }),
  };
}

function medianMetric(values: Array<string | number | null>) {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!numbers.length) return "—";
  const middle = Math.floor(numbers.length / 2);
  return String(numbers.length % 2 ? numbers[middle] : Math.round(((numbers[middle - 1] + numbers[middle]) / 2) * 10) / 10);
}

function distributionMetric(values: Array<string | number | null>, kind: "mean" | "p90") {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!numbers.length) return "—";
  if (kind === "p90") return String(numbers[Math.ceil(numbers.length * 0.9) - 1]);
  return String(Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length * 10) / 10);
}

function ehrHandoffRows(referrals: Referral[]) {
  return referrals
    .filter((referral) => !referral.placementCancellation && (referral.stage === "Accepted / Admitted" || referral.admissionDecision?.outcome === "accepted"))
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
  if (reportId === "admission_flow") return [
    column("client", "Client"), column("received_date", "Received", "left", "date"),
    column("assessment_date", "Assessment", "left", "date"), column("ready_date", "Ready", "left", "date"),
    column("actual_admission_date", "Actual arrival", "left", "date"),
    column("community", "Community"), column("county", "County"),
    column("source", "Referral source"), column("owner", "Assigned owner"), column("state", "Current position"),
    column("days_since_receipt", "Open days", "right"),
    column("waiting_phase", "Waiting phase"),
    column("current_step_days", "In current step", "right"),
    column("first_change_days", "To first change", "right"),
    column("assessment_days", "To assessment", "right"),
    column("assessment_to_ready_days", "Assessment to ready", "right"),
    column("assessment_to_arrival_days", "Assessment to arrival", "right"),
    column("ready_wait_days", "Ready wait", "right"),
    column("total_days", "Receipt to arrival", "right"),
    column("hold", "Current hold"), column("rework", "Rework / handoffs", "right"),
  ];
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
    column("accepted", "Accepted", "right"),
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

export function reportMetrics(reportId: OperationsReportId, rows: OperationsReportRow[]): OperationsReportMetric[] {
  const sum = (key: string) => rows.reduce((total, row) => total + numericValue(row.values[key]), 0);
  const distinct = (key: string) => new Set(rows.map((row) => String(row.values[key] ?? "").trim()).filter(Boolean)).size;
  if (reportId === "admission_flow") {
    const admitted = rows.filter((row) => row.values.state === "Admitted");
    const open = rows.filter((row) => row.values.state !== "Admitted" && row.values.state !== "Did not move in" && row.values.state !== "Declined");
    const validArrival = admitted.filter((row) => typeof row.values.total_days === "number");
    const days = (value: string) => value === "—" ? value : `${value} days`;
    return [
      metric("Actual admissions", admitted.length, "Only referrals with a staff-confirmed actual arrival date."),
      metric("Median receipt to arrival", days(medianMetric(admitted.map((row) => row.values.total_days))), `${validArrival.length} of ${admitted.length} actual admissions have both dates.`),
      metric("Median receipt to assessment", days(medianMetric(admitted.map((row) => row.values.assessment_days))), "Actual admissions with a recorded performed assessment date."),
      metric("Median assessment to arrival", days(medianMetric(admitted.map((row) => row.values.assessment_to_arrival_days))), "Actual admissions with a recorded performed assessment date."),
      metric("Median assessment to ready", days(medianMetric(admitted.map((row) => row.values.assessment_to_ready_days))), "Actual admissions with both performed-assessment and manually recorded ready dates."),
      metric("Median ready to arrival", days(medianMetric(admitted.map((row) => row.values.ready_to_arrive_days))), "Actual admissions with both manually recorded ready and confirmed arrival dates."),
      metric("Mean receipt to arrival", days(distributionMetric(admitted.map((row) => row.values.total_days), "mean")), "Completed admissions with both dates; compare with the open queue."),
      metric("90th percentile", days(distributionMetric(admitted.map((row) => row.values.total_days), "p90")), "Longest tenth of completed waits, nearest-rank method."),
      metric("Open referrals", open.length, "Includes cases still waiting; they are not omitted from the view."),
      metric("No assessment date recorded", open.filter((row) => row.values.waiting_phase === "No assessment date recorded").length, "Open referrals without a linked performed-assessment date; this does not prove assessment has not occurred."),
      metric("Assessment recorded, not ready", open.filter((row) => row.values.waiting_phase === "Assessment recorded, not ready").length, "Open referrals with a performed assessment but no manually recorded ready date."),
      metric("Ready, awaiting arrival", open.filter((row) => row.values.waiting_phase === "Ready, awaiting arrival").length, "Ready date recorded, actual arrival not yet confirmed."),
      metric("Open over 14 days", open.filter((row) => numericValue(row.values.days_since_receipt) > 14).length, "Based on the recorded received date."),
      metric("Assessment date coverage", `${admitted.filter((row) => row.values.assessment_days !== null).length} of ${admitted.length}`, "Recorded performed date among actual admissions."),
      metric("Ready date coverage", `${admitted.filter((row) => row.values.ready_to_arrive_days !== null).length} of ${admitted.length}`, "Manually recorded ready date among actual admissions."),
      metric("Current holds", open.filter((row) => row.values.hold !== "").length, "Explicit holds still open."),
      metric("Did not move in", rows.filter((row) => row.values.state === "Did not move in").length, "Recorded placement cancellations; excluded from admission timing."),
      metric("Arrival share", `${rows.length ? Math.round(admitted.length / rows.length * 100) : 0}%`, "Share of received referrals with confirmed actual arrival; provisional while referrals remain open."),
    ];
  }
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
    metric("Accepted clients", sum("accepted"), "Supervisor Accepted decisions linked to assessments signed in the selected month, recorded to date."),
    metric("Staff members", rows.length, "Staff with at least one signed assessment."),
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
    ready_to_schedule: state.assignment === "unassigned" ? "Needs assignment" : state.documents === "none" ? "Needs initial documents" : state.profile === "incomplete" ? "Finish intake" : workflowStatusLabels.ready_to_schedule,
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
