import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import {
  getAssessment,
  patchAssessment,
  requireAssessmentStore,
} from "@/lib/assessment/assessment-store";
import { validateAssessmentPatchRequest } from "@/lib/assessment/assessment-validation";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ assessmentId: string }> },
) {
  return withApiLogging(request, "/api/assessments/[assessmentId]", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireAssessmentStore();
    if (!store.ok) return store.response;
    const { assessmentId } = await context.params;
    if (!safeAssessmentId(assessmentId)) return jsonError("assessmentId is invalid.");
    const assessment = await getAssessment(assessmentId);
    if (!assessment) return jsonError("Assessment not found.", 404);
    return Response.json({ assessment }, { headers: privateHeaders() });
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ assessmentId: string }> },
) {
  return withApiLogging(request, "/api/assessments/[assessmentId]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireAssessmentStore();
    if (!store.ok) return store.response;

    const { assessmentId } = await context.params;
    if (!safeAssessmentId(assessmentId)) return jsonError("assessmentId is invalid.");
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const validated = validateAssessmentPatchRequest(body.value);
    if (!validated.ok) return jsonError(validated.message, validated.status);

    try {
      const result = await patchAssessment(
        assessmentId,
        validated.value.patch,
        { id: auth.user.id, name: auth.user.name },
        validated.value.if_match,
      );
      if (!result) return jsonError("Assessment not found.", 404);
      if (!result.ok && "conflict" in result) {
        return Response.json({
          error: "This assessment changed in another session. Review the latest record before saving again.",
          ...result,
        }, { status: 409 });
      }
      if (!result.ok) {
        return Response.json({
          error: "This assessment cannot be completed yet.",
          ...result,
        }, { status: 422 });
      }
      return Response.json(result, { headers: privateHeaders() });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "Could not update assessment.", 400);
    }
  });
}

function safeAssessmentId(value: string) {
  return value.length > 0 && value.length <= 160 && /^[a-zA-Z0-9_.:-]+$/.test(value);
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
