import { requireInternalWorker } from "@/lib/auth/internal-worker-auth";
import { getExtractionQueueHealth } from "@/lib/extraction/processing-worker";
import { withApiLogging } from "@/lib/observability/api-logging";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/internal/extraction/queue", async () => {
    const denied = requireInternalWorker(request);
    if (denied) return denied;
    return Response.json(await getExtractionQueueHealth(), { headers: { "Cache-Control": "no-store" } });
  });
}
