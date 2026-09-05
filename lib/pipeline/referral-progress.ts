import type { AdmissionRequirement, Referral } from "./referral-types";
import { isUnassignedOwner } from "./referral-ownership";
import type { WorkflowContext } from "./workflow-records";
import { getAssessmentCompletionSummary } from "@/lib/assessment/assessment-completion";
import { hasInitialDocument, hasManualIntakeAuthorization } from "./workflow-status";
import {
  getWorkspaceState,
  isRequirementResolved,
  type WorkspaceStateProjection,
} from "./workspace-state";

export type ReferralProgressPhase = "pre" | "assessment";
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
  /** Independent durable facts used by queues and workflow surfaces. */
  state: WorkspaceStateProjection;
  phase: ReferralProgressPhase;
  overall: {
    complete: number;
    total: number;
    percent: number;
  };
  sections: ReferralProgressSection[];
  blockers: string[];
  open_items: string[];
  next_action: string | null;
  action_required: boolean;
  waiting: boolean;
  generated_at: string;
};

export function getReferralProgress(referral: Referral, context: WorkflowContext = {}): ReferralProgress {
  const assessmentComplete = context.assessmentComplete ?? hasValue(referral.assessment?.completedAt);
  const canonicalAssessment = context.assessmentData ?? null;
  const state = getWorkspaceState(referral, context);
  const activeRequirementIds = new Set(state.active_requirement_ids);
  const activeRequirements = (context.requirements ?? referral.requirements ?? [])
    .filter((requirement) => activeRequirementIds.has(requirement.id));
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
    packetSection(referral),
    assessmentSection(referral, context, canonicalAssessment, assessmentComplete),
    requirementsSection(activeRequirements),
  ];

  const allItems = sections.flatMap((current) => current.items);
  const complete = allItems.filter((current) => current.status === "complete").length;
  const operationalItems = getOperationalItems(sections, state);
  const blockers = operationalItems
    .filter((current) => current.blocker && current.status !== "complete")
    .map((current) => current.detail ? `${current.label}: ${current.detail}` : current.label);

  const openItems = [...new Set(operationalItems
    .filter((current) => current.status !== "complete"
      && (current.blocker || current.key.startsWith("requirement:")))
    .map((current) => current.label))];
  const nextAction = getNextAction(
    referral,
    canonicalAssessment,
    state,
    activeRequirements,
  );
  const waiting = ["received", "normalizing", "extracting"].includes(referral.packetStatus ?? "")
    || state.assessment === "waiting_for_information";
  return {
    referral_id: referral.id,
    state,
    phase: getPhase(referral, context),
    overall: {
      complete,
      total: allItems.length,
      percent: percentage(complete, allItems.length),
    },
    sections,
    blockers,
    open_items: openItems,
    next_action: nextAction,
    action_required: Boolean(nextAction) && !waiting,
    waiting,
    generated_at: new Date().toISOString(),
  };
}

function getNextAction(
  referral: Referral,
  canonicalAssessment: WorkflowContext["assessmentData"],
  state: WorkspaceStateProjection,
  activeRequirements: AdmissionRequirement[],
) {
  if (state.lifecycle !== "active") return null;
  if (state.assignment === "unassigned") return "Assign an owner";
  if (state.assessment === "scheduled") return "Begin the scheduled assessment";
  if (state.outcome === "declined" && !state.assessment_is_reassessment) return null;

  if (state.assessment_is_reassessment) {
    if (state.assessment === "not_started" || state.assessment === "unscheduled") {
      return "Schedule the reassessment";
    }
    if (state.assessment === "in_progress" || state.assessment === "waiting_for_information") {
      const missingAssessmentRule = canonicalAssessment
        ? getAssessmentCompletionSummary(canonicalAssessment).missing[0]
        : null;
      return missingAssessmentRule
        ? `Complete reassessment: ${missingAssessmentRule.label}`
        : "Complete the reassessment";
    }
    if (state.assessment === "ready_to_sign") return "Review and sign the reassessment";
    if (state.assessment === "signed") return "Review the completed reassessment";
  }

  const nextRequirement = [...activeRequirements]
    .filter((requirement) => !isRequirementResolved(requirement))
    .sort((left, right) => Number(right.blocker) - Number(left.blocker)
      || left.dueAt.localeCompare(right.dueAt))[0];
  const missingProfileField = state.missing_profile_fields[0];

  if (state.outcome === "accepted") {
    if (missingProfileField) return `Complete profile: ${missingProfileField}`;
    if (state.documents !== "complete" && !nextRequirement) return "Attach source documents";
    return nextRequirement?.nextStep?.trim() || nextRequirement?.label || null;
  }
  if (!hasManualIntakeAuthorization(referral)) {
    if (!hasInitialDocument(referral)) return "Upload the initial packet";
    if (referral.packetStatus === "failed") return "Retry packet extraction";
    if (["received", "normalizing", "extracting"].includes(referral.packetStatus ?? "")) return "Waiting for packet extraction";

    const pendingReview = referral.packetFields?.filter((field) => field.review_status === "pending").length ?? 0;
    if (referral.packetStatus === "ready_for_review" && pendingReview > 0) {
      return `Review ${pendingReview} extracted value${pendingReview === 1 ? "" : "s"}`;
    }
    if (referral.packetStatus !== "reviewed" && referral.packetReadiness?.ready !== true) return "Complete packet review";
  }
  if (missingProfileField) return `Complete profile: ${missingProfileField}`;
  if (nextRequirement && ["profile_completion", "pre_assessment"].includes(nextRequirement.requiredFor)) {
    return nextRequirement.nextStep?.trim() || nextRequirement.label;
  }
  if (state.assessment === "not_started" || state.assessment === "unscheduled") {
    return "Schedule the assessment";
  }
  if (state.assessment === "in_progress" || state.assessment === "waiting_for_information") {
    const missingAssessmentRule = canonicalAssessment
      ? getAssessmentCompletionSummary(canonicalAssessment).missing[0]
      : null;
    return missingAssessmentRule
      ? `Complete assessment: ${missingAssessmentRule.label}`
      : "Complete the assessment";
  }
  if (state.assessment === "ready_to_sign") return "Review and sign the assessment";
  return nextRequirement?.nextStep?.trim()
    || nextRequirement?.label
    || (state.assessment === "signed" ? "Review the completed assessment" : null);
}

