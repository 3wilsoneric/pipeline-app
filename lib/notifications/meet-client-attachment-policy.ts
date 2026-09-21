export const graphInlineAttachmentLimitBytes = 3 * 1024 * 1024 - 1;
export const graphDirectSendPayloadLimitBytes = 2 * 1024 * 1024;
export const graphUploadChunkBytes = 12 * 320 * 1024;

export type MailAttachmentSize = {
  byteSize: number;
};

export type MeetClientAttachmentDeliveryMode = "direct" | "draft_upload" | "secure_link";

export function admissionPacketDeliveryMode(attachments: readonly MailAttachmentSize[], largeAttachmentDeliveryConfigured: boolean): MeetClientAttachmentDeliveryMode {
  const mode = meetClientAttachmentDeliveryMode(attachments);
  const configuredCount = Number(process.env.PIPELINE_MEET_CLIENT_MAX_ATTACHMENT_COUNT || 50);
  const configuredBytes = Number(process.env.PIPELINE_MEET_CLIENT_MAX_ATTACHMENT_BYTES || 20 * 1024 * 1024);
  const count = Number.isSafeInteger(configuredCount) && configuredCount > 0 ? Math.min(configuredCount, 50) : 50;
  const bytes = Number.isSafeInteger(configuredBytes) && configuredBytes > 0 ? Math.min(configuredBytes, 20 * 1024 * 1024) : 20 * 1024 * 1024;
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
