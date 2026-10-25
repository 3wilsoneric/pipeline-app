import { isDocumentRequirementType } from "./document-requirements";
import { getAssessmentCompletionSummary } from "@/lib/assessment/assessment-completion";
import { assessmentInterviewFieldLabel, assessmentInterviewQuestions, isAssessmentQuestionVisible } from "@/lib/assessment/assessment-interview-schema";
import { assessmentSectionForField } from "@/lib/assessment/assessment-sections";
import type { AssessmentToolData, AssessmentToolFieldKey } from "@/lib/assessment/assessment-tool-schema";
import { isAssignedToUser } from "./referral-ownership";
import { getWorkspaceState, isRequirementGateActive, isRequirementStatusResolved } from "./workspace-state";
import type { OperationsWorkItem } from "./operations-types";
import type { Referral } from "./referral-types";
import type { PipelineWorkspaceLocation } from "./work-continuity";
import type { WorkflowContext } from "./workflow-records";

export type CompletionMemoTask = {
  id: string;
  group: "chart" | "assessment" | "review" | "follow_through";
  label: string;
  detail: string;
  action: string;
  location: PipelineWorkspaceLocation;
};

export type CompletionMemoClient = {
  referral_id: number;
  client_name: string;
  community: Referral["community"];
  owner: string;
  status: "accepted" | "admitted";
  assessment_signed: boolean;
  tasks: CompletionMemoTask[];
};

export type WeeklyCompletionMemo = {
  week_key: string;
  is_monday: boolean;
  scope: "personal" | "team";
  clients: CompletionMemoClient[];
  task_count: number;
};

