import "server-only";

import { getPipelineDemoEnvironment } from "@/lib/demo/demo-environment";
import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import {
  graphInlineAttachmentLimitBytes,
  graphUploadRanges,
  meetClientAttachmentDeliveryMode,
} from "@/lib/notifications/meet-client-attachment-policy";
import type { MeetClientMailAttachment } from "@/lib/notifications/meet-client-attachments";
import { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";
import type { MeetClientMessage } from "@/lib/notifications/meet-client-message";
import { recipientListLimit } from "@/lib/pipeline/community-recipient-lists";

export { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";

const graphBaseUrl = "https://graph.microsoft.com/v1.0";

export type GraphMailReadiness = {
  configured: boolean;
  missing: string[];
  sender: string;
  largeAttachmentDeliveryConfigured: boolean;
};

// Enabling infrastructure or adding credentials must never activate delivery.
// Change this switch only after the owner explicitly approves production use.
export function isMeetClientLive() {
  return process.env.PIPELINE_MEET_CLIENT_LIVE_ENABLED === "true"
    && !getPipelineDemoEnvironment().enabled
    && process.env.PIPELINE_PERSONA_DEMO !== "true";
}

export function getGraphMailReadiness(): GraphMailReadiness {
  if (process.env.PIPELINE_PERSONA_DEMO === "true") return {
    configured: false, missing: ["Email delivery is disabled in this environment."],
    sender: "", largeAttachmentDeliveryConfigured: false,
  };
  const values = {
    PIPELINE_GRAPH_TENANT_ID: process.env.PIPELINE_GRAPH_TENANT_ID?.trim() ?? "",
    PIPELINE_GRAPH_CLIENT_ID: process.env.PIPELINE_GRAPH_CLIENT_ID?.trim() ?? "",
    PIPELINE_GRAPH_CLIENT_SECRET: process.env.PIPELINE_GRAPH_CLIENT_SECRET?.trim() ?? "",
    PIPELINE_MEET_CLIENT_SENDER: process.env.PIPELINE_MEET_CLIENT_SENDER?.trim() ?? "",
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (!isMeetClientLive()) missing.push("PIPELINE_MEET_CLIENT_LIVE_ENABLED (owner approval required)");
  return {
    configured: missing.length === 0,
    missing,
    sender: values.PIPELINE_MEET_CLIENT_SENDER,
    largeAttachmentDeliveryConfigured: process.env.PIPELINE_GRAPH_MAIL_READ_WRITE?.trim().toLowerCase() === "true",
  };
}

export function validateMeetClientRecipients(recipients: unknown) {
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > recipientListLimit) {
    return { ok: false as const, message: `Add between 1 and ${recipientListLimit} authorized recipients in To and Cc combined.` };
  }
  const normalized = [...new Set(recipients.map((value) => typeof value === "string" ? value.trim().toLowerCase() : ""))];
  if (normalized.some((value) => !isEmail(value))) {
    return { ok: false as const, message: "Every recipient must be a valid email address." };
  }
  return { ok: true as const, recipients: normalized };
}

export async function sendMeetClientMail(input: {
  recipients: string[];
  ccRecipients?: string[];
  summary: MeetClientSummary;
  preparedBy: string;
  deliveryId: string;
  attachments: MeetClientMailAttachment[];
  message?: MeetClientMessage;
  packetUrl?: string;
  packetFiles?: { name: string; byteSize: number }[];
}) {
  const readiness = getGraphMailReadiness();
  if (!readiness.configured) throw new Error("Microsoft 365 email is not configured.");
  if (input.attachments.length === 0 && !input.packetUrl) {
    throw new GraphMailDeliveryError("admission_packet_empty", "The admission packet has no files.");
  }
  const accessToken = await graphAccessToken().catch(() => { throw new GraphMailDeliveryError("mail_preparation_failed", "Microsoft 365 authentication could not be completed. No email was sent."); });
  const packetFiles = input.packetFiles ?? input.attachments;
  const content = renderMeetClientEmail(
    input.summary,
    input.preparedBy,
    input.deliveryId,
    packetFiles.map((attachment) => attachment.name),
    input.message,
    { packetUrl: input.packetUrl },
  );
  const mode = input.packetUrl ? "secure_link" : meetClientAttachmentDeliveryMode(input.attachments);
  if (mode === "draft_upload" && !readiness.largeAttachmentDeliveryConfigured) {
    throw new GraphMailDeliveryError(
      "large_attachment_permission_missing",
      "Microsoft 365 large-attachment delivery is not configured.",
    );
  }
  if (mode === "direct" || mode === "secure_link") {
    await sendDirectMessage(readiness, accessToken, content, input);
  } else {
    await sendDraftWithAttachments(readiness, accessToken, content, input);
  }
  return {
    provider: "microsoft_graph" as const,
    acceptedAt: new Date().toISOString(),
    attachmentCount: packetFiles.length,
    attachmentBytes: packetFiles.reduce((total, attachment) => total + attachment.byteSize, 0),
    deliveryMode: mode,
  };
}

export class GraphMailDeliveryError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) {
    super(message);
    this.name = "GraphMailDeliveryError";
  }
}

