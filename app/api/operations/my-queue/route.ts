import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getMyQueueSnapshot } from "@/lib/pipeline/operations-snapshot";
import { getReferralStoreReadiness, getReferralStoreRevision } from "@/lib/pipeline/referral-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/my-queue", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    const readiness = getReferralStoreReadiness();
    const [queue, sequence] = await Promise.all([
      getMyQueueSnapshot({
        id: auth.user.id,
        name: auth.user.name,
      }),
      readiness.ready ? getReferralStoreRevision() : Promise.resolve(0),
    ]);

    return Response.json({ ...queue, sequence }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  });
}
