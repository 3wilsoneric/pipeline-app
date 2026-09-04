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

export type OperatorGuideChapter = {
  id: string;
  title: string;
  startStepIndex: number;
  steps: readonly OperatorGuideStep[];
};

const simpleStepTitles: Readonly<Record<string, string>> = {
  "chart-find": "Find the referral",
  "chart-complete": "Check the chart",
  "chart-email": "Check the email",
  "assessor-review-queue": "Check your queue",
  "assessor-find-referral": "Search for the referral",
  "assessor-open-referral": "Open the workspace",
  "assessment-find": "Find the referral",
  "assessment-stage": "Open Assessment",
  "assessment-open": "Open the assessment",
  "assessment-schedule-open": "Open scheduling",
  "assessment-schedule-fields": "Set the appointment",
  "assessment-schedule-save": "Save the schedule",
  "assessment-begin": "Select Begin assessment",
  "assessment-begin-confirm": "Check the details",
  "assessment-section": "Choose a section",
  "assessment-answer": "Enter an answer",
  "assessment-help": "Open Answer Help",
  "assessment-next": "Open the next section",
  "assessment-save": "Check saved",
  "assessment-sign": "Review before signing",
  "supervisor-home": "Check the team queue",
  "supervisor-workspaces": "Open Workspaces",
  "supervisor-open-calendar": "Open Calendar",
  "supervisor-calendar-view": "Pick a calendar view",
  "supervisor-calendar-filter": "Filter the calendar",
  "supervisor-reports": "Open Reports",
  "referral-new": "Select New referral",
  "referral-packet": "Upload the packet",
  "referral-routing": "Assign the referral",
  "referral-medications": "Add medication information",
  "referral-create": "Review before creating",
  "referral-schedule-open": "Select Schedule",
  "referral-schedule-fields": "Add appointment details",
  "referral-schedule-save": "Review before scheduling",
  "report-period": "Select a month",
  "report-results": "Check the results",
  "report-export": "Review before exporting",
  "find-search": "Search referrals",
  "find-open-result": "Open the referral",
  "find-verify-record": "Verify the record",
};

export function operatorGuideStepTitle(step: OperatorGuideStep) {
  return simpleStepTitles[step.id] ?? step.title;
}

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
const assessorRoles: readonly OperatorRole[] = ["admin", "reviewer"];
const supervisorRoles: readonly OperatorRole[] = ["admin", "assessment_coordinator"];

const assessmentWorkspaceRoute = "/?view=referrals&screen=packet&workspaceStage=assessment";

