import "server-only";
import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { getLocalUploadedDocument, getReferralStoreReadiness } from "./referral-store";
import { requireReferralAccess } from "./referral-access";
import { readLocalReferralPacket } from "./local-document-store";

async function accessibleLocalFile(user: PipelineUser, id: string) {
  if (getReferralStoreReadiness().mode !== "local_file") return null;
  const document = await getLocalUploadedDocument(id);
  if (!document || document.deletedAt || !document.file.referralId) return null;
  const access = await requireReferralAccess(user, document.file.referralId);
  return access.ok ? document : null;
}

export async function localFileMetadataResponse(user: PipelineUser, id: string) {
  const document = await accessibleLocalFile(user, id);
  if (!document) return Response.json({ error: "File not found." }, { status: 404 });
  const file = document.file;
  return Response.json({ file: {
    document_id: id, file_name: file.name, category: file.category, byte_size: file.sizeBytes,
    content_type: file.contentType, malware_scan_status: "not_scanned", preview_status: "ready", page_count: null, pages: [],
  } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function localFileBytesResponse(user: PipelineUser, id: string) {
  const document = await accessibleLocalFile(user, id);
  const packet = document ? await readLocalReferralPacket(document.hash) : null;
  if (!packet) return Response.json({ error: "File not found." }, { status: 404 });
  return new Response(packet.bytes, { headers: {
    "Content-Type": packet.contentType, "Content-Length": String(packet.size),
    "Content-Disposition": `inline; filename="${packet.filename.replace(/[\r\n"\\]/g, "-").slice(0, 180)}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    "X-Frame-Options": "SAMEORIGIN",
  } });
}
