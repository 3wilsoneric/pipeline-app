import {
  CompleteUploadRequest,
  CreateUploadUrlRequest,
  CreateUploadUrlResponse,
  ExtractedField,
  FieldAuditEvent,
  PacketFieldsResponse,
  PacketRecord,
  PacketStatusResponse,
  ReviewFieldRequest,
  ReviewFieldResponse,
  RetryFieldResponse,
  UploadFileDescriptor,
  UploadTarget,
} from "./contracts";
import { DocumentProcessingError } from "./document-processing";
import { registerMockPacketReferral, unregisterMockPacketReferral } from "./packet-referral";
import { toPipelinePath } from "@/lib/pipeline/base-path";

type MockExtractionState = {
  packets: Map<string, PacketRecord>;
  fields: Map<string, ExtractedField[]>;
  auditEvents: Map<string, FieldAuditEvent[]>;
  uploadDescriptors: Map<string, UploadFileDescriptor[]>;
};

const globalForExtraction = globalThis as typeof globalThis & {
  __pipelineMockExtraction?: MockExtractionState;
};

const mockState =
  globalForExtraction.__pipelineMockExtraction ??
  (globalForExtraction.__pipelineMockExtraction = {
    packets: new Map<string, PacketRecord>(),
    fields: new Map<string, ExtractedField[]>(),
    auditEvents: new Map<string, FieldAuditEvent[]>(),
    uploadDescriptors: new Map<string, UploadFileDescriptor[]>(),
  });

mockState.auditEvents ??= new Map<string, FieldAuditEvent[]>();
mockState.uploadDescriptors ??= new Map<string, UploadFileDescriptor[]>();

const packets = mockState.packets;
const fields = mockState.fields;
const auditEvents = mockState.auditEvents;
const uploadDescriptors = mockState.uploadDescriptors;
const maxMockPackets = 1000;

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function reviewerId(value: string | undefined) {
  return value?.trim() || "system";
}

function expiresAt() {
  return new Date(Date.now() + 15 * 60 * 1000).toISOString();
}

function sanitizePathPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extensionFor(filename: string) {
  const match = filename.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? "bin";
}

function mockSignedUrl(blobPath: string) {
  return `https://mock-storage.local/${encodeURIComponent(blobPath)}?mock_sas=replace-with-azure`;
}

function pruneMockState() {
  while (packets.size > maxMockPackets) {
    const oldestPacketId = packets.keys().next().value as string | undefined;
    if (!oldestPacketId) return;

    packets.delete(oldestPacketId);
    fields.delete(oldestPacketId);
    auditEvents.delete(oldestPacketId);
    uploadDescriptors.delete(oldestPacketId);
    unregisterMockPacketReferral(oldestPacketId);
  }
}

function seedFields(packetId: string) {
  if (fields.has(packetId)) return;

  fields.set(packetId, [
    {
      field_key: "demographics.first_name",
      version: 1,
      proposed_value: "Robert",
      confidence: 0.94,
      review_status: "pending",
      source_page_no: 1,
      evidence_url: toPipelinePath(`/api/packets/${packetId}/evidence/demographics.first_name`),
      is_conflict: false,
      candidates: [
        {
          candidate_id: "cand_first_name_di",
          source: "document_intelligence",
          value: "Robert",
          confidence: 0.94,
          source_page_no: 1,
          evidence_url: toPipelinePath(`/api/packets/${packetId}/evidence/demographics.first_name`),
        },
      ],
    },
    {
      field_key: "demographics.date_of_birth",
      version: 1,
      proposed_value: "1951-08-14",
      confidence: 0.82,
      review_status: "pending",
      source_page_no: 1,
      evidence_url: toPipelinePath(`/api/packets/${packetId}/evidence/demographics.date_of_birth`),
      is_conflict: true,
      candidates: [
        {
          candidate_id: "cand_dob_di",
          source: "document_intelligence",
          value: "1951-08-14",
          confidence: 0.82,
          source_page_no: 1,
        },
        {
          candidate_id: "cand_dob_claude",
          source: "claude",
          value: "1951-08-14",
          confidence: 0.88,
          source_page_no: 1,
        },
      ],
    },
    {
      field_key: "packet_completeness.med_list_received",
      version: 1,
      proposed_value: "true",
      confidence: 0.96,
      review_status: "pending",
      source_page_no: 2,
      is_conflict: false,
      candidates: [
        {
          candidate_id: "cand_med_list_received",
          source: "document_intelligence",
          value: "true",
          confidence: 0.96,
          source_page_no: 2,
        },
      ],
    },
  ]);
}

