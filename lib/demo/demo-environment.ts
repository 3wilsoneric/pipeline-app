import "server-only";

export type PipelineDemoEnvironment = {
  enabled: boolean;
  writable: boolean;
  label: string;
  entryUrl: string | null;
  reason: string;
};

export function getPipelineDemoEnvironment(): PipelineDemoEnvironment {
  const local = process.env.NODE_ENV !== "production";
  const enabled = local || process.env.PIPELINE_DEMO_MODE === "true";
  const durableStoreConfigured = demoDurableStoreIsConfigured();
  const isolated = process.env.PIPELINE_DEMO_DATA_ISOLATED === "true" || (local && !durableStoreConfigured);
  const configuredUrl = process.env.NEXT_PUBLIC_PIPELINE_DEMO_URL?.trim() || null;

  return {
    enabled,
    writable: enabled && isolated,
    label: process.env.PIPELINE_DEMO_ENVIRONMENT_LABEL?.trim() || (local ? "Local demo" : "Pipeline demo"),
    entryUrl: configuredUrl ?? (enabled ? "/training/demo" : null),
    reason: demoEnvironmentReason(enabled, isolated),
  };
}

function demoDurableStoreIsConfigured() {
  const storeModes = [
    process.env.PIPELINE_DATABASE_MODE,
    process.env.PIPELINE_REFERRAL_STORE_MODE,
    process.env.PIPELINE_ASSESSMENT_STORE_MODE,
  ];
  return storeModes.some((mode) => mode?.trim() === "postgres")
    || Boolean(process.env.PIPELINE_DATABASE_URL?.trim());
}

function demoEnvironmentReason(enabled: boolean, isolated: boolean) {
  if (!enabled) return "This deployment is not configured as a demo environment.";
  if (!isolated) return "Synthetic writes are blocked until the deployment uses an explicitly isolated demo data store.";
  return "Synthetic scenario writes are isolated from production data.";
}
