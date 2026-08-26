import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import {
  createAssessment,
  listAssessments,
  requireAssessmentStore,
} from "@/lib/assessment/assessment-store";
import { buildAssessmentSeedFromReferral } from "@/lib/assessment/assessment-seed";
import { pickAssessmentToolData } from "@/lib/assessment/assessment-tool-schema";
import { validateAssessmentCreateRequest } from "@/lib/assessment/assessment-validation";
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

export async function GET(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/assessments", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireAssessmentStore();
    if (!store.ok) return store.response;

    const referralId = await parseReferralId(context);
    if (!referralId) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const result = await listAssessments({ referralId, limit: 100 });
    return Response.json(result, { headers: privateHeaders() });
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/assessments", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const assessmentStore = requireAssessmentStore();
    if (!assessmentStore.ok) return assessmentStore.response;
    const referralStore = requireReferralStore();
    if (!referralStore.ok) return referralStore.response;

    const referralId = await parseReferralId(context);
    if (!referralId) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const referral = access.referral;
    const assessmentAssignee = assessmentAssigneeForReferral(auth.user, referral);
    if (!assessmentAssignee) {
      return jsonError("Assign this referral to an assessor before starting an assessment.", 422);
    }
    if (!canWorkAssessment(auth.user, referral.ownerId)) {
      return jsonError("Only the assigned assessor or a supervisor can create an assessment.", 403);
    }
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const validated = validateAssessmentCreateRequest(body.value);
    if (!validated.ok) return jsonError(validated.message, validated.status);

    const seed = buildAssessmentSeedFromReferral(referral, assessmentAssignee.name);
    const requested = pickAssessmentToolData({ ...seed.data, ...validated.value.data });
    const data = pickAssessmentToolData({
      ...requested,
      resident_name: seed.data.resident_name,
      date_of_birth: seed.data.date_of_birth,
      community: seed.data.community,
      assessment_date: seed.data.assessment_date,
      assessor: seed.data.assessor,
      referral_received_date: seed.data.referral_received_date,
      referrer_name: seed.data.referrer_name,
      county: seed.data.county,
    });

    try {
      const identity = await resolveAssessmentClientIdentity(request, referralId);
      const result = await createAssessment(
        {
          referral_id: referralId,
          assigned_assessor: assessmentAssignee,
          canonical_client_id: identity.canonicalClientId,
          resident_key: identity.residentKey,
          data,
          status: seed.status,
          field_provenance: seed.field_provenance,
          unmapped_fields: seed.unmapped_fields,
        },
        { id: auth.user.id, name: auth.user.name },
        validated.value.client_mutation_id,
      );
      if (!result.ok) {
        return Response.json({ error: "Assessment creation is blocked.", ...result }, { status: 422 });
      }
      return Response.json(result, { status: 201, headers: privateHeaders() });
    } catch (error) {
      const identityResponse = assessmentClientIdentityErrorResponse(error);
      if (identityResponse) return identityResponse;
      return jsonError(error instanceof Error ? error.message : "Could not create assessment.", 400);
    }
  });
}

async function parseReferralId(context: { params: Promise<{ referralId: string }> }) {
  const { referralId } = await context.params;
  const parsed = Number.parseInt(referralId, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
