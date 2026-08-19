import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  clinicalDataErrorResponse,
  getClinicalClients,
} from "@/lib/clinical/clinical-data";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/clinical/clients", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer", "viewer"]);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    try {
      return Response.json(
        await getClinicalClients(request, {
          query: url.searchParams.get("q") ?? "",
          community: url.searchParams.get("community") ?? "",
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

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
