import type { AdmissionRequirement, Referral } from "./referral-types";
import { isUnassignedOwner } from "./referral-ownership";
import type { WorkflowContext } from "./workflow-records";

export type ReferralProgressPhase = "pre" | "assessment" | "post";
export type ReferralProgressItemStatus = "complete" | "missing" | "attention";

export type ReferralProgressItem = {
  key: string;
  label: string;
  status: ReferralProgressItemStatus;
  blocker: boolean;
  detail?: string;
};

export type ReferralProgressSection = {
  key: string;
  label: string;
  complete: number;
  total: number;
  percent: number;
  items: ReferralProgressItem[];
};

export type ReferralProgress = {
  referral_id: number;
  phase: ReferralProgressPhase;
  overall: {
    complete: number;
    total: number;
    percent: number;
  };
  sections: ReferralProgressSection[];
  blockers: string[];
  next_action: string | null;
  generated_at: string;
};

export function getReferralProgress(referral: Referral, context: WorkflowContext = {}): ReferralProgress {
  const decision = context.decision ?? referral.admissionDecision;
  const assessmentComplete = context.assessmentComplete ?? hasValue(referral.assessment?.completedAt);
  const sections = [
    section("referral", "Referral information", [
      item("name", "Client name", hasValue(referral.name), true),
      item("community", "Community", hasValue(referral.community), true),
      item("source", "Referral source", hasValue(referral.source), true),
      item("owner", "Owner", !isUnassignedOwner(referral.owner), true),
      item("received_date", "Referral received date", hasValue(referral.date), true),
      item("dob", "Date of birth", hasValue(referral.dob), true),
      item("phone", "Phone", hasValue(referral.phone), false),
      item("email", "Email", hasValue(referral.email), false),
      item("payer", "Payer", hasValue(referral.payer), false),
    ]),
    section("packet", "Initial packet", [
      item(
        "packet_uploaded",
        "Initial packet uploaded",
        referral.documentStatus !== "Missing" || hasValue(referral.documentName),
        true,
      ),
      item("packet_linked", "Extraction packet linked", hasValue(referral.packetId), true),
      item(
        "packet_reviewed",
        "Extracted fields reviewed",
        referral.packetStatus === "reviewed" || referral.packetReadiness?.ready === true,
        true,
        referral.packetStatus === "failed" ? "Extraction failed" : undefined,
      ),
      item(
        "packet_complete",
        "Required packet fields complete",
        isPacketComplete(referral),
        true,
        referral.packetReadiness?.blockers?.[0],
      ),
    ]),
    section("assessment", "Assessment", [
      item("assessment_record", "Assessment record opened", context.assessmentExists ?? Boolean(referral.assessment), true),
      item("assessment_scheduled", "Assessment scheduled", hasValue(context.assessmentDate ?? referral.assessment?.scheduledDate), true),
      item("assessment_started", "Assessment started", hasValue(referral.assessment?.startedAt), false),
      item("assessment_pre", "Pre-assessment information", hasValue(referral.assessment?.preAssessment.demographics), true),
      item("assessment_needs", "Care needs", hasValue(referral.assessment?.assessment.careNeeds), true),
      item("assessment_risk", "Risk level", hasValue(referral.assessment?.assessment.riskLevel), true),
      item("assessment_completed", "Assessment completed", assessmentComplete, true),
    ]),
    section("decision", "Admission decision", [
      item(
        "admission_decision",
        "Admission yes/no recorded",
        Boolean(decision?.outcome) || (referral.assessment?.postAssessment.decision !== undefined && referral.assessment.postAssessment.decision !== "pending"),
        true,
      ),
      item(
        "no_admission_reason",
        "Reason recorded when not admitted",
        (decision?.outcome ?? legacyOutcome(referral)) !== "declined" || hasValue(decision?.reasonNote ?? referral.assessment?.postAssessment.reason),
        (decision?.outcome ?? legacyOutcome(referral)) === "declined",
      ),
    ]),
    requirementsSection(context.requirements ?? referral.requirements ?? []),
  ];

  const allItems = sections.flatMap((current) => current.items);
  const complete = allItems.filter((current) => current.status === "complete").length;
  const blockers = allItems
    .filter((current) => current.blocker && current.status !== "complete")
    .map((current) => current.detail ? `${current.label}: ${current.detail}` : current.label);

  return {
    referral_id: referral.id,
    phase: getPhase(referral),
    overall: {
      complete,
      total: allItems.length,
      percent: percentage(complete, allItems.length),
    },
    sections,
    blockers,
    next_action: getNextAction(referral, context, assessmentComplete, decision, blockers),
    generated_at: new Date().toISOString(),
  };
}

