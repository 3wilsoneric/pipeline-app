import type { OperatorRole } from "@/lib/training/operator-training-types";

export type OperatorGuideAdvance = "confirm" | "target-click" | "target-input" | "target-change";
export type OperatorGuidePlacement = "top" | "right" | "bottom" | "left" | "auto";
export type OperatorTutorialPersona = "assessor" | "supervisor" | "shared";

export type OperatorGuideStep = {
  id: string;
  route: string;
  target: string;
  phase: string;
  title: string;
  message: string;
  instruction: string;
  completion: string;
  why: string;
  safety: string;
  advance: OperatorGuideAdvance;
  placement?: OperatorGuidePlacement;
  optionalTarget?: boolean;
};

export type OperatorGuidedTutorial = {
  id: string;
  title: string;
  workflow: string;
  context: "app" | "workspace" | "practice";
  summary: string;
  outcome: string;
  minutes: number;
  persona: OperatorTutorialPersona;
  clickpath: readonly string[];
  audiences: readonly OperatorRole[];
  moduleIds: readonly string[];
  steps: readonly OperatorGuideStep[];
};

export type OperatorGuideChapter = {
  id: string;
  title: string;
  startStepIndex: number;
  steps: readonly OperatorGuideStep[];
};

export function operatorGuideStepTitle(step: OperatorGuideStep) { return step.title; }

export function operatorGuideChapters(tutorial: OperatorGuidedTutorial): readonly OperatorGuideChapter[] {
  const chapters: OperatorGuideChapter[] = [];
  for (const [stepIndex, step] of tutorial.steps.entries()) {
    const current = chapters.at(-1);
    if (current?.title === step.phase) {
      current.steps = [...current.steps, step];
      continue;
    }
    chapters.push({
      id: `${tutorial.id}:${step.phase.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${stepIndex}`,
      title: step.phase,
      startStepIndex: stepIndex,
      steps: [step],
    });
  }
  return chapters;
}

export function operatorGuideChapterAtStep(tutorial: OperatorGuidedTutorial, stepIndex: number) {
  return operatorGuideChapters(tutorial).find((chapter) => (
    stepIndex >= chapter.startStepIndex
    && stepIndex < chapter.startStepIndex + chapter.steps.length
  ));
}


const allRoles: readonly OperatorRole[] = ["admin", "assessment_coordinator", "reviewer", "viewer"];
const writeRoles: readonly OperatorRole[] = ["admin", "assessment_coordinator", "reviewer"];
const supervisorRoles: readonly OperatorRole[] = ["admin", "assessment_coordinator"];
const packet = "/?view=referrals&screen=packet";
const assessment = packet + "&workspaceStage=assessment";
const review = assessment + "&assessmentMode=review";
const files = packet + "&workspaceView=files";
const activity = packet + "&workspaceView=activity";
const decision = packet + "&workspaceView=workflow";
const email = packet + "&workspaceView=email";
const intakePractice = packet + "&trainingIntake=1";
const assessmentPractice = assessment + "&trainingAssessment=interview";

// Acknowledging a tooltip is not evidence that a clinical or delivery action occurred.
function step(id: string, route: string, target: string, title: string, instruction: string, advance: OperatorGuideAdvance = "confirm", optionalTarget = false): OperatorGuideStep {
  return { id, route, target, title, phase: title, instruction, message: instruction, completion: "Walkthrough step reviewed.", why: instruction,
    safety: "The walkthrough does not save, sign, or send on your behalf. Normal permissions still apply.", advance, optionalTarget };
}
function tutorial(definition: Pick<OperatorGuidedTutorial, "id" | "title" | "context" | "summary" | "steps"> & Partial<OperatorGuidedTutorial>): OperatorGuidedTutorial {
  return { workflow: "Pipeline", outcome: definition.summary, minutes: Math.max(1, Math.ceil(definition.steps.length / 2)), persona: "shared",
    clickpath: definition.steps.map((item) => item.title), audiences: allRoles, moduleIds: [], ...definition };
}
function assessmentSteps(route: string) {
  return [
    step("assessment-section", route, "assessment-section-nav", "Jump to a section", "Use Assessment section to jump directly to any part of this assessment. You do not need to finish the sections in order."),
    step("assessment-current", route, "assessment-recorded", "Current information", "Answers already recorded stay here. Select an answer to reopen it. On a phone, open Client info; on a tablet, expand Current information."),
    step("assessment-fields", route, "assessment-fields", "Work on remaining fields", "The question area keeps fields still needing attention together. Conditional follow-ups appear when relevant. Editing an answer does not create another assessment."),
    step("assessment-save", route, "assessment-save-status", "Check saving", "Changes save automatically. Check this status after editing. If saving fails, keep the assessment open and resolve the error before leaving."),
    step("assessment-next", route, "assessment-next-section", "Continue or jump", "Next moves through phone questions; Next section moves between sections. Use the section picker to jump elsewhere. Review & sign is at the end. Advancing this tutorial signs nothing."),
  ];
}

