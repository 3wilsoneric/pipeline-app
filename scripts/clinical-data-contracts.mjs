#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const fixture = JSON.parse(
  readFileSync(path.join(root, "scripts/fixtures/alamo-pipeline-clinical.sanitized.json"), "utf8"),
);
const contracts = loadTypeScriptModule(root, "lib/clinical/clinical-contracts.ts");
const clinicalEnvironment = {
  NODE_ENV: "production",
  PIPELINE_CLINICAL_DATA_MODE: "alamo_api",
  PIPELINE_ALAMO_API_BASE_URL: "https://www.alamoplatform.com",
  PIPELINE_ALAMO_AUTH_MODE: "client_credentials",
  PIPELINE_ALAMO_TENANT_ID: "fixture-tenant",
  PIPELINE_ALAMO_CLIENT_ID: "fixture-client",
  PIPELINE_ALAMO_CLIENT_SECRET: "fixture-secret",
  PIPELINE_ALAMO_API_SCOPE: "api://fixture-alamo-app/.default",
  PIPELINE_CLINICAL_TIMEOUT_MS: "10000",
  PIPELINE_CLINICAL_MAX_RESPONSE_BYTES: "2097152",
};

const results = await Promise.all([
  run("sanitized health contract is accepted", () => {
    const health = contracts.parseClinicalHealthResponse(fixture.health);
    assert(health.ready === true, "Expected ready health fixture");
    assert(health.checks.qa_approved === true, "Expected governed QA approval");
  }),
  run("census keeps missing observations distinct from zero", () => {
    const census = contracts.parseClinicalCensusResponse(fixture.census);
    const missing = census.communities.find((row) => row.community_id === "343");
    assert(missing.current_census === null, "Missing census must remain null");
    assert(census.portfolio_census_total === null, "Incomplete portfolio census must remain null");
  }),
  run("roster and resident fields follow the dedicated API contract", () => {
    const roster = contracts.parseClinicalRosterResponse(fixture.roster);
    const resident = contracts.parseClinicalResidentResponse(fixture.resident);
    assert(roster.residents[0].resident_key === "337:R-100", "Expected community-qualified key");
    assert(roster.residents[0].resident_number === null, "Missing resident number must remain null");
    assert(resident.resident.unit === "A-1", "Expected governed unit field");
    assert(resident.resident.length_of_stay_days === 209, "Expected governed length of stay");
    assert(resident.resident.date_of_birth === null, "Older Alamo payloads may omit DOB during rollout");

    const withResidentNumber = structuredClone(fixture.resident);
    withResidentNumber.resident.resident_number = "EM-1001";
    withResidentNumber.resident.date_of_birth = "1985-04-12";
    assert(
      contracts.parseClinicalResidentResponse(withResidentNumber).resident.resident_number === "EM-1001",
      "Governed ElderMark resident number must cross the dedicated contract",
    );
    assert(
      contracts.parseClinicalResidentResponse(withResidentNumber).resident.date_of_birth === "1985-04-12",
      "Governed DOB must cross the dedicated contract when supplied",
    );
  }),
  run("roster response cannot exceed 200 rows", () => {
    const oversized = structuredClone(fixture.roster);
    oversized.limit = 200;
    oversized.residents = Array.from({ length: 201 }, (_, index) => ({
      ...fixture.roster.residents[0],
      resident_id: `R-${index}`,
      resident_key: `337:R-${index}`,
    }));
    assertThrows(() => contracts.parseClinicalRosterResponse(oversized), "Expected oversized roster rejection");
  }),
  run("medication summary rejects raw detail fields", () => {
    const summary = contracts.parseClinicalMedicationSummaryResponse(fixture.medications_summary);
    assert(summary.portfolio.refusal_count === 3, "Expected governed refusal total");
    const unsafe = structuredClone(fixture.medications_summary);
    unsafe.communities[0].medication_name = "Must not cross boundary";
    assertThrows(
      () => contracts.parseClinicalMedicationSummaryResponse(unsafe),
      "Expected medication detail rejection",
    );
  }),
  run("missing provenance and guessed numeric strings fail validation", () => {
    const missingSource = structuredClone(fixture.census);
    delete missingSource.snapshot_id;
    assertThrows(() => contracts.parseClinicalCensusResponse(missingSource), "Expected missing snapshot rejection");
    const guessedNumber = structuredClone(fixture.census);
    guessedNumber.communities[0].current_census = "2";
    assertThrows(() => contracts.parseClinicalCensusResponse(guessedNumber), "Expected numeric string rejection");
  }),
  run("adapter uses only the narrow server-side Alamo namespace", () => {
    const adapter = read("lib/clinical/clinical-data.ts");
    assert(adapter.includes('import "server-only"'), "Clinical adapter must be server-only");
    assert(adapter.includes("/api/integrations/pipeline/clinical"), "Expected dedicated Alamo namespace");
    assert(!adapter.includes("/api/platform/bootstrap"), "Adapter must not request full Alamo bootstrap");
    for (const endpoint of ["/health", "/census", "/roster", "/residents/", "/medications/summary"]) {
      assert(adapter.includes(endpoint), `Expected dedicated clinical endpoint ${endpoint}`);
    }
    assert(adapter.includes("client_credentials"), "Expected service-to-service Entra support");
    assert(adapter.includes("PIPELINE_ALAMO_API_SCOPE"), "Expected Entra resource scope");
    assert(adapter.includes("readBoundedJson"), "Expected bounded upstream responses");
  }),
  run("all Pipeline clinical routes require Pipeline identity and structured logging", () => {
    for (const route of [
      "app/api/clinical/health/route.ts",
      "app/api/clinical/census/route.ts",
      "app/api/clinical/roster/route.ts",
      "app/api/clinical/residents/[residentId]/route.ts",
      "app/api/clinical/medications/summary/route.ts",
    ]) {
      const source = read(route);
      assert(source.includes("requirePipelineUser"), `${route} must require Pipeline identity`);
      assert(source.includes("withApiLogging"), `${route} must use PHI-safe route logging`);
      assert(source.includes("private, no-store"), `${route} must disable shared caching`);
    }
    const healthRoute = read("app/api/clinical/health/route.ts");
    assert(healthRoute.includes("health.ready ? 200 : 503"), "Clinical health must fail readiness when upstream is stale or incomplete");
  }),
  run("browser code imports clinical contracts without the server-only adapter", () => {
    const browserSearch = read("components/pipeline/PipelineSearchPanel.tsx");
    assert(browserSearch.includes('from "@/lib/clinical/clinical-contracts"'), "Browser code must use public clinical types");
    assert(!browserSearch.includes('from "@/lib/clinical/clinical-data"'), "Browser code must not import the server-only adapter");
    const profileDirectory = read("components/pipeline/ClientProfileDirectory.tsx");
    const profileView = read("components/pipeline/ClientProfileView.tsx");
    assert(profileDirectory.includes("/api/clinical/roster"), "Profiles must come from the admitted-client roster");
    assert(profileView.includes("/api/profiles/"), "Profile detail must come from the governed unified-profile endpoint");
    assert(!profileView.includes("/api/clinical/residents/"), "Browser profile code must not bypass the reviewed Pipeline identity join");
    const unifiedProfile = read("lib/pipeline/unified-profile.ts");
    assert(unifiedProfile.includes('import "server-only"'), "Unified profile assembly must remain server-only");
    assert(unifiedProfile.includes("getClinicalResident"), "Unified profiles must start from governed Alamo resident data");
    assert(unifiedProfile.includes('link.status === "confirmed"'), "Operational data must require a confirmed resident link");
    assert(unifiedProfile.includes("will not be matched by name"), "Unlinked profiles must reject implicit name matching");
    assert(!profileDirectory.includes("/api/clients"), "Referral-backed client profiles must not populate the admitted roster");
    assert(!profileView.includes("/api/clients"), "Resident detail must not use the referral store");
    assert(!existsSync(path.join(root, "app/api/clients/route.ts")), "The alternate client-profile API must remain removed");
    const envExample = read(".env.example");
    assert(!/NEXT_PUBLIC_.*(?:CLINICAL|ALAMO|ELDERMARK|CLIENT_SECRET|TOKEN|DATABRICKS|DOCUMENT_INTELLIGENCE)/i.test(envExample), "Clinical credentials must not be browser-prefixed");
  }),
  run("daily Pipeline backlog joining stays server-only and independent from packet intake", () => {
    const reconciliation = read("lib/pipeline/clinical-backlog-reconciliation.ts");
    const route = read("app/api/internal/clinical/reconcile/route.ts");
    const packetCanvas = read("components/pipeline/ReferralPacketCanvas.tsx");
    const azureRuntime = read("infra/azure/runtime.bicep");
    assert(reconciliation.includes('import "server-only"'), "Backlog reconciliation must remain server-only");
    assert(reconciliation.includes('getClinicalAuthMode() !== "client_credentials"'), "Automated joining must require client credentials");
    assert(reconciliation.includes("createResidentLink"), "Daily joining must use the resident-link boundary");
    assert(!reconciliation.includes("patchReferral"), "Current census data must not overwrite referral routing fields");
    assert(route.includes("requireInternalWorker"), "Daily joining must require worker authentication");
    assert(route.includes("withApiLogging"), "Daily joining must use PHI-safe route logging");
    assert(!packetCanvas.includes("census-reconciliation"), "Packet intake must not wait for census reconciliation");
    assert(
      azureRuntime.includes("'/api/internal/clinical/reconcile'"),
      "Expected a daily clinical backlog reconciliation schedule",
    );
  }),
  run("configured readiness exposes presence only and client credentials stay server-side", () => {
    const adapter = loadClinicalAdapter(async () => jsonResponse(fixture.health));
    const readiness = adapter.getClinicalDataReadiness();
    assert(readiness.required === true, "Production-like readiness must be required");
    assert(readiness.connected === true, "Complete server configuration should be connected");
    const serialized = JSON.stringify(readiness);
    assert(!serialized.includes("fixture-secret"), "Readiness must never expose secret values");
    assert(!serialized.includes("fixture-client"), "Readiness must never expose client IDs");
  }),
  run("clinical health and stale data remain governed and explicit", async () => {
    const stale = structuredClone(fixture.census);
    stale.freshness = {
      ...stale.freshness,
      status: "stale",
      warning: "Snapshot is older than the target freshness window.",
    };
    const adapter = loadClinicalAdapter(createClinicalFetch(() => jsonResponse(stale)));
    const census = await adapter.getClinicalCensus(new Request("http://pipeline.test/api/clinical/census"));
    assert(census.freshness.status === "stale", "Stale clinical data must remain labeled stale");
    assert(census.freshness.warning, "Stale clinical data must include a warning");

    const staleHealth = structuredClone(fixture.health);
    staleHealth.ready = false;
    staleHealth.status = "degraded";
    staleHealth.freshness = { ...staleHealth.freshness, status: "stale", warning: "Snapshot is stale." };
    const healthAdapter = loadClinicalAdapter(createClinicalFetch(() => jsonResponse(staleHealth)));
    const health = await healthAdapter.getClinicalHealth(new Request("http://pipeline.test/api/clinical/health"));
    assert(health.ready === false && health.status === "degraded", "Unready clinical health must remain explicit");
  }),
  run("client credentials authenticate dedicated requests without leaking token inputs", async () => {
    let observedAuthorization = "";
    let clinicalRequestCount = 0;
    const adapter = loadClinicalAdapter(
      createClinicalFetch((url, init) => {
        if (url.includes("/api/integrations/pipeline/clinical/health")) {
          clinicalRequestCount += 1;
          observedAuthorization = String(init?.headers?.Authorization ?? "");
          return jsonResponse(fixture.health);
        }
        return jsonResponse({ access_token: "fixture-access-token", expires_in: 3600 });
      }),
    );
    await adapter.getClinicalHealth(new Request("http://pipeline.test/api/clinical/health"));
    assert(observedAuthorization === "Bearer fixture-access-token", "Dedicated requests must use the Entra access token");
    assert(clinicalRequestCount === 1, "The health request must reach the dedicated clinical namespace once");
  }),
  run("upstream status mappings preserve safe recovery behavior", async () => {
    const cases = [
      { status: 401, expectedStatus: 502, expectedCode: "clinical_upstream_unauthorized" },
      { status: 403, expectedStatus: 502, expectedCode: "clinical_upstream_unauthorized" },
      { status: 404, expectedStatus: 404, expectedCode: "resident_not_found" },
      { status: 409, expectedStatus: 409, expectedCode: "resident_identifier_ambiguous" },
      { status: 502, expectedStatus: 502, expectedCode: "clinical_upstream_invalid" },
      { status: 503, expectedStatus: 503, expectedCode: "clinical_upstream_unavailable" },
    ];
    for (const testCase of cases) {
      const adapter = loadClinicalAdapter(
        createClinicalFetch(() =>
          jsonResponse(
            testCase.status === 409
              ? { code: "resident_identifier_ambiguous", details: { matching_resident_keys: ["337:R-100", "343:R-100"] } }
              : { error: "upstream fixture body must not cross the boundary", token: "fixture-token" },
            testCase.status,
          ),
        ),
      );
      await assertRejects(
        () => adapter.getClinicalResident(new Request("http://pipeline.test/api/clinical/residents/R-100"), "R-100"),
        (error) => {
          assert(error.status === testCase.expectedStatus, `${testCase.status} must map to ${testCase.expectedStatus}`);
          assert(error.code === testCase.expectedCode, `${testCase.status} must map to ${testCase.expectedCode}`);
          assert(!String(error.message).includes("fixture-token"), "Upstream bodies must not reach error messages");
        },
        `Expected upstream ${testCase.status} to fail safely`,
      );
    }

    for (const status of [401, 403]) {
      const adapter = loadClinicalAdapter(
        createClinicalFetch((url) => {
          if (url.includes("/oauth2/v2.0/token")) throw new Error("Delegated mode must not use client credentials");
          return jsonResponse({}, status);
        }),
        { PIPELINE_ALAMO_AUTH_MODE: "delegated" },
      );
      const request = new Request("http://pipeline.test/api/clinical/residents/R-100", {
        headers: { authorization: "Bearer delegated-fixture-token" },
      });
      await assertRejects(
        () => adapter.getClinicalResident(request, "R-100"),
        (error) => assert(error.status === status, `Delegated upstream ${status} must remain ${status}`),
        `Expected delegated upstream ${status} to fail safely`,
      );
    }
  }),
  run("roster pagination is bounded, encoded, and snapshot-safe", async () => {
    let observedUrl = "";
    const adapter = loadClinicalAdapter(
      createClinicalFetch((url) => {
        observedUrl = url;
        return jsonResponse({ ...fixture.roster, limit: 2, query: "Avery Example", community: "San Pablo" });
      }),
    );
    const roster = await adapter.getClinicalRoster(new Request("http://pipeline.test/api/clinical/roster"), {
      query: "Avery Example",
      community: "San Pablo",
      limit: 2,
      cursor: "snapshot-cursor",
    });
    const parsedUrl = new URL(observedUrl);
    assert(parsedUrl.pathname.endsWith("/api/integrations/pipeline/clinical/roster"), "Roster must use the dedicated endpoint");
    assert(parsedUrl.searchParams.get("q") === "Avery Example", "Roster query must be encoded and forwarded");
    assert(parsedUrl.searchParams.get("community") === "San Pablo", "Roster community must be encoded and forwarded");
    assert(parsedUrl.searchParams.get("limit") === "2", "Roster page size must be forwarded");
    assert(parsedUrl.searchParams.get("cursor") === "snapshot-cursor", "Roster cursor must be forwarded");
    assert(roster.limit === 2, "Roster response must preserve its declared page size");
    await assertRejects(
      () => adapter.getClinicalRoster(undefined, { limit: 201 }),
      (error) => assert(error.status === 400 && error.code === "clinical_limit_invalid", "Invalid page size must be rejected locally"),
      "Expected invalid roster page size rejection",
    );
  }),
  run("response-size limits apply to streamed clinical payloads", async () => {
    const adapter = loadClinicalAdapter(
      createClinicalFetch(() => jsonResponse({ oversized: "x".repeat(70_000) })),
      { PIPELINE_CLINICAL_MAX_RESPONSE_BYTES: "65536" },
    );
    await assertRejects(
      () => adapter.getClinicalCensus(new Request("http://pipeline.test/api/clinical/census")),
      (error) => assert(error.status === 502 && error.code === "clinical_payload_too_large", "Oversized responses must fail with a bounded payload error"),
      "Expected response-size rejection",
    );
  }),
  run("structured API logs omit arbitrary exception text and user request IDs", async () => {
    const logging = loadTypeScriptModule(root, "lib/observability/api-logging.ts", { crypto });
    const originalError = console.error;
    const lines = [];
    console.error = (line) => lines.push(String(line));
    try {
      const response = await logging.withApiLogging(
        new Request("http://pipeline.test/api/clinical/roster?q=Avery%20Example", {
          headers: { "x-request-id": "Avery Example diagnosis secret" },
        }),
        "/api/clinical/roster",
        () => {
          throw new Error("Avery Example diagnosis secret fixture-token");
        },
      );
      assert(response.status === 500, "Unexpected handler failures must remain 500");
      const serialized = lines.join("\n");
      for (const secret of ["Avery Example", "diagnosis", "fixture-token", "x-request-id"]) {
        assert(!serialized.includes(secret), `Logs must not contain ${secret}`);
      }
    } finally {
      console.error = originalError;
    }
  }),
]);

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checked_at: new Date().toISOString(), checks: results }, null, 2));
if (failed.length > 0) process.exit(1);

function read(file) {
  return readFileSync(path.join(root, file), "utf8");
}

async function run(name, fn) {
  try {
    await fn();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(fn, message) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

function loadClinicalAdapter(fetchImpl, environment = {}) {
  return loadTypeScriptModule(root, "lib/clinical/clinical-data.ts", {
    process: { env: { ...clinicalEnvironment, ...environment } },
    URL,
    URLSearchParams,
    AbortController,
    DOMException,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    crypto,
    fetch: fetchImpl,
  });
}

function createClinicalFetch(responseFactory) {
  return async (input, init) => {
    const url = String(input);
    if (url.includes("/oauth2/v2.0/token")) {
      return jsonResponse({ access_token: "fixture-access-token", expires_in: 3600 });
    }
    return responseFactory(url, init);
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function assertRejects(fn, check, message) {
  try {
    await fn();
  } catch (error) {
    check(error);
    return;
  }
  throw new Error(message);
}
