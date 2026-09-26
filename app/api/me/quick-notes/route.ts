import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { isQuickNotePayload, type QuickNotePayload, type ReferralQuickNote } from "@/lib/pipeline/referral-quick-notes";
import { getUserWorkspaceStateReadiness, listUserWorkspaceState } from "@/lib/pipeline/user-workspace-state-store";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };

// The signed-in person's own quick notes, for the board and workspace list. Only their own text is returned.
export async function GET(request: Request) {
  return withApiLogging(request, "/api/me/quick-notes", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    if (!getUserWorkspaceStateReadiness().ready) return jsonError("Quick notes are unavailable right now.", 503);
    const records = await listUserWorkspaceState<QuickNotePayload>(auth.user.id, "referral_quick_note", 2_000);
    const notes: ReferralQuickNote[] = records
      .filter((record) => /^[1-9]\d*$/.test(record.state_key) && isQuickNotePayload(record.payload) && record.payload.text)
      .map((record) => ({ referralId: Number(record.state_key), text: record.payload.text, updatedAt: record.updated_at, version: record.version }));
    return Response.json({ notes }, { headers });
  });
}
