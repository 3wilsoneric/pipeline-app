import { DocumentProcessingError } from "@/lib/extraction/document-processing-error";

export type EvidenceBoundingBox = [number, number, number, number];

export type ExtractionCandidateInput = {
  source: "document_intelligence" | "claude" | "human";
  value: unknown;
  confidence: number;
  source_page?: number;
  evidence_blob_key?: string;
  evidence_bbox?: EvidenceBoundingBox;
};

export type ExtractionFieldInput = {
  field_key: string;
  proposed_value: unknown;
  confidence: number;
  source_page?: number;
  evidence_blob_key?: string;
  evidence_bbox?: EvidenceBoundingBox;
  candidates?: ExtractionCandidateInput[];
};

export type WorkerReport = {
  extraction_job_id: string;
  attempt_count: number;
  attempt_token: string;
  status: "heartbeat" | "succeeded" | "failed";
  provider_job_id?: string;
  error_code?: string;
  retryable?: boolean;
  malware_scan_status?: "clean" | "infected" | "failed";
  verified_sha256?: string;
  page_count?: number;
  preview?: {
    blob_container: string;
    blob_key: string;
    content_type: string;
    pages?: Array<{
      page_number: number;
      blob_container: string;
      blob_key: string;
      content_type: string;
      byte_size?: number;
      width?: number;
      height?: number;
    }>;
  };
  artifacts?: Array<{
    kind: "normalized_page" | "ocr_json" | "preview" | "evidence" | "extraction_output" | "other";
    blob_container: string;
    blob_key: string;
    content_type?: string;
    byte_size?: number;
  }>;
  fields?: ExtractionFieldInput[];
};

export function validateWorkerReport(input: WorkerReport): void {
  validateEnvelope(input);
  if ((input.fields?.length ?? 0) > 1_000) throw new DocumentProcessingError("too_many_fields", 413);
  if ((input.artifacts?.length ?? 0) > 10_000) throw new DocumentProcessingError("too_many_artifacts", 413);
  rejectDuplicateValues(input.fields?.map((field) => field.field_key) ?? [], "duplicate_field_key");
  input.artifacts?.forEach(validateArtifact);
  input.fields?.forEach(validateField);
  if (input.preview) validatePreview(input.preview);
}

function validateEnvelope(input: WorkerReport) {
  if (!input || !isUuid(input.extraction_job_id)) throw new DocumentProcessingError("extraction_job_id_invalid", 400);
  validateAttempt(input);
  validateStatusAndPageCount(input);
  validateDigestAndScan(input);
  validateProviderMetadata(input);
}

function validateAttempt(input: WorkerReport) {
  if (!Number.isInteger(input.attempt_count) || input.attempt_count < 1 || input.attempt_count > 1_000_000) {
    throw new DocumentProcessingError("attempt_count_invalid", 400);
  }
  if (!isUuid(input.attempt_token)) throw new DocumentProcessingError("attempt_token_invalid", 400);
}

function validateStatusAndPageCount(input: WorkerReport) {
  if (!["heartbeat", "succeeded", "failed"].includes(input.status)) throw new DocumentProcessingError("worker_status_invalid", 400);
  if (input.page_count !== undefined && (!Number.isInteger(input.page_count) || input.page_count < 0 || input.page_count > 50_000)) {
    throw new DocumentProcessingError("page_count_invalid", 400);
  }
}

function validateDigestAndScan(input: WorkerReport) {
  if (input.verified_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.verified_sha256)) {
    throw new DocumentProcessingError("verified_sha256_invalid", 400);
  }
  if (input.malware_scan_status !== undefined && !["clean", "infected", "failed"].includes(input.malware_scan_status)) {
    throw new DocumentProcessingError("malware_scan_status_invalid", 400);
  }
}

function validateProviderMetadata(input: WorkerReport) {
  if (input.provider_job_id !== undefined && (!input.provider_job_id || input.provider_job_id.length > 200)) {
    throw new DocumentProcessingError("provider_job_id_invalid", 400);
  }
  if (input.error_code !== undefined && !/^[a-z0-9_]{3,80}$/.test(input.error_code)) {
    throw new DocumentProcessingError("error_code_invalid", 400);
  }
}

