import "server-only";

import { createHash } from "node:crypto";

import { getExtractionBackendMode } from "@/lib/extraction/backend-config";
import type {
  CompleteUploadRequest,
  CreateUploadUrlRequest,
  RetryFieldRequest,
  ReviewFieldRequest,
} from "@/lib/extraction/contracts";
import {
  isReviewFieldReplay,
  resolveReviewFieldOutcome,
} from "@/lib/extraction/contracts";
import {
  completeDurableManualUpload,
  completeDurableUpload,
  createDurableUploadTargets,
  DocumentProcessingError,
  getDurablePacketFields,
  getDurablePacketStatus,
  retryDurableField,
  reviewDurableField,
} from "@/lib/extraction/document-processing";
import {
  completeUpload,
  createUploadTargets,
  getPacketFields,
  getPacketStatus,
  getMockUploadDescriptor,
  recordMockPacketExtraction,
  retryField,
  reviewField,
  seedMockPacketExtraction,
} from "@/lib/extraction/mock-store";
import { ingestLocalPacket } from "@/lib/extraction/local-packet-ingestion";
import {
  getReferralByPacketId,
  patchReferral,
} from "@/lib/pipeline/referral-store";
import type { ExtractedField, PacketFieldsResponse, PacketStatusResponse, ReviewFieldResponse } from "@/lib/extraction/contracts";
import type { Referral } from "@/lib/pipeline/referral-types";

type Actor = { id: string; name: string; email: string };

export function createPacketUpload(input: CreateUploadUrlRequest, actor: Actor) {
  return getExtractionBackendMode() === "mock"
    ? Promise.resolve(createUploadTargets(input))
    : createDurableUploadTargets(input, actor);
}

export function completePacketUpload(input: CompleteUploadRequest) {
  const mode = getExtractionBackendMode();
  if (mode === "mock") return Promise.resolve(completeUpload(input));
  return mode === "manual" ? completeDurableManualUpload(input) : completeDurableUpload(input);
}

export async function ingestLocalMockPacketFile(input: {
  packetId: string;
  fileId: string;
  filename: string;
  bytes: Uint8Array;
}) {
  if (getExtractionBackendMode() !== "mock") {
    throw new DocumentProcessingError(
      "local_ingestion_disabled",
      404,
      "Local packet ingestion is not available for this extraction backend.",
    );
  }

  const descriptor = getMockUploadDescriptor(input.packetId, input.fileId);
  if (!descriptor) {
    throw new DocumentProcessingError("upload_reservation_not_found", 404, "The packet upload reservation was not found.");
  }
  if (descriptor.filename !== input.filename || descriptor.size !== input.bytes.byteLength) {
    throw new DocumentProcessingError(
      "upload_reservation_mismatch",
      409,
      "The selected packet no longer matches its upload reservation.",
    );
  }

  try {
    const result = await ingestLocalPacket({
      packetId: input.packetId,
      fileId: input.fileId,
      filename: descriptor.filename,
      contentType: descriptor.content_type,
      expectedSha256: descriptor.sha256,
      bytes: input.bytes,
    });
    if (!recordMockPacketExtraction({
      packetId: input.packetId,
      fields: result.fields,
      pageCount: result.pageCount,
      documentHash: result.documentHash,
      contentType: descriptor.content_type,
    })) {
      throw new DocumentProcessingError("packet_not_found", 404, "Packet not found.");
    }
    return {
      packet_id: input.packetId,
      file_id: input.fileId,
      status: "ready_for_review" as const,
      page_count: result.pageCount,
      fields_total: result.fields.length,
      ocr_pages: result.ocrPageCount,
    };
  } catch (error) {
    const syntheticFixtureAllowed = process.env.PIPELINE_ENABLE_SYNTHETIC_PROFILES === "true";
    if (
      syntheticFixtureAllowed
      && error instanceof DocumentProcessingError
      && error.code === "uploaded_file_signature_invalid"
    ) {
      seedMockPacketExtraction(input.packetId, 1);
      return {
        packet_id: input.packetId,
        file_id: input.fileId,
        status: "ready_for_review" as const,
        page_count: 1,
        fields_total: 3,
        ocr_pages: 0,
      };
    }
    throw error;
  }
}

