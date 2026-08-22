import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { listDeletedReferrals, requireReferralStore } from "@/lib/pipeline/referral-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/trash/referrals", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length > 200) return Response.json({ error: "Search is too long." }, { status: 400 });
    return Response.json(await listDeletedReferrals(query), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
