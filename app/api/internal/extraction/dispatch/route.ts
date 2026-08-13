import { requireInternalWorker } from "@/lib/auth/internal-worker-auth";
import { dispatchExtractionJobs } from "@/lib/extraction/processing-worker";
import { withApiLogging } from "@/lib/observability/api-logging";

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

function run(request: Request) {
  return withApiLogging(request, "/api/internal/extraction/dispatch", async () => {
    const denied = requireInternalWorker(request);
    if (denied) return denied;
    const result = await dispatchExtractionJobs(10, "pipeline-cron-dispatch");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
