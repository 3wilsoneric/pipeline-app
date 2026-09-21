import "server-only";

import { getDocumentOriginalAsset, getDocumentReferralId } from "@/lib/extraction/document-assets";
import { getAzureBlobUploadSigner } from "@/lib/extraction/azure-blob";
import { isValidHttpByteRange } from "@/lib/extraction/http-byte-range";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import type { MeetClientAttachmentInventory } from "./meet-client-attachments";
import { createAdmissionPacket, PacketAccessError, type AdmissionPacket, type PacketFile } from "./admission-packet-store";

export const packetPrivateHeaders = {
  "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow, noarchive",
};
export function admissionPacketUrl(id: string, requestUrl: string) {
  const configured = process.env.PIPELINE_CANONICAL_ORIGIN;
  if (!configured && process.env.NODE_ENV === "production" && process.env.PIPELINE_AUTH_MODE !== "mock") throw new PacketAccessError("The approved packet delivery address is not configured.", 503);
  const origin = new URL(configured || requestUrl);
  if (origin.protocol !== "https:" && !(process.env.PIPELINE_AUTH_MODE === "mock" && ["localhost", "127.0.0.1"].includes(origin.hostname))) throw new PacketAccessError("The packet delivery address must use HTTPS.", 503);
  return new URL(toPipelinePath(`/admission-packet/${id}`), origin.origin).toString();
}

export async function prepareAdmissionPacketLink(input: {
  id: string; referralId: number; assessmentId: string; assessmentVersion: number;
  recipients: string[]; inventory: MeetClientAttachmentInventory; message: AdmissionPacket["message"];
  requestUrl: string;
  outlook?: AdmissionPacket["outlook"];
}) {
  const url = admissionPacketUrl(input.id, input.requestUrl);
  if ((process.env.PIPELINE_ENTRA_SESSION_SECRET?.length ?? 0) < 32) throw new PacketAccessError("Email verification is not configured. Configure the packet verification secret before sending.", 503);
  const files: PacketFile[] = [];
  // Keep large manifests within the send deadline without flooding storage.
  for (let offset = 0; offset < input.inventory.files.length; offset += 8) {
    files.push(...await Promise.all(input.inventory.files.slice(offset, offset + 8).map(async (item): Promise<PacketFile> => {
    if (!item.ready) throw new PacketAccessError(`${item.name} is still being prepared. Retry when it is ready.`, 409);
    if (item.generatedContent !== undefined) {
      return { id: item.documentId, name: item.name, contentType: item.contentType, byteSize: item.byteSize, source: { kind: "generated", content: item.generatedContent } };
    }
    if (await getDocumentReferralId(item.documentId) !== input.referralId) throw new PacketAccessError("A packet file changed. Refresh the file list and try again.", 409);
    const asset = await getDocumentOriginalAsset(item.documentId);
    if (!asset) throw new PacketAccessError("A packet file is temporarily unavailable. Retry without removing it from the packet.", 503);
    const properties = await getAzureBlobUploadSigner().getBlobProperties(asset.container, asset.blobKey);
    if (!properties.exists || !properties.etag || properties.byteSize !== item.byteSize) throw new PacketAccessError("A packet file changed. Refresh the file list and try again.", 409);
    return { id: item.documentId, name: item.name, contentType: asset.contentType, byteSize: item.byteSize,
      source: { kind: "blob", container: asset.container, key: asset.blobKey, etag: properties.etag } };
    })));
  }
  const packet: AdmissionPacket = { schema: 1, id: input.id, referralId: input.referralId, assessmentId: input.assessmentId,
    assessmentVersion: input.assessmentVersion, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
    files, message: input.message, ...(input.outlook ? { outlook: input.outlook } : {}), recipients: [...new Set(input.recipients.map((email) => email.trim().toLowerCase()))].map((email) => ({ email, sessions: [], requestedAt: [] })), events: [] };
  await createAdmissionPacket(packet);
  return url;
}

export async function packetFileResponse(file: PacketFile, referralId: number, request: Request) {
  const headers: Record<string, string> = { ...packetPrivateHeaders, "Content-Type": file.contentType,
    "Content-Disposition": `attachment; filename="${file.name.replace(/[^\x20-\x7e]|["\\/]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (value) => `%${value.charCodeAt(0).toString(16)}`)}`,
    "Content-Security-Policy": "sandbox; default-src 'none'", "Accept-Ranges": "bytes" };
  if (file.source.kind === "generated") return new Response(file.source.content, { headers });
  // Respect a later withdrawal or adverse scan verdict, even with a valid session.
  if (await getDocumentReferralId(file.id) !== referralId) throw new PacketAccessError("This file has been withdrawn. Contact the sender for its replacement.", 410);
  const current = await getDocumentOriginalAsset(file.id);
  if (!current || current.container !== file.source.container || current.blobKey !== file.source.key) throw new PacketAccessError("This file was replaced. Contact the sender for an updated packet.", 409);
  const range = request.headers.get("range");
  if (range && !isValidHttpByteRange(range)) return new Response(null, { status: 416, headers: packetPrivateHeaders });
  const url = await getAzureBlobUploadSigner().createReadUrl(file.source.container, file.source.key, 120);
  const response = await fetch(url, { headers: { "If-Match": file.source.etag, ...(range ? { Range: range } : {}) }, cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(300_000)]) });
  return relayPacketDownload(response, file, headers);
}

function relayPacketDownload(response: Response, file: PacketFile, headers: Record<string, string>) {
  if (response.status === 416) return new Response(null, { status: 416, headers: { ...packetPrivateHeaders, "Content-Range": `bytes */${file.byteSize}` } });
  if (response.status === 412) throw new PacketAccessError("This file was replaced. Ask the sender for an updated packet.", 409);
  if (![200, 206].includes(response.status) || !response.body) throw new PacketAccessError("The download could not start. Try again; the packet has not been changed.", 503);
  for (const name of ["content-length", "content-range"]) if (response.headers.has(name)) headers[name] = response.headers.get(name)!;
  return new Response(response.body, { status: response.status, headers });
}