function packetSection(referral: Referral): ReferralProgressSection {
  if (hasManualIntakeAuthorization(referral)) {
    return section("packet", "Intake source", [
      item("manual_intake_authorized", "Manual chart intake authorized", true, true),
      item(
        "packet_uploaded",
        "Source documents attached",
        hasInitialDocument(referral),
        false,
        "Attach source files when available",
      ),
      item("packet_linked", "Extraction packet linked", hasValue(referral.packetId), false),
      item(
        "packet_reviewed",
        "Extracted fields reviewed",
        referral.packetStatus === "reviewed" || referral.packetReadiness?.ready === true,
        false,
        referral.packetStatus === "failed" ? "Extraction failed" : undefined,
      ),
    ]);
  }
  return section("packet", "Initial packet", [
    item(
      "packet_uploaded",
      "Initial packet uploaded",
      hasInitialDocument(referral),
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
  ]);
}

function assessmentSection(
  referral: Referral,
  context: WorkflowContext,
  canonicalAssessment: WorkflowContext["assessmentData"],
  assessmentComplete: boolean,
): ReferralProgressSection {
  if (canonicalAssessment) {
    const completeness = getAssessmentCompletionSummary(canonicalAssessment);
    return section("assessment", "Assessment", [
      item("assessment_record", "Assessment record opened", true, true),
      ...completeness.rules.map((rule) => item(
        `assessment:${rule.key}`,
        rule.label,
        rule.complete,
        true,
      )),
      item("assessment_completed", "Assessment finalized", assessmentComplete, true),
    ]);
  }

  return section("assessment", "Assessment", [
    item("assessment_record", "Assessment record opened", context.assessmentExists ?? Boolean(referral.assessment), true),
    item("assessment_scheduled", "Assessment scheduled", hasValue(context.assessmentDate ?? referral.assessment?.scheduledDate), true),
    item("assessment_started", "Assessment started", hasValue(referral.assessment?.startedAt), false),
    item("assessment_pre", "Pre-assessment information", hasValue(referral.assessment?.preAssessment.demographics), true),
    item("assessment_needs", "Care needs", hasValue(referral.assessment?.assessment.careNeeds), true),
    item("assessment_risk", "Risk level", hasValue(referral.assessment?.assessment.riskLevel), true),
    item("assessment_completed", "Assessment finalized", assessmentComplete, true),
  ]);
}

function requirementsSection(
  requirements: AdmissionRequirement[],
): ReferralProgressSection {
  const items = requirements.map((requirement) => item(
    `requirement:${requirement.id}`,
    requirement.label,
    isRequirementResolved(requirement),
    requirement.blocker,
    requirement.status === "expired" ? "Evidence expired" : requirement.nextStep,
  ));

  return section("requirements", "Current requirements", items);
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

function getPhase(
  referral: Referral,
  context: WorkflowContext,
): ReferralProgressPhase {
  if (
    (context.assessmentExists ?? Boolean(referral.assessment))
    || referral.packetStatus === "reviewed"
    || referral.packetReadiness?.ready === true
    || hasManualIntakeAuthorization(referral)
  ) return "assessment";
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
  return total === 0 ? 100 : Math.round((complete / total) * 100);
}

function getOperationalItems(
  sections: ReferralProgressSection[],
  state: WorkspaceStateProjection,
) {
  if (state.focus === "complete") return [];
  const relevantSections = state.assessment_is_reassessment
    ? new Set(["referral", "assessment", "requirements"])
    : state.outcome === "accepted"
      ? new Set(["referral", "requirements"])
      : new Set(["referral", "packet", "assessment", "requirements"]);

  return sections
    .filter((current) => relevantSections.has(current.key))
    .flatMap((current) => current.items);
}
