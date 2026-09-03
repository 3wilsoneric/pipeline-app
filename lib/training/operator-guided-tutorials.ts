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
    "full-pipeline",
    "Learn the complete Pipeline workflow",
    "Follow a referral from your assigned queue through intake, assessment coordination, client records, and operational reporting.",
    "Complete workflow",
    "Know where each part of Pipeline lives and how one referral stays connected from intake through follow-up.",
    15,
    allRoles,
    ["pipeline-purpose", "navigation-model", "create-referral", "medication-intake", "calendar-coordination", "dashboard-meaning", "filter-report-export"],
    [
      step("full-check-queue", "/", "my-queue", "Home", "Start with your assigned work", "Home shows the referrals and schedule items that need your attention instead of the entire organization backlog.", "Review the highlighted queue and identify which item you would open first.", "You know what needs attention now and what can wait.", "Starting from assigned work keeps ownership and urgency clear.", "Open a referral before changing it; a summary count is not enough evidence.", "confirm", "right"),
      step("full-open-workspaces", "/", "primary-workspaces", "Workspaces", "Open the referral workspace directory", "Workspaces is the shared record of active and historical referral episodes across communities and months.", "Select the highlighted Workspaces control.", "The referral workspace directory is open.", "The directory keeps intake, assessment, files, and activity attached to one episode.", "Opening the directory is read-only and does not change referral state.", "target-click", "bottom"),
      step("full-current-work", "/?view=referrals", "workspace-views", "Workspaces", "Show current referral work", "Current work removes historical records so the active intake and assessment queue is easier to review.", "Select Current work in the highlighted view controls.", "Only current referral work is shown.", "An explicit active scope prevents old records from crowding today\'s work.", "Changing a view never changes ownership, status, or clinical information.", "target-click", "right"),
      step("full-search", "/?view=referrals", "workspace-search", "Workspaces", "Find a referral before creating one", "Search by approved client, community, county, source, or owner information before opening a new referral draft.", "Enter a synthetic search term in the highlighted search field.", "The visible workspace list narrows after you type.", "Searching first is the simplest protection against duplicate referral episodes.", "The guide detects typing but never reads or stores the search value.", "target-input", "bottom"),
      step("full-new-referral", "/?view=referrals", "primary-new-referral", "Intake", "Open a new referral draft", "New referral opens the governed intake workspace where source documents and referral facts are collected together.", "Select New referral to open an unsaved draft.", "The intake workspace is open and remains unsaved.", "A single intake entry point preserves source history and accountable ownership.", "Use synthetic information during training and search for duplicates before real entry.", "target-click", "bottom", true),
      step("full-source-packet", "/?view=referrals&screen=packet", "initial-packet-upload", "Intake", "Attach the source packet first", "The packet provides the evidence for extracted suggestions and any information entered manually during intake.", "Expand the document area and choose a synthetic packet or acknowledge the step if upload is unavailable.", "A selected filename appears in the document area or the stop condition is clear.", "Source-first intake makes every later correction and verification explainable.", "Never place PHI in a training record or attach a production packet while practicing.", "target-change", "left", true),
      step("full-identity", "/?view=referrals&screen=packet", "intake-identity", "Intake", "Verify the referral identity", "Identity fields establish who the episode belongs to and must agree with the source packet before creation.", "Enter or correct one synthetic identity field, then leave the field.", "The draft shows the source-backed identity value.", "Accurate identity protects assessment history, reporting, and eventual EHR matching.", "A proposed extraction is not verified until a person compares it with the source.", "target-input", "top", true),
      step("full-routing", "/?view=referrals&screen=packet", "intake-routing", "Intake", "Set community and ownership", "Routing fields connect the referral to the correct community, received period, source, and responsible assessor.", "Change one synthetic routing or assignment field.", "The draft has a clear operational destination or owner.", "Explicit routing prevents referrals from disappearing between people or communities.", "Do not make an unexplained reassignment or use another person\'s identity.", "target-change", "top", true),
      step("full-medications", "/?view=referrals&screen=packet", "intake-medications", "Intake", "Carry supplied medication context", "Medication information received at intake follows the referral into assessment for verification rather than being retyped later.", "Enter or correct synthetic supplied medication context, then leave the field.", "Medication context is visible for later assessor review.", "Careful carry-forward reduces retyping while preserving where the information came from.", "Intake medication text is not a reconciled, prescribed, or clinically verified list.", "target-input", "top", true),
      step("full-workspace-map", "/?view=referrals&screen=packet", "workspace-stage-nav", "Workflow", "Review the connected referral stages", "The stage navigation keeps intake, assessment, source files, and activity within the same referral workspace.", "Review the highlighted stages and note where assessment work will continue after intake.", "You can describe how the referral moves without creating a second record.", "One connected workspace prevents packet evidence and assessment findings from drifting apart.", "Do not skip unresolved intake requirements to make a referral appear ready.", "confirm", "bottom"),
      step("full-create-boundary", "/?view=referrals&screen=packet", "create-workspace", "Workflow", "Recognize the creation checkpoint", "Creating the workspace stores the referral and can begin asynchronous packet processing and team visibility.", "Review the highlighted control, but do not create a record for this walkthrough.", "You know what must be verified before choosing Create workspace.", "A visible commit boundary keeps incomplete or duplicate drafts out of operational queues.", "The walkthrough never clicks Create, Save, Sign, Decide, Export, Schedule, or Handoff.", "confirm", "left", true),
      step("full-calendar", "/?view=referrals&screen=packet", "primary-calendar", "Calendar", "Open assessment scheduling", "Calendar connects referral assignment and scheduled assessment activity to each assessor\'s actionable workload.", "Select the highlighted Calendar control.", "The assessment calendar is open.", "Linked events preserve referral ownership and make schedule conflicts visible.", "Opening Calendar does not create, move, or reassign an assessment.", "target-click", "bottom"),
      step("full-calendar-view", "/?screen=calendar", "calendar-view", "Calendar", "Choose the useful time horizon", "Month shows capacity, week supports coordination, and agenda emphasizes the next chronological actions.", "Select Month, Week, or Agenda in the highlighted controls.", "The calendar changes to the selected view.", "The right time horizon makes workload and timing problems easier to see.", "Changing the calendar view is read-only and affects only presentation.", "target-click", "bottom"),
      step("full-calendar-filter", "/?screen=calendar", "calendar-filters", "Calendar", "Scope the assessment schedule", "Community, assessor, and event filters separate your immediate responsibilities from unrelated calendar activity.", "Change one highlighted calendar filter.", "The schedule reflects the selected scope.", "A scoped calendar gives assessors and supervisors an actionable view instead of noise.", "A filter does not change the assigned assessor or the underlying event.", "target-change", "bottom"),
      step("full-clients", "/?screen=calendar", "primary-clients", "Client records", "Open accepted client profiles", "Client Profiles contains the downstream record view for accepted referrals and available historical information.", "Select the highlighted Client Profiles control.", "The client profile directory is open.", "Keeping downstream client records distinct from active referrals preserves workflow meaning.", "Opening Client Profiles is read-only and does not accept a referral.", "target-click", "bottom"),
      step("full-client-directory", "/?screen=clients", "client-directory", "Client records", "Understand the client directory", "The directory provides a governed place to locate accepted client records without mixing them into active referral work.", "Review the highlighted directory and identify the search and record-opening controls.", "You know where to find a client after referral acceptance.", "Separating client records from referral episodes makes status and reporting more reliable.", "Only open client records required for your role and current work.", "confirm", "top"),
      step("full-reports", "/?screen=clients", "primary-reports", "Reports", "Open operational reports", "Reports turns referral and assessment records into scoped operational lists that can be reviewed and exported.", "Select the highlighted Reports control.", "The report runner is open.", "A governed report surface keeps questions, filters, and source rows reproducible.", "Opening Reports is read-only and does not create an export.", "target-click", "bottom"),
      step("full-report-select", "/?screen=operations", "operations-report-select", "Reports", "Choose a report and review its scope", "Each report exposes only the filters and source rows needed for its operational question.", "Select one report from the highlighted list.", "The matching report controls and preview are visible.", "Choosing the report before filtering prevents unrelated data from entering the result.", "Reports support operations and do not replace clinical judgment or source review.", "target-change", "bottom"),
      step("full-return-home", "/?screen=operations", "pipeline-home", "Finish", "Return to Home", "Return to your assigned work after locating the major areas of the application and their role in the referral lifecycle.", "Select the Pipeline home control to finish the walkthrough.", "Home is open and the walkthrough is complete.", "A stable return path helps users recover from interruptions without losing workflow context.", "Returning home does not discard information that was already saved.", "target-click", "bottom"),
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
    "Run and verify a report",
    "Choose a report, set only the relevant filters, inspect the source rows, and stop at the export boundary.",
    "Reporting",
    "Produce a reproducible referral or assessment report without losing its scope.",
    6,
    leadRoles,
    ["dashboard-meaning", "supervisor-exceptions", "filter-report-export", "processing-failure"],
    [
      step("open-reports", "/", "primary-reports", "Open", "Open Reports", "Reports contains the governed operational lists and exports.", "Select the highlighted Reports control.", "The report runner is open.", "One report surface keeps operational questions reproducible.", "Opening Reports is read-only and does not create an export.", "target-click", "bottom"),
      step("choose-report", "/?screen=operations", "operations-report-select", "Choose", "Select the report", "Choose the report that directly answers the operational question.", "Select a report from the highlighted list.", "The relevant filters and preview load for that report.", "Starting with the question prevents unrelated data from entering the export.", "Supervisor exceptions are available only to authorized roles.", "target-change", "bottom"),
      step("select-report-period", "/?screen=operations", "operations-report-month", "Scope", "Set the reporting month", "Reports that depend on time expose a month filter; other reports intentionally do not.", "If the selected report uses a month, change it now. Otherwise continue.", "The preview reflects the selected period after Run report.", "An explicit period makes the output reproducible.", "Confirm the displayed scope before interpreting staff comparisons.", "target-change", "bottom", true),
      step("review-results", "/?screen=operations", "operations-report-results", "Verify", "Inspect the source rows", "The preview shows the records included by the report and current filters.", "Check the report title, row count, and at least one source row before exporting.", "You can explain what each row represents and which filters produced it.", "Row-level review catches scope mistakes before data leaves Pipeline.", "A report is operational evidence, not a clinical conclusion.", "confirm", "top"),
      step("export-checkpoint", "/?screen=operations", "operations-report-export", "Share", "Stop at the export boundary", "CSV creates a portable copy of the currently scoped report.", "Verify month, row count, audience, and minimum-necessary fields. Complete the guide; export yourself only through the approved workflow.", "The export is deliberately downloaded by you or withheld for correction.", "A human export checkpoint protects scope and PHI handling.", "The guide never clicks CSV or transmits report data.", "confirm", "left", true),
    ],
  ),
];

