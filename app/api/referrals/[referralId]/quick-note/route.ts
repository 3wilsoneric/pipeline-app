import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import { parseQuickNoteEntries, quickNoteEntriesFrom, quickNoteMaxEntries, quickNoteMaxLength, quickNoteTtlDays, stampQuickNoteEntries, type QuickNotePayload } from "@/lib/pipeline/referral-quick-notes";
import { deleteUserWorkspaceState, getUserWorkspaceState, getUserWorkspaceStateReadiness, putUserWorkspaceState } from "@/lib/pipeline/user-workspace-state-store";

export const runtime = "nodejs";
type Context = { params: Promise<{ referralId: string }> };
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

// A person's own quick note for one referral: the full list of their entries, replaced on each save.
// It is private workspace state, not part of the referral record: it needs read access to the referral,
// never changes it, and is not audited as a referral edit. Entry dates come from the server.
export async function PUT(request: Request, context: Context) {
  return withApiLogging(request, "/api/referrals/[referralId]/quick-note", async () => {
    const origin = requireSameOriginMutation(request);
    if (origin) return origin;
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const { referralId } = await context.params;
    if (!/^[1-9]\d*$/.test(referralId) || !Number.isSafeInteger(Number(referralId))) return jsonError("Invalid referral.");
    const access = await requireReferralAccess(auth.user, Number(referralId));
    if (!access.ok) return access.response;
    if (!getUserWorkspaceStateReadiness().ready) return jsonError("Quick notes are unavailable right now.", 503);
    const body = await readJsonBody<{ entries?: unknown }>(request, 64_000);
    if (!body.ok) return jsonError(body.message, body.status);
    const input = parseQuickNoteEntries(body.value?.entries);
    if (input === null) return jsonError(`Keep quick notes to ${quickNoteMaxEntries} entries of plain text, up to ${quickNoteMaxLength} characters each.`);
    if (!input.length) {
      await deleteUserWorkspaceState(auth.user.id, "referral_quick_note", referralId);
      return Response.json({ note: null }, { headers });
    }
    // Last write wins: the note is one person's own scratch text, so there is no other editor to conflict with.
    const current = await getUserWorkspaceState<QuickNotePayload>(auth.user.id, "referral_quick_note", referralId);
    const stored = current ? quickNoteEntriesFrom(current.payload, current.updated_at) ?? [] : [];
    const entries = stampQuickNoteEntries(input, stored, new Date().toISOString());
    const result = await putUserWorkspaceState<QuickNotePayload>({ principalId: auth.user.id, kind: "referral_quick_note", key: referralId,
      payload: { entries }, expectedVersion: current?.version ?? 0, ttlDays: quickNoteTtlDays });
    if (!result.ok) return jsonError("Could not save. Your edits are still here; try again.", 409);
    return Response.json({ note: { referralId: Number(referralId), entries, updatedAt: result.state.updated_at, version: result.state.version } }, { headers });
  });
}
