import {
  assessmentToolFieldDefinitions,
  validateAssessmentToolData,
  type AssessmentExtractionContext,
  type AssessmentExtractionField,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
} from "./assessment-tool-schema";
import type {
  AssessmentPatchInput,
  AssessmentWorkflowStatus,
} from "./assessment-records";

type ValidationFailure = { ok: false; message: string; status?: number };
type ValidationSuccess<T> = { ok: true; value: T };
export type AssessmentValidationResult<T> = ValidationFailure | ValidationSuccess<T>;

export type AssessmentCreateRequest = {
  data: Partial<AssessmentToolData>;
  client_mutation_id?: string;
};

export type AssessmentPatchRequest = {
  if_match?: number;
  patch: AssessmentPatchInput;
};

export type AssessmentImportRequest = {
  assessment_id?: string;
  if_match?: number;
  fields: AssessmentExtractionField[];
  context: AssessmentExtractionContext;
  client_mutation_id?: string;
};

const statuses: readonly AssessmentWorkflowStatus[] = ["draft", "needs_review", "complete"];
const knownFieldKeys = new Set(assessmentToolFieldDefinitions.map((definition) => definition.key));
const extractionOwnedFields = new Set<AssessmentToolFieldKey>(["source_file", "match_confidence", "extraction_date"]);

export function validateAssessmentCreateRequest(value: unknown): AssessmentValidationResult<AssessmentCreateRequest> {
  if (!isRecord(value)) return invalid("The assessment request must be an object.");
  if (value.data !== undefined && !isRecord(value.data)) return invalid("data must be an object.");
  const data = (value.data ?? {}) as Partial<AssessmentToolData>;
  const dataResult = validatePartialData(data);
  if (!dataResult.ok) return dataResult;
  const mutationResult = validateMutationId(value.client_mutation_id);
  if (!mutationResult.ok) return mutationResult;
  return {
    ok: true,
    value: {
      data,
      ...(mutationResult.value ? { client_mutation_id: mutationResult.value } : {}),
    },
  };
}

export function validateAssessmentPatchRequest(value: unknown): AssessmentValidationResult<AssessmentPatchRequest> {
  if (!isRecord(value) || !isRecord(value.patch)) return invalid("The assessment patch must be an object.");
  if (!Number.isInteger(value.if_match) || Number(value.if_match) < 1) {
    return invalid("if_match must be a positive version number.");
  }

  const patch = value.patch;
  const allowed = new Set(["data", "resident_key", "status", "accept_pending"]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) return invalid(`Unknown assessment patch field: ${key}.`);
  }
  if (patch.data !== undefined) {
    if (!isRecord(patch.data)) return invalid("patch.data must be an object.");
    const dataResult = validatePartialData(patch.data);
    if (!dataResult.ok) return dataResult;
  }
  if (patch.resident_key !== undefined && patch.resident_key !== null) {
    if (!isBoundedString(patch.resident_key, 256)) return invalid("resident_key is invalid.");
  }
  if (patch.status !== undefined && !statuses.includes(patch.status as AssessmentWorkflowStatus)) {
    return invalid("status is invalid.");
  }
  if (patch.accept_pending !== undefined && typeof patch.accept_pending !== "boolean") {
    return invalid("accept_pending must be true or false.");
  }

  return {
    ok: true,
    value: {
      ...(value.if_match !== undefined ? { if_match: value.if_match as number } : {}),
      patch: patch as AssessmentPatchInput,
    },
  };
}

