import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { ClinicalDataError, clinicalDataErrorResponse } from "@/lib/clinical/clinical-data";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { reconcileReferralToClinicalRoster } from "@/lib/pipeline/referral-clinical-reconciliation";
import { createResidentLink, requireResidentLinkStore } from "@/lib/pipeline/resident-link-store";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/census-reconciliation", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const referralStore = requireReferralStore();
    if (!referralStore.ok) return referralStore.response;
    const linkStore = requireResidentLinkStore();
    if (!linkStore.ok) return linkStore.response;

    const { referralId } = await context.params;
    const id = Number.parseInt(referralId, 10);
    if (!Number.isInteger(id) || id < 1) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, id);
    if (!access.ok) return access.response;
    const referral = access.referral;
    if (!referral.clientId) {
      return jsonError("Referral client identity is missing. Save the referral before matching census data.", 409);
    }

    try {
      const reconciliation = await reconcileReferralToClinicalRoster(request, referral);
      if (reconciliation.status !== "matched") {
        return Response.json(reconciliation, { headers: privateHeaders() });
      }

      const actor = { id: auth.user.id, name: auth.user.name };
      const linkResult = await createResidentLink({
        pipeline_client_id: referral.clientId,
        display_name: referral.name,
        referral_id: referral.id,
        resident_key: reconciliation.resident.resident_key,
        resident_number: reconciliation.resident.resident_number,
        community_id: reconciliation.resident.community_id,
        match_method: "imported",
        match_confidence: reconciliation.confidence,
      }, actor, `clinical-reconciliation:${referral.id}:${reconciliation.resident.resident_key}`);

      if (!linkResult.ok) {
        return Response.json({
          error: "The census identity candidate needs manual review.",
          ...linkResult,
        }, { status: "conflict" in linkResult ? 409 : 422, headers: privateHeaders() });
      }

      return Response.json({
        status: "candidate_created",
        link: linkResult.link,
        confidence: reconciliation.confidence,
        method: reconciliation.method,
        data_as_of: reconciliation.dataAsOf,
      }, { headers: privateHeaders() });
    } catch (error) {
      if (error instanceof ClinicalDataError) return clinicalDataErrorResponse(error);
      throw error;
    }
  });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
