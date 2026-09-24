import "server-only";
import { randomUUID } from "node:crypto";
import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { deliverAssessmentPacket, getAssessment } from "@/lib/assessment/assessment-store";
import { completeMeetClientDelivery, type DeliveryAudit } from "@/lib/pipeline/meet-client-delivery-audit";
import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import type { MeetClientMessage } from "./meet-client-message";
import type { MeetClientAttachmentInventory } from "./meet-client-attachments";
import { packetMailAttachment, prepareAdmissionPacketRecord } from "./admission-packet-files";
import { PacketAccessError, withAdmissionPacket } from "./admission-packet-store";
import { currentSource, outlookDraftView, withDraftOperation } from "./outlook-handoff";
import { renderMeetClientEmail } from "./meet-client-email-template";
import { getGraphMailReadiness, GraphMailDeliveryError, sendMeetClientMail, validateMeetClientRecipients } from "./microsoft-graph-mail";
import { meetClientAttachmentDeliveryMode } from "./meet-client-attachment-policy";

export function assessorEmailDestination(user: PipelineUser) {
  if (user.delegation) throw new PacketAccessError("Leave the assessor session to email a packet to your own account.", 403);
  const audience = validateMeetClientRecipients([user.email]);
  if (!audience.ok || audience.recipients[0].includes("#ext#")) throw new PacketAccessError("Your sign-in account needs a valid email address before it can receive the packet.", 422);
  return audience.recipients[0];
}

export function requireAssessorEmailCapacity(inventory: MeetClientAttachmentInventory) {
  if (meetClientAttachmentDeliveryMode(inventory.files) === "draft_upload" && !getGraphMailReadiness().largeAttachmentDeliveryConfigured) throw new PacketAccessError("Alamo Admissions needs its large-file email setup completed for this packet. Ask the Pipeline administrator to finish the mailbox attachment setup. No email was sent.", 503);
}

export async function prepareAssessorEmail(input: {
  user: PipelineUser; destination: string; audit: DeliveryAudit; referralVersion: number; packetRevision: string;
  recipients: string[]; ccRecipients: string[]; inventory: MeetClientAttachmentInventory;
  summary: MeetClientSummary; preparedBy: string; message: MeetClientMessage;
}) {
  const { audit } = input;
  let saved = false, sending = false, accepted = false;
  const operation = { id: randomUUID(), expiresAt: Date.now() + 300_000 };
  try {
    const content = renderMeetClientEmail(input.summary, input.preparedBy, audit.deliveryId, input.inventory.files.map(file => file.name), input.message);
    const packet = await prepareAdmissionPacketRecord({ id: audit.deliveryId, referralId: audit.referralId,
      assessmentId: audit.assessmentId, assessmentVersion: audit.assessmentVersion,
      recipients: [...input.recipients, ...input.ccRecipients], inventory: input.inventory,
      message: { subject: content.subject, body: content.text },
      outlook: { transport: "assessor_email", ownerId: input.user.id, mailbox: input.destination,
        status: "preparing", audit, referralVersion: input.referralVersion, packetRevision: input.packetRevision,
        toRecipients: input.recipients, ccRecipients: input.ccRecipients, deliveryMode: "attachments", operation } });
    saved = true;
    const attachments = await Promise.all(packet.files.map(file => packetMailAttachment(file, packet.referralId)));
    const source = await currentSource(packet);
    if (source.issue) throw new PacketAccessError(source.issue + " Review the handoff again before emailing it.", 409);
    // Reserve before contacting Microsoft. A lost response never triggers an automatic resend.
    sending = true;
    const result = await sendMeetClientMail({ recipients: [input.destination], ccRecipients: [],
      summary: input.summary, preparedBy: input.preparedBy, deliveryId: audit.deliveryId, message: input.message,
      attachments });
    accepted = true;
    await completeMeetClientDelivery({ ...audit, recipientCount: 1, recipientDomains: [input.destination.split("@")[1]] }, "assessor_emailed");
    return await withAdmissionPacket(packet.id, value => {
      if (!value?.outlook) throw new PacketAccessError("Packet status is temporarily unavailable.", 503);
      value.outlook.status = "draft";
      value.outlook.acceptedAt = result.acceptedAt;
      value.outlook.attachmentsReady = true;
      value.outlook.note = "Alamo Admissions accepted the email to your inbox. Forward it with all attachments to the reviewed To / Cc list, then confirm here.";
      return outlookDraftView(value);
    });
  } catch (error) {
    const rejected = !accepted && (!sending || definitelyRejected(error));
    if (saved) await withAdmissionPacket(audit.deliveryId, packet => {
      if (!packet?.outlook) return;
      packet.outlook.status = rejected ? "discarded" : "unconfirmed";
      packet.outlook.note = "Delivery has not been confirmed. Check your inbox and junk folder before deciding whether to prepare another email.";
    }).catch(() => undefined);
    if (rejected) await completeMeetClientDelivery(audit, "failed", "assessor_email_not_sent", true);
    if (error instanceof PacketAccessError) throw error;
    throw new PacketAccessError(rejected ? "Alamo Admissions could not send the packet. No email was sent. Try again shortly."
      : "The email outcome is uncertain. Check your inbox and junk folder; do not send another copy until you have checked.", 503);
  } finally {
    if (saved) await withAdmissionPacket(audit.deliveryId, packet => {
      if (packet?.outlook?.operation?.id === operation.id) delete packet.outlook.operation;
    }).catch(() => undefined);
  }
}

