export type SourceType = "fax" | "email" | "portal" | "manual";

export type PacketStatus =
  | "received"
  | "normalizing"
  | "extracting"
  | "ready_for_review"
  | "reviewed"
  | "failed";

export type ReviewStatus = "pending" | "accepted" | "edited" | "rejected";

export type ReviewAction = "accept" | "edit" | "reject";

export type ExtractorSource = "document_intelligence" | "claude" | "human";

export const documentCategories = [
  "referral_packet",
  "face_sheet",
  "assessment",
  "medication_list",
  "tb_test",
  "signed_admission_agreement",
  "conservatorship_document",
  "lic_602",
  "lic_601_603",
  "provider_form",
  "payer_verification",
  "responsible_party",
  "other",
] as const;
export type DocumentCategory = (typeof documentCategories)[number];

export type UploadFileDescriptor = {
  file_id: string;
  filename: string;
  content_type: string;
  size: number;
  sha256?: string;
  category?: DocumentCategory;
};

export type CreateUploadUrlRequest = {
  packet_id?: string;
  referral_id: string;
  submitting_facility: string;
  source_type: SourceType;
  processing_intent?: "extract_referral" | "preview_only";
  files: UploadFileDescriptor[];
};

export type UploadTarget = {
  file_id: string;
  signed_url: string;
  blob_path: string;
  expires_at: string;
};

export type CreateUploadUrlResponse = {
  packet_id: string;
  uploads: UploadTarget[];
  sentinel_url: string;
};

export type CompleteUploadRequest = {
  packet_id: string;
  uploaded_file_ids: string[];
};

export type CompleteUploadResponse = {
  packet_id: string;
  status: PacketStatus;
  job_run_id?: string;
  documents?: Array<{
    file_id: string;
    document_id: string;
    category: DocumentCategory;
    filename: string;
  }>;
};

export type PacketStatusResponse = {
  packet_id: string;
  status: PacketStatus;
  page_count: number;
  job_run_id?: string;
  counts: {
    fields_total: number;
    pending_review: number;
    conflicts: number;
  };
  failure_reason?: string;
};

export type FieldCandidate = {
  candidate_id: string;
  source: ExtractorSource;
  value: string | null;
  confidence: number;
  source_page_no?: number;
  evidence_url?: string;
};

export type ExtractedField = {
  field_key: string;
  version: number;
  proposed_value: string | null;
  confidence: number;
  review_status: ReviewStatus;
  source_page_no?: number;
  evidence_url?: string;
  is_conflict: boolean;
  candidates: FieldCandidate[];
  final_value?: string | null;
};

export type PacketFieldsResponse = {
  packet_id: string;
  fields: ExtractedField[];
  audit_events?: FieldAuditEvent[];
  packet_completeness: {
    required_total: number;
    required_ready: number;
    missing_items: string[];
  };
  ehr_readiness: {
    ready: boolean;
    blockers: string[];
  };
};

export type ReviewFieldRequest = {
  if_match: number;
  action: ReviewAction;
  value?: string;
  reviewer_id?: string;
};

export type FieldAuditEvent = {
  event_id: string;
  packet_id: string;
  field_key: string;
  action: ReviewAction | "retry";
  reviewer_id: string;
  previous_status?: ReviewStatus;
  next_status?: ReviewStatus;
  previous_value?: string | null;
  next_value?: string | null;
  reason?: string;
  created_at: string;
};

export type ReviewFieldResponse = {
  field_key: string;
  version: number;
  review_status: ReviewStatus;
  final_value: string | null;
  audit_event?: FieldAuditEvent;
};

export type RetryFieldRequest = {
  reviewer_id?: string;
  force_claude?: boolean;
};

export type RetryFieldResponse = {
  field_key: string;
  run_id: string;
  status: "queued";
  audit_event?: FieldAuditEvent;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; status?: number };

export type PacketRecord = {
  packet_id: string;
  referral_id: string;
  submitting_facility: string;
  source_type: SourceType;
  processing_intent?: "extract_referral" | "preview_only";
  status: PacketStatus;
  uploads: UploadTarget[];
  uploaded_file_ids: string[];
  page_count: number;
  job_run_id?: string;
  failure_reason?: string;
  created_at: string;
  updated_at: string;
};

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  const result = await readJsonBody<T>(request);
  return result.ok ? result.value : null;
}

export async function readJsonBody<T>(
  request: Request,
  maxBytes = maxJsonBodyBytes,
): Promise<ValidationResult<T>> {
  const contentLength = request.headers.get("content-length");
  const declaredBytes = contentLength ? Number(contentLength) : 0;

  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    return invalid(`JSON body must be ${formatBytes(maxBytes)} or smaller.`, 413);
  }

  let text: string;

  try {
    text = await request.text();
  } catch {
    return invalid("Invalid JSON body.");
  }

  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return invalid(`JSON body must be ${formatBytes(maxBytes)} or smaller.`, 413);
  }

  if (!text.trim()) {
    return invalid("Invalid JSON body.");
  }

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return invalid("Invalid JSON body.");
  }
}

const sourceTypes: readonly SourceType[] = ["fax", "email", "portal", "manual"];
const reviewActions: readonly ReviewAction[] = ["accept", "edit", "reject"];
export const maxJsonBodyBytes = 64 * 1024;
export const maxUploadFileBytes = 100 * 1024 * 1024;
export const maxUploadFilesPerRequest = 25;
export const maxUploadRequestBytes = 1024 * 1024 * 1024;
export const allowedUploadContentTypes = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/heic",
] as const;

