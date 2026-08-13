import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  deleteUserWorkspaceState,
  getUserWorkspaceState,
  getUserWorkspaceStateReadiness,
  listUserWorkspaceState,
  putUserWorkspaceState,
  trimUserWorkspaceState,
} from "@/lib/pipeline/user-workspace-state-store";
import {
  isPipelineRecentDestination,
  type PipelineRecentDestination,
} from "@/lib/pipeline/user-workspace-state-types";

export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  return withApiLogging(request, "/api/me/recents", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const readinessFailure = requireDesktopState();
    if (readinessFailure) return readinessFailure;

    const records = await listUserWorkspaceState<PipelineRecentDestination>(auth.user.id, "recent_destination", 5);
    return Response.json({ recents: records.map((record) => record.payload).filter(isPipelineRecentDestination) }, { headers: noStoreHeaders });
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/me/recents", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readinessFailure = requireDesktopState();
    if (readinessFailure) return readinessFailure;

    const body = await readJsonBody<{ destination?: unknown }>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!isPipelineRecentDestination(body.value?.destination)) return jsonError("destination is invalid.");

    const destination = { ...body.value.destination, visitedAt: new Date().toISOString() } as PipelineRecentDestination;
    const existing = await getUserWorkspaceState(auth.user.id, "recent_destination", destination.id);
    let result = await putUserWorkspaceState({
      principalId: auth.user.id,
      kind: "recent_destination",
      key: destination.id,
      payload: destination,
      expectedVersion: existing?.version ?? 0,
      ttlDays: 180,
    });
    if (!result.ok && result.current) {
      result = await putUserWorkspaceState({
        principalId: auth.user.id,
        kind: "recent_destination",
        key: destination.id,
        payload: destination,
        expectedVersion: result.current.version,
        ttlDays: 180,
      });
    }
    if (!result.ok) return jsonError("Recent navigation changed in another session. Try again.", 409);
    await trimUserWorkspaceState(auth.user.id, "recent_destination", 5);

    return Response.json({ destination: result.state.payload }, { headers: noStoreHeaders });
  });
}

export async function DELETE(request: Request) {
  return withApiLogging(request, "/api/me/recents", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readinessFailure = requireDesktopState();
    if (readinessFailure) return readinessFailure;

    const body = await readJsonBody<{ id?: unknown }>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (typeof body.value?.id !== "string" || !body.value.id.trim() || body.value.id.length > 160) {
      return jsonError("id is invalid.");
    }
    const deleted = await deleteUserWorkspaceState(auth.user.id, "recent_destination", body.value.id);
    return Response.json({ deleted: deleted > 0 }, { headers: noStoreHeaders });
  });
}

function requireDesktopState() {
  const readiness = getUserWorkspaceStateReadiness();
  if (readiness.ready) return null;
  return Response.json(
    { error: readiness.enabled ? readiness.message : "Not found." },
    { status: readiness.enabled ? 503 : 404, headers: noStoreHeaders },
  );
}