export function buildWeeklyCompletionMemo({
  work,
  referrals,
  contexts,
  viewer,
  now,
}: {
  work: OperationsWorkItem[];
  referrals: Referral[];
  contexts: Map<number, WorkflowContext>;
  viewer: { id: string; name: string; email?: string; roles: readonly string[] };
  now: Date;
}): WeeklyCompletionMemo {
  const pacificDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(now);
  const datePart = (name: string) => pacificDate.find((part) => part.type === name)?.value ?? "";
  const today = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
  const weekday = datePart("weekday");
  const monday = new Date(`${today}T12:00:00.000Z`);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  monday.setUTCDate(monday.getUTCDate() - (weekdayIndex + 6) % 7);
  const scope = viewer.roles.includes("admin") || viewer.roles.includes("assessment_coordinator") ? "team" : "personal";
  const referralsById = new Map(referrals.map((referral) => [referral.id, referral]));
  const clients = work.flatMap((item): CompletionMemoClient[] => {
    const referral = referralsById.get(item.referral_id);
    if (!referral || referral.deletedAt || referral.placementCancellation || referral.workspaceStatus === "historical"
      || referral.workspaceStatus === "archived" || item.outcome_state !== "accepted") return [];
    const context = contexts.get(referral.id) ?? {};
    const assignment = context.assessmentAssessorId
      ? { ownerId: context.assessmentAssessorId, owner: context.assessmentData?.assessor }
      : referral;
    if (scope === "personal" && !isAssignedToUser(assignment, viewer)) return [];
    const state = getWorkspaceState(referral, context);
    const status = item.actual_admission_date || item.workflow_status === "admitted" ? "admitted" : "accepted";
    const tasks: CompletionMemoTask[] = [];
    const chartFields = [
      { id: "name", label: "Client name", value: referral.name, field: "name" },
      { id: "dob", label: "Date of birth", value: referral.dob, field: "dob" },
      { id: "gender", label: "Gender", value: referral.gender, field: "gender" },
      { id: "community", label: "Destination community", value: referral.community, field: "community" },
      { id: "referent", label: "Referral origin", value: referral.source, field: "referent" },
      { id: "county", label: "Referring county", value: referral.county, field: "county" },
      { id: "referralReceived", label: "Referral received date", value: referral.date, field: "referralReceived" },
    ] as const;
    for (const { id, label, value, field } of chartFields) {
      if (hasMemoValue(value, id === "gender")) continue;
      tasks.push({
        id: `profile:${id}`, group: "chart", label: `Record ${label.toLowerCase()}`,
        detail: `${label} is blank or contains a placeholder in the referral chart. Record the known value${id === "gender" ? ", or choose Unknown if it cannot be determined" : ""}.`,
        action: "Open chart", location: { view: "intake", intakeField: field },
      });
    }
    if (context.assessmentData) tasks.push(...assessmentTasks(context.assessmentData, state.assessment === "signed", referral));
    else if (context.assessmentId && state.assessment === "signed") tasks.push({
      id: "assessment:unavailable", group: "assessment", label: "Review the unavailable assessment answers",
      detail: "A signed assessment is referenced, but its answers were not available to this memo. Open the record before treating it as complete.",
      action: "Open assessment", location: { view: "assessment", assessmentMode: "review" },
    });
    if (state.assessment !== "signed") tasks.push({
      id: "assessment:signature", group: "assessment", label: "Sign the assessment",
      detail: context.assessmentData
        ? "No signed assessment is recorded. Complete the assessment gaps below, review the full record, then sign it."
        : "No signed assessment is recorded. Open the assessment to complete and sign it.",
      action: "Open assessment", location: { view: "assessment", assessmentMode: "review" },
    });
    const requirements = (context.requirements ?? referral.requirements ?? []).filter((requirement) =>
      isRequirementGateActive(requirement, { assessmentComplete: item.assessment_complete, outcome: "accepted" })
      && !isRequirementStatusResolved(requirement.status));
    for (const requirement of requirements) {
      if (requirement.type === "profile_field" && tasks.some((task) => task.label.toLowerCase().includes(requirement.label.toLowerCase()))) continue;
      const document = isDocumentRequirementType(requirement.type);
      const evidenceAttached = Boolean(requirement.evidenceDocumentId || requirement.evidenceDocumentName);
      const requested = document && !evidenceAttached && requirement.status === "requested";
      const unavailable = document && !evidenceAttached && requirement.status === "unavailable";
      const needsFile = document && !evidenceAttached && !requested && !unavailable;
      tasks.push({
        id: `requirement:${requirement.id}`,
        group: "follow_through",
        label: requested ? `Follow up on ${requirement.label.toLowerCase()} request`
          : unavailable ? `Resolve unavailable ${requirement.label.toLowerCase()}`
          : needsFile ? `Find or add ${requirement.label.toLowerCase()}`
          : `Update ${requirement.label.toLowerCase()} checklist status`,
        detail: requirement.evidenceDocumentName
          ? `${requirement.evidenceDocumentName} is linked, but the checklist still says ${requirement.status}. Review it and update the status.`
          : requested
            ? `The checklist says requested${requirement.requestedFrom ? ` from ${requirement.requestedFrom}` : ""}. Follow up in follow-through; add the file when it arrives.`
            : unavailable
              ? `The checklist says unavailable${requirement.unavailableReason ? `: ${requirement.unavailableReason}` : ""}. Record the appropriate resolution in follow-through.`
          : needsFile
            ? `No file is linked to this item. Check Files for an existing copy before uploading another one. If unavailable, record that in follow-through.`
            : `Checklist status: ${requirement.status}. Open follow-through to record the current status.`,
        action: needsFile ? "Open files" : "Open follow-through",
        location: { view: needsFile ? "files" : "workflow" },
      });
    }
    if (!context.packetSentAt) tasks.push({
      id: "handoff", group: "follow_through", label: "Review the Meet the Client handoff",
      detail: status === "admitted"
        ? "No sent handoff is recorded. Check whether the community received it outside Pipeline before sending anything."
        : "No sent handoff is recorded. Review the recipients, message, and selected files when placement is ready.",
      action: "Open handoff", location: { view: "email" },
    });
    if (status === "accepted" && item.planned_admission_date && item.planned_admission_date < today
      && scope === "team") tasks.push({
      id: "outcome", group: "follow_through", label: "Resolve the past planned admission date",
      detail: "Admissions should confirm whether placement occurred or record that it did not happen.",
      action: "Open follow-through", location: { view: "workflow" },
    });
    return tasks.length ? [{
      referral_id: referral.id, client_name: referral.name, community: referral.community,
      owner: context.assessmentAssessorId && context.assessmentData?.assessor || referral.owner,
      status, assessment_signed: state.assessment === "signed", tasks,
    }] : [];
  }).sort((left, right) =>
    Number(right.status === "accepted") - Number(left.status === "accepted")
    || right.tasks.length - left.tasks.length
    || left.client_name.localeCompare(right.client_name));
  return {
    week_key: monday.toISOString().slice(0, 10),
    is_monday: weekday === "Mon",
    scope,
    clients,
    task_count: clients.reduce((count, client) => count + client.tasks.length, 0),
  };
}

