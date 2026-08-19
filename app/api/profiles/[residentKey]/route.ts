import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  ClinicalDataError,
  clinicalDataErrorResponse,
} from "@/lib/clinical/clinical-data";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  getUnifiedClientProfile,
  unifiedProfileErrorResponse,
} from "@/lib/pipeline/unified-profile";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ residentKey: string }> },
) {
  return withApiLogging(request, "/api/profiles/[residentKey]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer", "viewer"]);
    if (!auth.ok) return auth.response;
    const canonicalClientId = await parseCanonicalClientId(context);
    if (!canonicalClientId) return jsonError("canonical client identifier is invalid.");
    try {
      return Response.json(
        await getUnifiedClientProfile(request, canonicalClientId, {
          can_create_identity_candidate: auth.user.roles.some((role) =>
            ["admin", "assessment_coordinator", "reviewer"].includes(role),
          ),
          can_review_identity: auth.user.roles.some((role) =>
            ["admin", "reviewer"].includes(role),
          ),
        }, auth.user),
        { headers: privateHeaders() },
      );
    } catch (error) {
      const unified = unifiedProfileErrorResponse(error);
      if (unified) return unified;
      if (error instanceof ClinicalDataError) return clinicalDataErrorResponse(error);
      throw error;
    }
  });
}

async function parseCanonicalClientId(context: { params: Promise<{ residentKey: string }> }) {
  const { residentKey } = await context.params;
  try {
    const decoded = decodeURIComponent(residentKey).trim();
    return decoded && decoded.length <= 256 ? decoded : null;
  } catch {
    return null;
  }
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
