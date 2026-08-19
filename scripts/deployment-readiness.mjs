#!/usr/bin/env node

const groups = {
  database: [
    "PIPELINE_DATABASE_MODE",
    "PIPELINE_DATABASE_URL",
    "PIPELINE_DATABASE_SSL_MODE",
    "PIPELINE_REFERRAL_STORE_MODE",
    "PIPELINE_ASSESSMENT_STORE_MODE",
    "PIPELINE_RESIDENT_LINK_STORE_MODE",
  ],
  user_authentication: [
    "NEXT_PUBLIC_PIPELINE_BASE_PATH",
    "NEXT_PUBLIC_ENTRA_TENANT_ID",
    "NEXT_PUBLIC_ENTRA_CLIENT_ID",
    "NEXT_PUBLIC_PIPELINE_API_SCOPE",
    "NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED",
    "PIPELINE_AUTH_MODE",
    "PIPELINE_ENTRA_TENANT_ID",
    "PIPELINE_ENTRA_API_AUDIENCE",
    "PIPELINE_ENTRA_API_SCOPE",
    "PIPELINE_ENTRA_SESSION_SECRET",
  ],
  clinical_api: ["PIPELINE_CLINICAL_DATA_MODE"],
  packet_processing: ["PIPELINE_EXTRACTION_BACKEND"],
};

const readiness = Object.fromEntries(Object.entries(groups).map(([group, names]) => {
  const present = Object.fromEntries(names.map((name) => [name, Boolean(process.env[name]?.trim())]));
  return [group, {
    ready: Object.values(present).every(Boolean),
    configuration_present: present,
  }];
}));

const clinicalMode = process.env.PIPELINE_CLINICAL_DATA_MODE?.trim();
const clinicalVariables = clinicalMode === "alamo_api"
  ? [
      "PIPELINE_ALAMO_API_BASE_URL",
      "PIPELINE_ALAMO_AUTH_MODE",
      "PIPELINE_ALAMO_TENANT_ID",
      "PIPELINE_ALAMO_CLIENT_ID",
      "PIPELINE_ALAMO_CLIENT_SECRET",
      "PIPELINE_ALAMO_API_SCOPE",
    ]
  : [];
const clinicalPresent = Object.fromEntries(
  clinicalVariables.map((name) => [name, Boolean(process.env[name]?.trim())]),
);
readiness.clinical_api.configuration_present = {
  ...readiness.clinical_api.configuration_present,
  ...clinicalPresent,
};
readiness.clinical_api.ready = (
  clinicalMode === "disconnected"
  || (clinicalMode === "alamo_api" && Object.values(clinicalPresent).every(Boolean))
);

const extractionMode = process.env.PIPELINE_EXTRACTION_BACKEND?.trim();
const packetVariables = extractionMode === "azure_databricks"
  ? [
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
      "PIPELINE_WORKER_SHARED_SECRET",
      "CRON_SECRET",
    ]
  : extractionMode === "manual"
    ? ["AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_CONTAINER_RAW"]
    : [];
const packetPresent = Object.fromEntries(
  packetVariables.map((name) => [name, Boolean(process.env[name]?.trim())]),
);
readiness.packet_processing.configuration_present = {
  ...readiness.packet_processing.configuration_present,
  ...packetPresent,
};
readiness.packet_processing.ready = (
  ["manual", "azure_databricks"].includes(extractionMode ?? "")
  && Object.values(packetPresent).every(Boolean)
);
const desktopEnabled = process.env.NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED === "true"
  || process.env.PIPELINE_DESKTOP_STATE_ENABLED === "true";
const desktopVariables = [
  "NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED",
  "PIPELINE_DESKTOP_STATE_ENABLED",
];
const desktopPresent = Object.fromEntries(
  desktopVariables.map((name) => [name, Boolean(process.env[name]?.trim())]),
);
readiness.desktop_distribution = {
  ready: !desktopEnabled || (
    process.env.NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED === "true"
    && process.env.PIPELINE_DESKTOP_STATE_ENABLED === "true"
    && process.env.PIPELINE_DATABASE_MODE === "postgres"
  ),
  enabled: desktopEnabled,
  configuration_present: desktopPresent,
};
const storageCredentials = {
  PIPELINE_AZURE_BLOB_AUTH_MODE: Boolean(process.env.PIPELINE_AZURE_BLOB_AUTH_MODE?.trim()),
  AZURE_CLIENT_ID: Boolean(process.env.AZURE_CLIENT_ID?.trim()),
};
readiness.packet_processing.configuration_present = {
  ...readiness.packet_processing.configuration_present,
  ...storageCredentials,
};
const blobAuthMode = process.env.PIPELINE_AZURE_BLOB_AUTH_MODE?.trim();
const blobAuthReady = blobAuthMode === "managed_identity" && storageCredentials.AZURE_CLIENT_ID;
readiness.packet_processing.ready = readiness.packet_processing.ready && blobAuthReady;
const ready = Object.values(readiness).every((group) => group.ready);

console.log(JSON.stringify({
  ok: ready,
  readiness,
  note: "This check reports configuration presence only. It never prints values, credentials, URLs, tokens, or clinical data.",
}, null, 2));

if (!ready) process.exit(1);
