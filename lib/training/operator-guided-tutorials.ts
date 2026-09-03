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
  summary: string;
  outcome: string;
  minutes: number;
  persona: OperatorTutorialPersona;
  clickpath: readonly string[];
  audiences: readonly OperatorRole[];
  moduleIds: readonly string[];
  steps: readonly OperatorGuideStep[];
};

const allRoles: readonly OperatorRole[] = ["admin", "assessment_coordinator", "reviewer", "viewer"];
const writeRoles: readonly OperatorRole[] = ["admin", "assessment_coordinator", "reviewer"];
const assessorRoles: readonly OperatorRole[] = ["admin", "reviewer"];
const supervisorRoles: readonly OperatorRole[] = ["admin", "assessment_coordinator"];

export const operatorGuidedTutorials: readonly OperatorGuidedTutorial[] = [
  tutorial({
    id: "review-chart",
    title: "Review the assessment Chart",
    workflow: "Supervisor",
    summary: "Review the signed assessment record and check Meet the Client handoff readiness.",
    outcome: "Verify that both Chart views come from the completed assessment and are ready for authorized use.",
    minutes: 6,
    persona: "supervisor",
    clickpath: ["Workspaces", "Referral", "Chart", "Complete chart", "Meet the Client"],
    audiences: supervisorRoles,
    moduleIds: ["assessment-complete-sign", "final-decision", "ehr-handoff"],
    steps: [
      step("chart-find", "/?view=referrals", "workspace-search", "Find", "Find the reviewed referral", "Chart review begins from the existing referral so its signed assessment, decision state, and source files remain connected.", "Enter a synthetic client or referral search term.", "The matching workspace results are visible.", "A deliberate lookup reduces wrong-record review risk.", "Verify the referral episode and authorized purpose before opening it.", "target-input", "bottom"),
      step("chart-open-referral", "/?view=referrals", "workspace-results", "Find", "Open the referral", "The workspace connects the assessment source, generated Chart views, files, and activity in one governed episode.", "Select the correct synthetic workspace.", "The referral workspace is open.", "The source workspace makes Chart provenance reviewable.", "Only open records required for authorized review.", "target-click", "top"),
      step("chart-stage", "/?view=referrals&screen=packet", "chart-stage", "Chart", "Open Chart", "Chart presents assessment-derived records after the assessment has reached the required completed and signed state.", "Select Chart in the highlighted stage navigation.", "The Chart stage is visible.", "Chart views are downstream representations of the assessment, not separate clinical documentation.", "If Chart is unavailable, resolve assessment completion or permission rather than recreating it.", "target-click", "bottom", true),
      step("chart-complete", "/?view=referrals&screen=packet", "chart-complete-record", "Review", "Review the complete chart", "The complete chart organizes the signed assessment into a medical-record-style review surface with assessment provenance.", "Review the highlighted chart and compare important conclusions with the signed assessment.", "You can identify the assessment version and signed source behind the Chart.", "Provenance prevents a generated view from being mistaken for a separate source record.", "Do not treat a Chart summary as permission to alter the signed assessment.", "confirm", "top", true),
      step("chart-meet-client", "/?view=referrals&screen=packet", "chart-meet-client-tab", "Handoff", "Open Meet the Client", "Meet the Client provides a concise face sheet from the same assessment for an authorized accepted-referral handoff.", "Select Meet the Client in the highlighted Chart tabs.", "The Meet the Client face sheet is visible.", "A concise handoff supports receiving staff without replacing the complete Chart.", "Availability depends on assessment and decision state; do not bypass those controls.", "target-click", "bottom", true),
      step("chart-email", "/?view=referrals&screen=packet", "chart-email-handoff", "Handoff", "Stop at email handoff", "The email area includes the approved face sheet and admission packet only after the referral is eligible.", "Verify recipient authorization, packet readiness, and minimum-necessary content. Finish the guide without sending training data.", "The handoff is deliberately sent by an authorized person or withheld for correction.", "A human send checkpoint protects PHI, recipient scope, and packet completeness.", "The guide never sends email or confirms recipient authorization for you.", "confirm", "left", true),
    ],
  }),
  tutorial({
    id: "assessor-shift",
    title: "Start an assessor shift",
    workflow: "Assessor",
    summary: "Find assigned work, check today’s schedule, and open the referral that needs action.",
    outcome: "Leave Home with the correct assigned referral open and a clear next action.",
    minutes: 5,
    persona: "assessor",
    clickpath: ["Home", "Current work", "Workspaces", "Assessment"],
    audiences: assessorRoles,
    moduleIds: ["pipeline-purpose", "navigation-model", "assessment-start"],
    steps: [
      step("assessor-review-queue", "/", "my-queue", "Home", "Review your assigned work", "Home is scoped to your assigned referrals and scheduled assessment work instead of the organization’s entire queue.", "Identify the first assigned item that needs action today.", "You can name the referral and the action it needs.", "Starting with ownership and timing prevents work from being selected from memory.", "Open the underlying referral before changing anything; a summary is not the clinical record.", "confirm", "right"),
      step("assessor-open-workspaces", "/", "primary-workspaces", "Workspaces", "Open Workspaces", "Workspaces contains active referral episodes and their connected intake, assessment, chart, files, and activity.", "Select Workspaces in the highlighted navigation.", "The workspace directory is open.", "The shared directory keeps each assessment attached to its referral episode.", "Opening Workspaces is read-only and does not change ownership or status.", "target-click", "bottom"),
      step("assessor-current-work", "/?view=referrals", "workspace-views", "Workspaces", "Show current work", "Current work removes historical records so assigned intake and assessment work is easier to locate.", "Select Current work in the highlighted view control.", "Only active referral work is shown.", "An explicit active scope keeps historical volume out of today’s workflow.", "Changing the view never changes referral status or assignment.", "target-click", "right"),
      step("assessor-find-referral", "/?view=referrals", "workspace-search", "Workspaces", "Find the assigned referral", "Search narrows the governed referral list by client, community, county, source, or owner.", "Enter a synthetic search term in the highlighted field.", "The visible results narrow after you type.", "Searching the shared list prevents duplicate work and wrong-record navigation.", "The guide detects typing but never reads or stores the search value.", "target-input", "bottom"),
      step("assessor-open-referral", "/?view=referrals", "workspace-results", "Workspaces", "Open the correct workspace", "The result opens the referral episode where packet evidence, assessment work, chart, files, and activity remain connected.", "Select the intended synthetic referral from the highlighted results.", "The referral workspace opens.", "Opening the source record preserves context before clinical work begins.", "Verify identity and assignment before documenting assessment information.", "target-click", "top"),
      step("assessor-open-stage", "/?view=referrals&screen=packet", "assessment-stage", "Assessment", "Open Assessment", "Assessment is the assessor’s working area for scheduling, interview documentation, completion, and signature.", "Select Assessment in the workspace stage navigation.", "The assessment area is visible.", "The assessment stays attached to the referral and its verified intake information.", "Do not begin when identity, assignment, or readiness remains unresolved.", "target-click", "bottom"),
    ],
  }),
  tutorial({
    id: "complete-assessment",
    title: "Complete an assessment",
    workflow: "Assessor",
    summary: "Open the assigned assessment, complete each section, review progress, and stop at signature.",
    outcome: "Complete a defensible assessment and understand the final signing boundary.",
    minutes: 10,
    persona: "assessor",
    clickpath: ["Workspaces", "Referral", "Assessment", "Begin", "Sections", "Sign"],
    audiences: assessorRoles,
    moduleIds: ["assessment-start", "assessment-demographics", "assessment-questionnaire", "assessment-complete-sign"],
    steps: [
      step("assessment-find", "/?view=referrals", "workspace-search", "Find", "Find the assigned referral", "Begin from the existing assigned referral so the assessment remains connected to the correct source packet and history.", "Enter a synthetic client or referral search term.", "The matching workspace results are visible.", "A deliberate lookup reduces wrong-record and duplicate-assessment risk.", "A matching name is not enough; verify the referral episode before opening it.", "target-input", "bottom"),
      step("assessment-open-referral", "/?view=referrals", "workspace-results", "Find", "Open the referral", "The workspace is the governed entry point for assessment work and preserves ownership, source files, and activity.", "Select the correct synthetic workspace.", "The referral workspace is open.", "Starting from the workspace preserves one continuous admissions record.", "Only open records assigned to you or required for authorized work.", "target-click", "top"),
      step("assessment-stage", "/?view=referrals&screen=packet", "assessment-stage", "Open", "Select Assessment", "The Assessment stage contains scheduling status, the interview form, section progress, autosave state, and signing control.", "Select Assessment in the highlighted stage navigation.", "The assessment area is visible.", "One assessment surface keeps intake data and assessor answers distinct but connected.", "Do not use the Chart as a substitute for completing the source assessment.", "target-click", "bottom"),
      step("assessment-open", "/?view=referrals&screen=packet", "assessment-open", "Open", "Open the assigned assessment", "Open assessment enters the selected assessment without creating a second assessment or detached note.", "Select Open assessment when the highlighted control is available.", "The focused assessment workspace is open.", "The selected assessment remains tied to the assigned referral and assessor.", "If the control is unavailable, resolve assignment or scheduling instead of bypassing it.", "target-click", "left", true),
      step("assessment-begin", "/?view=referrals&screen=packet", "assessment-begin", "Begin", "Review the begin checkpoint", "Beginning changes scheduled work into an active accountable interview under the signed-in assessor.", "Select Begin assessment to review the scheduled details.", "The Begin assessment confirmation is visible.", "A separate checkpoint prevents accidental starts and confirms the correct person and schedule.", "Do not confirm until identity, assignment, and readiness are verified.", "target-click", "left", true),
      step("assessment-begin-confirm", "/?view=referrals&screen=packet", "assessment-begin-confirm", "Begin", "Confirm only when ready", "The confirmation records the assessment start and enables clinical entry for the assigned assessor.", "Verify client, assessor, date, method, and readiness, then continue the guide without submitting a training record.", "You know what must be true before beginning.", "A human confirmation preserves accountability for the start of clinical documentation.", "The guide never confirms Begin, Sign, Schedule, Export, or Handoff for you.", "confirm", "left", true),
      step("assessment-section", "/?view=referrals&screen=packet", "assessment-section-nav", "Document", "Choose an assessment section", "Section navigation moves directly to the domain being documented while preserving one assessment draft.", "Select a section in the highlighted assessment navigation.", "The selected section appears in the form.", "Section navigation supports interruption and return without disconnected notes.", "Complete required questions from interview or attributed source evidence; do not guess.", "target-click", "right", true),
      step("assessment-answer", "/?view=referrals&screen=packet", "assessment-answer", "Document", "Enter a supported answer", "Structured and narrative answers should reflect the interview, direct observation, or an explicitly attributed source.", "Enter a short synthetic answer in the highlighted field.", "The field shows the entered answer and autosave can begin.", "Specific, attributed documentation supports review and downstream chart generation.", "The guide detects input but never reads or stores the answer value.", "target-input", "top", true),
      step("assessment-help", "/?view=referrals&screen=packet", "assessment-answer-help", "Document", "Use Answer Help when needed", "Answer Help appears on narrative questions where structure or neutral wording benefits from a field-specific example.", "Open the highlighted Answer Help panel.", "The note structure and example are visible.", "Targeted help improves consistency without adding boilerplate to every question.", "Use the example as structure only; never copy facts that were not assessed.", "target-click", "top", true),
      step("assessment-next", "/?view=referrals&screen=packet", "assessment-next-section", "Review", "Continue through each section", "Next section moves through the required assessment domains while the section count shows what remains.", "Select Next section after reviewing the current section.", "The next assessment section appears.", "An ordered review reduces missed required domains before signature.", "A section transition does not prove answers are complete or clinically supported.", "target-click", "top", true),
      step("assessment-save", "/?view=referrals&screen=packet", "assessment-save-status", "Review", "Confirm autosave status", "The save indicator distinguishes a saved draft from work that is pending or failed to persist.", "Confirm that the highlighted save status shows the expected saved state before leaving.", "The assessment draft has a visible saved state.", "Visible persistence status protects work during interruptions and handoffs.", "Do not leave or sign while save failure or unresolved conflicts are visible.", "confirm", "left", true),
      step("assessment-sign", "/?view=referrals&screen=packet", "assessment-sign", "Sign", "Stop at assessment signature", "Signing locks the completed assessment as an accountable clinical artifact and enables downstream review and Chart generation.", "Resolve required gaps and review the complete assessment. Finish this guide; sign authorized work yourself only when ready.", "The assessment is deliberately signed by you or left unsigned for correction.", "Signature is a clinical accountability boundary and must remain a deliberate human action.", "The guide never clicks Sign assessment or records a signature for you.", "confirm", "left", true),
    ],
  }),
  tutorial({
    id: "supervisor-shift",
    title: "Start a supervisor shift",
    workflow: "Supervisor",
    summary: "Review team exceptions, current referral work, and upcoming assessment coverage.",
    outcome: "Identify unowned, blocked, overdue, or unscheduled work and assign a next action.",
    minutes: 6,
    persona: "supervisor",
    clickpath: ["Home", "Workspaces", "Calendar", "Reports"],
    audiences: supervisorRoles,
    moduleIds: ["dashboard-meaning", "supervisor-exceptions", "calendar-coordination"],
    steps: [
      step("supervisor-home", "/", "my-queue", "Home", "Review the last 24 hours", "Home summarizes recent referral activity, assigned work, and upcoming assessment events without replacing underlying records.", "Review the highlighted work area and identify any blocked or overdue item.", "You can name the item that needs supervisor action.", "A short exception-first review focuses attention on work that can stall admissions.", "Open source records before changing assignments or reporting a conclusion.", "confirm", "right"),
      step("supervisor-workspaces", "/", "primary-workspaces", "Workspaces", "Open the referral inventory", "Workspaces provides the shared operational list across assessors, communities, months, and stages.", "Select Workspaces in the highlighted navigation.", "The workspace directory is open.", "The shared inventory is the correct place to verify ownership and stage.", "Opening the directory is read-only and does not reassign work.", "target-click", "bottom"),
      step("supervisor-scope", "/?view=referrals", "workspace-views", "Workspaces", "Show current work", "Current work removes historical records and keeps open intake and assessment episodes in view.", "Select Current work in the highlighted controls.", "The active referral inventory is visible.", "Active scope keeps supervisor review focused on work that can still move.", "Changing the view does not alter referral status.", "target-click", "right"),
      step("supervisor-open-calendar", "/?view=referrals", "primary-calendar", "Calendar", "Open team scheduling", "Calendar shows referral assignment events and scheduled assessments using distinct event types and role-aware scope.", "Select Calendar in the highlighted navigation.", "The assessment calendar is open.", "The calendar exposes coverage and timing issues while the referral remains authoritative.", "Opening Calendar does not create or move an event.", "target-click", "bottom"),
      step("supervisor-calendar-view", "/?screen=calendar", "calendar-view", "Calendar", "Choose the time horizon", "Month shows capacity, Week supports near-term coordination, and Agenda emphasizes chronological actions.", "Select the calendar view that best answers the staffing question.", "The calendar changes to the selected view.", "The right time horizon makes gaps and conflicts easier to see.", "Changing the view affects presentation only.", "target-click", "bottom"),
      step("supervisor-calendar-filter", "/?screen=calendar", "calendar-filters", "Calendar", "Scope by assessor or community", "Calendar filters isolate the assessor, community, and event type relevant to the supervisor’s question.", "Change one highlighted calendar filter.", "The visible schedule reflects the chosen scope.", "Scoped review produces an actionable workload view instead of a wall of events.", "A filter never changes the underlying assignment or schedule.", "target-change", "bottom"),
      step("supervisor-reports", "/?screen=calendar", "primary-reports", "Reports", "Open operational reports", "Reports provides reproducible lists for completed assessments, workload, documents, calendar, and workspaces.", "Select Reports in the highlighted navigation.", "The report runner is open.", "A report can verify the exception and preserve its exact scope.", "Opening Reports does not export or transmit information.", "target-click", "bottom"),
    ],
  }),
  tutorial({
    id: "create-referral",
    title: "Create and schedule a referral",
    workflow: "Intake",
    summary: "Attach the packet, verify intake facts, assign the referral, and prepare its assessment schedule.",
    outcome: "Prepare one source-backed referral and understand both creation and scheduling boundaries.",
    minutes: 10,
    persona: "shared",
    clickpath: ["New referral", "Packet", "Identity", "Assignment", "Create", "Assessment", "Schedule"],
    audiences: writeRoles,
    moduleIds: ["inbound-triage", "create-referral", "medication-intake", "upload-packet", "schedule-assessment"],
    steps: [
      step("referral-new", "/", "primary-new-referral", "Start", "Open New referral", "New referral opens one unsaved intake draft for the packet, referral facts, routing, and medication context.", "Select New referral in the highlighted navigation.", "An unsaved referral draft is open.", "One entry point preserves source history and ownership from the beginning.", "Search for an existing referral before creating a real record.", "target-click", "bottom"),
      step("referral-packet", "/?view=referrals&screen=packet", "initial-packet-upload", "Packet", "Attach the source packet", "The initial packet anchors proposed extraction and manually entered information to source evidence.", "Expand the document area and select an authorized synthetic packet.", "The selected filename appears in the document area.", "Source-first intake makes later verification and correction explainable.", "Verify the workspace and use only synthetic material while learning.", "target-change", "left", true),
      step("referral-identity", "/?view=referrals&screen=packet", "intake-identity", "Identity", "Verify identity", "Identity fields establish who the referral belongs to and must be compared with the packet before creation.", "Enter or correct one synthetic identity field, then leave the field.", "The draft shows the source-backed identity value.", "Accurate identity protects assessment history, reporting, and EHR matching.", "A proposed extraction is not verified until a person compares it with the source.", "target-input", "top"),
      step("referral-routing", "/?view=referrals&screen=packet", "intake-routing", "Assignment", "Set routing and ownership", "Community, received date, source, contact, and assignee determine where the referral belongs and who moves it forward.", "Change one synthetic routing or assignment field.", "The draft has an accountable destination and owner.", "Explicit ownership prevents referrals from disappearing between people or communities.", "Do not make an unexplained reassignment or use another person’s identity.", "target-change", "top"),
      step("referral-medications", "/?view=referrals&screen=packet", "intake-medications", "Medications", "Carry supplied medication context", "Medication information received at intake carries into assessment for verification rather than becoming a reconciled list.", "Enter or correct synthetic medication context, then leave the field.", "Medication context is visible for later assessor review.", "Carry-forward reduces re-entry while preserving where the information came from.", "Intake medication text is not clinically verified, reconciled, or prescribed.", "target-input", "top"),
      step("referral-create", "/?view=referrals&screen=packet", "create-workspace", "Create", "Stop at Create workspace", "Creating stores the referral, exposes it to authorized workflows, and can begin asynchronous packet processing.", "Perform the duplicate, identity, source, owner, and packet check. Finish this checkpoint without creating training data.", "The draft is deliberately created by you or left unsaved for correction.", "An explicit creation boundary keeps incomplete drafts out of operational queues.", "The guide never clicks Create workspace for you.", "confirm", "left", true),
      step("referral-assessment", "/?view=referrals&screen=packet", "assessment-stage", "Assessment", "Open Assessment", "The Assessment stage owns scheduling and the interview record for the same referral episode.", "Select Assessment in the highlighted stage navigation when the workspace exists.", "The assessment area is visible.", "The linked stage prevents detached assessment and calendar records.", "If no saved workspace exists, acknowledge the stop rather than creating test data.", "target-click", "bottom", true),
      step("referral-schedule-open", "/?view=referrals&screen=packet", "assessment-schedule-open", "Schedule", "Open assessment scheduling", "Schedule or Reschedule opens the referral-linked date, duration, method, and location fields.", "Select the highlighted Schedule or Reschedule control when available.", "The schedule dialog is open.", "A linked schedule appears in the correct assessor and supervisor calendar scopes.", "If unavailable, resolve ownership or readiness instead of creating a side-channel event.", "target-click", "left", true),
      step("referral-schedule-fields", "/?view=referrals&screen=packet", "assessment-schedule-fields", "Schedule", "Set the appointment details", "The schedule needs a usable date, duration, meeting method, and location or approved Zoom information when remote.", "Change one synthetic scheduling field and review the remaining fields.", "The draft schedule reflects the intended appointment.", "Complete details make the event actionable for the assessor.", "The guide detects a change but never reads dates, links, or meeting information.", "target-change", "left", true),
      step("referral-schedule-save", "/?view=referrals&screen=packet", "assessment-schedule-save", "Schedule", "Stop at schedule submission", "Submitting creates or updates accountable calendar work for the assigned assessor and supervisor scope.", "Verify referral, assessor, date, duration, method, and location. Finish the guide; submit authorized work yourself.", "The schedule is deliberately submitted by you or left unchanged for correction.", "A human submission preserves accountability for timing and meeting details.", "The guide never clicks Schedule assessment or Save new time.", "confirm", "left", true),
    ],
  }),
  tutorial({
    id: "run-report",
    title: "Run and export a report",
    workflow: "Reports",
    summary: "Choose the operational question, set its scope, inspect the rows, and stop at CSV export.",
    outcome: "Produce a reproducible report without losing period, scope, or row-level context.",
    minutes: 5,
    persona: "shared",
    clickpath: ["Reports", "Choose report", "Set period", "Review rows", "CSV"],
    audiences: allRoles,
    moduleIds: ["dashboard-meaning", "filter-report-export"],
    steps: [
      step("report-open", "/", "primary-reports", "Reports", "Open Reports", "Reports contains governed operational lists and exports for referral, assessment, document, and workload questions.", "Select Reports in the highlighted navigation.", "The report runner is open.", "One report surface keeps operational questions reproducible.", "Opening Reports is read-only and does not create an export.", "target-click", "bottom"),
      step("report-choose", "/?screen=operations", "operations-report-select", "Reports", "Choose the report", "Choose the report that directly matches the operational question before changing available filters.", "Select a report from the highlighted report list.", "The selected report controls and preview are visible.", "Starting with the question prevents unrelated data from entering the result.", "Report availability follows role permissions and does not grant broader access.", "target-click", "bottom"),
      step("report-period", "/?screen=operations", "operations-report-month", "Scope", "Set the reporting period", "Time-based reports expose a month filter so the result can be reproduced and compared consistently.", "If the report uses a month, change the highlighted period; otherwise acknowledge the step.", "The preview reflects the selected reporting period.", "An explicit period prevents ambiguous totals and exports.", "Confirm all displayed scope before interpreting staff or community results.", "target-change", "bottom", true),
      step("report-results", "/?screen=operations", "operations-report-results", "Verify", "Inspect the source rows", "The preview shows the records included by the selected report and its current filters.", "Check the report title, row count, scope, and at least one source row.", "You can explain what each row represents and which scope produced it.", "Row-level review catches filter mistakes before information leaves Pipeline.", "A report is operational evidence and not a clinical conclusion.", "confirm", "top"),
      step("report-export", "/?screen=operations", "operations-report-export", "Export", "Stop at CSV export", "CSV creates a portable copy of the currently scoped result for an approved operational purpose.", "Verify period, row count, audience, and minimum-necessary fields. Finish the guide; export authorized data yourself.", "The export is deliberately downloaded by you or withheld for correction.", "A human export checkpoint protects scope and PHI handling.", "The guide never clicks CSV or transmits report data.", "confirm", "left", true),
    ],
  }),
  tutorial({
    id: "find-workspace",
    title: "Find and reopen a referral",
    workflow: "Workspaces",
    summary: "Choose current or total scope, search the shared inventory, and open the existing referral episode.",
    outcome: "Return to the correct referral without creating a duplicate or losing its stage context.",
    minutes: 4,
    persona: "shared",
    clickpath: ["Workspaces", "Current or Total", "Search", "Open referral"],
    audiences: allRoles,
    moduleIds: ["pipeline-purpose", "navigation-model"],
    steps: [
      step("find-open-workspaces", "/", "primary-workspaces", "Workspaces", "Open Workspaces", "Workspaces is the shared inventory of current and historical referral episodes across communities and months.", "Select Workspaces in the highlighted navigation.", "The workspace directory is open.", "The shared directory is the reliable return path after interruption.", "Opening Workspaces is read-only.", "target-click", "bottom"),
      step("find-select-scope", "/?view=referrals", "workspace-views", "Scope", "Choose Current or Total", "Current shows active work while Total includes historical referral episodes for lookup and review.", "Select the highlighted workspace view that matches your question.", "The chosen referral scope is visible.", "Explicit scope prevents old and active episodes from being confused.", "Changing the view does not change a referral’s status.", "target-click", "right"),
      step("find-search", "/?view=referrals", "workspace-search", "Search", "Search the shared inventory", "Search by approved client, community, county, source, or owner information rather than scanning from memory.", "Enter a synthetic search term in the highlighted field.", "The visible result list narrows.", "Search is the first protection against duplicate work.", "Treat matching names as candidates until identity and episode are verified.", "target-input", "bottom"),
      step("find-open-result", "/?view=referrals", "workspace-results", "Open", "Open the existing referral", "The result opens the connected referral episode at its available workflow stage with files and activity intact.", "Select the intended synthetic referral from the highlighted results.", "The existing referral workspace opens.", "Reopening the existing record preserves one source of truth.", "Only open a record required for authorized work and verify identity before editing.", "target-click", "top"),
    ],
  }),
];

