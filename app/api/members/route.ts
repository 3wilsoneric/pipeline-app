import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { listWorkspaceMembers } from "@/lib/pipeline/workspace-members";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/members", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const members = await listWorkspaceMembers(auth.user);
    return Response.json({ members, current_principal_id: auth.user.id }, {
      headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
    });
  });
}
