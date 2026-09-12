import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { browserPerformanceUnits, parseBrowserPerformanceSamples } from "@/lib/observability/browser-performance-contract";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";

export async function POST(request: Request) {
  return withApiLogging(request, "/api/me/performance", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const samples = parseBrowserPerformanceSamples(body.value);
    if (!samples) return jsonError("Performance samples are invalid.");
    for (const sample of samples) {
      recordPipelineMetric(`pipeline.browser.${sample.metric}`, sample.value, browserPerformanceUnits[sample.metric], { route: sample.surface, result: sample.result });
    }
    return new Response(null, { status: 204 });
  });
}
