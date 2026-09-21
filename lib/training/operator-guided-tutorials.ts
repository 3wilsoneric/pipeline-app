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

// Expected screen states, not assertions that the user completed a clinical action.
const expectedGuideResults: Readonly<Record<string, string>> = {
  "my-queue": "Referrals in the displayed scope, with a stage and a way to reopen each one.",
  "workspace-directory": "The referral directory with its current owner and stage filters.",
  "workspace-search": "Matching referrals as you type, or an empty result if no visible referral matches.",
  "workspace-results": "The selected referral opens with its client details and saved work.",
  "packet-workspace": "One workspace containing the client's chart, assessment, files, and activity.",
  "workspace-stage-nav": "The selected workspace page opens without creating another referral.",
  "initial-packet-upload": "Selected files appear in the intake packet. Wait for upload or processing errors to resolve.",
  "intake-identity": "Client identity and date of birth together, with age calculated from that date.",
  "intake-routing": "The referral source, contact details, and assigned assessor in the intake form.",
  "intake-medications": "The referral summary and available medication information in this intake.",
  "create-workspace": "In live intake, a created referral opens as a workspace. This practice draft does not create a live referral.",
  "assessment-section-nav": "The section name and its questions change together. Existing answers stay recorded.",
  "assessment-recorded": "Recorded answers for this section. Selecting an editable answer brings it back into the question area.",
  "assessment-fields": "An unanswered question, or a completed-section message when nothing remains in this section.",
  "assessment-save-status": "A saved confirmation after editing. Practice explicitly says changes are saved locally.",
  "assessment-next-section": "The next question or section opens. Saved answers remain available when you go back.",
  "assessment-review": "The assembled assessment with unanswered items visible, ready for your review.",
  "assessment-sign": "The signing confirmation appears only when you choose the signing action.",
  "assessment-schedule-open": "The appointment form for the referral currently open.",
  "assessment-schedule-fields": "The selected appointment date, time, duration, and displayed time zone.",
  "assessment-schedule-method": "Contact or location fields matching your chosen interview method.",
  "assessment-schedule-save": "After a successful save, the appointment form closes and the assessment workspace returns.",
  "workspace-decision": "The saved decision displayed on this referral. Viewing the form does not change it.",
  "workspace-admit-date": "The admission date on the accepted referral; acceptance alone is not an admission.",
  "workspace-finish-send": "The packet and email preparation page, with no message sent yet.",
  "workspace-files-upload": "The new documents join this referral's file list after upload succeeds.",
  "workspace-files": "The chosen file opens for inspection, or an explicit message if it is unavailable.",
  "workspace-history": "Recorded changes with an actor and time, or an empty history message.",
  "workspace-packet-preview": "The prepared assessment summary and packet, including any missing-material notices.",
  "packet-open-email": "The separate email preview opens with recipient controls and attachments. No message is sent.",
  "packet-recipients": "The intended recipients and subject before delivery is confirmed.",
  "packet-attachments": "The documents selected for this packet, available to inspect before sending.",
  "chart-email-handoff": "A separate recipient confirmation and Send action. Continuing this tutorial sends nothing.",
  "packet-delivery-status": "The actual delivery status. A draft or preview must not be treated as a sent packet.",
  "calendar-view": "Appointments displayed in the selected calendar view and date range.",
  "calendar-filters": "The current assessor and date scope, limited to what your account can access.",
  "calendar-workspace": "Appointment details and a route back to its linked referral.",
  "client-directory": "Matching client charts, with identity details to distinguish similar names.",
  "operations-report-select": "The selected report and its available controls.",
  "operations-summary": "The period and grouping that will be used for the report.",
  "operations-report-apply": "Updated results for the applied filters, or an error to resolve before relying on them.",
  "operations-report-results": "Report totals and supporting rows for the scope shown on the page.",
  "operations-report-export": "A CSV download only after you explicitly choose Export CSV.",
};

