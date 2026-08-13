export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getExtractionBackendReadiness } = await import(
    "./lib/extraction/backend-config"
  );

  const readiness = getExtractionBackendReadiness();

  console.log(
    JSON.stringify({
      level: readiness.ready ? "info" : "warn",
      service: "pipeline-app",
      msg: "instrumentation_registered",
      extraction_backend: readiness,
      checked_at: new Date().toISOString(),
    }),
  );
}
