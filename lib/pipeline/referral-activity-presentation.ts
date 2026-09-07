export type ReferralActivityChange = {
  field: string;
  label: string;
  before: string;
  after: string;
  masked: boolean;
  values_available: boolean;
};

const fieldLabels: Record<string, string> = {
  admissionDecision: "Admission decision",
  admissionDate: "Admission date",
  assignedAt: "Assigned at",
  assignmentDueAt: "Assignment due",
  assignmentVersion: "Assignment version",
  community: "Community",
  county: "County",
  currentMedications: "Medication profile",
  dob: "Date of birth",
  documentHash: "Document fingerprint",
  documentName: "Document name",
  documentStatus: "Document status",
  email: "Email",
  gender: "Gender",
  name: "Name",
  note: "Referral summary",
  owner: "Primary assignee",
  ownerId: "Primary assignee ID",
  owners: "Workspace owners",
  payer: "Payer",
  phone: "Phone",
  priority: "Priority",
  reasonCode: "Reason code",
  reasonNote: "Reason",
  requirements: "Requirements",
  responsiblePerson: "Responsible person",
  source: "Referral source",
  ssn: "Social Security number",
  stage: "Stage",
  tags: "Tags",
  workflowStatus: "Workflow status",
};

const sensitiveValueFields = new Set([
  "assessment",
  "assessmentRecommendation",
  "currentMedications",
  "documentHash",
  "ehrHandoff",
  "interview",
  "manualIntakeAuthorization",
  "note",
  "packetFields",
  "ssn",
]);

export function isSensitiveReferralActivityField(field: string) {
  return sensitiveValueFields.has(field);
}

export function buildReferralActivityChanges(
  changedFields: string[],
  beforeValues: unknown,
  afterValues: unknown,
): ReferralActivityChange[] {
  const before = asRecord(beforeValues);
  const after = asRecord(afterValues);
  return [...new Set(changedFields)].map((field) => {
    const masked = isSensitiveReferralActivityField(field);
    return {
      field,
      label: fieldLabels[field] ?? humanize(field),
      before: masked ? "Sensitive value" : presentValue(field, before[field]),
      after: masked ? "Sensitive value" : presentValue(field, after[field]),
      masked,
      values_available: Object.hasOwn(before, field) || Object.hasOwn(after, field),
    };
  });
}

export function activityReason(metadata: unknown) {
  const reason = asRecord(metadata).reason;
  return typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 1_000) : null;
}

function presentValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "Not recorded";
  if (field === "owners") return presentOwners(value);
  if (field === "requirements") return presentRequirements(value);
  return presentGeneralValue(value);
}

function presentOwners(value: unknown) {
  if (!Array.isArray(value)) return presentGeneralValue(value);
  const names = value
    .map((owner) => asRecord(owner).name)
    .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
    .map((name) => name.trim());
  return names.length ? [...new Set(names)].join(", ") : "Not recorded";
}

function presentRequirements(value: unknown) {
  if (!Array.isArray(value)) return presentGeneralValue(value);
  return `${value.length} requirement${value.length === 1 ? "" : "s"}`;
}

function presentGeneralValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(", ").slice(0, 300) || "Not recorded";
  if (typeof value === "object") {
    const serialized = JSON.stringify(value);
    return serialized.length > 300 ? `${serialized.slice(0, 297)}...` : serialized;
  }
  return String(value).slice(0, 300);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
