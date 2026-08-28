import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { validateOperatorProgressUpdate } from "@/lib/training/operator-training-progress-contract";
import { getOperatorProgressRecord, putOperatorProgressRecord } from "@/lib/training/operator-training-progress-store";
import { primaryOperatorRole } from "@/lib/training/operator-training-curriculum";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/training/progress", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    try {
      const record = await getOperatorProgressRecord(auth.user.id, auth.user.roles, primaryOperatorRole(auth.user.roles));
      return Response.json(record, { headers: noStoreHeaders() });
    } catch {
      return Response.json({ error: "Learning progress is temporarily unavailable." }, { status: 503, headers: noStoreHeaders() });
    }
  });
}

export async function PUT(request: Request) {
  return withApiLogging(request, "/api/training/progress", async () => {
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const parsed = await readJsonBody(request, 280_000);
    if (!parsed.ok) return Response.json({ error: parsed.message }, { status: parsed.status ?? 400, headers: noStoreHeaders() });
    const validation = validateOperatorProgressUpdate(parsed.value, auth.user.roles);
    if (!validation.ok) return Response.json({ error: validation.error }, { status: 400, headers: noStoreHeaders() });
    try {
      const result = await putOperatorProgressRecord({ principalId: auth.user.id, assignedRoles: auth.user.roles, expectedRevision: validation.value.expectedRevision, progress: validation.value.progress });
      if (result.ok) return Response.json(result.record, { headers: noStoreHeaders() });
      if (result.unavailable) return Response.json({ error: result.message, persistence: "browser" }, { status: 503, headers: noStoreHeaders() });
      return Response.json({ error: "Learning progress changed in another session.", current: result.current }, { status: 409, headers: noStoreHeaders() });
    } catch {
      return Response.json({ error: "Learning progress could not be saved." }, { status: 503, headers: noStoreHeaders() });
    }
  });
}

function noStoreHeaders() {
  return { "Cache-Control": "no-store, max-age=0" };
}
