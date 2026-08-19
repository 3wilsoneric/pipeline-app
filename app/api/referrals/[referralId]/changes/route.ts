import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { listEditingPresence } from "@/lib/pipeline/editing-presence";
import { getReferralChangeMetadata, requireReferralStore } from "@/lib/pipeline/referral-store";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/changes", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;
    const { referralId } = await context.params;
    const id = Number.parseInt(referralId, 10);
    if (!Number.isSafeInteger(id) || id < 1) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, id);
    if (!access.ok) return access.response;

    const url = new URL(request.url);
    const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
    if (!Number.isSafeInteger(after) || after < 0) return jsonError("after must be a nonnegative change sequence.");
    const metadata = await getReferralChangeMetadata(id);
    if (!metadata) return jsonError("Referral not found.", 404);
    const sequence = metadata.sequence;
    const presence = await listEditingPresence(id);

    return Response.json({
      changed: sequence > after,
      sequence,
      section_versions: metadata.sectionVersions,
      updated_at: metadata.updatedAt,
      updated_by: metadata.updatedBy ?? null,
      presence: presence.map((item) => ({
        lease_id: item.lease_id,
        actor_id: item.actor_id,
        actor_name: item.actor_name,
        section: item.section,
        expires_at: item.expires_at,
        is_me: item.actor_id === auth.user.id,
      })),
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}