export async function readPacketStatus(packetId: string) {
  if (getExtractionBackendMode() !== "mock") return getDurablePacketStatus(packetId);
  return getPacketStatus(packetId) ?? readImportedPacketStatus(packetId);
}

export async function readPacketFields(packetId: string) {
  if (getExtractionBackendMode() !== "mock") return getDurablePacketFields(packetId);
  return getPacketFields(packetId) ?? readImportedPacketFields(packetId);
}

export async function reviewPacketField(packetId: string, fieldKey: string, input: ReviewFieldRequest, actor: Actor) {
  const result = getExtractionBackendMode() !== "mock"
    ? await reviewDurableField(packetId, fieldKey, input, actor)
    : reviewField(packetId, fieldKey, { ...input, reviewer_id: actor.id })
      ?? await reviewImportedPacketField(packetId, fieldKey, input, actor);
  if (!result) return null;

  try {
    const packetFields = await readPacketFields(packetId);
    if (!packetFields) throw new Error("The reviewed packet could not be reloaded for referral synchronization.");
    const projection = await synchronizeReviewedPacket(packetId, packetFields, actor);
    return {
      ...result,
      packet_fields: packetFields,
      referral: projection.referral,
      projection_status: projection.status,
    };
  } catch (error) {
    throw new PacketProjectionPendingError(result, { cause: error });
  }
}

export function retryPacketField(
  packetId: string,
  fieldKey: string,
  input: RetryFieldRequest,
  actor: Actor,
) {
  void input;
  return getExtractionBackendMode() === "mock"
    ? Promise.resolve(retryField(packetId, fieldKey, actor.email))
    : retryDurableField(packetId, fieldKey, actor);
}

