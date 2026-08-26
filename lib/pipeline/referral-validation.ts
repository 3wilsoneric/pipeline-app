import { pipelineCommunities } from "./community-config";
import { boardStages } from "./referral-workflow";
import type { ReferralPatch } from "./referral-store";
import type {
  AdmissionRequirement,
  Referral,
  Priority,
} from "./referral-types";
import { referralCanvasFieldKeys } from "./referral-types";

type ValidationFailure = { ok: false; message: string; status?: number };
type ValidationSuccess<T> = { ok: true; value: T };

export type ReferralValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

const priorities: readonly Priority[] = ["urgent", "high", "standard"];
const documentStatuses = ["Missing", "Uploaded", "Reviewed"] as const;
const packetStatuses = [
  "received",
  "normalizing",
  "extracting",
  "ready_for_review",
  "reviewed",
  "failed",
] as const;
const requirementTypes = [
  "profile_field",
  "medication_list",
  "tb_test",
  "signed_admission_agreement",
  "conservatorship_document",
  "lic_602",
  "lic_601_603",
  "provider_form",
  "face_sheet",
  "payer_verification",
  "responsible_party",
  "no_admission_reason",
] as const;
const requirementStatuses = [
  "needed",
  "requested",
  "received",
  "reviewed",
  "waived",
  "expired",
  "unavailable",
  "not_applicable",
] as const;
const requirementGates = ["profile_completion", "pre_assessment", "admission_decision", "move_in", "ehr_export"] as const;

const stringLimits = {
  name: 200,
  date: 40,
  source: 200,
  county: 100,
  owner: 200,
  note: 20_000,
  createdAt: 80,
  updatedAt: 80,
  dob: 40,
  gender: 80,
  reportedAge: 40,
  ssn: 32,
  admissionDate: 40,
  responsiblePerson: 500,
  phone: 80,
  email: 320,
  payer: 200,
  documentName: 512,
  documentHash: 64,
  packetId: 256,
  assessmentDocumentName: 512,
  assessmentMessage: 2_000,
  packetMessage: 2_000,
  tag: 64,
  clientId: 128,
} as const;

export function validateReferralCreateInput(
  value: unknown,
): ReferralValidationResult<Referral> {
  if (!isPlainObject(value)) return invalid("The referral must be an object.");

  if (
    "id" in value
    || "version" in value
    || "sectionVersions" in value
    || "updatedBy" in value
    || "ownerId" in value
    || "manualIntakeAuthorization" in value
    || "interview" in value
    || "assessment" in value
    || "admissionDecision" in value
    || "ehrHandoff" in value
  ) {
    return invalid("Referral ids and workflow records are assigned by the server.");
  }

  const requiredStrings: Array<[keyof typeof stringLimits, string]> = [
    ["name", "name"],
    ["date", "date"],
    ["source", "source"],
    ["documentName", "documentName"],
    ["owner", "owner"],
    ["note", "note"],
    ["createdAt", "createdAt"],
    ["dob", "dob"],
    ["phone", "phone"],
    ["email", "email"],
    ["payer", "payer"],
  ];

  for (const [field, label] of requiredStrings) {
    const result = validateString(value[field], label, stringLimits[field], field === "name");
    if (!result.ok) return result;
  }

  for (const field of ["county", "gender", "reportedAge", "ssn", "admissionDate", "responsiblePerson"] as const) {
    if (!(field in value) || value[field] === undefined) continue;
    const result = validateString(value[field], field, stringLimits[field], false);
    if (!result.ok) return result;
  }

  const enumChecks = [
    validateEnum(value.stage, "stage", boardStages),
    validateEnum(value.community, "community", pipelineCommunities),
    validateEnum(value.priority, "priority", priorities),
    validateEnum(value.documentStatus, "documentStatus", documentStatuses),
  ];
  for (const result of enumChecks) {
    if (!result.ok) return result;
  }
  if (value.stage !== "New") {
    return invalid("New referrals must start in the New stage.");
  }

  const timestampResult = validateTimestamp(value.createdAt, "createdAt");
  if (!timestampResult.ok) return timestampResult;

  const commonResult = validateCommonFields(value);
  if (!commonResult.ok) return commonResult;

  const requirementsResult = validateRequirements(value.requirements);
  if (!requirementsResult.ok) return requirementsResult;

  return { ok: true, value: value as unknown as Referral };
}

