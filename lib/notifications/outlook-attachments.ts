import "server-only";
import { createHash } from "node:crypto";
import { packetMailAttachment } from "./admission-packet-files";
import { PacketAccessError, type AdmissionPacket, type PacketFile } from "./admission-packet-store";
import { addGraphMailAttachment, GraphMailDeliveryError, isMeetClientLive, readSourceRange } from "./microsoft-graph-mail";
import { graphUploadRanges } from "./meet-client-attachment-policy";
import { outlookRequest, OutlookMailError } from "./outlook-mail";

type Attachment = { id: string; name: string; "@odata.type"?: string; isInline?: boolean };
type Progress = (fileId?: string, hash?: string) => Promise<void>;
const graphOrigin = "https://graph.microsoft.com";
const messagePath = (id: string) => `/me/messages/${encodeURIComponent(id)}`;

export async function ensureOutlookAttachments(token: string, messageId: string, packet: AdmissionPacket, progress: Progress) {
  if (!isMeetClientLive()) throw new PacketAccessError("Not production yet — no attachments will be uploaded.", 403);
  let existing = await listAttachments(token, messageId);
  const used = new Set<string>();
  for (const file of packet.files) {
    await progress();
    const source = await packetMailAttachment(file, packet.referralId);
    const hash = packet.outlook?.attachmentHashes?.[file.id] ?? await sourceHash(source, progress);
    await progress(file.id, hash);
    let match = await matchingAttachment(token, messageId, file, hash, existing, used, progress);
    if (!match) {
      try { await addGraphMailAttachment(messagePath(messageId), token, source, progress); }
      catch (error) { throw attachmentFailure(error); }
      existing = await listAttachments(token, messageId);
      match = await matchingAttachment(token, messageId, file, hash, existing, used, progress);
    }
    if (!match) throw new PacketAccessError("An attachment could not be confirmed. Check draft status to resume; your files are saved.", 503);
    used.add(match.id);
  }
  if (existing.some((item) => !item.isInline && !used.has(item.id))) throw new PacketAccessError("Attachments changed in Outlook. Remove this draft and review its replacement.", 409);
}

export async function outlookAttachmentsMatch(token: string, messageId: string, packet: AdmissionPacket, progress: Progress = async () => {}) {
  const attachments = await listAttachments(token, messageId);
  const used = new Set<string>();
  for (const file of packet.files) {
    const hash = packet.outlook?.attachmentHashes?.[file.id];
    if (!hash) return false;
    const match = await matchingAttachment(token, messageId, file, hash, attachments, used, progress);
    if (!match) return false;
    used.add(match.id);
  }
  return !attachments.some((item) => !item.isInline && !used.has(item.id));
}

async function listAttachments(token: string, messageId: string) {
  const attachments: Attachment[] = [];
  let path: string | undefined = `${messagePath(messageId)}/attachments?$select=id,name,isInline&$top=100`;
  const visited = new Set<string>();
  while (path) {
    if (visited.has(path)) throw new OutlookMailError(502);
    visited.add(path);
    const result: { value: Attachment[]; "@odata.nextLink"?: string } = await outlookRequest(token, path);
    if (!Array.isArray(result.value)) throw new OutlookMailError(502);
    attachments.push(...result.value);
    path = nextAttachmentPage(result["@odata.nextLink"], messageId);
  }
  return attachments;
}

function nextAttachmentPage(value: string | undefined, messageId: string) {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.origin !== graphOrigin || url.username || url.password || url.pathname !== `/v1.0${messagePath(messageId)}/attachments`) throw new OutlookMailError(502);
  return `${url.pathname.slice("/v1.0".length)}${url.search}`;
}

async function matchingAttachment(token: string, messageId: string, file: PacketFile, hash: string, items: Attachment[], used: Set<string>, progress: Progress) {
  for (const item of items) {
    await progress();
    if (used.has(item.id) || item.isInline || item.name !== file.name || item["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
    // Graph's attachment size includes metadata. Compare actual bytes instead,
    // including on recovery after a lost upload response or edits in Outlook.
    if (await attachmentHash(token, messageId, item.id, file.byteSize) === hash) return item;
  }
  return null;
}

async function sourceHash(source: Awaited<ReturnType<typeof packetMailAttachment>>, progress: Progress) {
  const hash = createHash("sha256");
  for (const range of graphUploadRanges(source.byteSize)) {
    await progress();
    hash.update(await readSourceRange(source, range.start, range.end));
  }
  return hash.digest("hex");
}

async function attachmentHash(token: string, messageId: string, attachmentId: string, expectedBytes: number) {
  const response = await fetch(`${graphOrigin}/v1.0${messagePath(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new OutlookMailError(response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new OutlookMailError(502);
  const hash = createHash("sha256"); let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > expectedBytes) { await reader.cancel(); return null; }
      hash.update(value);
    }
    return bytes === expectedBytes ? hash.digest("hex") : null;
  } finally { reader.releaseLock(); }
}

function attachmentFailure(error: unknown) {
  if (error instanceof GraphMailDeliveryError && error.code === "packet_size_rejected") return new PacketAccessError("Outlook's message-size limit stopped the attachment upload. Your files and draft are saved; no download link was substituted and no email was sent. Reduce the files or send them in separate emails from Outlook.", 413);
  if (error instanceof GraphMailDeliveryError && [401, 403, 429].includes(error.status ?? 0)) return new OutlookMailError(error.status!);
  return new PacketAccessError("The attachments are not finished. Check draft status to resume the same draft; no email was sent.", 503);
}
