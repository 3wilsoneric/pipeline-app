import "server-only";
import { createHash } from "node:crypto";
import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { deliverAssessmentPacket } from "@/lib/assessment/assessment-store";
import { getActiveWorkspaceMember } from "@/lib/pipeline/workspace-members";
import { completeMeetClientDelivery, reserveMeetClientDelivery, type DeliveryAudit } from "@/lib/pipeline/meet-client-delivery-audit";
import { getAzureBlobUploadSigner } from "@/lib/extraction/azure-blob";
import { getDocumentFileMetadata } from "@/lib/extraction/document-assets";
import { isDocumentContentAvailable } from "@/lib/extraction/document-access-policy";
import { findPreparedCommunication, PacketAccessError, withAdmissionPacket, type AdmissionPacket, type PacketFile } from "./admission-packet-store";
import { packetMailAttachment, prepareAdmissionPacketRecord } from "./admission-packet-files";
import { getGraphMailReadiness, GraphMailDeliveryError, sendMeetClientMail, validateMeetClientRecipients } from "./microsoft-graph-mail";
import { renderMeetClientEmail } from "./meet-client-email-template";
import { requireAssessorEmailCapacity } from "./assessor-email-handoff";
import type { MeetClientAttachmentInventory, MeetClientMailAttachment } from "./meet-client-attachments";
import type { MeetClientMessage } from "./meet-client-message";
import type { CommunicationView } from "./communication-contract";

type Input = {
  user: PipelineUser; assessment: PipelineAssessmentRecord; audit: DeliveryAudit;
  referralVersion: number; packetRevision: string; recipients: string[]; ccRecipients: string[];
  inventory: MeetClientAttachmentInventory; summary: MeetClientSummary; preparedBy: string; message: MeetClientMessage;
};

export async function directHandoffAssessor(assessment: PipelineAssessmentRecord, user: PipelineUser) {
  const id = assessment.assessor_id || assessment.signed_by?.id;
  const member = id === user.id ? { email: user.email, display_name: user.name } : id ? await getActiveWorkspaceMember(id) : null;
  const validated = validateMeetClientRecipients([member?.email]);
  if (!id || !member || !validated.ok || validated.recipients[0].includes("#ext#")) {
    throw new PacketAccessError("Add the assessor’s work email to their account before preparing this handoff. It will appear in Cc and Reply-To.", 422);
  }
  return { id, name: member.display_name, email: validated.recipients[0] };
}

function requestKey(input: Input, assessor: Awaited<ReturnType<typeof directHandoffAssessor>>) {
  return createHash("sha256").update(JSON.stringify({
    referralId: input.audit.referralId, referralVersion: input.referralVersion,
    assessmentId: input.assessment.assessment_id, assessmentVersion: input.assessment.version,
    decisionId: input.audit.decisionId, reviewId: input.audit.reviewId, reviewVersion: input.audit.reviewVersion,
    packetRevision: input.packetRevision, to: input.recipients, cc: input.ccRecipients,
    message: input.message, assessor, from: getGraphMailReadiness().sender,
  })).digest("hex");
}

export function communicationView(packet: AdmissionPacket, detail = false): CommunicationView {
  const c = packet.communication!;
  return { id: packet.id, referralId: packet.referralId, clientName: c.clientName, community: c.community,
    admissionDate: c.admissionDate, createdAt: packet.createdAt, submittedAt: c.submittedAt,
    status: c.status === "sending" && Date.now() - Date.parse(c.audit.createdAt) > 300_000 ? "unconfirmed" : c.status,
    from: c.from, to: c.to, cc: c.cc, replyTo: c.replyTo, assessorName: c.assessorName,
    preparedBy: c.preparedBy, assessmentVersion: packet.assessmentVersion, subject: packet.message.subject,
    ...(detail ? { html: c.html } : {}), note: c.note,
    files: packet.files.map(({ id, name, contentType, byteSize }) => ({ id, name, contentType, byteSize })) };
}

export async function ownedDirectHandoff(id: string, referralId: number, userId: string) {
  return withAdmissionPacket(id, packet => {
    if (!packet?.communication || packet.referralId !== referralId || packet.communication.ownerId !== userId) throw new PacketAccessError("Handoff not found.", 404);
    return structuredClone(packet);
  });
}