export function validateReferralPatch(
  value: unknown,
): ReferralValidationResult<ReferralPatch> {
  if (!isPlainObject(value)) return invalid("The referral patch must be an object.");

  for (const protectedField of [
    "id", "version", "clientId", "sectionVersions", "updatedBy", "ownerId",
    "workflowStatus", "assignedAt", "assignmentDueAt", "assignmentVersion",
    "assessmentRecommendation", "manualIntakeAuthorization", "ehrHandoff", "interview", "assessment",
  ] as const) {
    if (protectedField in value) {
      return invalid(`${protectedField} cannot be changed through a referral patch.`);
    }
  }

  const stringFields: Array<[keyof typeof stringLimits, string]> = [
    ["name", "name"],
    ["date", "date"],
    ["source", "source"],
    ["county", "county"],
    ["documentName", "documentName"],
    ["owner", "owner"],
    ["note", "note"],
    ["createdAt", "createdAt"],
    ["updatedAt", "updatedAt"],
    ["dob", "dob"],
    ["gender", "gender"],
    ["reportedAge", "reportedAge"],
    ["ssn", "ssn"],
    ["responsiblePerson", "responsiblePerson"],
    ["phone", "phone"],
    ["email", "email"],
    ["payer", "payer"],
    ["packetId", "packetId"],
    ["packetMessage", "packetMessage"],
    ["assessmentDocumentName", "assessmentDocumentName"],
    ["assessmentMessage", "assessmentMessage"],
  ];

  for (const [field, label] of stringFields) {
    if (!(field in value)) continue;
    const result = validateString(value[field], label, stringLimits[field], false);
    if (!result.ok) return result;
  }

  const enumChecks = [
    optionalEnum(value.stage, "stage", boardStages),
    optionalEnum(value.community, "community", pipelineCommunities),
    optionalEnum(value.priority, "priority", priorities),
    optionalEnum(value.documentStatus, "documentStatus", documentStatuses),
    optionalEnum(value.packetStatus, "packetStatus", packetStatuses),
  ];
  for (const result of enumChecks) {
    if (!result.ok) return result;
  }

  if ("createdAt" in value) {
    const result = validateTimestamp(value.createdAt, "createdAt");
    if (!result.ok) return result;
  }
  if ("updatedAt" in value) {
    const result = validateTimestamp(value.updatedAt, "updatedAt");
    if (!result.ok) return result;
  }

  const commonResult = validateCommonFields(value);
  if (!commonResult.ok) return commonResult;

  if ("requirements" in value) {
    const result = validateRequirements(value.requirements);
    if (!result.ok) return result;
  }
  if ("admissionDecision" in value && value.admissionDecision !== undefined) {
    const result = validateAdmissionDecision(value.admissionDecision);
    if (!result.ok) return result;
  }

  return { ok: true, value: value as ReferralPatch };
}

function validateCommonFields(value: Record<string, unknown>): ValidationSuccess<true> | ValidationFailure {
  const validators = [
    validateConserved,
    validateFieldSources,
    validateClientId,
    validateDocumentHash,
    validateTags,
    validateDocumentSizes,
    validatePacketState,
  ];
  for (const validate of validators) {
    const result = validate(value);
    if (!result.ok) return result;
  }
  return valid();
}

function validateConserved(value: Record<string, unknown>): ValidationSuccess<true> | ValidationFailure {
  if ("conserved" in value && value.conserved !== undefined) {
    const result = validateEnum(value.conserved, "conserved", ["yes", "no", ""] as const);
    if (!result.ok) return result;
  }
  return valid();
}

function validateFieldSources(value: Record<string, unknown>): ValidationSuccess<true> | ValidationFailure {
  if ("fieldSources" in value && value.fieldSources !== undefined) {
    if (!isPlainObject(value.fieldSources)) return invalid("fieldSources must be an object.");
    const entries = Object.entries(value.fieldSources);
    if (entries.length > referralCanvasFieldKeys.length) return invalid("fieldSources contains too many values.");
    for (const [key, source] of entries) {
      if (!(referralCanvasFieldKeys as readonly string[]).includes(key)) {
        return invalid("fieldSources contains an unsupported field.");
      }
      const result = validateString(source, `fieldSources.${key}`, stringLimits.documentName, false);
      if (!result.ok) return result;
    }
  }
  return valid();
}

function validateClientId(value: Record<string, unknown>): ValidationSuccess<true> | ValidationFailure {
  if ("clientId" in value && value.clientId !== undefined) {
    const result = validateString(value.clientId, "clientId", stringLimits.clientId);
    if (!result.ok) return result;
    if (!/^[a-zA-Z0-9._:-]+$/.test(value.clientId as string)) {
      return invalid("clientId contains unsupported characters.");
    }
  }
  return valid();
}

function validateDocumentHash(value: Record<string, unknown>): ValidationSuccess<true> | ValidationFailure {
  if ("documentHash" in value && value.documentHash !== undefined) {
    const result = validateString(value.documentHash, "documentHash", stringLimits.documentHash);
    if (!result.ok) return result;
    if (!/^[a-f0-9]{64}$/.test(value.documentHash as string)) {
      return invalid("documentHash must be a lowercase SHA-256 value.");
    }
  }
  return valid();
}

