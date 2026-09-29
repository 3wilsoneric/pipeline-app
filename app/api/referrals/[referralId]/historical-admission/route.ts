import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { getClinicalRoster } from "@/lib/clinical/clinical-data";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { canRecordAdmissionDecision, requireReferralAccess } from "@/lib/pipeline/referral-access";
import { HistoricalWorkspaceReadOnlyError, recordHistoricalAdmission, requireReferralStore } from "@/lib/pipeline/referral-store";
import { validateClientMutationId } from "@/lib/pipeline/client-mutation-id";
import { canRecordHistoricalAdmission, historicalAdmissionInput, historicalAdmissionSuggestion } from "@/lib/pipeline/historical-admission";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
type Context = { params: Promise<{ referralId: string }> };

async function access(request: Request, context: Context) {
  const auth = await requirePipelineUser(request);
  if (!auth.ok) return auth;
  const readiness = requireReferralStore();
  if (!readiness.ok) return readiness;
  const id = Number((await context.params).referralId);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false as const, response: jsonError("referralId is invalid.") };
  const result = await requireReferralAccess(auth.user, id);
  if (!result.ok) return result;
  if (!canRecordHistoricalAdmission(result.referral)) return { ok: false as const, response: jsonError("Prior admissions can only be recorded on imported historical charts.", 422) };
  return { ...result, user: auth.user };
}

export async function GET(request: Request, context: Context) {
  return withApiLogging(request, "/api/referrals/[referralId]/historical-admission", async () => {
    const result = await access(request, context);
    if (!result.ok) return result.response;
    // Optional lookup: manual confirmation must still work during an upstream outage.
    try {
      const roster = await getClinicalRoster(request, { query: result.referral.name, limit: 100 });
      const usable = roster.freshness.status === "fresh" && !roster.next_cursor;
      return Response.json({ suggestion: usable ? historicalAdmissionSuggestion(result.referral, roster.residents) : null, available: usable }, { headers });
    } catch {
      return Response.json({ suggestion: null, available: false }, { headers });
    }
  });
}

export async function POST(request: Request, context: Context) {
  return withApiLogging(request, "/api/referrals/[referralId]/historical-admission", async () => {
    const result = await access(request, context);
    if (!result.ok) return result.response;
    const origin = requireSameOriginMutation(request);
    if (origin) return origin;
    if (!canRecordAdmissionDecision(result.user)) return jsonError("Pipeline workspace access is required.", 403);
    const body = await readJsonBody<Record<string, unknown>>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const value = body.value;
    const admission = historicalAdmissionInput(value);
    if (!admission || value.confirmed !== true) return jsonError("Confirm this client's prior admission, a valid past admission date, and the community.");
    if (!Number.isSafeInteger(value.if_match) || Number(value.if_match) < 1) return jsonError("if_match must be a positive version number.");
    const mutation = validateClientMutationId(value.client_mutation_id);
    if (!mutation.ok || !mutation.value) return jsonError("client_mutation_id is required and must be valid.");
    let saved;
    try {
      saved = await recordHistoricalAdmission(result.referral.id, admission, Number(value.if_match), pipelineAuditActor(result.user), mutation.value);
    } catch (error) {
      if (error instanceof HistoricalWorkspaceReadOnlyError) return jsonError("The workspace changed. Reopen its Chart before recording a prior admission.", 409);
      throw error;
    }
    if (!saved) return jsonError("Historical chart is no longer available.", 409);
    if (!saved.ok) return Response.json({ error: "The chart changed in another session. Compare the recorded admission before trying again.", ...saved }, { status: 409, headers });
    return Response.json(saved, { headers });
  });
}
