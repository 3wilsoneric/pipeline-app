import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getOperationsDashboardSnapshot } from "@/lib/pipeline/operations-snapshot";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/dashboard", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    const canViewSupervisorQueue = auth.user.roles.some((role) => role === "admin" || role === "assessment_coordinator");
    const { snapshot, supervisorQueue } = await getOperationsDashboardSnapshot(auth.user, canViewSupervisorQueue);
    return Response.json({ snapshot, supervisor_queue: supervisorQueue }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
