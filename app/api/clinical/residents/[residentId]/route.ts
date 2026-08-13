import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  clinicalDataErrorResponse,
  getClinicalResident,
} from "@/lib/clinical/clinical-data";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ residentId: string }> },
) {
  return withApiLogging(request, "/api/clinical/residents/[residentId]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;

    try {
      const { residentId } = await context.params;
      return Response.json(
        await getClinicalResident(request, decodeResidentId(residentId)),
        { headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" } },
      );
    } catch (error) {
      return clinicalDataErrorResponse(error);
    }
  });
}

function decodeResidentId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