async function sendDirectMessage(
  readiness: GraphMailReadiness,
  accessToken: string,
  content: ReturnType<typeof renderMeetClientEmail>,
  input: Parameters<typeof sendMeetClientMail>[0],
) {
  const attachments = await Promise.all(input.attachments.map(async (attachment) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: attachment.name,
    contentType: attachment.contentType,
    contentBytes: (await readSourceBytes(attachment)).toString("base64"),
  }))).catch((error) => { if (error instanceof GraphMailDeliveryError) throw error; throw new GraphMailDeliveryError("attachment_source_unavailable", "An admission packet file could not be loaded. No email was sent."); });
  const response = await fetch(
    `${graphBaseUrl}/users/${encodeURIComponent(readiness.sender)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: content.subject,
          body: { contentType: "HTML", content: content.html },
          toRecipients: input.recipients.map((address) => ({ emailAddress: { address } })),
          ccRecipients: (input.ccRecipients ?? []).map((address) => ({ emailAddress: { address } })),
          internetMessageHeaders: [{ name: "x-pipeline-delivery-id", value: input.deliveryId }],
          attachments,
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status !== 202) {
    throw await graphRejection(response, "send_message");
  }
}

async function sendDraftWithAttachments(
  readiness: GraphMailReadiness,
  accessToken: string,
  content: ReturnType<typeof renderMeetClientEmail>,
  input: Parameters<typeof sendMeetClientMail>[0],
) {
  const senderPath = `/users/${encodeURIComponent(readiness.sender)}`;
  const draftResponse = await graphRequest(`${senderPath}/messages`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      subject: content.subject,
      body: { contentType: "HTML", content: content.html },
      toRecipients: input.recipients.map((address) => ({ emailAddress: { address } })),
      ccRecipients: (input.ccRecipients ?? []).map((address) => ({ emailAddress: { address } })),
      internetMessageHeaders: [{ name: "x-pipeline-delivery-id", value: input.deliveryId }],
    }),
  }, 201, "create_draft").catch((error) => { if (error instanceof GraphMailDeliveryError) throw error; throw new GraphMailDeliveryError("mail_preparation_failed", "The email draft could not be prepared. No email was sent."); });
  const draft = await draftResponse.json() as { id?: unknown };
  if (typeof draft.id !== "string" || !draft.id) {
    throw new GraphMailDeliveryError("draft_id_missing", "Microsoft Graph did not return a draft identifier.");
  }
  const messagePath = `${senderPath}/messages/${encodeURIComponent(draft.id)}`;
  let sending = false;
  try {
    for (const attachment of input.attachments) {
      if (attachment.byteSize <= graphInlineAttachmentLimitBytes) {
        await addSmallAttachment(messagePath, accessToken, attachment);
      } else {
        await addLargeAttachment(messagePath, accessToken, attachment);
      }
    }
    sending = true;
    await graphRequest(`${messagePath}/send`, accessToken, { method: "POST" }, 202, "send_draft");
  } catch (error) {
    await handleFailedDraft(messagePath, accessToken, sending, error);
  }
}

export async function addGraphMailAttachment(messagePath: string, accessToken: string, attachment: MeetClientMailAttachment, progress: () => Promise<void> = async () => {}) {
  await progress();
  if (attachment.byteSize <= graphInlineAttachmentLimitBytes) await addSmallAttachment(messagePath, accessToken, attachment);
  else await addLargeAttachment(messagePath, accessToken, attachment, progress);
}

async function addSmallAttachment(
  messagePath: string,
  accessToken: string,
  attachment: MeetClientMailAttachment,
) {
  const bytes = await readSourceBytes(attachment);
  await graphRequest(`${messagePath}/attachments`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: attachment.name,
      contentType: attachment.contentType,
      contentBytes: bytes.toString("base64"),
    }),
  }, 201, "attach_small_file");
}

async function addLargeAttachment(
  messagePath: string,
  accessToken: string,
  attachment: MeetClientMailAttachment,
  progress: () => Promise<void> = async () => {},
) {
  const sessionResponse = await graphRequest(`${messagePath}/attachments/createUploadSession`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      AttachmentItem: {
        attachmentType: "file",
        name: attachment.name,
        size: attachment.byteSize,
        isInline: false,
      },
    }),
  }, 201, "create_attachment_session");
  const session = await sessionResponse.json() as { uploadUrl?: unknown };
  if (!safeAttachmentUploadUrl(session.uploadUrl)) {
    throw new GraphMailDeliveryError("attachment_session_invalid", "Microsoft Graph returned an invalid attachment session.");
  }
  const ranges = graphUploadRanges(attachment.byteSize);
  for (const [index, range] of ranges.entries()) {
    await progress();
    const bytes = await readSourceRange(attachment, range.start, range.end);
    const response = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
        "Content-Range": `bytes ${range.start}-${range.end}/${attachment.byteSize}`,
      },
      body: bytes,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const finalChunk = index === ranges.length - 1;
    if ((!finalChunk && ![200, 202].includes(response.status)) || (finalChunk && response.status !== 201)) {
      throw await graphRejection(response, "upload_attachment_chunk");
    }
  }
}

function safeAttachmentUploadUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && ["outlook.office.com", "outlook.office365.com", "outlook.live.com"].includes(url.hostname); }
  catch { return false; }
}

async function readSourceBytes(attachment: MeetClientMailAttachment) {
  if (attachment.contentBytes) {
    if (attachment.contentBytes.byteLength !== attachment.byteSize) throw new GraphMailDeliveryError("attachment_source_size_mismatch", "The generated chart changed during delivery.");
    return attachment.contentBytes;
  }
  const response = await fetch(attachment.sourceUrl, {
    headers: attachment.sourceHeaders,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new GraphMailDeliveryError("attachment_source_unavailable", "An admission packet file could not be loaded.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength !== attachment.byteSize) {
    throw new GraphMailDeliveryError("attachment_source_size_mismatch", "An admission packet file changed during delivery.");
  }
  return bytes;
}

export async function readSourceRange(attachment: MeetClientMailAttachment, start: number, end: number) {
  if (attachment.contentBytes) return Uint8Array.from((await readSourceBytes(attachment)).subarray(start, end + 1));
  const response = await fetch(attachment.sourceUrl, {
    headers: { ...attachment.sourceHeaders, Range: `bytes=${start}-${end}` },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 206 && !(response.status === 200 && start === 0 && end === attachment.byteSize - 1)) {
    throw new GraphMailDeliveryError("attachment_source_range_failed", "An admission packet file could not be streamed.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== end - start + 1) {
    throw new GraphMailDeliveryError("attachment_source_range_mismatch", "An admission packet file returned an incomplete range.");
  }
  return bytes;
}

async function graphRequest(
  path: string,
  accessToken: string,
  init: RequestInit,
  expectedStatus: number,
  operation: string,
) {
  const response = await fetch(`${graphBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status !== expectedStatus) throw await graphRejection(response, operation);
  return response;
}

