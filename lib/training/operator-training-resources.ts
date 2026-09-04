import type {
  OperatorCapability,
  OperatorJobAid,
  OperatorRole,
  OperatorScenario,
} from "@/lib/training/operator-training-types";

const allRoles = ["admin", "assessment_coordinator", "reviewer", "viewer"] as const;
const writeRoles = ["admin", "assessment_coordinator", "reviewer"] as const;
const intakeRoles = ["admin", "assessment_coordinator"] as const;
const assessmentRoles = ["admin", "reviewer"] as const;
const leadRoles = ["admin", "assessment_coordinator"] as const;

export const operatorScenarios: readonly OperatorScenario[] = [
  scenario("possible-duplicate", "Possible duplicate at intake", "Intake", "critical", "A secure email appears to describe someone already visible in Workspaces, but one identity field disagrees.", ["The name is similar", "DOB conflicts", "The new packet has not been uploaded"], intakeRoles, ["inbound-triage", "duplicates-identity"], [
    choice("Stop creation and route the possible match for identity review", true, "Conflicting identity evidence is a stop condition."),
    choice("Merge with the existing workspace", false, "Name similarity is not enough to establish identity."),
    choice("Create a new workspace without noting the conflict", false, "This hides the collision and increases downstream risk."),
  ], ["Preserve both source contexts", "Do not merge on name", "Make the unresolved identity visible"]),
  scenario("unknown-required-field", "Unknown field during referral creation", "Intake", "important", "The inbound email has no payer value, but the form displays the field near other important demographics.", ["No source document supplies the value", "The referral is otherwise valid"], intakeRoles, ["create-referral", "demographics-source"], [
    choice("Leave the value unknown and create a follow-up action", true, "Unknown is an honest state when evidence is missing."),
    choice("Choose the most common payer", false, "Frequency is not evidence for this referral."),
    choice("Copy the payer from another person from the same source", false, "Another record is never valid evidence."),
  ], ["Do not invent completeness", "Assign missing information", "Update only when source evidence arrives"]),
  scenario("medication-disagreement", "Medication lists disagree", "Packet review", "critical", "The face sheet and signed medication list disagree on a dose.", ["Both documents belong to the referral", "The signed list is newer", "No assessor verification has occurred"], writeRoles, ["medication-intake", "review-extraction"], [
    choice("Preserve the conflict and route it for assessor verification", true, "The system can carry context without making a clinical reconciliation."),
    choice("Approve the newer value without noting the difference", false, "Recency alone does not safely resolve a clinical discrepancy."),
    choice("Delete the older document", false, "Source evidence must remain immutable and available."),
  ], ["Preserve both sources", "Make the conflict explicit", "Do not perform clinical reconciliation during intake"]),
  scenario("extraction-confidence", "High-confidence extraction is wrong", "Packet review", "critical", "A field has 98% confidence but the highlighted source page shows a different value.", ["The source image is legible", "The candidate affects identity"], writeRoles, ["review-extraction"], [
    choice("Correct or reject the candidate using the source page", true, "Human source review controls the approved value."),
    choice("Approve because confidence exceeds the threshold", false, "Confidence is a routing signal, not truth."),
    choice("Ignore the field and approve the rest", false, "A decision-critical conflict must be resolved or explicitly blocked."),
  ], ["Source evidence wins", "Identity fields receive careful review", "Approval is field-specific"]),
  scenario("queued-not-failed", "Extraction is still queued", "Packet processing", "routine", "A newly uploaded packet remains queued for several minutes with no error.", ["Upload completion is visible", "No failed or dead-letter state is present"], writeRoles, ["extraction-status"], [
    choice("Continue monitoring the asynchronous status", true, "Queued is an active processing state."),
    choice("Upload the packet again", false, "Duplicate uploads create avoidable review and storage work."),
    choice("Mark the packet reviewed", false, "Processing and human review have not completed."),
  ], ["Asynchronous work is normal", "Avoid duplicate submissions", "Escalate only from evidence"]),
  scenario("assessment-identity-stop", "Identity cannot be confirmed at assessment", "Assessment", "critical", "The scheduled participant gives a DOB that conflicts with the referral and the packet already contains another unresolved DOB.", ["The assessor is assigned", "The meeting is already in progress"], assessmentRoles, ["assessment-start", "assessment-demographics"], [
    choice("Stop and escalate identity resolution before documenting the assessment", true, "Starting under uncertain identity can contaminate the clinical record."),
    choice("Continue because the assessor is assigned", false, "Assignment does not resolve identity."),
    choice("Choose the DOB stated during the call and continue", false, "A statement during the call does not automatically resolve conflicting source evidence."),
  ], ["Identity is a start gate", "Preserve existing evidence", "Escalate without guessing"]),
  scenario("concurrent-edit", "Another user changed the referral", "Collaboration", "important", "Your save is rejected because a coordinator reassigned the referral while you were editing a note.", ["Their assignment is valid", "Your note is still needed"], writeRoles, ["activity-collaboration", "draft-recovery"], [
    choice("Reload, compare, and reapply only your note", true, "This preserves both users' intended changes."),
    choice("Overwrite the current record with your older copy", false, "That would erase the valid assignment."),
    choice("Create a second referral and add the note there", false, "A conflict never justifies a duplicate governed record."),
  ], ["Conflicts are protective", "Compare before saving", "Reapply the smallest intended change"]),
  scenario("recommendation-authority", "Assessor recommendation is complete", "Decision", "critical", "The assessor signed and recommended acceptance, but the signed-in user is not authorized to record the final decision.", ["No blocking requirement is visible", "The placement is time-sensitive"], assessmentRoles, ["recommendation", "roles-permissions"], [
    choice("Submit the recommendation and hand off to an authorized decision role", true, "Urgency does not remove role separation."),
    choice("Change the stage to Accepted / Admitted", false, "A stage label is not a valid final decision."),
    choice("Use a supervisor's account", false, "Shared credentials destroy accountability."),
  ], ["Recommendation and decision are separate", "Actor authority is recorded", "Urgency does not bypass control"]),
  scenario("missing-move-in", "Accepted but missing admission document", "Admission", "critical", "A referral is accepted, but the signed admission agreement is still missing.", ["The bed is available", "EHR handoff has not started"], leadRoles, ["move-in-requirements", "ehr-handoff"], [
    choice("Keep admission blocked and assign the missing requirement", true, "Acceptance does not satisfy move-in prerequisites."),
    choice("Mark admitted and obtain the signature later", false, "The requirement exists specifically to prevent this shortcut."),
    choice("Remove the requirement from the checklist", false, "Deleting the control does not resolve the underlying need."),
  ], ["Accepted is not admitted", "Requirements remain explicit", "Available capacity does not change documentation rules"]),
  scenario("ehr-failed", "EHR handoff fails", "EHR handoff", "critical", "An accepted referral's handoff changes from queued to failed with a downstream validation reason.", ["The referral remains accepted", "The handoff has not been confirmed sent"], leadRoles, ["ehr-handoff", "processing-failure"], [
    choice("Record the reason, correct the issue, retry once, and verify the final state", true, "The failure history and downstream confirmation both matter."),
    choice("Treat queued as complete", false, "Queued only means work was requested."),
    choice("Create a second referral and export it", false, "Retries must remain idempotent within the governed record."),
  ], ["Queued is not sent", "Preserve failure reason", "Retry from the same governed handoff"]),
  scenario("dashboard-scope", "A supervisor asks for a total", "Reporting", "important", "A dashboard shows 18 referrals after a community filter, while a prior unfiltered report showed 42.", ["Both displays are current", "The selected month is the same"], leadRoles, ["dashboard-meaning", "filter-report-export"], [
    choice("Report 18 for the selected community and state the filter", true, "Scope explains the difference."),
    choice("Report 42 because it is larger", false, "The unfiltered population does not answer the scoped question."),
    choice("Average the two totals", false, "Counts from different scopes cannot be averaged into meaning."),
  ], ["State filters with every total", "Reconcile from underlying rows", "Do not infer clinical meaning"]),
  scenario("unsafe-support", "Report a production problem safely", "Recovery", "important", "A packet preview fails for a real referral and support needs enough detail to reproduce the issue.", ["A request ID is visible", "The source packet contains PHI"], allRoles, ["phi-safe-use", "processing-failure"], [
    choice("Send route, timestamp, request ID, role, and behavior without packet content", true, "Operational diagnostics can be useful without exposing PHI."),
    choice("Attach a full screenshot of the packet", false, "Unapproved support channels must not receive PHI."),
    choice("Paste the extracted clinical text", false, "Raw extracted content is also sensitive."),
  ], ["Use request IDs", "Describe behavior and impact", "Keep packet content out of training and support"]),
];