export function validateCreateUploadUrlRequest(
  body: CreateUploadUrlRequest | null,
): ValidationResult<CreateUploadUrlRequest> {
  if (!isPlainObject(body)) return invalid("Invalid JSON body.");

  if (!isNonEmptyString(body.referral_id)) {
    return invalid("referral_id is required.");
  }
  if (!/^\d+$/.test(body.referral_id) || !Number.isSafeInteger(Number(body.referral_id)) || Number(body.referral_id) < 1) {
    return invalid("referral_id must be a positive integer.");
  }

  if (!isNonEmptyString(body.submitting_facility)) {
    return invalid("submitting_facility is required.");
  }

  if (!sourceTypes.includes(body.source_type)) {
    return invalid("source_type must be fax, email, portal, or manual.");
  }

  if (body.processing_intent !== undefined && !["extract_referral", "preview_only"].includes(body.processing_intent)) {
    return invalid("processing_intent must be extract_referral or preview_only.");
  }

  if (!Array.isArray(body.files) || body.files.length === 0) {
    return invalid("At least one file descriptor is required.");
  }

  if (body.files.length > maxUploadFilesPerRequest) {
    return invalid(`At most ${maxUploadFilesPerRequest} files can be requested at once.`, 413);
  }

  const fileIds = new Set<string>();
  let totalBytes = 0;

  for (const file of body.files) {
    if (!isPlainObject(file)) {
      return invalid("Each file descriptor must be an object.");
    }

    if (
      !isNonEmptyString(file.file_id) ||
      !isNonEmptyString(file.filename) ||
      !isNonEmptyString(file.content_type)
    ) {
      return invalid("Each file requires file_id, filename, and content_type.");
    }

    if (file.file_id.length > 128 || file.filename.length > 240) {
      return invalid("File ids and names must stay within safe length limits.");
    }

    if (fileIds.has(file.file_id)) {
      return invalid("file_id values must be unique within the request.");
    }
    fileIds.add(file.file_id);

    if (
      !(allowedUploadContentTypes as readonly string[]).includes(
        file.content_type.toLowerCase(),
      )
    ) {
      return invalid("Unsupported file type. Upload PDF, JPEG, PNG, TIFF, or HEIC packets only.", 415);
    }

    if (!Number.isFinite(file.size) || file.size <= 0) {
      return invalid("Each file requires a positive size.");
    }

    if (!Number.isInteger(file.size)) {
      return invalid("Each file size must be an integer byte count.");
    }

    if (file.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(file.sha256)) {
      return invalid("sha256 must be a lowercase hexadecimal SHA-256 digest.");
    }

    if (file.category !== undefined && !documentCategories.includes(file.category)) {
      return invalid("File category is not supported.");
    }

    if (file.size > maxUploadFileBytes) {
      return invalid("Each file must be 100 MB or smaller.", 413);
    }

    totalBytes += file.size;

    if (totalBytes > maxUploadRequestBytes) {
      return invalid("Upload requests can reserve at most 1 GB at a time.", 413);
    }
  }

  return { ok: true, value: body };
}

export function validateCompleteUploadRequest(
  body: CompleteUploadRequest | null,
): ValidationResult<CompleteUploadRequest> {
  if (!isPlainObject(body)) return invalid("Invalid JSON body.");

  if (!isNonEmptyString(body.packet_id)) {
    return invalid("packet_id is required.");
  }

  if (
    !Array.isArray(body.uploaded_file_ids) ||
    body.uploaded_file_ids.length === 0 ||
    body.uploaded_file_ids.some((fileId) => !isNonEmptyString(fileId))
  ) {
    return invalid("uploaded_file_ids must include at least one file id.");
  }

  if (body.uploaded_file_ids.length > maxUploadFilesPerRequest) {
    return invalid(`At most ${maxUploadFilesPerRequest} file ids can be completed at once.`, 413);
  }

  if (new Set(body.uploaded_file_ids).size !== body.uploaded_file_ids.length) {
    return invalid("uploaded_file_ids must not contain duplicates.");
  }

  return { ok: true, value: body };
}

export function validateReviewFieldRequest(
  body: ReviewFieldRequest | null,
): ValidationResult<ReviewFieldRequest> {
  if (!isPlainObject(body)) return invalid("Invalid JSON body.");

  if (!reviewActions.includes(body.action)) {
    return invalid("action must be accept, edit, or reject.");
  }

  if (!Number.isInteger(body.if_match) || body.if_match < 1) {
    return invalid("if_match must be a positive field version number.");
  }

  if (body.action === "edit" && !isNonEmptyString(body.value)) {
    return invalid("value is required when action is edit.");
  }

  return { ok: true, value: body };
}

export function validateRetryFieldRequest(
  body: RetryFieldRequest | null,
): ValidationResult<RetryFieldRequest> {
  if (!isPlainObject(body)) return invalid("Invalid JSON body.");

  if (body.force_claude !== undefined && typeof body.force_claude !== "boolean") {
    return invalid("force_claude must be true or false.");
  }

  return { ok: true, value: body };
}

export function decodeRouteParam(value: string) {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return "";
  }
}

function invalid(message: string, status?: number): ValidationResult<never> {
  return { ok: false, message, status };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
