import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { listAssessments, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { isKeysetCursor } from "@/lib/pipeline/keyset-cursor";
import { canAccessReferral, isAssessorUser } from "@/lib/pipeline/referral-access";
import { getReferral } from "@/lib/pipeline/referral-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/assessments", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireAssessmentStore();
    if (!store.ok) return store.response;

    const url = new URL(request.url);
    const canonicalClientId = url.searchParams.get("canonical_client_id")?.trim() ?? "";
    const residentNumber = url.searchParams.get("resident_number")?.trim() ?? "";
    const residentKey = url.searchParams.get("resident_key")?.trim() ?? "";
    if (!canonicalClientId && !residentNumber && !residentKey) {
      return jsonError("canonical_client_id, resident_number, or resident_key is required.");
    }
    if (canonicalClientId.length > 256 || residentNumber.length > 128 || residentKey.length > 256) {
      return jsonError("Client identifier is invalid.");
    }

    const cursor = url.searchParams.get("cursor")?.trim() ?? "";
    if (cursor && !isKeysetCursor(cursor)) return jsonError("cursor is invalid.");

    const result = await listAssessments({
      canonicalClientId: canonicalClientId || undefined,
      residentNumber: residentNumber || undefined,
      residentKey: residentKey || undefined,
      limit: Number(url.searchParams.get("limit") ?? 100),
      cursor: cursor || undefined,
    });
    if (!isAssessorUser(auth.user)) {
      return Response.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
    const visible = (await Promise.all(result.assessments.map(async (assessment) => {
      const referral = await getReferral(assessment.referral_id);
      return referral && canAccessReferral(auth.user, referral) ? assessment : null;
    }))).filter((assessment): assessment is NonNullable<typeof assessment> => Boolean(assessment));
    return Response.json({ ...result, assessments: visible, total: visible.length }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