function validateTags(value: Record<string, unknown>): ValidationSuccess<true> | ValidationFailure {
  if ("tags" in value && value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > 20) {
      return invalid("tags must contain at most 20 values.");
    }
    for (const tag of value.tags) {
      const result = validateString(tag, "tag", stringLimits.tag, false);
      if (!result.ok) return result;
    }
  }
  return valid();
}

function validateDocumentSizes(value: Record<string, unknown>): ValidationSuccess<true> | ValidationFailure {
  for (const [field, maximum] of [
    ["documentSizeBytes", 100 * 1024 * 1024],
    ["assessmentDocumentSizeBytes", 100 * 1024 * 1024],
  ] as const) {
    if (!(field in value) || value[field] === undefined) continue;
    if (!Number.isInteger(value[field]) || (value[field] as number) < 0 || (value[field] as number) > maximum) {
      return invalid(`${field} must be a whole number between 0 and 100 MB.`);
    }
  }
  return valid();
}

function validatePacketState(value: Record<string, unknown>): ValidationSuccess<true> | ValidationFailure {
  if ("packetFields" in value && value.packetFields !== undefined) {
    const result = validatePacketFields(value.packetFields);
    if (!result.ok) return result;
  }
  if ("packetReadiness" in value && value.packetReadiness !== undefined) {
    const result = validateReadiness(value.packetReadiness);
    if (!result.ok) return result;
  }
  if ("packetCompleteness" in value && value.packetCompleteness !== undefined) {
    const result = validateCompleteness(value.packetCompleteness);
    if (!result.ok) return result;
  }
  return valid();
}

function validateRequirements(value: unknown): ValidationSuccess<true> | ValidationFailure {
  if (!Array.isArray(value) || value.length > 50) return invalid("requirements must contain at most 50 items.");

  for (const requirement of value) {
    const result = validateRequirement(requirement);
    if (!result.ok) return result;
  }

  return valid();
}

function validateRequirement(value: unknown): ValidationSuccess<true> | ValidationFailure {
  if (!isPlainObject(value)) return invalid("Each requirement must be an object.");
  const fields: Array<[keyof AdmissionRequirement, number]> = [
    ["id", 128],
    ["label", 300],
    ["owner", 200],
    ["dueAt", 80],
    ["nextStep", 500],
    ["updatedAt", 80],
  ];
  for (const [field, maximum] of fields) {
    const result = validateString(value[field], `requirements.${field}`, maximum);
    if (!result.ok) return result;
  }
  if ("ownerId" in value && value.ownerId !== undefined) {
    const result = validateString(value.ownerId, "requirements.ownerId", 256);
    if (!result.ok) return result;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value.id))) {
    return invalid("requirements.id must be a UUID.");
  }
  for (const field of ["dueAt", "updatedAt"] as const) {
    const result = validateTimestamp(value[field], `requirements.${field}`);
    if (!result.ok) return result;
  }
  for (const [field, values] of [
    ["type", requirementTypes],
    ["status", requirementStatuses],
    ["requiredFor", requirementGates],
  ] as const) {
    const result = validateEnum(value[field], `requirements.${field}`, values);
    if (!result.ok) return result;
  }
  if (typeof value.blocker !== "boolean") return invalid("requirements.blocker must be true or false.");
  if ("version" in value && value.version !== undefined && (!Number.isInteger(value.version) || Number(value.version) < 1)) {
    return invalid("requirements.version must be a positive whole number.");
  }
  for (const [field, maximum] of [
    ["evidenceDocumentName", 2_000],
    ["waiverReason", 2_000],
    ["fieldKey", 256],
    ["requestedFrom", 500],
    ["unavailableReason", 2_000],
  ] as const) {
    if (!(field in value) || value[field] === undefined) continue;
    const result = validateString(value[field], `requirements.${field}`, maximum);
    if (!result.ok) return result;
  }
  for (const field of ["requestedAt", "followUpAt"] as const) {
    if (!(field in value) || value[field] === undefined) continue;
    const result = validateTimestamp(value[field], `requirements.${field}`);
    if (!result.ok) return result;
  }
  if (value.type === "profile_field" && typeof value.fieldKey !== "string") {
    return invalid("requirements.fieldKey is required for profile completion work.");
  }
  if (value.status === "waived" && typeof value.waiverReason !== "string") {
    return invalid("requirements.waiverReason is required when a requirement is waived.");
  }
  if (value.status === "requested"
    && (typeof value.requestedFrom !== "string" || typeof value.followUpAt !== "string")) {
    return invalid("Requested requirements need a source and follow-up date.");
  }
  if (["unavailable", "not_applicable"].includes(String(value.status))
    && typeof value.unavailableReason !== "string") {
    return invalid("Unavailable or not-applicable requirements need a reason.");
  }
  return valid();
}

