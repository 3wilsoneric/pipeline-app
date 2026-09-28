import { requirePlatformIntegration } from "@/lib/auth/internal-worker-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getPlatformAdmissionsSummary } from "@/lib/pipeline/operations-snapshot";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/integrations/platform/admissions-summary", async () => {
    const denied = requirePlatformIntegration(request);
    if (denied) return denied;
    const summary = await getPlatformAdmissionsSummary();
    if (!summary) return Response.json({ error: "Referral storage is unavailable." }, { status: 503 });
    return Response.json(summary, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}
