import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  clinicalDataErrorResponse,
  searchClinicalClientDocuments,
} from "@/lib/clinical/clinical-data";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ canonicalClientId: string }> },
) {
  return withApiLogging(request, "/api/clinical/clients/[canonicalClientId]/search", async () => {
      const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer", "viewer"]);
      if (!auth.ok) return auth.response;

      const url = new URL(request.url);
      try {
        const { canonicalClientId } = await context.params;
        return Response.json(
          await searchClinicalClientDocuments(request, decodePathValue(canonicalClientId), {
            query: url.searchParams.get("q") ?? "",
            documentId: url.searchParams.get("document_id") ?? "",
            limit: url.searchParams.get("limit") ?? undefined,
            cursor: url.searchParams.get("cursor") ?? undefined,
          }),
          { headers: privateHeaders() },
        );
      } catch (error) {
        return clinicalDataErrorResponse(error);
      }
  });
}

function decodePathValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
