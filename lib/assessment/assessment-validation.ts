import {
  assessmentToolFieldDefinitions,
  validateAssessmentToolData,
  type AssessmentExtractionContext,
  type AssessmentExtractionField,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
} from "./assessment-tool-schema";
import { isAssessmentToolSection } from "./assessment-sections";
import type { AssessmentToolSection } from "./assessment-tool-schema";
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
  if_match_section?: number;
  section?: AssessmentToolSection;
  assessor_id?: string | null;
  client_mutation_id?: string;
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
const extractionOwnedFields = new Set<AssessmentToolFieldKey>(["assessor", "source_file", "match_confidence", "extraction_date"]);

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
  const section = value.section;
  if (section !== undefined && !isAssessmentToolSection(section)) return invalid("section is invalid.");
  const versionResult = validatePatchVersion(value, section);
  if (!versionResult.ok) return versionResult;
  const patchResult = validatePatchFields(value.patch);
  if (!patchResult.ok) return patchResult;
  const assigneeResult = validatePatchAssignee(value, section);
  if (!assigneeResult.ok) return assigneeResult;
  const mutationResult = validateMutationId(value.client_mutation_id);
  if (!mutationResult.ok) return mutationResult;

  return {
    ok: true,
    value: {
      ...(value.if_match !== undefined ? { if_match: value.if_match as number } : {}),
      ...(value.if_match_section !== undefined ? { if_match_section: value.if_match_section as number } : {}),
      ...(section ? { section } : {}),
      ...(value.assessor_id !== undefined ? { assessor_id: value.assessor_id as string | null } : {}),
      ...(mutationResult.value ? { client_mutation_id: mutationResult.value } : {}),
      patch: value.patch as AssessmentPatchInput,
    },
  };
}

function validatePatchVersion(
  value: Record<string, unknown>,
  section: unknown,
): AssessmentValidationResult<true> {
  if (section !== undefined && (!Number.isInteger(value.if_match_section) || Number(value.if_match_section) < 1)) {
    return invalid("if_match_section must be a positive section version number.");
  }
  if (section === undefined && (!Number.isInteger(value.if_match) || Number(value.if_match) < 1)) {
    return invalid("if_match must be a positive version number.");
  }
  return { ok: true, value: true };
}

function validatePatchFields(patch: Record<string, unknown>): AssessmentValidationResult<true> {
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
  return { ok: true, value: true };
}

function validatePatchAssignee(
  value: Record<string, unknown>,
  section: unknown,
): AssessmentValidationResult<true> {
  if (value.assessor_id !== undefined && value.assessor_id !== null && !isSafePrincipalId(value.assessor_id)) {
    return invalid("assessor_id is invalid.");
  }
  if (section !== undefined && value.assessor_id !== undefined) {
    return invalid("assessor_id cannot be changed in a section save.");
  }
  return { ok: true, value: true };
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
  const fieldsResult = validateImportFields(value.fields);
  if (!fieldsResult.ok) return fieldsResult;
  const contextResult = validateImportContext(value.context);
  if (!contextResult.ok) return contextResult;
  const mutationResult = validateMutationId(value.client_mutation_id);
  if (!mutationResult.ok) return mutationResult;

  return {
    ok: true,
    value: {
      ...(value.assessment_id ? { assessment_id: value.assessment_id as string } : {}),
      ...(value.if_match !== undefined ? { if_match: value.if_match as number } : {}),
      fields: fieldsResult.value,
      context: contextResult.value,
      ...(mutationResult.value ? { client_mutation_id: mutationResult.value } : {}),
    },
  };
}

function validateImportFields(value: unknown): AssessmentValidationResult<AssessmentExtractionField[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 300) {
    return invalid("fields must contain between 1 and 300 extracted values.");
  }
  const fields: AssessmentExtractionField[] = [];
  for (const candidate of value) {
    const result = validateImportField(candidate);
    if (!result.ok) return result;
    fields.push(result.value);
  }
  return { ok: true, value: fields };
}

function validateImportField(value: unknown): AssessmentValidationResult<AssessmentExtractionField> {
  if (!isRecord(value) || !isSafeId(value.field_key, 256)) {
    return invalid("Each extracted field needs a valid field_key.");
  }
  for (const field of ["proposed_value", "final_value"] as const) {
    if (value[field] !== undefined && value[field] !== null && !isBoundedString(value[field], 50_000)) {
      return invalid(`${field} is too long.`);
    }
  }
  if (!isConfidence(value.confidence)) {
    return invalid("Extracted field confidence must be between 0 and 1.");
  }
  if (value.source_page_no !== undefined && !isPageNumber(value.source_page_no)) {
    return invalid("source_page_no is invalid.");
  }
  if (value.evidence_url !== undefined && !isBoundedString(value.evidence_url, 2_000)) {
    return invalid("evidence_url is invalid.");
  }
  return {
    ok: true,
    value: {
      field_key: value.field_key,
      proposed_value: (value.proposed_value ?? null) as string | null,
      ...(value.final_value !== undefined ? { final_value: value.final_value as string | null } : {}),
      confidence: value.confidence,
      review_status: "pending",
      ...(value.source_page_no !== undefined ? { source_page_no: value.source_page_no } : {}),
      ...(value.evidence_url !== undefined ? { evidence_url: value.evidence_url } : {}),
    },
  };
}

function validateImportContext(value: unknown): AssessmentValidationResult<AssessmentExtractionContext> {
  if (!isRecord(value)) return invalid("context must be an object.");
  if (!isBoundedString(value.source_file, 512, true)) return invalid("context.source_file is required.");
  if (value.extraction_date !== undefined && !isTimestamp(value.extraction_date)) {
    return invalid("context.extraction_date must be an ISO timestamp.");
  }
  if (value.match_confidence !== undefined && !isConfidence(value.match_confidence)) {
    return invalid("context.match_confidence must be between 0 and 1.");
  }
  return {
    ok: true,
    value: {
      source_file: value.source_file.trim(),
      extraction_date: typeof value.extraction_date === "string" ? value.extraction_date : new Date().toISOString(),
      ...(typeof value.match_confidence === "number" ? { match_confidence: value.match_confidence } : {}),
    },
  };
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPageNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100_000;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validatePartialData(value: Record<string, unknown>): AssessmentValidationResult<Partial<AssessmentToolData>> {
  for (const key of Object.keys(value)) {
    if (!knownFieldKeys.has(key as AssessmentToolFieldKey)) return invalid(`Unknown assessment field: ${key}.`);
    if (key === "assessor") return invalid("assessor must be assigned from active workspace members.");
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

function isSafePrincipalId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[a-zA-Z0-9_.:@-]+$/.test(value);
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