export const operatorGuidedTutorials: readonly OperatorGuidedTutorial[] = [
  tutorial({ id: "assessor-shift", title: "Find my next task", context: "app", persona: "assessor", audiences: writeRoles, summary: "Use Home and reopen assigned work.",
    steps: [
      step("assessor-home", "/", "my-queue", "Your work on Home", "Your assigned referrals show their current stage here. Open a referral to continue its saved work. An empty queue means no visible work in this scope."),
      step("assessor-directory", "/?view=referrals", "workspace-directory", "Look across Workspaces", "Use Workspaces when you need a different referral. Check the current filters before searching."),
      step("assessor-search", "/?view=referrals", "workspace-search", "Find a referral", "Search by client or referral details. Opening an existing result keeps its files and assessment together."),
    ] }),
  tutorial({ id: "find-workspace", title: "Find and reopen a referral", context: "app", summary: "Search existing work and return to the correct workspace.",
    steps: [
      step("find-search", "/?view=referrals", "workspace-search", "Search Workspaces", "Type part of the client's name or referral details. Clear filters if the expected referral is missing.", "target-input"),
      step("find-open", "/?view=referrals", "workspace-results", "Open the matching result", "Open the intended referral. Check identity before changing anything.", "target-click"),
      step("find-record", packet, "packet-workspace", "Continue this workspace", "Check the client and available pages. Chart, Assessment, Files, and Activity belong to this workspace. Do not create a new referral just to return to it."),
    ] }),
  tutorial({ id: "create-referral", title: "Start a referral", context: "practice", audiences: writeRoles, summary: "Explore intake with a fresh practice draft, without creating a live referral.",
    steps: [
      step("referral-packet", intakePractice, "initial-packet-upload", "Add referral documents", "This is a practice intake. In normal work, drop the packet here or choose multiple files. More files can be added to the same workspace later."),
      step("referral-identity", intakePractice, "intake-identity", "Confirm client details", "Review the identity fields and date of birth. Check extracted values before relying on them; age is calculated from date of birth."),
      step("referral-routing", intakePractice, "intake-routing", "Set referral details", "Set the referral source, contact information, and responsible assessor. These are referral details, not a confirmed admission."),
      step("referral-medications", intakePractice, "intake-medications", "Summary and medications", "Use these intake fields for the information available now. Later additions belong in this same workspace."),
      step("referral-create", intakePractice, "create-workspace", "Create once, then continue", "In live intake, Create referral establishes the referral. Later edits use that workspace. This practice guide stops here and creates no live referral."),
    ] }),
  tutorial({ id: "start-assessment", title: "Schedule an assessment", context: "workspace", persona: "assessor", audiences: writeRoles, summary: "Set an appointment in the open referral and continue to assessment.",
    steps: [
      step("schedule-open", assessment, "assessment-schedule-open", "Open scheduling", "Open the scheduling control under Assessment details. If an appointment already exists, review or change it there.", "target-click", true),
      step("schedule-details", assessment, "assessment-schedule-fields", "Set the appointment", "Choose the date, time, and duration. Check the time zone displayed in the form. This is the open referral's appointment.", "confirm", true),
      step("schedule-method", assessment, "assessment-schedule-method", "Choose how to meet", "Choose the interview method and supply the matching phone number, address, or meeting link.", "confirm", true),
      step("schedule-save", assessment, "assessment-schedule-save", "Save the appointment", "Select Schedule assessment when the details are correct. The guide advances only after scheduling succeeds. Skip if you are only looking.", "target-click", true),
      step("schedule-continue", assessment, "assessment-section-nav", "Continue the assessment", "After scheduling, continue in the assessment. The appointment remains linked to this referral and appears in Calendar.", "confirm", true),
    ] }),
  tutorial({ id: "complete-assessment", title: "Use the assessment", context: "workspace", persona: "assessor", audiences: writeRoles, summary: "Jump between sections, reopen answers, and check autosave.", steps: assessmentSteps(assessment) }),
  tutorial({ id: "practice-assessment", title: "Try the assessment controls", context: "practice", persona: "assessor", audiences: writeRoles, summary: "Use the same interface with a fresh synthetic case. Changes stay local.",
    steps: [step("practice-start", assessmentPractice, "assessment-section-nav", "A separate practice case", "This synthetic assessment is separate from live referrals. Answers save locally. Starting this tutorial again creates a fresh practice draft."), ...assessmentSteps(assessmentPractice)] }),
  tutorial({ id: "review-chart", title: "Review and sign", context: "workspace", persona: "assessor", audiences: writeRoles, summary: "Review the full assessment and locate the separate signing action.",
    steps: [
      step("review-chart", review, "assessment-review", "Review the full assessment", "Review the assembled chart and unanswered items. Return to Assessment to add or change an answer in the same assessment."),
      step("review-save", review, "assessment-save-status", "Check the save status", "Confirm changes have saved before signing. A saving or error message is not a successful save."),
      step("review-sign", review, "assessment-sign", "Sign when ready", "Sign & continue to decision is an explicit action with its own confirmation. Signing and sending the packet are separate. This tooltip does not sign for you.", "confirm", true),
    ] }),
  tutorial({ id: "record-decision", title: "Decision and admission date", context: "workspace", audiences: writeRoles, summary: "Find the decision, admission date, and next packet step.",
    steps: [
      step("decision", decision, "workspace-decision", "Record the decision", "Choose Accept, Deny, or Under review, then use the form's save action. An existing decision appears in this same area. Opening the page records nothing."),
      step("decision-date", decision, "workspace-admit-date", "Add the admission date", "For an accepted referral, enter the admission date when known. Accepted and admitted are separate states.", "confirm", true),
      step("decision-packet", decision, "workspace-finish-send", "Continue to the packet", "Continue to finish & send opens the packet and email workspace. Opening it does not send or notify recipients.", "confirm", true),
    ] }),
  tutorial({ id: "workspace-files", title: "Add and open files", context: "workspace", audiences: writeRoles, summary: "Add later documents without making another referral.",
    steps: [
      step("files-add", files, "workspace-files-upload", "Add more documents", "Drop additional documents here or choose files. They attach to this workspace, including documents received after the initial intake."),
      step("files-list", files, "workspace-files", "Open an existing file", "Review the attached documents here. Check the file name and client before using or removing a document."),
    ] }),
  tutorial({ id: "workspace-history", title: "Check change history", context: "workspace", summary: "See who changed the open workspace and when.",
    steps: [
      step("history", activity, "workspace-history", "Review Activity", "Expand an activity group to see recorded changes, the actor, and time. Masked or unavailable values are labeled; only available history is shown."),
      step("history-pages", activity, "workspace-stage-nav", "Return to the workspace", "Use the workspace pages to return to Chart or Assessment. Activity is a view of this referral, not another copy."),
    ] }),
  tutorial({ id: "prepare-packet", title: "Preview the packet and email", context: "workspace", audiences: writeRoles, summary: "Check the summary, files, recipients, and delivery status.",
    steps: [
      step("packet-preview", email, "workspace-packet-preview", "Review the packet", "Review the prepared summary and packet here. Check missing or unavailable material in the source workspace before sending."),
      step("packet-recipients", email, "packet-recipients", "Check recipients", "Review each authorized recipient and the subject. Previewing this page sends nothing.", "confirm", true),
      step("packet-files", email, "packet-attachments", "Inspect included files", "Open attachments to verify they belong to this client and are intended for these recipients.", "confirm", true),
      step("packet-send", email, "chart-email-handoff", "Sending is a separate action", "Recipient confirmation and Send belong to the real delivery form. Only send when authorized; completing this tutorial does not send anything.", "confirm", true),
      step("packet-status", email, "packet-delivery-status", "Check delivery status", "After a real send, check delivery status here. A preview, signature, or completed tutorial is not evidence of delivery.", "confirm", true),
    ] }),
  tutorial({ id: "calendar", title: "Use Calendar", context: "app", summary: "Find scheduled assessments and check the displayed scope.",
    steps: [
      step("calendar-view", "/?screen=calendar", "calendar-view", "Choose a view", "Choose the calendar view for the day or date range you need. The view changes how appointments are displayed."),
      step("calendar-filters", "/?screen=calendar", "calendar-filters", "Check whose appointments are shown", "Check the assessor and date filters. Team scope is available only when your account permits it."),
      step("calendar-events", "/?screen=calendar", "calendar-workspace", "Open linked work", "Open an appointment for its details and available referral actions. Changing views does not create or reschedule an appointment."),
    ] }),
  tutorial({ id: "clients", title: "Find a client chart", context: "app", summary: "Use Clients to find an existing chart.",
    steps: [
      step("clients", "/?screen=profiles", "client-directory", "Search Clients", "Search or filter the directory, then open the correct client. Check identity before using chart information."),
      step("clients-return", "/?view=referrals", "workspace-directory", "Return to referral work", "Use Workspaces for a referral episode and its assessment. A client chart and an active referral are different views, not reasons to create a duplicate."),
    ] }),
  tutorial({ id: "supervisor-shift", title: "Check team work", context: "app", persona: "supervisor", audiences: supervisorRoles, summary: "Inspect team scope and appointment coverage.",
    steps: [
      step("team-home", "/", "my-queue", "Check the Home queue", "Check the visible scope. Open the source referral to inspect its status; a stage label alone is not a completed action."),
      step("team-workspaces", "/?view=referrals", "workspace-directory", "Review team referrals", "Use available owner and stage filters to narrow team work. Board access does not override workspace edit permissions."),
      step("team-calendar", "/?screen=calendar", "calendar-filters", "Review appointment coverage", "Use the permitted assessor scope and date filters to review the team schedule."),
    ] }),
  tutorial({ id: "run-report", title: "Run a report", context: "app", persona: "supervisor", audiences: supervisorRoles, summary: "Choose a report, apply filters, and inspect the results.",
    steps: [
      step("report-choose", "/?screen=operations", "operations-report-select", "Choose a report", "Choose from this dropdown. Only reports permitted for your account are available."),
      step("report-scope", "/?screen=operations", "operations-summary", "Set the scope", "Set available period and grouping controls. Review the scope before interpreting totals."),
      step("report-apply", "/?screen=operations", "operations-report-apply", "Apply changed filters", "Apply refreshes results for your filters. If nothing changed, no refresh may be needed."),
      step("report-results", "/?screen=operations", "operations-report-results", "Read the result", "Review results and supporting rows. Empty results are not evidence that the filters include all work."),
      step("report-export", "/?screen=operations", "operations-report-export", "Export deliberately", "Export CSV downloads the report. Confirm scope before downloading or sharing. This tutorial does not export for you."),
    ] }),
];