export const operatorJobAids: readonly OperatorJobAid[] = [
  jobAid("new-referral", "Create a referral safely", "When a genuinely new inbound referral arrives.", intakeRoles, "New referral", "/?view=referrals&screen=packet", "components/pipeline/ReferralPacketCanvas.tsx", ["Search for existing work", "Verify new versus update", "Enter source-backed identity and received date", "Set community, source, priority, and owner", "Save once and verify the workspace"], ["Identity conflict", "Possible duplicate", "No accountable owner"]),
  jobAid("packet-upload", "Upload and review a packet", "When source documents need to be attached and extracted.", writeRoles, "Referral workspace", "/?view=referrals", "components/pipeline/PacketExtractionReview.tsx", ["Verify the referral", "Upload the supported file", "Monitor asynchronous status", "Review candidates against page evidence", "Record missing requirements"], ["Wrong referral", "Malware or unsupported file", "Decision-critical disagreement"]),
  jobAid("assessment-ready", "Prepare an assessment", "Before assigning or scheduling assessment work.", writeRoles, "Referral workspace", "/?view=referrals", "components/pipeline/ReferralWorkflowTracker.tsx", ["Confirm identity", "Confirm packet review", "Confirm medication context", "Resolve or assign blockers", "Assign assessor", "Schedule with owner, time, and method"], ["Unresolved identity", "Missing required source", "No assigned assessor"]),
  jobAid("assessment", "Conduct and sign an assessment", "For the assigned assessor from start through signature.", assessmentRoles, "Assessments", "/assessments", "components/pipeline/AssessmentWorkspace.tsx", ["Confirm identity and assignment", "Verify carried-forward intake", "Complete required sections", "Review validation", "Complete and sign", "Submit recommendation"], ["Identity mismatch", "Missing consent/readiness", "Required section cannot be completed"]),
  jobAid("decision", "Record a final decision", "For authorized decision staff after recommendation review.", leadRoles, "Referral workspace", "/?view=referrals", "components/pipeline/ReferralProgressPanel.tsx", ["Review signed assessment", "Review recommendation", "Review requirements", "Record outcome, reason, and actor", "Resolve move-in requirements"], ["Unsigned assessment", "Unresolved critical requirement", "Unclear decision authority"]),
  jobAid("ehr", "Complete EHR handoff", "After acceptance and admission requirements are complete.", leadRoles, "Operations", "/?screen=operations", "components/pipeline/OperationsDashboard.tsx", ["Confirm accepted/admitted status", "Queue handoff", "Monitor status", "Record failure reason if needed", "Retry safely", "Verify sent/confirmed"], ["Referral not accepted", "Repeated validation failure", "Downstream identity conflict"]),
  jobAid("conflict", "Recover a save conflict", "When another session changed the record before your save.", writeRoles, "Current workspace", "/?view=referrals", "components/pipeline/ReferralPacketCanvas.tsx", ["Stop repeated saves", "Reload current state", "Compare remote and local changes", "Reapply only your intended edit", "Verify both changes remain"], ["Identity or decision changed", "You cannot explain the remote update", "Reapplying would erase evidence"]),
  jobAid("safe-escalation", "Escalate with safe diagnostics", "When processing, access, or downstream behavior needs support.", allRoles, "Home", "/", "components/pipeline/PipelineWelcome.tsx", ["Record route and time", "Capture request ID and visible status", "Describe expected and observed behavior", "State operational impact", "Remove PHI and credentials"], ["Suspected privacy exposure", "Unauthorized access", "Repeated data-integrity failure"]),
];

