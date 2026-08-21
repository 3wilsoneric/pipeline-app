import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { getFieldEvidenceAsset, proxyDocumentAsset } from "@/lib/extraction/document-assets";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { getExtractionBackendMode } from "@/lib/extraction/backend-config";
import { renderLocalPacketEvidence } from "@/lib/extraction/local-packet-evidence";
import { getMockFieldEvidenceDescriptor } from "@/lib/extraction/mock-store";
import { decodeRouteParam } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requirePacketAccess } from "@/lib/pipeline/referral-access";

export async function GET(
  request: Request,
  context: { params: Promise<{ packetId: string; fieldKey: string }> },
) {
  return withApiLogging(request, "/api/packets/[packetId]/evidence/[fieldKey]", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const { packetId, fieldKey } = await context.params;
    const access = await requirePacketAccess(auth.user, packetId);
    if (!access.ok) return access.response;
    const decoded = decodeRouteParam(fieldKey);
    if (!decoded) return Response.json({ error: "fieldKey is invalid." }, { status: 400 });
    try {
      if (getExtractionBackendMode() === "mock") {
        const descriptor = getMockFieldEvidenceDescriptor(packetId, decoded);
        const evidence = descriptor ? await renderLocalPacketEvidence(descriptor) : null;
        if (!evidence) return Response.json({ error: "Evidence not found." }, { status: 404 });
        return new Response(Uint8Array.from(evidence).buffer, {
          headers: {
            "Content-Type": "image/png",
            "Content-Length": String(evidence.byteLength),
            "Cache-Control": "private, no-store, max-age=0",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:",
            "Cross-Origin-Resource-Policy": "same-origin",
          },
        });
      }
      const asset = await getFieldEvidenceAsset(packetId, decoded);
      if (!asset) return Response.json({ error: "Evidence not found." }, { status: 404 });
      return proxyDocumentAsset(request, asset);
    } catch (error) {
      if (error instanceof DocumentProcessingError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
      throw error;
    }
  });
}
