import { requirePipelineUser, type PipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { isContactLinkedToReferral, requireContactStore, updateContact } from "@/lib/pipeline/contact-store";
import { validateContactPatchBody } from "@/lib/pipeline/contact-validation";
import { requireMutableReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ contactId: string }> }) {
  return withApiLogging(request, "/api/contacts/[contactId]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireContactStore();
    if (!store.ok) return store.response;
    const prepared = await prepareContactUpdate(request, context.params, auth.user);
    if (!prepared.ok) return prepared.response;
    const { contactId, command } = prepared;
    const result = await updateContact(contactId, command.patch, command.expectedVersion, pipelineAuditActor(auth.user), command.mutationId);
    if (!result) return jsonError("Contact not found.", 404);
    if (!result.ok) return Response.json({ error: "This contact changed in another session.", ...result }, { status: 409 });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}

async function prepareContactUpdate(
  request: Request,
  params: Promise<{ contactId: string }>,
  user: PipelineUser,
) {
  const { contactId } = await params;
  if (!safeIdentifier(contactId)) return failed(jsonError("contactId is invalid."));
  const body = await readJsonBody(request);
  if (!body.ok) return failed(jsonError(body.message, body.status));
  const referralId = referralIdFrom(record(body.value)?.referral_id);
  if (!referralId) return failed(jsonError("referral_id is invalid."));
  const access = await requireMutableReferralAccess(user, referralId);
  if (!access.ok) return failed(access.response);
  if (!(await isContactLinkedToReferral(contactId, referralId))) {
    return failed(jsonError("Contact not found for this referral.", 404));
  }
  const command = validateContactPatchBody(body.value);
  return command.ok
    ? { ok: true as const, contactId, command: command.value }
    : failed(jsonError(command.message, command.status));
}

function failed(response: Response) {
  return { ok: false as const, response };
}

function safeIdentifier(value: string) {
  return value.length > 0 && value.length <= 160 && /^[a-zA-Z0-9_.:-]+$/u.test(value);
}

function referralIdFrom(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  if (!/^[1-9]\d{0,15}$/u.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
