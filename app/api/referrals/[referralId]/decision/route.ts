import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { getReferralWorkflowSnapshot, recordAdmissionDecision } from "@/lib/pipeline/workflow-store";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/decision", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;
    const referralId = await parseReferralId(context);
    if (!referralId) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const snapshot = await getReferralWorkflowSnapshot(referralId);
    if (!snapshot) return jsonError("Referral not found.", 404);
    return Response.json({
      decision: snapshot.decision,
      recommendation: snapshot.recommendation,
      can_decide: auth.user.roles.some((role) => role === "admin" || role === "assessment_coordinator"),
    }, { headers: privateHeaders() });
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/decision", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator"]);
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
      return jsonError("if_match_section must be a positive decision section version number.");
    }
    if (body.value.outcome !== "accepted" && body.value.outcome !== "declined") {
      return jsonError("outcome must be accepted or declined.");
    }
    for (const [field, maximum] of [["reason_code", 128], ["reason_note", 20_000], ["override_reason", 1_000]] as const) {
      if (body.value[field] !== undefined && (typeof body.value[field] !== "string" || body.value[field].length > maximum)) {
        return jsonError(`${field} is invalid.`);
      }
    }

    const result = await recordAdmissionDecision(
      referralId,
      {
        outcome: body.value.outcome,
        reasonCode: typeof body.value.reason_code === "string" ? body.value.reason_code : "",
        reasonNote: typeof body.value.reason_note === "string" ? body.value.reason_note : "",
        overrideReason: typeof body.value.override_reason === "string" ? body.value.override_reason : "",
        decidedByRole: auth.user.roles.includes("admin") ? "admin" : "assessment_coordinator",
      },
      Number(body.value.if_match),
      Number(body.value.if_match_section),
      { id: auth.user.id, name: auth.user.name },
    );
    if (!result) return jsonError("Referral not found.", 404);
    if (!result.ok && "conflict" in result) {
      return Response.json({ error: "This referral's decision changed in another session. Review the latest decision before saving.", ...result }, { status: 409 });
    }
    if (!result.ok) {
      return Response.json({ error: result.blockers[0]?.label ?? "The admission decision is blocked.", ...result }, { status: 422 });
    }
    return Response.json({ ok: true, decision: result.record, referral: result.referral }, { headers: privateHeaders() });
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
