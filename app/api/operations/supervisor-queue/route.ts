import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getSupervisorExceptionSnapshot } from "@/lib/pipeline/operations-snapshot";
import { supervisorQueuePage } from "@/lib/pipeline/supervisor-queue-page";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/supervisor-queue", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer", "viewer"]);
    if (!auth.ok) return auth.response;
    const rawOffset = new URL(request.url).searchParams.get("offset") ?? "0";
    const offset = Number(rawOffset);
    if (!/^(0|[1-9]\d*)$/.test(rawOffset) || !Number.isSafeInteger(offset)) {
      return Response.json({ error: "Invalid queue offset." }, { status: 400 });
    }
    const snapshot = await getSupervisorExceptionSnapshot();
    return Response.json(supervisorQueuePage(snapshot, offset), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
