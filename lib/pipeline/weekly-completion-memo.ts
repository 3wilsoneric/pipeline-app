import { isDocumentRequirementType } from "./document-requirements";
import { isAssignedToUser } from "./referral-ownership";
import { getWorkspaceState, isRequirementGateActive, isRequirementStatusResolved } from "./workspace-state";
import type { OperationsWorkItem } from "./operations-types";
import type { Referral } from "./referral-types";
import type { PipelineWorkspaceLocation } from "./work-continuity";
import type { WorkflowContext } from "./workflow-records";

export type CompletionMemoTask = {
  id: string;
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
    if (state.assessment !== "signed") tasks.push({
      id: "assessment", label: "Review and sign the assessment",
      detail: "The accepted decision is recorded, but this assessment has no signed record.",
      action: "Open assessment", location: { view: "assessment", assessmentMode: "review" },
    });
    for (const label of state.missing_profile_fields) {
      const field = label === "Date of birth" ? "dob" : label === "Referral source" ? "referent" : null;
      if (!field) continue;
      tasks.push({
        id: `profile:${field}`, label: `Record ${label.toLowerCase()}`,
        detail: "This field is blank or holds a placeholder in the referral chart.",
        action: "Open chart", location: { view: "intake", intakeField: field },
      });
    }
    if (!referral.county?.trim()) tasks.push({
      id: "profile:county", label: "Record county",
      detail: "The referral chart has no county recorded.",
      action: "Open chart", location: { view: "intake", intakeField: "county" },
    });
    const requirements = (context.requirements ?? referral.requirements ?? []).filter((requirement) =>
      isRequirementGateActive(requirement, { assessmentComplete: item.assessment_complete, outcome: "accepted" })
      && !isRequirementStatusResolved(requirement.status));
    for (const requirement of requirements) {
      if (requirement.type === "profile_field" && tasks.some((task) => task.label.toLowerCase().includes(requirement.label.toLowerCase()))) continue;
      const document = isDocumentRequirementType(requirement.type);
      const evidenceAttached = Boolean(requirement.evidenceDocumentId || requirement.evidenceDocumentName);
      tasks.push({
        id: `requirement:${requirement.id}`,
        label: `Verify ${requirement.label}`,
        detail: requirement.evidenceDocumentName
          ? `Evidence is attached (${requirement.evidenceDocumentName}), but its checklist status is ${requirement.status}.`
          : `Checklist status: ${requirement.status}. Check the record before requesting another file.`,
        action: document && !evidenceAttached ? "Open files" : "Review checklist",
        location: { view: document && !evidenceAttached ? "files" : "workflow" },
      });
    }
    if (!context.packetSentAt) tasks.push({
      id: "handoff", label: "Review the Meet the Client handoff",
      detail: status === "admitted"
        ? "No sent handoff is recorded. Check whether the community received it outside Pipeline before sending anything."
        : "No sent handoff is recorded. Review the recipients, message, and selected files when placement is ready.",
      action: "Open handoff", location: { view: "email" },
    });
    if (status === "accepted" && item.planned_admission_date && item.planned_admission_date < today
      && scope === "team") tasks.push({
      id: "outcome", label: "Resolve the past planned admission date",
      detail: "Admissions should confirm whether placement occurred or record that it did not happen.",
      action: "Open follow-through", location: { view: "workflow" },
    });
    return tasks.length ? [{
      referral_id: referral.id, client_name: referral.name, community: referral.community,
      owner: context.assessmentAssessorId && context.assessmentData?.assessor || referral.owner,
      status, tasks,
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