function validateAdmissionDecision(value: unknown): ValidationSuccess<true> | ValidationFailure {
  if (!isPlainObject(value)) return invalid("admissionDecision must be an object.");
  for (const [field, maximum] of [
    ["decisionId", 128],
    ["reasonCode", 128],
    ["reasonNote", 20_000],
    ["decidedBy", 200],
    ["decidedByName", 200],
    ["decidedAt", 80],
  ] as const) {
    const result = validateString(value[field], `admissionDecision.${field}`, maximum, field !== "reasonCode" && field !== "reasonNote");
    if (!result.ok) return result;
  }
  const outcome = validateEnum(value.outcome, "admissionDecision.outcome", ["accepted", "declined"] as const);
  if (!outcome.ok) return outcome;
  if (!Number.isInteger(value.version) || Number(value.version) < 1) return invalid("admissionDecision.version must be a positive whole number.");
  return validateTimestamp(value.decidedAt, "admissionDecision.decidedAt");
}

function validatePacketFields(value: unknown): ValidationSuccess<true> | ValidationFailure {
  if (!Array.isArray(value) || value.length > 300) return invalid("packetFields must contain at most 300 fields.");
  for (const field of value) {
    const result = validatePacketField(field);
    if (!result.ok) return result;
  }
  return valid();
}

function validatePacketField(value: unknown): ValidationSuccess<true> | ValidationFailure {
  if (!isPlainObject(value)) return invalid("Each packet field must be an object.");
  const fieldKey = validateString(value.field_key, "field_key", 256);
  if (!fieldKey.ok) return fieldKey;
  for (const key of ["proposed_value", "final_value"] as const) {
    if (!(key in value) || value[key] === null || value[key] === undefined) continue;
    const result = validateString(value[key], key, 20_000);
    if (!result.ok) return result;
  }
  const confidence = value.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return invalid("packet field confidence must be between 0 and 1.");
  }
  if (typeof value.review_status !== "string" || !["pending", "accepted", "edited", "rejected"].includes(value.review_status)) {
    return invalid("packet field review_status is invalid.");
  }
  if (typeof value.is_conflict !== "boolean") return invalid("packet field is_conflict must be true or false.");
  if (!Array.isArray(value.candidates) || value.candidates.length > 20) return invalid("packet field candidates are invalid.");
  return valid();
}

function validateReadiness(value: unknown): ValidationSuccess<true> | ValidationFailure {
  if (!isPlainObject(value) || typeof value.ready !== "boolean" || !Array.isArray(value.blockers) || value.blockers.length > 50) {
    return invalid("packetReadiness is invalid.");
  }
  for (const blocker of value.blockers) {
    const result = validateString(blocker, "packetReadiness.blocker", 500, false);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

function validateCompleteness(value: unknown): ValidationSuccess<true> | ValidationFailure {
  if (!isPlainObject(value)) return invalid("packetCompleteness is invalid.");
  for (const field of ["required_total", "required_ready"] as const) {
    const count = value[field];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 10_000) return invalid(`packetCompleteness.${field} is invalid.`);
  }
  if (!Array.isArray(value.missing_items) || value.missing_items.length > 300) return invalid("packetCompleteness.missing_items is invalid.");
  return { ok: true, value: true };
}

function validateString(value: unknown, field: string, maximum: number, required = true): ValidationSuccess<true> | ValidationFailure {
  if (value === undefined || value === null) {
    return invalid(required ? `${field} is required.` : `${field} must be text.`);
  }
  if (typeof value !== "string") return invalid(`${field} must be text.`);
  if (required && value.trim().length === 0) return invalid(`${field} is required.`);
  if (value.length > maximum) return invalid(`${field} must be ${maximum.toLocaleString()} characters or fewer.`);
  return { ok: true, value: true };
}

function validateTimestamp(value: unknown, field: string) {
  const result = validateString(value, field, 80);
  if (!result.ok) return result;
  if (Number.isNaN(Date.parse(value as string))) return invalid(`${field} must be a valid timestamp.`);
  return result;
}

function validateEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]) {
  if (typeof value !== "string" || !allowed.includes(value as T)) return invalid(`${field} is invalid.`);
  return { ok: true as const, value: true as const };
}

function optionalEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]) {
  if (value === undefined) return { ok: true as const, value: true as const };
  return validateEnum(value, field, allowed);
}

function valid(): ValidationSuccess<true> {
  return { ok: true, value: true };
}

function invalid(message: string, status = 400): ValidationFailure {
  return { ok: false, message, status };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