async function deleteDraft(messagePath: string, accessToken: string) {
  try {
    await graphRequest(messagePath, accessToken, { method: "DELETE" }, 204, "delete_failed_draft");
  } catch {
    // Delivery has already failed; an orphaned draft is safer than masking the original failure.
  }
}

async function graphRejection(response: Response, operation: string) {
  const status = response.status;
  const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  // Only inspect machine codes, never provider messages containing client data.
  const tooLarge = status === 413 || (status === 400 && ["ErrorMessageSizeExceeded", "MessageSizeExceeded", "ErrorAttachmentSizeLimitExceeded"].includes(payload?.error?.code ?? ""));
  const code = tooLarge ? "packet_size_rejected" : status === 403 && operation !== "send_message" && operation !== "send_verification_code"
    ? "large_attachment_permission_missing"
    : `graph_${operation}_rejected`;
  return new GraphMailDeliveryError(code, `Microsoft Graph rejected ${operation} with status ${status}.`, status);
}

export async function sendUnderReviewEmail(referralId: number, message: string) {
  const readiness = getGraphMailReadiness();
  if (!readiness.configured) throw new GraphMailDeliveryError("under_review_email_unavailable", "Under Review email is not configured.");
  if (!Number.isSafeInteger(referralId) || referralId < 1) throw new GraphMailDeliveryError("invalid_referral", "The workspace is invalid.");
  if (!message.trim() || message.length > 4000) throw new GraphMailDeliveryError("invalid_message", "Add a message of up to 4,000 characters.");
  const recipients = ["andrew@aaahealthservices.com", "sandeep@aaahealthservices.com"];
  await graphRequest(`/users/${encodeURIComponent(readiness.sender)}/sendMail`, await graphAccessToken(), {
    method: "POST",
    body: JSON.stringify({ message: {
      subject: "Pipeline referral under review",
      body: { contentType: "Text", content: message },
      toRecipients: recipients.map((recipient) => ({ emailAddress: { address: recipient } })),
    }, saveToSentItems: true }),
  }, 202, "send_under_review_notice");
}

