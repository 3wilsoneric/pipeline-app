import { requireInternalWorker } from "@/lib/auth/internal-worker-auth";
import { reconcileDirectHandoffBacklog } from "@/lib/notifications/direct-handoff";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/internal/meet-client-delivery/dispatch", async () => {
    const denied = requireInternalWorker(request);
    if (denied) return denied;
    const result = await reconcileDirectHandoffBacklog();
    return Response.json(result, {
      status: !result.enabled || result.errors > 0 ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  });
}
