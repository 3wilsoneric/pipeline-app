import "server-only";

import { getClinicalAuthMode, getClinicalDataMode, getClinicalDataReadiness, getClinicalRoster } from "./clinical-data";

// Service-authorized source preparation only. This never loads an operator's
// workspace, bypasses its permissions, creates a session, or writes records.
export async function warmClinicalSourceAtStartup() {
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build"
    || getClinicalDataMode() !== "alamo_api" || getClinicalAuthMode() === "delegated"
    || !getClinicalDataReadiness().ready) return;
  const start = Date.now();
  try {
    await getClinicalRoster(undefined, { limit: 200 });
    console.log(JSON.stringify({ level: "info", service: "pipeline-app", msg: "clinical_source_prewarmed", duration_ms: Date.now() - start }));
  } catch {
    // An upstream outage must not block the unaffected referral/chart workflows.
    // The canonical clinical reader owns the timeout and normal retry path.
    console.warn(JSON.stringify({ level: "warn", service: "pipeline-app", msg: "clinical_source_prewarm_failed", duration_ms: Date.now() - start }));
  }
}