function validateArtifact(artifact: NonNullable<WorkerReport["artifacts"]>[number]) {
  if (!["normalized_page", "ocr_json", "preview", "evidence", "extraction_output", "other"].includes(artifact.kind)) {
    throw new DocumentProcessingError("artifact_kind_invalid", 400);
  }
  safeBlobContainer(artifact.blob_container);
  safeBlobKey(artifact.blob_key);
  validateOptionalSize(artifact.byte_size, "artifact_size_invalid");
  validateOptionalContentType(artifact.content_type, "artifact_content_type_invalid");
}

function validateField(field: ExtractionFieldInput) {
  if (!/^[a-z][a-z0-9_.-]{1,127}$/i.test(field.field_key)) throw new DocumentProcessingError("field_key_invalid", 400);
  validateConfidence(field.confidence);
  validateOptionalSourcePage(field.source_page);
  validateOptionalBoundingBox(field.evidence_bbox);
  if (field.evidence_blob_key) safeBlobKey(field.evidence_blob_key);
  if ((field.candidates?.length ?? 0) > 20) throw new DocumentProcessingError("too_many_candidates", 413);
  field.candidates?.forEach(validateCandidate);
}

function validateCandidate(candidate: ExtractionCandidateInput) {
  if (!["document_intelligence", "claude", "human"].includes(candidate.source)) {
    throw new DocumentProcessingError("candidate_source_invalid", 400);
  }
  validateConfidence(candidate.confidence);
  validateOptionalSourcePage(candidate.source_page);
  validateOptionalBoundingBox(candidate.evidence_bbox);
  if (candidate.evidence_blob_key) safeBlobKey(candidate.evidence_blob_key);
}

function validatePreview(preview: NonNullable<WorkerReport["preview"]>) {
  safeBlobContainer(preview.blob_container);
  safeBlobKey(preview.blob_key);
  validateOptionalContentType(preview.content_type, "preview_content_type_invalid");
  if (preview.pages && preview.pages.length > 10_000) throw new DocumentProcessingError("too_many_preview_pages", 413);
  rejectDuplicateValues(preview.pages?.map((page) => String(page.page_number)) ?? [], "duplicate_preview_page");
  preview.pages?.forEach((page) => {
    if (!Number.isInteger(page.page_number) || page.page_number <= 0) throw new DocumentProcessingError("preview_page_invalid", 400);
    safeBlobContainer(page.blob_container);
    safeBlobKey(page.blob_key);
    validateOptionalContentType(page.content_type, "preview_content_type_invalid");
    validateOptionalSize(page.byte_size, "preview_page_size_invalid");
    validateOptionalPositiveInteger(page.width, "preview_page_width_invalid");
    validateOptionalPositiveInteger(page.height, "preview_page_height_invalid");
  });
}

function rejectDuplicateValues(values: string[], code: string) {
  if (new Set(values).size !== values.length) throw new DocumentProcessingError(code, 400);
}

function validateConfidence(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new DocumentProcessingError("confidence_invalid", 400);
}

function validateOptionalSourcePage(value: number | undefined) {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0 || value > 50_000)) {
    throw new DocumentProcessingError("source_page_invalid", 400);
  }
}

function validateOptionalBoundingBox(value: EvidenceBoundingBox | undefined) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== 4 || value.some((coordinate) => !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1)) {
    throw new DocumentProcessingError("evidence_bbox_invalid", 400);
  }
  if (value[0] >= value[2] || value[1] >= value[3]) throw new DocumentProcessingError("evidence_bbox_invalid", 400);
}

function validateOptionalSize(value: number | undefined, code: string) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new DocumentProcessingError(code, 400);
}

function validateOptionalPositiveInteger(value: number | undefined, code: string) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new DocumentProcessingError(code, 400);
}

function validateOptionalContentType(value: string | undefined, code: string) {
  if (value !== undefined && (!value || value.length > 128 || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value))) {
    throw new DocumentProcessingError(code, 400);
  }
}

function safeBlobKey(value: string) {
  if (!value || value.length > 900 || value.includes("..") || /[?#\\]/.test(value)) throw new DocumentProcessingError("blob_key_invalid", 400);
}

function safeBlobContainer(value: string) {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(value)) {
    throw new DocumentProcessingError("blob_container_invalid", 400);
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
