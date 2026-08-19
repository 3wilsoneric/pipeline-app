import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineDatabaseReadiness } from "@/lib/database/pipeline-database";
import { getDocumentFileMetadata, getDocumentReferralId, isDocumentId } from "@/lib/extraction/document-assets";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return withApiLogging(request, "/api/files/[documentId]", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const { documentId } = await context.params;
    if (!isDocumentId(documentId)) return jsonError("File not found.", 404);
    const url = new URL(request.url);
    const rawAfter = url.searchParams.get("after_page")?.trim();
    const rawLimit = url.searchParams.get("limit")?.trim();
    const afterPage = rawAfter ? Number(rawAfter) : 0;
    const limit = rawLimit ? Number(rawLimit) : 24;
    if (!Number.isInteger(afterPage) || afterPage < 0 || afterPage > 50_000) {
      return jsonError("after_page must be a whole number between 0 and 50,000.");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return jsonError("limit must be a whole number between 1 and 100.");
    }
    if (!getPipelineDatabaseReadiness().ready) {
      return jsonError("File storage is temporarily unavailable.", 503);
    }
    const referralId = await getDocumentReferralId(documentId);
    if (!referralId) return jsonError("File not found.", 404);
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;

    const file = await getDocumentFileMetadata(documentId, { afterPage, limit });
    if (!file) return jsonError("File not found.", 404);
    return Response.json({ file }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
