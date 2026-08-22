import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { listReferralFacets, requireReferralStore } from "@/lib/pipeline/referral-store";
import { scopeReferralListOptions } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/referrals/facets", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get("q")?.trim() ?? "";
    const workspace = searchParams.get("workspace")?.trim() || "active";
    if (query.length > 200) return jsonError("q must be 200 characters or fewer.");
    if (!new Set(["active", "historical", "archived", "all"]).has(workspace)) {
      return jsonError("workspace is invalid.");
    }
    const access = scopeReferralListOptions(auth.user, {
      workspaceStatus: workspace as "active" | "historical" | "archived" | "all",
    });
    const facets = await listReferralFacets(query, access);

    return Response.json({ facets }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
