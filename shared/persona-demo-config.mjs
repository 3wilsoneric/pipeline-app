import { isAbsolute, resolve, sep } from "node:path";

export const personaDemoStoreFiles = {
  PIPELINE_REFERRAL_STORE_PATH: "referrals.json",
  PIPELINE_ASSESSMENT_STORE_PATH: "assessments.json",
  PIPELINE_RESIDENT_LINK_STORE_PATH: "resident-links.json",
  PIPELINE_CONTACT_STORE_PATH: "contacts.json",
  PIPELINE_DESKTOP_STATE_STORE_PATH: "desktop-state.json",
  PIPELINE_NOTE_LAB_STORE_PATH: "note-lab.json",
  PIPELINE_LOCAL_DOCUMENT_ROOT: "documents",
};

export const personaDemoRequiredEnvironment = {
  NEXT_PUBLIC_PIPELINE_PERSONA_DEMO: "true",
  PIPELINE_AUTH_MODE: "mock",
  PIPELINE_DEMO_MODE: "true",
  PIPELINE_DEMO_DATA_ISOLATED: "true",
  PIPELINE_DATABASE_MODE: "local_file",
  PIPELINE_REFERRAL_STORE_MODE: "local_file",
  PIPELINE_ASSESSMENT_STORE_MODE: "local_file",
  PIPELINE_RESIDENT_LINK_STORE_MODE: "local_file",
  PIPELINE_CONTACT_STORE_MODE: "local_file",
  PIPELINE_EXTRACTION_BACKEND: "mock",
  PIPELINE_ALLOW_PRODUCTION_MOCK_EXTRACTION: "true",
  PIPELINE_CLINICAL_DATA_MODE: "disconnected",
  PIPELINE_CLIENT_HISTORY_MODE: "disconnected",
  NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED: "false",
};

// This first version is deliberately loopback-only. Hosting requires a separate
// authenticated deployment, not lifting the mock-auth or storage restrictions.
export function assertPersonaDemoIsolation(env = process.env) {
  if (env.PIPELINE_PERSONA_DEMO !== "true") return;
  for (const [key, value] of Object.entries(personaDemoRequiredEnvironment)) {
    if (env[key] !== value) throw new Error(`Persona demo requires ${key}=${value}.`);
  }
  const root = env.PIPELINE_PERSONA_DEMO_ROOT;
  if (!root || !isAbsolute(root) || !root.includes(`${sep}.data${sep}persona-demo`)) {
    throw new Error("Persona demo requires its own absolute .data/persona-demo storage directory.");
  }
  for (const [key, filename] of Object.entries(personaDemoStoreFiles)) {
    if (env[key] !== resolve(root, filename)) throw new Error(`Persona demo storage mismatch: ${key}.`);
  }
  const origin = new URL(env.PIPELINE_PERSONA_DEMO_ORIGIN || "https://invalid.example");
  if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:" || !origin.port) {
    throw new Error("Persona demo must run on its own loopback port.");
  }
  const forbidden = /^(AZURE_|DATABRICKS_|DATABASE_URL$|PIPELINE_(DATABASE_URL|ALAMO_|GRAPH_|MEET_CLIENT_|WORKER_SHARED_SECRET|NOTE_LAB_MANIFEST_PATH|CLIENT_HISTORY_SNAPSHOT_PATH|CLINICAL_DEMO_SNAPSHOT_PATH))/;
  for (const [key, value] of Object.entries(env)) {
    if (value && forbidden.test(key)) throw new Error(`Remove external integration configuration from the persona demo: ${key}.`);
  }
}
