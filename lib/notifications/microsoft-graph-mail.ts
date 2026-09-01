import "server-only";

import type { MeetClientSummary } from "@/lib/assessment/assessment-summary";
import {
  graphInlineAttachmentLimitBytes,
  graphUploadRanges,
  meetClientAttachmentDeliveryMode,
} from "@/lib/notifications/meet-client-attachment-policy";
import type { MeetClientMailAttachment } from "@/lib/notifications/meet-client-attachments";
import { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";

export { renderMeetClientEmail } from "@/lib/notifications/meet-client-email-template";

const graphBaseUrl = "https://graph.microsoft.com/v1.0";

export type GraphMailReadiness = {
  configured: boolean;
  missing: string[];
  sender: string;
  allowedRecipientDomains: string[];
  largeAttachmentDeliveryConfigured: boolean;
};

export function getGraphMailReadiness(): GraphMailReadiness {
  const values = {
    PIPELINE_GRAPH_TENANT_ID: process.env.PIPELINE_GRAPH_TENANT_ID?.trim() ?? "",
    PIPELINE_GRAPH_CLIENT_ID: process.env.PIPELINE_GRAPH_CLIENT_ID?.trim() ?? "",
    PIPELINE_GRAPH_CLIENT_SECRET: process.env.PIPELINE_GRAPH_CLIENT_SECRET?.trim() ?? "",
    PIPELINE_MEET_CLIENT_SENDER: process.env.PIPELINE_MEET_CLIENT_SENDER?.trim() ?? "",
  };
  const allowedRecipientDomains = parseAllowedDomains(
    process.env.PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS,
  );
  const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
  if (allowedRecipientDomains.length === 0) missing.push("PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS");
  return {
    configured: missing.length === 0,
    missing,
    sender: values.PIPELINE_MEET_CLIENT_SENDER,
    allowedRecipientDomains,
    largeAttachmentDeliveryConfigured: process.env.PIPELINE_GRAPH_MAIL_READ_WRITE?.trim().toLowerCase() === "true",
  };
}

export function validateMeetClientRecipients(recipients: unknown, readiness = getGraphMailReadiness()) {
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 20) {
    return { ok: false as const, message: "Add between 1 and 20 authorized recipients." };
  }
  const normalized = [...new Set(recipients.map((value) => typeof value === "string" ? value.trim().toLowerCase() : ""))];
  if (normalized.some((value) => !isEmail(value))) {
    return { ok: false as const, message: "Every recipient must be a valid email address." };
  }
  const disallowed = normalized.find((value) => !readiness.allowedRecipientDomains.includes(emailDomain(value)));
  if (disallowed) {
    return { ok: false as const, message: `Recipients must use an approved organization domain. ${emailDomain(disallowed)} is not approved.` };
  }
  return { ok: true as const, recipients: normalized };
}

export async function sendMeetClientMail(input: {
  recipients: string[];
  summary: MeetClientSummary;
  preparedBy: string;
  deliveryId: string;
  attachments: MeetClientMailAttachment[];
}) {
  const readiness = getGraphMailReadiness();
  if (!readiness.configured) throw new Error("Microsoft 365 email is not configured.");
  if (input.attachments.length === 0) {
    throw new GraphMailDeliveryError("admission_packet_empty", "The admission packet has no files.");
  }
  const accessToken = await graphAccessToken();
  const content = renderMeetClientEmail(
    input.summary,
    input.preparedBy,
    input.deliveryId,
    input.attachments.map((attachment) => attachment.name),
  );
  const mode = meetClientAttachmentDeliveryMode(input.attachments);
  if (mode === "draft_upload" && !readiness.largeAttachmentDeliveryConfigured) {
    throw new GraphMailDeliveryError(
      "large_attachment_permission_missing",
      "Microsoft 365 large-attachment delivery is not configured.",
    );
  }
  if (mode === "direct") {
    await sendDirectMessage(readiness, accessToken, content, input);
  } else {
    await sendDraftWithAttachments(readiness, accessToken, content, input);
  }
  return {
    provider: "microsoft_graph" as const,
    acceptedAt: new Date().toISOString(),
    attachmentCount: input.attachments.length,
    attachmentBytes: input.attachments.reduce((total, attachment) => total + attachment.byteSize, 0),
    deliveryMode: mode,
  };
}

