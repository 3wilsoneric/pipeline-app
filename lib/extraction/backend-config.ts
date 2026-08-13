import "server-only";

export type ExtractionBackendMode = "mock" | "manual" | "azure_databricks";

const durableUploadEnv = [
  "AZURE_STORAGE_ACCOUNT",
  "AZURE_STORAGE_CONTAINER_RAW",
  "PIPELINE_DATABASE_URL",
] as const;

const azureDatabricksEnv = [
  "AZURE_STORAGE_ACCOUNT",
  "AZURE_STORAGE_CONTAINER_RAW",
  "AZURE_STORAGE_CONTAINER_NORMALIZED",
  "AZURE_STORAGE_CONTAINER_OCR",
  "AZURE_STORAGE_CONTAINER_EVIDENCE",
  "AZURE_STORAGE_CONTAINER_ARTIFACTS",
  "DATABRICKS_HOST",
  "DATABRICKS_JOB_ID",
  "PIPELINE_DATABRICKS_AUTH_MODE",
  "DATABRICKS_CLIENT_ID",
  "DATABRICKS_CLIENT_SECRET",
  "PIPELINE_DATABASE_URL",
] as const;

export type ExtractionBackendReadiness = {
  mode: ExtractionBackendMode;
  ready: boolean;
  missing_env: string[];
  production_mock_blocked: boolean;
};

export function getExtractionBackendMode(): ExtractionBackendMode {
  const configured = process.env.PIPELINE_EXTRACTION_BACKEND;
  const productionMockBlocked =
    process.env.NODE_ENV === "production" &&
    configured === "mock" &&
    process.env.PIPELINE_ALLOW_PRODUCTION_MOCK_EXTRACTION !== "true";

  if (productionMockBlocked) {
    return "azure_databricks";
  }

  if (configured === "mock" || configured === "manual" || configured === "azure_databricks") {
    return configured;
  }

  return process.env.NODE_ENV === "production" ? "azure_databricks" : "mock";
}

export function getExtractionBackendReadiness(): ExtractionBackendReadiness {
  const configured = process.env.PIPELINE_EXTRACTION_BACKEND;
  const mode = getExtractionBackendMode();
  const productionMockBlocked =
    process.env.NODE_ENV === "production" &&
    configured === "mock" &&
    process.env.PIPELINE_ALLOW_PRODUCTION_MOCK_EXTRACTION !== "true";
  const missingEnv = mode === "azure_databricks"
    ? [...new Set([
        ...azureDatabricksEnv.filter((name) => !process.env[name]?.trim()),
        ...(process.env.PIPELINE_DATABRICKS_AUTH_MODE === "oauth_m2m" ? [] : ["PIPELINE_DATABRICKS_AUTH_MODE"]),
      ])]
    : mode === "manual"
      ? durableUploadEnv.filter((name) => !process.env[name]?.trim())
      : [];

  return {
    mode,
    ready: mode === "mock" || missingEnv.length === 0,
    missing_env: missingEnv,
    production_mock_blocked: productionMockBlocked,
  };
}

export function requireExtractionBackend() {
  const readiness = getExtractionBackendReadiness();
  if (!readiness.ready) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "The packet processing backend is not configured.", readiness },
        { status: 503 },
      ),
      readiness,
    };
  }
  return { ok: true as const, readiness };
}
