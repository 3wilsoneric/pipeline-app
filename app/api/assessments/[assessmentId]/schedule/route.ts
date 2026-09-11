import {
  AssessmentScheduleConflictError,
  getAssessment,
  patchAssessment,
  requireAssessmentStore,
} from "@/lib/assessment/assessment-store";
import { canWorkAssessment, isAssessmentSupervisor } from "@/lib/assessment/assessment-access";
import {
  validateAssessmentScheduleCommand,
  type AssessmentScheduleCommand,
} from "@/lib/assessment/assessment-lifecycle-validation";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getContactSchedulingReadiness, requireContactStore } from "@/lib/pipeline/contact-store";
import { requireMutableReferralAccess } from "@/lib/pipeline/referral-access";
import type { Referral } from "@/lib/pipeline/referral-types";
import { hasInitialDocument, hasManualIntakeAuthorization, profileIsReady } from "@/lib/pipeline/workflow-status";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ assessmentId: string }> }) {
  return withApiLogging(request, "/api/assessments/[assessmentId]/schedule", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireAssessmentStore();
    if (!store.ok) return store.response;
    const { assessmentId } = await context.params;
    if (!safeAssessmentId(assessmentId)) return jsonError("assessmentId is invalid.");
    const assessment = await getAssessment(assessmentId);
    if (!assessment) return jsonError("Assessment not found.", 404);
    const access = await requireMutableReferralAccess(auth.user, assessment.referral_id);
    if (!access.ok) return access.response;
    if (!canWorkAssessment(auth.user, assessment.assessor_id)) {
      return jsonError("Only the assigned assessor or a supervisor can schedule this assessment.", 403);
    }
    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const command = validateAssessmentScheduleCommand(body.value);
    if (!command.ok) return jsonError(command.message, command.status);
    return scheduleAssessmentIfReady(
      assessmentId,
      command.value,
      access.referral,
      assessment.assessor_id,
      pipelineAuditActor(auth.user),
      isAssessmentSupervisor(auth.user),
    );
  });
}

async function scheduleAssessmentIfReady(
  assessmentId: string,
  command: AssessmentScheduleCommand,
  referral: Referral,
  assessorId: string | null | undefined,
  actor: { id: string; name: string },
  canOverride: boolean,
) {
  const readinessFailure = await assessmentSchedulingReadinessFailure(command, referral, assessorId);
  return readinessFailure ?? saveAssessmentSchedule(assessmentId, command, actor, canOverride);
}

async function assessmentSchedulingReadinessFailure(
  command: AssessmentScheduleCommand,
  referral: Referral,
  assessorId: string | null | undefined,
) {
  if (!["scheduled", "rescheduled"].includes(command.schedule.status)) return null;
  const contacts = requireContactStore();
  if (!contacts.ok) return contacts.response;
  const blockers = await schedulingBlockers(referral, assessorId);
  return blockers.length
    ? Response.json({ error: blockers.join(" "), code: "assessment_not_ready_to_schedule", blockers }, { status: 422 })
    : null;
}

async function schedulingBlockers(
  referral: Referral,
  assessorId: string | null | undefined,
) {
  const blockers: string[] = [];
  if (!assessorId) blockers.push("Assign an assessor before scheduling.");
  if (!hasInitialDocument(referral) && !hasManualIntakeAuthorization(referral)) blockers.push("Review an intake packet or authorize manual intake.");
  if (!profileIsReady(referral)) blockers.push("Complete the client name, date of birth, community, and referral source.");
  const contact = await getContactSchedulingReadiness(referral.id, referral);
  blockers.push(...contact.blockers);
  return blockers;
}

async function saveAssessmentSchedule(
  assessmentId: string,
  command: AssessmentScheduleCommand,
  actor: { id: string; name: string },
  canOverride: boolean,
) {
  try {
    const result = await patchAssessment(
      assessmentId,
      { schedule: command.schedule },
      actor,
      {
        expectedVersion: command.if_match,
        mutationId: command.client_mutation_id,
        allowScheduleConflict: command.allow_conflict === true && canOverride,
      },
    );
    return mutationResponse(result, "schedule");
  } catch (error) {
    if (!(error instanceof AssessmentScheduleConflictError)) throw error;
    return Response.json({
      error: error.message,
      code: "assessment_schedule_conflict",
      conflicts: error.conflicts,
      can_override: canOverride,
    }, { status: 409 });
  }
}

function mutationResponse(result: Awaited<ReturnType<typeof patchAssessment>>, action: string) {
  if (!result) return jsonError("Assessment not found.", 404);
  if (!result.ok && "conflict" in result) {
    return Response.json({ error: `This assessment changed before its ${action} could be saved.`, ...result }, { status: 409 });
  }
  if (!result.ok) return Response.json({ error: `The assessment ${action} is blocked.`, ...result }, { status: 422 });
  return Response.json(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

function safeAssessmentId(value: string) {
  return value.length > 0 && value.length <= 160 && /^[a-zA-Z0-9_.:-]+$/.test(value);
}
