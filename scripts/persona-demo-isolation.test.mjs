import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { webcrypto } from "node:crypto";
import { assertPersonaDemoIsolation, personaDemoRequiredEnvironment, personaDemoStoreFiles } from "../shared/persona-demo-config.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

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

function loadBoundary(path, env = configuration()) {
  const logs = [];
  const loadedModule = loadTypeScriptModule(process.cwd(), path, {
    process: { env },
    crypto: webcrypto,
    console: { ...console, log: (line) => logs.push(line), warn: (line) => logs.push(line), error: (line) => logs.push(line) },
  });
  return { module: loadedModule, logs };
}

function switchRequest(headers = {}, body = '{"persona":"assessor"}') {
  return new Request("http://127.0.0.1:3217/api/demo/persona", {
    method: "POST",
    headers: { host: "127.0.0.1:3217", origin: "http://127.0.0.1:3217", "content-type": "application/json", ...headers },
    body,
  });
}

test("disabled persona route stays absent and logs only canonical request metadata", async () => {
  const { module, logs } = loadBoundary("app/api/demo/persona/route.ts", { NODE_ENV: "production" });
  const response = await module.POST(switchRequest({ "x-request-id": "untrusted-request-id" }));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.notEqual(response.headers.get("x-request-id"), "untrusted-request-id");
  const entry = logs.map((line) => JSON.parse(line)).find((line) => line.msg === "done");
  assert.equal(entry.route, "/api/demo/persona");
  assert.equal(entry.status, 404);
  assert.equal(JSON.stringify(logs).includes("untrusted-request-id"), false);
});

test("local persona switch retains cookie, host, origin, stale-tab and body validation", async () => {
  const { module } = loadBoundary("app/api/demo/persona/route.ts");
  const success = await module.POST(switchRequest());
  assert.equal(success.status, 200);
  assert.match(success.headers.get("set-cookie"), /pipeline_practice_persona_3217=assessor; Path=\/; HttpOnly; SameSite=Strict/);
  const returnToSupervisor = await module.POST(switchRequest({ cookie: "pipeline_practice_persona_3217=assessor", "x-pipeline-persona": "assessor" }, '{"persona":"supervisor"}'));
  assert.equal(returnToSupervisor.status, 200);
  const cases = [
    [switchRequest({ host: "outside.example" }), 403],
    [switchRequest({ cookie: "pipeline_practice_persona_3217=admin" }), 403],
    [switchRequest({ "x-pipeline-persona": "assessor" }), 409],
    [switchRequest({ origin: "https://outside.example" }), 403],
    [switchRequest({}, '{"persona":"admin"}'), 400],
    [switchRequest({}, '{'), 400],
  ];
  for (const [request, status] of cases) {
    const response = await module.POST(request);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("identity reads use the same isolation and persona validation as authenticated requests", async () => {
  const { module } = loadBoundary("lib/auth/pipeline-auth.ts");
  const user = await module.getPipelineUserFromRequest(switchRequest({ cookie: "pipeline_practice_persona_3217=assessor" }));
  assert.equal(user.id, "practice-assessor");
  assert.equal(user.roles.join(","), "reviewer,viewer");
  assert.equal(await module.getPipelineUserFromRequest(switchRequest({ cookie: "pipeline_practice_persona_3217=admin" })), null);
  const unsafe = loadBoundary("lib/auth/pipeline-auth.ts", { ...configuration(), PIPELINE_DATABASE_URL: "forbidden" }).module;
  assert.equal(await unsafe.getPipelineUserFromRequest(switchRequest()), null);
});
