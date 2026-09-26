import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { listAssessments } from "@/lib/assessment/assessment-store";
import { priorAnswersFrom, priorAnswerFields, samePriorAnswerValue, type PriorAnswerRequest, type PriorAnswerSource, type PriorAnswers } from "@/lib/assessment/assessment-prior-answers";
import type { AssessmentToolData, AssessmentToolFieldKey } from "@/lib/assessment/assessment-tool-schema";
import { canAccessReferral } from "@/lib/pipeline/referral-access";
import { getReferral, listReferralsByClient } from "@/lib/pipeline/referral-store";

// A returning client's earlier signed assessments: same Pipeline client (shared across their
// referrals) or same linked clinical client, on another referral, and only where this person
// may open that referral. Never the assessment being edited or another revision of its referral.
async function priorSignedAssessments(user: PipelineUser, current: PipelineAssessmentRecord) {
  const referral = await getReferral(current.referral_id);
  const candidates = new Map<string, PipelineAssessmentRecord>();
  if (referral?.clientId) {
    for (const other of await listReferralsByClient(referral.clientId)) {
      if (other.id === current.referral_id || !canAccessReferral(user, other)) continue;
      for (const assessment of (await listAssessments({ referralId: other.id, limit: 20 })).assessments) candidates.set(assessment.assessment_id, assessment);
    }
  }
  if (current.canonical_client_id) {
    for (const assessment of (await listAssessments({ canonicalClientId: current.canonical_client_id, limit: 50 })).assessments) {
      if (assessment.referral_id === current.referral_id || candidates.has(assessment.assessment_id)) continue;
      const other = await getReferral(assessment.referral_id);
      if (other && canAccessReferral(user, other)) candidates.set(assessment.assessment_id, assessment);
    }
  }
  return [...candidates.values()]
    .filter((assessment) => assessment.signed_at && assessment.referral_id !== current.referral_id)
    .sort((left, right) => (right.signed_at ?? "").localeCompare(left.signed_at ?? ""));
}

export async function latestPriorAnswers(user: PipelineUser, current: PipelineAssessmentRecord): Promise<PriorAnswers> {
  const [latest] = await priorSignedAssessments(user, current);
  return latest ? priorAnswersFrom(latest) : null;
}

// Re-checks answers the person chose to reuse: each must name an earlier signed assessment of this
// client that they may open, and the value being saved must equal that assessment's answer. Only
// verified answers are credited to the earlier assessment; anything else still saves, recorded as
// entered by the person, so a stale suggestion never blocks a save.
export async function verifyPriorAnswers(
  user: PipelineUser,
  current: PipelineAssessmentRecord,
  requests: readonly PriorAnswerRequest[],
  data: Partial<AssessmentToolData> | undefined,
): Promise<Partial<Record<AssessmentToolFieldKey, PriorAnswerSource>>> {
  const sources: Partial<Record<AssessmentToolFieldKey, PriorAnswerSource>> = {};
  if (!requests.length || !data) return sources;
  const allowed = new Map((await priorSignedAssessments(user, current)).map((assessment) => [assessment.assessment_id, assessment]));
  for (const request of requests) {
    const prior = allowed.get(request.assessment_id);
    if (!prior?.signed_at || !priorAnswerFields.has(request.field) || !Object.hasOwn(data, request.field)) continue;
    if (!samePriorAnswerValue(data[request.field], prior[request.field as keyof PipelineAssessmentRecord])) continue;
    sources[request.field] = { assessment_id: prior.assessment_id, signed_at: prior.signed_at, referral_id: prior.referral_id };
  }
  return sources;
}
