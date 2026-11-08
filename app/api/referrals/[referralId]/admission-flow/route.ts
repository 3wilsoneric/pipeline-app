import { mutationReplayRequest } from "@/lib/persistence/mutation-replay";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAccountableActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { normalizeCalendarDate } from "@/lib/pipeline/calendar-date";
import { admissionFlowToday } from "@/lib/pipeline/admission-flow-day";
import { canConfirmAdmission, requireMutableReferralAccess } from "@/lib/pipeline/referral-access";
import { canAccessExecutiveAdmissionFlow } from "@/lib/pipeline/report-access";
import { getReferralMutationReplay, patchReferral, requireReferralStore } from "@/lib/pipeline/referral-store";
import type { AdmissionFlowHold, AdmissionFlowHoldReason, AdmissionFlowTracking } from "@/lib/pipeline/referral-types";
import { validateClientMutationId } from "@/lib/pipeline/client-mutation-id";
import { getReferralWorkflowSnapshot } from "@/lib/pipeline/workflow-store";
import { getBlockingRequirementsForGates } from "@/lib/pipeline/workflow-records";

export const runtime = "nodejs";

const reasons: AdmissionFlowHoldReason[] = [
  "source_records", "client_availability", "clinical_clearance", "payer_authorization",
  "admission_paperwork", "staffed_bed", "transport", "scheduling", "needs_clarification",
];
const responsibleParties: AdmissionFlowHold["responsibleParty"][] = [
  "referral_source", "client_or_family", "pipeline", "community", "external_partner", "unassigned",
];

export async function PUT(request: Request, context: { params: Promise<{ referralId: string }> }) {
  return withApiLogging(request, "/api/referrals/[referralId]/admission-flow", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;
    const referralId = Number((await context.params).referralId);
    if (!Number.isSafeInteger(referralId) || referralId < 1) return jsonError("referralId is invalid.");
    const access = await requireMutableReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    if (!canConfirmAdmission(auth.user) || !canAccessExecutiveAdmissionFlow(auth.user)) return jsonError("Admission flow tracking is not available for this account.", 403);
    const body = await readJsonBody<Record<string, unknown>>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) return jsonError("The request body must be an object.");
    const { if_match, if_match_section, action } = body.value;
    if (!Number.isSafeInteger(if_match) || Number(if_match) < 1) return jsonError("if_match must be a positive version number.");
    if (!Number.isSafeInteger(if_match_section) || Number(if_match_section) < 1) return jsonError("if_match_section must be a positive workflow section version number.");
    const mutationId = validateClientMutationId(body.value.client_mutation_id);
    if (!mutationId.ok) return jsonError(mutationId.message);
    const replayRequest = mutationReplayRequest(auth.user, body.value);
    const replay = await getReferralMutationReplay(referralId, "admission_flow", mutationId.value, pipelineAccountableActor(auth.user), replayRequest);
    if (replay) return Response.json({ referral: replay }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    const referral = access.referral;
    if (referral.stage === "Accepted / Admitted" || referral.actualAdmissionDate || referral.placementCancellation || referral.stage === "Declined") {
      return jsonError("Admission flow tracking is closed for this referral.", 422);
    }
    const actor = pipelineAccountableActor(auth.user);
    const now = new Date().toISOString();
    const current: AdmissionFlowTracking = referral.admissionFlow ?? { holds: [] };
    const holds = current.holds ?? [];
    let next: AdmissionFlowTracking;
    let auditAction: string;
    if (action === "record_ready") {
      const date = typeof body.value.ready_date === "string" ? normalizeCalendarDate(body.value.ready_date) : null;
      const received = normalizeCalendarDate(referral.date);
      if (!date || date > admissionFlowToday() || (received && date < received)) return jsonError("Enter the actual ready date, between referral receipt and today.");
      if (referral.admissionDecision?.outcome !== "accepted") return jsonError("Record the admission decision before marking the client ready.", 422);
      const acceptedAt = referral.admissionDecision.decidedAt;
      const accepted = acceptedAt && Number.isFinite(Date.parse(acceptedAt))
        ? admissionFlowToday(new Date(acceptedAt)) : null;
      if (accepted && date < accepted) return jsonError("The ready date cannot precede the recorded admission decision.");
      const snapshot = await getReferralWorkflowSnapshot(referralId);
      if (!snapshot || getBlockingRequirementsForGates(snapshot.work_items, ["move_in"]).length > 0) {
        return jsonError("Resolve blocking move-in requirements before marking the client ready.", 422);
      }
      if (current.readyToMoveInDate === date) return Response.json({ referral }, { headers: { "Cache-Control": "private, no-store" } });
      if ((current.readyDateHistory?.length ?? 0) >= 20) return jsonError("This referral has reached the supported date correction limit. Contact an administrator.", 422);
      next = { ...current, readyToMoveInDate: date, readyRecordedAt: now, readyRecordedBy: actor.id,
        readyDateHistory: [...(current.readyDateHistory ?? []), { date, recordedAt: now, recordedBy: actor.id }], holds };
      auditAction = current.readyToMoveInDate ? "admission_ready_date_corrected" : "admission_ready_recorded";
    } else if (action === "start_hold") {
      if (!reasons.includes(body.value.reason as AdmissionFlowHoldReason)) return jsonError("Choose a hold reason.");
      if (!responsibleParties.includes(body.value.responsible_party as AdmissionFlowHold["responsibleParty"])) return jsonError("Choose who owns the next action.");
      if (holds.some((hold) => !hold.endedAt)) return jsonError("End the current hold before recording a new one.", 422);
      if (holds.length >= 100) return jsonError("This referral has reached the supported hold history limit. Contact an administrator.", 422);
      next = { ...current, holds: [...holds, {
        reason: body.value.reason as AdmissionFlowHoldReason,
        responsibleParty: body.value.responsible_party as AdmissionFlowHold["responsibleParty"],
        startedAt: now, recordedBy: actor.id, recordedByName: actor.name,
      }] };
      auditAction = "admission_hold_started";
    } else if (action === "end_hold") {
      const index = holds.findIndex((hold) => !hold.endedAt);
      if (index < 0) return jsonError("There is no current hold to end.", 422);
      next = { ...current, holds: holds.map((hold, holdIndex) => holdIndex === index ? { ...hold, endedAt: now } : hold) };
      auditAction = "admission_hold_ended";
    } else {
      return jsonError("Choose a supported admission flow action.");
    }
    const result = await patchReferral(referralId, { admissionFlow: next }, Number(if_match), actor,
      { workflow: Number(if_match_section) }, { auditAction, auditReason: action === "record_ready" ? `Ready date ${next.readyToMoveInDate}` : undefined,
        mutationId: mutationId.value, mutationScope: "admission_flow", replayRequest });
    if (!result) return jsonError("Referral not found.", 404);
    if (!result.ok && "conflict" in result) return Response.json({ error: "This referral changed. Review the latest status before saving.", ...result }, { status: 409 });
    if (!result.ok) return Response.json({ error: result.blockers[0]?.label ?? "Admission flow could not be saved.", ...result }, { status: 422 });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}
