import "server-only";
import { randomUUID } from "node:crypto";
import { deliverAssessmentPacket, getAssessment } from "@/lib/assessment/assessment-store";
import { completeMeetClientDelivery, type DeliveryAudit } from "@/lib/pipeline/meet-client-delivery-audit";
import { getReferralWorkflowSnapshot } from "@/lib/pipeline/workflow-store";
import { buildAssessmentSummaryReport, type MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { getMeetClientAttachmentInventory, type MeetClientAttachmentInventory } from "./meet-client-attachments";
import type { MeetClientMessage } from "./meet-client-message";
import { admissionPacketUrl, prepareAdmissionPacketRecord } from "./admission-packet-files";
import { findWorkspaceOutlookDraft, withAdmissionPacket, PacketAccessError, type AdmissionPacket } from "./admission-packet-store";
import { createOutlookMessage, updateOutlookMessage, deleteOutlookDraft, findOutlookMessage, outlookAudience, outlookMessageLink, OutlookMailError, type OutlookMessage, type OutlookMailbox } from "./outlook-mail";
import { renderMeetClientEmail } from "./meet-client-email-template";
import type { OutlookDraftView } from "./outlook-draft-contract";

import { ensureOutlookAttachments, outlookAttachmentsMatch } from "./outlook-attachments";

type Mailbox = OutlookMailbox;
export function outlookDraftView(packet: AdmissionPacket): OutlookDraftView {
  const draft = packet.outlook!;
  return { delivery_method: draft.transport, accepted_at: draft.acceptedAt, packet_id: packet.id, status: draft.status, mailbox: draft.mailbox, web_link: draft.deliveryMode === "attachments" && !draft.attachmentsReady ? undefined : draft.webLink,
    prepared_at: packet.createdAt, assessment_version: packet.assessmentVersion, file_count: packet.files.length, message: draft.note,
    to_recipients: draft.toRecipients, cc_recipients: draft.ccRecipients };
}
export async function workspaceOutlookState(referralId: number, ownerId: string) {
  const packet = await findWorkspaceOutlookDraft(referralId);
  if (!packet?.outlook) return { draft: null, occupied: false };
  if (packet.outlook.ownerId !== ownerId) return { draft: null, occupied: !["sent", "discarded"].includes(packet.outlook.status) };
  return { draft: outlookDraftView(packet), occupied: false };
}
export async function prepareOutlookHandoff(input: {
  mailbox: Mailbox; audit: DeliveryAudit; referralVersion: number; packetRevision: string;
  recipients: string[]; ccRecipients: string[]; inventory: MeetClientAttachmentInventory;
  summary: MeetClientSummary; preparedBy: string; message: MeetClientMessage; requestUrl: string;
}) {
  const { audit, mailbox } = input;
  let creating = false, created = false, saved = false;
  const operation = { id: randomUUID(), expiresAt: Date.now() + 300_000 };
  try {
    const content = renderMeetClientEmail(input.summary, input.preparedBy, audit.deliveryId, input.inventory.files.map((file) => file.name), input.message);
    const packet = await prepareAdmissionPacketRecord({ id: audit.deliveryId, referralId: audit.referralId,
      assessmentId: audit.assessmentId, assessmentVersion: audit.assessmentVersion,
      recipients: [...input.recipients, ...input.ccRecipients], inventory: input.inventory,
      message: { subject: content.subject, body: content.text },
      outlook: { ownerId: mailbox.id, mailboxId: mailbox.graphId ?? mailbox.id, mailbox: mailbox.email,
        toRecipients: input.recipients, ccRecipients: input.ccRecipients,
        deliveryMode: "attachments", html: content.html, operation,
        status: "preparing", audit, referralVersion: input.referralVersion, packetRevision: input.packetRevision } });
    saved = true;
    const progress = draftProgress(packet.id, operation.id);
    await requireCurrentSource(packet);
    await progress();
    creating = true;
    // Withhold the audience until every attachment has been verified. A partial
    // draft stays recoverable but is not presented as a completed handoff.
    const message = await createOutlookMessage(mailbox.token, { deliveryId: audit.deliveryId,
      recipients: [], ccRecipients: [], subject: `Preparing attachments — ${content.subject}`,
      html: "<p>Attachments are still being prepared. Do not send this draft yet.</p>" });
    created = true;
    if (!message.id || message.isDraft !== true) throw new OutlookMailError(502);
    await updateDraft(packet.id, (value) => { value.outlook!.messageId = message.id; });
    return await finishDraftAttachments(packet, message, mailbox, progress);
  } catch (error) {
    const rejected = outlookCreationRejected(creating, created, error);
    if (saved) await updateDraft(audit.deliveryId, (packet) => {
      packet.outlook!.status = rejected ? "discarded" : "unconfirmed";
      packet.outlook!.note = rejected ? undefined : "Preparation is not finished. Resume this draft to attach the remaining files.";
      if (rejected) packet.revokedAt = new Date().toISOString();
    }).catch(() => undefined);
    // Never release a reservation after creation: uploads or their responses may
    // fail independently. Recovery continues the same message without resending.
    if (rejected) await completeMeetClientDelivery(audit, "failed", "outlook_draft_not_created", true);
    if (error instanceof PacketAccessError || error instanceof OutlookMailError) throw error;
    throw new PacketAccessError("The Outlook draft could not be confirmed. Check draft status before trying again.", 503);
  } finally { if (saved) await releaseOperation(audit.deliveryId, operation.id); }
}

function outlookCreationRejected(creating: boolean, created: boolean, error: unknown) {
  return !created && (!creating || (error instanceof OutlookMailError && error.definitive));
}

export async function checkOutlookHandoff(packetId: string, referralId: number, mailbox: Mailbox, requestUrl: string) {
  const packet = await ownedDraft(packetId, referralId, mailbox);
  if (["sent", "discarded"].includes(packet.outlook!.status)) return outlookDraftView(packet);
  return withDraftOperation(packetId, async (current, progress) => {
    const message = await findOutlookMessage(mailbox.token, current.id, current.outlook!.messageId);
    if (!message) return updateDraft(current.id, (value) => {
      value.outlook!.status = "unconfirmed";
      value.outlook!.note = "The draft was not found in Outlook. Remove this draft before preparing a replacement.";
    });
    if (!message.isDraft) return reconcileSentPacket(current, message, requestUrl, mailbox.token, progress);
    if (current.outlook!.deliveryMode === "attachments" && !current.outlook!.attachmentsReady) {
      await requireCurrentSource(current);
      return finishDraftAttachments(current, message, mailbox, progress);
    }
    return updateDraft(current.id, (value) => {
      value.outlook!.status = "draft"; value.outlook!.messageId = message.id; value.outlook!.webLink = outlookMessageLink(message);
      value.outlook!.note = "Saved in Outlook. Review it there and send when ready.";
    });
  });
}
export async function discardOutlookHandoff(packetId: string, referralId: number, mailbox: Mailbox, requestUrl: string) {
  const packet = await ownedDraft(packetId, referralId, mailbox);
  if (packet.outlook!.status === "sent") throw new PacketAccessError("This handoff was already sent. Sent emails and their attachments cannot be recalled here.", 409);
  if (packet.outlook!.status === "discarded") return outlookDraftView(packet);
  return withDraftOperation(packetId, async (current, progress) => {
    const message = await findOutlookMessage(mailbox.token, current.id, current.outlook!.messageId);
    if (message && !message.isDraft) {
      if (current.outlook!.status !== "needs_review") return reconcileSentPacket(current, message, requestUrl, mailbox.token, progress);
      return closeSentReview(current, message, mailbox.id);
    }
    // Legacy linked packets lose access before removal; attachment-only records
    // never expose downloads. Already sent attachment copies cannot be revoked.
    await updateDraft(current.id, (value) => { value.revokedAt = new Date().toISOString(); value.recipients.forEach((recipient) => { recipient.sessions = []; delete recipient.challenge; }); });
    if (message) await deleteOutlookDraft(mailbox.token, message.id);
    await completeMeetClientDelivery(current.outlook!.audit, "failed", "outlook_draft_removed_by_owner", true);
    return updateDraft(current.id, (value) => {
      value.outlook!.status = "discarded"; delete value.outlook!.webLink;
      value.events.push({ action: "meet_client_outlook_draft_removed", at: new Date().toISOString(), actorId: mailbox.id });
    });
  });
}

async function finishDraftAttachments(packet: AdmissionPacket, message: OutlookMessage, mailbox: Mailbox, progress: ReturnType<typeof draftProgress>) {
  await ensureOutlookAttachments(mailbox.token, message.id, packet, progress);
  await requireCurrentSource(packet);
  await progress();
  const updated = await updateOutlookMessage(mailbox.token, message.id, packet.message.subject, packet.outlook!.html!, packet.outlook!.toRecipients ?? [], packet.outlook!.ccRecipients ?? []);
  if (updated.isDraft !== true) throw new PacketAccessError("Outlook changed this message during preparation. Check its status before continuing.", 409);
  return updateDraft(packet.id, (value) => {
    value.outlook!.status = "draft"; value.outlook!.messageId = message.id;
    value.outlook!.attachmentsReady = true; value.outlook!.webLink = outlookMessageLink(updated) ?? outlookMessageLink(message);
    value.outlook!.note = "Message and all files saved in Outlook Drafts. Open Outlook to send.";
    value.events.push({ action: "meet_client_outlook_draft_prepared", at: new Date().toISOString(), actorId: value.outlook!.audit.actorId, actorName: value.outlook!.audit.actorName });
  });
}
async function requireCurrentSource(packet: AdmissionPacket) {
  const { issue } = await currentSource(packet);
  if (issue) throw new PacketAccessError(issue, 409);
}

type DraftProgress = (fileId?: string, hash?: string) => Promise<void>;
export async function withDraftOperation(packetId: string, run: (packet: AdmissionPacket, progress: DraftProgress) => Promise<OutlookDraftView>) {
  const operation = { id: randomUUID(), expiresAt: Date.now() + 300_000 };
  const packet = await withAdmissionPacket(packetId, (value) => {
    if (!value?.outlook) throw new PacketAccessError("Outlook draft not found.", 404);
    if (value.outlook.operation && value.outlook.operation.expiresAt > Date.now()) throw new PacketAccessError("This draft is still being prepared or checked. Try again when it finishes.", 409);
    if (["sent", "discarded"].includes(value.outlook.status)) throw new PacketAccessError("The draft status changed. Refresh before continuing.", 409);
    value.outlook.operation = operation;
    return structuredClone(value);
  });
  try { return await run(packet, draftProgress(packetId, operation.id)); }
  finally { await releaseOperation(packetId, operation.id); }
}
function draftProgress(packetId: string, operationId: string): DraftProgress {
  return async (fileId, hash) => {
    await withAdmissionPacket(packetId, (value) => {
      if (!value?.outlook || value.outlook.operation?.id !== operationId || ["sent", "discarded"].includes(value.outlook.status)) throw new PacketAccessError("The draft changed. Check its status before continuing.", 409);
      value.outlook.operation.expiresAt = Date.now() + 300_000;
      if (fileId && hash) { value.outlook.attachmentHashes ??= {}; value.outlook.attachmentHashes[fileId] = hash; }
    });
  };
}
async function releaseOperation(packetId: string, operationId: string) {
  await withAdmissionPacket(packetId, (value) => {
    if (value?.outlook?.operation?.id === operationId) delete value.outlook.operation;
  });
}

async function reconcileSentPacket(packet: AdmissionPacket, message: OutlookMessage, requestUrl: string, token: string, progress: DraftProgress) {
  const expected = packet.recipients.map((recipient) => recipient.email).sort();
  const audience = outlookAudience(message);
  if (!message.sentDateTime || !Number.isFinite(Date.parse(message.sentDateTime))) return needsReview(packet, "Outlook has not confirmed when this email was sent.");
  if (JSON.stringify(audience) !== JSON.stringify(expected)) return needsReview(packet, "Recipients changed in Outlook. Review the sent email before completing this handoff.", true);
  const attachmentIssue = await sentAttachmentIssue(packet, message, requestUrl, token, progress);
  if (attachmentIssue) return needsReview(packet, attachmentIssue);
  const { assessment, issue } = await currentSource(packet);
  if (assessmentWasSent(assessment, packet)) return finishSentPacket(packet, message);
  if (issue) return needsReview(packet, `Outlook sent this email. ${issue} Review the workspace before completing the handoff.`);
  try {
    await deliverAssessmentPacket(packet.assessmentId, packet.assessmentVersion, async () => ({ acceptedAt: message.sentDateTime! }));
  } catch {
    const current = await getAssessment(packet.assessmentId);
    if (assessmentWasSent(current, packet)) return finishSentPacket(packet, message);
    return needsReview(packet, "Outlook sent this email, but the assessment changed or its saved status could not be confirmed. Review the workspace; do not resend this draft.");
  }
  return finishSentPacket(packet, message);
}
export async function currentSource(packet: AdmissionPacket) {
  const [snapshot, assessment] = await Promise.all([getReferralWorkflowSnapshot(packet.referralId), getAssessment(packet.assessmentId)]);
  const draft = packet.outlook!;
  if (snapshot?.referral.version !== draft.referralVersion || snapshot.decision?.decisionId !== draft.audit.decisionId || snapshot.decision?.outcome !== "accepted") return { assessment, issue: "Admission details changed after this draft was prepared." };
  if (!assessment?.signed_at || assessment.version !== packet.assessmentVersion) return { assessment, issue: "The assessment changed after this draft was prepared." };
  const referral = { ...snapshot.referral, requirements: snapshot.work_items };
  const inventory = await getMeetClientAttachmentInventory(referral, { report: buildAssessmentSummaryReport(assessment, referral) });
  return { assessment, issue: !inventory.ready || inventory.revision !== draft.packetRevision ? "The packet files changed after this draft was prepared." : null };
}
async function finishSentPacket(packet: AdmissionPacket, message: OutlookMessage) {
  if (packet.outlook!.status !== "sent") await completeMeetClientDelivery(packet.outlook!.audit, "sent");
  return updateDraft(packet.id, (value) => {
    value.outlook!.status = "sent"; value.outlook!.note = "Sent from Outlook. The handoff is recorded in Pipeline.";
    value.message = { subject: message.subject ?? value.message.subject, body: message.body?.content ?? value.message.body };
  });
}
async function needsReview(packet: AdmissionPacket, note: string, revoke = false) {
  return updateDraft(packet.id, (value) => {
    value.outlook!.status = "needs_review"; value.outlook!.note = note;
    if (revoke) { value.revokedAt = new Date().toISOString(); value.recipients.forEach((recipient) => { recipient.sessions = []; delete recipient.challenge; }); }
  });
}
async function ownedDraft(packetId: string, referralId: number, mailbox: Mailbox) {
  return withAdmissionPacket(packetId, (packet) => {
    if (!packet?.outlook || packet.referralId !== referralId || packet.outlook.ownerId !== mailbox.id) throw new PacketAccessError("Outlook draft not found.", 404);
    if (packet.outlook.transport === "assessor_email") throw new PacketAccessError("This packet was emailed to the assessor. Use its inbox handoff controls.", 409);
    if ((packet.outlook.mailboxId ?? packet.outlook.ownerId).toLowerCase() !== (mailbox.graphId ?? mailbox.id).toLowerCase()) throw new PacketAccessError("Reconnect the Outlook mailbox used to prepare this draft.", 403);
    return structuredClone(packet);
  });
}
async function updateDraft(packetId: string, apply: (packet: AdmissionPacket) => void) {
  return withAdmissionPacket(packetId, (packet) => {
    if (!packet?.outlook) throw new PacketAccessError("Outlook draft not found.", 404);
    if (!["sent", "discarded"].includes(packet.outlook.status)) apply(packet);
    return outlookDraftView(packet);
  });
}

async function closeSentReview(packet: AdmissionPacket, message: OutlookMessage, ownerId: string) {
  if (!message.sentDateTime || !Number.isFinite(Date.parse(message.sentDateTime))) throw new PacketAccessError("Outlook has not confirmed sending. Check sent status again before replacing this handoff.", 409);
  await updateDraft(packet.id, (value) => {
    value.revokedAt = new Date().toISOString();
    value.recipients.forEach((recipient) => { recipient.sessions = []; delete recipient.challenge; });
    value.events.push({ action: "meet_client_outlook_sent_review_acknowledged", at: new Date().toISOString(), actorId: ownerId });
  });
  // Record the external send without certifying a changed assessment. Explicit
  // review closes this attempt and permits a fresh, separately reviewed handoff.
  await completeMeetClientDelivery(packet.outlook!.audit, "sent_needs_review", "owner_acknowledged_outlook_changes");
  return updateDraft(packet.id, (value) => { value.outlook!.status = "discarded"; delete value.outlook!.webLink; });
}

function assessmentWasSent(assessment: Awaited<ReturnType<typeof getAssessment>>, packet: AdmissionPacket) {
  return assessment?.meet_client_sent_version === packet.assessmentVersion && Boolean(assessment.meet_client_sent_at);
}

async function sentAttachmentIssue(packet: AdmissionPacket, message: OutlookMessage, requestUrl: string, token: string, progress: DraftProgress) {
  if (packet.outlook!.deliveryMode === "attachments") {
    if (!packet.outlook!.attachmentsReady || !await outlookAttachmentsMatch(token, message.id, packet, progress)) return "Outlook sent this email with missing or changed attachments. Review the sent email before completing the handoff.";
  } else if (!(message.body?.content ?? "").includes(admissionPacketUrl(packet.id, requestUrl))) return "The email was sent without its packet link. Review the handoff before continuing.";
  return null;
}