const assessmentSectionGuideSteps: readonly OperatorGuideStep[] = [
  step("assessment-section-identity", assessmentWorkspaceRoute, "assessment-section-identity", "Sections", "Client & referral", "Confirm the inherited client and referral facts before documenting the interview.", "Select Client & referral and compare the inherited values with the source packet.", "The correct referral identity and source context are visible.", "The assessment must stay attached to the correct intake episode.", "Inherited values still require verification; correct them in Intake when the source is wrong.", "confirm", "right"),
  step("assessment-section-placement", assessmentWorkspaceRoute, "assessment-section-prior-placement", "Sections", "Placement", "Record the current setting and the placement history that affects transition planning.", "Select Placement and review the current location, prior setting, and placement trajectory.", "Current and prior placement information are distinguishable.", "Placement context helps reviewers understand transition needs and prior breakdowns.", "Attribute supplied history and leave unsupported dates or details unknown.", "target-click", "right"),
  step("assessment-section-history", assessmentWorkspaceRoute, "assessment-section-history", "Sections", "History", "Capture hospitalization, crisis, and failed-placement history with dates and sources when known.", "Select History and document the relevant timeline without merging conflicting accounts.", "Hospital, crisis, and placement events have a clear timeframe and source.", "A readable timeline supports risk review without turning old events into current status.", "Do not copy historical statements forward as current facts without verification.", "target-click", "right"),
  step("assessment-answer", assessmentWorkspaceRoute, "assessment-answer", "Sections", "Enter a supported answer", "Narrative answers should state the finding, source, timeframe, and relevant detail.", "Enter a short synthetic answer in the highlighted field.", "The field contains a source-backed training answer and autosave begins.", "Specific documentation can be reviewed and converted into the downstream Chart.", "The guide detects input but never reads or stores the answer value.", "target-input", "top", true),
  step("assessment-help", assessmentWorkspaceRoute, "assessment-answer-help", "Sections", "Use Answer Help when needed", "Answer Help appears only where a narrative benefits from field-specific structure or an example.", "Open Answer Help on a narrative field when it is available.", "The note structure and example are visible.", "Targeted help supports consistent documentation without adding clutter to self-evident questions.", "Use the example as structure only; never copy facts that were not assessed.", "target-click", "top", true),
  step("assessment-section-clinical", assessmentWorkspaceRoute, "assessment-section-clinical", "Sections", "Clinical", "Document diagnoses, current symptoms, cognition, and the person’s presentation during the assessment.", "Select Clinical and separate current observation from client report and supplied records.", "Current presentation and historical diagnosis information are clearly separated.", "This distinction keeps the clinical summary accurate and reviewable.", "Do not validate, dismiss, or invent symptom content.", "target-click", "right"),
  step("assessment-section-function", assessmentWorkspaceRoute, "assessment-section-function", "Sections", "Function", "Capture what the person does independently and where prompting, equipment, or hands-on support is needed.", "Select Function and answer each conditional follow-up that appears.", "ADLs, mobility, communication, and participation have usable support details.", "Specific functional information becomes an actionable care handoff.", "Do not infer independence from diagnosis or setting alone.", "target-click", "right"),
  step("assessment-section-medication", assessmentWorkspaceRoute, "assessment-section-medication", "Sections", "Medication", "Verify the medication context carried from intake and document adherence, refusals, routes, and PRN patterns.", "Select Medication and distinguish supplied medication information from what was verified in the assessment.", "Medication facts, source, and unresolved discrepancies are clear.", "The handoff needs usable medication context without misrepresenting intake text as reconciliation.", "This assessment does not prescribe or independently reconcile medications.", "target-click", "right"),
  step("assessment-section-substance", assessmentWorkspaceRoute, "assessment-section-substance-use", "Sections", "Substance use", "Document history, current use, frequency, impact, treatment, and the person’s own account.", "Select Substance use and complete the follow-ups that match the reported history.", "Use pattern, recency, impact, and source are understandable.", "A structured account avoids collapsing past and current use into one label.", "Use neutral language and preserve differences between client and collateral reports.", "target-click", "right"),
  step("assessment-section-behavior", assessmentWorkspaceRoute, "assessment-section-behavior-safety", "Sections", "Behavior & safety", "Assess current and historical behavior, triggers, self-harm, assaults, elopement, and perceptual experiences.", "Select Behavior & safety and document recency, frequency, trigger, response, and outcome where relevant.", "Each positive safety history has enough context for review and planning.", "Specific behavior patterns are more actionable than broad risk labels.", "Escalate immediate safety concerns through policy; do not rely on form completion alone.", "target-click", "right"),
  step("assessment-section-physical", assessmentWorkspaceRoute, "assessment-section-physical-health", "Sections", "Physical health", "Record health concerns, skin integrity, continence support, diet, and equipment needs.", "Select Physical health and complete conditional support details when an answer is Yes.", "Health needs and the exact level of support are visible.", "Receiving staff need concrete support information rather than a diagnosis list alone.", "Record observed or attributed facts and escalate urgent medical concerns separately.", "target-click", "right"),
  step("assessment-section-legal", assessmentWorkspaceRoute, "assessment-section-legal", "Sections", "Legal", "Capture conserved status, forensic history, court requirements, and supervision obligations.", "Select Legal and verify the status and source documents before completing conditional details.", "Current legal status is separated from historical involvement.", "Accurate legal context protects placement decisions and required follow-up.", "Do not infer legal status from placement type or an old record.", "target-click", "right"),
  step("assessment-section-support", assessmentWorkspaceRoute, "assessment-section-support-goals", "Sections", "Support & goals", "Document relationships, stable-living history, preferences, and the person’s stated goals.", "Select Support & goals and preserve the person’s own priorities alongside collateral information.", "Supports, preferences, and placement goals are clear and attributed.", "The final recommendation should reflect the person, not only risks and deficits.", "Do not promise a placement or outcome that has not been approved.", "target-click", "right"),
  step("assessment-section-review", assessmentWorkspaceRoute, "assessment-section-review", "Sections", "Review", "Use the final section for relevant information and placement questions that do not belong elsewhere.", "Select Review, resolve required gaps, and remove duplicated or unsupported narrative.", "The assessment is complete, concise, and ready for a final save check.", "A deliberate final review catches missing evidence before signature locks the record.", "Unknown information should stay visible as unknown rather than being filled by assumption.", "target-click", "right"),
];

