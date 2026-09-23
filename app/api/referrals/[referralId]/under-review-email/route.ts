import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { notifyUnderReview } from "@/lib/notifications/under-review-email";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireMutableReferralAccess } from "@/lib/pipeline/referral-access";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { getReferralWorkflowSnapshot } from "@/lib/pipeline/workflow-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ referralId: string }> };

export async function POST(request: Request, context: Context) {
  return withApiLogging(request, "/api/referrals/[referralId]/under-review-email", async () => {
    const auth = await requirePipelineUser(request);
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
    const parsed = parseEmailBody(body.value);
    if (!parsed.ok) return jsonError(parsed.error);
    return sendCurrentRecommendation(referralId, parsed);
  });
}

async function sendCurrentRecommendation(referralId: number, parsed: { recommendationId: string; version: number; message: string }) {
  const snapshot = await getReferralWorkflowSnapshot(referralId);
  if (!snapshot) return jsonError("Referral not found.", 404);
  const recommendation = snapshot.recommendation;
  if (!recommendation || snapshot.decision || recommendation.outcome !== "needs_more_information" || recommendation.recommendationId !== parsed.recommendationId || recommendation.version !== parsed.version) {
    return jsonError("This Under Review note changed. Reopen the email preview before sending.", 409);
  }
  const notification = await notifyUnderReview(referralId, recommendation, parsed.message);
  return Response.json({ notification }, { headers: { "Cache-Control": "private, no-store" } });
}

function parseEmailBody(value: unknown): { ok: true; message: string; recommendationId: string; version: number } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "The request body must be an object." };
  const fields = value as Record<string, unknown>;
  if (typeof fields.message !== "string" || !fields.message.trim() || fields.message.length > 4000) return { ok: false, error: "Add a message of up to 4,000 characters." };
  if (typeof fields.recommendation_id !== "string" || !Number.isInteger(fields.recommendation_version)) return { ok: false, error: "The Under Review update is invalid." };
  return { ok: true, message: fields.message, recommendationId: fields.recommendation_id, version: fields.recommendation_version as number };
}

async function parseReferralId(context: Context) {
  const { referralId } = await context.params;
  const parsed = Number(referralId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
