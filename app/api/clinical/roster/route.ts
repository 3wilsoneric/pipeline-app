import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  clinicalDataErrorResponse,
  getClinicalRoster,
  toClinicalResidentDirectoryResult,
} from "@/lib/clinical/clinical-data";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/clinical/roster", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    try {
      const roster = await getClinicalRoster(request, {
          query: url.searchParams.get("q") ?? "",
          community: url.searchParams.get("community") ?? "",
          limit: url.searchParams.get("limit") ?? undefined,
          cursor: url.searchParams.get("cursor") ?? undefined,
        });
      return Response.json(
        {
          ...roster,
          residents: roster.residents.map(toClinicalResidentDirectoryResult),
        },
        { headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" } },
      );
    } catch (error) {
      return clinicalDataErrorResponse(error);
    }
  });
}
