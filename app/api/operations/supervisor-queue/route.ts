import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getSupervisorExceptionSnapshot } from "@/lib/pipeline/operations-snapshot";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/supervisor-queue", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator"]);
    if (!auth.ok) return auth.response;
    const snapshot = await getSupervisorExceptionSnapshot();
    return Response.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
