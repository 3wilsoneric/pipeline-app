import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  isOperationsReportId,
  isClientDataReport,
  careReportTopics,
  type OperationsReportFilters,
} from "@/lib/pipeline/operations-report-types";
import {
  getOperationsReport,
  operationsReportCsv,
  recordOperationsReportExport,
  ReportAccessError,
} from "@/lib/pipeline/operations-reporting";
import { canAccessOperationsReports, operationsReportRoles } from "@/lib/pipeline/report-access";
import { requireReferralStore } from "@/lib/pipeline/referral-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/reports", async () => {
    const auth = authorizeOperationsReportUser(await requirePipelineUser(request, [...operationsReportRoles]));
    if (!auth.ok) return auth.response;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;

    const parsed = parseFilters(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.ok) return jsonError(parsed.error);
    const assessmentReadiness = requireReportAssessmentStore(parsed.filters);
    if (assessmentReadiness) return assessmentReadiness;
    try {
      const response = await getOperationsReport(auth.user, parsed.filters, { request });
      return Response.json(response, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    } catch (error) {
      if (error instanceof ReportAccessError) return jsonError(error.message, 403);
      throw error;
    }
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/operations/reports", async () => {
    const auth = authorizeOperationsReportUser(await requirePipelineUser(request, [...operationsReportRoles]));
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;

    const body = await readJsonBody<Record<string, unknown>>(request, 16_000);
    if (!body.ok) return jsonError(body.message, body.status);
    const parsed = parseFilters(body.value ?? {});
    if (!parsed.ok) return jsonError(parsed.error);
    const assessmentReadiness = requireReportAssessmentStore(parsed.filters);
    if (assessmentReadiness) return assessmentReadiness;
    try {
      const response = await getOperationsReport(auth.user, parsed.filters, { export: true, request });
      await recordOperationsReportExport(auth.user, response);
      return new Response(operationsReportCsv(response), {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Disposition": reportDownloadDisposition(parsed.filters),
          "Content-Type": "text/csv; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof ReportAccessError) return jsonError(error.message, 403);
      throw error;
    }
  });
}

function authorizeOperationsReportUser(auth: Awaited<ReturnType<typeof requirePipelineUser>>) {
  if (!auth.ok) return auth;
  return canAccessOperationsReports(auth.user)
    ? auth
    : { ok: false as const, response: jsonError("Reports are not available for this account.", 403) };
}

function requireReportAssessmentStore(filters: OperationsReportFilters) {
  if (!["assessment_schedule", "assessment_completion"].includes(filters.report_id)) return null;
  const readiness = requireAssessmentStore();
  return readiness.ok ? null : readiness.response;
}

function parseFilters(input: Record<string, unknown>):
  | { ok: true; filters: OperationsReportFilters }
  | { ok: false; error: string } {
  const reportId = input.report_id ?? "clients_by_community";
  if (!isOperationsReportId(reportId)) return { ok: false, error: "report_id is invalid." };
  const values = defaultReportInputs(input, reportId);
  const error = reportMonthError(values.month, reportId) || reportTextError(values) || reportChoiceError(values, reportId);
  if (error) return { ok: false, error };
  return {
    ok: true,
    filters: {
      report_id: reportId,
      month: values.month as string,
      community: (values.community as string).trim(),
      owner: (values.owner as string).trim(),
      county: (values.county as string).trim(),
      client_scope: values.client_scope as OperationsReportFilters["client_scope"],
      care_topic: values.care_topic as OperationsReportFilters["care_topic"],
    },
  };
}

function defaultReportInputs(input: Record<string, unknown>, reportId: OperationsReportFilters["report_id"]) {
  return { month: input.month ?? (isClientDataReport(reportId) ? "" : currentOperationalMonth()), community: input.community ?? "", owner: input.owner ?? "", county: input.county ?? "", client_scope: input.client_scope ?? "all", care_topic: input.care_topic ?? "primary_diagnosis" };
}

function reportMonthError(month: unknown, reportId: OperationsReportFilters["report_id"]) {
  if (typeof month !== "string") return "month must use YYYY-MM.";
  if (isClientDataReport(reportId) && month === "") return "";
  return /^(?:20|21|22)\d{2}-(?:0[1-9]|1[0-2])$/.test(month) ? "" : "month must use YYYY-MM.";
}

function reportTextError(input: Record<string, unknown>) {
  for (const [key, limit] of [["community", 120], ["owner", 160], ["county", 120]] as const) {
    const value = input[key];
    if (typeof value !== "string" || value.length > limit) return `${key} is invalid.`;
  }
  return "";
}

function reportChoiceError(input: Record<string, unknown>, reportId: OperationsReportFilters["report_id"]) {
  if (typeof input.client_scope !== "string" || !["all", "admitted", "current"].includes(input.client_scope)) return "client_scope is invalid.";
  if (input.client_scope === "current" && !["clients_by_community", "client_care_needs"].includes(reportId)) return "Current residents are not available for this report.";
  if (!careReportTopics.some((topic) => topic.value === input.care_topic)) return "care_topic is invalid.";
  return "";
}

function reportDownloadDisposition(filters: OperationsReportFilters) {
  return `attachment; filename="pipeline-${filters.report_id}-${filters.month || "all-dates"}.csv"`;
}

function currentOperationalMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}