export class GraphMailDeliveryError extends Error {
  constructor(public readonly code: string, message: string) {
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
  })));
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
          internetMessageHeaders: [{ name: "x-pipeline-delivery-id", value: input.deliveryId }],
          attachments,
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status !== 202) {
    throw graphRejection(response.status, "send_message");
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
      internetMessageHeaders: [{ name: "x-pipeline-delivery-id", value: input.deliveryId }],
    }),
  }, 201, "create_draft");
  const draft = await draftResponse.json() as { id?: unknown };
  if (typeof draft.id !== "string" || !draft.id) {
    throw new GraphMailDeliveryError("draft_id_missing", "Microsoft Graph did not return a draft identifier.");
  }
  const messagePath = `${senderPath}/messages/${encodeURIComponent(draft.id)}`;
  try {
    for (const attachment of input.attachments) {
      if (attachment.byteSize <= graphInlineAttachmentLimitBytes) {
        await addSmallAttachment(messagePath, accessToken, attachment);
      } else {
        await addLargeAttachment(messagePath, accessToken, attachment);
      }
    }
    await graphRequest(`${messagePath}/send`, accessToken, { method: "POST" }, 202, "send_draft");
  } catch (error) {
    await deleteDraft(messagePath, accessToken);
    throw error;
  }
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
  if (typeof session.uploadUrl !== "string" || !session.uploadUrl.startsWith("https://")) {
    throw new GraphMailDeliveryError("attachment_session_invalid", "Microsoft Graph returned an invalid attachment session.");
  }
  const ranges = graphUploadRanges(attachment.byteSize);
  for (const [index, range] of ranges.entries()) {
    const bytes = await readSourceRange(attachment, range.start, range.end);
    const response = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(bytes.byteLength),
        "Content-Range": `bytes ${range.start}-${range.end}/${attachment.byteSize}`,
      },
      body: bytes,
      signal: AbortSignal.timeout(30_000),
    });
    const finalChunk = index === ranges.length - 1;
    if ((!finalChunk && response.status !== 202) || (finalChunk && ![200, 201].includes(response.status))) {
      throw graphRejection(response.status, "upload_attachment_chunk");
    }
  }
}

async function readSourceBytes(attachment: MeetClientMailAttachment) {
  const response = await fetch(attachment.sourceUrl, {
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

async function readSourceRange(attachment: MeetClientMailAttachment, start: number, end: number) {
  const response = await fetch(attachment.sourceUrl, {
    headers: { Range: `bytes=${start}-${end}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 206 && !(response.status === 200 && start === 0 && end === attachment.byteSize - 1)) {
    throw new GraphMailDeliveryError("attachment_source_range_failed", "An admission packet file could not be streamed.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
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
  if (response.status !== expectedStatus) throw graphRejection(response.status, operation);
  return response;
}

async function deleteDraft(messagePath: string, accessToken: string) {
  try {
    await graphRequest(messagePath, accessToken, { method: "DELETE" }, 204, "delete_failed_draft");
  } catch {
    // Delivery has already failed; an orphaned draft is safer than masking the original failure.
  }
}

function graphRejection(status: number, operation: string) {
  const code = status === 403 && operation !== "send_message"
    ? "large_attachment_permission_missing"
    : `graph_${operation}_rejected`;
  return new GraphMailDeliveryError(code, `Microsoft Graph rejected ${operation} with status ${status}.`);
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

function parseAllowedDomains(value: string | undefined) {
  return [...new Set((value ?? "").split(",").map((domain) => domain.trim().toLowerCase()).filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)))];
}

function isEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function emailDomain(value: string) {
  return value.slice(value.lastIndexOf("@") + 1).toLowerCase();
}
