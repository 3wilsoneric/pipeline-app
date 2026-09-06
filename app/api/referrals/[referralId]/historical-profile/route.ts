import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import { getHistoricalProfile } from "@/lib/pipeline/historical-profile-store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/historical-profile", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const { referralId } = await context.params;
    const id = Number.parseInt(referralId, 10);
    if (!Number.isInteger(id) || id < 1) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, id);
    if (!access.ok) return access.response;
    if (access.referral.workspaceOrigin !== "allo" && access.referral.workspaceOrigin !== "import") {
      return jsonError("Source profile is available only for imported workspaces.", 409);
    }

    try {
      return Response.json(await getHistoricalProfile(access.referral), {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Vary: "Authorization",
        },
      });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Source profile could not be loaded.", 503);
    }
  });
}
