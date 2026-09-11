import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { createContact, requireContactStore, searchContacts } from "@/lib/pipeline/contact-store";
import { parseContactSearch, validateContactCreateBody } from "@/lib/pipeline/contact-validation";
import { requireMutableReferralAccess, requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/contacts", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const store = requireContactStore();
    if (!store.ok) return store.response;
    const url = new URL(request.url);
    const referralId = referralIdFrom(url.searchParams.get("referral_id"));
    if (!referralId) return jsonError("referral_id is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const query = parseContactSearch(url);
    if (!query.ok) return jsonError(query.message, query.status);
    const contacts = await searchContacts(query.value.query, query.value.limit);
    return Response.json({ contacts }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/contacts", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireContactStore();
    if (!store.ok) return store.response;
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const referralId = referralIdFrom(record(body.value)?.referral_id);
    if (!referralId) return jsonError("referral_id is invalid.");
    const access = await requireMutableReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const command = validateContactCreateBody(body.value);
    if (!command.ok) return jsonError(command.message, command.status);
    const result = await createContact(command.value.contact, pipelineAuditActor(auth.user), command.value.mutationId);
    return Response.json(result, { status: result.idempotentReplay ? 200 : 201, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
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
