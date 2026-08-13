import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  ClinicalDataError,
  clinicalDataErrorResponse,
} from "@/lib/clinical/clinical-data";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireResidentLinkStore } from "@/lib/pipeline/resident-link-store";
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
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const linkStore = requireResidentLinkStore();
    if (!linkStore.ok) return linkStore.response;
    const residentKey = await parseResidentKey(context);
    if (!residentKey) return jsonError("residentKey is invalid.");
    try {
      return Response.json(
        await getUnifiedClientProfile(request, residentKey, {
          can_create_identity_candidate: auth.user.roles.some((role) =>
            ["admin", "assessment_coordinator", "reviewer"].includes(role),
          ),
          can_review_identity: auth.user.roles.some((role) =>
            ["admin", "reviewer"].includes(role),
          ),
        }),
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

async function parseResidentKey(context: { params: Promise<{ residentKey: string }> }) {
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
