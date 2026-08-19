import {
  CreateUploadUrlRequest,
  jsonError,
  readJsonBody,
  validateCreateUploadUrlRequest,
} from "@/lib/extraction/contracts";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { requireExtractionBackend } from "@/lib/extraction/backend-config";
import { createPacketUpload, extractionErrorResponse } from "@/lib/extraction/extraction-service";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export async function POST(request: Request) {
  return withApiLogging(request, "/api/uploads/create-url", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;

    const backend = requireExtractionBackend();
    if (!backend.ok) return backend.response;

    const body = await readJsonBody<CreateUploadUrlRequest>(request);
    if (!body.ok) return jsonError(body.message, body.status);

    const validation = validateCreateUploadUrlRequest(body.value);
    if (!validation.ok) return jsonError(validation.message, validation.status);
    const access = await requireReferralAccess(auth.user, Number(validation.value.referral_id));
    if (!access.ok) return access.response;

    try {
      return Response.json(await createPacketUpload(validation.value, auth.user), {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    } catch (error) {
      return extractionErrorResponse(error);
    }
  });
}
