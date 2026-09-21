import { randomUUID } from "node:crypto";
import { getPlannedAdmissionDate, plannedAdmissionDateError } from "@/lib/pipeline/admission-lifecycle";

import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAccountableActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { deliverAssessmentPacket, listAssessments, requireAssessmentStore } from "@/lib/assessment/assessment-store";
import { buildAssessmentSummaryReport, buildMeetClientSummary, selectSignedAssessment } from "@/lib/assessment/assessment-summary";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { getPipelineDemoEnvironment } from "@/lib/demo/demo-environment";
import { parseMeetClientMessage, type MeetClientMessage } from "@/lib/notifications/meet-client-message";
import { prepareAdmissionPacketLink } from "@/lib/notifications/admission-packet-files";
import { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";
import { PacketAccessError } from "@/lib/notifications/admission-packet-store";
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
import { requireMutableReferralAccess } from "@/lib/pipeline/referral-access";
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
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const storeFailure = meetClientStoreFailure();
    if (storeFailure) return storeFailure;

    const referralId = await parseReferralId(context);
    if (!referralId) return jsonError("referralId is invalid.");
    const access = await requireMutableReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    if (getPipelineDemoEnvironment().writable) {
      return jsonError("Meet the Client is example only in this demo. No email will be sent.", 403);
    }
    const prepared = await prepareEmailRequest(request);
    if (!prepared.ok) return prepared.response;
    const contextResult = await loadMeetClientContext(referralId, prepared.referralVersion, prepared.assessmentId, prepared.assessmentVersion);
    if (!contextResult.ok) return contextResult.response;
    const { assessment, snapshot } = contextResult;
    const handoffReferral = { ...snapshot.referral, requirements: snapshot.work_items };
    const attachmentContext = await loadAdmissionPacket(handoffReferral, assessment);
    if (!attachmentContext.ok) return attachmentContext.response;
    if (attachmentContext.inventory.revision !== prepared.packetRevision) return jsonError("The packet files changed. Refresh the preview to include every current file before sending.", 409);

    const reserveAndDeliver = async () => {
      const deliveryId = randomUUID();
      const accountableActor = pipelineAccountableActor(auth.user);
      const audit = buildDeliveryAudit({
        mutationId: prepared.mutationId,
        deliveryId,
        referralId,
        assessment,
        decisionId: contextResult.decisionId,
        reviewId: contextResult.reviewId,
        reviewVersion: contextResult.reviewVersion,
        actor: accountableActor,
        recipients: [...prepared.recipients, ...prepared.ccRecipients],
        attachmentCount: attachmentContext.inventory.files.length,
        attachmentBytes: attachmentContext.inventory.totalBytes,
      });
      const reserved = await reserveMeetClientDelivery(audit);
      if (!reserved) return jsonError("This assessment already has a send in progress or awaiting confirmation. Check the workspace activity and the sending mailbox before retrying; refreshing will not send a duplicate.", 409);

      return deliverMeetClientEmail({
        audit,
        recipients: prepared.recipients,
        ccRecipients: prepared.ccRecipients,
        summary: buildMeetClientSummary(assessment, handoffReferral),
        preparedBy: accountableActor.name,
        deliveryId,
        attachments: attachmentContext.attachments,
        inventory: attachmentContext.inventory,
        requestUrl: request.url,
        beforeSend: async () => {
          const fresh = await getReferralWorkflowSnapshot(referralId);
          if (!fresh || fresh.referral.version !== prepared.referralVersion || fresh.decision?.outcome !== "accepted" || fresh.decision.decisionId !== contextResult.decisionId) throw new PacketAccessError("The admission details changed while preparing the packet. Refresh and review them before sending.", 409);
          const currentFiles = await getMeetClientAttachmentInventory(handoffReferral, { largeAttachmentDeliveryConfigured: getGraphMailReadiness().largeAttachmentDeliveryConfigured, report: buildAssessmentSummaryReport(assessment, handoffReferral) });
          if (!currentFiles.ready || currentFiles.revision !== prepared.packetRevision) throw new PacketAccessError("The packet files changed while preparing the email. Refresh and review them before sending.", 409);
        },
        message: prepared.message,
      });
    };
    return reserveAndDeliver();
  });
}

