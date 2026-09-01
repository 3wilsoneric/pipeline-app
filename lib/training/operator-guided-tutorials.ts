import type { OperatorRole } from "@/lib/training/operator-training-types";

export type OperatorGuideAdvance = "confirm" | "target-click" | "target-input" | "target-change";

export type OperatorGuidePlacement = "top" | "right" | "bottom" | "left" | "auto";

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
  summary: string;
  outcome: string;
  minutes: number;
  audiences: readonly OperatorRole[];
  moduleIds: readonly string[];
  steps: readonly OperatorGuideStep[];
};

const allRoles: readonly OperatorRole[] = ["admin", "assessment_coordinator", "reviewer", "viewer"];
const writeRoles: readonly OperatorRole[] = ["admin", "assessment_coordinator", "reviewer"];
const leadRoles: readonly OperatorRole[] = ["admin", "assessment_coordinator", "reviewer", "viewer"];

export const operatorGuidedTutorials: readonly OperatorGuidedTutorial[] = [
  tutorial(
    "practice-assessment",
    "Practice the assessment",
    "Complete five assessment actions with a synthetic record.",
    "Assessment practice",
    "Navigate, answer a conditional question, and write one note.",
    5,
    writeRoles,
    ["assessment-questionnaire"],
    [
      step("practice-sections", "/note-lab/practice", "practice-function-section", "Navigate", "Open Function", "Use the section rail to move through the assessment.", "Select Function in the section rail.", "Function is open.", "The practice path matches the live assessment.", "Use only synthetic information in this practice record.", "target-click", "right"),
      step("practice-condition", "/note-lab/practice", "practice-assistance-level", "Answer", "Set dressing support", "This answer reveals the conditional detail field.", "Choose Some assistance or Total assistance.", "The detail field appears.", "Conditional questions show only relevant follow-ups.", "Use only synthetic information in this practice record.", "target-change", "bottom"),
      step("practice-detail", "/note-lab/practice", "practice-assistance-details", "Write", "Describe the support", "Enter one specific sentence about dressing support.", "Name the task and assistance needed.", "The detail is present.", "Specific functional support is easier to act on.", "The guide detects typing but does not read or store the answer.", "target-input", "bottom"),
      step("practice-clinical", "/note-lab/practice", "practice-clinical-section", "Navigate", "Open Clinical", "Return to the section rail for the Clinical fields.", "Select Clinical in the section rail.", "Clinical is open.", "The practice sequence matches the production form.", "This is writing practice, not clinical decision support.", "target-click", "right"),
      step("practice-narrative", "/note-lab/practice", "practice-current-symptoms", "Write", "Add current symptoms", "Enter one current-symptoms note using synthetic facts.", "Record observation, report, and effect.", "The note is present.", "A consistent note structure makes review more reliable.", "Do not copy examples as facts or enter real client information.", "target-input", "bottom"),
    ],
  ),
  tutorial(
    "first-shift",
    "Run your start-of-shift workflow",
    "Start with assigned work, narrow the active referral queue, check the assessment calendar, and return with a clear next action.",
    "Start of shift",
    "Prioritize the right referral work using ownership, scope, and schedule instead of memory.",
    8,
    allRoles,
    ["pipeline-purpose", "navigation-model"],
    [
      step("prioritize-queue", "/", "my-queue", "Prioritize", "Read your due-today, overdue, and blocked work", "Your assigned queue is the first source for accountable work. Recent items are only a shortcut.", "Identify the first item you would work and whether it is actionable or blocked.", "You can explain why one item comes first.", "Ownership and urgency create a repeatable start to each shift.", "Open the underlying referral before changing anything; a count alone is not evidence.", "confirm", "right"),
      step("open-workspaces", "/", "primary-workspaces", "Locate", "Open the shared referral queue", "Move from your personal priorities to the governed inventory of referral episodes.", "Select the highlighted Workspaces control.", "The referral workspace directory is open.", "The shared inventory lets the team coordinate on the same records.", "Opening the queue is read-only.", "target-click", "bottom"),
      step("select-current-work", "/?view=referrals", "workspace-views", "Scope", "Limit the list to actionable work", "Current work separates active workflow from total historical volume and files.", "Select Current work in the highlighted workspace views.", "Current work is the active view.", "An explicit scope keeps historical volume out of today\'s queue.", "Changing views never changes referral state.", "target-click", "right"),
      step("search-active-work", "/?view=referrals", "workspace-search", "Find", "Run a focused workspace search", "Use the known client, community, county, owner, or source instead of scanning cards from memory.", "Enter one approved search criterion. The guide detects the action but never reads or stores the value.", "The result set narrows after you type.", "Search is the first defense against duplicate work.", "Treat results as candidates until identity and episode details are verified.", "target-input", "bottom"),
      step("open-calendar", "/?view=referrals", "primary-calendar", "Coordinate", "Open scheduled assessment work", "After identifying active work, check what is already scheduled before creating a parallel reminder.", "Select the highlighted Calendar control.", "The assessment calendar is open.", "Linked scheduling keeps the appointment attached to its referral.", "Opening Calendar does not create or modify an event.", "target-click", "bottom"),
      step("choose-calendar-view", "/?screen=calendar", "calendar-view", "Coordinate", "Choose the time horizon for the question", "Month shows capacity, week supports near-term coordination, and agenda emphasizes a chronological worklist.", "Select Month, Week, or Agenda.", "The calendar changes to the selected view.", "The right time horizon makes schedule gaps visible.", "Changing the view is read-only.", "target-click", "bottom"),
      step("scope-calendar", "/?screen=calendar", "calendar-filters", "Coordinate", "Apply one schedule filter", "Scope the schedule by community, assessor, event type, or your own assignments.", "Change one highlighted filter.", "The calendar reflects the selected scope.", "A scoped calendar prevents unrelated events from distorting workload.", "Filters never reassign an assessment.", "target-change", "bottom"),
      step("return-home", "/?screen=calendar", "pipeline-home", "Resume", "Return to accountable work", "Close the loop by returning to the queue with a specific referral or blocker in mind.", "Select the Pipeline home control.", "You are back at your assigned queue.", "A stable return path makes the workflow resilient to interruption.", "Returning home does not discard saved work.", "target-click", "bottom"),
    ],
  ),
  tutorial(
    "safe-intake",
    "Triage and prepare a new referral",
    "Open the referral draft, attach the source packet, verify core fields, assign ownership, carry medication context, and stop at the creation boundary.",
    "Referral intake",
    "Prepare one source-backed referral draft without creating a duplicate or treating extraction as verified fact.",
    12,
    writeRoles,
    ["inbound-triage", "create-referral", "medication-intake", "upload-packet"],
    [
      step("open-new-referral", "/", "primary-new-referral", "Start", "Open a governed referral draft", "Begin here only after searching for an existing client and referral episode.", "Select New referral.", "An unsaved referral draft is open.", "A single entry point protects ownership and audit history.", "Opening the form does not create a record.", "target-click", "bottom"),
      step("attach-source", "/?view=referrals&screen=packet", "initial-packet-upload", "Source", "Attach the initial packet", "The source packet anchors extracted and manually entered values to evidence.", "Choose the correct document type, then browse or drop an authorized packet. Use synthetic material in practice.", "The selected filename appears as ready to upload.", "Source-first intake makes later corrections explainable.", "Verify the workspace and minimum-necessary handling before selecting a real packet.", "target-change", "left"),
      step("verify-identity", "/?view=referrals&screen=packet", "intake-identity", "Identity", "Enter or correct an identity field", "Compare the source material with any proposed values. Conflicts are stop conditions, not invitations to guess.", "Enter or correct one identity field, then leave the field.", "The draft reflects the source-backed value.", "Identity accuracy protects assessment, reporting, and EHR matching.", "The guide detects an edit event but never reads the value. Do not accept extraction solely because confidence is high.", "target-input", "top"),
      step("assign-routing", "/?view=referrals&screen=packet", "intake-routing", "Ownership", "Set operational routing", "Community, county, received date, source, contact, and owner determine where the referral belongs and who moves it forward.", "Change one routing or assignment field using source evidence.", "The draft has an accountable destination or owner update.", "Unowned referrals disappear between teams.", "Do not make an unexplained reassignment or use a shared identity.", "target-change", "top"),
      step("carry-medications", "/?view=referrals&screen=packet", "intake-medications", "Clinical context", "Capture supplied medication context", "Intake medications seed the assessor\'s review without becoming a verified clinical list.", "Enter or correct the supplied medication context, then leave the field.", "Medication context is present for assessor verification.", "Carry-forward avoids retyping while preserving provenance.", "Never reconcile, prescribe, or mark intake medications clinically verified from this step.", "target-input", "top"),
      step("review-readiness", "/?view=referrals&screen=packet", "workspace-stage-nav", "Readiness", "Check the ordered workflow before creation", "Intake, assessment, files, and activity remain attached to one referral episode.", "Confirm the packet, identity, routing, and medication context are coherent before continuing.", "You can name every unresolved field or document.", "A readiness pause prevents incomplete records from entering queues.", "Do not jump to assessment or decision to bypass missing intake evidence.", "confirm", "bottom"),
      step("creation-checkpoint", "/?view=referrals&screen=packet", "create-workspace", "Commit", "Stop at the record-creation boundary", "Create stores the referral and begins asynchronous packet processing.", "Perform a final duplicate, identity, source, owner, and packet check. Complete the guide; create the workspace yourself only for authorized real work.", "The draft is either deliberately created by you or deliberately left unsaved.", "An explicit commit boundary keeps incomplete drafts out of operational queues.", "The guide never clicks Create, Save, Sign, Decide, Export, Schedule, or Handoff.", "confirm", "left"),
    ],
  ),
  tutorial(
    "coordinate-work",
    "Prepare and schedule an assessment",
    "Find the correct referral, open its assessment stage, prepare scheduling details, and stop at the schedule submission boundary.",
    "Assessment preparation",
    "Move one ready referral from lookup into a correctly scoped assessment schedule without creating a duplicate event.",
    10,
    writeRoles,
    ["navigation-model", "preassessment-checklist", "calendar-coordination"],
    [
      step("find-referral", "/?view=referrals", "workspace-search", "Find", "Search for the referral episode", "Scheduling must begin from the existing referral rather than a detached calendar event.", "Enter a client, source, owner, community, or county criterion.", "The candidate referral set is narrowed.", "Lookup first prevents duplicate assessment work.", "A matching label is not proof of identity; verify the episode before opening it.", "target-input", "bottom"),
      step("open-referral", "/?view=referrals", "workspace-results", "Verify", "Open the correct referral workspace", "Use the row or card to inspect evidence, owner, blockers, and the assessment state.", "Select the intended referral from the highlighted results.", "The selected referral workspace is open.", "Scheduling stays traceable when it begins from the source record.", "Do not open or discuss a record unless it is required for your work.", "target-click", "top"),
      step("open-assessment-stage", "/?view=referrals&screen=packet", "assessment-stage", "Prepare", "Move to the assessment stage", "The assessment remains part of the same referral lifecycle and inherits approved intake context.", "Select Assessment in the workspace stages.", "The assessment stage is visible.", "One lifecycle prevents assessment notes and packet evidence from drifting apart.", "Do not bypass unresolved readiness requirements.", "target-click", "bottom"),
      step("open-schedule", "/?view=referrals&screen=packet", "assessment-schedule-open", "Schedule", "Open the linked scheduling flow", "The assigned assessor schedules or reschedules the interview from the assessment workspace.", "Select Schedule assessment, Open assessment, or Reschedule when available.", "The schedule dialog is open.", "A linked schedule appears on the shared calendar without a second event record.", "If this control is unavailable, stop and resolve ownership or permissions instead of working around it.", "target-click", "left", true),
      step("set-schedule", "/?view=referrals&screen=packet", "assessment-schedule-fields", "Schedule", "Set the interview details", "Choose date, duration, and method. Use Zoom only with the approved meeting link for the real referral.", "Change one scheduling field and review the remaining fields before continuing.", "The draft schedule reflects the intended interview details.", "Complete scheduling data prevents ambiguous handoffs to the assessor.", "The guide detects a field change but never reads the date, link, or method.", "target-change", "left", true),
      step("schedule-checkpoint", "/?view=referrals&screen=packet", "assessment-schedule-save", "Commit", "Stop at schedule submission", "Submitting creates or updates accountable calendar work for the assigned assessor.", "Verify the referral, assessor, date, duration, method, and location or Zoom link. Complete the guide, then submit the schedule yourself if authorized.", "The schedule is deliberately submitted by you or left unchanged for escalation.", "A human commit preserves accountability for timing and meeting details.", "The guide never clicks Schedule assessment or Save new time.", "confirm", "left", true),
    ],
  ),
  tutorial(
    "operational-control",
    "Run the operations control loop",
    "Read queue health, filter exceptions, open evidence, reproduce a report period, and stop at the export boundary.",
    "Operational control",
    "Turn an operational signal into an owned next action and a reproducible report scope.",
    8,
    leadRoles,
    ["dashboard-meaning", "supervisor-exceptions", "filter-report-export", "processing-failure"],
    [
      step("read-summary", "/?screen=operations", "operations-summary", "Detect", "Identify the operational signal", "Compare active referrals, open tasks, and overdue work in the current freshness context.", "Choose the metric that requires follow-up and state what population it represents.", "You can name the metric, scope, and limitation.", "Metrics prioritize investigation when their population is explicit.", "A summary count is not a clinical conclusion or proof of cause.", "confirm", "top", true),
      step("filter-exceptions", "/?screen=operations", "operations-exception-filter", "Triage", "Filter the exception queue", "Separate stale, unowned, failed, or blocked work so the responsible team can act.", "Change the exception type filter.", "The queue displays the selected exception class.", "Classification turns a large warning count into an actionable population.", "Never clear an exception just to improve the dashboard.", "target-change", "bottom", true),
      step("open-exception", "/?screen=operations", "operations-exception-list", "Investigate", "Open row-level evidence", "The referral workspace contains the owner, blocker, evidence, and activity needed to resolve an exception.", "Open an available exception row. If the queue is clear, confirm that no row is available.", "The source referral opens, or the empty queue is explicitly acknowledged.", "Row-level evidence prevents conclusions from being invented from aggregate counts.", "Opening a record is read-only; resolve only within your assigned authority.", "target-click", "top", true),
      step("select-report-period", "/?screen=operations", "operations-report-month", "Reproduce", "Choose the assessment report month", "The period selector defines the signed-assessment population and completion-time calculation.", "Change the report month.", "The report refreshes for the selected month.", "A selected period makes the report reproducible.", "Verify freshness and scope before interpreting staff comparisons.", "target-change", "bottom", true),
      step("export-checkpoint", "/?screen=operations", "operations-report-export", "Share", "Stop at the export boundary", "CSV creates a portable copy of the currently scoped report.", "Verify month, row count, audience, and minimum-necessary fields. Complete the guide; export yourself only through the approved workflow.", "The export is deliberately downloaded by you or withheld for correction.", "A human export checkpoint protects scope and PHI handling.", "The guide never clicks CSV or transmits report data.", "confirm", "left", true),
    ],
  ),
];