// Acknowledging a tooltip is not evidence that a clinical or delivery action occurred.
function step(id: string, route: string, target: string, title: string, instruction: string, advance: OperatorGuideAdvance = "confirm", optionalTarget = false): OperatorGuideStep {
  const completion = id === "practice-start" ? "A synthetic case with recorded answers beside fields still needing attention. Refreshing resets this practice case."
    : target === "assessment-save-status" && route.includes("trainingAssessment=") ? "The practice status confirms edits in this open session. Refreshing or reopening the case resets its answers."
    : expectedGuideResults[target];
  return { id, route, target, title, phase: title, instruction, message: instruction, completion, why: instruction,
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
    step("assessment-save", route, "assessment-save-status", "Check saving", route.includes("trainingAssessment=") ? "Check the practice status after editing. Practice answers last only while this assessment stays open; refreshing resets them. Live referrals use normal autosave." : "Changes save automatically. Check this status after editing. If saving fails, keep the assessment open and resolve the error before leaving."),
    step("assessment-next", route, "assessment-next-section", "Continue or jump", "Next moves through phone questions; Next section moves between sections. Use the section picker to jump elsewhere. Review & sign is at the end. Advancing this tutorial signs nothing."),
  ];
}

export const operatorGuidedTutorials: readonly OperatorGuidedTutorial[] = [
  tutorial({ id: "assessor-shift", title: "See my referrals", context: "app", persona: "assessor", audiences: writeRoles, summary: "Open your assigned referrals from Home.",
    steps: [
      step("assessor-home", "/", "my-queue", "Your work on Home", "Your assigned referrals show their current stage here. Open a referral to continue its saved work. An empty queue means no visible work in this scope."),
      step("assessor-directory", "/?view=referrals", "workspace-directory", "Look across Workspaces", "Use Workspaces when you need a different referral. Check the current filters before searching."),
      step("assessor-search", "/?view=referrals", "workspace-search", "Find a referral", "Search by client or referral details. Opening an existing result keeps its files and assessment together."),
      step("assessor-open", "/?view=referrals", "workspace-results", "Choose the existing referral", "Check the matching client and community, then open that result to resume work. Keep later updates in the same workspace."),
    ] }),
  tutorial({ id: "find-workspace", title: "Find a referral", context: "app", summary: "Find an existing referral and pick up where you left off.",
    steps: [
      step("find-search", "/?view=referrals", "workspace-search", "Search Workspaces", "Type part of the client's name or referral details. Clear filters if the expected referral is missing.", "target-input"),
      step("find-open", "/?view=referrals", "workspace-results", "Open the matching result", "Open the intended referral. Check identity before changing anything.", "target-click"),
      step("find-record", packet, "packet-workspace", "Continue this workspace", "Check the client and available pages. Chart, Assessment, Files, and Activity belong to this workspace. Do not create a new referral just to return to it."),
      step("find-pages", packet, "workspace-stage-nav", "Choose the workspace page", "Use the workspace tabs, or the Workspace view menu on a phone, to switch between the chart, assessment, files, and activity."),
    ] }),
  tutorial({ id: "create-referral", title: "Create a referral", context: "practice", audiences: writeRoles, summary: "Practice adding files and client details. No real referral is created.",
    steps: [
      step("referral-packet", intakePractice, "initial-packet-upload", "Add referral documents", "This is a practice intake. In normal work, drop the packet here or choose multiple files. More files can be added to the same workspace later."),
      step("referral-identity", intakePractice, "intake-identity", "Confirm client details", "Review the identity fields and date of birth. Enter and verify the details from your source documents; age is calculated from date of birth."),
      step("referral-routing", intakePractice, "intake-routing", "Set referral details", "Set the referral source, contact information, and responsible assessor. These are referral details, not a confirmed admission."),
      step("referral-medications", intakePractice, "intake-medications", "Summary and medications", "Use these intake fields for the information available now. Later additions belong in this same workspace."),
      step("referral-create", intakePractice, "create-workspace", "Create once, then continue", "In live intake, Create referral establishes the referral. Later edits use that workspace. This practice guide stops here and creates no live referral."),
    ] }),
  tutorial({ id: "start-assessment", title: "Schedule an assessment", context: "workspace", persona: "assessor", audiences: writeRoles, summary: "Set the appointment, then begin the assessment.",
    steps: [
      step("schedule-open", assessment, "assessment-schedule-open", "Open scheduling", "Open the scheduling control under Assessment details. If an appointment already exists, review or change it there.", "target-click", true),
      step("schedule-details", assessment, "assessment-schedule-fields", "Set the appointment", "Choose the date, time, and duration. Check the time zone displayed in the form. This is the open referral's appointment.", "confirm", true),
      step("schedule-method", assessment, "assessment-schedule-method", "Choose how to meet", "Choose the interview method and supply the matching phone number, address, or meeting link.", "confirm", true),
      step("schedule-save", assessment, "assessment-schedule-save", "Save the appointment", "Select Schedule assessment when the details are correct. The guide advances only after scheduling succeeds. Skip if you are only looking.", "target-click", true),
      step("schedule-continue", assessment, "assessment-section-nav", "Continue the assessment", "After scheduling, continue in the assessment. The appointment remains linked to this referral and appears in Calendar.", "confirm", true),
    ] }),
  tutorial({ id: "complete-assessment", title: "Fill out the assessment", context: "workspace", persona: "assessor", audiences: writeRoles, summary: "Answer questions, change earlier answers, and check that they saved.", steps: assessmentSteps(assessment) }),
  tutorial({ id: "practice-assessment", title: "Practice an assessment", context: "practice", persona: "assessor", audiences: writeRoles, summary: "Try a sample assessment without changing real client information. Refreshing resets it.",
    steps: [step("practice-start", assessmentPractice + "&assessmentSection=functional_adl", "assessment-section-nav", "A separate practice case", "Use this synthetic case to try the controls without changing a live referral. Practice edits last while the assessment stays open. Restarting or refreshing resets the case."), ...assessmentSteps(assessmentPractice)] }),
  tutorial({ id: "review-chart", title: "Sign the assessment", context: "workspace", persona: "assessor", audiences: writeRoles, summary: "Check your answers, then sign when ready.",
    steps: [
      step("review-chart", review, "assessment-review", "Review the full assessment", "Review the assembled chart and unanswered items. Return to Assessment to add or change an answer in the same assessment."),
      step("review-save", review, "assessment-save-status", "Check the save status", "Confirm changes have saved before signing. A saving or error message is not a successful save."),
      step("review-return", review, "workspace-stage-nav", "Return to an earlier page", "Use the workspace navigation to reopen Assessment or Files when something needs attention. Return to review after making the change; opening a page does not sign."),
      step("review-sign", review, "assessment-sign", "Sign when ready", "Sign & continue to decision is an explicit action with its own confirmation. Signing and sending the packet are separate. This tooltip does not sign for you.", "confirm", true),
    ] }),
  tutorial({ id: "record-decision", title: "Accept or decline a referral", context: "workspace", audiences: writeRoles, summary: "Record the decision. If accepted, add the admission date when known.",
    steps: [
      step("decision", decision, "workspace-decision", "Record the decision", "Choose Accept, Deny, or Under review, then use the form's save action. An existing decision appears in this same area. Opening the page records nothing."),
      step("decision-check", decision, "workspace-decision", "Check the recorded decision", "After saving, check the decision shown for this referral. Acceptance does not sign an assessment or send a packet; those actions remain separate."),
      step("decision-date", decision, "workspace-admit-date", "Add the admission date", "For an accepted referral, enter the admission date when known. Accepted and admitted are separate states.", "confirm", true),
      step("decision-packet", decision, "workspace-finish-send", "Continue to the packet", "Continue to finish & send opens the packet and email workspace. Opening it does not send or notify recipients.", "confirm", true),
    ] }),
  tutorial({ id: "workspace-files", title: "Add or open files", context: "workspace", audiences: writeRoles, summary: "Keep new documents with the same referral.",
    steps: [
      step("files-add", files, "workspace-files-upload", "Add more documents", "Drop additional documents here or choose files. They attach to this workspace, including documents received after the initial intake."),
      step("files-list", files, "workspace-files", "Open an existing file", "Review the attached documents here. Check the file name and client before using or removing a document."),
      step("files-preview", files, "workspace-files", "Preview or open the document", "Select the document to preview it, or use its open action. If that file type has no inline preview, open the original file to inspect it."),
      step("files-remove", files, "workspace-files", "Remove only the intended file", "Use the document removal action only when needed. Check the file named in the confirmation; cancel to keep it. This walkthrough removes nothing."),
    ] }),
  tutorial({ id: "workspace-history", title: "See what changed", context: "workspace", summary: "See who changed this referral and when.",
    steps: [
      step("history", activity, "workspace-history", "Review Activity", "Expand an activity group to see recorded changes, the actor, and time. Masked or unavailable values are labeled; only available history is shown."),
      step("history-detail", activity, "workspace-history", "Read the change details", "Open the relevant group and compare the recorded change with its actor and time. Use the source page if you need to verify the current value."),
      step("history-limits", activity, "workspace-history", "Recognize unavailable values", "A masked or unavailable value is not an empty answer. Activity only shows the history available to your account; return to the current record to continue work."),
      step("history-pages", activity, "workspace-stage-nav", "Return to the workspace", "Use the workspace pages to return to Chart or Assessment. Activity is a view of this referral, not another copy."),
    ] }),
  tutorial({ id: "prepare-packet", title: "Prepare and send the packet", context: "workspace", audiences: writeRoles, summary: "Check the packet and recipients before choosing to send.",
    steps: [
      step("packet-preview", email, "workspace-packet-preview", "Review the packet", "Review the prepared summary and packet here. Check missing or unavailable material in the source workspace before sending."),
      step("packet-status", email, "packet-delivery-status", "Check delivery status", "After a real send, check delivery status here. A preview, signature, or completed tutorial is not evidence of delivery.", "confirm", true),
      step("packet-send", email, "packet-open-email", "Sending is a separate action", "The next window contains recipients, subject, attachments, and a separate confirmation and Send action. Check each recipient and open the attachments to verify they belong to this client. Only send when authorized; completing this tutorial sends nothing."),
      step("packet-open-email", email, "packet-open-email", "Open the email preview", "Select Preview email (or View email) to finish this walkthrough and open the email window. Opening it sends nothing. Review the recipients and files there, then close the window to return here without sending.", "target-click"),
    ] }),
  tutorial({ id: "calendar", title: "Open the calendar", context: "app", summary: "Find appointments and open their referrals.",
    steps: [
      step("calendar-view", "/?screen=calendar", "calendar-view", "Choose a view", "Choose the calendar view for the day or date range you need. The view changes how appointments are displayed."),
      step("calendar-filters", "/?screen=calendar", "calendar-filters", "Check whose appointments are shown", "Check the assessor and date filters. Team scope is available only when your account permits it."),
      step("calendar-events", "/?screen=calendar", "calendar-workspace", "Open linked work", "Open an appointment for its details and available referral actions. Changing views does not create or reschedule an appointment."),
      step("calendar-return", "/?view=referrals", "workspace-directory", "Find work without an appointment", "Use Workspaces to find referrals even when they have no calendar appointment. Search and open the existing referral to continue."),
    ] }),
  tutorial({ id: "clients", title: "Find a client chart", context: "app", summary: "Use Clients to find an existing chart.",
    steps: [
      step("clients", "/?screen=profiles", "client-directory", "Search Clients", "Search or filter the directory, then open the correct client. Check identity before using chart information."),
      step("clients-identity", "/?screen=profiles", "client-directory", "Confirm the matching client", "Check the community and client details before opening a chart, especially when names are similar."),
      step("clients-chart", "/?screen=profiles", "client-directory", "Open the chart", "Open the matching client to inspect the available chart and documents. Close it to return to the directory; opening a chart creates no new referral."),
      step("clients-return", "/?view=referrals", "workspace-directory", "Return to referral work", "Use Workspaces for a referral episode and its assessment. A client chart and an active referral are different views, not reasons to create a duplicate."),
    ] }),
  tutorial({ id: "supervisor-shift", title: "See team referrals", context: "app", persona: "supervisor", audiences: supervisorRoles, summary: "See team referrals and appointments.",
    steps: [
      step("team-home", "/", "my-queue", "Check the Home queue", "Check the visible scope. Open the source referral to inspect its status; a stage label alone is not a completed action."),
      step("team-workspaces", "/?view=referrals", "workspace-directory", "Review team referrals", "Use available owner and stage filters to narrow team work. Board access does not override workspace edit permissions."),
      step("team-search", "/?view=referrals", "workspace-search", "Find a team referral", "Search by client or referral details after choosing the intended scope. Clear filters when the expected referral is not listed."),
      step("team-calendar", "/?screen=calendar", "calendar-filters", "Review appointment coverage", "Use the permitted assessor scope and date filters to review the team schedule."),
    ] }),
  tutorial({ id: "run-report", title: "View reports", context: "app", persona: "supervisor", audiences: supervisorRoles, summary: "Choose a report and the dates you need.",
    steps: [
      step("report-choose", "/?screen=operations", "operations-report-select", "Choose a report", "Choose from this dropdown. Only reports permitted for your account are available."),
      step("report-scope", "/?screen=operations", "operations-summary", "Set the scope", "Set available period and grouping controls. Review the scope before interpreting totals."),
      step("report-apply", "/?screen=operations", "operations-report-apply", "Apply changed filters", "Apply refreshes results for your filters. If nothing changed, no refresh may be needed."),
      step("report-results", "/?screen=operations", "operations-report-results", "Read the result", "Review results and supporting rows. Empty results are not evidence that the filters include all work."),
      step("report-export", "/?screen=operations", "operations-report-export", "Export deliberately", "Export CSV downloads the report. Confirm scope before downloading or sharing. This tutorial does not export for you."),
    ] }),
];