function definitelyRejected(error: unknown) {
  return error instanceof GraphMailDeliveryError && (error.code.startsWith("attachment_source_")
    || ["mail_preparation_failed", "large_attachment_permission_missing", "admission_packet_empty"].includes(error.code)
    || Boolean(error.status && [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status)));
}

export async function updateAssessorEmail(packetId: string, referralId: number, user: PipelineUser, action: "received" | "forwarded" | "replace") {
  assessorEmailDestination(user);
  const existing = await withAdmissionPacket(packetId, packet => {
    if (!packet?.outlook || packet.referralId !== referralId || packet.outlook.transport !== "assessor_email" || packet.outlook.ownerId !== user.id) throw new PacketAccessError("Packet not found.", 404);
    return structuredClone(packet);
  });
  if (["sent", "discarded"].includes(existing.outlook!.status)) return outlookDraftView(existing);
  return withDraftOperation(packetId, async packet => {
    const draft = packet.outlook!;
    if (action === "replace") {
      // An inbox copy cannot be recalled. Explicit review closes this attempt
      // without certifying that the community received the handoff.
      await completeMeetClientDelivery(draft.audit, "failed", "assessor_closed_inbox_copy", true);
      return withAdmissionPacket(packetId, value => {
        value!.outlook!.status = "discarded";
        value!.events.push({ action: "meet_client_assessor_email_replaced", at: new Date().toISOString(), actorId: user.id, actorName: user.name });
        return outlookDraftView(value!);
      });
    }
    if (action === "received") return withAdmissionPacket(packetId, value => {
      value!.outlook!.status = "draft";
      value!.outlook!.note = "You confirmed receipt. Forward the email with all attachments to the reviewed To / Cc list, then confirm here.";
      value!.events.push({ action: "meet_client_assessor_email_receipt_confirmed", at: new Date().toISOString(), actorId: user.id, actorName: user.name });
      return outlookDraftView(value!);
    });
    if (draft.status !== "draft") throw new PacketAccessError("Confirm the packet arrived in your inbox before recording that you forwarded it.", 409);
    const current = await getAssessment(packet.assessmentId);
    const alreadyRecorded = Boolean(current?.meet_client_sent_at && current.meet_client_sent_version === packet.assessmentVersion);
    if (!alreadyRecorded) {
      const source = await currentSource(packet);
      if (source.issue) return withAdmissionPacket(packetId, value => {
        value!.outlook!.status = "needs_review";
        value!.outlook!.note = source.issue + " Review an updated handoff; the earlier inbox copy cannot be recalled.";
        return outlookDraftView(value!);
      });
      await deliverAssessmentPacket(packet.assessmentId, packet.assessmentVersion, async () => ({ acceptedAt: new Date().toISOString() }));
    }
    await completeMeetClientDelivery(draft.audit, "sent");
    return withAdmissionPacket(packetId, value => {
      value!.outlook!.status = "sent";
      value!.outlook!.note = "You confirmed forwarding the message and all files to the reviewed recipients.";
      value!.events.push({ action: "meet_client_forwarding_confirmed_by_assessor", at: new Date().toISOString(), actorId: user.id, actorName: user.name });
      return outlookDraftView(value!);
    });
  });
}
