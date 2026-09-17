import { createHash } from "node:crypto";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess, assignedOwnerForCreate, isAssessorUser } from "@/lib/pipeline/referral-access";
import { createReferral, requireReferralStore } from "@/lib/pipeline/referral-store";
import { getUnifiedClientProfile } from "@/lib/pipeline/unified-profile";
import { buildChartIntake } from "@/lib/pipeline/chart-intake";
import { createReferralOwners } from "@/lib/pipeline/referral-ownership";
import { createDefaultAdmissionRequirements } from "@/lib/pipeline/workflow-records";
import { validateReferralCreateInput } from "@/lib/pipeline/referral-validation";
import { touchWorkspaceMember } from "@/lib/pipeline/workspace-members";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ referralId: string }> }) {
  return withApiLogging(request, "/api/referrals/[referralId]/new-intake", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireReferralStore();
    if (!store.ok) return store.response;
    const { referralId } = await context.params;
    const sourceId = parseSourceReferralId(referralId);
    if (sourceId === null) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, sourceId);
    if (!access.ok) return access.response;
    if (!access.referral.clientId) return jsonError("Connect this workspace to its client before starting a new referral.", 409);
    const mutation = await readChartMutationId(request);
    if (!mutation.ok) return mutation.response;
    // Retry keys are bound to this authenticated actor and source, never a client-supplied person id.
    const mutationId = `chart-intake:${createHash("sha256").update(JSON.stringify([auth.user.id, referralId, mutation.value])).digest("hex")}`;
    const profile = await getUnifiedClientProfile(request, `pipeline:${access.referral.clientId}`, undefined, auth.user);
    if (profile.pipeline.connection.status === "unavailable") {
      return jsonError("The complete chart is unavailable. Retry before starting a new intake.", 503);
    }
    const input = buildChartIntake(profile, access.referral, new Date().toISOString());
    const validated = validateReferralCreateInput(input);
    if (!validated.ok) return jsonError(`Chart information needs review: ${validated.message}`, validated.status);
    input.chartSource = { referralId: access.referral.id, dataAsOf: profile.data_as_of, capturedAt: input.createdAt };
    Object.assign(input, assignedOwnerForCreate(auth.user, "Unassigned"));
    input.owners = createReferralOwners(auth.user, input, !isAssessorUser(auth.user));
    input.requirements = createDefaultAdmissionRequirements([], {}, input.createdAt, input.owner, input.ownerId,
      { date_of_birth: input.dob, community: input.community, referral_source: input.source });
    await touchWorkspaceMember(auth.user);
    const result = await createReferral(input, mutationId, pipelineAuditActor(auth.user), { newEpisodeSourceReferralId: access.referral.id });
    return Response.json({ referral: result.referral, idempotent_replay: result.idempotentReplay }, {
      status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}

function parseSourceReferralId(value: string) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return null;
  return Number(value);
}

async function readChartMutationId(request: Request) {
  const body = await readJsonBody<{ client_mutation_id?: unknown }>(request);
  if (!body.ok) return { ok: false as const, response: jsonError(body.message, body.status) };
  if (!body.value || typeof body.value.client_mutation_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.value.client_mutation_id)) {
    return { ok: false as const, response: jsonError("A valid client_mutation_id is required.") };
  }
  return { ok: true as const, value: body.value.client_mutation_id };
}
