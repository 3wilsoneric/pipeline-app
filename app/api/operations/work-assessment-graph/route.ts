import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getWorkAssessmentGraphSnapshot } from "@/lib/pipeline/operations-snapshot";
import { operationsReportRoles } from "@/lib/pipeline/report-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/work-assessment-graph", async () => {
    const auth = await requirePipelineUser(request, [...operationsReportRoles]);
    if (!auth.ok) return auth.response;
    const snapshot = await getWorkAssessmentGraphSnapshot(auth.user);
    return Response.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
