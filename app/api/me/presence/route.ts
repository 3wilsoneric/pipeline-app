import { canAccessPipeline, requireAuthenticatedUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { touchWorkspaceMember } from "@/lib/pipeline/workspace-members";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiLogging(request, "/api/me/presence", async () => {
    const auth = await requireAuthenticatedUser(request);
    if (!auth.ok) return auth.response;
    if (!canAccessPipeline(auth.user)) return jsonError("Pipeline access is not assigned.", 403);
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    await touchWorkspaceMember(auth.user);
    return Response.json(
      { online: true },
      { headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" } },
    );
  });
}
