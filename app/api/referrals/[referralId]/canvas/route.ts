import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { canAccessReferral } from "@/lib/pipeline/referral-access";
import { getReferralProgress } from "@/lib/pipeline/referral-progress";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { getReferralWorkflowSnapshot } from "@/lib/pipeline/workflow-store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/canvas", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const { referralId } = await context.params;
    const id = Number.parseInt(referralId, 10);
    if (!Number.isInteger(id) || id < 1) return jsonError("referralId is invalid.");
    const snapshot = await getReferralWorkflowSnapshot(id);
    if (!snapshot || !canAccessReferral(auth.user, snapshot.referral)) {
      return jsonError("Referral not found.", 404);
    }

    return Response.json({
      referral: snapshot.referral,
      progress: getReferralProgress(snapshot.referral, snapshot.context),
      decision: snapshot.decision,
    }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Authorization",
      },
    });
  });
}
