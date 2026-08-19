import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getOperationsSnapshot } from "@/lib/pipeline/operations-snapshot";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/overview", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    const snapshot = await getOperationsSnapshot(auth.user);
    return Response.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