export const operatorCapabilities: readonly OperatorCapability[] = [
  capability("home", "Home", "Resume recent work and understand the current admissions picture.", "All users", "Home", "/", "components/pipeline/PipelineWelcome.tsx", [], ["workspace", "operations"], ["pipeline-purpose", "navigation-model"]),
  capability("workspace", "Referral workspace", "Coordinate one referral across packet, assessment, decision, and handoff.", "Admissions team", "Workspaces", "/?view=referrals", "components/pipeline/ReferralHome.tsx", ["home", "intake"], ["packet", "assessment", "decision"], ["pipeline-purpose", "create-referral"]),
  capability("intake", "New referral", "Create a source-backed referral shell after duplicate triage.", "Admissions coordinator", "New referral", "/?view=referrals&screen=packet", "components/pipeline/ReferralPacketCanvas.tsx", ["inbound"], ["workspace", "packet"], ["inbound-triage", "create-referral", "medication-intake"]),
  capability("packet", "Packet review", "Attach source documents and approve only evidence-backed extraction candidates.", "Coordinator / reviewer", "Referral workspace", "/?view=referrals", "components/pipeline/PacketExtractionReview.tsx", ["workspace", "blob-worker"], ["readiness"], ["upload-packet", "review-extraction", "packet-completeness"]),
  capability("readiness", "Pre-assessment readiness", "Resolve blockers, ownership, medications, and scheduling before assessment.", "Coordinator", "Referral workspace", "/?view=referrals", "components/pipeline/ReferralWorkflowTracker.tsx", ["packet"], ["calendar", "assessment"], ["preassessment-checklist", "assign-assessor", "schedule-assessment"]),
  capability("calendar", "Calendar", "Coordinate linked assessment schedules by date, owner, and community.", "Admissions team", "Calendar", "/?screen=calendar", "components/pipeline/PipelineCalendar.tsx", ["readiness"], ["assessment"], ["schedule-assessment", "calendar-coordination"]),
  capability("assessment", "Assessment", "Verify intake, document the assessment, sign, and recommend.", "Assessor / reviewer", "Assessments", "/assessments", "components/pipeline/AssessmentWorkspace.tsx", ["readiness", "calendar"], ["decision"], ["assessment-start", "assessment-questionnaire", "assessment-complete-sign", "recommendation"]),
  capability("decision", "Decision and admission", "Authorize outcomes and resolve move-in requirements with an audit trail.", "Authorized lead", "Referral workspace", "/?view=referrals", "components/pipeline/ReferralProgressPanel.tsx", ["assessment"], ["ehr"], ["final-decision", "move-in-requirements"]),
  capability("ehr", "EHR handoff", "Move accepted records to downstream creation and recover transfer failures.", "Operations lead", "Operations", "/?screen=operations", "components/pipeline/OperationsDashboard.tsx", ["decision"], ["downstream-ehr"], ["ehr-handoff", "processing-failure"]),
  capability("profiles", "Client profiles", "View confirmed longitudinal client context without silently matching identity.", "All users", "Clients", "/?screen=profiles", "components/pipeline/ClientProfileDirectory.tsx", ["confirmed-link"], [], ["navigation-model", "duplicates-identity"]),
  capability("operations", "Operations", "Manage queues, exceptions, metrics, reporting, and recovery.", "Supervisor / admin", "Operations", "/?screen=operations", "components/pipeline/OperationsDashboard.tsx", ["workspace", "assessment", "ehr"], ["supervisor-action"], ["dashboard-meaning", "supervisor-exceptions"]),
];

