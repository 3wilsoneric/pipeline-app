import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import {
  importAssessmentExtraction,
  requireAssessmentStore,
} from "@/lib/assessment/assessment-store";
import { createEmptyAssessmentToolData } from "@/lib/assessment/assessment-tool-schema";
import { validateAssessmentImportRequest } from "@/lib/assessment/assessment-validation";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { getReferral, requireReferralStore } from "@/lib/pipeline/referral-store";
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
    const referral = await getReferral(referralId);
    if (!referral) return jsonError("Referral not found.", 404);

    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const validated = validateAssessmentImportRequest(body.value);
    if (!validated.ok) return jsonError(validated.message, validated.status);

    const defaults = createEmptyAssessmentToolData();
    defaults.resident_name = referral.name.trim() || null;
    defaults.date_of_birth = isoDateOrNull(referral.dob);
    defaults.community = referral.community;
    defaults.assessment_date = new Date().toISOString().slice(0, 10);
    defaults.assessor = auth.user.name;

    try {
      const result = await importAssessmentExtraction({
        referralId,
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