async function deliverMeetClientEmail(input: {
  audit: Parameters<typeof reserveMeetClientDelivery>[0];
  recipients: string[];
  ccRecipients: string[];
  summary: ReturnType<typeof buildMeetClientSummary>;
  preparedBy: string;
  deliveryId: string;
  attachments: Awaited<ReturnType<typeof prepareMeetClientMailAttachments>>;
  message: MeetClientMessage;
  inventory: Awaited<ReturnType<typeof getMeetClientAttachmentInventory>>;
  requestUrl: string;
  beforeSend: () => Promise<void>;
}) {
  let result: Awaited<ReturnType<typeof sendMeetClientMail>> | undefined;
  let auditPending = false;
  const validateBeforeSend = () => input.beforeSend().catch((error) => {
    if (error instanceof PacketAccessError) throw error;
    throw new PacketAccessError("The workspace could not be checked before sending. No email was sent. Try again.", 503);
  });
  try {
    await deliverAssessmentPacket(input.audit.assessmentId, input.audit.assessmentVersion, async () => {
      const sendLinkedPacket = async () => {
        const content = renderMeetClientEmail(input.summary, input.preparedBy, input.deliveryId, [], input.message);
        const packetUrl = await prepareAdmissionPacketLink({ id: input.deliveryId, referralId: input.audit.referralId,
          assessmentId: input.audit.assessmentId, assessmentVersion: input.audit.assessmentVersion,
          recipients: [...input.recipients, ...input.ccRecipients], inventory: input.inventory,
          message: { subject: content.subject, body: content.text }, requestUrl: input.requestUrl })
          .catch((error) => { if (error instanceof PacketAccessError) throw error; throw new PacketAccessError("The packet could not be prepared. No email was sent. Try again without removing any files.", 503); });
        await validateBeforeSend();
        return sendMeetClientMail({ ...input, attachments: [], packetUrl, packetFiles: input.inventory.files });
      };
      if (input.inventory.deliveryMode === "secure_link") result = await sendLinkedPacket();
      else {
        try { await validateBeforeSend(); result = await sendMeetClientMail(input); }
        catch (error) {
          // Only a definite refusal can safely switch delivery methods. A timeout
          // might already have sent the email and must never trigger a second send.
          if (!(error instanceof GraphMailDeliveryError) || (error.status !== 413 && error.code !== "packet_size_rejected" && error.code !== "large_attachment_permission_missing")) throw error;
          result = await sendLinkedPacket();
        }
      }
      return result;
    });
  } catch (error) {
    if (result) {
      // The provider accepted it. Never report a failed send or retry the email
      // if persisting finalization fails; the delivery audit retains its evidence.
      auditPending = true;
      recordPipelineMetric("pipeline.meet_client_email", 1, "count", { result: "finalization_pending" });
    } else {
      try {
        await completeMeetClientDelivery(input.audit, definitelyNotSent(error) ? "failed" : "unconfirmed", deliveryErrorCode(error), definitelyNotSent(error));
      } catch {
        recordPipelineMetric("pipeline.meet_client_email", 1, "count", { result: "failure_audit_pending" });
      }
      recordPipelineMetric("pipeline.meet_client_email", 1, "count", { result: "failed" });
      if (error instanceof Error && error.message.startsWith("The assessment changed.")) {
        return jsonError(error.message, 409);
      }
      if (error instanceof PacketAccessError) return Response.json({ error: error.message, retryable: true }, { status: error.status, headers: privateHeaders() });
      if (error instanceof GraphMailDeliveryError && definitelyNotSent(error)) {
        return Response.json({ error: error.status === 429 ? "Microsoft 365 is busy. No email was sent. Wait a minute, then try again." : "Microsoft 365 declined this send. No email was sent. Check the sending account and try again.", retryable: true }, { status: 503, headers: privateHeaders() });
      }
      return jsonError(`${deliveryFailureMessage(error)} Reference: ${input.deliveryId}.`, 502);
    }
  }
  if (!result) return jsonError("The packet send was not confirmed.", 502);
  try {
    await completeMeetClientDelivery(input.audit, "sent");
  } catch {
    // Provider acceptance cannot be undone by a failed audit write. Retain the
    // reservation and report acceptance, never invite a duplicate send.
    auditPending = true;
    recordPipelineMetric("pipeline.meet_client_email", 1, "count", { result: "acceptance_audit_pending" });
  }
  recordPipelineMetric("pipeline.meet_client_email", 1, "count", { result: "sent" });
  return Response.json({
    ok: true,
    delivery_id: input.deliveryId,
    accepted_at: result.acceptedAt,
    recipient_count: input.recipients.length + input.ccRecipients.length,
    attachment_count: result.attachmentCount,
    attachment_bytes: result.attachmentBytes,
    delivery_mode: result.deliveryMode,
    ...(auditPending ? { audit_pending: true } : {}),
  }, { headers: privateHeaders() });
}

