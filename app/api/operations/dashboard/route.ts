import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getOperationsDashboardSnapshot } from "@/lib/pipeline/operations-snapshot";
import { jsonError } from "@/lib/extraction/contracts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/dashboard", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    const canViewSupervisorQueue = auth.user.roles.some((role) => role === "admin" || role === "assessment_coordinator");
    const month = new URL(request.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    if (!/^(?:20|21|22)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) return jsonError("month must use YYYY-MM.");
    const { snapshot, supervisorQueue } = await getOperationsDashboardSnapshot(auth.user, canViewSupervisorQueue, month);
    return Response.json({ snapshot, supervisor_queue: supervisorQueue }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
