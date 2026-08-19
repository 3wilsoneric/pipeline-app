import { jsonError } from "@/lib/extraction/contracts";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireExtractionBackend } from "@/lib/extraction/backend-config";
import { readPacketStatus } from "@/lib/extraction/extraction-service";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requirePacketAccess } from "@/lib/pipeline/referral-access";

export async function GET(
  request: Request,
  context: { params: Promise<{ packetId: string }> },
) {
  return withApiLogging(request, "/api/packets/[packetId]/status", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    const backend = requireExtractionBackend();
    if (!backend.ok) return backend.response;

    const { packetId } = await context.params;
    const access = await requirePacketAccess(auth.user, packetId);
    if (!access.ok) return access.response;
    const status = await readPacketStatus(packetId);

    if (!status) {
      return jsonError("Packet not found.", 404);
    }

    return Response.json(status);
  });
}
