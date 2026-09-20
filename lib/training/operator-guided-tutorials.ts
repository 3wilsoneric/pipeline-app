import type { OperatorRole } from "@/lib/training/operator-training-types";
import type { AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";

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
  "assessment-schedule-fields": "Set the appointment",
  "assessment-schedule-method": "Choose the interview method",
  "assessment-schedule-save": "Save the schedule",
  "assessment-schedule-assessment": "Open the assessment",
  "assessment-section": "Choose a section",
  "assessment-answer": "Enter an answer",
  "assessment-help": "Open Language Lab",
  "assessment-next": "Open the next section",
  "assessment-save": "Check saved",
  "assessment-sign": "Review the full assessment",
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
  "report-period": "Set the report filters",
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
const assessorRoles = writeRoles;
const supervisorRoles: readonly OperatorRole[] = ["admin", "assessment_coordinator"];

const assessmentSchedulingRoute = "/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=schedule";
const assessmentWorkspaceRoute = "/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=guided";

function assessmentSectionRoute(section: AssessmentToolSection) {
  return `${assessmentWorkspaceRoute}&assessmentSection=${section}`;
}

const assessmentSectionGuideSteps: readonly OperatorGuideStep[] = [
  step("assessment-section-identity", assessmentSectionRoute("identity"), "assessment-section-identity", "Section 1 of 12", "Client & referral", "These values came from intake and identify the assessment episode.", "Check the name, date of birth, community, referral date, referral source, contact, and current location. Select Client & referral when they match the source packet.", "The inherited identity and referral details match the source packet.", "The assessment must stay attached to the correct intake episode.", "If an inherited value is wrong, correct it in Intake instead of working around it here.", "target-click", "right"),
  step("assessment-section-placement", assessmentSectionRoute("prior_placement"), "assessment-section-prior-placement", "Section 2 of 12", "Placement", "This section explains where the person is now and what happened in prior settings.", "Enter the current setting, prior setting type and name, dates when known, and any placement breakdowns or AWOL history. Select Placement when current and prior settings are clearly separated.", "The current setting and relevant placement history are complete and dated where possible.", "Placement context helps reviewers understand transition needs and prior breakdowns.", "Name the source and leave unsupported dates or details unknown.", "target-click", "right"),
  step("assessment-section-history", assessmentSectionRoute("prior_history"), "assessment-section-history", "Section 3 of 12", "History", "This section records prior hospital, crisis, and emergency events.", "Record psychiatric hospitalizations, holds, crisis visits, emergency visits, and failed placements with dates or timeframes and a source. Select History when the sequence of events is understandable.", "Each relevant event has a timeframe, outcome, and source when known.", "A readable timeline supports risk review without turning old events into current status.", "Do not copy historical statements forward as current facts without verification.", "target-click", "right"),
  step("assessment-answer", assessmentSectionRoute("prior_history"), "assessment-answer", "Section 3 of 12", "Enter a supported answer", "Narrative answers should state the finding, source, timeframe, and relevant detail.", "Enter a short synthetic answer in the highlighted History field.", "The field contains a source-backed training answer and autosave begins.", "Specific documentation can be reviewed and converted into the downstream Chart.", "The guide detects input but never reads or stores the answer value.", "target-input", "top", true),
  step("assessment-help", assessmentSectionRoute("prior_history"), "assessment-answer-help", "Section 3 of 12", "Use Language Lab when needed", "Language Lab appears inside narrative fields that benefit from field-specific structure or an example.", "Open Language Lab on the highlighted narrative field.", "The field-specific structure and example are visible.", "Targeted help supports consistent documentation without adding clutter to self-evident questions.", "Use the example as structure only; never copy facts that were not assessed.", "confirm", "top", true),
  step("assessment-section-clinical", assessmentSectionRoute("diagnosis_clinical"), "assessment-section-clinical", "Section 4 of 12", "Clinical", "This section separates diagnosis history from the current interview presentation.", "Verify diagnoses and document current mood, thought process, cognition, orientation, and reported symptoms. Select Clinical when current observations and historical information are clearly labeled.", "The current presentation is distinct from prior diagnoses and symptoms.", "This distinction keeps the clinical summary accurate and reviewable.", "Record what was reported or observed without validating, dismissing, or inventing symptom content.", "target-click", "right"),
  step("assessment-section-function", assessmentSectionRoute("functional_adl"), "assessment-section-function", "Section 5 of 12", "Function", "This section defines the support the person needs during daily care.", "For each ADL, record independent, prompting, equipment, or hands-on support. Include mobility, communication, and participation needs. Select Function when the support level is specific enough for receiving staff.", "ADLs, mobility, communication, and participation each have a clear support level.", "Specific functional information becomes an actionable care handoff.", "Do not infer independence from diagnosis or setting alone.", "target-click", "right"),
  step("assessment-section-medication", assessmentSectionRoute("medication"), "assessment-section-medication", "Section 6 of 12", "Medication", "Medication details from intake are carried here for assessor verification.", "Compare the supplied medication list with the packet and interview. Record adherence, refusals, oral or injectable route, PRN use, and any discrepancy. Select Medication when the source and unresolved differences are clear.", "The medication list, adherence pattern, routes, PRN use, source, and discrepancies are documented.", "The handoff needs usable medication context without misrepresenting intake text as reconciliation.", "This assessment does not prescribe or independently reconcile medications.", "target-click", "right"),
  step("assessment-section-substance", assessmentSectionRoute("substance_use"), "assessment-section-substance-use", "Section 7 of 12", "Substance use", "This section distinguishes current use from historical use.", "For each substance, record current or historical use, frequency, last known use, effect on functioning, and treatment history. Select Substance use when the client and collateral accounts are attributed separately.", "The substances, recency, pattern, impact, treatment, and source are clear.", "A structured account avoids collapsing past and current use into one label.", "Use neutral language and preserve differences between client and collateral reports.", "target-click", "right"),
  step("assessment-section-behavior", assessmentSectionRoute("behavioral_risk"), "assessment-section-behavior-safety", "Section 8 of 12", "Behavior & safety", "This section documents behavior and safety patterns that affect placement and care.", "Record self-harm, aggression, elopement, fire-setting, and perceptual experiences with recency, frequency, trigger, response, and outcome. Select Behavior & safety when every positive answer has usable context.", "Positive safety history includes recency, frequency, trigger, response, outcome, and source.", "Specific behavior patterns are more actionable than broad risk labels.", "Escalate an immediate safety concern through policy; completing this form is not an escalation.", "target-click", "right"),
  step("assessment-section-physical", assessmentSectionRoute("physical_health"), "assessment-section-physical-health", "Section 9 of 12", "Physical health", "This section identifies medical and personal-care needs receiving staff must prepare for.", "Record active health issues, skin concerns, continence and brief support, ostomy care, diet, mobility equipment, and other required assistance. Select Physical health when the exact support level is clear.", "Each active health need identifies the assistance, equipment, or follow-up required.", "Receiving staff need concrete support information rather than a diagnosis list alone.", "Record observed or attributed facts and escalate urgent medical concerns separately.", "target-click", "right"),
  step("assessment-section-legal", assessmentSectionRoute("legal_conservatorship"), "assessment-section-legal", "Section 10 of 12", "Legal", "This section records current legal authority and obligations.", "Select the conserved status: LPS, TCon, Murphy's, or Non-Conserved. Add current forensic history, court requirements, and supervision obligations with a source. Select Legal when current status is distinct from old legal history.", "Conserved status and any current court or supervision requirements are source-backed.", "Accurate legal context protects placement decisions and required follow-up.", "Do not infer legal status from a placement type or an old record.", "target-click", "right"),
  step("assessment-section-support", assessmentSectionRoute("social_support"), "assessment-section-support-goals", "Section 11 of 12", "Support & goals", "This section records the people, preferences, and goals that support a successful placement.", "Document involved supports, stable-living history, facility preferences, and the person's stated goals. Select Support & goals when each statement is attributed and no placement outcome is promised.", "Supports, preferences, and goals are specific, attributed, and relevant to placement.", "The final recommendation should reflect the person, not only risks and deficits.", "Do not promise a placement or outcome that has not been approved.", "target-click", "right"),
  step("assessment-section-review", assessmentSectionRoute("provenance_qc"), "assessment-section-review", "Section 12 of 12", "Review", "This is the final check before the save and signature steps.", "Resolve missing required answers, duplicated notes, conflicting sources, and unsupported statements. Use Additional information only for relevant facts that do not fit another section. Select Review when the assessment is ready for the save check.", "Required fields are complete and unresolved conflicts or unknowns remain visible.", "A deliberate final review catches missing evidence before signature locks the record.", "Do not fill an unknown value by assumption or hide a source conflict in general comments.", "target-click", "right"),
];

export const operatorGuidedTutorials: readonly OperatorGuidedTutorial[] = [
  tutorial({
    id: "review-chart",
    title: "Review a chart",
    workflow: "Supervisor",
    summary: "Review a completed, signed assessment and its Meet the Client handoff. Transferred charts may not have these assessment views.",
    outcome: "Check the signed assessment behind these views without confusing a transferred chart with a completed assessment.",
    minutes: 6,
    persona: "supervisor",
    clickpath: ["Workspaces", "Referral", "Chart", "Complete chart", "Meet the Client"],
    audiences: supervisorRoles,
    moduleIds: ["assessment-complete-sign", "move-in-requirements", "ehr-handoff"],
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
    summary: "Find your assignment on Home, return to saved work, or locate the existing referral in Workspaces.",
    outcome: "Leave Home with the correct assigned referral open and a clear next action.",
    minutes: 5,
    persona: "assessor",
    clickpath: ["Home", "Workspaces", "Search", "Assessment"],
    audiences: assessorRoles,
    moduleIds: ["pipeline-purpose", "navigation-model", "assessment-start"],
    steps: [
      step("assessor-review-queue", "/", "my-queue", "Home", "Review your assigned work", "Assessors see My work and new assignments on Home; supervisors may see Team work. Continue working appears when saved work is available.", "Find your assignment in My work. To return to saved work, use Continue working when available or search Workspaces.", "You know which referral to open and whether you are starting assigned work or resuming a draft.", "Starting with ownership and timing prevents work from being selected from memory.", "Open the underlying referral before changing anything; a summary is not the clinical record.", "confirm", "right"),
      step("assessor-open-workspaces", "/", "primary-workspaces", "Workspaces", "Open Workspaces", "Workspaces contains active referral episodes and their connected intake, assessment, chart, files, and activity.", "Select Workspaces in the highlighted navigation.", "The workspace directory is open.", "The shared directory keeps each assessment attached to its referral episode.", "Opening Workspaces is read-only and does not change ownership or status.", "target-click", "bottom"),
      step("assessor-find-referral", "/?view=referrals", "workspace-search", "Workspaces", "Find the assigned referral", "Search narrows the governed referral list by client, community, county, source, or owner.", "Enter a training search term in the highlighted field.", "The visible results narrow after you type.", "Searching the shared list prevents duplicate work and wrong-record navigation.", "The guide detects typing but never reads or stores the search value.", "target-input", "bottom"),
      step("assessor-open-referral", "/?view=referrals", "workspace-results", "Workspaces", "Open the correct workspace", "The result opens the referral episode where packet evidence, assessment work, chart, files, and activity remain connected.", "Select the intended training referral from the highlighted results.", "The referral workspace opens.", "Opening the source record preserves context before clinical work begins.", "Verify identity and assignment before documenting assessment information.", "target-click", "top"),
      step("assessor-open-stage", "/?view=referrals&screen=packet", "assessment-stage", "Assessment", "Open Assessment", "Active referrals offer Assessment for scheduling and documentation. Transferred chart-only records do not need a new assessment merely because they were imported.", "Select Assessment for an active referral. If this is a transferred chart with no Assessment tab, skip this step.", "The active assessment opens, or the transferred chart remains unchanged.", "The assessment stays attached to the referral and its verified intake information.", "Do not begin when identity, assignment, or readiness remains unresolved.", "target-click", "bottom", true),
    ],
  }),
  tutorial({
    id: "start-assessment",
    title: "Schedule an assessment",
    workflow: "Assessor",
    summary: "After reviewing intake and arranging the interview, practice scheduling it in Pacific Time and opening the assessment.",
    outcome: "Save the appointment and continue directly to section 1 of the assessment.",
    minutes: 3,
    persona: "assessor",
    clickpath: ["Schedule", "Assessment"],
    audiences: assessorRoles,
    moduleIds: ["assessment-start", "calendar-coordination"],
    steps: [
      step("assessment-schedule-fields", assessmentSchedulingRoute, "assessment-schedule-fields", "Schedule", "Set the appointment", "Record the date, time, duration, and method. Add the assessment address, phone number, or Zoom meeting link shown for that method.", "Set the synthetic date and time in the highlighted field, then complete the remaining appointment details before saving.", "The appointment details match the selected method.", "Complete appointment details make the event actionable in the assessor’s calendar.", "Confirm time zone and never place unnecessary clinical detail in calendar fields.", "target-change", "left"),
      step("assessment-schedule-method", assessmentSchedulingRoute, "assessment-schedule-method", "Schedule", "Choose the interview method", "The method tells the assessor how the assessment will happen.", "Choose Zoom, in person, phone, or record review. Enter the Zoom meeting link, assessment address, or phone number in the matching field. Record review needs no meeting details.", "The method and matching appointment details are ready to save.", "A complete appointment can be used directly from the assessor calendar.", "Do not place clinical details or unnecessary PHI in appointment fields.", "target-change", "left"),
      step("assessment-schedule-save", assessmentSchedulingRoute, "assessment-schedule-save", "Schedule", "Save the schedule", "Saving creates the appointment and keeps it attached to the referral and assigned assessor.", "Complete the remaining appointment fields, then select Schedule assessment. The guide continues after the appointment saves.", "The appointment is saved and the assessment opens.", "The calendar and referral use the same appointment record.", "Confirm the time zone and keep clinical detail out of calendar fields.", "confirm", "left"),
      step("assessment-schedule-assessment", assessmentSectionRoute("identity"), "assessment-section-identity", "Assessment", "Open the assessment", "The appointment is complete. Assessment work now begins with the inherited client and referral information.", "Select Client & referral to begin the assessment walkthrough.", "Section 1 is open and ready for verification.", "The assessment remains connected to the scheduled referral.", "Verify inherited intake facts before entering clinical answers.", "target-click", "right"),
    ],
  }),
  tutorial({
    id: "complete-assessment",
    title: "Finish an assessment",
    workflow: "Assessor",
    summary: "Work through all 12 sections, verify autosave, and stop at signature.",
    outcome: "Complete a defensible assessment and understand the final signing boundary.",
    minutes: 20,
    persona: "assessor",
    clickpath: ["Assessment", "12 sections", "Save", "Sign"],
    audiences: assessorRoles,
    moduleIds: ["assessment-start", "assessment-demographics", "assessment-questionnaire", "assessment-complete-sign"],
    steps: [
      ...assessmentSectionGuideSteps.map((item): OperatorGuideStep => item.id.startsWith("assessment-section-") ? {
        ...item,
        advance: "confirm",
        instruction: "Open a subsection to review its questions. Use the section links to jump around, then Continue to move to the next section of the guide.",
      } : item),
      step("assessment-save", assessmentSectionRoute("provenance_qc"), "assessment-save-status", "Save and sign", "Confirm autosave status", "The save indicator distinguishes a saved draft from work that is pending or failed to persist.", "Confirm that the highlighted status says Practice changes saved locally before continuing.", "The training assessment has a visible locally saved state.", "Visible persistence status protects work during interruptions and handoffs.", "In live work, do not leave or sign while save failure, queued changes, or unresolved conflicts are visible.", "confirm", "left"),
      step("assessment-sign", assessmentSectionRoute("provenance_qc"), "assessment-section-review", "Save and sign", "Review the full assessment", "Section links show unanswered questions, and captured answers remain beside the questions.", "Select Review. Check missing answers and autosave before signing authorized work.", "The full assessment is open for review.", "Signature is a clinical accountability boundary and must remain a deliberate human action.", "The guide never clicks Sign assessment or records a signature for you.", "target-click", "left"),
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
      step("supervisor-home", "/", "my-queue", "Home", "Review current team work", "Home shows current work requiring attention and upcoming assessment events; it is not a fixed last-24-hours report.", "Review Team work and open the source referral for any item that needs attention.", "You can name the item that needs supervisor action.", "A short exception-first review focuses attention on work that can stall admissions.", "Open source records before changing assignments or reporting a conclusion.", "confirm", "right"),
      step("supervisor-workspaces", "/", "primary-workspaces", "Workspaces", "Open the referral inventory", "Workspaces provides the shared operational list across assessors, communities, months, and stages.", "Select Workspaces in the highlighted navigation.", "The workspace directory is open.", "The shared inventory is the correct place to verify ownership and stage.", "Opening the directory is read-only and does not reassign work.", "target-click", "bottom"),
      step("supervisor-open-calendar", "/?view=referrals", "primary-calendar", "Calendar", "Open team scheduling", "Calendar shows assessment appointments and unscheduled work within your role's scope. New assignments appear on Home.", "Select Calendar in the highlighted navigation.", "The assessment calendar is open.", "The calendar exposes coverage and timing issues while the referral remains authoritative.", "Opening Calendar does not create or move an event.", "target-click", "bottom"),
      step("supervisor-calendar-view", "/?screen=calendar", "calendar-view", "Calendar", "Choose the time horizon", "Week shows the schedule; on phones it lists appointments by date. Month shows the longer view. Select a date for its appointments; unfinished assessments remain under Continue working.", "Select Week or Month.", "The calendar changes to the selected view.", "An empty time slot does not confirm availability, and a past appointment does not complete an assessment.", "Changing the view affects presentation only.", "target-click", "bottom"),
      step("supervisor-calendar-filter", "/?screen=calendar", "calendar-filters", "Calendar", "Scope by assessor or community", "Filter appointments and the scheduling queue by assessor or community. My appointments shows your own work.", "Change one highlighted calendar filter.", "The visible schedule reflects the chosen scope.", "The referral remains the source of the appointment and its follow-ups.", "A filter never changes the underlying assignment or schedule.", "target-change", "bottom"),
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
      step("referral-packet", "/?view=referrals&screen=packet", "initial-packet-upload", "Packet", "Attach the source packet", "Document labels keep source files organized in the chart.", "Drop authorized training files or select Choose files. Confirm each document type, then select Add files.", "Each filename and its label appear in the document area, pending upload with the referral.", "Source-first intake makes later verification and correction explainable.", "Verify the workspace and use only training material while learning. A label does not verify a signature.", "target-change", "bottom"),
      step("referral-identity", "/?view=referrals&screen=packet", "intake-identity", "Identity", "Verify identity", "Identity fields establish who the referral belongs to and must be compared with the packet before creation.", "Enter or correct one training identity field, then leave the field.", "The draft shows the source-backed identity value.", "Accurate identity protects assessment history, reporting, and EHR matching.", "A proposed extraction is not verified until a person compares it with the source.", "target-input", "top"),
      step("referral-routing", "/?view=referrals&screen=packet", "intake-routing", "Assignment", "Set routing and ownership", "Community, received date, source, contact, and assignee determine where the referral belongs and who moves it forward.", "Change one training routing or assignment field.", "The draft has an accountable destination and owner.", "Explicit ownership prevents referrals from disappearing between people or communities.", "Do not make an unexplained reassignment or use another person’s identity.", "target-change", "top"),
      step("referral-medications", "/?view=referrals&screen=packet", "intake-medications", "Medications", "Carry supplied medication context", "Medication information received at intake carries into assessment for verification rather than becoming a reconciled list.", "Enter or correct training medication context, then leave the field.", "Medication context is visible for later assessor review.", "Carry-forward reduces re-entry while preserving where the information came from.", "Intake medication text is not clinically verified, reconciled, or prescribed.", "target-input", "top"),
      step("referral-create", "/?view=referrals&screen=packet", "create-workspace", "Create", "Stop at Create referral", "Creating stores the referral, exposes it to authorized workflows, and uploads queued documents. Later edits save automatically.", "Check the client, source, assessor, and queued files. Finish this checkpoint without creating training data.", "The draft is deliberately created by you or kept as an autosaved draft for correction.", "An explicit creation boundary keeps unfinished drafts out of operational queues.", "The guide never clicks Create referral for you.", "confirm", "left", true),
    ],
  }),
  tutorial({
    id: "run-report",
    title: "Run a report",
    workflow: "Reports",
    summary: "Choose a client or operational report, set its scope, Apply changes, and review the result before exporting.",
    outcome: "Produce a reproducible report without losing period, scope, or row-level context.",
    minutes: 5,
    persona: "supervisor",
    clickpath: ["Reports", "Choose report", "Filters", "Apply", "Review", "Export CSV"],
    audiences: supervisorRoles,
    moduleIds: ["dashboard-meaning", "filter-report-export"],
    steps: [
      step("report-open", "/", "primary-reports", "Reports", "Open Reports", "Reports contains governed operational lists and exports for referral, assessment, document, and workload questions.", "Select Reports in the highlighted navigation.", "The report runner is open.", "One report surface keeps operational questions reproducible.", "Opening Reports is read-only and does not create an export.", "target-click", "bottom"),
      step("report-choose", "/?screen=operations", "operations-report-select", "Reports", "Choose the report", "Choose the report that matches your question. Client reports and assessor performance reports expose different filters.", "Choose a report in the dropdown, rather than just opening the list.", "The selected report and its available filters load.", "Starting with the question prevents unrelated data from entering the result.", "Report availability follows role permissions and does not grant broader access.", "target-change", "bottom"),
      step("report-period", "/?screen=operations", "operations-summary", "Scope", "Set the report filters", "Available filters depend on the report. Changed filters do not update the displayed result until you select Apply.", "Set the available community, client scope, or period filters. Skip this step if the existing scope is correct.", "The chosen filters are ready to apply; the existing result is not yet refreshed.", "An explicit period and scope prevent ambiguous totals and exports.", "Confirm all displayed scope before interpreting staff or community results.", "target-change", "bottom"),
      step("report-apply", "/?screen=operations", "operations-report-apply", "Scope", "Apply the filters", "Apply loads results for the changed filters. It is disabled while loading or when the scope has not changed.", "Select Apply. If you kept the same filters and Apply is disabled, skip this step.", "The result refreshes for the selected scope before you review or export it.", "Applying the scope prevents reading old rows as if they reflected new filters.", "If the report fails to load, retry before relying on its results or exporting.", "target-click", "bottom", true),
      step("report-results", "/?screen=operations", "operations-report-results", "Verify", "Inspect the source rows", "Apply refreshes changed filters. Some reports open grouped Summary rows; Clients or a summary group reveals the underlying client rows.", "Select Apply if filters changed, then inspect the totals and source rows. In client reports, distinguish Summary groups from individual clients.", "You can explain each row and the applied scope that produced it.", "Row-level review catches filter mistakes before information leaves Pipeline.", "A report is operational evidence and not a clinical conclusion.", "confirm", "bottom"),
      step("report-export", "/?screen=operations", "operations-report-export", "Export", "Stop at CSV export", "CSV creates a portable copy of the currently scoped result for an approved operational purpose.", "Verify period, row count, audience, and minimum-necessary fields. Finish the guide; export authorized data yourself.", "The export is deliberately downloaded by you or withheld for correction.", "A human export checkpoint protects scope and PHI handling.", "The guide never clicks CSV or transmits report data.", "confirm", "left", true),
    ],
  }),
  tutorial({
    id: "find-workspace",
    title: "Find a referral",
    workflow: "Workspaces",
    summary: "Search the workspaces you can access and reopen the existing referral or transferred chart.",
    outcome: "Return to the correct referral without creating a duplicate or losing its stage context.",
    minutes: 4,
    persona: "shared",
    clickpath: ["Workspaces", "Search", "Open referral"],
    audiences: allRoles,
    moduleIds: ["pipeline-purpose", "navigation-model"],
    steps: [
      step("find-open-workspaces", "/", "primary-workspaces", "Workspaces", "Open Workspaces", "Workspaces shows the records you can access, sorted by recent updates. Supervisors can choose Mine or Team; assessors see their own work.", "Select Workspaces. Check the scope and any filters if a referral is missing.", "The workspace directory is open with its permitted scope.", "The shared directory is the reliable return path after interruption.", "Opening Workspaces is read-only.", "target-click", "bottom"),
      step("find-search", "/?view=referrals", "workspace-search", "Search", "Search the shared inventory", "Search by approved client, community, county, source, or owner information rather than scanning from memory.", "Enter a training search term in the highlighted field.", "The visible result list narrows.", "Search is the first protection against duplicate work.", "Treat matching names as candidates until identity and episode are verified.", "target-input", "bottom"),
      step("find-open-result", "/?view=referrals", "workspace-results", "Open", "Open the existing referral", "The result opens the connected referral episode at its available workflow stage with files and activity intact.", "Select the intended training referral from the highlighted results.", "The existing referral workspace opens.", "Reopening the existing record preserves one source of truth.", "Only open a record required for authorized work and verify identity before editing.", "target-click", "top"),
      step("find-verify-record", "/?view=referrals&screen=packet", "packet-workspace", "Verify", "Verify the referral episode", "Confirm the name and available referral details. Transferred charts may not have an Intake tab, and do not need a new workflow merely to view their records.", "Compare the displayed chart or intake details with the referral you intended to open, then continue.", "The client and referral episode match the work you intended to continue.", "A final identity check prevents a matching name from becoming a wrong-record edit.", "Stop and return to search if any identity or episode detail does not match.", "confirm", "top"),
    ],
  }),
];

export const operatorGuideVerifiedActionTargets: Readonly<Record<Exclude<OperatorGuideAdvance, "confirm">, readonly string[]>> = {
  "target-click": ["primary-workspaces", "primary-calendar", "primary-new-referral", "primary-reports", "calendar-view", "workspace-results", "assessment-stage", "assessment-section-identity", "assessment-section-prior-placement", "assessment-section-history", "assessment-answer-help", "assessment-section-clinical", "assessment-section-function", "assessment-section-medication", "assessment-section-substance-use", "assessment-section-behavior-safety", "assessment-section-physical-health", "assessment-section-legal", "assessment-section-support-goals", "assessment-section-review", "chart-stage", "chart-meet-client-tab", "operations-report-apply"],
  "target-input": ["workspace-search", "intake-identity", "intake-medications", "assessment-answer"],
  "target-change": ["calendar-filters", "initial-packet-upload", "intake-routing", "assessment-schedule-fields", "assessment-schedule-method", "operations-report-select", "operations-summary"],
};

export const operatorGuidedTutorialIds = operatorGuidedTutorials.map((tutorial) => tutorial.id);
export const operatorGuideTargetIds = [...new Set(operatorGuidedTutorials.flatMap((tutorial) => tutorial.steps.map((step) => step.target)))];

export const operatorGuideTargetSources: Readonly<Record<string, string>> = {
  "primary-workspaces": "components/pipeline/PipelineActionNav.tsx",
  "primary-calendar": "components/pipeline/PipelineActionNav.tsx",
  "primary-new-referral": "components/pipeline/PipelineActionNav.tsx",
  "primary-reports": "components/pipeline/PipelineActionNav.tsx",
  "my-queue": "components/pipeline/PipelineWelcome.tsx",
  "workspace-search": "components/pipeline/ReferralHomeDirectory.tsx",
  "workspace-results": "components/pipeline/ReferralWorklist.tsx",
  "calendar-view": "components/pipeline/PipelineCalendarPresentation.tsx",
  "calendar-filters": "components/pipeline/PipelineCalendarPresentation.tsx",
  "initial-packet-upload": "components/pipeline/ReferralDocumentUpload.tsx",
  "intake-identity": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-routing": "components/pipeline/ReferralPacketCanvas.tsx",
  "intake-medications": "components/pipeline/ReferralPacketCanvas.tsx",
  "create-workspace": "components/pipeline/ReferralPacketCanvas.tsx",
  "assessment-stage": "components/pipeline/ReferralPacketCanvas.tsx",
  "assessment-schedule-fields": "components/pipeline/AssessmentSchedulingDialogs.tsx",
  "assessment-schedule-method": "components/pipeline/AssessmentSchedulingDialogs.tsx",
  "assessment-schedule-save": "components/pipeline/AssessmentSchedulingDialogs.tsx",
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
  "assessment-answer": "components/pipeline/AssessmentInterviewFields.tsx",
  "assessment-answer-help": "components/pipeline/AssessmentInterviewFields.tsx",
  "assessment-save-status": "components/pipeline/AssessmentWorkspace.tsx",
  "chart-stage": "components/pipeline/ReferralPacketCanvas.tsx",
  "chart-complete-record": "components/pipeline/AssessmentChartWorkspace.tsx",
  "chart-meet-client-tab": "components/pipeline/ReferralPacketCanvas.tsx",
  "chart-email-handoff": "components/pipeline/AssessmentChartWorkspace.tsx",
  "operations-report-select": "components/pipeline/OperationsDashboard.tsx",
  "operations-summary": "components/pipeline/OperationsDashboard.tsx",
  "operations-report-apply": "components/pipeline/OperationsDashboard.tsx",
  "packet-workspace": "components/pipeline/ReferralPacketCanvas.tsx",
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
