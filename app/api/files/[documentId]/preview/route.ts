import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineDatabaseReadiness } from "@/lib/database/pipeline-database";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { getDocumentPreviewAsset, getDocumentReferralId, isDocumentId, proxyDocumentAsset } from "@/lib/extraction/document-assets";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import { requireReferralStore } from "@/lib/pipeline/referral-store";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return withApiLogging(request, "/api/files/[documentId]/preview", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;
    const { documentId } = await context.params;
    if (!isDocumentId(documentId)) return Response.json({ error: "Preview not found." }, { status: 404 });
    const rawPage = new URL(request.url).searchParams.get("page");
    const variant = new URL(request.url).searchParams.get("variant");
    const page = rawPage && /^\d{1,5}$/.test(rawPage) && Number(rawPage) > 0 ? Number(rawPage) : undefined;
    if (rawPage && page === undefined) return Response.json({ error: "page is invalid." }, { status: 400 });
    if (variant && variant !== "thumbnail") return Response.json({ error: "variant is invalid." }, { status: 400 });
    if (variant === "thumbnail" && page === undefined) {
      return Response.json({ error: "A page is required for a thumbnail." }, { status: 400 });
    }
    if (!getPipelineDatabaseReadiness().ready) {
      return Response.json({ error: "File storage is temporarily unavailable." }, { status: 503 });
    }
    const referralId = await getDocumentReferralId(documentId);
    if (!referralId) return Response.json({ error: "Preview not found." }, { status: 404 });
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    try {
      const asset = await getDocumentPreviewAsset(documentId, page);
      if (!asset) return Response.json({ error: "Preview not found." }, { status: 404 });
      return proxyDocumentAsset(request, asset, { thumbnail: variant === "thumbnail" });
    } catch (error) {
      if (error instanceof DocumentProcessingError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
      throw error;
    }
  });
}
