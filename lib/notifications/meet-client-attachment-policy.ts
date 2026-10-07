export const graphInlineAttachmentLimitBytes = 3 * 1024 * 1024 - 1;
export const graphDirectSendPayloadLimitBytes = 2 * 1024 * 1024;
export const graphUploadChunkBytes = 12 * 320 * 1024;
// Binary files expand when encoded in a message. Leave room below recipient
// mailboxes' 36 MB message limit for encoding, headers, and the email body.
export const mailAttachmentByteLimit = 20 * 1024 * 1024;

export type MailAttachmentSize = {
  byteSize: number;
};

export function mailAttachmentsExceedSafeLimit(attachments: readonly MailAttachmentSize[]) {
  return attachments.reduce((sum, file) => sum + file.byteSize, 0) > mailAttachmentByteLimit;
}

export type MeetClientAttachmentDeliveryMode = "direct" | "draft_upload" | "secure_link";

export function admissionPacketDeliveryMode(attachments: readonly MailAttachmentSize[], largeAttachmentDeliveryConfigured: boolean): MeetClientAttachmentDeliveryMode {
  const mode = meetClientAttachmentDeliveryMode(attachments);
  const count = deliveryThreshold(process.env.PIPELINE_MEET_CLIENT_MAX_ATTACHMENT_COUNT, 50);
  const bytes = deliveryThreshold(process.env.PIPELINE_MEET_CLIENT_MAX_ATTACHMENT_BYTES, mailAttachmentByteLimit);
  return attachments.length > count || attachments.reduce((sum, file) => sum + file.byteSize, 0) > bytes
    || (mode === "draft_upload" && !largeAttachmentDeliveryConfigured) ? "secure_link" : mode;
}

export function meetClientAttachmentDeliveryMode(
  attachments: readonly MailAttachmentSize[],
): MeetClientAttachmentDeliveryMode {
  const totalBytes = attachments.reduce((total, attachment) => total + attachment.byteSize, 0);
  return attachments.every((attachment) => attachment.byteSize <= graphInlineAttachmentLimitBytes)
    && totalBytes <= graphDirectSendPayloadLimitBytes
    ? "direct"
    : "draft_upload";
}

export function graphUploadRanges(byteSize: number) {
  if (!Number.isInteger(byteSize) || byteSize < 1) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < byteSize; start += graphUploadChunkBytes) {
    ranges.push({ start, end: Math.min(byteSize - 1, start + graphUploadChunkBytes - 1) });
  }
  return ranges;
}

function deliveryThreshold(configured: string | undefined, ceiling: number) {
  const value = Number(configured || ceiling);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, ceiling) : ceiling;
}
