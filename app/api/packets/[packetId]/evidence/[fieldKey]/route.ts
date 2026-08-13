import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { getFieldEvidenceAsset, proxyDocumentAsset } from "@/lib/extraction/document-assets";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { decodeRouteParam } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";

export async function GET(
  request: Request,
  context: { params: Promise<{ packetId: string; fieldKey: string }> },
) {
  return withApiLogging(request, "/api/packets/[packetId]/evidence/[fieldKey]", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const { packetId, fieldKey } = await context.params;
    const decoded = decodeRouteParam(fieldKey);
    if (!decoded) return Response.json({ error: "fieldKey is invalid." }, { status: 400 });
    try {
      const asset = await getFieldEvidenceAsset(packetId, decoded);
      if (!asset) return Response.json({ error: "Evidence not found." }, { status: 404 });
      return proxyDocumentAsset(request, asset);
    } catch (error) {
      if (error instanceof DocumentProcessingError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
      throw error;
    }
  });
}
