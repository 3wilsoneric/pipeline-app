import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import {
  ClinicalDataError,
  clinicalDataErrorResponse,
  getClinicalResident,
} from "@/lib/clinical/clinical-data";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  findGovernedIdentityConflict,
  type GovernedIdentityConflict,
} from "@/lib/pipeline/master-record-matching";
import {
  getResidentLink,
  requireResidentLinkStore,
  reviewResidentLink,
} from "@/lib/pipeline/resident-link-store";
import { validateResidentLinkReview } from "@/lib/pipeline/resident-link-validation";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import type { Referral } from "@/lib/pipeline/referral-types";
import type {
  PipelineResidentLink,
  ResidentLinkActor,
  ResidentLinkReviewInput,
} from "@/lib/pipeline/resident-link-records";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ linkId: string }> },
) {
  return withApiLogging(request, "/api/resident-links/[linkId]", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireResidentLinkStore();
    if (!store.ok) return store.response;
    const linkId = await parseLinkId(context);
    if (!linkId) return jsonError("linkId is invalid.");
    const link = await getResidentLink(linkId);
    if (!link) return jsonError("Resident link not found.", 404);
    if (link.referral_id) {
      const access = await requireReferralAccess(auth.user, link.referral_id);
      if (!access.ok) return access.response;
    }
    return Response.json({ link }, { headers: privateHeaders() });
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ linkId: string }> },
) {
  return withApiLogging(request, "/api/resident-links/[linkId]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireResidentLinkStore();
    if (!store.ok) return store.response;
    const linkId = await parseLinkId(context);
    if (!linkId) return jsonError("linkId is invalid.");
    const link = await getResidentLink(linkId);
    if (!link) return jsonError("Resident link not found.", 404);
    let referral: Referral | null = null;
    if (link.referral_id) {
      const access = await requireReferralAccess(auth.user, link.referral_id);
      if (!access.ok) return access.response;
      referral = access.referral;
    }
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const validated = validateResidentLinkReview(body.value);
    if (!validated.ok) return jsonError(validated.message, validated.status);

    return completeResidentLinkReview(
      request,
      linkId,
      link,
      referral,
      validated.value,
      pipelineAuditActor(auth.user),
    );
  });
}

async function completeResidentLinkReview(
  request: Request,
  linkId: string,
  link: PipelineResidentLink,
  referral: Referral | null,
  review: ResidentLinkReviewInput & { if_match: number },
  actor: ResidentLinkActor,
) {
  if (review.action === "confirm") {
    if (!referral) {
      return Response.json(
        { error: "This identity candidate is missing its explicit Pipeline referral." },
        { status: 422, headers: privateHeaders() },
      );
    }
    const conflictResponse = await revalidateIdentityConfirmation(request, referral, link);
    if (conflictResponse) return conflictResponse;
  }

  const result = await reviewResidentLink(
    linkId,
    review,
    actor,
    review.if_match,
  );
  if (!result) return jsonError("Resident link not found.", 404);
  if (!result.ok && "conflict" in result) {
    return Response.json(
      { error: "This resident link changed in another session.", ...result },
      { status: 409, headers: privateHeaders() },
    );
  }
  if (!result.ok) {
    return Response.json(
      { error: "This resident link cannot be reviewed yet.", ...result },
      { status: 422, headers: privateHeaders() },
    );
  }
  return Response.json(result, { headers: privateHeaders() });
}

async function revalidateIdentityConfirmation(
  request: Request,
  referral: Referral,
  link: PipelineResidentLink,
) {
  try {
    const clinical = await getClinicalResident(request, link.resident_key);
    const conflict = findGovernedIdentityConflict({
      community_id: link.community_id,
      resident_number: link.resident_number,
      date_of_birth: referral.dob,
    }, clinical.resident);
    return conflict ? governedIdentityConflictResponse(conflict) : null;
  } catch (error) {
    if (error instanceof ClinicalDataError) return clinicalDataErrorResponse(error);
    throw error;
  }
}

function governedIdentityConflictResponse(conflict: GovernedIdentityConflict) {
  const messages: Record<GovernedIdentityConflict, string> = {
    community_conflict: "The governed resident now belongs to a different community.",
    resident_number_conflict: "The resident number now conflicts with the governed Alamo resident.",
    date_of_birth_conflict: "The referral date of birth conflicts with the governed Alamo resident.",
  };
  const code = conflict === "date_of_birth_conflict"
    ? "resident_date_of_birth_conflict"
    : conflict;
  return Response.json({ error: messages[conflict], code }, {
    status: 409,
    headers: privateHeaders(),
  });
}

async function parseLinkId(context: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await context.params;
  const decoded = decodeURIComponent(linkId);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)
    ? decoded
    : null;
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