const memoPlaceholders = new Set(["", "n/a", "not reported", "pending", "referral packet", "tbd", "unassigned", "unknown", "name not recorded", "pending packet review"]);
const weakAnswerPlaceholders = new Set(["tbd", "see packet", "see referral packet", "same as above", "pending", "?"]);

function hasMemoValue(value: string | undefined, allowUnknown = false) {
  const normalized = (value ?? "").trim().toLowerCase();
  return (allowUnknown && normalized === "unknown") || !memoPlaceholders.has(normalized);
}

function assessmentLocation(field: AssessmentToolFieldKey): PipelineWorkspaceLocation {
  if (field === "assessor") return { view: "assessment", assessmentMode: "review" };
  return { view: "assessment", assessmentMode: "interview", assessmentSection: assessmentSectionForField(field), assessmentQuestion: field };
}

function comparableDate(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function assessmentTasks(data: AssessmentToolData, signed: boolean, referral: Referral): CompletionMemoTask[] {
  const tasks: CompletionMemoTask[] = [];
  for (const rule of getAssessmentCompletionSummary(data).missing) {
    const field = rule.key.startsWith("unable:")
      ? rule.key.slice("unable:".length) as AssessmentToolFieldKey
      : rule.fields[0];
    tasks.push({
      id: `assessment:${rule.key}`, group: "assessment", label: `Answer ${rule.label.toLowerCase()}`,
      detail: rule.key.startsWith("unable:")
        ? "The answer is ‘Unable to assess,’ but the required explanation is blank."
        : `This required assessment answer is blank.${signed ? " The signed record needs review and a documented correction." : ""}`,
      action: "Open question", location: assessmentLocation(field),
    });
  }
  if (!hasMemoValue(data.prior_setting_bucket ?? undefined)) tasks.push({
    id: "assessment:prior_setting_bucket", group: "assessment", label: "Record the most recent setting type",
    detail: "The assessment does not identify the setting the client came from for this referral.",
    action: "Open question", location: assessmentLocation("prior_setting_bucket"),
  });
  if (data.prior_setting_bucket && !["independent_family_home", "unhoused", "other"].includes(data.prior_setting_bucket)
    && !hasMemoValue(data.referring_facility ?? undefined)) tasks.push({
    id: "assessment:referring_facility", group: "assessment", label: "Record the most recent facility or program",
    detail: "A facility-based setting is selected, but its name is not recorded in the assessment.",
    action: "Open question", location: assessmentLocation("referring_facility"),
  });
  if (comparableDate(referral.dob) && comparableDate(data.date_of_birth)
    && comparableDate(referral.dob) !== comparableDate(data.date_of_birth)) tasks.push({
    id: "review:dob", group: "review", label: "Resolve the date-of-birth mismatch",
    detail: "The referral chart and assessment have different birth dates. Check the source record before correcting either one.",
    action: "Open question", location: assessmentLocation("date_of_birth"),
  });
  for (const question of assessmentInterviewQuestions) {
    if (!isAssessmentQuestionVisible(question, data) || !["text", "textarea", "timeline"].includes(question.control)) continue;
    const answer = data[question.field];
    if (typeof answer !== "string" || !weakAnswerPlaceholders.has(answer.trim().toLowerCase())) continue;
    tasks.push({
      id: `review:${question.field}`, group: "review", label: `Review ${assessmentInterviewFieldLabel(question.field).toLowerCase()}`,
      detail: `The answer reads “${answer.trim()},” which points elsewhere or leaves the question unresolved. Add the specific answer or explain what is unknown.`,
      action: "Open question", location: assessmentLocation(question.field),
    });
  }
  return tasks;
}
