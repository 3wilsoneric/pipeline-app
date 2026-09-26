import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { canWorkAssessment } from "@/lib/assessment/assessment-access";
import { isNotebookBlockKey, notebookBlockMaxLength, parseNotebookBody } from "@/lib/assessment/assessment-notebook";
import { saveNotebookBlock } from "@/lib/assessment/assessment-notebook-store";
import { getAssessment, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireMutableReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };
type Context = { params: Promise<{ assessmentId: string; blockKey: string }> };

// Saves one notebook block. The block's own version guards it, so a note never conflicts with answers or
// with another heading; a stale version returns 409 with the current block. Signed assessments are locked.
export async function PUT(request: Request, context: Context) {
  return withApiLogging(request, "/api/assessments/[assessmentId]/notebook/[blockKey]", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const origin = requireSameOriginMutation(request);
    if (origin) return origin;
    const store = requireAssessmentStore();
    if (!store.ok) return store.response;
    const { assessmentId, blockKey } = await context.params;
    if (assessmentId.length > 160 || !/^[a-zA-Z0-9_.:-]+$/.test(assessmentId)) return jsonError("assessmentId is invalid.");
    if (!isNotebookBlockKey(blockKey)) return jsonError("Unknown notebook heading.");
    const assessment = await getAssessment(assessmentId);
    if (!assessment) return jsonError("Assessment not found.", 404);
    const access = await requireMutableReferralAccess(auth.user, assessment.referral_id);
    if (!access.ok) return access.response;
    if (!canWorkAssessment(auth.user, assessment.assessor_id)) return jsonError("Only the assigned assessor or a supervisor can edit this assessment.", 403);
    const body = await readJsonBody<{ body?: unknown; if_match?: unknown }>(request, 64_000);
    if (!body.ok) return jsonError(body.message, body.status);
    const text = parseNotebookBody(body.value?.body);
    if (text === null) return jsonError(`Keep each heading's notes to ${notebookBlockMaxLength.toLocaleString()} characters of plain text.`);
    const expected = body.value?.if_match;
    if (!Number.isInteger(expected) || (expected as number) < 0) return jsonError("if_match must be the block's version, or 0 for a new block.");
    const result = await saveNotebookBlock({ assessmentId, referralId: assessment.referral_id, blockKey, body: text, expectedVersion: expected as number, actor: pipelineAuditActor(auth.user) });
    if (result.ok) return Response.json({ block: result.block }, { headers });
    if (result.reason === "locked") return Response.json({ error: "This assessment is signed. Add an addendum to change it." }, { status: 423, headers });
    return Response.json({ error: "These notes changed on another screen.", block: result.block }, { status: 409, headers });
  });
}
