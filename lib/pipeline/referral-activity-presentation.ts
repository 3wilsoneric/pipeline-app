import type { JSONValue } from "postgres";
import type { Referral } from "./referral-types";

// Shared value construction only. Each adapter retains its own atomic audit write.
export function referralAuditValues(referral: Referral, fields: string[]): JSONValue {
  const values = Object.fromEntries(fields.map((field) => [
    field,
    isSensitiveReferralActivityField(field)
      ? "[masked]"
      : (referral as unknown as Record<string, unknown>)[field] ?? null,
  ]));
  return JSON.parse(JSON.stringify(values)) as JSONValue;
}

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
  contact: "Contact",
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
  primaryForScheduling: "Primary scheduling contact",
  reasonCode: "Reason code",
  reasonNote: "Reason",
  requirements: "Requirements",
  responsiblePerson: "Responsible person",
  relationship: "Relationship",
  role: "Contact role",
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

const actionLabels: Record<string, string> = {
  referral_created: "Referral created",
  referral_assigned: "Assignee added",
  referral_reassigned: "Assignee changed",
  referral_unassigned: "Assignee removed",
  referral_stage_changed: "Stage changed",
  assessment_created: "Assessment created",
  assessment_imported: "Assessment imported",
  assessment_assigned: "Assessor changed",
  assessment_scheduled: "Assessment scheduled",
  assessment_rescheduled: "Assessment rescheduled",
  assessment_cancelled: "Assessment cancelled",
  assessment_no_show: "Assessment missed",
  assessment_interview_completed: "Interview completed; documentation remains editable",
  assessment_started: "Assessment started",
  assessment_completed: "Assessment completed",
  assessment_signed: "Assessment signed",
  assessment_addendum_added: "Assessment addendum added",
  assessment_recommendation_submitted: "Recommendation submitted",
  admission_decision_recorded: "Admission decision recorded",
  admission_decision_overridden: "Admission decision changed",
  admission_declined: "Admission denied",
  ehr_handoff_updated: "EHR handoff updated",
};

type LabelledActivityEvent = { action: string; entity_type?: string };

// One assessment lifecycle save writes two audit rows with the same action:
// one on the assessment and one on the referral whose workflow status it
// synchronized. They are separate records of separate changes, so label them
// separately. No stored correlation ID links them, so they are never merged.
export function activityEventLabel(event: LabelledActivityEvent) {
  const label = actionLabels[event.action] ?? humanizeAction(event.action);
  if (event.entity_type === "referral" && event.action.startsWith("assessment_")) {
    return `Referral status updated (${label.charAt(0).toLowerCase()}${label.slice(1)})`;
  }
  return label;
}

const entityLabels: Record<string, string> = {
  referral: "Referral",
  assessment: "Assessment",
  work_item: "Work item",
  admission_decision: "Admission decision",
  assessment_review: "Assessment review",
  document: "Document",
  contact_import: "Contact import",
};

export function activityEventProvenance(event: {
  event_id: string;
  source?: "audit" | "record";
  entity_type?: string;
  entity_id?: string;
  action: string;
  from_version: number | null;
  to_version: number | null;
  created_at: string;
}) {
  return [
    { label: "Source", value: event.source === "record" ? "Derived from the saved record (no audit row)" : event.source === "audit" ? "Audit log" : "Not reported" },
    { label: event.source === "audit" ? "Audit event" : "Entry", value: event.event_id },
    ...(event.entity_type
      ? [{ label: "Record", value: `${entityLabels[event.entity_type] ?? humanize(event.entity_type)} ${event.entity_id ?? ""}`.trim() }]
      : []),
    { label: "Action code", value: event.action },
    ...(event.from_version !== null || event.to_version !== null
      ? [{ label: "Version", value: `${event.from_version ?? "—"} → ${event.to_version ?? "—"}` }]
      : []),
    { label: "Recorded (UTC)", value: event.created_at },
  ];
}

function humanizeAction(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
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
