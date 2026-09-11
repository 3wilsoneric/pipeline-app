import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { attachReferralContact, listReferralContacts, requireContactStore } from "@/lib/pipeline/contact-store";
import { validateReferralContactCreateBody } from "@/lib/pipeline/contact-validation";
import { requireMutableReferralAccess, requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ referralId: string }> }) {
  return withApiLogging(request, "/api/referrals/[referralId]/contacts", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireContactStore();
    if (!store.ok) return store.response;
    const referralId = await parseReferralId(context);
    if (!referralId) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const contacts = await listReferralContacts(referralId);
    return Response.json({ contacts }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}

export async function POST(request: Request, context: { params: Promise<{ referralId: string }> }) {
  return withApiLogging(request, "/api/referrals/[referralId]/contacts", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireContactStore();
    if (!store.ok) return store.response;
    const referralId = await parseReferralId(context);
    if (!referralId) return jsonError("referralId is invalid.");
    const access = await requireMutableReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const command = validateReferralContactCreateBody(body.value);
    if (!command.ok) return jsonError(command.message, command.status);
    const result = await attachReferralContact(referralId, command.value.link, pipelineAuditActor(auth.user), command.value.mutationId);
    if (!result) return jsonError("Contact not found or inactive.", 404);
    return Response.json(result, { status: result.idempotentReplay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}

async function parseReferralId(context: { params: Promise<{ referralId: string }> }) {
  const { referralId } = await context.params;
  if (!/^[1-9]\d{0,15}$/u.test(referralId)) return null;
  const id = Number(referralId);
  return Number.isSafeInteger(id) ? id : null;
}