function getNextAction(
  referral: Referral,
  context: WorkflowContext,
  assessmentComplete: boolean,
  decision: Referral["admissionDecision"],
  blockers: string[],
) {
  if (isUnassignedOwner(referral.owner)) return "Assign an owner";
  if (referral.documentStatus === "Missing" && !hasValue(referral.documentName)) return "Upload the initial packet";
  if (referral.packetStatus === "failed") return "Retry packet extraction";
  if (["received", "normalizing", "extracting"].includes(referral.packetStatus ?? "")) return "Wait for packet extraction";

  const pendingReview = referral.packetFields?.filter((field) => field.review_status === "pending").length ?? 0;
  if (referral.packetStatus === "ready_for_review" && pendingReview > 0) {
    return `Review ${pendingReview} extracted value${pendingReview === 1 ? "" : "s"}`;
  }
  if (referral.packetStatus !== "reviewed" && referral.packetReadiness?.ready !== true) return "Complete packet review";
  if (!(context.assessmentExists ?? Boolean(referral.assessment))) return "Start the assessment";
  if (!hasValue(context.assessmentDate ?? referral.assessment?.scheduledDate)) return "Schedule the assessment";
  if (!assessmentComplete) return "Complete the assessment";
  if (!decision && (referral.assessment?.postAssessment.decision ?? "pending") === "pending") return "Record the admission decision";

  return blockers[0] ?? null;
}

function legacyOutcome(referral: Referral) {
  if (referral.assessment?.postAssessment.decision === "not-accepted") return "declined";
  if (referral.assessment?.postAssessment.decision === "accepted") return "accepted";
  return null;
}

function requirementsSection(requirements: AdmissionRequirement[]): ReferralProgressSection {
  const items = requirements.length > 0
    ? requirements.map((requirement) => {
        const complete = isRequirementComplete(requirement);
        return item(
          `requirement:${requirement.id}`,
          requirement.label,
          complete,
          requirement.blocker,
          requirement.status === "expired" ? "Evidence expired" : requirement.nextStep,
        );
      })
    : [item("requirements_configured", "Admission requirements configured", false, false, "Add requirements when the workflow reaches follow-up.")];

  return section("requirements", "Admission requirements", items);
}

function section(key: string, label: string, items: ReferralProgressItem[]): ReferralProgressSection {
  const complete = items.filter((current) => current.status === "complete").length;
  return {
    key,
    label,
    complete,
    total: items.length,
    percent: percentage(complete, items.length),
    items,
  };
}

function item(
  key: string,
  label: string,
  complete: boolean,
  blocker: boolean,
  detail?: string,
): ReferralProgressItem {
  return {
    key,
    label,
    status: complete ? "complete" : detail ? "attention" : "missing",
    blocker,
    ...(detail ? { detail } : {}),
  };
}

function isPacketComplete(referral: Referral) {
  const completeness = referral.packetCompleteness;
  return Boolean(
    completeness &&
      completeness.required_total > 0 &&
      completeness.required_ready === completeness.required_total &&
      (referral.packetReadiness?.ready ?? true),
  );
}

function isRequirementComplete(requirement: AdmissionRequirement) {
  return ["received", "reviewed", "waived"].includes(requirement.status);
}

function getPhase(referral: Referral): ReferralProgressPhase {
  if (referral.stage === "Assessment") return "assessment";
  if (["Community Review", "Accepted / Admitted", "Declined"].includes(referral.stage)) return "post";
  return "pre";
}

function hasValue(value: unknown) {
  if (typeof value !== "string") return value !== undefined && value !== null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !PLACEHOLDER_VALUES.has(normalized);
}

const PLACEHOLDER_VALUES = new Set([
  "n/a",
  "not reported",
  "not scheduled",
  "pending",
  "tbd",
  "unassigned",
  "unknown",
]);

function percentage(complete: number, total: number) {
  return total === 0 ? 0 : Math.round((complete / total) * 100);
}
