import {
  CompleteUploadRequest,
  jsonError,
  readJsonBody,
  validateCompleteUploadRequest,
} from "@/lib/extraction/contracts";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { requireExtractionBackend } from "@/lib/extraction/backend-config";
import { completePacketUpload, extractionErrorResponse } from "@/lib/extraction/extraction-service";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireMutablePacketAccess } from "@/lib/pipeline/referral-access";
import { reconcileUploadedDocumentRequirements } from "@/lib/pipeline/document-requirement-reconciliation";
import { recordLocalAdditionalReferralDocuments } from "@/lib/pipeline/referral-store";

export async function POST(request: Request) {
  return withApiLogging(request, "/api/uploads/complete", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;

    const backend = requireExtractionBackend();
    if (!backend.ok) return backend.response;

    const body = await readJsonBody<CompleteUploadRequest>(request);
    if (!body.ok) return jsonError(body.message, body.status);

    const validation = validateCompleteUploadRequest(body.value);
    if (!validation.ok) return jsonError(validation.message, validation.status);
    const access = await requireMutablePacketAccess(auth.user, validation.value.packet_id, "files");
    if (!access.ok) return access.response;

    let result;
    try {
      result = await completePacketUpload(validation.value);
    } catch (error) {
      return extractionErrorResponse(error);
    }

    if (!result) {
      return jsonError("Packet not found.", 404);
    }

    await recordCompletedReferralDocuments(access.referral.id, result, auth.user);

    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}

async function recordCompletedReferralDocuments(
  referralId: number,
  result: NonNullable<Awaited<ReturnType<typeof completePacketUpload>>>,
  user: Parameters<typeof pipelineAuditActor>[0],
) {
  const documents = result.documents ?? [];
  await reconcileUploadedDocumentRequirements(referralId, documents, pipelineAuditActor(user));
  await recordLocalAdditionalReferralDocuments(referralId, documents);
}
