import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getHomeBriefing } from "@/lib/pipeline/home-briefing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/home", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;

    const briefing = await getHomeBriefing(auth.user);
    return Response.json(briefing, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
