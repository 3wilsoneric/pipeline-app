import { requireInternalWorker } from "@/lib/auth/internal-worker-auth";
import { ClinicalDataError, clinicalDataErrorResponse } from "@/lib/clinical/clinical-data";
import { withApiLogging } from "@/lib/observability/api-logging";
import { reconcileClinicalBacklog } from "@/lib/pipeline/clinical-backlog-reconciliation";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { requireResidentLinkStore } from "@/lib/pipeline/resident-link-store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

function run(request: Request) {
  return withApiLogging(request, "/api/internal/clinical/reconcile", async () => {
    const denied = requireInternalWorker(request);
    if (denied) return denied;
    const referralStore = requireReferralStore();
    if (!referralStore.ok) return referralStore.response;
    const residentLinkStore = requireResidentLinkStore();
    if (!residentLinkStore.ok) return residentLinkStore.response;

    try {
      const result = await reconcileClinicalBacklog(request);
      return Response.json(result, {
        status: result.status === "complete" ? 200 : 503,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    } catch (error) {
      if (error instanceof ClinicalDataError) return clinicalDataErrorResponse(error);
      throw error;
    }
  });
}
