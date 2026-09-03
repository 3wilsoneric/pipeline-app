import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { isReferralStage } from "@/lib/pipeline/referral-workflow";
import { transitionReferral } from "@/lib/pipeline/workflow-store";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/transition", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;

    const referralId = await parseReferralId(context);
    if (!referralId) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!isRecord(body.value)) return jsonError("The request body must be an object.");
    if (!Number.isInteger(body.value.if_match) || Number(body.value.if_match) < 1) {
      return jsonError("if_match must be a positive version number.");
    }
    if (!Number.isInteger(body.value.if_match_section) || Number(body.value.if_match_section) < 1) {
      return jsonError("if_match_section must be a positive workflow section version number.");
    }
    if (!isReferralStage(body.value.target_stage)) return jsonError("target_stage is invalid.");

    const result = await transitionReferral(
      referralId,
      body.value.target_stage,
      Number(body.value.if_match),
      Number(body.value.if_match_section),
      pipelineAuditActor(auth.user),
    );
    if (!result) return jsonError("Referral not found.", 404);
    if (!result.ok && "conflict" in result) {
      return Response.json({
        error: "This referral's workflow changed in another session. Review the latest stage before moving it.",
        ...result,
      }, { status: 409 });
    }
    if (!result.ok) {
      return Response.json({
        error: result.blockers[0]?.label ?? "This workflow move is blocked by required work.",
        ...result,
      }, { status: 422 });
    }
    return Response.json(result, { headers: privateHeaders() });
  });
}

async function parseReferralId(context: { params: Promise<{ referralId: string }> }) {
  const { referralId } = await context.params;
  const parsed = Number.parseInt(referralId, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