export const operatorGuideVerifiedActionTargets: Readonly<Record<Exclude<OperatorGuideAdvance, "confirm">, readonly string[]>> = {
  "target-click": ["pipeline-home", "primary-workspaces", "primary-calendar", "primary-clients", "primary-new-referral", "primary-reports", "workspace-views", "calendar-view", "workspace-results", "assessment-stage", "assessment-schedule-open"],
  "target-input": ["workspace-search", "intake-identity", "intake-medications"],
  "target-change": ["calendar-filters", "initial-packet-upload", "intake-routing", "assessment-schedule-fields", "operations-report-select", "operations-report-month"],
};

export const operatorGuidedTutorialIds = operatorGuidedTutorials.map((tutorial) => tutorial.id);
export const operatorGuideTargetIds = [...new Set(operatorGuidedTutorials.flatMap((tutorial) => tutorial.steps.map((step) => step.target)))];

export const operatorGuideTargetSources: Readonly<Record<string, string>> = {
  "pipeline-home": "components/pipeline/PipelineHeader.tsx",
  "primary-workspaces": "components/pipeline/PipelineActionNav.tsx",
  "primary-calendar": "components/pipeline/PipelineActionNav.tsx",
  "primary-clients": "components/pipeline/PipelineActionNav.tsx",
  "primary-new-referral": "components/pipeline/PipelineActionNav.tsx",
  "primary-reports": "components/pipeline/PipelineActionNav.tsx",
  "my-queue": "components/pipeline/PipelineWelcome.tsx",
  "workspace-search": "components/pipeline/ReferralHome.tsx",
  "workspace-views": "components/pipeline/ReferralHome.tsx",
  "workspace-results": "components/pipeline/ReferralWorklist.tsx",
  "calendar-view": "components/pipeline/PipelineCalendar.tsx",
  "calendar-filters": "components/pipeline/PipelineCalendar.tsx",
  "client-directory": "components/pipeline/ClientProfileDirectory.tsx",
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
  "operations-report-select": "components/pipeline/OperationsDashboard.tsx",
  "operations-report-month": "components/pipeline/OperationsDashboard.tsx",
  "operations-report-results": "components/pipeline/OperationsDashboard.tsx",
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
