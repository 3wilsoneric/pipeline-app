import { requirePipelineUser, type PipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { getAssessment, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import {
  deleteVersionedUserWorkspaceState,
  getUserWorkspaceState,
  getUserWorkspaceStateReadiness,
  putUserWorkspaceState,
} from "@/lib/pipeline/user-workspace-state-store";
import {
  parsePipelineAssessmentDraft,
  type PipelineAssessmentDraft,
} from "@/lib/pipeline/user-workspace-state-types";

export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request, context: { params: Promise<{ assessmentId: string }> }) {
  return withApiLogging(request, "/api/me/assessment-drafts/[assessmentId]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const access = await authorize(auth.user, context);
    if (!access.ok) return access.response;
    const record = await getUserWorkspaceState<PipelineAssessmentDraft>(access.userId, "assessment_draft", access.assessmentId);
    if (!record) return Response.json({ draft: null, version: 0 }, { headers: noStoreHeaders });
    const draft = parsePipelineAssessmentDraft(record.payload);
    if (!draft) return jsonError("The saved assessment recovery draft is invalid.", 409);
    return Response.json({ draft, version: record.version }, { headers: noStoreHeaders });
  });
}

export async function PUT(request: Request, context: { params: Promise<{ assessmentId: string }> }) {
  return withApiLogging(request, "/api/me/assessment-drafts/[assessmentId]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const access = await authorize(auth.user, context);
    if (!access.ok) return access.response;
    const body = await readJsonBody<{ if_match?: unknown; draft?: unknown }>(request, 256 * 1024);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!Number.isSafeInteger(body.value?.if_match) || Number(body.value?.if_match) < 0) {
      return jsonError("if_match must be a non-negative draft version.");
    }
    const draft = parsePipelineAssessmentDraft(body.value?.draft);
    if (!draft || draft.assessmentId !== access.assessmentId) return jsonError("draft is invalid.");
    const result = await putUserWorkspaceState({
      principalId: access.userId,
      kind: "assessment_draft",
      key: access.assessmentId,
      payload: { ...draft, savedAt: new Date().toISOString() },
      expectedVersion: Number(body.value?.if_match),
      ttlDays: 30,
    });
    if (!result.ok) {
      return Response.json({
        error: "This assessment recovery draft changed in another signed-in session.",
        conflict: true,
        draft: result.current?.payload ?? null,
        version: result.current?.version ?? 0,
      }, { status: 409, headers: noStoreHeaders });
    }
    return Response.json({ draft: result.state.payload, version: result.state.version }, { headers: noStoreHeaders });
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ assessmentId: string }> }) {
  return withApiLogging(request, "/api/me/assessment-drafts/[assessmentId]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const access = await authorize(auth.user, context);
    if (!access.ok) return access.response;
    const body = await readJsonBody<{ if_match?: unknown }>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!Number.isSafeInteger(body.value?.if_match) || Number(body.value?.if_match) < 0) {
      return jsonError("if_match must be a non-negative draft version.");
    }
    const result = await deleteVersionedUserWorkspaceState(
      access.userId,
      "assessment_draft",
      access.assessmentId,
      Number(body.value?.if_match),
    );
    if (!result.ok) {
      return Response.json({
        error: "A newer assessment recovery draft exists in another signed-in session.",
        conflict: true,
        version: result.current.version,
      }, { status: 409, headers: noStoreHeaders });
    }
    return Response.json({ deleted: result.deleted }, { headers: noStoreHeaders });
  });
}

async function authorize(user: PipelineUser, context: { params: Promise<{ assessmentId: string }> }) {
  const workspace = getUserWorkspaceStateReadiness();
  if (!workspace.ready) {
    return {
      ok: false as const,
      response: Response.json(
        { error: workspace.enabled ? workspace.message : "Not found." },
        { status: workspace.enabled ? 503 : 404, headers: noStoreHeaders },
      ),
    };
  }
  const store = requireAssessmentStore();
  if (!store.ok) return { ok: false as const, response: store.response };
  const { assessmentId } = await context.params;
  if (!assessmentId || assessmentId.length > 160 || !/^[a-zA-Z0-9_.:-]+$/.test(assessmentId)) {
    return { ok: false as const, response: jsonError("assessmentId is invalid.") };
  }
  const assessment = await getAssessment(assessmentId);
  if (!assessment) return { ok: false as const, response: jsonError("Assessment not found.", 404) };
  const referral = await requireReferralAccess(user, assessment.referral_id);
  if (!referral.ok) return referral;
  return { ok: true as const, userId: user.id, assessmentId };
}
