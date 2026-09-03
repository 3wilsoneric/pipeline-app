import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAccountableActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { updateEhrHandoff } from "@/lib/pipeline/workflow-store";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

const actions = ["queue", "mark_sent", "mark_failed", "retry"] as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/ehr-handoff", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
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

    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!isRecord(body.value)) return jsonError("The request body must be an object.");
    if (!Number.isInteger(body.value.if_match) || Number(body.value.if_match) < 1) {
      return jsonError("if_match must be a positive version number.");
    }
    if (!Number.isInteger(body.value.if_match_section) || Number(body.value.if_match_section) < 1) {
      return jsonError("if_match_section must be a positive decision section version number.");
    }
    if (typeof body.value.action !== "string" || !actions.includes(body.value.action as (typeof actions)[number])) {
      return jsonError("action is invalid.");
    }
    if (body.value.failure_reason !== undefined && (typeof body.value.failure_reason !== "string" || body.value.failure_reason.length > 2_000)) {
      return jsonError("failure_reason is invalid.");
    }

    const action = body.value.action as (typeof actions)[number];
    const result = await updateEhrHandoff(
      referralId,
      action,
      Number(body.value.if_match),
      Number(body.value.if_match_section),
      pipelineAccountableActor(auth.user),
      typeof body.value.failure_reason === "string" ? body.value.failure_reason : "",
    );
    if (!result) return jsonError("Referral not found.", 404);
    if (!result.ok && "conflict" in result) {
      recordPipelineMetric("pipeline.referral.save_conflicts", 1, "count", {
        operation: "ehr_handoff",
        result: "conflict",
      });
      return Response.json({
        error: "This EHR handoff changed in another session. Review the latest status before trying again.",
        ...result,
      }, { status: 409, headers: privateHeaders() });
    }
    if (!result.ok) {
      return Response.json({
        error: result.blockers[0]?.label ?? "The EHR handoff is blocked.",
        ...result,
      }, { status: 422, headers: privateHeaders() });
    }
    recordPipelineMetric("pipeline.ehr_handoff.actions", 1, "count", {
      operation: action,
      result: "ok",
    });
    return Response.json({ ok: true, ehr_handoff: result.record, referral: result.referral }, {
      headers: privateHeaders(),
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
