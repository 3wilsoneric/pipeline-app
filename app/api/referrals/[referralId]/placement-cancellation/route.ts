import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAccountableActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireMutableReferralAccess } from "@/lib/pipeline/referral-access";
import { patchReferral, requireReferralStore } from "@/lib/pipeline/referral-store";
import { validateClientMutationId } from "@/lib/pipeline/client-mutation-id";
import type { PlacementCancellation } from "@/lib/pipeline/referral-types";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ referralId: string }> }) {
  return withApiLogging(request, "/api/referrals/[referralId]/placement-cancellation", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;

    const { referralId: rawId } = await context.params;
    const referralId = Number(rawId);
    if (!Number.isSafeInteger(referralId) || referralId < 1) return jsonError("referralId is invalid.");
    const access = await requireMutableReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;

    const body = await readJsonBody<{ if_match?: unknown; if_match_section?: unknown; reason?: unknown; client_mutation_id?: unknown }>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!Number.isInteger(body.value?.if_match) || Number(body.value?.if_match) < 1) return jsonError("if_match must be a positive version number.");
    if (!Number.isInteger(body.value?.if_match_section) || Number(body.value?.if_match_section) < 1) return jsonError("if_match_section must be a positive workflow section version number.");
    if (typeof body.value?.reason !== "string" || !body.value.reason.trim()) return jsonError("Explain why placement was cancelled.");
    const reason = body.value.reason.trim();
    if (reason.length > 2_000) return jsonError("The explanation must be 2,000 characters or fewer.");
    const mutationId = validateClientMutationId(body.value.client_mutation_id);
    if (!mutationId.ok) return jsonError(mutationId.message);

    const referral = access.referral;
    if (referral.admissionDecision?.outcome !== "accepted") return jsonError("Record an accepted decision before cancelling placement.", 422);
    if (referral.actualAdmissionDate || referral.stage === "Accepted / Admitted") return jsonError("This client was recorded as admitted. Review the admission record instead.", 422);
    if (referral.placementCancellation?.reason === reason) return Response.json({ referral }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });

    const actor = pipelineAccountableActor(auth.user);
    const now = new Date().toISOString();
    const existing = referral.placementCancellation;
    const placementCancellation: PlacementCancellation = {
      reason,
      cancelledBy: existing?.cancelledBy ?? actor.id,
      cancelledByName: existing?.cancelledByName ?? actor.name,
      cancelledAt: existing?.cancelledAt ?? now,
      updatedBy: actor.id,
      updatedByName: actor.name,
      updatedAt: now,
    };
    const result = await patchReferral(referralId,
      { placementCancellation, workflowStatus: "closed" },
      Number(body.value.if_match), actor,
      { workflow: Number(body.value.if_match_section) },
      {
        auditAction: existing ? "placement_cancellation_updated" : "placement_cancelled",
        auditReason: reason,
        mutationId: mutationId.value,
        mutationScope: "placement_cancellation",
      },
    );
    if (!result) return jsonError("Referral not found.", 404);
    if (!result.ok && "conflict" in result) return Response.json({ error: "This workspace changed. Review the latest placement status before saving.", ...result }, { status: 409 });
    if (!result.ok) return Response.json({ error: result.blockers[0]?.label ?? "Placement cancellation could not be saved.", ...result }, { status: 422 });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}