export const operatorGuidedTutorialIds = operatorGuidedTutorials.map((item) => item.id);
export const operatorGuideTargetIds = [...new Set(operatorGuidedTutorials.flatMap((item) => item.steps.map((item) => item.target)))];
export const operatorGuideVerifiedActionTargets: Readonly<Record<Exclude<OperatorGuideAdvance, "confirm">, readonly string[]>> = {
  "target-click": ["workspace-results", "assessment-schedule-open", "assessment-schedule-save"],
  "target-input": ["workspace-search"],
  "target-change": [],
};
export const operatorGuideTargetSources: Readonly<Record<string, string>> = {
  "my-queue": "components/pipeline/PipelineWelcome.tsx",
  "workspace-directory": "components/pipeline/ReferralHomeDirectory.tsx",
  "workspace-search": "components/pipeline/ReferralHomeDirectory.tsx",
  "workspace-results": "components/pipeline/ReferralWorklist.tsx",
  "packet-workspace": "components/pipeline/ReferralPacketCanvas.tsx",
  "workspace-stage-nav": "components/pipeline/ReferralPacketCanvas.tsx",
  "initial-packet-upload": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-identity": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-routing": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-medications": "components/pipeline/ReferralPacketCanvas.tsx",
  "create-workspace": "components/pipeline/ReferralPacketCanvas.tsx",
  "assessment-section-nav": "components/pipeline/AssessmentWorkingSection.tsx",
  "assessment-recorded": "components/pipeline/AssessmentWorkingSection.tsx",
  "assessment-fields": "components/pipeline/AssessmentWorkingSection.tsx",
  "assessment-save-status": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-next-section": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-review": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-sign": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-schedule-open": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-schedule-fields": "components/pipeline/AssessmentSchedulingDialogs.tsx",
  "assessment-schedule-method": "components/pipeline/AssessmentSchedulingDialogs.tsx",
  "assessment-schedule-save": "components/pipeline/AssessmentSchedulingDialogs.tsx",
  "workspace-files": "components/pipeline/ReferralPacketCanvas.tsx",
  "workspace-files-upload": "components/pipeline/ReferralPacketCanvas.tsx",
  "workspace-history": "components/pipeline/ReferralActivityPanel.tsx",
  "workspace-decision": "components/pipeline/ReferralWorkflowPanelPresentation.tsx",
  "workspace-admit-date": "components/pipeline/ReferralWorkflowPanelPresentation.tsx",
  "workspace-finish-send": "components/pipeline/ReferralWorkflowPanelPresentation.tsx",
  "workspace-packet-preview": "components/pipeline/AssessmentChartWorkspace.tsx",
  "packet-recipients": "components/pipeline/AssessmentChartWorkspace.tsx",
  "packet-attachments": "components/pipeline/AssessmentChartWorkspace.tsx",
  "chart-email-handoff": "components/pipeline/AssessmentChartWorkspace.tsx",
  "packet-delivery-status": "components/pipeline/AssessmentChartWorkspace.tsx",
  "calendar-view": "components/pipeline/PipelineCalendarPresentation.tsx",
  "calendar-filters": "components/pipeline/PipelineCalendarPresentation.tsx",
  "calendar-workspace": "components/pipeline/PipelineCalendar.tsx",
  "client-directory": "components/pipeline/ClientProfileDirectory.tsx",
  "operations-report-select": "components/pipeline/OperationsDashboard.tsx",
  "operations-summary": "components/pipeline/OperationsDashboard.tsx",
  "operations-report-apply": "components/pipeline/OperationsDashboard.tsx",
  "operations-report-results": "components/pipeline/OperationsDashboard.tsx",
  "operations-report-export": "components/pipeline/OperationsDashboard.tsx"
};

export function getOperatorGuidedTutorial(id: string | null | undefined) {
  return operatorGuidedTutorials.find((tutorial) => tutorial.id === id);
}

export function guidedTutorialsForRole(role: OperatorRole) {
  return operatorGuidedTutorials.filter((tutorial) => tutorial.audiences.includes(role));
}

export function guidedTutorialsForRoles(roles: readonly string[]) {
  const assigned = new Set(roles);
  return operatorGuidedTutorials.filter((tutorial) => tutorial.audiences.some((role) => assigned.has(role)));
}
