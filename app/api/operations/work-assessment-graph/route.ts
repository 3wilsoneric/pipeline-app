import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getWorkAssessmentGraphSnapshot } from "@/lib/pipeline/operations-snapshot";
import { canAccessOperationsReports, operationsReportRoles } from "@/lib/pipeline/report-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/work-assessment-graph", async () => {
    const auth = await requirePipelineUser(request, [...operationsReportRoles]);
    if (!auth.ok) return auth.response;
    if (!canAccessOperationsReports(auth.user)) {
      return Response.json({ error: "Reports are not available for this account." }, { status: 403 });
    }
    const snapshot = await getWorkAssessmentGraphSnapshot(auth.user);
    return Response.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
