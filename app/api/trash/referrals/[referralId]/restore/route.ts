import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { canAccessReferral, requireReferralAccess } from "@/lib/pipeline/referral-access";
import { getReferralMutationReplay, getReferralStoreRevision, requireReferralStore, restoreReferral } from "@/lib/pipeline/referral-store";
import { validateClientMutationId } from "@/lib/pipeline/client-mutation-id";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/trash/referrals/[referralId]/restore", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireReferralStore();
    if (!store.ok) return store.response;
    const { referralId } = await context.params;
    const id = Number.parseInt(referralId, 10);
    if (!Number.isInteger(id) || id < 1) return jsonError("referralId is invalid.");
    const body = await readJsonBody<{ if_match?: number; client_mutation_id?: unknown }>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const expectedVersion = body.value?.if_match;
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      return jsonError("if_match must be a positive version number.");
    }
    const mutationId = validateClientMutationId(body.value?.client_mutation_id);
    if (!mutationId.ok) return jsonError(mutationId.message);
    const replay = await getReferralMutationReplay(id, "referral_restore", mutationId.value);
    if (replay) {
      if (!canAccessReferral(auth.user, replay)) return jsonError("Deleted referral not found.", 404);
      return Response.json({
        ok: true,
        referral: replay,
        revision: await getReferralStoreRevision(),
        idempotentReplay: true,
      }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    const access = await requireReferralAccess(auth.user, id, { includeDeleted: true });
    if (!access.ok) return access.response;
    const result = await restoreReferral(id, pipelineAuditActor(auth.user), expectedVersion, mutationId.value);
    if (!result) return jsonError("Deleted referral not found.", 404);
    if (!result.ok) {
      return Response.json({ error: "This trash record changed. Refresh before restoring it.", conflict: true }, { status: 409 });
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  });
}
