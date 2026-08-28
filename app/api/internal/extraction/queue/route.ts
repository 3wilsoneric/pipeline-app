import { requireInternalWorker } from "@/lib/auth/internal-worker-auth";
import { getExtractionQueueHealth } from "@/lib/extraction/processing-worker";
import { withApiLogging } from "@/lib/observability/api-logging";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/internal/extraction/queue", async () => {
    const denied = requireInternalWorker(request);
    if (denied) return denied;
    const health = await getExtractionQueueHealth();
    return Response.json(health, {
      status: health.available ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
