import { packetSessionToken, readVerifiedPacket } from "@/lib/notifications/admission-packet-access";
import { packetFileResponse, packetPrivateHeaders } from "@/lib/notifications/admission-packet-files";
import { PacketAccessError } from "@/lib/notifications/admission-packet-store";
import { withApiLogging } from "@/lib/observability/api-logging";
import { toPipelinePath } from "@/lib/pipeline/base-path";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ packetId: string; fileId: string }> }) {
  return withApiLogging(request, "/api/admission-packets/[packetId]/files/[fileId]", async () => {
    try {
      const { packetId, fileId } = await context.params;
      const { packet, file } = await readVerifiedPacket(packetId, packetSessionToken(request, packetId), fileId);
      return await packetFileResponse(file!, packet.referralId, request);
    } catch (error) {
      if (request.headers.get("accept")?.includes("text/html")) {
        const { packetId } = await context.params;
        return new Response(null, { status: 303, headers: { ...packetPrivateHeaders, Location: toPipelinePath(`/admission-packet/${encodeURIComponent(packetId)}?download=retry`) } });
      }
      return Response.json({ error: error instanceof PacketAccessError ? error.message : "The download could not start. Return to the packet and try again." }, {
        status: error instanceof PacketAccessError ? error.status : 503, headers: packetPrivateHeaders,
      });
    }
  });
}
