import "server-only";

import { getDocumentFileMetadata, getDocumentOriginalAsset } from "@/lib/extraction/document-assets";
import { getAzureBlobUploadSigner } from "@/lib/extraction/azure-blob";
import {
  meetClientAttachmentDeliveryMode,
  type MeetClientAttachmentDeliveryMode,
} from "@/lib/notifications/meet-client-attachment-policy";
import { listReferralFiles } from "@/lib/pipeline/referral-store";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";

const excludedCategories = new Set<ReferralFile["category"]>(["Assessment"]);
const defaultMaximumAttachmentCount = 20;
const defaultMaximumTotalBytes = 25 * 1024 * 1024;

export type MeetClientAttachmentItem = {
  documentId: string;
  name: string;
  category: ReferralFile["category"];
  contentType: string;
  byteSize: number;
  ready: boolean;
  issue?: "missing_source" | "scan_pending" | "scan_failed" | "infected" | "empty";
};

export type MeetClientAttachmentInventory = {
  files: MeetClientAttachmentItem[];
  totalBytes: number;
  ready: boolean;
  blockers: string[];
  deliveryMode: MeetClientAttachmentDeliveryMode | null;
  largeAttachmentDeliveryConfigured: boolean;
};

export type MeetClientMailAttachment = {
  documentId: string;
  name: string;
  contentType: string;
  byteSize: number;
  sourceUrl: string;
};

export async function getMeetClientAttachmentInventory(
  referral: Referral,
  options: { largeAttachmentDeliveryConfigured?: boolean } = {},
): Promise<MeetClientAttachmentInventory> {
  const result = await listReferralFiles({ referralId: referral.id, limit: 200 });
  const candidates = result.files
    .filter((file) => file.referralId === referral.id)
    .filter((file) => file.sourceSystem === "pipeline" || file.sourceSystem === undefined)
    .filter((file) => !excludedCategories.has(file.category));
  const maximumCount = maximumAttachmentCount();
  const files = await Promise.all(candidates.slice(0, maximumCount).map(toAttachmentItem));
  const totalBytes = files.reduce((total, file) => total + file.byteSize, 0);
  const deliveryMode = files.length > 0 && files.every((file) => file.ready)
    ? meetClientAttachmentDeliveryMode(files)
    : null;
  const largeAttachmentDeliveryConfigured = options.largeAttachmentDeliveryConfigured === true;
  const blockers = attachmentBlockers({
    files,
    totalBytes,
    candidateCount: candidates.length,
    maximumCount,
    deliveryMode,
    largeAttachmentDeliveryConfigured,
  });
  return {
    files,
    totalBytes,
    ready: blockers.length === 0,
    blockers,
    deliveryMode,
    largeAttachmentDeliveryConfigured,
  };
}

export async function prepareMeetClientMailAttachments(
  inventory: MeetClientAttachmentInventory,
): Promise<MeetClientMailAttachment[]> {
  if (!inventory.ready || inventory.files.length === 0) {
    throw new Error(inventory.blockers[0] ?? "The admission packet is not ready to send.");
  }
  return Promise.all(inventory.files.map(async (file) => {
    const asset = await getDocumentOriginalAsset(file.documentId);
    if (!asset || asset.byteSize !== file.byteSize) {
      throw new Error("An admission packet file changed after review. Refresh the chart before sending.");
    }
    return {
      documentId: file.documentId,
      name: safeFileName(file.name),
      contentType: asset.contentType,
      byteSize: file.byteSize,
      sourceUrl: await getAzureBlobUploadSigner().createReadUrl(asset.container, asset.blobKey, 900),
    };
  }));
}

async function toAttachmentItem(file: ReferralFile): Promise<MeetClientAttachmentItem> {
  if (!isDocumentId(file.id)) return unavailableItem(file, "missing_source");
  try {
    const metadata = await getDocumentFileMetadata(file.id, { limit: 1 });
    if (!metadata) return unavailableItem(file, "missing_source");
    const issue = metadataIssue(metadata.malware_scan_status, metadata.byte_size);
    return {
      documentId: metadata.document_id,
      name: metadata.file_name,
      category: file.category,
      contentType: metadata.content_type,
      byteSize: metadata.byte_size,
      ready: issue === undefined,
      ...(issue ? { issue } : {}),
    };
  } catch {
    return unavailableItem(file, "missing_source");
  }
}

function unavailableItem(file: ReferralFile, issue: MeetClientAttachmentItem["issue"]): MeetClientAttachmentItem {
  return {
    documentId: file.id,
    name: file.name,
    category: file.category,
    contentType: file.contentType ?? "application/octet-stream",
    byteSize: file.sizeBytes ?? 0,
    ready: false,
    issue,
  };
}

function metadataIssue(status: string, byteSize: number): MeetClientAttachmentItem["issue"] {
  if (byteSize < 1) return "empty";
  if (status === "infected") return "infected";
  if (status === "failed") return "scan_failed";
  if (status !== "clean") return "scan_pending";
  return undefined;
}

function attachmentBlockers(input: {
  files: MeetClientAttachmentItem[];
  totalBytes: number;
  candidateCount: number;
  maximumCount: number;
  deliveryMode: MeetClientAttachmentDeliveryMode | null;
  largeAttachmentDeliveryConfigured: boolean;
}) {
  const blockers: string[] = [];
  if (input.candidateCount === 0) blockers.push("Attach at least one admission packet document before sending.");
  if (input.candidateCount > input.maximumCount) {
    blockers.push(`The admission packet exceeds the ${input.maximumCount}-file delivery limit.`);
  }
  if (input.files.some((file) => !file.ready)) {
    blockers.push("Every admission packet file must finish safety scanning before sending.");
  }
  if (input.totalBytes > maximumTotalBytes()) {
    blockers.push(`The admission packet exceeds the ${formatMegabytes(maximumTotalBytes())} MB email limit.`);
  }
  if (input.deliveryMode === "draft_upload" && !input.largeAttachmentDeliveryConfigured) {
    blockers.push("Microsoft 365 large-attachment delivery is not configured for this packet size.");
  }
  return blockers;
}

function maximumAttachmentCount() {
  const parsed = Number.parseInt(process.env.PIPELINE_MEET_CLIENT_MAX_ATTACHMENT_COUNT ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(50, Math.max(1, parsed)) : defaultMaximumAttachmentCount;
}

function maximumTotalBytes() {
  const parsed = Number.parseInt(process.env.PIPELINE_MEET_CLIENT_MAX_ATTACHMENT_BYTES ?? "", 10);
  return Number.isInteger(parsed)
    ? Math.min(100 * 1024 * 1024, Math.max(1024 * 1024, parsed))
    : defaultMaximumTotalBytes;
}

function formatMegabytes(bytes: number) {
  return Math.floor(bytes / (1024 * 1024));
}

function safeFileName(value: string) {
  const normalized = value.replace(/[\r\n\\/]/g, "_").trim().slice(0, 180);
  return normalized || "admission-document";
}

function isDocumentId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