function addAuditEvent(event: Omit<FieldAuditEvent, "event_id" | "created_at">) {
  const createdAt = now();
  const auditEvent: FieldAuditEvent = {
    ...event,
    event_id: makeId("audit"),
    created_at: createdAt,
  };
  const packetEvents = auditEvents.get(event.packet_id) ?? [];
  auditEvents.set(event.packet_id, [auditEvent, ...packetEvents]);

  return auditEvent;
}

export function createUploadTargets(
  input: CreateUploadUrlRequest,
): CreateUploadUrlResponse {
  const packetId = input.packet_id ?? makeId("pkt");
  const existingPacket = input.packet_id ? packets.get(input.packet_id) : null;

  if (existingPacket) {
    return {
      packet_id: existingPacket.packet_id,
      uploads: existingPacket.uploads,
      sentinel_url: mockSignedUrl(
        `raw/${sanitizePathPart(existingPacket.submitting_facility)}/${existingPacket.packet_id}/.upload-complete`,
      ),
    };
  }

  const facility = sanitizePathPart(input.submitting_facility || "unknown");
  const uploadTargets: UploadTarget[] = input.files.map((file) => {
    const ext = extensionFor(file.filename);
    const blobPath = `raw/${facility}/${packetId}/original/${file.file_id}.${ext}`;

    return {
      file_id: file.file_id,
      signed_url: mockSignedUrl(blobPath),
      blob_path: blobPath,
      expires_at: expiresAt(),
    };
  });
  const timestamp = now();

  packets.set(packetId, {
    packet_id: packetId,
    referral_id: input.referral_id,
    submitting_facility: input.submitting_facility,
    source_type: input.source_type,
    status: "received",
    uploads: uploadTargets,
    uploaded_file_ids: [],
    page_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
  });
  registerMockPacketReferral(packetId, input.referral_id);
  uploadDescriptors.set(packetId, input.files.map((file) => ({ ...file })));
  pruneMockState();

  return {
    packet_id: packetId,
    uploads: uploadTargets,
    sentinel_url: mockSignedUrl(`raw/${facility}/${packetId}/.upload-complete`),
  };
}

export function completeUpload(input: CompleteUploadRequest) {
  const existingPacket = packets.get(input.packet_id);
  if (!existingPacket) return null;

  if (
    existingPacket.job_run_id &&
    hasSameFileIds(existingPacket.uploaded_file_ids, input.uploaded_file_ids)
  ) {
    return {
      packet_id: input.packet_id,
      status: existingPacket.status,
      job_run_id: existingPacket.job_run_id,
    };
  }

  const jobRunId = makeId("mock_run");
  const updated: PacketRecord = {
    ...existingPacket,
    uploaded_file_ids: input.uploaded_file_ids,
    status: "ready_for_review",
    page_count: existingPacket.page_count || Math.max(1, input.uploaded_file_ids.length * 3),
    job_run_id: jobRunId,
    updated_at: now(),
  };

  packets.set(input.packet_id, updated);
  if (!fields.has(input.packet_id)) seedFields(input.packet_id);

  return {
    packet_id: input.packet_id,
    status: updated.status,
    job_run_id: jobRunId,
  };
}

export function getMockUploadDescriptor(packetId: string, fileId: string) {
  return uploadDescriptors.get(packetId)?.find((file) => file.file_id === fileId) ?? null;
}

export function recordMockPacketExtraction(input: {
  packetId: string;
  fields: ExtractedField[];
  pageCount: number;
}) {
  const packet = packets.get(input.packetId);
  if (!packet) return false;
  fields.set(input.packetId, input.fields.map((field) => ({
    ...field,
    candidates: field.candidates.map((candidate) => ({ ...candidate })),
  })));
  packets.set(input.packetId, {
    ...packet,
    status: "ready_for_review",
    page_count: input.pageCount,
    updated_at: now(),
  });
  return true;
}

