import { getExtractionBackendReadiness } from "@/lib/extraction/backend-config";
import { getClinicalDataReadiness } from "@/lib/clinical/clinical-data";
import { getAssessmentStoreReadiness } from "@/lib/assessment/assessment-store";
import { getPipelineDatabaseReadiness } from "@/lib/database/pipeline-database";
import { getReferralStoreReadiness } from "@/lib/pipeline/referral-store";
import { getResidentLinkStoreReadiness } from "@/lib/pipeline/resident-link-store";
import { getPipelineAuthReadiness } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getUserWorkspaceStateReadiness } from "@/lib/pipeline/user-workspace-state-store";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/health", () => {
    const extraction = getExtractionBackendReadiness();
    const clinicalData = getClinicalDataReadiness();
    const referralStore = getReferralStoreReadiness();
    const assessmentStore = getAssessmentStoreReadiness();
    const database = getPipelineDatabaseReadiness();
    const residentLinkStore = getResidentLinkStoreReadiness();
    const auth = getPipelineAuthReadiness();
    const workspaceState = getUserWorkspaceStateReadiness();
    const ok = auth.ready &&
      extraction.ready &&
      referralStore.ready &&
      assessmentStore.ready &&
      residentLinkStore.ready &&
      (!database.required || database.ready) &&
      (!workspaceState.enabled || workspaceState.ready) &&
      (!clinicalData.required || clinicalData.ready);

    return Response.json(
      {
        ok,
        service: "pipeline-app",
        checked_at: new Date().toISOString(),
        checks: {
          extraction_backend: extraction,
          clinical_data: clinicalData,
          database,
          referral_store: referralStore,
          assessment_store: assessmentStore,
          resident_link_store: residentLinkStore,
          authentication: auth,
          desktop_workspace_state: workspaceState,
        },
      },
      { status: ok ? 200 : 503 },
    );
  });
}
