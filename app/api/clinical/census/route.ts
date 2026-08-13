import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  clinicalDataErrorResponse,
  getClinicalCensus,
} from "@/lib/clinical/clinical-data";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/clinical/census", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    try {
      return Response.json(await getClinicalCensus(request), {
        headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
      });
    } catch (error) {
      return clinicalDataErrorResponse(error);
    }
  });
}
