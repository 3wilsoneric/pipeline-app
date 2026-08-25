import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import {
  importAssessmentExtraction,
  requireAssessmentStore,
} from "@/lib/assessment/assessment-store";
import { createEmptyAssessmentToolData } from "@/lib/assessment/assessment-tool-schema";
import { validateAssessmentImportRequest } from "@/lib/assessment/assessment-validation";
import {
  assessmentClientIdentityErrorResponse,
  resolveAssessmentClientIdentity,
} from "@/lib/assessment/assessment-client-identity";
import { assessmentAssigneeForReferral, canWorkAssessment } from "@/lib/assessment/assessment-access";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/assessments/import", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const assessmentStore = requireAssessmentStore();
    if (!assessmentStore.ok) return assessmentStore.response;
    const referralStore = requireReferralStore();
    if (!referralStore.ok) return referralStore.response;

    const { referralId: rawReferralId } = await context.params;
    const referralId = Number.parseInt(rawReferralId, 10);
    if (!Number.isInteger(referralId) || referralId < 1) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const referral = access.referral;
    const assessmentAssignee = assessmentAssigneeForReferral(auth.user, referral);
    if (!assessmentAssignee) {
      return jsonError("Assign this referral to an assessor before importing assessment data.", 422);
    }
    if (!canWorkAssessment(auth.user, referral.ownerId)) {
      return jsonError("Only the assigned assessor or a supervisor can import assessment data.", 403);
    }
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const validated = validateAssessmentImportRequest(body.value);
    if (!validated.ok) return jsonError(validated.message, validated.status);

    const defaults = createEmptyAssessmentToolData();
    defaults.resident_name = referral.name.trim() || null;
    defaults.date_of_birth = isoDateOrNull(referral.dob);
    defaults.community = referral.community;
    defaults.assessment_date = new Date().toISOString().slice(0, 10);
    defaults.assessor = assessmentAssignee.name;

    try {
      const identity = await resolveAssessmentClientIdentity(request, referralId);
      const result = await importAssessmentExtraction({
        referralId,
        assignedAssessor: assessmentAssignee,
        canonicalClientId: identity.canonicalClientId,
        residentKey: identity.residentKey,
        assessmentId: validated.value.assessment_id,
        expectedVersion: validated.value.if_match,
        fields: validated.value.fields,
        context: validated.value.context,
        defaults,
        actor: { id: auth.user.id, name: auth.user.name },
        mutationId: validated.value.client_mutation_id,
      });
      if (!result) return jsonError("Assessment not found.", 404);
      if (!result.ok && "conflict" in result) {
        return Response.json({
          error: "This assessment changed in another session. Review the latest record before importing again.",
          ...result,
        }, { status: 409 });
      }
      if (!result.ok) return Response.json({ error: "Assessment import is blocked.", ...result }, { status: 422 });
      return Response.json(result, { status: validated.value.assessment_id ? 200 : 201, headers: privateHeaders() });
    } catch (error) {
      const identityResponse = assessmentClientIdentityErrorResponse(error);
      if (identityResponse) return identityResponse;
      return jsonError(error instanceof Error ? error.message : "Could not import assessment values.", 400);
    }
  });
}

function isoDateOrNull(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    ? value
    : null;
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
