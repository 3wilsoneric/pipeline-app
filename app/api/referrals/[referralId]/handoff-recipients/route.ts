import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireMutableReferralAccess, requireReferralAccess } from "@/lib/pipeline/referral-access";
import { parseRecipientFields, type RecipientFields } from "@/lib/pipeline/community-recipient-lists";
import { parseMeetClientMessage, type MeetClientMessage } from "@/lib/notifications/meet-client-message";
import { getUserWorkspaceState, getUserWorkspaceStateReadiness, putUserWorkspaceState } from "@/lib/pipeline/user-workspace-state-store";

export const runtime = "nodejs";
type Context = { params: Promise<{ referralId: string }> };
type RecipientDraft = RecipientFields & { community: string; message?: MeetClientMessage };
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

async function authorize(request: Request, context: Context, writing = false) {
  const auth = await requirePipelineUser(request);
  if (!auth.ok) return auth;
  const { referralId } = await context.params;
  if (!/^[1-9]\d*$/.test(referralId) || !Number.isSafeInteger(Number(referralId))) return { ok: false as const, response: jsonError("Invalid referral.") };
  const access = writing ? await requireMutableReferralAccess(auth.user, Number(referralId)) : await requireReferralAccess(auth.user, Number(referralId));
  if (!access.ok) return access;
  const store = getUserWorkspaceStateReadiness();
  if (!store.ready) return { ok: false as const, response: jsonError("Recipient draft storage is unavailable. Try again before leaving.", 503) };
  return { ok: true as const, user: auth.user, referral: access.referral, key: referralId };
}

export async function GET(request: Request, context: Context) {
  return withApiLogging(request, "/api/referrals/[referralId]/handoff-recipients", async () => {
    const access = await authorize(request, context);
    if (!access.ok) return access.response;
    const record = await getUserWorkspaceState<RecipientDraft>(access.user.id, "referral_email_draft", access.key);
    const draft = record?.payload ?? null;
    if (draft && (!parseRecipientFields(draft) || !parseMeetClientMessage(draft.message) || typeof draft.community !== "string")) return jsonError("The saved handoff draft could not be read.", 409);
    return Response.json({ draft, version: record?.version ?? 0 }, { headers });
  });
}

export async function PUT(request: Request, context: Context) {
  return withApiLogging(request, "/api/referrals/[referralId]/handoff-recipients", async () => {
    const origin = requireSameOriginMutation(request);
    if (origin) return origin;
    const access = await authorize(request, context, true);
    if (!access.ok) return access.response;
    const body = await readJsonBody<{ if_match?: unknown; draft?: RecipientDraft }>(request, 256_000);
    if (!body.ok) return jsonError(body.message, body.status);
    const fields = parseRecipientFields(body.value?.draft);
    const message = parseMeetClientMessage(body.value?.draft?.message);
    if (!message) return jsonError("Use a subject up to 200 characters and message up to 20,000 characters, without unsupported control characters.");
    if (!fields || !Number.isSafeInteger(body.value.if_match) || Number(body.value.if_match) < 0) return jsonError("Use valid, unique To/Cc addresses and a current draft version.");
    if (body.value.draft?.community !== access.referral.community) return jsonError("The community changed. Save the community and review its contacts before saving this list.", 409);
    const result = await putUserWorkspaceState({ principalId: access.user.id, kind: "referral_email_draft", key: access.key,
      payload: { ...fields, message, community: access.referral.community }, expectedVersion: Number(body.value.if_match), ttlDays: 30 });
    if (!result.ok) return jsonError("Recipients changed in another session. Your edits are still here. Reload the saved list before replacing it.", 409);
    return Response.json({ draft: result.state.payload, version: result.state.version }, { headers });
  });
}
