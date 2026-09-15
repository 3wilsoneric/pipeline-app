import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { assertPersonaDemoIsolation, personaDemoRequiredEnvironment, personaDemoStoreFiles } from "../shared/persona-demo-config.mjs";

function configuration() {
  const root = resolve(".data/persona-demo-unit");
  return {
    ...personaDemoRequiredEnvironment,
    PIPELINE_PERSONA_DEMO: "true",
    PIPELINE_PERSONA_DEMO_ROOT: root,
    PIPELINE_PERSONA_DEMO_ORIGIN: "http://127.0.0.1:3217",
    ...Object.fromEntries(Object.entries(personaDemoStoreFiles).map(([key, filename]) => [key, resolve(root, filename)])),
  };
}

test("ordinary deployments are untouched and an isolated demo is accepted", () => {
  assert.doesNotThrow(() => assertPersonaDemoIsolation({ PIPELINE_DATABASE_MODE: "postgres" }));
  assert.doesNotThrow(() => assertPersonaDemoIsolation(configuration()));
});

test("every local data path is required and cannot point at the live store", () => {
  for (const key of Object.keys(personaDemoStoreFiles)) {
    assert.throws(() => assertPersonaDemoIsolation({ ...configuration(), [key]: resolve(".data/referrals.json") }));
    assert.throws(() => assertPersonaDemoIsolation({ ...configuration(), [key]: "" }));
  }
});

test("production databases, clinical endpoints, mail and worker credentials block startup", () => {
  for (const key of ["PIPELINE_DATABASE_URL", "DATABASE_URL", "AZURE_STORAGE_ACCOUNT", "PIPELINE_ALAMO_API_BASE_URL", "PIPELINE_GRAPH_CLIENT_SECRET", "PIPELINE_WORKER_SHARED_SECRET", "DATABRICKS_HOST", "PIPELINE_NOTE_LAB_MANIFEST_PATH"]) {
    assert.throws(() => assertPersonaDemoIsolation({ ...configuration(), [key]: "configured" }));
  }
  for (const key of Object.keys(personaDemoRequiredEnvironment)) {
    assert.throws(() => assertPersonaDemoIsolation({ ...configuration(), [key]: "wrong" }));
  }
});

test("the mock identity switch cannot be hosted publicly", () => {
  for (const origin of ["https://alamo-pipeline.com", "http://0.0.0.0:3217", "http://127.0.0.1", "https://127.0.0.1:3217"]) {
    assert.throws(() => assertPersonaDemoIsolation({ ...configuration(), PIPELINE_PERSONA_DEMO_ORIGIN: origin }));
  }
});
