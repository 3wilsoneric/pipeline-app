import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { clinicalDataErrorResponse, getClinicalHealth } from "@/lib/clinical/clinical-data";
import { withApiLogging } from "@/lib/observability/api-logging";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/clinical/health", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    try {
      const health = await getClinicalHealth(request);
      recordPipelineMetric("pipeline.clinical.freshness_status", 1, "count", {
        operation: "health",
        result: health.freshness.status,
      });
      if (health.freshness.age_hours !== null) {
        recordPipelineMetric("pipeline.clinical.freshness_age", health.freshness.age_hours * 60 * 60 * 1000, "milliseconds", {
          operation: "health",
          result: health.freshness.status,
        });
      }
      return Response.json(health, {
        status: health.ready ? 200 : 503,
        headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
      });
    } catch (error) {
      return clinicalDataErrorResponse(error);
    }
  });
}
