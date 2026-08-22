import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineDatabaseReadiness } from "@/lib/database/pipeline-database";
import { getAzureBlobUploadSigner } from "@/lib/extraction/azure-blob";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { getDocumentOriginalAsset, getDocumentReferralId, isDocumentId } from "@/lib/extraction/document-assets";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import { requireReferralStore } from "@/lib/pipeline/referral-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return withApiLogging(request, "/api/files/[documentId]/download", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;
    if (!getPipelineDatabaseReadiness().ready) {
      return Response.json({ error: "File storage is temporarily unavailable." }, { status: 503 });
    }
    const { documentId } = await context.params;
    if (!isDocumentId(documentId)) return Response.json({ error: "File not found." }, { status: 404 });
    const referralId = await getDocumentReferralId(documentId);
    if (!referralId) return Response.json({ error: "File not found." }, { status: 404 });
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    try {
      const asset = await getDocumentOriginalAsset(documentId);
      if (!asset) return Response.json({ error: "File not found." }, { status: 404 });
      const location = await getAzureBlobUploadSigner().createReadUrl(asset.container, asset.blobKey, 120);
      return new Response(null, {
        status: 303,
        headers: {
          Location: location,
          "Cache-Control": "private, no-store, max-age=0",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof DocumentProcessingError) {
        return Response.json({ error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  });
}
