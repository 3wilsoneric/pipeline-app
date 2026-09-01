import { randomUUID } from "node:crypto";

import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { listAssessments, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { buildMeetClientSummary } from "@/lib/assessment/assessment-summary";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import {
  getMeetClientAttachmentInventory,
  prepareMeetClientMailAttachments,
} from "@/lib/notifications/meet-client-attachments";
import {
  GraphMailDeliveryError,
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
import type { Referral } from "@/lib/pipeline/referral-types";
import { getReferralWorkflowSnapshot } from "@/lib/pipeline/workflow-store";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    const attachmentContext = await loadAdmissionPacket(snapshot.referral);
    if (!attachmentContext.ok) return attachmentContext.response;

    const deliveryId = randomUUID();
    const audit = buildDeliveryAudit({
      mutationId: prepared.mutationId,
      deliveryId,
      referralId,
      assessment,
      decisionId: contextResult.decisionId,
      actor: auth.user,
      recipients: prepared.recipients,
      attachmentCount: attachmentContext.attachments.length,
      attachmentBytes: attachmentContext.inventory.totalBytes,
    });
    const reserved = await reserveMeetClientDelivery(audit);
    if (!reserved) return jsonError("This email request was already processed. Refresh the summary before trying again.", 409);

    return deliverMeetClientEmail({
      audit,
      recipients: prepared.recipients,
      summary: buildMeetClientSummary(assessment, snapshot.referral),
      preparedBy: auth.user.name,
      deliveryId,
      attachments: attachmentContext.attachments,
    });
  });
}

async function deliverMeetClientEmail(input: {
  audit: Parameters<typeof reserveMeetClientDelivery>[0];
  recipients: string[];
  summary: ReturnType<typeof buildMeetClientSummary>;
  preparedBy: string;
  deliveryId: string;
  attachments: Awaited<ReturnType<typeof prepareMeetClientMailAttachments>>;
}) {
  try {
    const result = await sendMeetClientMail(input);
    await completeMeetClientDelivery(input.audit, "sent");
    recordPipelineMetric("pipeline.meet_client_email", 1, "count", { result: "sent" });
    return Response.json({
      ok: true,
      delivery_id: input.deliveryId,
      accepted_at: result.acceptedAt,
      recipient_count: input.recipients.length,
      attachment_count: result.attachmentCount,
      attachment_bytes: result.attachmentBytes,
    }, { headers: privateHeaders() });
  } catch (error) {
    await completeMeetClientDelivery(input.audit, "failed", deliveryErrorCode(error));
    recordPipelineMetric("pipeline.meet_client_email", 1, "count", { result: "failed" });
    return jsonError(deliveryFailureMessage(error), 502);
  }
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

async function loadAdmissionPacket(referral: Referral) {
  try {
    const readiness = getGraphMailReadiness();
    const inventory = await getMeetClientAttachmentInventory(referral, {
      largeAttachmentDeliveryConfigured: readiness.largeAttachmentDeliveryConfigured,
    });
    if (!inventory.ready) {
      return { ok: false as const, response: jsonError(inventory.blockers.join(" "), 422) };
    }
    const attachments = await prepareMeetClientMailAttachments(inventory);
    return { ok: true as const, inventory, attachments };
  } catch {
    return { ok: false as const, response: jsonError("The admission packet could not be prepared. Refresh the chart and try again.", 503) };
  }
}

function buildDeliveryAudit({
  mutationId,
  deliveryId,
  referralId,
  assessment,
  decisionId,
  actor,
  recipients,
  attachmentCount,
  attachmentBytes,
}: PreparedEmailRequest & {
  deliveryId: string;
  referralId: number;
  assessment: PipelineAssessmentRecord;
  decisionId: string;
  actor: { id: string; name: string };
  attachmentCount: number;
  attachmentBytes: number;
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
    attachmentCount,
    attachmentBytes,
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
  if (error instanceof GraphMailDeliveryError) return error.code;
  if (error instanceof DOMException && error.name === "TimeoutError") return "provider_timeout";
  return "provider_rejected";
}

function deliveryFailureMessage(error: unknown) {
  if (error instanceof GraphMailDeliveryError && error.code === "large_attachment_permission_missing") {
    return "Microsoft 365 is not configured to send this admission packet size. No email was sent.";
  }
  if (error instanceof GraphMailDeliveryError && error.code.startsWith("attachment_source_")) {
    return "An admission packet file became unavailable before delivery. No email was sent.";
  }
  return "The summary and admission packet were not accepted by Microsoft 365. No automatic retry was attempted.";
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
