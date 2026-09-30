import "server-only";

import { DefaultAzureCredential } from "@azure/identity";

export type AzureUsageSnapshot = {
  sampledAt: string;
  cpuPercent: number;
  memoryPercent: number;
  activeConnections: number;
  cpuPeakHourPercent: number;
};

type MetricPoint = { timeStamp?: string; average?: number };
type Metric = { name?: { value?: string }; timeseries?: { data?: MetricPoint[] }[] };

const credential = new DefaultAzureCredential({
  managedIdentityClientId: process.env.AZURE_CLIENT_ID?.trim() || undefined,
});
let cached: { expiresAt: number; value: AzureUsageSnapshot } | undefined;
let pending: Promise<AzureUsageSnapshot> | undefined;

export async function getAzureUsageSnapshot(): Promise<AzureUsageSnapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (!pending) {
    pending = readAzureUsageSnapshot().then((value) => {
      cached = { value, expiresAt: Date.now() + 60_000 };
      return value;
    }).finally(() => { pending = undefined; });
  }
  return pending;
}

async function readAzureUsageSnapshot(): Promise<AzureUsageSnapshot> {
  const resourceId = process.env.PIPELINE_MONITOR_POSTGRES_RESOURCE_ID?.trim();
  if (!resourceId || !/^\/subscriptions\/[a-f0-9-]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.DBforPostgreSQL\/flexibleServers\/[^/]+$/i.test(resourceId)) {
    throw new Error("Azure usage meter is not configured");
  }
  const end = new Date();
  const start = new Date(end.getTime() - 65 * 60_000);
  const token = await credential.getToken("https://management.azure.com/.default");
  if (!token?.token) throw new Error("Azure usage token is unavailable");
  const url = new URL(`https://management.azure.com${resourceId}/providers/Microsoft.Insights/metrics`);
  url.searchParams.set("api-version", "2023-10-01");
  url.searchParams.set("timespan", `${start.toISOString()}/${end.toISOString()}`);
  url.searchParams.set("interval", "PT1M");
  url.searchParams.set("metricnames", "cpu_percent,memory_percent,active_connections");
  url.searchParams.set("aggregation", "Average");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Azure usage metrics returned ${response.status}`);
  const payload = await response.json() as { value?: Metric[] };
  return selectAzureUsageSnapshot(payload, end.getTime());
}

export function selectAzureUsageSnapshot(payload: { value?: Metric[] }, now = Date.now()): AzureUsageSnapshot {
  const points = (name: string) => payload.value?.find((metric) => metric.name?.value === name)?.timeseries?.flatMap((series) => series.data ?? [])
    .filter((point): point is Required<MetricPoint> => typeof point.average === "number" && Number.isFinite(point.average)
      && typeof point.timeStamp === "string" && Number.isFinite(Date.parse(point.timeStamp))
      && Date.parse(point.timeStamp) <= now && Date.parse(point.timeStamp) >= now - 65 * 60_000)
    .sort((a, b) => Date.parse(a.timeStamp) - Date.parse(b.timeStamp)) ?? [];
  const cpu = points("cpu_percent");
  const memory = points("memory_percent");
  const connections = points("active_connections");
  const lastCpu = cpu.at(-1);
  const lastMemory = memory.at(-1);
  const lastConnections = connections.at(-1);
  if (!lastCpu || !lastMemory || !lastConnections
    || [lastCpu, lastMemory, lastConnections].some((point) => now - Date.parse(point.timeStamp) > 15 * 60_000)) {
    throw new Error("Azure usage metrics are not current");
  }
  return {
    sampledAt: lastCpu.timeStamp,
    cpuPercent: lastCpu.average,
    memoryPercent: lastMemory.average,
    activeConnections: lastConnections.average,
    cpuPeakHourPercent: Math.max(...cpu.filter((point) => Date.parse(point.timeStamp) >= now - 60 * 60_000).map((point) => point.average)),
  };
}
