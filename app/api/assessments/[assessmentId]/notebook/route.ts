import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { listNotebookBlocks } from "@/lib/assessment/assessment-notebook-store";
import { getAssessment, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

// The assessment's interview notebook (docs/design/DECISIONS.md, "Interview notebook"): part of the
// assessment record, readable by anyone who can open the referral.
export async function GET(request: Request, context: { params: Promise<{ assessmentId: string }> }) {
  return withApiLogging(request, "/api/assessments/[assessmentId]/notebook", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireAssessmentStore();
    if (!store.ok) return store.response;
    const { assessmentId } = await context.params;
    if (assessmentId.length > 160 || !/^[a-zA-Z0-9_.:-]+$/.test(assessmentId)) return jsonError("assessmentId is invalid.");
    const assessment = await getAssessment(assessmentId);
    if (!assessment) return jsonError("Assessment not found.", 404);
    const access = await requireReferralAccess(auth.user, assessment.referral_id);
    if (!access.ok) return access.response;
    return Response.json({ blocks: await listNotebookBlocks(assessmentId), locked: Boolean(assessment.signed_at) }, { headers });
  });
}