function definitelyNotSent(error: unknown) {
  return error instanceof PacketAccessError
    || (error instanceof Error && error.message.startsWith("The assessment changed."))
    || (error instanceof GraphMailDeliveryError && (error.code.startsWith("attachment_source_") || error.code === "mail_preparation_failed"
      || Boolean(error.status && [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status))));
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
  | { ok: true; mutationId: string; recipients: string[]; ccRecipients: string[]; referralVersion: number; message: MeetClientMessage; assessmentId: string; assessmentVersion: number; packetRevision: string }
  | { ok: false; response: Response }
> {
  const body = await readJsonBody(request, 256_000);
  if (!body.ok) return { ok: false, response: jsonError(body.message, body.status) };
  if (!isRecord(body.value) || body.value.confirmed !== true) {
    return { ok: false, response: jsonError("Confirm that every recipient is authorized to receive this client information.") };
  }
  const message = parseMeetClientMessage(body.value.message);
  if (!message) return { ok: false, response: jsonError("Use a subject up to 200 characters and message up to 20,000 characters, without unsupported control characters.") };
  const packetRevision = body.value.packet_revision;
  if (typeof packetRevision !== "string" || !/^[a-f0-9]{64}$/.test(packetRevision)) return { ok: false, response: jsonError("Refresh the preview before sending the packet.", 409) };
  const mutationId = body.value.client_mutation_id;
  if (!isMutationId(mutationId)) return { ok: false, response: jsonError("client_mutation_id is invalid.") };
  const referralVersion = body.value.if_match;
  if (!isReferralVersion(referralVersion)) {
    return { ok: false, response: jsonError("Refresh the summary before sending.", 409) };
  }
  const readiness = getGraphMailReadiness();
  if (!readiness.configured) {
    return { ok: false, response: jsonError("Microsoft 365 email is not configured for Pipeline.", 503) };
  }
  const assessmentId = body.value.assessment_id;
  const assessmentVersion = body.value.if_match_assessment;
  if (!validAssessmentPreview(assessmentId, assessmentVersion)) {
    return { ok: false, response: jsonError("Refresh and review the assessment summary before sending.", 409) };
  }
  const audience = prepareHandoffAudience(body.value, readiness);
  return audience.ok ? { ...audience, mutationId, referralVersion, message, assessmentId: assessmentId as string, assessmentVersion: assessmentVersion as number, packetRevision } : audience;
}

function prepareHandoffAudience(body: Record<string, unknown>, readiness: ReturnType<typeof getGraphMailReadiness>) {
  const to = body.recipients;
  const cc = body.cc_recipients ?? [];
  if (!Array.isArray(to) || to.length === 0 || !Array.isArray(cc)) return { ok: false as const, response: jsonError("Add at least one To recipient and a valid Cc list.") };
  const audience = validateMeetClientRecipients([...to, ...cc], readiness);
  if (!audience.ok) return { ok: false as const, response: jsonError(audience.message) };
  const recipients = [...new Set((to as string[]).map((address) => address.trim().toLowerCase()))];
  return { ok: true as const, recipients, ccRecipients: audience.recipients.filter((address) => !recipients.includes(address)) };
}

async function loadMeetClientContext(referralId: number, referralVersion: number, assessmentId: string, assessmentVersion: number) {
  const [snapshot, assessmentList] = await Promise.all([
    getReferralWorkflowSnapshot(referralId),
    listAssessments({ referralId, limit: 100 }),
  ]);
  if (!snapshot) return { ok: false as const, response: jsonError("Referral not found.", 404) };
  if (snapshot.referral.version !== referralVersion) {
    return { ok: false as const, response: jsonError("The workspace changed. Refresh and check the admission date and summary before sending.", 409) };
  }
  if (snapshot.decision?.outcome !== "accepted") {
    return { ok: false as const, response: jsonError("Record an accepted admission decision before emailing Meet the Client.", 422) };
  }
  const dateError = plannedAdmissionDateError(getPlannedAdmissionDate(snapshot.referral));
  if (dateError) return { ok: false as const, response: jsonError(dateError, 422) };
  const assessment = selectSignedAssessment(
    assessmentList.assessments,
    snapshot.decision?.assessmentId ?? snapshot.recommendation?.assessmentId,
  );
  if (!assessment) {
    return { ok: false as const, response: jsonError("Sign the assessment before emailing Meet the Client. Acceptance and signing are separate steps.", 422) };
  }
  if (assessment.assessment_id !== assessmentId || assessment.version !== assessmentVersion) {
    return { ok: false as const, response: jsonError("The assessment changed. Refresh and review Meet the Client before sending.", 409) };
  }
  return {
    ok: true as const,
    assessment,
    snapshot,
    decisionId: snapshot.decision.decisionId,
    reviewId: snapshot.decision.reviewId,
    reviewVersion: snapshot.decision.reviewVersion,
  };
}

async function loadAdmissionPacket(referral: Referral, assessment: PipelineAssessmentRecord) {
  try {
    const readiness = getGraphMailReadiness();
    const inventory = await getMeetClientAttachmentInventory(referral, {
      largeAttachmentDeliveryConfigured: readiness.largeAttachmentDeliveryConfigured,
      report: buildAssessmentSummaryReport(assessment, referral),
    });
    if (!inventory.ready) {
      return { ok: false as const, response: jsonError(inventory.blockers.join(" "), 422) };
    }
    const attachments = inventory.deliveryMode === "secure_link" ? [] : await prepareMeetClientMailAttachments(inventory);
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
  reviewId,
  reviewVersion,
  actor,
  recipients,
  attachmentCount,
  attachmentBytes,
}: PreparedEmailRequest & {
  deliveryId: string;
  referralId: number;
  assessment: PipelineAssessmentRecord;
  decisionId: string;
  reviewId?: string;
  reviewVersion?: number;
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
    assessmentVersion: assessment.version,
    decisionId,
    reviewId,
    reviewVersion,
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
  if (!/^[1-9]\d{0,14}$/.test(referralId)) return null;
  const parsed = Number(referralId);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isReferralVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
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
  return "Microsoft 365 did not confirm acceptance of the summary and admission packet. No automatic retry was attempted. Check the send outcome before starting a new request.";
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}

function validAssessmentPreview(id: unknown, version: unknown) {
  return typeof id === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(id)
    && typeof version === "number" && Number.isSafeInteger(version) && version >= 1;
}
