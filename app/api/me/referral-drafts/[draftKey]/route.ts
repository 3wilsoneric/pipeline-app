import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  deleteVersionedUserWorkspaceState,
  getUserWorkspaceState,
  getUserWorkspaceStateReadiness,
  putUserWorkspaceState,
} from "@/lib/pipeline/user-workspace-state-store";
import {
  parsePipelineReferralDraft,
  type PipelineReferralDraft,
} from "@/lib/pipeline/user-workspace-state-types";

export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(
  request: Request,
  context: { params: Promise<{ draftKey: string }> },
) {
  return withApiLogging(request, "/api/me/referral-drafts/[draftKey]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const readinessFailure = requireWorkspaceState();
    if (readinessFailure) return readinessFailure;
    const key = await parseDraftKey(context);
    if (!key) return jsonError("draftKey is invalid.");

    const record = await getUserWorkspaceState<PipelineReferralDraft>(auth.user.id, "referral_draft", key);
    if (!record) return Response.json({ draft: null, version: 0 }, { headers: noStoreHeaders });
    const draft = parsePipelineReferralDraft(record.payload);
    if (!draft) return jsonError("The saved recovery draft is invalid.", 409);
    return Response.json({ draft, version: record.version }, { headers: noStoreHeaders });
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ draftKey: string }> },
) {
  return withApiLogging(request, "/api/me/referral-drafts/[draftKey]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readinessFailure = requireWorkspaceState();
    if (readinessFailure) return readinessFailure;
    const key = await parseDraftKey(context);
    if (!key) return jsonError("draftKey is invalid.");

    const body = await readJsonBody<{ if_match?: unknown; draft?: unknown }>(request, 256 * 1024);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!Number.isSafeInteger(body.value?.if_match) || Number(body.value?.if_match) < 0) {
      return jsonError("if_match must be a non-negative draft version.");
    }
    const draft = parsePipelineReferralDraft(body.value?.draft);
    if (!draft) return jsonError("draft is invalid.");

    const result = await putUserWorkspaceState({
      principalId: auth.user.id,
      kind: "referral_draft",
      key,
      payload: { ...draft, savedAt: new Date().toISOString() },
      expectedVersion: Number(body.value?.if_match),
      ttlDays: 30,
    });
    if (!result.ok) {
      return Response.json(
        {
          error: "This recovery draft changed in another signed-in session.",
          conflict: true,
          draft: result.current?.payload ?? null,
          version: result.current?.version ?? 0,
        },
        { status: 409, headers: noStoreHeaders },
      );
    }
    return Response.json(
      { draft: result.state.payload, version: result.state.version },
      { headers: noStoreHeaders },
    );
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ draftKey: string }> },
) {
  return withApiLogging(request, "/api/me/referral-drafts/[draftKey]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readinessFailure = requireWorkspaceState();
    if (readinessFailure) return readinessFailure;
    const key = await parseDraftKey(context);
    if (!key) return jsonError("draftKey is invalid.");

    const body = await readJsonBody<{ if_match?: unknown }>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!Number.isSafeInteger(body.value?.if_match) || Number(body.value?.if_match) < 0) {
      return jsonError("if_match must be a non-negative draft version.");
    }
    const result = await deleteVersionedUserWorkspaceState(
      auth.user.id,
      "referral_draft",
      key,
      Number(body.value?.if_match),
    );
    if (!result.ok) {
      return Response.json(
        {
          error: "A newer recovery draft exists in another signed-in session.",
          conflict: true,
          version: result.current.version,
        },
        { status: 409, headers: noStoreHeaders },
      );
    }
    return Response.json({ deleted: result.deleted }, { headers: noStoreHeaders });
  });
}

async function parseDraftKey(context: { params: Promise<{ draftKey: string }> }) {
  const { draftKey } = await context.params;
  return draftKey === "new"
    || /^new-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftKey)
    || /^[1-9]\d{0,15}$/.test(draftKey)
    ? draftKey
    : null;
}

function requireWorkspaceState() {
  const readiness = getUserWorkspaceStateReadiness();
  if (readiness.ready) return null;
  return Response.json(
    { error: readiness.enabled ? readiness.message : "Not found." },
    { status: readiness.enabled ? 503 : 404, headers: noStoreHeaders },
  );
}
