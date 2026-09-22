import "server-only";
import { deliverAssessmentPacket, getAssessment } from "@/lib/assessment/assessment-store";
import { completeMeetClientDelivery, type DeliveryAudit } from "@/lib/pipeline/meet-client-delivery-audit";
import { getReferralWorkflowSnapshot } from "@/lib/pipeline/workflow-store";
import { buildAssessmentSummaryReport, type MeetClientSummary } from "@/lib/assessment/assessment-summary";
import { getMeetClientAttachmentInventory, type MeetClientAttachmentInventory } from "./meet-client-attachments";
import type { MeetClientMessage } from "./meet-client-message";
import { admissionPacketUrl, prepareAdmissionPacketLink } from "./admission-packet-files";
import { findWorkspaceOutlookDraft, withAdmissionPacket, PacketAccessError, type AdmissionPacket } from "./admission-packet-store";
import { createOutlookMessage, deleteOutlookDraft, findOutlookMessage, outlookAudience, outlookMessageLink, OutlookMailError, type OutlookMessage, type OutlookMailbox } from "./outlook-mail";
import { renderMeetClientEmail } from "./meet-client-email-template";
import type { OutlookDraftView } from "./outlook-draft-contract";

type Mailbox = OutlookMailbox;
export function outlookDraftView(packet: AdmissionPacket): OutlookDraftView {
  const draft = packet.outlook!;
  return { packet_id: packet.id, status: draft.status, mailbox: draft.mailbox, web_link: draft.webLink,
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
  let creating = false;
  try {
    const content = renderMeetClientEmail(input.summary, input.preparedBy, audit.deliveryId, [], input.message);
    const packetUrl = await prepareAdmissionPacketLink({ id: audit.deliveryId, referralId: audit.referralId,
      assessmentId: audit.assessmentId, assessmentVersion: audit.assessmentVersion,
      recipients: [...input.recipients, ...input.ccRecipients], inventory: input.inventory,
      message: { subject: content.subject, body: content.text }, requestUrl: input.requestUrl,
      outlook: { ownerId: mailbox.id, mailboxId: mailbox.graphId ?? mailbox.id, mailbox: mailbox.email,
        toRecipients: input.recipients, ccRecipients: input.ccRecipients,
        status: "preparing", audit, referralVersion: input.referralVersion, packetRevision: input.packetRevision } });
    const linked = renderMeetClientEmail(input.summary, input.preparedBy, audit.deliveryId, input.inventory.files.map((file) => file.name), input.message, { packetUrl });
    const packet = await ownedDraft(audit.deliveryId, audit.referralId, mailbox);
    const { issue } = await currentSource(packet);
    if (issue) throw new PacketAccessError(issue, 409);
    creating = true;
    const message = await createOutlookMessage(mailbox.token, { deliveryId: audit.deliveryId, recipients: input.recipients, ccRecipients: input.ccRecipients, ...linked });
    if (!message.id || message.isDraft !== true) throw new OutlookMailError(502);
    return await updateDraft(audit.deliveryId, (packet) => {
      packet.outlook!.status = "draft"; packet.outlook!.messageId = message.id; packet.outlook!.webLink = outlookMessageLink(message);
      packet.events.push({ action: "meet_client_outlook_draft_prepared", at: new Date().toISOString(), actorId: audit.actorId, actorName: audit.actorName });
    });
  } catch (error) {
    const rejected = outlookCreationRejected(creating, error);
    await updateDraft(audit.deliveryId, (packet) => {
      packet.outlook!.status = rejected ? "discarded" : "unconfirmed";
      if (rejected) packet.revokedAt = new Date().toISOString();
    }).catch(() => undefined);
    // A missing creation response can still leave a draft in Outlook. Retain
    // its reservation and recover by the private delivery correlation property.
    if (rejected) await completeMeetClientDelivery(audit, "failed", "outlook_draft_not_created", true);
    if (error instanceof PacketAccessError || error instanceof OutlookMailError) throw error;
    throw new PacketAccessError("The Outlook draft could not be confirmed. Check draft status before trying again.", 503);
  }
}
function outlookCreationRejected(creating: boolean, error: unknown) {
  return !creating || (error instanceof OutlookMailError && error.definitive);
}

export async function checkOutlookHandoff(packetId: string, referralId: number, mailbox: Mailbox, requestUrl: string) {
  const packet = await ownedDraft(packetId, referralId, mailbox);
  if (["sent", "discarded"].includes(packet.outlook!.status)) return outlookDraftView(packet);
  const message = await findOutlookMessage(mailbox.token, packet.id, packet.outlook!.messageId);
  if (!message) return updateDraft(packet.id, (value) => {
    value.outlook!.status = "unconfirmed";
    value.outlook!.note = "The draft was not found in Outlook. Remove this draft in Pipeline before preparing a replacement.";
  });
  if (message.isDraft) return updateDraft(packet.id, (value) => {
    value.outlook!.status = "draft"; value.outlook!.messageId = message.id; value.outlook!.webLink = outlookMessageLink(message);
    value.outlook!.note = "Saved in Outlook. Review it there and send when ready.";
  });
  return reconcileSentPacket(packet, message, requestUrl);
}
export async function discardOutlookHandoff(packetId: string, referralId: number, mailbox: Mailbox, requestUrl: string) {
  const packet = await ownedDraft(packetId, referralId, mailbox);
  if (packet.outlook!.status === "sent") throw new PacketAccessError("This handoff was already sent. Use packet access controls to revoke downloads.", 409);
  const message = await findOutlookMessage(mailbox.token, packet.id, packet.outlook!.messageId);
  if (message && !message.isDraft) {
    if (packet.outlook!.status !== "needs_review") return reconcileSentPacket(packet, message, requestUrl);
    return closeSentReview(packet, message, mailbox.id);
  }
  // Revoke the files first: even a restored or concurrently sent Outlook draft
  // must not retain access after the user explicitly removes this handoff.
  await updateDraft(packet.id, (value) => { value.revokedAt = new Date().toISOString(); value.recipients.forEach((recipient) => { recipient.sessions = []; delete recipient.challenge; }); });
  if (message) await deleteOutlookDraft(mailbox.token, message.id);
  await completeMeetClientDelivery(packet.outlook!.audit, "failed", "outlook_draft_removed_by_owner", true);
  return updateDraft(packet.id, (value) => {
    value.outlook!.status = "discarded"; delete value.outlook!.webLink;
    value.events.push({ action: "meet_client_outlook_draft_removed", at: new Date().toISOString(), actorId: mailbox.id });
  });
}

async function reconcileSentPacket(packet: AdmissionPacket, message: OutlookMessage, requestUrl: string) {
  const expected = packet.recipients.map((recipient) => recipient.email).sort();
  const audience = outlookAudience(message);
  const packetUrl = admissionPacketUrl(packet.id, requestUrl);
  const content = message.body?.content ?? "";
  if (!message.sentDateTime || !Number.isFinite(Date.parse(message.sentDateTime))) return needsReview(packet, "Outlook has not confirmed when this email was sent.");
  if (JSON.stringify(audience) !== JSON.stringify(expected)) return needsReview(packet, "Recipients changed in Outlook. Downloads are paused; review the recipients in Pipeline before preparing a new handoff.", true);
  if (!content.includes(packetUrl)) return needsReview(packet, "The email was sent without its packet link. Review the handoff before continuing.");
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
