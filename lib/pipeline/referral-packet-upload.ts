import type { Referral } from "@/lib/pipeline/referral-types";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import {
  allowedUploadContentTypes,
  type CompleteUploadResponse,
  type CreateUploadUrlResponse,
  type DocumentCategory,
  type PacketFieldsResponse,
  type PacketStatusResponse,
} from "@/lib/extraction/contracts";

export type InitialDocumentCategory = "face_sheet" | "referral_packet";

type PacketUploadResult = {
  packetId: string;
  status: PacketStatusResponse["status"];
  pageCount: number;
  fields?: PacketFieldsResponse;
  document?: NonNullable<CompleteUploadResponse["documents"]>[number];
  mock: boolean;
};

let mutationSequence = 0;

export function createMutationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  mutationSequence += 1;
  return `referral-${Date.now()}-${mutationSequence.toString(36)}`;
}

export async function hashPacket(file: File) {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify packet duplicates.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadReferralPacket(
  referral: Referral,
  file: File,
  sha256: string,
  category: InitialDocumentCategory,
): Promise<PacketUploadResult> {
  const fileId = `file_${createMutationId()}`;
  const reservation = await reserveUpload(referral, file, fileId, sha256, category);
  const target = reservation.uploads.find((upload) => upload.file_id === fileId);
  if (!target) throw new Error("Pipeline did not return an upload target for this packet.");
  const mock = isMockUploadUrl(target.signed_url);

  if (mock) {
    const localUpload = new FormData();
    localUpload.set("packet_id", reservation.packet_id);
    localUpload.set("file_id", fileId);
    localUpload.set("file", file, file.name);
    await fetchPipelineJson(
      "/api/uploads/local",
      { method: "POST", body: localUpload },
      { timeoutMs: 120_000, maxResponseBytes: 256 * 1024 },
    );
  } else {
    await writeReservedBlob(target.signed_url, reservation.sentinel_url, file);
  }

  const completed = await completeUpload(reservation.packet_id, fileId);
  const status = await fetchPipelineJson<PacketStatusResponse>(`/api/packets/${reservation.packet_id}/status`, {
    cache: "no-store",
  }).catch(() => ({
    packet_id: reservation.packet_id,
    status: completed.status,
    page_count: 0,
    counts: { fields_total: 0, pending_review: 0, conflicts: 0 },
  }));
  const fields = ["ready_for_review", "reviewed"].includes(status.status)
    ? await fetchPipelineJson<PacketFieldsResponse>(`/api/packets/${reservation.packet_id}/fields`, { cache: "no-store" }).catch(() => undefined)
    : undefined;

  return {
    packetId: reservation.packet_id,
    status: status.status,
    pageCount: status.page_count,
    fields,
    document: completed.documents?.find((document) => document.file_id === fileId),
    mock,
  };
}

export async function uploadReferralSupportingDocument(
  referral: Referral,
  file: File,
  category: DocumentCategory,
) {
  const fileId = `file_${createMutationId()}`;
  const reservation = await reserveUpload(
    referral,
    file,
    fileId,
    await hashPacket(file),
    category,
    "preview_only",
  );
  const target = reservation.uploads.find((upload) => upload.file_id === fileId);
  if (!target) throw new Error("Pipeline did not return an upload target for this document.");
  if (!isMockUploadUrl(target.signed_url)) {
    await writeReservedBlob(target.signed_url, reservation.sentinel_url, file);
  }
  return completeUpload(reservation.packet_id, fileId);
}

async function reserveUpload(
  referral: Referral,
  file: File,
  fileId: string,
  sha256: string,
  category: DocumentCategory,
  processingIntent?: "preview_only",
) {
  return fetchPipelineJson<CreateUploadUrlResponse>("/api/uploads/create-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      referral_id: String(referral.id),
      submitting_facility: referral.community,
      source_type: "manual",
      ...(processingIntent ? { processing_intent: processingIntent } : {}),
      files: [{
        file_id: fileId,
        filename: file.name,
        content_type: getPacketContentType(file),
        size: file.size,
        sha256,
        category,
      }],
    }),
  });
}

async function completeUpload(packetId: string, fileId: string) {
  return fetchPipelineJson<CompleteUploadResponse>("/api/uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packet_id: packetId, uploaded_file_ids: [fileId] }),
  });
}

async function writeReservedBlob(signedUrl: string, sentinelUrl: string, file: File) {
  await putBlob(signedUrl, file, getPacketContentType(file));
  await putBlob(sentinelUrl, new Blob([]), "application/octet-stream");
}

async function putBlob(url: string, body: Blob, contentType: string) {
  const response = await fetch(url, {
    method: "PUT",
    credentials: "omit",
    headers: {
      "Content-Type": contentType,
      "x-ms-blob-type": "BlockBlob",
    },
    body,
  });
  if (!response.ok) throw new Error("The packet could not be written to secure storage. Retry the upload.");
}

function isMockUploadUrl(url: string) {
  try {
    return new URL(url).hostname === "mock-storage.local";
  } catch {
    return false;
  }
}

export function getPacketContentType(file: Pick<File, "name" | "type">) {
  const type = file.type.trim().toLowerCase();
  if ((allowedUploadContentTypes as readonly string[]).includes(type)) return type;

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "tif" || extension === "tiff") return "image/tiff";
  if (extension === "heic") return "image/heic";
  return "application/octet-stream";
}
