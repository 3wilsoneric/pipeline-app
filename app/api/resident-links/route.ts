import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import {
  ClinicalDataError,
  clinicalDataErrorResponse,
  getClinicalResident,
} from "@/lib/clinical/clinical-data";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getReferral, requireReferralStore } from "@/lib/pipeline/referral-store";
import { isKeysetCursor } from "@/lib/pipeline/keyset-cursor";
import {
  createResidentLink,
  listResidentLinks,
  requireResidentLinkStore,
} from "@/lib/pipeline/resident-link-store";
import { validateResidentLinkCreate } from "@/lib/pipeline/resident-link-validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/resident-links", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireResidentLinkStore();
    if (!store.ok) return store.response;

    const url = new URL(request.url);
    const referralId = optionalPositiveInteger(url.searchParams.get("referral_id"));
    if (referralId === false) return jsonError("referral_id must be a positive integer.");
    const limit = optionalPageSize(url.searchParams.get("limit"));
    if (limit === false) return jsonError("limit must be between 1 and 200.");
    const status = url.searchParams.get("status");
    if (status && !["candidate", "confirmed", "rejected"].includes(status)) {
      return jsonError("status must be candidate, confirmed, or rejected.");
    }

    const residentKey = optionalBounded(url.searchParams.get("resident_key"), 256);
    if (residentKey === false) return jsonError("resident_key must be 256 characters or fewer.");
    const residentNumber = optionalBounded(url.searchParams.get("resident_number"), 128);
    if (residentNumber === false) return jsonError("resident_number must be 128 characters or fewer.");
    const pipelineClientId = optionalBounded(url.searchParams.get("pipeline_client_id"), 128);
    if (pipelineClientId === false) return jsonError("pipeline_client_id must be 128 characters or fewer.");
    const cursor = optionalBounded(url.searchParams.get("cursor"), 512);
    if (cursor === false || (cursor && !isKeysetCursor(cursor))) return jsonError("cursor is invalid.");

    return Response.json(
      await listResidentLinks({
        residentKey: residentKey || undefined,
        residentNumber: residentNumber || undefined,
        pipelineClientId: pipelineClientId || undefined,
        referralId: referralId || undefined,
        status: status as "candidate" | "confirmed" | "rejected" | undefined,
        limit: limit || undefined,
        cursor: cursor || undefined,
      }),
      { headers: privateHeaders() },
    );
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/resident-links", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const linkStore = requireResidentLinkStore();
    if (!linkStore.ok) return linkStore.response;
    const referralStore = requireReferralStore();
    if (!referralStore.ok) return referralStore.response;

    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const validated = validateResidentLinkCreate(body.value);
    if (!validated.ok) return jsonError(validated.message, validated.status);
    if (!validated.value.referral_id) {
      return jsonError("referral_id is required so the Pipeline identity being linked is explicit.");
    }
    const referral = await getReferral(validated.value.referral_id);
    if (!referral) return jsonError("Referral not found.", 404);
    if (referral.clientId !== validated.value.pipeline_client_id) {
      return Response.json(
        { error: "The referral does not belong to the supplied Pipeline client identity." },
        { status: 409, headers: privateHeaders() },
      );
    }

    try {
      const clinical = await getClinicalResident(request, validated.value.resident_key);
      if (clinical.resident.community_id !== validated.value.community_id) {
        return Response.json(
          { error: "The selected resident belongs to a different governed community." },
          { status: 409, headers: privateHeaders() },
        );
      }
      if (
        validated.value.resident_number &&
        clinical.resident.resident_number !== validated.value.resident_number
      ) {
        return Response.json(
          { error: "The resident number does not match the governed Alamo resident." },
          { status: 409, headers: privateHeaders() },
        );
      }
      const result = await createResidentLink(
        {
          ...validated.value,
          display_name: referral.name,
          date_of_birth: referral.dob || null,
          resident_number: clinical.resident.resident_number,
        },
        { id: auth.user.id, name: auth.user.name },
        validated.value.client_mutation_id,
      );
      return Response.json(result, { status: 201, headers: privateHeaders() });
    } catch (error) {
      if (error instanceof ClinicalDataError) return clinicalDataErrorResponse(error);
      throw error;
    }
  });
}

function optionalPositiveInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : false;
}

function optionalPageSize(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 200 ? parsed : false;
}

function optionalBounded(value: string | null, max: number) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return undefined;
  return normalized.length <= max ? normalized : false;
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
