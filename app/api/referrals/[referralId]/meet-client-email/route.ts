import { randomUUID } from "node:crypto";

import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { listAssessments, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { buildMeetClientSummary } from "@/lib/assessment/assessment-summary";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import {
  getGraphMailReadiness,
  sendMeetClientMail,
  validateMeetClientRecipients,
} from "@/lib/notifications/microsoft-graph-mail";
import { withApiLogging } from "@/lib/observability/api-logging";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";
import {
  completeMeetClientDelivery,
  reserveMeetClientDelivery,
} from "@/lib/pipeline/meet-client-delivery-audit";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { getReferralWorkflowSnapshot } from "@/lib/pipeline/workflow-store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/meet-client-email", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const storeFailure = meetClientStoreFailure();
    if (storeFailure) return storeFailure;

    const referralId = await parseReferralId(context);
    if (!referralId) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const prepared = await prepareEmailRequest(request);
    if (!prepared.ok) return prepared.response;
    const contextResult = await loadMeetClientContext(referralId);
    if (!contextResult.ok) return contextResult.response;
    const { assessment, snapshot } = contextResult;

    const deliveryId = randomUUID();
    const audit = buildDeliveryAudit({
      mutationId: prepared.mutationId,
      deliveryId,
      referralId,
      assessment,
      decisionId: contextResult.decisionId,
      actor: auth.user,
      recipients: prepared.recipients,
    });
    const reserved = await reserveMeetClientDelivery(audit);
    if (!reserved) return jsonError("This email request was already processed. Refresh the summary before trying again.", 409);

    try {
      const result = await sendMeetClientMail({
        recipients: prepared.recipients,
        summary: buildMeetClientSummary(assessment, snapshot.referral),
        preparedBy: auth.user.name,
        deliveryId,
      });
      await completeMeetClientDelivery(audit, "sent");
      recordPipelineMetric("pipeline.meet_client_email", 1, "count", { result: "sent" });
      return Response.json({
        ok: true,
        delivery_id: deliveryId,
        accepted_at: result.acceptedAt,
        recipient_count: prepared.recipients.length,
      }, { headers: privateHeaders() });
    } catch (error) {
      await completeMeetClientDelivery(audit, "failed", deliveryErrorCode(error));
      recordPipelineMetric("pipeline.meet_client_email", 1, "count", { result: "failed" });
      return jsonError("The summary was not accepted by Microsoft 365. No automatic retry was attempted.", 502);
    }
  });
}

function meetClientStoreFailure() {
  const referralStore = requireReferralStore();
  if (!referralStore.ok) return referralStore.response;
  const assessmentStore = requireAssessmentStore();
  return assessmentStore.ok ? null : assessmentStore.response;
}

type PreparedEmailRequest = {
  mutationId: string;
  recipients: string[];
};

async function prepareEmailRequest(request: Request): Promise<
  | { ok: true; mutationId: string; recipients: string[] }
  | { ok: false; response: Response }
> {
  const body = await readJsonBody(request, 32_000);
  if (!body.ok) return { ok: false, response: jsonError(body.message, body.status) };
  if (!isRecord(body.value) || body.value.confirmed !== true) {
    return { ok: false, response: jsonError("Confirm that every recipient is authorized to receive this client information.") };
  }
  const mutationId = body.value.client_mutation_id;
  if (!isMutationId(mutationId)) return { ok: false, response: jsonError("client_mutation_id is invalid.") };
  const readiness = getGraphMailReadiness();
  if (!readiness.configured) {
    return { ok: false, response: jsonError("Microsoft 365 email is not configured for Pipeline.", 503) };
  }
  const recipients = validateMeetClientRecipients(body.value.recipients, readiness);
  return recipients.ok
    ? { ok: true, mutationId, recipients: recipients.recipients }
    : { ok: false, response: jsonError(recipients.message) };
}

async function loadMeetClientContext(referralId: number) {
  const [snapshot, assessmentList] = await Promise.all([
    getReferralWorkflowSnapshot(referralId),
    listAssessments({ referralId, limit: 100 }),
  ]);
  if (!snapshot) return { ok: false as const, response: jsonError("Referral not found.", 404) };
  if (snapshot.decision?.outcome !== "accepted") {
    return { ok: false as const, response: jsonError("Record an accepted admission decision before emailing Meet the Client.", 422) };
  }
  const assessment = selectSignedAssessment(assessmentList.assessments, snapshot.recommendation?.assessmentId);
  if (!assessment) {
    return { ok: false as const, response: jsonError("A signed assessment is required before emailing Meet the Client.", 422) };
  }
  return { ok: true as const, assessment, snapshot, decisionId: snapshot.decision.decisionId };
}

function selectSignedAssessment(
  assessments: Awaited<ReturnType<typeof listAssessments>>["assessments"],
  recommendedAssessmentId?: string,
) {
  const recommended = assessments.find((item) => item.assessment_id === recommendedAssessmentId);
  return recommended?.signed_at ? recommended : assessments.find((item) => item.signed_at);
}

function buildDeliveryAudit({
  mutationId,
  deliveryId,
  referralId,
  assessment,
  decisionId,
  actor,
  recipients,
}: PreparedEmailRequest & {
  deliveryId: string;
  referralId: number;
  assessment: PipelineAssessmentRecord;
  decisionId: string;
  actor: { id: string; name: string };
}) {
  const now = new Date().toISOString();
  return {
    mutationId,
    deliveryId,
    referralId,
    assessmentId: assessment.assessment_id,
    decisionId,
    status: "reserved" as const,
    actorId: actor.id,
    actorName: actor.name,
    recipientCount: recipients.length,
    recipientDomains: [...new Set(recipients.map(emailDomain))],
    provider: "microsoft_graph",
    createdAt: now,
    updatedAt: now,
  };
}

async function parseReferralId(context: { params: Promise<{ referralId: string }> }) {
  const { referralId } = await context.params;
  const parsed = Number.parseInt(referralId, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMutationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function emailDomain(value: string) {
  return value.slice(value.lastIndexOf("@") + 1).toLowerCase();
}

function deliveryErrorCode(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") return "provider_timeout";
  return "provider_rejected";
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
