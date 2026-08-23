import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  ClinicalDataError,
  clinicalDataErrorResponse,
  getClinicalClientDocumentAsset,
} from "@/lib/clinical/clinical-data";
import {
  parseClinicalClientDocumentIdentifiers,
  type ClinicalClientDocumentRouteContext,
} from "@/lib/clinical/client-document-identifiers";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: ClinicalClientDocumentRouteContext,
) {
  return withApiLogging(request, "/api/profiles/[residentKey]/source-documents/[documentId]/preview", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer", "viewer"]);
    if (!auth.ok) return auth.response;
    const identifiers = await parseClinicalClientDocumentIdentifiers(context);
    if (!identifiers) return Response.json({ error: "File preview not found." }, { status: 404 });
    try {
      return await getClinicalClientDocumentAsset(
        request,
        identifiers.canonicalClientId,
        identifiers.documentId,
        "preview",
      );
    } catch (error) {
      if (error instanceof ClinicalDataError) return clinicalDataErrorResponse(error);
      throw error;
    }
  });
}
