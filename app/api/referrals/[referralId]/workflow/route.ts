import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { canWorkAssessment } from "@/lib/assessment/assessment-access";
import { getAssessment } from "@/lib/assessment/assessment-store";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { canRecordAdmissionDecision, requireReferralAccess } from "@/lib/pipeline/referral-access";
import { getAllowedReferralTargets, getReferralTransitionBlockers } from "@/lib/pipeline/referral-workflow";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { getReferralWorkflowSnapshot } from "@/lib/pipeline/workflow-store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/workflow", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;
    const { referralId: rawReferralId } = await context.params;
    const referralId = Number.parseInt(rawReferralId, 10);
    if (!Number.isInteger(referralId) || referralId < 1) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const snapshot = await getReferralWorkflowSnapshot(referralId);
    if (!snapshot) return jsonError("Referral not found.", 404);
    const assessment = snapshot.context.assessmentId
      ? await getAssessment(snapshot.context.assessmentId)
      : null;
    const canUpdate = auth.user.roles.some((role) => role === "admin" || role === "assessment_coordinator" || role === "reviewer");

    return Response.json({
      ...snapshot,
      transitions: getAllowedReferralTargets(snapshot.referral.stage).map((target) => ({
        target,
        blockers: getReferralTransitionBlockers(snapshot.referral, target, snapshot.context),
      })),
      capabilities: {
        can_update: canUpdate,
        can_recommend: canUpdate && Boolean(assessment?.signed_at) && canWorkAssessment(auth.user, assessment?.assessor_id ?? null),
        can_decide: canRecordAdmissionDecision(auth.user),
        can_authorize_manual_intake: auth.user.roles.some((role) => role === "admin" || role === "assessment_coordinator"),
      },
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}
