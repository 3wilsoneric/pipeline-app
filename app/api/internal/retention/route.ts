import { requireInternalWorker } from "@/lib/auth/internal-worker-auth";
import { runDocumentRetention } from "@/lib/extraction/processing-worker";
import { withApiLogging } from "@/lib/observability/api-logging";
import { pruneExpiredUserWorkspaceState } from "@/lib/pipeline/user-workspace-state-store";
import { purgeExpiredReferrals } from "@/lib/pipeline/referral-retention";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/internal/retention", async () => {
    const denied = requireInternalWorker(request);
    if (denied) return denied;
    const dryRun = new URL(request.url).searchParams.get("execute") !== "true";
    const [documents, workspaceState, referrals] = await Promise.all([
      runDocumentRetention(100, dryRun),
      pruneExpiredUserWorkspaceState(100, dryRun),
      purgeExpiredReferrals(100, dryRun),
    ]);
    return Response.json({ documents, workspace_state: workspaceState, referrals }, { headers: { "Cache-Control": "no-store" } });
  });
}
