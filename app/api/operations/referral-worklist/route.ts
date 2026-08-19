import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getReferralWorklistSnapshot } from "@/lib/pipeline/operations-snapshot";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/referral-worklist", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    return Response.json(await getReferralWorklistSnapshot(auth.user), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
