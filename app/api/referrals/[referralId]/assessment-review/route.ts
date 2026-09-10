import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAccountableActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { validateClientMutationId } from "@/lib/pipeline/client-mutation-id";
import { requireMutableReferralAccess, requireReferralAccess } from "@/lib/pipeline/referral-access";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import {
  getReferralWorkflowSnapshot,
  requestAssessmentReviewChanges,
} from "@/lib/pipeline/workflow-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ referralId: string }> }) {
  return withApiLogging(request, "/api/referrals/[referralId]/assessment-review", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const referralId = await parseReferralId(context);
    if (!referralId) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const snapshot = await getReferralWorkflowSnapshot(referralId);
    if (!snapshot) return jsonError("Referral not found.", 404);
    return Response.json({ review: snapshot.review, history: snapshot.reviews }, { headers: privateHeaders() });
  });
}

export async function POST(request: Request, context: { params: Promise<{ referralId: string }> }) {
  return withApiLogging(request, "/api/referrals/[referralId]/assessment-review", async () => {
    const auth = await requirePipelineUser(request, ["admin"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;
    const referralId = await parseReferralId(context);
    if (!referralId) return jsonError("referralId is invalid.");
    const access = await requireMutableReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!isRecord(body.value)) return jsonError("The request body must be an object.");
    if (body.value.action !== "request_changes") return jsonError("action must be request_changes.");
    if (!Number.isInteger(body.value.if_match) || Number(body.value.if_match) < 1) {
      return jsonError("if_match must be a positive version number.");
    }
    if (!Number.isInteger(body.value.if_match_section) || Number(body.value.if_match_section) < 1) {
      return jsonError("if_match_section must be a positive decision section version number.");
    }
    if (!Number.isInteger(body.value.if_match_review) || Number(body.value.if_match_review) < 1) {
      return jsonError("if_match_review must be a positive review version number.");
    }
    if (typeof body.value.review_id !== "string" || !body.value.review_id.trim()) {
      return jsonError("review_id is required.");
    }
    if (typeof body.value.reason_note !== "string" || body.value.reason_note.trim().length < 3 || body.value.reason_note.length > 20_000) {
      return jsonError("reason_note must contain the requested corrections.");
    }
    const mutationId = validateClientMutationId(body.value.client_mutation_id);
    if (!mutationId.ok) return jsonError(mutationId.message);
    const result = await requestAssessmentReviewChanges(
      referralId,
      { reviewId: body.value.review_id.trim(), reasonNote: body.value.reason_note },
      Number(body.value.if_match),
      Number(body.value.if_match_section),
      Number(body.value.if_match_review),
      pipelineAccountableActor(auth.user),
      mutationId.value,
    );
    if (!result) return jsonError("Referral not found.", 404);
    if (!result.ok && "conflict" in result) {
      return Response.json({ error: "This supervisor review changed in another session. Review the latest version before saving.", ...result }, { status: 409 });
    }
    if (!result.ok) {
      return Response.json({ error: result.blockers[0]?.label ?? "The review change is blocked.", ...result }, { status: 422 });
    }
    return Response.json(
      { ok: true, review: result.record, referral: result.referral },
      { headers: privateHeaders() },
    );
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
