export type MetricUnit = "count" | "milliseconds" | "bytes";

const allowedDimensions = new Set([
  "route",
  "method",
  "status_class",
  "operation",
  "result",
  "job_type",
  "backend",
  "assignment",
  "packet",
]);

export type PipelineMetricEvent = {
  level: "info";
  service: "pipeline-app";
  kind: "metric";
  metric: string;
  value: number;
  unit: MetricUnit;
  dimensions: Record<string, string>;
  checked_at: string;
};

export function buildPipelineMetricEvent(
  name: string,
  value: number,
  unit: MetricUnit,
  dimensions: Record<string, string> = {},
  checkedAt = new Date(),
): PipelineMetricEvent | null {
  if (!/^[a-z][a-z0-9_.]{2,80}$/.test(name) || !Number.isFinite(value)) return null;
  const safeDimensions = Object.fromEntries(
    Object.entries(dimensions)
      .filter(([key, item]) => allowedDimensions.has(key) && /^[a-zA-Z0-9_./\[\]-]{1,100}$/.test(item))
      .slice(0, 8),
  );
  return {
    level: "info",
    service: "pipeline-app",
    kind: "metric",
    metric: name,
    value,
    unit,
    dimensions: safeDimensions,
    checked_at: checkedAt.toISOString(),
  };
}
