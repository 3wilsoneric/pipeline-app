import type {
  ResidentLinkCreateInput,
  ResidentLinkMatchMethod,
  ResidentLinkReviewInput,
} from "./resident-link-records";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; status: number };

const matchMethods: readonly ResidentLinkMatchMethod[] = [
  "resident_number_exact",
  "manual",
  "imported",
];

export function validateResidentLinkCreate(value: unknown): ValidationResult<ResidentLinkCreateInput & { client_mutation_id?: string }> {
  const row = record(value);
  if (!row) return invalid("The resident-link request must be an object.");

  const pipelineClientId = identifier(row.pipeline_client_id, "pipeline_client_id", 128);
  if (!pipelineClientId.ok) return pipelineClientId;
  const displayName = text(row.display_name, "display_name", 400);
  if (!displayName.ok) return displayName;
  const residentKey = identifier(row.resident_key, "resident_key", 256);
  if (!residentKey.ok) return residentKey;
  const communityId = identifier(row.community_id, "community_id", 128);
  if (!communityId.ok) return communityId;

  if (typeof row.match_method !== "string" || !matchMethods.includes(row.match_method as ResidentLinkMatchMethod)) {
    return invalid("match_method must be resident_number_exact, manual, or imported.");
  }

  const residentNumber = nullableIdentifier(row.resident_number, "resident_number", 128);
  if (!residentNumber.ok) return residentNumber;
  if (row.match_method === "resident_number_exact" && !residentNumber.value) {
    return invalid("resident_number is required for an exact resident-number candidate.");
  }

  const dateOfBirth = nullableDate(row.date_of_birth, "date_of_birth");
  if (!dateOfBirth.ok) return dateOfBirth;
  const referralId = nullablePositiveInteger(row.referral_id, "referral_id");
  if (!referralId.ok) return referralId;
  const confidence = nullableConfidence(row.match_confidence);
  if (!confidence.ok) return confidence;
  const mutationId = optionalIdentifier(row.client_mutation_id, "client_mutation_id", 128);
  if (!mutationId.ok) return mutationId;

  return {
    ok: true,
    value: {
      pipeline_client_id: pipelineClientId.value,
      display_name: displayName.value,
      date_of_birth: dateOfBirth.value,
      referral_id: referralId.value,
      resident_key: residentKey.value,
      resident_number: residentNumber.value,
      community_id: communityId.value,
      match_method: row.match_method as ResidentLinkMatchMethod,
      match_confidence: confidence.value,
      client_mutation_id: mutationId.value,
    },
  };
}

export function validateResidentLinkReview(value: unknown): ValidationResult<ResidentLinkReviewInput & { if_match: number }> {
  const row = record(value);
  if (!row) return invalid("The resident-link review request must be an object.");
  if (row.action !== "confirm" && row.action !== "reject") {
    return invalid("action must be confirm or reject.");
  }
  if (!Number.isInteger(row.if_match) || Number(row.if_match) < 1) {
    return invalid("if_match must be a positive resident-link version.");
  }
  const note = nullableText(row.review_note, "review_note", 2000);
  if (!note.ok) return note;
  if (row.action === "reject" && !note.value) {
    return invalid("A review note is required when rejecting a resident link.");
  }
  return {
    ok: true,
    value: {
      action: row.action,
      review_note: note.value,
      if_match: Number(row.if_match),
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, label: string, max: number): ValidationResult<string> {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    return invalid(`${label} must be between 1 and ${max} characters.`);
  }
  return { ok: true, value: value.trim() };
}

function nullableText(value: unknown, label: string, max: number): ValidationResult<string | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const result = text(value, label, max);
  return result.ok ? { ok: true, value: result.value } : result;
}

function identifier(value: unknown, label: string, max: number): ValidationResult<string> {
  const result = text(value, label, max);
  if (!result.ok) return result;
  return /^[a-zA-Z0-9._:@/+-]+$/.test(result.value)
    ? result
    : invalid(`${label} contains unsupported characters.`);
}

function nullableIdentifier(value: unknown, label: string, max: number): ValidationResult<string | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const result = identifier(value, label, max);
  return result.ok ? { ok: true, value: result.value } : result;
}

function optionalIdentifier(value: unknown, label: string, max: number): ValidationResult<string | undefined> {
  if (value === undefined || value === null || value === "") return { ok: true, value: undefined };
  const result = identifier(value, label, max);
  return result.ok ? { ok: true, value: result.value } : result;
}

function nullableDate(value: unknown, label: string): ValidationResult<string | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))) {
    return invalid(`${label} must be a valid YYYY-MM-DD date.`);
  }
  return { ok: true, value };
}

function nullablePositiveInteger(value: unknown, label: string): ValidationResult<number | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  return Number.isInteger(value) && Number(value) > 0
    ? { ok: true, value: Number(value) }
    : invalid(`${label} must be a positive integer.`);
}

function nullableConfidence(value: unknown): ValidationResult<number | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? { ok: true, value }
    : invalid("match_confidence must be between 0 and 1.");
}

function invalid(message: string, status = 400): { ok: false; message: string; status: number } {
  return { ok: false, message, status };
}
