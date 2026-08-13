import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { listAssessments, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { isKeysetCursor } from "@/lib/pipeline/keyset-cursor";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/assessments", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireAssessmentStore();
    if (!store.ok) return store.response;

    const url = new URL(request.url);
    const residentNumber = url.searchParams.get("resident_number")?.trim() ?? "";
    const residentKey = url.searchParams.get("resident_key")?.trim() ?? "";
    if (!residentNumber && !residentKey) {
      return jsonError("resident_number or resident_key is required.");
    }
    if (residentNumber.length > 128 || residentKey.length > 256) return jsonError("Resident identifier is invalid.");

    const cursor = url.searchParams.get("cursor")?.trim() ?? "";
    if (cursor && !isKeysetCursor(cursor)) return jsonError("cursor is invalid.");

    const result = await listAssessments({
      residentNumber: residentNumber || undefined,
      residentKey: residentKey || undefined,
      limit: Number(url.searchParams.get("limit") ?? 100),
      cursor: cursor || undefined,
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}
