import "server-only";
import { createHash } from "node:crypto";

import { getDocumentFileMetadata, getDocumentOriginalAsset } from "@/lib/extraction/document-assets";
import { getAzureBlobUploadSigner } from "@/lib/extraction/azure-blob";
import { isDocumentContentAvailable } from "@/lib/extraction/document-access-policy";
import {
  admissionPacketDeliveryMode,
  type MeetClientAttachmentDeliveryMode,
} from "@/lib/notifications/meet-client-attachment-policy";
import { listReferralFiles } from "@/lib/pipeline/referral-store";
import type { Referral, ReferralFile } from "@/lib/pipeline/referral-types";
import type { AssessmentSummaryReport } from "@/lib/assessment/assessment-summary";
import { clientDataSheetName, renderClientDataSheet } from "./client-data-sheet";


export type MeetClientAttachmentItem = {
  documentId: string;
  name: string;
  category: ReferralFile["category"];
  contentType: string;
  byteSize: number;
  ready: boolean;
  generatedContent?: Buffer;
  issue?: "missing_source" | "scan_pending" | "scan_failed" | "infected" | "empty";
};

export type MeetClientAttachmentInventory = {
  files: MeetClientAttachmentItem[];
  revision: string;
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
  sourceHeaders?: Record<string, string>;
} & ({ sourceUrl: string; contentBytes?: never } | { contentBytes: Buffer; sourceUrl?: never });

export async function getMeetClientAttachmentInventory(
  referral: Referral,
  options: { largeAttachmentDeliveryConfigured?: boolean; report?: AssessmentSummaryReport | null } = {},
): Promise<MeetClientAttachmentInventory> {
  const candidates = new Map<string, ReferralFile>();
  const files: MeetClientAttachmentItem[] = [];
  let cursor: string | undefined;
  do {
    const result = await listReferralFiles({ referralId: referral.id, limit: 200, cursor });
    const page = result.files.filter((file) => {
      if (file.referralId !== referral.id || candidates.has(file.id)) return false;
      candidates.set(file.id, file);
      return true;
    });
    files.push(...await Promise.all(page.map(toAttachmentItem)));
    cursor = result.next_cursor;
  } while (cursor);
  const generatedContent = await renderClientDataSheet(options.report ?? null, referral);
  files.unshift({ documentId: `chart:${referral.id}:${referral.version}:${options.report?.assessmentVersion ?? 0}`, name: clientDataSheetName,
    category: "Assessment", contentType: "application/pdf", byteSize: generatedContent.length, ready: true, generatedContent });
  const totalBytes = files.reduce((total, file) => total + file.byteSize, 0);
  const deliveryMode = files.length > 0 && files.every((file) => file.ready)
    ? admissionPacketDeliveryMode(files, options.largeAttachmentDeliveryConfigured === true)
    : null;
  const largeAttachmentDeliveryConfigured = options.largeAttachmentDeliveryConfigured === true;
  const blockers = files.some((file) => !file.ready) ? ["A packet file is missing, empty, or awaiting a safety review. Review the listed files and try again."] : [];
  if (candidates.size === 0) blockers.unshift("Upload at least one file to this workspace before sending the admission packet.");
  return {
    files,
    revision: createHash("sha256").update(JSON.stringify(files.map((file) => [file.documentId, file.name, file.byteSize, file.contentType, file.ready]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest("hex"),
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
    if (file.generatedContent !== undefined) return {
      documentId: file.documentId, name: file.name, contentType: file.contentType, byteSize: file.byteSize,
      contentBytes: file.generatedContent,
    };
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
  if (!isDocumentContentAvailable(status)) return "scan_pending";
  return undefined;
}

function safeFileName(value: string) {
  const normalized = value.replace(/[\r\n\\/]/g, "_").trim().slice(0, 180);
  return normalized || "admission-document";
}

function isDocumentId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
