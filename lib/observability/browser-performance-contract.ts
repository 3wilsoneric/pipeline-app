export const browserPerformanceUnits = {
  surface_ready: "milliseconds", lcp: "milliseconds", long_task: "milliseconds",
  cache_hit: "count", cache_join: "count", cache_miss: "count",
} as const;
export const browserPerformanceSurfaces = ["home", "referrals", "packet", "profiles", "profile", "calendar", "operations", "trash", "other"] as const;
export type BrowserPerformanceSurface = typeof browserPerformanceSurfaces[number];
export type BrowserPerformanceSample = {
  metric: keyof typeof browserPerformanceUnits;
  surface: BrowserPerformanceSurface;
  value: number;
  result: "ready" | "timeout";
};

export function pipelineSurfaceReady(surface: BrowserPerformanceSurface, busy: boolean, error: unknown) {
  return busy || error ? undefined : surface;
}

export function parseBrowserPerformanceSamples(value: unknown): BrowserPerformanceSample[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 20) return null;
  return value.every(isBrowserPerformanceSample) ? value : null;
}

function isBrowserPerformanceSample(item: unknown): item is BrowserPerformanceSample {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (Object.keys(item).sort().join(",") !== "metric,result,surface,value") return false;
  const sample = item as BrowserPerformanceSample;
  return isPerformanceMetricAndSurface(sample) && isPerformanceValue(sample)
    && ["ready", "timeout"].includes(sample.result);
}

function isPerformanceMetricAndSurface(sample: BrowserPerformanceSample) {
  return typeof sample.metric === "string" && typeof sample.surface === "string"
    && Object.hasOwn(browserPerformanceUnits, sample.metric) && browserPerformanceSurfaces.includes(sample.surface);
}

function isPerformanceValue(sample: BrowserPerformanceSample) {
  if (typeof sample.value !== "number" || !Number.isFinite(sample.value) || sample.value < 0 || sample.value > 60_000) return false;
  return !sample.metric.startsWith("cache_") || Number.isInteger(sample.value);
}
