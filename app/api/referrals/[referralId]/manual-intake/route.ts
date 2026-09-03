import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAccountableActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import { patchReferral, requireReferralStore } from "@/lib/pipeline/referral-store";
import type { ManualIntakeAuthorization } from "@/lib/pipeline/referral-types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/manual-intake", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;

    const { referralId: rawReferralId } = await context.params;
    const referralId = Number.parseInt(rawReferralId, 10);
    if (!Number.isInteger(referralId) || referralId < 1) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;

    const body = await readJsonBody<{ if_match?: unknown; if_match_section?: unknown; reason?: unknown }>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!Number.isInteger(body.value?.if_match) || Number(body.value?.if_match) < 1) {
      return jsonError("if_match must be a positive version number.");
    }
    if (!Number.isInteger(body.value?.if_match_section) || Number(body.value?.if_match_section) < 1) {
      return jsonError("if_match_section must be a positive documents section version number.");
    }
    const reason = typeof body.value?.reason === "string" ? body.value.reason.trim() : "";
    if (reason.length < 10) return jsonError("Explain why intake is proceeding without extraction in at least 10 characters.");
    if (reason.length > 1_000) return jsonError("reason must be 1,000 characters or fewer.");

    const accountableActor = pipelineAccountableActor(auth.user);
    const authorization: ManualIntakeAuthorization = {
      mode: "manual_chart",
      reason,
      authorizedBy: accountableActor.id,
      authorizedByName: accountableActor.name,
      authorizedAt: new Date().toISOString(),
    };
    const result = await patchReferral(
      referralId,
      { manualIntakeAuthorization: authorization },
      Number(body.value.if_match),
      accountableActor,
      { documents: Number(body.value.if_match_section) },
      { auditAction: "manual_intake_authorized", auditReason: reason },
    );
    if (!result) return jsonError("Referral not found.", 404);
    if (!result.ok && "conflict" in result) {
      return Response.json({
        error: "This intake changed in another session. Review the latest workspace before continuing.",
        ...result,
      }, { status: 409 });
    }
    if (!result.ok) {
      return Response.json({ error: result.blockers[0]?.label ?? "Manual intake could not be authorized.", ...result }, { status: 422 });
    }
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