export async function sendPacketVerificationCode(recipient: string, code: string) {
  const readiness = getGraphMailReadiness();
  if (!readiness.configured) throw new Error("Email verification is temporarily unavailable. Please try again.");
  if (!/^\d{8}$/.test(code)) throw new Error("Invalid verification code.");
  // The recipient comes exclusively from the stored, sender-approved packet audience.
  await graphRequest(`/users/${encodeURIComponent(readiness.sender)}/sendMail`, await graphAccessToken(), {
    method: "POST", body: JSON.stringify({ message: {
      subject: "Your Pipeline packet verification code",
      body: { contentType: "Text", content: `Your verification code is ${code}. It expires in 10 minutes and can be used once.\n\nEnter it on the Pipeline packet page. If you did not request this code, you can ignore this email.` },
      toRecipients: [{ emailAddress: { address: recipient } }],
    }, saveToSentItems: true }),
  }, 202, "send_verification_code");
}

async function graphAccessToken() {
  const tenantId = process.env.PIPELINE_GRAPH_TENANT_ID!.trim();
  const body = new URLSearchParams({
    client_id: process.env.PIPELINE_GRAPH_CLIENT_ID!.trim(),
    client_secret: process.env.PIPELINE_GRAPH_CLIENT_SECRET!.trim(),
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error("Microsoft Graph authentication failed.");
  const payload = await response.json() as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Microsoft Graph did not return an access token.");
  }
  return payload.access_token;
}

function isEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function handleFailedDraft(messagePath: string, accessToken: string, sending: boolean, error: unknown): Promise<never> {
  // Keep the provider evidence when acceptance is unknown. Deleting a message
  // after an ambiguous send could delete a successfully sent handoff.
  if (!sending || (error instanceof GraphMailDeliveryError && error.status && error.status < 500)) await deleteDraft(messagePath, accessToken);
  if (!sending && !(error instanceof GraphMailDeliveryError)) throw new GraphMailDeliveryError("mail_preparation_failed", "The email draft could not be prepared. No email was sent.");
  throw error;
}