export function scenariosForRole(role: OperatorRole) {
  return operatorScenarios.filter((scenario) => scenario.audiences.includes(role));
}

export function jobAidsForRole(role: OperatorRole) {
  return operatorJobAids.filter((aid) => aid.audiences.includes(role));
}

function scenario(id: string, title: string, domain: string, risk: OperatorScenario["risk"], prompt: string, context: readonly string[], audiences: readonly OperatorRole[], moduleIds: readonly string[], choices: OperatorScenario["choices"], debrief: readonly string[]): OperatorScenario {
  return { id, title, domain, risk, prompt, context, audiences, moduleIds, choices, debrief };
}

function choice(label: string, safe: boolean, rationale: string) {
  return { label, safe, rationale };
}

function jobAid(id: string, title: string, whenToUse: string, audiences: readonly OperatorRole[], locationLabel: string, href: string, source: string, steps: readonly string[], stopAndEscalate: readonly string[]): OperatorJobAid {
  return { id, title, whenToUse, audiences, location: { label: locationLabel, href, source }, steps, stopAndEscalate };
}

function capability(id: string, title: string, purpose: string, owner: string, locationLabel: string, href: string, source: string, upstream: readonly string[], downstream: readonly string[], moduleIds: readonly string[]): OperatorCapability {
  return { id, title, purpose, owner, location: { label: locationLabel, href, source }, upstream, downstream, moduleIds };
}
