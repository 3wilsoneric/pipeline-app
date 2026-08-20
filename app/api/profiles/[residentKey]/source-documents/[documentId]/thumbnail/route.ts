import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  ClinicalDataError,
  clinicalDataErrorResponse,
  getClinicalClientDocumentAsset,
} from "@/lib/clinical/clinical-data";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ residentKey: string; documentId: string }> },
) {
  return withApiLogging(request, "/api/profiles/[residentKey]/source-documents/[documentId]/thumbnail", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer", "viewer"]);
    if (!auth.ok) return auth.response;
    const identifiers = await parseIdentifiers(context);
    if (!identifiers) return Response.json({ error: "Thumbnail not found." }, { status: 404 });
    try {
      return await getClinicalClientDocumentAsset(
        request,
        identifiers.canonicalClientId,
        identifiers.documentId,
        "thumbnail",
      );
    } catch (error) {
      if (error instanceof ClinicalDataError) return clinicalDataErrorResponse(error);
      throw error;
    }
  });
}

async function parseIdentifiers(context: { params: Promise<{ residentKey: string; documentId: string }> }) {
  const { residentKey, documentId } = await context.params;
  try {
    const canonicalClientId = decodeURIComponent(residentKey).trim();
    const normalizedDocumentId = decodeURIComponent(documentId).trim();
    if (!canonicalClientId || canonicalClientId.length > 256 || !normalizedDocumentId || normalizedDocumentId.length > 256) {
      return null;
    }
    return { canonicalClientId, documentId: normalizedDocumentId };
  } catch {
    return null;
  }
}
