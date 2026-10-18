import { canAccessOperationsReports, operationsReportRoles } from "@/lib/pipeline/report-access";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getPlatformAdmissionsSummary } from "@/lib/pipeline/operations-snapshot";
import { buildAdmissionsCensusReport } from "@/lib/pipeline/admissions-census-report";
import { jsonError } from "@/lib/extraction/contracts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/admissions-census", async () => {
    const auth = await requirePipelineUser(request, [...operationsReportRoles]);
    if (!auth.ok) return auth.response;
    if (!canAccessOperationsReports(auth.user)) return jsonError("Reports are not available for this account.", 403);

    const summary = await getPlatformAdmissionsSummary();
    if (!summary) return Response.json({ error: "Referral storage is unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
    return Response.json(buildAdmissionsCensusReport(summary), {
      headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
    });
  });
}
