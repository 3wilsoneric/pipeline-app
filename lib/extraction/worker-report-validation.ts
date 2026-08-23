import { DocumentProcessingError } from "@/lib/extraction/document-processing-error";

export type ExtractionCandidateInput = {
  source: "document_intelligence" | "claude" | "human";
  value: unknown;
  confidence: number;
  source_page?: number;
  evidence_blob_key?: string;
};

export type ExtractionFieldInput = {
  field_key: string;
  proposed_value: unknown;
  confidence: number;
  source_page?: number;
  evidence_blob_key?: string;
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
  if (!input || !isUuid(input.extraction_job_id)) throw new DocumentProcessingError("extraction_job_id_invalid", 400);
  if (!Number.isInteger(input.attempt_count) || input.attempt_count < 1 || input.attempt_count > 1_000_000) {
    throw new DocumentProcessingError("attempt_count_invalid", 400);
  }
  if (!isUuid(input.attempt_token)) throw new DocumentProcessingError("attempt_token_invalid", 400);
  if (!["heartbeat", "succeeded", "failed"].includes(input.status)) throw new DocumentProcessingError("worker_status_invalid", 400);
  if (input.page_count !== undefined && (!Number.isInteger(input.page_count) || input.page_count < 0 || input.page_count > 50_000)) {
    throw new DocumentProcessingError("page_count_invalid", 400);
  }
  if (input.verified_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.verified_sha256)) {
    throw new DocumentProcessingError("verified_sha256_invalid", 400);
  }
  if (input.malware_scan_status !== undefined && !["clean", "infected", "failed"].includes(input.malware_scan_status)) {
    throw new DocumentProcessingError("malware_scan_status_invalid", 400);
  }
  if ((input.fields?.length ?? 0) > 1_000) throw new DocumentProcessingError("too_many_fields", 413);
  if ((input.artifacts?.length ?? 0) > 10_000) throw new DocumentProcessingError("too_many_artifacts", 413);
  rejectDuplicateValues(input.fields?.map((field) => field.field_key) ?? [], "duplicate_field_key");
  for (const artifact of input.artifacts ?? []) {
    if (!["normalized_page", "ocr_json", "preview", "evidence", "extraction_output", "other"].includes(artifact.kind)) {
      throw new DocumentProcessingError("artifact_kind_invalid", 400);
    }
    safeBlobContainer(artifact.blob_container);
    safeBlobKey(artifact.blob_key);
    if (artifact.byte_size !== undefined && (!Number.isSafeInteger(artifact.byte_size) || artifact.byte_size < 0)) {
      throw new DocumentProcessingError("artifact_size_invalid", 400);
    }
    if (artifact.content_type !== undefined && (!artifact.content_type || artifact.content_type.length > 128)) {
      throw new DocumentProcessingError("artifact_content_type_invalid", 400);
    }
  }
  for (const field of input.fields ?? []) {
    if (!/^[a-z][a-z0-9_.-]{1,127}$/i.test(field.field_key)) throw new DocumentProcessingError("field_key_invalid", 400);
    validateConfidence(field.confidence);
    if ((field.candidates?.length ?? 0) > 20) throw new DocumentProcessingError("too_many_candidates", 413);
    field.candidates?.forEach((candidate) => {
      if (!["document_intelligence", "claude", "human"].includes(candidate.source)) {
        throw new DocumentProcessingError("candidate_source_invalid", 400);
      }
      validateConfidence(candidate.confidence);
    });
    if (field.evidence_blob_key) safeBlobKey(field.evidence_blob_key);
  }
  if (input.preview) {
    safeBlobContainer(input.preview.blob_container);
    safeBlobKey(input.preview.blob_key);
    if (input.preview.pages && input.preview.pages.length > 10_000) throw new DocumentProcessingError("too_many_preview_pages", 413);
    rejectDuplicateValues(input.preview.pages?.map((page) => String(page.page_number)) ?? [], "duplicate_preview_page");
    input.preview.pages?.forEach((page) => {
      if (!Number.isInteger(page.page_number) || page.page_number <= 0) throw new DocumentProcessingError("preview_page_invalid", 400);
      safeBlobContainer(page.blob_container);
      safeBlobKey(page.blob_key);
    });
  }
}

function rejectDuplicateValues(values: string[], code: string) {
  if (new Set(values).size !== values.length) throw new DocumentProcessingError(code, 400);
}

function validateConfidence(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new DocumentProcessingError("confidence_invalid", 400);
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