export function extractionErrorResponse(error: unknown) {
  if (error instanceof PacketProjectionPendingError) {
    return Response.json({
      error: error.message,
      code: "packet_projection_pending",
      review_saved: true,
      field: {
        field_key: error.review.field_key,
        version: error.review.version,
        review_status: error.review.review_status,
      },
    }, {
      status: 409,
      headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" },
    });
  }
  if (error instanceof DocumentProcessingError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  throw error;
}

async function readImportedPacketStatus(packetId: string): Promise<PacketStatusResponse | null> {
  const referral = await getReferralByPacketId(packetId);
  if (!referral?.packetFields) return null;
  const pending = referral.packetFields.filter((field) => field.review_status === "pending").length;
  return {
    packet_id: packetId,
    status: referral.packetStatus ?? "ready_for_review",
    page_count: 0,
    counts: {
      fields_total: referral.packetFields.length,
      pending_review: pending,
      conflicts: referral.packetFields.filter((field) => field.is_conflict).length,
    },
  };
}

async function readImportedPacketFields(packetId: string): Promise<PacketFieldsResponse | null> {
  const referral = await getReferralByPacketId(packetId);
  if (!referral?.packetFields) return null;
  return {
    packet_id: packetId,
    fields: referral.packetFields,
    packet_completeness: referral.packetCompleteness ?? completenessFromFields(referral.packetFields),
    ehr_readiness: referral.packetReadiness ?? readinessFromFields(referral.packetFields),
  };
}

async function reviewImportedPacketField(
  packetId: string,
  fieldKey: string,
  input: ReviewFieldRequest,
  actor: Actor,
): Promise<ReviewFieldResponse | null> {
  const referral = await getReferralByPacketId(packetId);
  if (!referral?.packetFields) return null;
  const currentField = referral.packetFields.find((field) => field.field_key === fieldKey);
  if (!currentField) return null;
  if (currentField.version !== input.if_match) {
    if (isReviewFieldReplay(currentField, input)) {
      return {
        field_key: fieldKey,
        version: currentField.version,
        review_status: currentField.review_status,
        final_value: currentField.final_value ?? null,
      };
    }
    throw new DocumentProcessingError(
      "field_version_conflict",
      409,
      "This extracted field changed in another session. Review the latest value before saving.",
    );
  }

  const { final_value: finalValue, review_status: reviewStatus } = resolveReviewFieldOutcome(
    currentField.proposed_value,
    input,
  );
  const nextField: ExtractedField = {
    ...currentField,
    version: currentField.version + 1,
    review_status: reviewStatus,
    final_value: finalValue,
  };
  const nextFields = referral.packetFields.map((field) => field.field_key === fieldKey ? nextField : field);
  const mutation = await patchReferral(
    referral.id,
    {
      packetFields: nextFields,
      packetCompleteness: completenessFromFields(nextFields),
      packetReadiness: readinessFromFields(nextFields),
    },
    referral.version,
    { id: actor.id, name: actor.name },
    referral.sectionVersions ? { documents: referral.sectionVersions.documents } : undefined,
    { auditAction: `packet_field_${input.action}`, auditReason: fieldKey },
  );
  if (!mutation) return null;
  if (!mutation.ok) {
    throw new DocumentProcessingError(
      "field_version_conflict",
      409,
      "This extracted field changed in another session. Review the latest value before saving.",
    );
  }
  return {
    field_key: fieldKey,
    version: nextField.version,
    review_status: nextField.review_status,
    final_value: finalValue,
  };
}

class PacketProjectionPendingError extends Error {
  constructor(
    readonly review: ReviewFieldResponse,
    options?: ErrorOptions,
  ) {
    super(
      "The field review was saved, but the referral workspace has not synchronized yet. Retry this review to finish the save.",
      options,
    );
    this.name = "PacketProjectionPendingError";
  }
}

async function synchronizeReviewedPacket(
  packetId: string,
  packetFields: PacketFieldsResponse,
  actor: Actor,
): Promise<{ status: "synchronized" | "not_linked"; referral?: Referral }> {
  const patch = {
    packetFields: packetFields.fields,
    packetCompleteness: packetFields.packet_completeness,
    packetReadiness: packetFields.ehr_readiness,
  };
  const mutationId = packetProjectionMutationId(packetId, packetFields);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const referral = await getReferralByPacketId(packetId);
    if (!referral) return { status: "not_linked" };
    if (packetProjectionMatches(referral, packetFields)) {
      return { status: "synchronized", referral };
    }
    const mutation = await patchReferral(
      referral.id,
      patch,
      referral.version,
      { id: actor.id, name: actor.name },
      referral.sectionVersions ? { documents: referral.sectionVersions.documents } : undefined,
      {
        auditAction: "packet_extraction_projected",
        auditReason: "Reviewed packet evidence synchronized.",
        mutationId,
        mutationScope: "packet_extraction_projection",
      },
    );
    if (!mutation) return { status: "not_linked" };
    if (mutation.ok) return { status: "synchronized", referral: mutation.referral };
  }

  throw new Error("The referral documents section remained busy after three synchronization attempts.");
}

function packetProjectionMatches(referral: Referral, packetFields: PacketFieldsResponse) {
  return JSON.stringify(referral.packetFields ?? null) === JSON.stringify(packetFields.fields)
    && JSON.stringify(referral.packetCompleteness ?? null) === JSON.stringify(packetFields.packet_completeness)
    && JSON.stringify(referral.packetReadiness ?? null) === JSON.stringify(packetFields.ehr_readiness);
}

function packetProjectionMutationId(packetId: string, packetFields: PacketFieldsResponse) {
  return createHash("sha256").update(JSON.stringify([
    packetId,
    packetFields.fields.map((field) => [
      field.field_key,
      field.version,
      field.review_status,
      field.final_value ?? null,
    ]),
    packetFields.packet_completeness,
    packetFields.ehr_readiness,
  ])).digest("hex");
}

function completenessFromFields(fields: ExtractedField[]) {
  const missing_items = fields
    .filter((field) => !(field.final_value ?? field.proposed_value)?.trim())
    .map((field) => field.field_key);
  return {
    required_total: fields.length,
    required_ready: fields.length - missing_items.length,
    missing_items,
  };
}

function readinessFromFields(fields: ExtractedField[]) {
  const pending = fields.filter((field) => field.review_status === "pending");
  const missing = fields.filter((field) => !(field.final_value ?? field.proposed_value)?.trim());
  return {
    ready: pending.length === 0 && missing.length === 0,
    blockers: [
      ...pending.map((field) => `Review ${field.field_key}`),
      ...missing.map((field) => `Missing ${field.field_key}`),
    ],
  };
}
