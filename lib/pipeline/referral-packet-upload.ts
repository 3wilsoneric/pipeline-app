import type { Referral } from "@/lib/pipeline/referral-types";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import {
  allowedUploadContentTypes,
  isUploadContentType,
  referralDocumentAutofillEnabled,
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
const activeUploads = new Map<string, Promise<UploadedFile>>();
// Match the local upload allowance. If legitimate large mobile uploads repeatedly
// exceed this per-attempt limit, revisit with progress-aware transfers.
const blobUploadTimeoutMs = 120_000;

type UploadedFile = {
  packetId: string;
  fileId: string;
  completed: CompleteUploadResponse;
  mock: boolean;
};

export function createMutationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  mutationSequence += 1;
  return `referral-${Date.now()}-${mutationSequence.toString(36)}`;
}

export async function hashPacket(file: File) {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify file integrity.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadReferralPacket(
  referral: Referral,
  file: File,
  sha256: string,
  category: InitialDocumentCategory,
): Promise<PacketUploadResult> {
  const { packetId, fileId, completed, mock } = await uploadFileOnce(referral, file, sha256, category, referralDocumentAutofillEnabled ? undefined : "preview_only");
  if (!referralDocumentAutofillEnabled) return {
    packetId, status: completed.status, pageCount: 0,
    document: completed.documents?.find((document) => document.file_id === fileId), mock,
  };
  const status = await fetchPipelineJson<PacketStatusResponse>(`/api/packets/${packetId}/status`, {
    cache: "no-store",
  }).catch(() => ({
    packet_id: packetId,
    status: completed.status,
    page_count: 0,
    counts: { fields_total: 0, pending_review: 0, conflicts: 0 },
  }));
  const fields = ["ready_for_review", "reviewed"].includes(status.status)
    ? await fetchPipelineJson<PacketFieldsResponse>(`/api/packets/${packetId}/fields`, { cache: "no-store" }).catch(() => undefined)
    : undefined;

  return {
    packetId,
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
  const uploaded = await uploadFileOnce(referral, file, await hashPacket(file), category, "preview_only");
  return uploaded.completed;
}

async function uploadFileOnce(referral: Referral, file: File, sha256: string, category: DocumentCategory, processingIntent?: "preview_only") {
  if (referral.workspaceStatus === "historical") {
    throw new Error("Files in this imported chart are read-only. Add new files to the current referral.");
  }
  // Stable across retries/reloads, but never deduplicated across referrals or file roles.
  const packetId = await uploadIdentity(referral.id, file, sha256, category, processingIntent);
  const existing = activeUploads.get(packetId);
  if (existing) return existing;
  const operation = writeUpload(referral, file, sha256, category, packetId, processingIntent);
  activeUploads.set(packetId, operation);
  try {
    return await operation;
  } finally {
    activeUploads.delete(packetId);
  }
}

async function uploadIdentity(referralId: number, file: File, sha256: string, category: DocumentCategory, processingIntent?: "preview_only") {
  const key = JSON.stringify(["pipeline-file-v1", referralId, sha256, file.name, file.size, getPacketContentType(file), category, processingIntent ?? "extract_referral"]);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function writeUpload(referral: Referral, file: File, sha256: string, category: DocumentCategory, packetId: string, processingIntent?: "preview_only"): Promise<UploadedFile> {
  const fileId = `file_${packetId}`;
  const reservation = await reserveUpload(referral, file, fileId, sha256, category, packetId, processingIntent);
  const target = reservation.uploads.find((upload) => upload.file_id === fileId);
  if (!target) throw new Error("Pipeline did not return an upload target for this document.");
  const mock = isMockUploadUrl(target.signed_url);
  if (mock) {
    await writeLocalReservedFile(reservation.packet_id, fileId, file);
  } else {
    await writeReservedBlob(target.signed_url, reservation.sentinel_url, file);
  }
  const completed = await completeUpload(reservation.packet_id, fileId);
  return { packetId: reservation.packet_id, fileId, completed, mock };
}

async function writeLocalReservedFile(packetId: string, fileId: string, file: File) {
  const localUpload = new FormData();
  localUpload.set("packet_id", packetId);
  localUpload.set("file_id", fileId);
  localUpload.set("file", file, file.name);
  await fetchPipelineJson(
    "/api/uploads/local",
    { method: "POST", body: localUpload },
    { timeoutMs: 120_000, maxResponseBytes: 256 * 1024 },
  );
}

async function reserveUpload(
  referral: Referral,
  file: File,
  fileId: string,
  sha256: string,
  category: DocumentCategory,
  packetId: string,
  processingIntent?: "preview_only",
) {
  return retryIdempotentOperation(() => fetchPipelineJson<CreateUploadUrlResponse>("/api/uploads/create-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      packet_id: packetId,
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
  }), isRetryablePipelineError);
}

async function completeUpload(packetId: string, fileId: string) {
  return retryIdempotentOperation(() => fetchPipelineJson<CompleteUploadResponse>("/api/uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packet_id: packetId, uploaded_file_ids: [fileId] }),
  }), isRetryablePipelineError);
}

async function writeReservedBlob(signedUrl: string, sentinelUrl: string, file: File) {
  await putBlob(signedUrl, file, getPacketContentType(file));
  await putBlob(sentinelUrl, new Blob([]), "application/octet-stream");
}

async function putBlob(url: string, body: Blob, contentType: string) {
  await retryIdempotentOperation(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), blobUploadTimeoutMs);
    try {
      const response = await fetch(url, {
        method: "PUT",
        credentials: "omit",
        headers: {
          "Content-Type": contentType,
          "x-ms-blob-type": "BlockBlob",
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new PipelineApiError("The packet could not be written to secure storage. Retry the upload.", response.status);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new PipelineApiError("The file upload timed out. Your file is still queued; retry the upload.", 408);
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }, (error) => {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    return status === 0 || status === 408 || status === 429 || status >= 500;
  });
}

async function retryIdempotentOperation<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  maximumAttempts = 3,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= maximumAttempts || !shouldRetry(error)) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw lastError;
}

function isRetryablePipelineError(error: unknown) {
  return error instanceof PipelineApiError
    && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
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
  if (isUploadContentType(type)) return type;
  return "application/octet-stream";
}
