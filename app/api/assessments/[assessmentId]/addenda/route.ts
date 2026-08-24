import { addAssessmentAddendum, getAssessment, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { validateAssessmentAddendumCommand } from "@/lib/assessment/assessment-lifecycle-validation";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ assessmentId: string }> }) {
  return withApiLogging(request, "/api/assessments/[assessmentId]/addenda", async () => {
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
    const isSupervisor = auth.user.roles.includes("admin") || auth.user.roles.includes("assessment_coordinator");
    if (assessment.signed_by?.id !== auth.user.id && !isSupervisor) {
      return jsonError("Only the signing assessor or a supervisor can add an addendum.", 403);
    }
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const command = validateAssessmentAddendumCommand(body.value);
    if (!command.ok) return jsonError(command.message, command.status);
    const result = await addAssessmentAddendum(
      assessmentId,
      command.value.note,
      command.value.reason_code,
      { id: auth.user.id, name: auth.user.name },
      command.value.if_match,
    );
    if (!result) return jsonError("Assessment not found.", 404);
    if (!result.ok && "conflict" in result) {
      return Response.json({ error: "This assessment changed before the addendum could be recorded.", ...result }, { status: 409 });
    }
    if (!result.ok) return Response.json({ error: "The addendum cannot be recorded yet.", ...result }, { status: 422 });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}

function safeAssessmentId(value: string) {
  return value.length > 0 && value.length <= 160 && /^[a-zA-Z0-9_.:-]+$/.test(value);
}