export async function prepareDirectHandoff(input: Input) {
  requireAssessorEmailCapacity(input.inventory);
  const assessor = await directHandoffAssessor(input.assessment, input.user);
  const key = requestKey(input, assessor);
  const existing = await findPreparedCommunication(input.audit.referralId, input.user.id, key);
  if (existing) return communicationView(existing, true);
  const cc = [...new Set([...input.ccRecipients, assessor.email])].filter(email => !input.recipients.includes(email));
  const audience = validateMeetClientRecipients([...input.recipients, ...cc]);
  if (!audience.ok) throw new PacketAccessError(audience.message, 422);
  const content = renderMeetClientEmail(input.summary, input.preparedBy, input.audit.deliveryId, input.inventory.files.map(file => file.name), input.message);
  const audit = { ...input.audit, provider: "admissions_email", recipientCount: audience.recipients.length,
    recipientDomains: [...new Set(audience.recipients.map(email => email.split("@")[1]))] };
  const packet = await prepareAdmissionPacketRecord({ id: audit.deliveryId, referralId: audit.referralId,
    assessmentId: audit.assessmentId, assessmentVersion: audit.assessmentVersion,
    recipients: [], inventory: input.inventory, message: { subject: content.subject, body: content.text },
    communication: { status: "preparing", ownerId: input.user.id, assessorId: assessor.id, assessorName: assessor.name,
      clientName: input.summary.name, community: input.summary.community, admissionDate: input.summary.admissionDate,
      from: getGraphMailReadiness().sender, to: input.recipients, cc, replyTo: assessor.email,
      html: content.html, preparedBy: input.preparedBy, requestKey: key, audit, originals: [], archiveObjects: [] } });
  try {
    // Register every destination before copying: retention can clean up a process
    // interrupted mid-copy. Original uploads may later be replaced or withdrawn.
    const destinations = packet.files.filter(file => file.source.kind === "blob").map(file => ({
      container: process.env.AZURE_STORAGE_CONTAINER_ARTIFACTS?.trim() || "artifacts",
      key: `communications/${packet.referralId}/${packet.id}/${encodeURIComponent(file.id)}`,
    }));
    await withAdmissionPacket(packet.id, stored => {
      stored!.communication!.originals = packet.files;
      stored!.communication!.archiveObjects = destinations;
    });
    let archiveIndex = 0;
    const archived: PacketFile[] = [];
    for (const file of packet.files) {
      if (file.source.kind === "generated") { archived.push(file); continue; }
      const destination = destinations[archiveIndex++];
      const copied = await getAzureBlobUploadSigner().archiveBlob(file.source, destination);
      if (!copied.etag || copied.byteSize !== file.byteSize) throw new PacketAccessError("A file could not be preserved. No email was sent; prepare the preview again.", 503);
      archived.push({ ...file, archived: true, source: { kind: "blob", ...destination, etag: copied.etag } });
    }
    return await withAdmissionPacket(packet.id, stored => {
      stored!.files = archived;
      stored!.communication!.status = "ready";
      stored!.events.push({ action: "meet_client_email_preview_saved", at: new Date().toISOString(), actorId: input.user.id, actorName: input.user.name });
      return communicationView(stored!, true);
    });
  } catch (error) {
    await withAdmissionPacket(packet.id, stored => { stored!.communication!.status = "not_sent"; stored!.communication!.note = "The preview could not be prepared. No email was sent."; });
    throw error;
  }
}

export async function communicationAttachment(file: PacketFile, referralId: number): Promise<MeetClientMailAttachment> {
  if (!file.archived || file.source.kind !== "blob") return packetMailAttachment(file, referralId);
  // A subsequent adverse scan still prevents access to the archived original.
  const metadata = await getDocumentFileMetadata(file.id, { limit: 1, includeDeleted: true });
  if (metadata && !isDocumentContentAvailable(metadata.malware_scan_status)) throw new PacketAccessError("This attachment is unavailable because its safety status changed.", 409);
  return { documentId: file.id, name: file.name, contentType: file.contentType, byteSize: file.byteSize,
    sourceUrl: await getAzureBlobUploadSigner().createReadUrl(file.source.container, file.source.key, 900), sourceHeaders: { "If-Match": file.source.etag } };
}

