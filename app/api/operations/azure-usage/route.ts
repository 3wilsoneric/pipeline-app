import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getAzureUsageSnapshot } from "@/lib/observability/azure-usage";
import { canAccessApplicationActivity } from "@/lib/pipeline/application-activity-access";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/azure-usage", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    if (!canAccessApplicationActivity(auth.user)) return Response.json({ error: "This usage meter is private to Eric." }, { status: 403 });
    try {
      return Response.json(await getAzureUsageSnapshot());
    } catch {
      return Response.json({ error: "Azure usage is temporarily unavailable." }, { status: 503 });
    }
  });
}
