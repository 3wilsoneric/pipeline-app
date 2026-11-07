import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { meetClientLayout, meetClientLayoutKey, parseMeetClientLayout } from "@/lib/notifications/meet-client-message";
import { getUserWorkspaceState, getUserWorkspaceStateReadiness, putUserWorkspaceState } from "@/lib/pipeline/user-workspace-state-store";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

export async function GET(request: Request) {
  return withApiLogging(request, "/api/me/meet-client-layout", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    if (!getUserWorkspaceStateReadiness().ready) return jsonError("Your email layout could not be loaded. Try again.", 503);
    const record = await getUserWorkspaceState(auth.user.id, "referral_email_draft", meetClientLayoutKey);
    const layout = record ? parseMeetClientLayout(record.payload) : meetClientLayout();
    if (!layout) return jsonError("Your saved email layout could not be read.", 409);
    return Response.json({ layout, version: record?.version ?? 0 }, { headers });
  });
}

export async function PUT(request: Request) {
  return withApiLogging(request, "/api/me/meet-client-layout", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const origin = requireSameOriginMutation(request);
    if (origin) return origin;
    if (!getUserWorkspaceStateReadiness().ready) return jsonError("Your email layout could not be saved. Try again.", 503);
    const body = await readJsonBody<{ layout?: unknown; if_match?: unknown }>(request, 4096);
    if (!body.ok) return jsonError(body.message, body.status);
    const layout = parseMeetClientLayout(body.value?.layout);
    if (!layout || !Number.isSafeInteger(body.value.if_match) || Number(body.value.if_match) < 0) return jsonError("Use a valid email layout and current version.");
    const result = await putUserWorkspaceState({ principalId: auth.user.id, kind: "referral_email_draft", key: meetClientLayoutKey,
      payload: layout, expectedVersion: Number(body.value.if_match), ttlDays: 3_650 });
    if (!result.ok) return jsonError("Your default email layout changed in another session. Reload it before replacing it.", 409);
    return Response.json({ layout: result.state.payload, version: result.state.version }, { headers });
  });
}
