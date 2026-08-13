import "server-only";

type MetricUnit = "count" | "milliseconds" | "bytes";

const allowedDimensions = new Set([
  "route",
  "method",
  "status_class",
  "operation",
  "result",
  "job_type",
  "backend",
]);

export function recordPipelineMetric(
  name: string,
  value: number,
  unit: MetricUnit,
  dimensions: Record<string, string> = {},
) {
  if (!/^[a-z][a-z0-9_.]{2,80}$/.test(name) || !Number.isFinite(value)) return;
  const safeDimensions = Object.fromEntries(
    Object.entries(dimensions)
      .filter(([key, item]) => allowedDimensions.has(key) && /^[a-zA-Z0-9_./\[\]-]{1,100}$/.test(item))
      .slice(0, 8),
  );
  console.log(JSON.stringify({
    level: "info",
    service: "pipeline-app",
    kind: "metric",
    metric: name,
    value,
    unit,
    dimensions: safeDimensions,
    checked_at: new Date().toISOString(),
  }));
}
