import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineDatabaseReadiness } from "@/lib/database/pipeline-database";
import { withApiLogging } from "@/lib/observability/api-logging";
import { canAccessApplicationActivity } from "@/lib/pipeline/application-activity-access";
import { getApplicationActivity } from "@/lib/pipeline/application-activity";
import { decodeKeysetCursor } from "@/lib/pipeline/keyset-cursor";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/application-activity", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    if (!canAccessApplicationActivity(auth.user)) return Response.json({ error: "This dashboard is private to Eric." }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const since = params.get("since") ?? "";
    const through = params.get("through") ?? new Date().toISOString();
    const actor = params.get("actor") || undefined;
    const cursor = params.get("cursor") || undefined;
    const decoded = decodeKeysetCursor(cursor);
    if (!Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(through))
      || Date.parse(since) > Date.parse(through) || Date.parse(through) - Date.parse(since) > 31 * 86400_000
      || Date.parse(through) > Date.now() + 60_000
      || (actor && actor.length > 200)
      || (cursor && (!decoded || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded.key)))) {
      return Response.json({ error: "Choose a valid activity period of up to 31 days." }, { status: 400 });
    }
    if (!getPipelineDatabaseReadiness().ready) {
      return Response.json({ error: "Application activity requires the shared Pipeline database. Local preview activity is not reported." }, { status: 503 });
    }
    return Response.json(await getApplicationActivity({ since, through, actor, cursor }));
  });
}
