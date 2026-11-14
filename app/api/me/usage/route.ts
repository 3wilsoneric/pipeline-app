import { requirePipelineUser, getPipelineAuthMode } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { parseUsageBatch } from "@/lib/observability/assessor-usage-contract";
import { saveAssessorUsage } from "@/lib/observability/assessor-usage-store";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/me/usage", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    if (auth.user.delegation || auth.user.demoPersona || getPipelineAuthMode() !== "entra_jwt"
      || process.env.PIPELINE_DEMO_MODE === "true" || !getPipelineDatabaseReadiness().ready) return Response.json({ enabled: false });
    const sql = getPipelineSql();
    const rows = await sql`select migration_id from pipeline.schema_migrations where migration_id = '0049_assessor_usage'`;
    return Response.json(rows.length ? { enabled: true, accountId: auth.user.id } : { enabled: false });
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/me/usage", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    // Stop an already-open tab when another tab changes its operating identity.
    if (auth.user.delegation || auth.user.demoPersona) return new Response(null, { status: 409 });
    if (getPipelineAuthMode() !== "entra_jwt"
      || process.env.PIPELINE_DEMO_MODE === "true" || !getPipelineDatabaseReadiness().ready) return new Response(null, { status: 204 });
    // Pending samples from an earlier login must never credit a replacement user.
    if (request.headers.get("x-pipeline-usage-account") !== auth.user.id) return new Response(null, { status: 409 });
    const body = await readJsonBody(request, 2048);
    if (!body.ok) return jsonError(body.message, body.status);
    const batch = parseUsageBatch(body.value);
    if (!batch) return Response.json({ error: "Invalid usage samples." }, { status: 400 });
    await saveAssessorUsage(auth.user.id, batch);
    return new Response(null, { status: 204 });
  });
}