export const operatorGuidedTutorials: readonly OperatorGuidedTutorial[] = [
  tutorial({
    id: "review-chart",
    title: "Review a chart",
    workflow: "Supervisor",
    summary: "Review the signed assessment record and check Meet the Client handoff readiness.",
    outcome: "Verify that both Chart views come from the completed assessment and are ready for authorized use.",
    minutes: 6,
    persona: "supervisor",
    clickpath: ["Workspaces", "Referral", "Chart", "Complete chart", "Meet the Client"],
    audiences: supervisorRoles,
    moduleIds: ["assessment-complete-sign", "final-decision", "ehr-handoff"],
    steps: [
      step("chart-find", "/?view=referrals", "workspace-search", "Find", "Find the reviewed referral", "Chart review begins from the existing referral so its signed assessment, decision state, and source files remain connected.", "Enter a training client or referral search term.", "The matching workspace results are visible.", "A deliberate lookup reduces wrong-record review risk.", "Verify the referral episode and authorized purpose before opening it.", "target-input", "bottom"),
      step("chart-open-referral", "/?view=referrals", "workspace-results", "Find", "Open the referral", "The workspace connects the assessment source, generated Chart views, files, and activity in one governed episode.", "Select the correct training workspace.", "The referral workspace is open.", "The source workspace makes Chart provenance reviewable.", "Only open records required for authorized review.", "target-click", "top"),
      step("chart-stage", "/?view=referrals&screen=packet", "chart-stage", "Chart", "Open Chart", "Chart presents assessment-derived records after the assessment has reached the required completed and signed state.", "Select Chart in the highlighted stage navigation.", "The Chart stage is visible.", "Chart views are downstream representations of the assessment, not separate clinical documentation.", "If Chart is unavailable, resolve assessment completion or permission rather than recreating it.", "target-click", "bottom", true),
      step("chart-complete", "/?view=referrals&screen=packet", "chart-complete-record", "Review", "Review the complete chart", "The complete chart organizes the signed assessment into a medical-record-style review surface with assessment provenance.", "Review the highlighted chart and compare important conclusions with the signed assessment.", "You can identify the assessment version and signed source behind the Chart.", "Provenance prevents a generated view from being mistaken for a separate source record.", "Do not treat a Chart summary as permission to alter the signed assessment.", "confirm", "top", true),
      step("chart-meet-client", "/?view=referrals&screen=packet", "chart-meet-client-tab", "Handoff", "Open Meet the Client", "Meet the Client provides a concise face sheet from the same assessment for an authorized accepted-referral handoff.", "Select Meet the Client in the highlighted Chart tabs.", "The Meet the Client face sheet is visible.", "A concise handoff supports receiving staff without replacing the complete Chart.", "Availability depends on assessment and decision state; do not bypass those controls.", "target-click", "bottom", true),
      step("chart-email", "/?view=referrals&screen=packet", "chart-email-handoff", "Handoff", "Stop at email handoff", "The email area includes the approved face sheet and admission packet only after the referral is eligible.", "Verify recipient authorization, packet readiness, and minimum-necessary content. Finish the guide without sending training data.", "The handoff is deliberately sent by an authorized person or withheld for correction.", "A human send checkpoint protects PHI, recipient scope, and packet completeness.", "The guide never sends email or confirms recipient authorization for you.", "confirm", "left", true),
    ],
  }),
  tutorial({
    id: "assessor-shift",
    title: "Check my work",
    workflow: "Assessor",
    summary: "Find assigned work, check today’s schedule, and open the referral that needs action.",
    outcome: "Leave Home with the correct assigned referral open and a clear next action.",
    minutes: 5,
    persona: "assessor",
    clickpath: ["Home", "Workspaces", "Search", "Assessment"],
    audiences: assessorRoles,
    moduleIds: ["pipeline-purpose", "navigation-model", "assessment-start"],
    steps: [
      step("assessor-review-queue", "/", "my-queue", "Home", "Review your assigned work", "Home is scoped to your assigned referrals and scheduled assessment work instead of the organization’s entire queue.", "Identify the first assigned item that needs action today.", "You can name the referral and the action it needs.", "Starting with ownership and timing prevents work from being selected from memory.", "Open the underlying referral before changing anything; a summary is not the clinical record.", "confirm", "right"),
      step("assessor-open-workspaces", "/", "primary-workspaces", "Workspaces", "Open Workspaces", "Workspaces contains active referral episodes and their connected intake, assessment, chart, files, and activity.", "Select Workspaces in the highlighted navigation.", "The workspace directory is open.", "The shared directory keeps each assessment attached to its referral episode.", "Opening Workspaces is read-only and does not change ownership or status.", "target-click", "bottom"),
      step("assessor-find-referral", "/?view=referrals", "workspace-search", "Workspaces", "Find the assigned referral", "Search narrows the governed referral list by client, community, county, source, or owner.", "Enter a training search term in the highlighted field.", "The visible results narrow after you type.", "Searching the shared list prevents duplicate work and wrong-record navigation.", "The guide detects typing but never reads or stores the search value.", "target-input", "bottom"),
      step("assessor-open-referral", "/?view=referrals", "workspace-results", "Workspaces", "Open the correct workspace", "The result opens the referral episode where packet evidence, assessment work, chart, files, and activity remain connected.", "Select the intended training referral from the highlighted results.", "The referral workspace opens.", "Opening the source record preserves context before clinical work begins.", "Verify identity and assignment before documenting assessment information.", "target-click", "top"),
      step("assessor-open-stage", "/?view=referrals&screen=packet", "assessment-stage", "Assessment", "Open Assessment", "Assessment is the assessor’s working area for scheduling, interview documentation, completion, and signature.", "Select Assessment in the workspace stage navigation.", "The assessment area is visible.", "The assessment stays attached to the referral and its verified intake information.", "Do not begin when identity, assignment, or readiness remains unresolved.", "target-click", "bottom"),
    ],
  }),
  tutorial({
    id: "start-assessment",
    title: "Schedule an assessment",
    workflow: "Assessor",
    summary: "Open the assigned referral, schedule the interview, and begin the assessment.",
    outcome: "Start the correct assessment under the assigned assessor with a visible appointment record.",
    minutes: 7,
    persona: "assessor",
    clickpath: ["Workspaces", "Referral", "Assessment", "Schedule", "Begin"],
    audiences: assessorRoles,
    moduleIds: ["assessment-start", "calendar-coordination"],
    steps: [
      step("assessment-schedule-find", "/?view=referrals", "workspace-search", "Find", "Find the assigned referral", "Scheduling begins from the existing referral so the appointment stays connected to its source packet, owner, and community.", "Enter a synthetic client or referral search term.", "The intended workspace is visible in the results.", "A deliberate lookup prevents duplicate assessments and wrong-record scheduling.", "Verify identity and assignment before opening the workspace.", "target-input", "bottom"),
      step("assessment-schedule-open-referral", "/?view=referrals", "workspace-results", "Find", "Open the referral", "The referral workspace is the governed entry point for its assessment and calendar events.", "Select the correct synthetic workspace.", "The referral workspace is open.", "One connected workspace preserves ownership and schedule history.", "Only schedule work assigned to you or authorized by a supervisor.", "target-click", "top"),
      step("assessment-schedule-stage", "/?view=referrals&screen=packet", "assessment-stage", "Assessment", "Open Assessment", "Assessment contains the appointment, interview, autosave, completion, and signature controls for this referral.", "Select Assessment in the workspace stage navigation.", "The assessment area is visible.", "The assessment remains connected to verified intake information.", "Resolve identity, assignment, or packet-readiness issues before scheduling.", "target-click", "bottom"),
      step("assessment-schedule-open", assessmentWorkspaceRoute, "assessment-schedule-open", "Schedule", "Open scheduling", "Scheduling creates or opens the one assessment record for this referral and presents its appointment fields.", "Select Schedule assessment when needed. Once the scheduling form is open, continue the guide.", "The scheduling form is open.", "A single assessment record prevents detached appointments and duplicate interviews.", "If the control is unavailable, verify assignment and permissions instead of bypassing them.", "confirm", "left"),
      step("assessment-schedule-fields", assessmentWorkspaceRoute, "assessment-schedule-fields", "Schedule", "Set the appointment", "Record the date, time, duration, method, and Zoom link or location that the assessor will use.", "Set the synthetic date and time in the highlighted field, then complete the remaining appointment details before saving.", "The form has a usable date, time, duration, method, and location or link.", "Complete appointment details make the event actionable in the assessor’s calendar.", "Confirm time zone and never place unnecessary clinical detail in calendar fields.", "target-change", "left"),
      step("assessment-schedule-save", assessmentWorkspaceRoute, "assessment-schedule-save", "Schedule", "Save the schedule", "Saving creates the assessment appointment event and keeps it scoped to the assigned assessor.", "Review the synthetic appointment, select Schedule assessment yourself, then continue the guide.", "The scheduling dialog closes and Begin assessment is available.", "The calendar and referral now share the same appointment source.", "The guide never schedules or reschedules an appointment on your behalf.", "confirm", "left"),
      step("assessment-begin", assessmentWorkspaceRoute, "assessment-begin", "Begin", "Select Begin assessment", "Beginning changes scheduled work into an active, accountable assessment under the signed-in assessor.", "Select Begin assessment when the interview is actually starting.", "The begin confirmation is visible.", "A separate checkpoint prevents accidental starts.", "Do not begin early merely to clear the schedule queue.", "target-click", "left"),
      step("assessment-begin-confirm", assessmentWorkspaceRoute, "assessment-begin-confirm", "Begin", "Confirm the start", "The final confirmation records the assessment start and enables clinical entry.", "Verify the synthetic client, assessor, appointment, and method, select Begin assessment yourself, then finish the guide.", "The interview form is active and section navigation is available.", "A deliberate start establishes who is accountable for the clinical documentation.", "The guide never begins an assessment or verifies readiness on your behalf.", "confirm", "left"),
    ],
  }),
  tutorial({
    id: "complete-assessment",
    title: "Finish an assessment",
    workflow: "Assessor",
    summary: "Open the active assessment, work through all 12 sections, verify autosave, and stop at signature.",
    outcome: "Complete a defensible assessment and understand the final signing boundary.",
    minutes: 20,
    persona: "assessor",
    clickpath: ["Workspaces", "Referral", "Assessment", "12 sections", "Save", "Sign"],
    audiences: assessorRoles,
    moduleIds: ["assessment-start", "assessment-demographics", "assessment-questionnaire", "assessment-complete-sign"],
    steps: [
      step("assessment-find", "/?view=referrals", "workspace-search", "Find", "Find the assigned referral", "Begin from the existing assigned referral so the assessment remains connected to the correct source packet and history.", "Enter a training client or referral search term.", "The matching workspace results are visible.", "A deliberate lookup reduces wrong-record and duplicate-assessment risk.", "A matching name is not enough; verify the referral episode before opening it.", "target-input", "bottom"),
      step("assessment-open-referral", "/?view=referrals", "workspace-results", "Find", "Open the referral", "The workspace is the governed entry point for assessment work and preserves ownership, source files, and activity.", "Select the correct training workspace.", "The referral workspace is open.", "Starting from the workspace preserves one continuous admissions record.", "Only open records assigned to you or required for authorized work.", "target-click", "top"),
      step("assessment-stage", "/?view=referrals&screen=packet", "assessment-stage", "Open", "Select Assessment", "The Assessment stage contains the interview, section progress, autosave state, and signing control.", "Select Assessment in the highlighted stage navigation.", "The assessment area is visible.", "One assessment surface keeps intake data and assessor answers distinct but connected.", "Schedule and begin the assessment first when it is not already in progress.", "target-click", "bottom"),
      ...assessmentSectionGuideSteps,
      step("assessment-save", assessmentWorkspaceRoute, "assessment-save-status", "Save and sign", "Confirm autosave status", "The save indicator distinguishes a saved draft from work that is pending or failed to persist.", "Confirm that the highlighted save status shows All changes saved before leaving or signing.", "The assessment draft has a visible saved state.", "Visible persistence status protects work during interruptions and handoffs.", "Do not leave or sign while save failure, queued changes, or unresolved conflicts are visible.", "confirm", "left"),
      step("assessment-sign", assessmentWorkspaceRoute, "assessment-sign", "Save and sign", "Stop at assessment signature", "Signing locks the completed assessment as an accountable clinical artifact and enables supervisor review and Chart generation.", "Resolve required gaps and review the complete assessment. Finish this guide; sign authorized work yourself only when ready.", "The assessment is deliberately signed by you or left unsigned for correction.", "Signature is a clinical accountability boundary and must remain a deliberate human action.", "The guide never clicks Sign assessment or records a signature for you.", "confirm", "left", true),
    ],
  }),
  tutorial({
    id: "supervisor-shift",
    title: "Check team work",
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
      step("supervisor-open-calendar", "/?view=referrals", "primary-calendar", "Calendar", "Open team scheduling", "Calendar shows referral assignment events and scheduled assessments using distinct event types and role-aware scope.", "Select Calendar in the highlighted navigation.", "The assessment calendar is open.", "The calendar exposes coverage and timing issues while the referral remains authoritative.", "Opening Calendar does not create or move an event.", "target-click", "bottom"),
      step("supervisor-calendar-view", "/?screen=calendar", "calendar-view", "Calendar", "Choose the time horizon", "Month shows capacity, Week supports near-term coordination, and Agenda emphasizes chronological actions.", "Select the calendar view that best answers the staffing question.", "The calendar changes to the selected view.", "The right time horizon makes gaps and conflicts easier to see.", "Changing the view affects presentation only.", "target-click", "bottom"),
      step("supervisor-calendar-filter", "/?screen=calendar", "calendar-filters", "Calendar", "Scope by assessor or community", "Calendar filters isolate the assessor, community, and event type relevant to the supervisor’s question.", "Change one highlighted calendar filter.", "The visible schedule reflects the chosen scope.", "Scoped review produces an actionable workload view instead of a wall of events.", "A filter never changes the underlying assignment or schedule.", "target-change", "bottom"),
      step("supervisor-reports", "/?screen=calendar", "primary-reports", "Reports", "Open operational reports", "Reports provides reproducible lists for completed assessments, workload, documents, calendar, and workspaces.", "Select Reports in the highlighted navigation.", "The report runner is open.", "A report can verify the exception and preserve its exact scope.", "Opening Reports does not export or transmit information.", "target-click", "bottom"),
    ],
  }),
  tutorial({
    id: "create-referral",
    title: "Create a referral",
    workflow: "Intake",
    summary: "Attach the packet, verify intake facts, assign the referral, and stop at the creation check.",
    outcome: "Prepare one source-backed referral and understand the creation boundary.",
    minutes: 7,
    persona: "shared",
    clickpath: ["New referral", "Packet", "Identity", "Assignment", "Create"],
    audiences: writeRoles,
    moduleIds: ["inbound-triage", "create-referral", "medication-intake", "upload-packet"],
    steps: [
      step("referral-new", "/", "primary-new-referral", "Start", "Open New referral", "New referral opens one unsaved intake draft for the packet, referral facts, routing, and medication context.", "Select New referral in the highlighted navigation.", "An unsaved referral draft is open.", "One entry point preserves source history and ownership from the beginning.", "Search for an existing referral before creating a real record.", "target-click", "bottom"),
      step("referral-packet", "/?view=referrals&screen=packet", "initial-packet-upload", "Packet", "Attach the source packet", "The initial packet anchors proposed extraction and manually entered information to source evidence.", "Drop one authorized training document here, or select Choose file.", "The selected filename and Ready to upload appear in the document area.", "Source-first intake makes later verification and correction explainable.", "Verify the workspace and use only training material while learning.", "target-change", "bottom"),
      step("referral-identity", "/?view=referrals&screen=packet", "intake-identity", "Identity", "Verify identity", "Identity fields establish who the referral belongs to and must be compared with the packet before creation.", "Enter or correct one training identity field, then leave the field.", "The draft shows the source-backed identity value.", "Accurate identity protects assessment history, reporting, and EHR matching.", "A proposed extraction is not verified until a person compares it with the source.", "target-input", "top"),
      step("referral-routing", "/?view=referrals&screen=packet", "intake-routing", "Assignment", "Set routing and ownership", "Community, received date, source, contact, and assignee determine where the referral belongs and who moves it forward.", "Change one training routing or assignment field.", "The draft has an accountable destination and owner.", "Explicit ownership prevents referrals from disappearing between people or communities.", "Do not make an unexplained reassignment or use another person’s identity.", "target-change", "top"),
      step("referral-medications", "/?view=referrals&screen=packet", "intake-medications", "Medications", "Carry supplied medication context", "Medication information received at intake carries into assessment for verification rather than becoming a reconciled list.", "Enter or correct training medication context, then leave the field.", "Medication context is visible for later assessor review.", "Carry-forward reduces re-entry while preserving where the information came from.", "Intake medication text is not clinically verified, reconciled, or prescribed.", "target-input", "top"),
      step("referral-create", "/?view=referrals&screen=packet", "create-workspace", "Create", "Stop at Create workspace", "Creating stores the referral, exposes it to authorized workflows, and can begin asynchronous packet processing.", "Perform the duplicate, identity, source, owner, and packet check. Finish this checkpoint without creating training data.", "The draft is deliberately created by you or left unsaved for correction.", "An explicit creation boundary keeps incomplete drafts out of operational queues.", "The guide never clicks Create workspace for you.", "confirm", "left", true),
    ],
  }),
  tutorial({
    id: "run-report",
    title: "Run a report",
    workflow: "Reports",
    summary: "Choose the operational question, set its scope, inspect the rows, and stop at CSV export.",
    outcome: "Produce a reproducible report without losing period, scope, or row-level context.",
    minutes: 5,
    persona: "supervisor",
    clickpath: ["Reports", "Choose report", "Set period", "Review rows", "CSV"],
    audiences: supervisorRoles,
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
    title: "Find a referral",
    workflow: "Workspaces",
    summary: "Search the shared workspace directory and open the existing referral episode.",
    outcome: "Return to the correct referral without creating a duplicate or losing its stage context.",
    minutes: 4,
    persona: "shared",
    clickpath: ["Workspaces", "Search", "Open referral"],
    audiences: allRoles,
    moduleIds: ["pipeline-purpose", "navigation-model"],
    steps: [
      step("find-open-workspaces", "/", "primary-workspaces", "Workspaces", "Open Workspaces", "Workspaces is the shared referral inventory across communities and months.", "Select Workspaces in the highlighted navigation.", "The workspace directory is open.", "The shared directory is the reliable return path after interruption.", "Opening Workspaces is read-only.", "target-click", "bottom"),
      step("find-search", "/?view=referrals", "workspace-search", "Search", "Search the shared inventory", "Search by approved client, community, county, source, or owner information rather than scanning from memory.", "Enter a training search term in the highlighted field.", "The visible result list narrows.", "Search is the first protection against duplicate work.", "Treat matching names as candidates until identity and episode are verified.", "target-input", "bottom"),
      step("find-open-result", "/?view=referrals", "workspace-results", "Open", "Open the existing referral", "The result opens the connected referral episode at its available workflow stage with files and activity intact.", "Select the intended training referral from the highlighted results.", "The existing referral workspace opens.", "Reopening the existing record preserves one source of truth.", "Only open a record required for authorized work and verify identity before editing.", "target-click", "top"),
      step("find-verify-record", "/?view=referrals&screen=packet", "intake-identity", "Verify", "Verify the referral episode", "Confirm the client identity, source, received date, and community before continuing work in the opened workspace.", "Compare the visible intake facts with the referral episode you intended to open, then acknowledge this checkpoint.", "The client and referral episode match the work you intended to continue.", "A final identity check prevents a matching name from becoming a wrong-record edit.", "Stop and return to search if any identity or episode detail does not match.", "confirm", "top"),
    ],
  }),
];

