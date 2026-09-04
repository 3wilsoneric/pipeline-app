import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  defaultPipelineHomeDashboardLayout,
  parsePipelineHomeDashboardLayout,
  type PipelineHomeDashboardLayout,
} from "@/lib/pipeline/home-dashboard-layout";
import {
  getUserWorkspaceState,
  getUserWorkspaceStateReadiness,
  putUserWorkspaceState,
} from "@/lib/pipeline/user-workspace-state-store";

export const runtime = "nodejs";

const stateKey = "default";
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  return withApiLogging(request, "/api/me/home-layout", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const readinessFailure = requireWorkspaceState();
    if (readinessFailure) return readinessFailure;

    const record = await getUserWorkspaceState<PipelineHomeDashboardLayout>(auth.user.id, "home_dashboard_layout", stateKey);
    const layout = parsePipelineHomeDashboardLayout(record?.payload) ?? defaultPipelineHomeDashboardLayout();
    return Response.json({ layout }, { headers: noStoreHeaders });
  });
}

export async function PUT(request: Request) {
  return withApiLogging(request, "/api/me/home-layout", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readinessFailure = requireWorkspaceState();
    if (readinessFailure) return readinessFailure;

    const body = await readJsonBody<{ layout?: unknown }>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const layout = parsePipelineHomeDashboardLayout(body.value?.layout);
    if (!layout) return jsonError("layout is invalid.");

    const existing = await getUserWorkspaceState(auth.user.id, "home_dashboard_layout", stateKey);
    let result = await putUserWorkspaceState({
      principalId: auth.user.id,
      kind: "home_dashboard_layout",
      key: stateKey,
      payload: layout,
      expectedVersion: existing?.version ?? 0,
      ttlDays: 3_650,
    });
    if (!result.ok && result.current) {
      result = await putUserWorkspaceState({
        principalId: auth.user.id,
        kind: "home_dashboard_layout",
        key: stateKey,
        payload: layout,
        expectedVersion: result.current.version,
        ttlDays: 3_650,
      });
    }
    if (!result.ok) return jsonError("The Home layout changed in another session. Try again.", 409);
    return Response.json({ layout: result.state.payload }, { headers: noStoreHeaders });
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