export async function sendDirectHandoff(id: string, input: Input, beforeSend: () => Promise<void>) {
  const existing = await ownedDirectHandoff(id, input.audit.referralId, input.user.id);
  if (existing.communication!.status === "submitted") return communicationView(existing, true);
  const assessor = await directHandoffAssessor(input.assessment, input.user);
  if (existing.communication!.requestKey !== requestKey(input, assessor)) throw new PacketAccessError("The handoff changed after preview. Review the updated email before sending.", 409);
  const packet = await withAdmissionPacket(id, stored => {
    if (stored!.communication!.status !== "ready") throw new PacketAccessError("This handoff already has a send attempt. Open Email history to check its outcome.", 409);
    stored!.communication!.status = "sending";
    stored!.communication!.audit.createdAt = new Date().toISOString();
    return structuredClone(stored!);
  });
  const c = packet.communication!;
  let reserved = false, submitted = false, contacting = false;
  try {
    reserved = await reserveMeetClientDelivery(c.audit);
    if (!reserved) throw new PacketAccessError("Another handoff is in progress or already recorded. Check Email history before sending again.", 409);
    const attachments = await Promise.all(packet.files.map(file => communicationAttachment(file, packet.referralId)));
    // Verify the reviewed sources as well as the preserved attachment copies.
    await Promise.all(c.originals.map(async file => {
      if (file.source.kind !== "blob") return;
      await packetMailAttachment(file, packet.referralId);
      const current = await getAzureBlobUploadSigner().getBlobProperties(file.source.container, file.source.key);
      if (current.etag !== file.source.etag) throw new PacketAccessError("A file changed after preview. Review an updated handoff before sending.", 409);
    }));
    let result: Awaited<ReturnType<typeof sendMeetClientMail>> | undefined;
    try {
      await deliverAssessmentPacket(packet.assessmentId, packet.assessmentVersion, async () => {
        await beforeSend();
        contacting = true;
        result = await sendMeetClientMail({ recipients: c.to, ccRecipients: c.cc, replyTo: [c.replyTo],
          summary: input.summary, preparedBy: c.preparedBy, deliveryId: packet.id, attachments,
          preparedContent: { subject: packet.message.subject, html: c.html, text: packet.message.body } });
        submitted = true;
        // Record provider acceptance before assessment finalization, so a failed
        // finalization cannot turn an accepted send into an invitation to retry.
        await withAdmissionPacket(id, stored => {
          stored!.communication!.status = "submitted";
          stored!.communication!.submittedAt = result!.acceptedAt;
          stored!.events.push({ action: "meet_client_email_submitted", at: result!.acceptedAt, actorId: input.user.id, actorName: input.user.name });
        });
        return result;
      });
    } catch (error) { if (!submitted) throw error; }
    await completeMeetClientDelivery(c.audit, "sent").catch(() => undefined);
    return withAdmissionPacket(id, stored => {
      stored!.communication!.status = "submitted";
      stored!.communication!.submittedAt = result!.acceptedAt;
      return communicationView(stored!, true);
    });
  } catch (error) {
    const rejected = !submitted && (!contacting || definitelyRejected(error));
    await withAdmissionPacket(id, stored => {
      stored!.communication!.status = submitted ? "submitted" : rejected ? "not_sent" : "unconfirmed";
      stored!.communication!.note = submitted ? "Microsoft accepted this email. Never resend to repair history."
        : rejected ? "No email was sent. Review the handoff and try again."
        : "Microsoft’s response was not confirmed. Check the Admissions sending mailbox before starting another email.";
    }).catch(() => undefined);
    if (reserved && rejected) await completeMeetClientDelivery(c.audit, "failed", "direct_email_not_sent", true);
    else if (reserved && !submitted) await completeMeetClientDelivery(c.audit, "unconfirmed", "direct_email_unconfirmed").catch(() => undefined);
    if (error instanceof PacketAccessError) throw error;
    throw new PacketAccessError(submitted ? "Microsoft accepted the email; history is still syncing. Do not resend."
      : rejected ? "The email was not sent. Check the handoff and try again."
      : "The send outcome is uncertain. Open Email history; another copy has not been sent.", 503);
  }
}

function definitelyRejected(error: unknown) {
  return error instanceof GraphMailDeliveryError && (error.code.startsWith("attachment_source_")
    || ["mail_preparation_failed", "large_attachment_permission_missing", "admission_packet_empty"].includes(error.code)
    || Boolean(error.status && [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status)));
}
