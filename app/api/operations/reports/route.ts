import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  isOperationsReportId,
  type OperationsReportFilters,
} from "@/lib/pipeline/operations-report-types";
import {
  getOperationsReport,
  operationsReportCsv,
  recordOperationsReportExport,
  ReportAccessError,
} from "@/lib/pipeline/operations-reporting";
import { operationsReportRoles } from "@/lib/pipeline/report-access";
import { requireReferralStore } from "@/lib/pipeline/referral-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/reports", async () => {
    const auth = await requirePipelineUser(request, [...operationsReportRoles]);
    if (!auth.ok) return auth.response;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;

    const parsed = parseFilters(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.ok) return jsonError(parsed.error);
    const assessmentReadiness = requireReportAssessmentStore(parsed.filters);
    if (assessmentReadiness) return assessmentReadiness;
    try {
      const response = await getOperationsReport(auth.user, parsed.filters);
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
    const auth = await requirePipelineUser(request, [...operationsReportRoles]);
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
      const response = await getOperationsReport(auth.user, parsed.filters, { export: true });
      await recordOperationsReportExport(auth.user, response);
      return new Response(operationsReportCsv(response), {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Disposition": `attachment; filename="pipeline-${parsed.filters.report_id}-${parsed.filters.month}.csv"`,
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

function requireReportAssessmentStore(filters: OperationsReportFilters) {
  if (!["assessment_schedule", "assessment_completion"].includes(filters.report_id)) return null;
  const readiness = requireAssessmentStore();
  return readiness.ok ? null : readiness.response;
}

function parseFilters(input: Record<string, unknown>):
  | { ok: true; filters: OperationsReportFilters }
  | { ok: false; error: string } {
  const reportId = input.report_id ?? "workspace_inventory";
  const month = input.month ?? currentOperationalMonth();
  const community = input.community ?? "";
  const owner = input.owner ?? "";
  if (!isOperationsReportId(reportId)) return { ok: false, error: "report_id is invalid." };
  if (typeof month !== "string" || !/^(?:20|21|22)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) {
    return { ok: false, error: "month must use YYYY-MM." };
  }
  if (typeof community !== "string" || community.length > 120) return { ok: false, error: "community is invalid." };
  if (typeof owner !== "string" || owner.length > 160) return { ok: false, error: "owner is invalid." };
  return {
    ok: true,
    filters: {
      report_id: reportId,
      month,
      community: community.trim(),
      owner: owner.trim(),
    },
  };
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
