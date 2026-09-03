import { getAssessment, patchAssessment, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { canWorkAssessment } from "@/lib/assessment/assessment-access";
import { validateAssessmentLifecycleCommand } from "@/lib/assessment/assessment-lifecycle-validation";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAccountableActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ assessmentId: string }> }) {
  return withApiLogging(request, "/api/assessments/[assessmentId]/sign", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireAssessmentStore();
    if (!store.ok) return store.response;
    const { assessmentId } = await context.params;
    if (!safeAssessmentId(assessmentId)) return jsonError("assessmentId is invalid.");
    const assessment = await getAssessment(assessmentId);
    if (!assessment) return jsonError("Assessment not found.", 404);
    const access = await requireReferralAccess(auth.user, assessment.referral_id);
    if (!access.ok) return access.response;
    if (!canWorkAssessment(auth.user, assessment.assessor_id)) {
      return jsonError("Only the assigned assessor or a supervisor can sign this assessment.", 403);
    }
    if (!assessment.started_at && assessment.status !== "complete") {
      return jsonError("Begin the assessment before signing it.", 422);
    }
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const command = validateAssessmentLifecycleCommand(body.value);
    if (!command.ok) return jsonError(command.message, command.status);
    const result = await patchAssessment(
      assessmentId,
      { signer: pipelineAccountableActor(auth.user) },
      pipelineAccountableActor(auth.user),
      { expectedVersion: command.value.if_match, mutationId: command.value.client_mutation_id },
    );
    if (!result) return jsonError("Assessment not found.", 404);
    if (!result.ok && "conflict" in result) {
      return Response.json({ error: "This assessment changed before it could be signed.", ...result }, { status: 409 });
    }
    if (!result.ok) return Response.json({ error: "This assessment is not ready to sign.", ...result }, { status: 422 });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}

function safeAssessmentId(value: string) {
  return value.length > 0 && value.length <= 160 && /^[a-zA-Z0-9_.:-]+$/.test(value);
}
