import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import {
  getAssessment,
  patchAssessment,
  requireAssessmentStore,
} from "@/lib/assessment/assessment-store";
import { validateAssessmentPatchRequest } from "@/lib/assessment/assessment-validation";
import {
  assessmentClientIdentityErrorResponse,
  resolveAssessmentClientIdentity,
} from "@/lib/assessment/assessment-client-identity";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import { getActiveWorkspaceMember } from "@/lib/pipeline/workspace-members";

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
    const access = await requireReferralAccess(auth.user, assessment.referral_id);
    if (!access.ok) return access.response;
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
      const current = await getAssessment(assessmentId);
      if (!current) return jsonError("Assessment not found.", 404);
      const access = await requireReferralAccess(auth.user, current.referral_id);
      if (!access.ok) return access.response;
      const assignedAssessor = await resolveAssignedAssessor(validated.value.assessor_id, auth.user, current);
      if (assignedAssessor instanceof Response) return assignedAssessor;
      const identity = await resolveAssessmentClientIdentity(request, current.referral_id);
      const result = await patchAssessment(
        assessmentId,
        {
          ...validated.value.patch,
          ...(assignedAssessor !== undefined ? { assigned_assessor: assignedAssessor } : {}),
          canonical_client_id: identity.canonicalClientId,
          resident_key: identity.residentKey ?? validated.value.patch.resident_key,
        },
        { id: auth.user.id, name: auth.user.name },
        {
          expectedVersion: validated.value.if_match,
          section: validated.value.section,
          expectedSectionVersion: validated.value.if_match_section,
          mutationId: validated.value.client_mutation_id,
        },
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
      const identityResponse = assessmentClientIdentityErrorResponse(error);
      if (identityResponse) return identityResponse;
      return jsonError(error instanceof Error ? error.message : "Could not update assessment.", 400);
    }
  });
}

async function resolveAssignedAssessor(
  assessorId: string | null | undefined,
  user: { id: string; name: string; roles: string[] },
  current: { status: string; assessor_id: string | null },
) {
  if (assessorId === undefined) return undefined;
  if (current.status === "complete") {
    return jsonError("Reopen the completed assessment before changing its assigned assessor.", 409);
  }

  const canAssignOthers = user.roles.some((role) => role === "admin" || role === "assessment_coordinator");
  if (assessorId === null) {
    if (!canAssignOthers && current.assessor_id && current.assessor_id !== user.id) {
      return jsonError("Only a supervisor can remove another staff member's assessment assignment.", 403);
    }
    return null;
  }
  if (!canAssignOthers && assessorId !== user.id) {
    return jsonError("Assessors can assign assessments only to themselves.", 403);
  }
  if (!canAssignOthers && current.assessor_id && current.assessor_id !== user.id) {
    return jsonError("Only a supervisor can reassign another staff member's assessment.", 403);
  }

  if (assessorId === user.id) return { id: user.id, name: user.name };
  const member = await getActiveWorkspaceMember(assessorId);
  if (!member || !member.roles.some((role) => ["admin", "assessment_coordinator", "reviewer"].includes(role))) {
    return jsonError("Choose an active Pipeline assessor.", 400);
  }
  return { id: member.principal_id, name: member.display_name };
}

function safeAssessmentId(value: string) {
  return value.length > 0 && value.length <= 160 && /^[a-zA-Z0-9_.:-]+$/.test(value);
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
