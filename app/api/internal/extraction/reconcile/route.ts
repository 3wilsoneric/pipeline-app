import { requireInternalWorker } from "@/lib/auth/internal-worker-auth";
import { reconcileExtractionJobs } from "@/lib/extraction/processing-worker";
import { withApiLogging } from "@/lib/observability/api-logging";

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

function run(request: Request) {
  return withApiLogging(request, "/api/internal/extraction/reconcile", async () => {
    const denied = requireInternalWorker(request);
    if (denied) return denied;
    const result = await reconcileExtractionJobs(25);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
