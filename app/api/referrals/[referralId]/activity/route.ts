import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { listReferralActivity } from "@/lib/pipeline/referral-activity";
import { requireReferralStore } from "@/lib/pipeline/referral-store";

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
    const events = await listReferralActivity(referralId);
    if (!events) return jsonError("Referral not found.", 404);
    return Response.json({ events }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
