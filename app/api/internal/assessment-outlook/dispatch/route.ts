import { requireInternalWorker } from "@/lib/auth/internal-worker-auth";
import { reconcileAssessmentOutlookCalendar } from "@/lib/assessment/assessment-outlook-calendar";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/internal/assessment-outlook/dispatch", async () => {
    const denied = requireInternalWorker(request);
    if (denied) return denied;
    const result = await reconcileAssessmentOutlookCalendar();
    return Response.json(result, {
      status: !result.enabled || result.errors > 0 ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