export function seedMockPacketExtraction(packetId: string, pageCount = 1) {
  const packet = packets.get(packetId);
  if (!packet) return false;
  seedFields(packetId);
  packets.set(packetId, {
    ...packet,
    status: "ready_for_review",
    page_count: pageCount,
    updated_at: now(),
  });
  return true;
}

export function getPacketStatus(packetId: string): PacketStatusResponse | null {
  const packet = packets.get(packetId);
  if (!packet) return null;

  const packetFields = fields.get(packetId) ?? [];
  const pending = packetFields.filter(
    (field) => field.review_status === "pending",
  ).length;
  const conflicts = packetFields.filter(
    (field) => field.is_conflict && field.review_status === "pending",
  ).length;

  return {
    packet_id: packet.packet_id,
    status: packet.status,
    page_count: packet.page_count,
    job_run_id: packet.job_run_id,
    counts: {
      fields_total: packetFields.length,
      pending_review: pending,
      conflicts,
    },
    failure_reason: packet.failure_reason,
  };
}

export function getPacketFields(packetId: string): PacketFieldsResponse | null {
  if (!packets.has(packetId)) return null;

  seedFields(packetId);

  const packetFields = fields.get(packetId) ?? [];
  const missingItems = packetFields
    .filter((field) => field.proposed_value === null)
    .map((field) => field.field_key);
  const pendingCritical = packetFields.filter(
    (field) => field.review_status === "pending",
  );

  return {
    packet_id: packetId,
    fields: packetFields,
    audit_events: auditEvents.get(packetId) ?? [],
    packet_completeness: {
      required_total: packetFields.length,
      required_ready: packetFields.length - missingItems.length,
      missing_items: missingItems,
    },
    ehr_readiness: {
      ready: pendingCritical.length === 0 && missingItems.length === 0,
      blockers: [
        ...pendingCritical.map((field) => `Review ${field.field_key}`),
        ...missingItems.map((fieldKey) => `Missing ${fieldKey}`),
      ],
    },
  };
}

export function reviewField(
  packetId: string,
  fieldKey: string,
  input: ReviewFieldRequest,
): ReviewFieldResponse | null {
  const packetFields = fields.get(packetId);
  if (!packetFields) return null;

  const field = packetFields.find((item) => item.field_key === fieldKey);
  if (!field) return null;
  if (field.version !== input.if_match) {
    throw new DocumentProcessingError(
      "field_version_conflict",
      409,
      "This extracted field changed in another session. Review the latest value before saving.",
    );
  }
  const previousStatus = field.review_status;
  const previousValue = field.final_value ?? field.proposed_value;

  const finalValue =
    input.action === "reject"
      ? null
      : input.action === "edit"
        ? input.value ?? field.proposed_value
        : field.proposed_value;
  const reviewStatus =
    input.action === "edit"
      ? "edited"
      : input.action === "reject"
        ? "rejected"
        : "accepted";

  field.review_status = reviewStatus;
  field.final_value = finalValue;
  field.version += 1;
  const auditEvent = addAuditEvent({
    packet_id: packetId,
    field_key: fieldKey,
    action: input.action,
    reviewer_id: reviewerId(input.reviewer_id),
    previous_status: previousStatus,
    next_status: reviewStatus,
    previous_value: previousValue,
    next_value: finalValue,
  });

  return {
    field_key: fieldKey,
    version: field.version,
    review_status: reviewStatus,
    final_value: finalValue,
    audit_event: auditEvent,
  };
}

export function retryField(
  packetId: string,
  fieldKey: string,
  reviewer?: string,
): RetryFieldResponse | null {
  if (!packets.has(packetId)) return null;
  const packetFields = fields.get(packetId);
  const field = packetFields?.find((item) => item.field_key === fieldKey);
  if (!field) return null;
  const auditEvent = addAuditEvent({
    packet_id: packetId,
    field_key: fieldKey,
    action: "retry",
    reviewer_id: reviewerId(reviewer),
    previous_status: field.review_status,
    next_status: field.review_status,
    previous_value: field.final_value ?? field.proposed_value,
    next_value: field.final_value ?? field.proposed_value,
    reason: "Field retry queued",
  });

  return {
    field_key: fieldKey,
    run_id: makeId("retry_run"),
    status: "queued",
    audit_event: auditEvent,
  };
}

function hasSameFileIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;

  const rightIds = new Set(right);
  return left.every((fileId) => rightIds.has(fileId));
}
