import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineDatabaseReadiness } from "@/lib/database/pipeline-database";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { getDocumentPreviewAsset, isDocumentId, proxyDocumentAsset } from "@/lib/extraction/document-assets";
import { withApiLogging } from "@/lib/observability/api-logging";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return withApiLogging(request, "/api/files/[documentId]/preview", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const { documentId } = await context.params;
    if (!isDocumentId(documentId)) return Response.json({ error: "Preview not found." }, { status: 404 });
    const rawPage = new URL(request.url).searchParams.get("page");
    const page = rawPage && /^\d{1,5}$/.test(rawPage) && Number(rawPage) > 0 ? Number(rawPage) : undefined;
    if (rawPage && page === undefined) return Response.json({ error: "page is invalid." }, { status: 400 });
    if (!getPipelineDatabaseReadiness().ready) {
      return Response.json({ error: "File storage is temporarily unavailable." }, { status: 503 });
    }
    try {
      const asset = await getDocumentPreviewAsset(documentId, page);
      if (!asset) return Response.json({ error: "Preview not found." }, { status: 404 });
      return proxyDocumentAsset(request, asset);
    } catch (error) {
      if (error instanceof DocumentProcessingError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
      throw error;
    }
  });
}
