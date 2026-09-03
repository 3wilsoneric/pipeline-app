import { requireInternalWorker } from "@/lib/auth/internal-worker-auth";
import { runDocumentRetention } from "@/lib/extraction/processing-worker";
import { getStorageInventory } from "@/lib/extraction/storage-inventory";
import { withApiLogging } from "@/lib/observability/api-logging";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";
import { pruneExpiredUserWorkspaceState } from "@/lib/pipeline/user-workspace-state-store";
import { purgeExpiredReferrals } from "@/lib/pipeline/referral-retention";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/internal/retention", async () => {
    const denied = requireInternalWorker(request);
    if (denied) return denied;
    const dryRun = new URL(request.url).searchParams.get("execute") !== "true";
    const workspaceStateRetention = pruneExpiredUserWorkspaceState(100, dryRun).catch((error) => {
      recordPipelineMetric("pipeline.retention.workspace_state", 1, "count", {
        operation: dryRun ? "retention_preview" : "retention_execute",
        result: "failed",
      });
      throw error;
    });
    const [documents, workspaceState, referrals, storageInventory] = await Promise.all([
      runDocumentRetention(100, dryRun),
      workspaceStateRetention,
      purgeExpiredReferrals(100, dryRun),
      getStorageInventory(),
    ]);
    recordPipelineMetric("pipeline.retention.workspace_state", workspaceState.eligible, "count", {
      operation: dryRun ? "retention_preview" : "retention_execute",
      result: dryRun ? "eligible" : "deleted",
      backend: workspaceState.mode,
    });
    return Response.json(
      { documents, workspace_state: workspaceState, referrals, storage_inventory: storageInventory },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