export const operatorGuideVerifiedActionTargets: Readonly<Record<Exclude<OperatorGuideAdvance, "confirm">, readonly string[]>> = {
  "target-click": ["primary-workspaces", "primary-calendar", "primary-new-referral", "primary-reports", "calendar-view", "workspace-results", "assessment-stage", "assessment-open", "assessment-schedule-open", "assessment-schedule-save", "assessment-begin", "assessment-begin-confirm", "assessment-section-prior-placement", "assessment-section-history", "assessment-answer-help", "assessment-section-clinical", "assessment-section-function", "assessment-section-medication", "assessment-section-substance-use", "assessment-section-behavior-safety", "assessment-section-physical-health", "assessment-section-legal", "assessment-section-support-goals", "assessment-section-review", "chart-stage", "chart-meet-client-tab", "operations-report-select"],
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
  "workspace-results": "components/pipeline/ReferralWorklist.tsx",
  "calendar-view": "components/pipeline/PipelineCalendar.tsx",
  "calendar-filters": "components/pipeline/PipelineCalendar.tsx",
  "initial-packet-upload": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-identity": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-routing": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-medications": "components/pipeline/ReferralPacketCanvas.tsx",
  "create-workspace": "components/pipeline/ReferralPacketCanvas.tsx",
  "assessment-stage": "components/pipeline/ReferralPacketCanvas.tsx",
  "assessment-schedule-open": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-schedule-fields": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-schedule-save": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-begin": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-begin-confirm": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-identity": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-prior-placement": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-history": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-clinical": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-function": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-medication": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-substance-use": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-behavior-safety": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-physical-health": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-legal": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-support-goals": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-section-review": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-answer": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-answer-help": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-save-status": "components/pipeline/AssessmentWorkspace.tsx",
  "assessment-sign": "components/pipeline/AssessmentWorkspace.tsx",
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