export function validateAssessmentImportRequest(value: unknown): AssessmentValidationResult<AssessmentImportRequest> {
  if (!isRecord(value)) return invalid("The assessment import request must be an object.");
  if (value.assessment_id !== undefined && !isSafeId(value.assessment_id, 160)) {
    return invalid("assessment_id is invalid.");
  }
  if (value.if_match !== undefined && (!Number.isInteger(value.if_match) || (value.if_match as number) < 1)) {
    return invalid("if_match must be a positive version number.");
  }
  if (value.assessment_id !== undefined && value.if_match === undefined) {
    return invalid("if_match is required when importing into an existing assessment.");
  }
  if (!Array.isArray(value.fields) || value.fields.length < 1 || value.fields.length > 300) {
    return invalid("fields must contain between 1 and 300 extracted values.");
  }

  const fields: AssessmentExtractionField[] = [];
  for (const candidate of value.fields) {
    if (!isRecord(candidate) || !isSafeId(candidate.field_key, 256)) return invalid("Each extracted field needs a valid field_key.");
    for (const field of ["proposed_value", "final_value"] as const) {
      if (candidate[field] !== undefined && candidate[field] !== null && !isBoundedString(candidate[field], 50_000)) {
        return invalid(`${field} is too long.`);
      }
    }
    if (typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
      return invalid("Extracted field confidence must be between 0 and 1.");
    }
    if (candidate.source_page_no !== undefined && (
      typeof candidate.source_page_no !== "number" ||
      !Number.isInteger(candidate.source_page_no) ||
      candidate.source_page_no < 1 ||
      candidate.source_page_no > 100_000
    )) {
      return invalid("source_page_no is invalid.");
    }
    if (candidate.evidence_url !== undefined && !isBoundedString(candidate.evidence_url, 2_000)) {
      return invalid("evidence_url is invalid.");
    }
    fields.push({
      field_key: candidate.field_key as string,
      proposed_value: (candidate.proposed_value ?? null) as string | null,
      ...(candidate.final_value !== undefined ? { final_value: candidate.final_value as string | null } : {}),
      confidence: candidate.confidence,
      review_status: "pending",
      ...(candidate.source_page_no !== undefined ? { source_page_no: candidate.source_page_no as number } : {}),
      ...(candidate.evidence_url !== undefined ? { evidence_url: candidate.evidence_url as string } : {}),
    });
  }

  if (!isRecord(value.context)) return invalid("context must be an object.");
  const context = value.context;
  if (!isBoundedString(context.source_file, 512, true)) return invalid("context.source_file is required.");
  if (context.extraction_date !== undefined && (
    typeof context.extraction_date !== "string" || !Number.isFinite(Date.parse(context.extraction_date))
  )) return invalid("context.extraction_date must be an ISO timestamp.");
  if (context.match_confidence !== undefined && (
    typeof context.match_confidence !== "number" || !Number.isFinite(context.match_confidence) || context.match_confidence < 0 || context.match_confidence > 1
  )) return invalid("context.match_confidence must be between 0 and 1.");
  const mutationResult = validateMutationId(value.client_mutation_id);
  if (!mutationResult.ok) return mutationResult;

  return {
    ok: true,
    value: {
      ...(value.assessment_id ? { assessment_id: value.assessment_id as string } : {}),
      ...(value.if_match !== undefined ? { if_match: value.if_match as number } : {}),
      fields,
      context: {
        source_file: String(context.source_file).trim(),
        extraction_date: typeof context.extraction_date === "string" ? context.extraction_date : new Date().toISOString(),
        ...(typeof context.match_confidence === "number" ? { match_confidence: context.match_confidence } : {}),
      },
      ...(mutationResult.value ? { client_mutation_id: mutationResult.value } : {}),
    },
  };
}

function validatePartialData(value: Record<string, unknown>): AssessmentValidationResult<Partial<AssessmentToolData>> {
  for (const key of Object.keys(value)) {
    if (!knownFieldKeys.has(key as AssessmentToolFieldKey)) return invalid(`Unknown assessment field: ${key}.`);
    if (extractionOwnedFields.has(key as AssessmentToolFieldKey)) return invalid(`${key} is supplied by the extraction job.`);
  }
  const issues = validateAssessmentToolData(value);
  return issues.length > 0
    ? invalid(issues[0].message)
    : { ok: true, value: value as Partial<AssessmentToolData> };
}

function validateMutationId(value: unknown): AssessmentValidationResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return isSafeId(value, 128)
    ? { ok: true, value: value as string }
    : invalid("client_mutation_id is invalid.");
}

function isSafeId(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && /^[a-zA-Z0-9_.:-]+$/.test(value);
}

function isBoundedString(value: unknown, maximum: number, required = false): value is string {
  return typeof value === "string" && value.length <= maximum && (!required || value.trim().length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string, status?: number): ValidationFailure {
  return { ok: false, message, ...(status ? { status } : {}) };
}
