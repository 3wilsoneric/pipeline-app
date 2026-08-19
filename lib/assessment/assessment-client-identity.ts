import "server-only";

import {
  ClinicalDataError,
  clinicalDataErrorResponse,
  getClinicalResident,
} from "@/lib/clinical/clinical-data";
import {
  getResidentLinkStoreReadiness,
  listResidentLinks,
} from "@/lib/pipeline/resident-link-store";

export type AssessmentClientIdentity = {
  canonicalClientId: string | null;
  residentKey: string | null;
};

class AssessmentClientIdentityError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AssessmentClientIdentityError";
  }
}

export async function resolveAssessmentClientIdentity(
  request: Request,
  referralId: number,
): Promise<AssessmentClientIdentity> {
  const residentLinkReadiness = getResidentLinkStoreReadiness();
  if (!residentLinkReadiness.ready) {
    throw new AssessmentClientIdentityError(
      503,
      "assessment_client_identity_unavailable",
      "Client identity cannot be verified while the resident-link store is unavailable.",
    );
  }

  const links = await listResidentLinks({ referralId, limit: 100 });
  const confirmed = links.links.filter((link) => link.status === "confirmed");
  if (confirmed.length > 1) {
    throw new AssessmentClientIdentityError(
      409,
      "assessment_client_identity_ambiguous",
      "More than one confirmed client identity is attached to this referral.",
    );
  }
  if (confirmed.length === 0) {
    return { canonicalClientId: null, residentKey: null };
  }

  const residentKey = confirmed[0].resident_key;
  const clinical = await getClinicalResident(request, residentKey);
  const canonicalClientId = clinical.resident.canonical_client_id?.trim() || null;
  if (!canonicalClientId) {
    throw new AssessmentClientIdentityError(
      409,
      "assessment_canonical_client_id_missing",
      "The confirmed existing client does not yet have a governed canonical client identifier.",
    );
  }
  return { canonicalClientId, residentKey };
}

export function assessmentClientIdentityErrorResponse(error: unknown) {
  if (error instanceof AssessmentClientIdentityError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: privateHeaders() },
    );
  }
  if (error instanceof ClinicalDataError) return clinicalDataErrorResponse(error);
  return null;
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
