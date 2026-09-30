import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

const owner = { id: "f73371d5-d2b4-48b4-a32b-1edc7c88869f", email: "ericwilsonalamo@outlook.com", roles: ["admin"] };
const access = loadEntry("lib/pipeline/application-activity-access.ts");
const logging = loadEntry("lib/observability/api-logging.ts", {
  "@/lib/observability/pipeline-metrics": { recordPipelineMetric() {} },
  "@/lib/reliability/request-governor": { acquireRequestCapacity: () => ({ ok: true, release() {} }) },
}, { console: { log() {}, error() {} } });

test("usage endpoint checks Eric's identity before reading Azure metrics", async () => {
  for (const user of [null, { ...owner, id: "andrew", email: "andrew@aaahealthservices.com" }, { ...owner, delegation: {} }]) {
    let reads = 0;
    const route = loadEntry("app/api/operations/azure-usage/route.ts", {
      "@/lib/auth/pipeline-auth": { requirePipelineUser: () => user ? { ok: true, user } : { ok: false, response: Response.json({}, { status: 401 }) } },
      "@/lib/observability/api-logging": logging,
      "@/lib/observability/azure-usage": { getAzureUsageSnapshot: async () => { reads++; return {}; } },
      "@/lib/pipeline/application-activity-access": access,
    });
    const response = await route.GET(new Request("http://localhost/api/operations/azure-usage"));
    assert.equal(response.status, user ? 403 : 401);
    assert.equal(reads, 0);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
  }
});

test("usage endpoint returns only a safe snapshot and handles monitoring outages", async () => {
  const snapshot = { sampledAt: "2026-09-29T12:00:00Z", cpuPercent: 12.5, memoryPercent: 24, activeConnections: 8, cpuPeakHourPercent: 30 };
  const route = (getAzureUsageSnapshot) => loadEntry("app/api/operations/azure-usage/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: () => ({ ok: true, user: owner }) },
    "@/lib/observability/api-logging": logging,
    "@/lib/observability/azure-usage": { getAzureUsageSnapshot },
    "@/lib/pipeline/application-activity-access": access,
  });
  const request = new Request("http://localhost/api/operations/azure-usage");
  const success = await route(async () => snapshot).GET(request);
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), snapshot);
  const failed = await route(async () => { throw new Error("secret Azure detail"); }).GET(request);
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /secret Azure detail/);
});

test("usage parser chooses current samples and the highest one-minute CPU average", () => {
  const usage = loadEntry("lib/observability/azure-usage.ts", {
    "@azure/identity": { DefaultAzureCredential: class {} },
  });
  const now = Date.parse("2026-09-29T13:00:00Z");
  const metric = (name, values) => ({ name: { value: name }, timeseries: [{ data: values.map(([timeStamp, average]) => ({ timeStamp, average })) }] });
  const payload = { value: [
    metric("cpu_percent", [["2026-09-29T12:00:00Z", 34.4], ["2026-09-29T12:59:00Z", 5.2]]),
    metric("memory_percent", [["2026-09-29T12:59:00Z", 27.1]]),
    metric("active_connections", [["2026-09-29T12:59:00Z", 9]]),
  ] };
  assert.deepEqual(JSON.parse(JSON.stringify(usage.selectAzureUsageSnapshot(payload, now))), {
    sampledAt: "2026-09-29T12:59:00Z", cpuPercent: 5.2, memoryPercent: 27.1,
    activeConnections: 9, cpuPeakHourPercent: 34.4,
  });
  assert.throws(() => usage.selectAzureUsageSnapshot({ value: [metric("cpu_percent", [["2026-09-29T12:30:00Z", 4]])] }, now), /not current/);
});