export const operatorGuideVerifiedActionTargets: Readonly<Record<Exclude<OperatorGuideAdvance, "confirm">, readonly string[]>> = {
  "target-click": ["primary-workspaces", "primary-calendar", "primary-new-referral", "primary-reports", "workspace-views", "calendar-view", "workspace-results", "assessment-stage", "assessment-open", "assessment-begin", "assessment-section-nav", "assessment-answer-help", "assessment-next-section", "assessment-schedule-open", "chart-stage", "chart-meet-client-tab", "operations-report-select"],
  "target-input": ["workspace-search", "intake-identity", "intake-medications", "assessment-answer"],
  "target-change": ["calendar-filters", "initial-packet-upload", "intake-routing", "assessment-schedule-fields", "operations-report-month"],
};

export const operatorGuidedTutorialIds = operatorGuidedTutorials.map((tutorial) => tutorial.id);
export const operatorGuideTargetIds = [...new Set(operatorGuidedTutorials.flatMap((tutorial) => tutorial.steps.map((step) => step.target)))];

export const operatorGuideTargetSources: Readonly<Record<string, string>> = {
  "primary-workspaces": "components/pipeline/PipelineActionNav.tsx",
  "primary-calendar": "components/pipeline/PipelineActionNav.tsx",
  "primary-new-referral": "components/pipeline/PipelineActionNav.tsx",
  "primary-reports": "components/pipeline/PipelineActionNav.tsx",
  "my-queue": "components/pipeline/PipelineWelcome.tsx",
  "workspace-search": "components/pipeline/ReferralHome.tsx",
  "workspace-views": "components/pipeline/ReferralHome.tsx",
  "workspace-results": "components/pipeline/ReferralWorklist.tsx",
  "calendar-view": "components/pipeline/PipelineCalendar.tsx",
  "calendar-filters": "components/pipeline/PipelineCalendar.tsx",
  "initial-packet-upload": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-identity": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-routing": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-medications": "components/pipeline/ReferralPacketCanvas.tsx",
  "create-workspace": "components/pipeline/ReferralPacketCanvas.tsx",
  "assessment-stage": "components/pipeline/ReferralPacketCanvas.tsx",
  "assessment-open": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-begin": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-begin-confirm": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-nav": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-answer": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-answer-help": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-next-section": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-save-status": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-sign": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-schedule-open": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-schedule-fields": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-schedule-save": "components/pipeline/AssessmentWorkspace.tsx",
  "chart-stage": "components/pipeline/ReferralPacketCanvas.tsx",
  "chart-complete-record": "components/pipeline/AssessmentChartWorkspace.tsx",
  "chart-meet-client-tab": "components/pipeline/AssessmentChartWorkspace.tsx",
  "chart-email-handoff": "components/pipeline/AssessmentChartWorkspace.tsx",
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

export function guidedTutorialsForRoles(roles: readonly string[]) {
  const assigned = new Set(roles);
  return operatorGuidedTutorials.filter((tutorial) => tutorial.audiences.some((role) => assigned.has(role)));
}

function tutorial(definition: OperatorGuidedTutorial): OperatorGuidedTutorial {
  return definition;
}

function step(id: string, route: string, target: string, phase: string, title: string, message: string, instruction: string, completion: string, why: string, safety: string, advance: OperatorGuideAdvance, placement: OperatorGuidePlacement = "auto", optionalTarget = false): OperatorGuideStep {
  return { id, route, target, phase, title, message, instruction, completion, why, safety, advance, placement, optionalTarget };
}
