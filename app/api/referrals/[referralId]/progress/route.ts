import { jsonError } from "@/lib/extraction/contracts";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { getReferralProgress } from "@/lib/pipeline/referral-progress";
import { getReferralWorkflowSnapshot } from "@/lib/pipeline/workflow-store";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/progress", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const { referralId } = await context.params;
    const id = Number.parseInt(referralId, 10);
    if (!Number.isInteger(id) || id < 1) return jsonError("referralId is invalid.");

    const snapshot = await getReferralWorkflowSnapshot(id);
    if (!snapshot) return jsonError("Referral not found.", 404);

    return Response.json(getReferralProgress(snapshot.referral, snapshot.context), {
      headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
    });
  });
}
