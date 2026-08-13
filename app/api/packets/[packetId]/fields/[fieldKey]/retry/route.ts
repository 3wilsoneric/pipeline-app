import {
  jsonError,
  readJsonBody,
  RetryFieldRequest,
  decodeRouteParam,
  validateRetryFieldRequest,
} from "@/lib/extraction/contracts";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { requireExtractionBackend } from "@/lib/extraction/backend-config";
import { extractionErrorResponse, retryPacketField } from "@/lib/extraction/extraction-service";
import { withApiLogging } from "@/lib/observability/api-logging";

export async function POST(
  request: Request,
  context: { params: Promise<{ packetId: string; fieldKey: string }> },
) {
  return withApiLogging(request, "/api/packets/[packetId]/fields/[fieldKey]/retry", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;

    const backend = requireExtractionBackend();
    if (!backend.ok) return backend.response;

    const { packetId, fieldKey } = await context.params;
    const body = await readJsonBody<RetryFieldRequest>(request);
    if (!body.ok) return jsonError(body.message, body.status);

    const validation = validateRetryFieldRequest(body.value);
    if (!validation.ok) return jsonError(validation.message, validation.status);

    const decodedFieldKey = decodeRouteParam(fieldKey);
    if (!decodedFieldKey) return jsonError("fieldKey is invalid.");

    let result;
    try {
      result = await retryPacketField(packetId, decodedFieldKey, validation.value, auth.user);
    } catch (error) {
      return extractionErrorResponse(error);
    }

    if (!result) {
      return jsonError("Packet field not found.", 404);
    }

    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