export const operatorGuidedTutorialIds = operatorGuidedTutorials.map((item) => item.id);

// Group the existing guides without changing their saved progress or permissions.
export const operatorGuideTopics = [
  { id: "create", title: "Create a referral", tutorialIds: ["create-referral"] },
  { id: "assess", title: "Schedule & assess", tutorialIds: ["start-assessment", "complete-assessment", "review-chart", "practice-assessment"] },
  { id: "admit", title: "Decide & admit", tutorialIds: ["record-decision", "prepare-packet"] },
  { id: "find", title: "Find work & files", tutorialIds: ["assessor-shift", "find-workspace", "workspace-files", "workspace-history", "calendar", "clients"] },
  { id: "team", title: "Team & reports", tutorialIds: ["supervisor-shift", "run-report"] },
] as const;
export const operatorGuideTargetIds = [...new Set(operatorGuidedTutorials.flatMap((item) => item.steps.map((item) => item.target)))];
export const operatorGuideVerifiedActionTargets: Readonly<Record<Exclude<OperatorGuideAdvance, "confirm">, readonly string[]>> = {
  "target-click": ["packet-open-email", "workspace-results", "assessment-schedule-open", "assessment-schedule-save"],
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
  "initial-packet-upload": "components/pipeline/ReferralDocumentUpload.tsx",
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
  "workspace-files-upload": "components/pipeline/ReferralDocumentUpload.tsx",
  "workspace-history": "components/pipeline/ReferralActivityPanel.tsx",
  "workspace-decision": "components/pipeline/ReferralWorkflowPanelPresentation.tsx",
  "workspace-admit-date": "components/pipeline/ReferralWorkflowPanelPresentation.tsx",
  "workspace-finish-send": "components/pipeline/ReferralWorkflowPanelPresentation.tsx",
  "workspace-packet-preview": "components/pipeline/AssessmentChartWorkspace.tsx",
  "packet-open-email": "components/pipeline/AssessmentChartWorkspace.tsx",
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
