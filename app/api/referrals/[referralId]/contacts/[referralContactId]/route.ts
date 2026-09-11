import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireContactStore, unlinkReferralContact, updateReferralContact } from "@/lib/pipeline/contact-store";
import { validateReferralContactDeleteBody, validateReferralContactPatchBody } from "@/lib/pipeline/contact-validation";
import { requireMutableReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

type Context = { params: Promise<{ referralId: string; referralContactId: string }> };

export async function PATCH(request: Request, context: Context) {
  return contactLinkMutation(request, context, "PATCH");
}

export async function DELETE(request: Request, context: Context) {
  return contactLinkMutation(request, context, "DELETE");
}

async function contactLinkMutation(request: Request, context: Context, method: "PATCH" | "DELETE") {
  return withApiLogging(request, "/api/referrals/[referralId]/contacts/[referralContactId]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireContactStore();
    if (!store.ok) return store.response;
    const params = await parseParams(context);
    if (!params) return jsonError("Contact link is invalid.");
    const access = await requireMutableReferralAccess(auth.user, params.referralId);
    if (!access.ok) return access.response;
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const actor = pipelineAuditActor(auth.user);
    if (method === "PATCH") {
      const command = validateReferralContactPatchBody(body.value);
      if (!command.ok) return jsonError(command.message, command.status);
      const result = await updateReferralContact(params.referralId, params.linkId, command.value.patch, command.value.expectedVersion, actor, command.value.mutationId);
      return linkResponse(result);
    }
    const command = validateReferralContactDeleteBody(body.value);
    if (!command.ok) return jsonError(command.message, command.status);
    const result = await unlinkReferralContact(params.referralId, params.linkId, command.value.expectedVersion, actor, command.value.mutationId);
    return linkResponse(result);
  });
}

function linkResponse(result: Awaited<ReturnType<typeof updateReferralContact>> | Awaited<ReturnType<typeof unlinkReferralContact>>) {
  if (!result) return jsonError("Contact link not found.", 404);
  if (!result.ok) return Response.json({ error: "This contact link changed in another session.", ...result }, { status: 409 });
  return Response.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

async function parseParams(context: Context) {
  const { referralId, referralContactId } = await context.params;
  if (!/^[1-9]\d{0,15}$/u.test(referralId) || !/^[a-zA-Z0-9_.:-]{1,160}$/u.test(referralContactId)) return null;
  const parsed = Number(referralId);
  return Number.isSafeInteger(parsed) ? { referralId: parsed, linkId: referralContactId } : null;
}
