import "server-only";

import { buildPipelineMetricEvent, type MetricUnit } from "@/lib/observability/metric-contract";

export function recordPipelineMetric(
  name: string,
  value: number,
  unit: MetricUnit,
  dimensions: Record<string, string> = {},
) {
  const event = buildPipelineMetricEvent(name, value, unit, dimensions);
  if (event) console.log(JSON.stringify(event));
}
