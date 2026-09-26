import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getAssessment, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { currentIntakeAnswers, latestPriorAnswers } from "@/lib/assessment/assessment-prior-answers-server";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

// History-type answers from this client's most recent signed assessment on another referral, and the
// referral intake's current answers, offered in the interview as suggestions. Read-only; nothing is filled in here.
export async function GET(request: Request, context: { params: Promise<{ assessmentId: string }> }) {
  return withApiLogging(request, "/api/assessments/[assessmentId]/prior-answers", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireAssessmentStore();
    if (!store.ok) return store.response;
    const { assessmentId } = await context.params;
    if (assessmentId.length > 160 || !/^[a-zA-Z0-9_.:-]+$/.test(assessmentId)) return jsonError("assessmentId is invalid.");
    const current = await getAssessment(assessmentId);
    if (!current) return jsonError("Assessment not found.", 404);
    const access = await requireReferralAccess(auth.user, current.referral_id);
    if (!access.ok) return access.response;
    const [prior, intake] = await Promise.all([latestPriorAnswers(auth.user, current), currentIntakeAnswers(current)]);
    return Response.json({ prior, intake }, { headers });
  });
}
