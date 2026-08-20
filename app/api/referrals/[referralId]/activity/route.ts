import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getReferralActivitySnapshot } from "@/lib/pipeline/referral-activity";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/activity", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;
    const { referralId: raw } = await context.params;
    const referralId = Number.parseInt(raw, 10);
    if (!Number.isInteger(referralId) || referralId < 1) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const snapshot = await getReferralActivitySnapshot(referralId);
    if (!snapshot) return jsonError("Referral not found.", 404);
    return Response.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
