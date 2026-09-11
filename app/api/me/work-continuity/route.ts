import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  parsePipelineWorkContinuityPatch,
} from "@/lib/pipeline/work-continuity";
import {
  getPipelineWorkContinuityState,
  patchPipelineWorkContinuityState,
} from "@/lib/pipeline/work-continuity-store";
import { getUserWorkspaceStateReadiness } from "@/lib/pipeline/user-workspace-state-store";

export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  return withApiLogging(request, "/api/me/work-continuity", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const readinessFailure = requireWorkspaceState();
    if (readinessFailure) return readinessFailure;
    const current = await getPipelineWorkContinuityState(auth.user.id);
    return Response.json(current, { headers: noStoreHeaders });
  });
}

export async function PATCH(request: Request) {
  return withApiLogging(request, "/api/me/work-continuity", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readinessFailure = requireWorkspaceState();
    if (readinessFailure) return readinessFailure;
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const patch = parsePipelineWorkContinuityPatch(body.value);
    if (!patch) return jsonError("continuity update is invalid.");
    const state = await patchPipelineWorkContinuityState(auth.user.id, patch);
    if (!state) return jsonError("Work continuity changed in another session. Try again.", 409);
    return Response.json({ state }, { headers: noStoreHeaders });
  });
}

function requireWorkspaceState() {
  const readiness = getUserWorkspaceStateReadiness();
  if (readiness.ready) return null;
  return Response.json(
    { error: readiness.enabled ? readiness.message : "Not found." },
    { status: readiness.enabled ? 503 : 404, headers: noStoreHeaders },
  );
}