export const operatorGuideVerifiedActionTargets: Readonly<Record<Exclude<OperatorGuideAdvance, "confirm">, readonly string[]>> = {
  "target-click": ["practice-function-section", "practice-clinical-section", "pipeline-home", "primary-workspaces", "primary-calendar", "primary-new-referral", "workspace-views", "calendar-view", "workspace-results", "assessment-stage", "assessment-schedule-open", "operations-exception-list"],
  "target-input": ["practice-assistance-details", "practice-current-symptoms", "workspace-search", "intake-identity", "intake-medications"],
  "target-change": ["practice-assistance-level", "calendar-filters", "initial-packet-upload", "intake-routing", "assessment-schedule-fields", "operations-exception-filter", "operations-report-month"],
};

export const operatorGuidedTutorialIds = operatorGuidedTutorials.map((tutorial) => tutorial.id);
export const operatorGuideTargetIds = [...new Set(operatorGuidedTutorials.flatMap((tutorial) => tutorial.steps.map((step) => step.target)))];

export const operatorGuideTargetSources: Readonly<Record<string, string>> = {
  "practice-function-section": "components/pipeline/note-lab/AssessmentPracticeWorkspace.tsx",
  "practice-clinical-section": "components/pipeline/note-lab/AssessmentPracticeWorkspace.tsx",
  "practice-assistance-level": "components/pipeline/note-lab/AssessmentPracticeWorkspace.tsx",
  "practice-assistance-details": "components/pipeline/note-lab/AssessmentPracticeWorkspace.tsx",
  "practice-current-symptoms": "components/pipeline/note-lab/AssessmentPracticeWorkspace.tsx",
  "pipeline-home": "components/pipeline/PipelineHeader.tsx",
  "primary-workspaces": "components/pipeline/PipelineActionNav.tsx",
  "primary-calendar": "components/pipeline/PipelineActionNav.tsx",
  "primary-new-referral": "components/pipeline/PipelineActionNav.tsx",
  "my-queue": "components/pipeline/PipelineWelcome.tsx",
  "workspace-search": "components/pipeline/ReferralHome.tsx",
  "workspace-views": "components/pipeline/ReferralHome.tsx",
  "workspace-results": "components/pipeline/ReferralWorklist.tsx",
  "calendar-view": "components/pipeline/PipelineCalendar.tsx",
  "calendar-filters": "components/pipeline/PipelineCalendar.tsx",
  "workspace-stage-nav": "components/pipeline/ReferralPacketCanvas.tsx",
  "initial-packet-upload": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-identity": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-routing": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-medications": "components/pipeline/ReferralPacketCanvas.tsx",
  "create-workspace": "components/pipeline/ReferralPacketCanvas.tsx",
  "assessment-stage": "components/pipeline/ReferralPacketCanvas.tsx",
  "assessment-schedule-open": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-schedule-fields": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-schedule-save": "components/pipeline/AssessmentWorkspace.tsx",
  "operations-summary": "components/pipeline/OperationsDashboard.tsx",
  "operations-exception-filter": "components/pipeline/OperationsDashboard.tsx",
  "operations-exception-list": "components/pipeline/OperationsDashboard.tsx",
  "operations-report-month": "components/pipeline/OperationsDashboard.tsx",
  "operations-report-export": "components/pipeline/OperationsDashboard.tsx",
};

export function getOperatorGuidedTutorial(id: string | null | undefined) {
  return operatorGuidedTutorials.find((tutorial) => tutorial.id === id);
}

export function guidedTutorialsForRole(role: OperatorRole) {
  return operatorGuidedTutorials.filter((tutorial) => tutorial.audiences.includes(role));
}

function tutorial(id: string, title: string, summary: string, workflow: string, outcome: string, minutes: number, audiences: readonly OperatorRole[], moduleIds: readonly string[], steps: readonly OperatorGuideStep[]): OperatorGuidedTutorial {
  return { id, title, summary, workflow, outcome, minutes, audiences, moduleIds, steps };
}

function step(id: string, route: string, target: string, phase: string, title: string, message: string, instruction: string, completion: string, why: string, safety: string, advance: OperatorGuideAdvance, placement: OperatorGuidePlacement = "auto", optionalTarget = false): OperatorGuideStep {
  return { id, route, target, phase, title, message, instruction, completion, why, safety, advance, placement, optionalTarget };
}
