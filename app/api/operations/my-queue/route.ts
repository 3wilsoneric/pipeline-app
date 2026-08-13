import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getMyQueueSnapshot } from "@/lib/pipeline/operations-snapshot";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/my-queue", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    const queue = await getMyQueueSnapshot({
      id: auth.user.id,
      name: auth.user.name,
    });

    return Response.json(queue, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  });
}
