import "server-only";
import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { deliverAssessmentPacket, getAssessment } from "@/lib/assessment/assessment-store";
import { getActiveWorkspaceMember } from "@/lib/pipeline/workspace-members";
import { completeMeetClientDelivery } from "@/lib/pipeline/meet-client-delivery-audit";
import { prepareAdmissionPacketLink, admissionPacketUrl } from "./admission-packet-files";
import { PacketAccessError, withAdmissionPacket, type AdmissionPacket } from "./admission-packet-store";
import { currentSource, outlookDraftView, type prepareOutlookHandoff } from "./outlook-handoff";
import { GraphMailDeliveryError, sendAssessorDraftMail, validateMeetClientRecipients } from "./microsoft-graph-mail";
import { renderMeetClientEmail } from "./meet-client-email-template";

export type AssessorDraftRecipient = { id: string; name: string; email: string };

export async function assessorDraftRecipient(assessment: PipelineAssessmentRecord | null | undefined): Promise<AssessorDraftRecipient | null> {
  const id = assessment?.signed_by?.id || assessment?.assessor_id;
  if (!id) return null;
  const member = await getActiveWorkspaceMember(id);
  const email = member?.email?.trim().toLowerCase() ?? "";
  // Resolve the signed assessor by identity, never by an editable name, browser
  // address, or a guessed reconstruction of a guest's #EXT# sign-in identifier.
  if (!member?.active || member.identity_status !== "entra_linked" || email.includes("#ext#") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { id: member.principal_id, name: member.display_name, email };
}

type PrepareInput = Omit<Parameters<typeof prepareOutlookHandoff>[0], "mailbox"> & { assessor: AssessorDraftRecipient };

export async function prepareAssessorEmailDraft(input: PrepareInput) {
  const { audit, assessor } = input;
  let sending = false;
  try {
    const audience = [...new Set([...input.recipients, ...input.ccRecipients, assessor.email])];
    const valid = validateMeetClientRecipients(audience);
    if (!valid.ok) throw new PacketAccessError(valid.message, 400);
    const cc = audience.filter((email) => !input.recipients.includes(email));
    const content = renderMeetClientEmail(input.summary, input.preparedBy, audit.deliveryId, [], input.message);
    const packetUrl = await prepareAdmissionPacketLink({ id: audit.deliveryId, referralId: audit.referralId,
      assessmentId: audit.assessmentId, assessmentVersion: audit.assessmentVersion, recipients: audience,
      inventory: input.inventory, message: { subject: content.subject, body: content.text }, requestUrl: input.requestUrl,
      outlook: { delivery: "email", ownerId: assessor.id, mailbox: assessor.email, status: "preparing", audit,
        referralVersion: input.referralVersion, packetRevision: input.packetRevision, forwardTo: input.recipients, forwardCc: cc } });
    const packet = await readEmailDraft(audit.deliveryId, audit.referralId);
    if (packet.revokedAt || packet.outlook!.status !== "preparing") throw new PacketAccessError("This draft was cancelled while it was being prepared.", 409);
    const { issue } = await currentSource(packet);
    if (issue) throw new PacketAccessError(issue, 409);
    const linked = renderMeetClientEmail(input.summary, input.preparedBy, audit.deliveryId, input.inventory.files.map((file) => file.name), input.message, { packetUrl });
    const html = renderAssessorDraftInstructions(linked.html, { assessor, to: input.recipients, cc, workspaceUrl: workspaceUrl(packet, input.requestUrl) });
    sending = true;
    await sendAssessorDraftMail({ email: assessor.email, subject: linked.subject, html, deliveryId: audit.deliveryId });
    const result = await changeEmailDraft(packet.id, (value) => {
      value.outlook!.status = "draft";
      value.outlook!.note = "Draft emailed to the assessor. The community handoff has not been confirmed.";
      value.events.push({ action: "meet_client_draft_emailed_to_assessor", at: new Date().toISOString(), actorId: audit.actorId, actorName: audit.actorName });
    });
    return { ...result, can_confirm: assessor.id === audit.actorId, can_replace: assessor.id === audit.actorId };
  } catch (error) {
    const rejected = !sending || definitelyRejected(error);
    await changeEmailDraft(audit.deliveryId, (packet) => {
      packet.outlook!.status = rejected ? "discarded" : "unconfirmed";
      packet.outlook!.note = rejected ? "No draft was emailed." : "Email acceptance could not be confirmed. Check the assessor's inbox before replacing this draft.";
      if (rejected) revoke(packet);
    }).catch(() => undefined);
    if (rejected) await completeMeetClientDelivery(audit, "failed", "assessor_draft_not_emailed", true);
    if (error instanceof PacketAccessError) throw error;
    throw new PacketAccessError(rejected ? "The draft could not be emailed. No email was sent; try again." : "The draft email outcome is uncertain. Check the assessor's inbox; no automatic resend was attempted.", 503);
  }
}

// Accepting the preparation email is distinct from the assessor attesting that
// they sent the reviewed handoff. Preserve that distinction in the audit trail.
export async function confirmAssessorEmailDraft(packetId: string, referralId: number, user: PipelineUser) {
  const result = await withAdmissionPacket(packetId, async (packet) => {
    assertEmailDraft(packet, referralId);
    const draft = packet.outlook!;
    assertConfirmationAllowed(packet, user);
    if (draft.status === "sent") return { ...outlookDraftView(packet), can_confirm: true };
    try {
      if (!wasFinalized(await getAssessment(packet.assessmentId), packet)) {
        const { issue } = await currentSource(packet);
        if (issue) throw new PacketAccessError(`${issue} Prepare an updated handoff before marking it complete.`, 409);
        await finalizeCurrentAssessment(packet);
      }
      await completeMeetClientDelivery({ ...draft.audit, provider: "assessor_confirmed_forward" }, "sent");
      draft.status = "sent";
      draft.confirmedAt = new Date().toISOString();
      draft.note = `Onward send confirmed by ${user.name}. Pipeline does not monitor the assessor's mailbox.`;
      packet.events.push({ action: "meet_client_onward_send_confirmed", at: draft.confirmedAt, actorId: user.id, actorName: user.name });
      return { ...outlookDraftView(packet), can_confirm: true };
    } catch (error) {
      if (error instanceof PacketAccessError && error.status === 409) {
        draft.status = "needs_review"; draft.note = error.message; revoke(packet);
        return { error: error.message };
      }
      throw error;
    }
  });
  if ("error" in result) throw new PacketAccessError(result.error ?? "The handoff changed. Review the latest draft.", 409);
  return result;
}

function assertConfirmationAllowed(packet: AdmissionPacket, user: PipelineUser) {
  const draft = packet.outlook!;
  if (user.delegation || draft.ownerId !== user.id) throw new PacketAccessError("The assessor who received this draft must confirm the onward send.", 403);
  if (draft.status === "sent") return;
  if (draft.status === "preparing") throw new PacketAccessError("The draft is still being prepared. Refresh its status before confirming the onward send.", 409);
  if (draft.status === "discarded" || packet.revokedAt || Date.parse(packet.expiresAt) <= Date.now()) throw new PacketAccessError("This draft's packet link is inactive. Prepare an updated handoff.", 409);
}

async function finalizeCurrentAssessment(packet: AdmissionPacket) {
  try {
    await deliverAssessmentPacket(packet.assessmentId, packet.assessmentVersion, async () => {
      const fresh = await currentSource(packet);
      if (fresh.issue) throw new PacketAccessError(fresh.issue, 409);
      return { acceptedAt: new Date().toISOString() };
    });
  } catch (error) {
    const fresh = await currentSource(packet);
    if (wasFinalized(fresh.assessment, packet)) return;
    if (fresh.issue) throw new PacketAccessError(fresh.issue, 409);
    throw error;
  }
}

export async function discardAssessorEmailDraft(packetId: string, referralId: number, user: PipelineUser) {
  const packet = await withAdmissionPacket(packetId, async (packet) => {
    assertEmailDraft(packet, referralId);
    if (user.delegation || (packet.outlook!.ownerId !== user.id && !user.roles.includes("admin"))) throw new PacketAccessError("The assessor or an administrator must replace this draft.", 403);
    if (wasFinalized(await getAssessment(packet.assessmentId), packet)) throw new PacketAccessError("The handoff is already complete. Use packet access controls to revoke downloads.", 409);
    if (packet.outlook!.status === "sent") throw new PacketAccessError("The handoff is already complete. Refresh its status.", 409);
    revoke(packet); packet.outlook!.status = "discarded";
    packet.events.push({ action: "meet_client_assessor_draft_replaced", at: new Date().toISOString(), actorId: user.id, actorName: user.name });
    return structuredClone(packet);
  });
  await completeMeetClientDelivery(packet.outlook!.audit, "failed", "assessor_draft_replaced", true);
  return { ...outlookDraftView({ ...packet, outlook: { ...packet.outlook!, status: "discarded" } }), can_confirm: false };
}

export async function readEmailDraft(packetId: string, referralId: number) {
  return withAdmissionPacket(packetId, (packet) => {
    assertEmailDraft(packet, referralId);
    return structuredClone(packet);
  });
}
function assertEmailDraft(packet: AdmissionPacket | null, referralId: number): asserts packet is AdmissionPacket {
  if (!packet || packet.referralId !== referralId || packet.outlook?.delivery !== "email") throw new PacketAccessError("Emailed draft not found.", 404);
}
async function changeEmailDraft(packetId: string, apply: (packet: AdmissionPacket) => void) {
  return withAdmissionPacket(packetId, (packet) => {
    if (!packet || packet.outlook?.delivery !== "email") throw new PacketAccessError("Emailed draft not found.", 404);
    if (!["sent", "discarded"].includes(packet.outlook.status)) apply(packet);
    return outlookDraftView(packet);
  });
}
function revoke(packet: AdmissionPacket) {
  packet.revokedAt = new Date().toISOString();
  packet.recipients.forEach((recipient) => { recipient.sessions = []; delete recipient.challenge; });
}
function wasFinalized(assessment: PipelineAssessmentRecord | null, packet: AdmissionPacket) {
  return assessment?.meet_client_sent_version === packet.assessmentVersion && Boolean(assessment.meet_client_sent_at);
}
function definitelyRejected(error: unknown) {
  return error instanceof GraphMailDeliveryError && (error.code === "mail_preparation_failed" || Boolean(error.status && [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status)));
}
function workspaceUrl(packet: AdmissionPacket, requestUrl: string) {
  const url = new URL(admissionPacketUrl(packet.id, requestUrl));
  url.pathname = url.pathname.replace(/admission-packet\/[^/]+$/, "");
  url.search = new URLSearchParams({ view: "referrals", screen: "packet", referralId: String(packet.referralId), workspaceView: "email" }).toString();
  return url.toString();
}
export function renderAssessorDraftInstructions(html: string, input: { assessor: AssessorDraftRecipient; to: string[]; cc: string[]; workspaceUrl: string }) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  const instructions = `<section style="max-width:1036px;margin:24px auto;padding:20px;border:1px solid #bdd8cd;border-radius:8px;background:#f0f8f4;font:16px/1.6 Arial,sans-serif;color:#243b32"><strong>Ready for ${escape(input.assessor.name)} to forward</strong><p>Forward the handoff below from Outlook to these reviewed recipients. Keep the packet link in the message.</p><p><strong>To:</strong> ${input.to.map(escape).join("; ")}<br><strong>Cc:</strong> ${input.cc.map(escape).join("; ") || "None"}</p><p>After sending, <a href="${escape(input.workspaceUrl)}">return to Pipeline and confirm the handoff</a>. The community has not received this preparation email.</p><p style="margin-bottom:0">Remove this instruction box from your forward. If recipients, the assessment, or files change, prepare an updated handoff in Pipeline.</p></section>`;
  return html.replace(/<body\b[^>]*>/i, (body) => body + instructions);
}
