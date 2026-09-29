import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { listClientNotes } from "@/lib/pipeline/client-notes-store";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

// The client's notes (docs/design/DECISIONS.md, "Notes"): anyone who can open the referral reads them.
export async function GET(request: Request, context: { params: Promise<{ referralId: string }> }) {
  return withApiLogging(request, "/api/referrals/[referralId]/notes", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const { referralId } = await context.params;
    if (!/^[1-9]\d*$/.test(referralId) || !Number.isSafeInteger(Number(referralId))) return jsonError("Invalid referral.");
    const access = await requireReferralAccess(auth.user, Number(referralId));
    if (!access.ok) return access.response;
    return Response.json({ blocks: await listClientNotes(Number(referralId)) }, { headers });
  });
}
