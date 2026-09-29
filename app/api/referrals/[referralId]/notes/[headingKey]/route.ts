import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { isNoteHeadingKey, noteBlockMaxLength, parseNoteBody } from "@/lib/pipeline/client-notes";
import { saveClientNote } from "@/lib/pipeline/client-notes-store";
import { requireMutableReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };
type Context = { params: Promise<{ referralId: string; headingKey: string }> };

// Saves one heading of the client's notes. Follows the referral's edit rule and records who last edited
// the heading; it never changes the referral itself. The heading's own version guards it; a stale version
// returns 409 with the current text instead of overwriting it.
export async function PUT(request: Request, context: Context) {
  return withApiLogging(request, "/api/referrals/[referralId]/notes/[headingKey]", async () => {
    const origin = requireSameOriginMutation(request);
    if (origin) return origin;
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const { referralId, headingKey } = await context.params;
    if (!/^[1-9]\d*$/.test(referralId) || !Number.isSafeInteger(Number(referralId))) return jsonError("Invalid referral.");
    if (!isNoteHeadingKey(headingKey)) return jsonError("Unknown notes heading.");
    const access = await requireMutableReferralAccess(auth.user, Number(referralId));
    if (!access.ok) return access.response;
    const body = await readJsonBody<{ body?: unknown; if_match?: unknown }>(request, 64_000);
    if (!body.ok) return jsonError(body.message, body.status);
    const text = parseNoteBody(body.value?.body);
    if (text === null) return jsonError(`Keep each heading's notes to ${noteBlockMaxLength.toLocaleString()} characters of plain text.`);
    const expected = body.value?.if_match;
    if (!Number.isInteger(expected) || (expected as number) < 0) return jsonError("if_match must be the heading's version, or 0 for a new one.");
    const result = await saveClientNote(Number(referralId), headingKey, text, expected as number, pipelineAuditActor(auth.user));
    if (result.ok) return Response.json({ block: result.block }, { headers });
    return Response.json({ error: "These notes changed on another screen.", block: result.block }, { status: 409, headers });
  });
}
