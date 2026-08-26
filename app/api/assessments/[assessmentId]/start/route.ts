import { getAssessment, patchAssessment, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { canWorkAssessment } from "@/lib/assessment/assessment-access";
import { validateAssessmentLifecycleCommand } from "@/lib/assessment/assessment-lifecycle-validation";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ assessmentId: string }> }) {
  return withApiLogging(request, "/api/assessments/[assessmentId]/start", async () => {
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
      return jsonError("Only the assigned assessor or a supervisor can start this assessment.", 403);
    }
    if (assessment.status === "complete" || assessment.signed_at) {
      return jsonError("A completed assessment cannot be started again.", 422);
    }
    if (!assessment.scheduled_start_at || !["scheduled", "rescheduled"].includes(assessment.schedule_status ?? "unscheduled")) {
      return jsonError("Schedule the assessment before beginning the interview.", 422);
    }
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const command = validateAssessmentLifecycleCommand(body.value);
    if (!command.ok) return jsonError(command.message, command.status);
    const result = await patchAssessment(
      assessmentId,
      { mark_started: true },
      { id: auth.user.id, name: auth.user.name },
      { expectedVersion: command.value.if_match, mutationId: command.value.client_mutation_id },
    );
    if (!result) return jsonError("Assessment not found.", 404);
    if (!result.ok && "conflict" in result) {
      return Response.json({ error: "This assessment changed before it could be started.", ...result }, { status: 409 });
    }
    if (!result.ok) return Response.json({ error: "This assessment cannot be started.", ...result }, { status: 422 });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}

function safeAssessmentId(value: string) {
  return value.length > 0 && value.length <= 160 && /^[a-zA-Z0-9_.:-]+$/.test(value);
}
