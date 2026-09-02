#!/usr/bin/env node

import { loadTypeScriptModule } from "./ts-module-loader.mjs";
import {
  extractImportedClientMetadata,
  formatClientIdentityTitle,
} from "../lib/pipeline/client-identity-presentation.mjs";

const root = process.cwd();

const contracts = loadTypeScriptModule(root, "lib/extraction/contracts.ts");
const assessmentSchema = loadTypeScriptModule(root, "lib/assessment/assessment-tool-schema.ts");
const assessmentInterview = loadTypeScriptModule(root, "lib/assessment/assessment-interview-schema.ts");
const assessmentCompletion = loadTypeScriptModule(root, "lib/assessment/assessment-completion.ts");
const assessmentRecords = loadTypeScriptModule(root, "lib/assessment/assessment-records.ts");
const assessmentValidation = loadTypeScriptModule(root, "lib/assessment/assessment-validation.ts");
const clientUpdateContracts = loadTypeScriptModule(root, "lib/integration/client-update-contracts.ts");
const referralExtractionSchema = loadTypeScriptModule(root, "lib/extraction/referral-intake-schema.ts");
const referralValidation = loadTypeScriptModule(root, "lib/pipeline/referral-validation.ts");
const referralWorkflow = loadTypeScriptModule(root, "lib/pipeline/referral-workflow.ts");
const referralQuery = loadTypeScriptModule(root, "lib/pipeline/referral-query.ts");
const referralCanvasExtraction = loadTypeScriptModule(root, "lib/pipeline/referral-canvas-extraction.ts");
const referralCanvasPersistence = loadTypeScriptModule(root, "lib/pipeline/referral-canvas-persistence.ts");
const referralReview = loadTypeScriptModule(root, "lib/pipeline/referral-review.ts");
const storeAdapter = loadTypeScriptModule(root, "lib/persistence/store-adapter.ts");
const structuredNarrative = loadTypeScriptModule(root, "lib/pipeline/structured-narrative.ts");
const residentLinkValidation = loadTypeScriptModule(root, "lib/pipeline/resident-link-validation.ts");
const referralAccess = loadTypeScriptModule(root, "lib/pipeline/referral-access.ts");
const requestSecurity = loadRequestSecurityModule({});
const workspaceStateTypes = loadTypeScriptModule(root, "lib/pipeline/user-workspace-state-types.ts");
const workspacePresentation = loadTypeScriptModule(root, "lib/pipeline/workspace-presentation.ts");
const assessmentCalendar = loadTypeScriptModule(root, "lib/pipeline/assessment-calendar.ts");
const assessmentAccess = loadTypeScriptModule(root, "lib/assessment/assessment-access.ts");
const assessmentLifecycle = loadTypeScriptModule(root, "lib/assessment/assessment-lifecycle-validation.ts");

const results = [
  run("imported client identity keeps county metadata out of the person name", () => {
    const importedName = "Xin Quan Lin - - San Francisco";
    assert(
      formatClientIdentityTitle({ name: importedName }) === "Xin Lin",
      "Imported workspace metadata must not be displayed as part of the client name",
    );
    assert(
      extractImportedClientMetadata(importedName) === "San Francisco",
      "Imported workspace metadata must remain available as county evidence",
    );
    for (const [source, expected] of [
      ["IRVIN AVILA (PSH) 09/03", "IRVIN AVILA"],
      ["Aaron Sanderling 11/19", "Aaron Sanderling"],
      ["Natalee Atwood-1/17/2025", "Natalee Atwood"],
      ["Yesenia Brambila-1/22/2026- Crestwood Manor Modesto", "Yesenia Brambila"],
      ["Hunter Slatten - 6/5/25 - Merced", "Hunter Slatten"],
      ["Dawn Major-7/15/2025 Santa Clara", "Dawn Major"],
      ["Christopher Abel-Jones", "Christopher Abel-Jones"],
      ["Jordan Sample (Jr)", "Jordan Sample"],
      ["Zachary Laman- WL", "Zachary Laman"],
      ["Zachary Laman- LA JAIL", "Zachary Laman"],
      ["Yuri Kawaakoa- -Monterey County", "Yuri Kawaakoa"],
      ["Yvonne", "Yvonne"],
    ]) {
      assert(
        formatClientIdentityTitle({ name: source }) === expected,
        `Expected imported client title '${source}' to render as '${expected}'`,
      );
    }
  }),
  run("assessment work is limited to the assigned assessor or a supervisor", () => {
    const assigned = { id: "assessor-1", email: "assessor@example.com", name: "Assigned Assessor", roles: ["reviewer"] };
    const otherAssessor = { id: "assessor-2", email: "other@example.com", name: "Other Assessor", roles: ["reviewer"] };
    const supervisor = { id: "supervisor-1", email: "supervisor@example.com", name: "Supervisor", roles: ["assessment_coordinator", "reviewer"] };
    assert(assessmentAccess.canWorkAssessment(assigned, "assessor-1"), "The assigned assessor should be able to work the assessment");
    assert(!assessmentAccess.canWorkAssessment(otherAssessor, "assessor-1"), "Another assessor must remain blocked");
    assert(assessmentAccess.canWorkAssessment(supervisor, "assessor-1"), "A supervisor should be able to assist without reassignment");
    assert(!assessmentAccess.isAssessmentSupervisor(assigned), "A reviewer must not receive supervisor conflict overrides");
    assert(assessmentAccess.isAssessmentSupervisor(supervisor), "The assessment coordinator must receive supervisor controls");
  }),
  run("supervisor assessment access does not overwrite an existing referral assignment", () => {
    const supervisor = { id: "supervisor-1", email: "supervisor@example.com", name: "Supervisor", roles: ["assessment_coordinator", "reviewer"] };
    const assigned = assessmentAccess.assessmentAssigneeForReferral(supervisor, {
      id: 1,
      owner: "Assigned Assessor",
      ownerId: "assessor-1",
    });
    const unassigned = assessmentAccess.assessmentAssigneeForReferral(supervisor, {
      id: 2,
      owner: "Unassigned",
    });
    assert(assigned?.id === "assessor-1", "The referral assignment must remain the assessment assignment");
    assert(unassigned?.id === "supervisor-1", "A supervisor should be able to start an otherwise unassigned assessment");
  }),
  run("calendar uses explicit scheduling and canonical referral assignment", () => {
    const event = assessmentCalendar.assessmentCalendarEvent({
      assessment_id: "assessment-1",
      referral_id: 41,
      scheduled_start_at: "2026-08-25T16:00:00.000Z",
      schedule_status: "scheduled",
      assessor_id: "assessor-1",
      assessor: "Assigned Assessor",
      status: "draft",
    }, {
      id: 41,
      name: "Calendar Client",
      community: "San Pablo",
      ownerId: "referral-owner",
      owner: "Referral Owner",
    }, "2026-08-23");
    assert(event?.kind === "assessment", "Expected an assessment event");
    assert(event?.ownerId === "referral-owner" && event?.owner === "Referral Owner", "Expected the referral assignment to own the event");
    assert(event?.status === "draft" && event?.title === "Assessment scheduled", "Expected scheduled draft status");
  }),
  run("calendar creates a referral assignment event with creation context", () => {
    const event = assessmentCalendar.referralAssignmentCalendarEvent({
      id: 40,
      name: "New Referral",
      community: "San Pablo",
      ownerId: "assessor-1",
      owner: "Assigned Assessor",
      assignedAt: "2026-08-25T03:30:00.000Z",
      assignmentVersion: 2,
      createdAt: "2026-08-23T18:00:00.000Z",
      date: "08/22/2026",
      workspaceOrigin: "pipeline",
      workspaceStatus: "active",
    });
    assert(event?.id === "referral-assigned:40:2", "Expected assignment-version event identity");
    assert(event?.date === "2026-08-24", "Expected the assignment day in the Pacific operating timezone");
    assert(event?.createdDate === "2026-08-23", "Expected the original creation date on the event");
    assert(event?.receivedDate === "2026-08-22", "Expected the received date on the event");
    assert(event?.ownerId === "assessor-1" && event?.kind === "referral_assigned", "Expected an assessor-scoped assignment event");
  }),
  run("calendar does not expose unassigned or imported historical work as assignments", () => {
    const base = {
      id: 40,
      name: "New Referral",
      community: "San Pablo",
      owner: "Unassigned",
      assignedAt: "2026-08-25T16:00:00.000Z",
      createdAt: "2026-08-23T18:00:00.000Z",
      date: "08/22/2026",
      workspaceStatus: "active",
    };
    assert(assessmentCalendar.referralAssignmentCalendarEvent({ ...base, workspaceOrigin: "pipeline" }) === null, "Unassigned work must not create an assignment event");
    assert(assessmentCalendar.referralAssignmentCalendarEvent({ ...base, ownerId: "assessor-1", workspaceOrigin: "historical_import" }) === null, "Historical imports must not create live assignment events");
  }),
  run("calendar marks unfinished past assessments overdue", () => {
    const event = assessmentCalendar.assessmentCalendarEvent({
      assessment_id: "assessment-2",
      referral_id: 42,
      scheduled_start_at: "2026-08-20T16:00:00.000Z",
      schedule_status: "scheduled",
      assessor_id: null,
      assessor: null,
      status: "draft",
    }, {
      id: 42,
      name: "Overdue Client",
      community: "Turlock",
      owner: "Unassigned",
    }, "2026-08-23");
    assert(event?.status === "overdue" && event?.title === "Assessment overdue", "Expected overdue status");
  }),
  run("calendar includes only assessment-gated open follow-ups", () => {
    const base = {
      id: 43,
      name: "Follow-up Client",
      community: "Santa Clarita",
      owner: "Assessor",
      ownerId: "assessor-1",
      stage: "Assessment",
    };
    const requirements = [
      { id: "pre", label: "Face sheet", status: "needed", requiredFor: "pre_assessment", owner: "Assessor", ownerId: "assessor-1", dueAt: "2026-08-24" },
      { id: "move", label: "TB result", status: "needed", requiredFor: "move_in", owner: "Assessor", ownerId: "assessor-1", dueAt: "2026-08-24" },
      { id: "done", label: "Provider form", status: "reviewed", requiredFor: "pre_assessment", owner: "Assessor", ownerId: "assessor-1", dueAt: "2026-08-24" },
    ];
    const events = assessmentCalendar.assessmentFollowUpEvents({ ...base, requirements }, "2026-08-23");
    assert(events.length === 1 && events[0].id === "follow-up:pre", "Expected only the open assessment-gated follow-up");
    assert(assessmentCalendar.assessmentFollowUpEvents({ ...base, stage: "Accepted / Admitted", requirements }, "2026-08-23").length === 0, "Closed workspaces must not produce follow-ups");
  }),
  run("calendar date stepping is exact and unscheduled work is explicit", () => {
    assert(assessmentCalendar.addCalendarDays("2026-08-23", 1) === "2026-08-24", "Expected a one-day calendar step");
    assert(assessmentCalendar.addCalendarDays("2026-08-23", 7) === "2026-08-30", "Expected a seven-day calendar step");
    const item = assessmentCalendar.assessmentPreparationItem({
      id: 44,
      name: "Needs Scheduling",
      community: "San Pablo",
      owner: "Assessor",
      ownerId: "assessor-1",
      date: "2026-08-22",
      createdAt: "2026-08-22T12:00:00.000Z",
      stage: "New",
      workspaceOrigin: "pipeline",
      workflowStatus: "ready_to_schedule",
    }, null);
    assert(item?.referralId === 44, "Expected a Pipeline referral without an assessment to need scheduling");
    assert(item?.nextAction === "schedule", "Ready referrals must expose a scheduling action");
    const blocked = assessmentCalendar.assessmentPreparationItem({ ...item, id: 45, name: "Needs Documents", date: "2026-08-22", createdAt: "2026-08-22T12:00:00.000Z", stage: "New", workspaceOrigin: "pipeline", workflowStatus: "intake_documents_needed" }, null);
    assert(blocked?.workflowStatus === "intake_documents_needed", "Expected blocked intake work to remain visible before scheduling");
    assert(blocked?.nextAction === "complete_intake", "Blocked intake work must route back to intake");
    assert(assessmentCalendar.assessmentPreparationItem({ ...item, id: 44, name: "Needs Scheduling", date: "2026-08-22", createdAt: "2026-08-22T12:00:00.000Z", stage: "New", workspaceOrigin: "allo" }, null) === null, "Imported historical work must not enter the scheduling queue");
  }),
  run("calendar consolidates related follow-ups without hiding their labels", () => {
    const consolidated = assessmentCalendar.consolidateCalendarFollowUps([{
      id: "follow-up:one",
      referralId: 50,
      clientName: "Follow-up Client",
      community: "Turlock",
      ownerId: "assessor-1",
      owner: "Assessor",
      date: "2026-08-24",
      kind: "follow_up",
      status: "due",
      title: "Face sheet",
      detail: "Due",
    }, {
      id: "follow-up:two",
      referralId: 50,
      clientName: "Follow-up Client",
      community: "Turlock",
      ownerId: "assessor-1",
      owner: "Assessor",
      date: "2026-08-24",
      kind: "follow_up",
      status: "overdue",
      title: "Medication list",
      detail: "Overdue",
    }]);
    assert(consolidated.length === 1, "Related follow-ups should occupy one calendar row");
    assert(consolidated[0].followUpCount === 2, "The consolidated event must preserve its count");
    assert(consolidated[0].followUpLabels.join(",") === "Face sheet,Medication list", "The consolidated event must preserve each source label");
    assert(consolidated[0].status === "overdue", "Any overdue source must keep the consolidated event overdue");
  }),
  run("schedule commands require an explicit boolean conflict override", () => {
    const base = {
      if_match: 2,
      client_mutation_id: "fixture-calendar-schedule",
      schedule: {
        status: "scheduled",
        start_at: "2026-08-25T16:00:00.000Z",
        duration_minutes: 60,
        method: "zoom",
        location: "https://zoom.us/j/fixture",
      },
    };
    const allowed = assessmentLifecycle.validateAssessmentScheduleCommand({ ...base, allow_conflict: true });
    assert(allowed.ok && allowed.value.allow_conflict === true, "A valid explicit override must survive validation");
    const invalid = assessmentLifecycle.validateAssessmentScheduleCommand({ ...base, allow_conflict: "yes" });
    assert(!invalid.ok && invalid.message === "allow_conflict must be a boolean.", "String conflict overrides must be rejected");
  }),
  run("create upload rejects missing body", () => {
    const result = contracts.validateCreateUploadUrlRequest(null);
    assertInvalid(result, "Invalid JSON body.");
  }),
  run("create upload rejects invalid source type", () => {
    const result = contracts.validateCreateUploadUrlRequest({
      referral_id: "1",
      submitting_facility: "County General ED",
      source_type: "sms",
      files: [validFile()],
    });
    assertInvalid(result, "source_type must be fax, email, portal, or manual.");
  }),
  run("create upload requires a numeric referral identity", () => {
    const result = contracts.validateCreateUploadUrlRequest({
      referral_id: "ref_001",
      submitting_facility: "County General ED",
      source_type: "fax",
      files: [validFile()],
    });
    assertInvalid(result, "referral_id must be a positive integer.");
  }),
  run("create upload rejects empty files", () => {
    const result = contracts.validateCreateUploadUrlRequest({
      referral_id: "1",
      submitting_facility: "County General ED",
      source_type: "fax",
      files: [],
    });
    assertInvalid(result, "At least one file descriptor is required.");
  }),
  run("create upload rejects oversized files", () => {
    const result = contracts.validateCreateUploadUrlRequest({
      referral_id: "1",
      submitting_facility: "County General ED",
      source_type: "fax",
      files: [{ ...validFile(), size: 101 * 1024 * 1024 }],
    });
    assertInvalid(result, "Each file must be 100 MB or smaller.", 413);
  }),
  run("create upload rejects too many files and duplicate file ids", () => {
    assertInvalid(
      contracts.validateCreateUploadUrlRequest({
        referral_id: "1",
        submitting_facility: "County General ED",
        source_type: "fax",
        files: Array.from({ length: 26 }, (_, index) => ({
          ...validFile(),
          file_id: `file_${index}`,
        })),
      }),
      "At most 25 files can be requested at once.",
      413,
    );
    assertInvalid(
      contracts.validateCreateUploadUrlRequest({
        referral_id: "1",
        submitting_facility: "County General ED",
        source_type: "fax",
        files: [validFile(), validFile()],
      }),
      "file_id values must be unique within the request.",
    );
  }),
  run("create upload rejects unsupported file types and huge reservations", () => {
    assertInvalid(
      contracts.validateCreateUploadUrlRequest({
        referral_id: "1",
        submitting_facility: "County General ED",
        source_type: "fax",
        files: [{ ...validFile(), content_type: "text/plain" }],
      }),
      "Unsupported file type. Upload PDF, JPEG, PNG, TIFF, or HEIC packets only.",
      415,
    );
    assertInvalid(
      contracts.validateCreateUploadUrlRequest({
        referral_id: "1",
        submitting_facility: "County General ED",
        source_type: "fax",
        files: Array.from({ length: 11 }, (_, index) => ({
          ...validFile(),
          file_id: `large_${index}`,
          size: 100 * 1024 * 1024,
        })),
      }),
      "Upload requests can reserve at most 1 GB at a time.",
      413,
    );
  }),
  run("create upload accepts valid descriptors", () => {
    const result = contracts.validateCreateUploadUrlRequest({
      referral_id: "1",
      submitting_facility: "County General ED",
      source_type: "fax",
      files: [validFile()],
    });
    assertValid(result);
    assert(result.value.files.length === 1, "Expected one validated file");
  }),
  run("supporting documents use the explicit preview-only intent", () => {
    const valid = contracts.validateCreateUploadUrlRequest({
      referral_id: "1",
      submitting_facility: "San Pablo",
      source_type: "manual",
      processing_intent: "preview_only",
      files: [{ ...validFile(), category: "tb_test" }],
    });
    assertValid(valid);
    assert(valid.value.processing_intent === "preview_only", "Expected preview-only processing");
    assertInvalid(
      contracts.validateCreateUploadUrlRequest({
        referral_id: "1",
        submitting_facility: "San Pablo",
        source_type: "manual",
        processing_intent: "guess",
        files: [validFile()],
      }),
      "processing_intent must be extract_referral or preview_only.",
    );
  }),
  run("complete upload requires packet and file ids", () => {
    assertInvalid(
      contracts.validateCompleteUploadRequest({ packet_id: "", uploaded_file_ids: [] }),
      "packet_id is required.",
    );
    assertInvalid(
      contracts.validateCompleteUploadRequest({ packet_id: "pkt_001", uploaded_file_ids: [""] }),
      "uploaded_file_ids must include at least one file id.",
    );
    assertInvalid(
      contracts.validateCompleteUploadRequest({
        packet_id: "pkt_001",
        uploaded_file_ids: ["file_001", "file_001"],
      }),
      "uploaded_file_ids must not contain duplicates.",
    );
  }),
  run("review field validates action and edit value", () => {
    assertInvalid(
      contracts.validateReviewFieldRequest({ if_match: 1, action: "approve" }),
      "action must be accept, edit, or reject.",
    );
    assertInvalid(
      contracts.validateReviewFieldRequest({ if_match: 1, action: "edit" }),
      "value is required when action is edit.",
    );
    assertInvalid(
      contracts.validateReviewFieldRequest({ action: "accept" }),
      "if_match must be a positive field version number.",
    );
    assertValid(contracts.validateReviewFieldRequest({ if_match: 1, action: "accept" }));
    assertValid(contracts.validateReviewFieldRequest({ if_match: 2, action: "edit", value: "San Pablo" }));
  }),
  run("retry field validates force flag", () => {
    assertInvalid(
      contracts.validateRetryFieldRequest({ force_claude: "yes" }),
      "force_claude must be true or false.",
    );
    assertValid(contracts.validateRetryFieldRequest({}));
    assertValid(contracts.validateRetryFieldRequest({ force_claude: true }));
  }),
  run("route params decode safely", () => {
    assert(
      contracts.decodeRouteParam("clinical%20summary") === "clinical summary",
      "Expected decoded field key",
    );
    assert(contracts.decodeRouteParam("%E0%A4%A") === "", "Bad escapes should downshift safely");
  }),
  run("referral list query accepts bounded server filters", () => {
    const result = referralQuery.parseReferralListQuery(new URLSearchParams({
      q: "San Pablo",
      community: "San Pablo",
      county: "Los Angeles County",
      stage: "Assessment",
      priority: "high",
      month: "2026-08",
      active: "true",
      workspace: "all",
      sort: "community_asc",
      limit: "100",
    }));
    assertValid(result);
    assert(result.value.activeOnly === true, "Expected active-only filter");
    assert(result.value.community === "San Pablo", "Expected community filter");
    assert(result.value.county === "Los Angeles County", "Expected county filter");
    assert(result.value.workspaceStatus === "all", "Expected historical workspaces to be explicitly selectable");
    assert(result.value.sort === "community_asc", "Expected the requested server sort");
  }),
  run("referral list query rejects unsafe pagination and filters", () => {
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ cursor: "-1" })), "cursor is invalid.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ limit: "500" })), "limit must be a whole number between 1 and 200.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ stage: "Anything" })), "stage is invalid.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ workspace: "anything" })), "workspace is invalid.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ sort: "anything" })), "sort is invalid.");
  }),
  run("referral list query preserves safe defaults and boundaries", () => {
    const defaults = referralQuery.parseReferralListQuery(new URLSearchParams());
    assertValid(defaults);
    assert(defaults.value.query === "", "Expected an empty default query");
    assert(defaults.value.sort === "updated_desc", "Expected the default updated sort");
    assert(defaults.value.workspaceStatus === "active", "Expected active workspaces by default");
    assert(defaults.value.activeOnly === false, "Expected closed stages to remain visible unless requested");
    assert(defaults.value.limit === undefined, "Expected the store to choose the default page size");

    const boundaries = referralQuery.parseReferralListQuery(new URLSearchParams({
      q: "x".repeat(200),
      owner: "o".repeat(200),
      tag: "tag_name-1.2",
      limit: "200",
      active: "",
      workspace: "archived",
      queue: "decision",
      month: "2026-12",
    }));
    assertValid(boundaries);
    assert(boundaries.value.activeOnly === false, "An empty active filter must remain equivalent to false");
    assert(boundaries.value.workspaceStatus === "archived", "Expected explicit archived workspace filtering");
    assert(boundaries.value.queue === "decision", "Expected a recognized queue filter");
  }),
  run("referral list query rejects every malformed constrained filter", () => {
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ q: "x".repeat(201) })), "q must be 200 characters or fewer.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ owner: "o".repeat(201) })), "owner is invalid.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ priority: "critical" })), "priority is invalid.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ tag: "unsafe/tag" })), "tag is invalid.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ month: "2026-13" })), "month must use YYYY-MM.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ active: "1" })), "active must be true or false.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ queue: "everything" })), "queue is invalid.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ community: "Unknown" })), "community is invalid.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ county: "Los Angeles/County" })), "county is invalid.");
    assertInvalid(referralQuery.parseReferralListQuery(new URLSearchParams({ limit: "1.5" })), "limit must be a whole number between 1 and 200.");
  }),
  run("workspace outcomes use governed admission history for imported workspaces", () => {
    const base = {
      stage: "Packet Review",
      workspaceStatus: "historical",
      admissionDate: "",
    };
    const unmatched = workspacePresentation.getWorkspaceAdmissionOutcome(base);
    assert(unmatched.status === "unmatched", "Imported workspaces without a census match must not be presented as denied");
    assert(unmatched.evidence === "no_census_match", "The absence of a census match must remain visible");
    const admitted = workspacePresentation.getWorkspaceAdmissionOutcome({ ...base, admissionDate: "2024-01-15" });
    assert(admitted.status === "admitted", "Recorded client admission history must count as admitted");
    assert(admitted.evidence === "census_match", "Admission history evidence must remain explicit");
    const declined = workspacePresentation.getWorkspaceAdmissionOutcome({
      ...base,
      workspaceStatus: "active",
      stage: "Declined",
      admissionDecision: { outcome: "declined" },
    });
    assert(declined.status === "denied", "An explicit active-workspace decline must remain denied");
    assert(declined.evidence === "recorded", "A recorded decline must remain distinguishable from a missing census match");
    const stageOnlyDecline = workspacePresentation.getWorkspaceAdmissionOutcome({
      ...base,
      workspaceStatus: "active",
      stage: "Declined",
    });
    assert(stageOnlyDecline.status === "pending", "A stage label alone must not invent a declined decision");
    const acceptedReferralWithoutCensus = {
      ...base,
      workspaceStatus: "active",
      stage: "Accepted / Admitted",
    };
    const acceptedWithoutCensus = workspacePresentation.getWorkspaceAdmissionOutcome(acceptedReferralWithoutCensus);
    assert(acceptedWithoutCensus.status === "pending", "An accepted stage must not invent a governed admission match");
    const recordedAcceptance = workspacePresentation.getWorkspaceAdmissionOutcome({
      ...acceptedReferralWithoutCensus,
      admissionDecision: { outcome: "accepted" },
    });
    assert(recordedAcceptance.status === "accepted", "A recorded acceptance must remain distinct from a governed admission match");
    const supervisorConfirmedAdmission = workspacePresentation.getWorkspaceAdmissionOutcome({
      ...acceptedReferralWithoutCensus,
      admissionDecision: { outcome: "accepted", reasonCode: "supervisor_confirmed_admission" },
    });
    assert(supervisorConfirmedAdmission.status === "admitted", "An explicit supervisor admission confirmation must close the unmatched admission gap");
    assert(supervisorConfirmedAdmission.evidence === "recorded", "A supervisor confirmation must not be presented as a census match");
    assert(
      workspacePresentation.getWorkspaceCounty({ county: "Los Angeles County", community: "San Pablo" }) === "Los Angeles County",
      "A first-class county must take precedence over the destination community",
    );
    assert(
      workspacePresentation.getWorkspaceCounty({ sourceProjectName: "Contra Costa County referrals" }) === "Contra Costa County",
      "Recorded source metadata should recover a county for imported workspaces",
    );
    assert(
      workspacePresentation.getWorkspaceCounty({ name: "Xin Quan Lin - - San Francisco" }) === "San Francisco County",
      "An imported title suffix should populate the county column without remaining in the client name",
    );
  }),
  run("canvas extraction fills reviewed values without replacing active edits", () => {
    const fields = emptyCanvasFields();
    fields.summary.value = "Manual summary";
    const extracted = [
      extractedCanvasField("referral.first_name", "Avery", "accepted"),
      extractedCanvasField("referral.last_name", "Example", "edited"),
      extractedCanvasField("referral.packet_summary", "Extracted summary", "accepted"),
      extractedCanvasField("referral.date_of_birth", "1982-05-14", "accepted"),
    ];
    const result = referralCanvasExtraction.populateFormFromExtraction(
      fields,
      extracted,
      "packet.pdf",
      new Set(["dob"]),
    );
    assert(result.name.value === "Avery Example", "Reviewed first and last names should compose a full name");
    assert(result.name.sourceFile === "packet.pdf", "Populated fields should retain source provenance");
    assert(result.summary.value === "Manual summary", "Extraction must not overwrite an unconfirmed manual value");
    assert(result.dob.value === "", "Extraction must not overwrite a field being edited locally");
  }),
  run("canvas extraction requires explicit override before replacing manual chart data", () => {
    const fields = emptyCanvasFields();
    fields.referent.value = "Manual source";
    const extracted = [extractedCanvasField("referral.source", "County Behavioral Health", "accepted")];
    const preserved = referralCanvasExtraction.populateFormFromExtraction(fields, extracted, "packet.pdf");
    assert(preserved === fields, "A no-op extraction should preserve object identity");
    const replaced = referralCanvasExtraction.populateFormFromExtraction(
      fields,
      extracted,
      "packet.pdf",
      new Set(),
      new Set(["referent"]),
    );
    assert(replaced.referent.value === "County Behavioral Health", "A reviewed manual override should apply explicitly");
  }),
  run("canvas persistence maps every visible chart field to the referral record", () => {
    const fields = emptyCanvasFields();
    for (const key of referralCanvasPersistence.persistedCanvasFieldKeys) {
      fields[key] = { ...fields[key], value: `value-${key}`, sourceFile: "packet.pdf" };
    }
    const patch = referralCanvasPersistence.buildReferralCanvasPatch({
      keys: new Set(referralCanvasPersistence.persistedCanvasFieldKeys),
      fields,
      conserved: "",
      tags: [],
      requirements: [],
    });
    const expected = {
      name: "value-name",
      gender: "value-gender",
      reportedAge: "value-age",
      dob: "value-dob",
      ssn: "value-ssn",
      owner: "value-owner",
      date: "value-referralReceived",
      admissionDate: "value-admissionDate",
      community: "value-community",
      county: "value-county",
      source: "value-referent",
      responsiblePerson: "value-responsiblePerson",
      note: "value-summary",
      currentMedications: "value-currentMedications",
    };
    for (const [key, value] of Object.entries(expected)) {
      assert(patch[key] === value, `Canvas field mapping did not persist ${key}`);
    }
    assert(
      Object.keys(patch.fieldSources).length === referralCanvasPersistence.persistedCanvasFieldKeys.length,
      "Every persisted chart field should retain source provenance",
    );
  }),
  run("new referral construction uses the same complete canvas persistence contract", () => {
    const fields = emptyCanvasFields();
    Object.assign(fields.name, { value: " Avery Example " });
    Object.assign(fields.owner, { value: " Eric Wilson " });
    Object.assign(fields.referralReceived, { value: "2026-08-22" });
    Object.assign(fields.referent, { value: " County intake " });
    Object.assign(fields.summary, { value: " Summary " });
    Object.assign(fields.currentMedications, { value: " Olanzapine 10 mg\nMetformin 500 mg " });
    Object.assign(fields.dob, { value: "1982-05-14" });
    Object.assign(fields.age, { value: "44" });
    const created = referralCanvasPersistence.buildReferralCanvasCreateInput({
      fields,
      conserved: "yes",
      community: "San Pablo",
      tags: ["manual-entry"],
      requirements: [],
      createdAt: "2026-08-22T12:00:00.000Z",
      document: { name: "packet.pdf", size: 2048, hash: "abc123" },
    });
    assert(created.name === "Avery Example", "Create should trim the chart identity");
    assert(created.owner === "Eric Wilson", "Create should persist the assigned owner");
    assert(created.source === "County intake", "Create should persist the referral source");
    assert(created.note === "Summary", "Create should persist the summary");
    assert(created.currentMedications === "Olanzapine 10 mg\nMetformin 500 mg", "Create should persist pre-assessment medications");
    assert(created.reportedAge === "44", "Create should persist reported age separately from DOB");
    assert(created.documentHash === "abc123", "Create should preserve packet identity");
    assert(created.conserved === "yes", "Create should persist conservatorship selection");
  }),
  run("structured chart narratives survive a serialize and parse round trip", () => {
    const sections = structuredNarrative.structuredNarrativeSections.summary;
    const values = {
      reason: "County referral after an acute episode.",
      presentation: "Calm, oriented, and participating in review.",
      concerns: "Recent safety concern requires follow-up.",
      strengths: "Engaged family and clear housing goals.",
      placement: "Needs this level of structured support.",
      additional: "Interpreter requested for meetings.",
    };
    const serialized = structuredNarrative.serializeStructuredNarrative(sections, values);
    const parsed = structuredNarrative.parseStructuredNarrative(serialized, sections);
    assert(
      sections.every((section) => parsed[section.key] === values[section.key]),
      "Structured narrative sections must round-trip without data loss",
    );
  }),
  run("legacy free text remains visible in the structured narrative editor", () => {
    const sections = structuredNarrative.structuredNarrativeSections.interview;
    const legacy = "Legacy interview detail that predates the structured editor.";
    const parsed = structuredNarrative.parseStructuredNarrative(legacy, sections);
    assert(
      parsed[sections.at(-1).key] === legacy,
      "Unstructured legacy text should be preserved in the final catch-all section",
    );
  }),
  run("partial structured narratives preserve every recognized section", () => {
    const sections = structuredNarrative.structuredNarrativeSections.summary;
    const partial = "## Reason for referral\nUrgent county referral.\n\n## Additional context\nFamily will provide records.";
    const parsed = structuredNarrative.parseStructuredNarrative(partial, sections);
    assert(parsed.reason === "Urgent county referral.", "The first recognized section should remain intact");
    assert(parsed.additional === "Family will provide records.", "The final recognized section should remain intact");
    assert(parsed.presentation === "", "Missing sections should stay explicitly empty");
  }),
  run("review completion treats whitespace as missing and aggregates by section", () => {
    const sections = [
      {
        label: "Identity",
        items: [
          referralReview.reviewField("Client name", "Avery Example", 1),
          referralReview.reviewField("Date of birth", "   ", 1),
        ],
      },
      {
        label: "Assessment",
        items: [referralReview.reviewField("Assessment data", "Reviewed", 4)],
      },
    ];
    const summary = referralReview.summarizeReviewSections(sections);
    assert(summary.complete === 2, "Two review values should be complete");
    assert(summary.total === 3, "All review values should be counted");
    assert(summary.percent === 67, "Completion should use rounded whole percentages");
    assert(summary.sections[0].complete === 1, "Section completion should match the overall rules");
  }),
  run("an empty review has a stable zero percent result", () => {
    const summary = referralReview.summarizeReviewSections([]);
    assert(summary.complete === 0 && summary.total === 0, "Empty reviews should have zero counts");
    assert(summary.percent === 0, "Empty reviews should not divide by zero");
  }),
  run("durable store selection honors explicit modes and database fallback", () => {
    assert(
      storeAdapter.resolveDurableStoreMode({ configuredModes: ["postgres"] }) === "postgres",
      "Explicit PostgreSQL mode should select the durable adapter",
    );
    assert(
      storeAdapter.resolveDurableStoreMode({ configuredModes: ["external"] }) === "postgres",
      "The legacy external mode should remain PostgreSQL-compatible",
    );
    assert(
      storeAdapter.resolveDurableStoreMode({ configuredModes: [], databaseMode: "postgres" }) === "postgres",
      "Database mode should provide the unconfigured fallback",
    );
    assert(
      storeAdapter.resolveDurableStoreMode({ configuredModes: ["local_file"], databaseMode: "postgres" }) === "local_file",
      "An explicit local test mode should override the database fallback",
    );
  }),
  run("durable store adapters are selected without invoking the inactive backend", () => {
    const local = { name: "local" };
    const postgres = { name: "postgres" };
    const adapters = { local_file: local, postgres };
    assert(storeAdapter.selectStoreAdapter("local_file", adapters) === local, "Expected local adapter identity");
    assert(storeAdapter.selectStoreAdapter("postgres", adapters) === postgres, "Expected PostgreSQL adapter identity");
  }),
  ...authBehaviorResults(),
  ...backendBehaviorResults(),
  ...mockStoreBehaviorResults(),
  ...referralHardeningResults(),
  ...assessmentSchemaResults(),
  ...assessmentValidationResults(),
  ...canonicalClientIntegrationResults(),
  ...residentLinkValidationResults(),
  ...workspaceStateValidationResults(),
];

const failed = results.filter((result) => !result.ok);

console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      checked_at: new Date().toISOString(),
      checks: results,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exit(1);
}

function authBehaviorResults() {
  return [
    run("auth defaults to mock in local development", () => {
      const auth = loadAuthModule({ NODE_ENV: "development" });
      const user = auth.getPipelineUserFromHeaders(new Headers());
      assert(user?.email === "demo@pipeline.local", "Expected local mock user");
      assert(
        user.roles.includes("assessment_coordinator"),
        "Expected local mock user to support intake uploads",
      );
    }),
    run("auth defaults to Entra JWT in production", () => {
      const auth = loadAuthModule({ NODE_ENV: "production" });
      assert(auth.getPipelineAuthMode() === "entra_jwt", "Expected production Entra JWT mode");
      assert(auth.getPipelineUserFromHeaders(new Headers()) === null, "No header should be anonymous");
    }),
    run("auth refuses disabled mode in production", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "disabled",
      });
      assert(auth.getPipelineAuthMode() === "entra_jwt", "Production disabled mode must fail closed through Entra JWT");
    }),
    run("auth parses gateway email and roles", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
        PIPELINE_ALLOW_UNVERIFIED_AUTH_HEADERS: "true",
        PIPELINE_ALLOWED_EMAILS: "reviewer@example.com",
        PIPELINE_REVIEWER_EMAILS: "reviewer@example.com",
      });
      const user = auth.getPipelineUserFromHeaders(
        new Headers({ "x-pipeline-user-email": "Reviewer@Example.com" }),
      );
      assert(user?.email === "Reviewer@Example.com", "Expected header email to pass through");
      assert(user.roles.includes("reviewer"), "Expected reviewer role");
    }),
    run("auth rejects missing production identity", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
      });
      const result = auth.requirePipelineUser(new Request("https://pipeline.local/referrals"));
      assert(!result.ok, "Missing identity should fail");
      assert(result.response.status === 401, "Missing identity should return 401");
    }),
    run("auth rejects users outside allowlist", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
        PIPELINE_ALLOW_UNVERIFIED_AUTH_HEADERS: "true",
        PIPELINE_ALLOWED_EMAILS: "allowed@example.com",
      });
      const result = auth.requirePipelineUser(
        new Request("https://pipeline.local/referrals", {
          headers: { "x-pipeline-user-email": "blocked@example.com" },
        }),
      );
      assert(!result.ok, "Unallowed user should fail");
      assert(result.response.status === 403, "Unallowed user should return 403");
    }),
    run("auth accepts an assigned Entra object across email aliases", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
        PIPELINE_ALLOWED_ENTRA_OBJECT_IDS: "entra-user-stable",
      });
      const principal = btoa(JSON.stringify({
        userId: "ENTRA-USER-STABLE",
        userDetails: "unexpected-alias@example.com",
        claims: [{ typ: "roles", val: "Pipeline.Admin" }],
      }));
      const result = auth.requirePipelineUser(new Request("https://pipeline.local/referrals", {
        headers: { "x-ms-client-principal": principal },
      }));
      assert(result.ok, "Stable Entra object ID should authorize independent of the email alias");
    }),
    run("auth accepts an assigned Entra app role without a duplicate local identity match", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
      });
      const principal = btoa(JSON.stringify({
        userId: "entra-assigned-user",
        userDetails: "changed-alias@example.com",
        claims: [{ typ: "roles", val: "Pipeline.Admin" }],
      }));
      const result = auth.requirePipelineUser(new Request("https://pipeline.local/referrals", {
        headers: { "x-ms-client-principal": principal },
      }));
      assert(result.ok, "A governed Entra app-role assignment should be sufficient authorization");
    }),
    run("note-lab reviewers can authenticate without receiving Pipeline access", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
      });
      const principal = btoa(JSON.stringify({
        userId: "note-lab-reviewer",
        userDetails: "reviewer@example.com",
        claims: [{ typ: "roles", val: "Pipeline.NoteLabReviewer" }],
      }));
      const request = new Request("https://pipeline.local/", {
        headers: { "x-ms-client-principal": principal },
      });
      const authenticated = auth.requireAuthenticatedUser(request);
      const pipeline = auth.requirePipelineUser(request);

      assert(authenticated.ok, "Lab reviewers must be able to establish a signed-in session");
      assert(authenticated.user.accessScope === "note_lab", "Lab reviewers must receive the narrow access scope");
      assert(auth.canAccessNoteLab(authenticated.user), "Lab reviewers must be able to enter the lab");
      assert(!auth.canAccessPipeline(authenticated.user), "Lab reviewers must not receive Pipeline access");
      assert(!pipeline.ok && pipeline.response.status === 403, "Pipeline routes must reject a lab-only identity");
    }),
    run("auth enforces role gates", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_TRUSTED_GATEWAY: "true",
        PIPELINE_ALLOW_UNVERIFIED_AUTH_HEADERS: "true",
        PIPELINE_ALLOWED_EMAILS: "viewer@example.com",
      });
      const result = auth.requirePipelineUser(
        new Request("https://pipeline.local/api/uploads/create-url", {
          headers: { "x-pipeline-user-email": "viewer@example.com" },
        }),
        ["admin"],
      );
      assert(!result.ok, "Viewer should fail admin-only action");
      assert(result.response.status === 403, "Role denial should return 403");
    }),
    run("auth decodes EasyAuth principal claims", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_ADMIN_EMAILS: "admin@example.com",
        PIPELINE_ALLOWED_EMAILS: "admin@example.com",
      });
      const principal = btoa(
        JSON.stringify({
          userId: "entra-user-1",
          userDetails: "admin@example.com",
          claims: [{ typ: "name", val: "Admin User" }],
        }),
      );
      const user = auth.getPipelineUserFromHeaders(
        new Headers({ "x-ms-client-principal": principal }),
      );
      assert(user?.id === "entra-user-1", "Expected EasyAuth user id");
      assert(user?.name === "Admin User", "Expected EasyAuth display name");
      assert(user?.roles.includes("admin"), "Expected admin role");
    }),
    run("auth maps Entra role claims", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
        PIPELINE_ALLOWED_EMAILS: "assessor@example.com",
      });
      const principal = btoa(
        JSON.stringify({
          userId: "entra-assessor-1",
          userDetails: "assessor@example.com",
          claims: [
            { typ: "name", val: "Assessor User" },
            { typ: "roles", val: "Pipeline.Assessor" },
          ],
        }),
      );
      const user = auth.getPipelineUserFromHeaders(new Headers({ "x-ms-client-principal": principal }));
      assert(user?.roles.includes("reviewer"), "Expected assessor role mapping");
      assert(!user?.roles.includes("assessment_coordinator"), "Assessors must not inherit supervisor access");
    }),
    run("auth maps Alamo Admissions app roles", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
      });
      const cases = [
        ["Alamo.Admissions.Assessor", "reviewer"],
        ["Alamo.Admissions.Supervisor", "assessment_coordinator"],
        ["Alamo.Admissions.Admin", "admin"],
      ];
      for (const [claimRole, expectedRole] of cases) {
        const principal = btoa(JSON.stringify({
          userId: `entra-${claimRole}`,
          userDetails: `${claimRole}@example.com`,
          claims: [{ typ: "roles", val: claimRole }],
        }));
        const user = auth.getPipelineUserFromHeaders(
          new Headers({ "x-ms-client-principal": principal }),
        );
        assert(user?.roles.includes(expectedRole), `Expected ${claimRole} to map to ${expectedRole}`);
      }
    }),
    run("referral access uses stable assessor assignments", () => {
      const assessor = {
        id: "entra-assessor-1",
        email: "assessor@example.com",
        name: "Assessor User",
        roles: ["reviewer", "viewer"],
      };
      const owned = { ...validReferral(), id: 1, ownerId: assessor.id };
      const other = { ...validReferral(), id: 2, owner: assessor.name, ownerId: "entra-assessor-2" };
      const legacy = { ...validReferral(), id: 3, owner: assessor.name };
      assert(referralAccess.canAccessReferral(assessor, owned), "Stable owner id should grant access");
      assert(!referralAccess.canAccessReferral(assessor, other), "A different stable owner id must override a matching name");
      assert(referralAccess.canAccessReferral(assessor, legacy), "Legacy owner names should remain accessible during backfill");
    }),
    run("supervisors retain portfolio referral access", () => {
      const supervisor = {
        id: "entra-supervisor-1",
        email: "supervisor@example.com",
        name: "Supervisor User",
        roles: ["assessment_coordinator", "reviewer", "viewer"],
      };
      assert(referralAccess.canAccessReferral(
        supervisor,
        { ...validReferral(), id: 4, owner: "Another Assessor", ownerId: "entra-assessor-9" },
      ), "Supervisors should retain portfolio access");
    }),
    run("auth fails closed without trusted principal or allowlist", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "headers",
      });
      assert(auth.getPipelineUserFromHeaders(new Headers({ "x-pipeline-user-email": "spoof@example.com" })) === null, "Unverified production headers must not authenticate");
    }),
    run("auth readiness reports missing names without secret values", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "entra_jwt",
        PIPELINE_ENTRA_SESSION_SECRET: "this-value-must-never-be-returned",
      });
      const readiness = auth.getPipelineAuthReadiness();
      const serialized = JSON.stringify(readiness);
      assert(readiness.ready === false, "Incomplete Entra configuration must not be ready");
      assert(readiness.missing_env.includes("PIPELINE_ENTRA_TENANT_ID"), "Expected tenant configuration to be reported missing");
      assert(!serialized.includes("this-value-must-never-be-returned"), "Readiness must never expose secret values");
    }),
    run("production Entra readiness has no duplicate local identity-list dependency", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "entra_jwt",
        NEXT_PUBLIC_PIPELINE_BASE_PATH: "/admissions",
        NEXT_PUBLIC_ENTRA_TENANT_ID: "tenant-id",
        NEXT_PUBLIC_ENTRA_CLIENT_ID: "client-id",
        NEXT_PUBLIC_PIPELINE_API_SCOPE: "api://client-id/access_as_user",
        NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED: "true",
        PIPELINE_ENTRA_TENANT_ID: "tenant-id",
        PIPELINE_ENTRA_API_AUDIENCE: "client-id",
        PIPELINE_ENTRA_API_SCOPE: "access_as_user",
        PIPELINE_ENTRA_SESSION_SECRET: "a-secure-session-secret-of-sufficient-length",
      });
      const readiness = auth.getPipelineAuthReadiness();
      assert(readiness.ready, "A complete Entra JWT configuration should not require local identity lists");
    }),
    run("authenticated web sessions use durable per-user PostgreSQL state", () => {
      const workspaceState = loadWorkspaceStateModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "entra_jwt",
        NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED: "true",
        PIPELINE_DATABASE_MODE: "postgres",
        PIPELINE_DATABASE_URL: "postgresql://configured",
      });
      const readiness = workspaceState.getUserWorkspaceStateReadiness();
      assert(readiness.enabled, "Authenticated web workspace state should be enabled");
      assert(readiness.ready, "Authenticated web workspace state should use configured PostgreSQL");
      assert(readiness.multi_instance_safe, "Authenticated web workspace state must support multiple app instances");
    }),
    run("standalone production readiness permits the intentional root base path", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "entra_jwt",
        NEXT_PUBLIC_ENTRA_TENANT_ID: "tenant-id",
        NEXT_PUBLIC_ENTRA_CLIENT_ID: "client-id",
        NEXT_PUBLIC_PIPELINE_API_SCOPE: "api://client-id/access_as_user",
        NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED: "true",
        PIPELINE_ENTRA_TENANT_ID: "tenant-id",
        PIPELINE_ENTRA_API_AUDIENCE: "client-id",
        PIPELINE_ENTRA_API_SCOPE: "access_as_user",
        PIPELINE_ENTRA_SESSION_SECRET: "a-secure-session-secret-of-sufficient-length",
      });
      const readiness = auth.getPipelineAuthReadiness();
      assert(readiness.ready, "The standalone root deployment must not require a compatibility base path");
      assert(
        !readiness.missing_env.includes("NEXT_PUBLIC_PIPELINE_BASE_PATH"),
        "The optional base path must not be reported as missing",
      );
    }),
    run("production mock readiness is restricted to explicitly allowed loopback tests", () => {
      const auth = loadAuthModule({
        NODE_ENV: "production",
        PIPELINE_AUTH_MODE: "mock",
        PIPELINE_ALLOW_PRODUCTION_MOCK_AUTH: "true",
        PIPELINE_LOCAL_CERTIFICATION: "true",
      });
      const loopback = auth.getPipelineAuthReadiness(new Request("http://127.0.0.1:3198/api/health"));
      const publicHost = auth.getPipelineAuthReadiness(new Request("https://pipeline.example/api/health"));
      assert(loopback.ready, "Explicitly allowed loopback certification should be ready");
      assert(publicHost.ready === false, "Production mock authentication must remain unhealthy on public hosts");
    }),
  ];
}

function backendBehaviorResults() {
  return [
    run("extraction backend defaults to mock in local development", () => {
      const backend = loadBackendModule({ NODE_ENV: "development" });
      const readiness = backend.getExtractionBackendReadiness();
      assert(readiness.mode === "mock", "Expected local mock extraction backend");
      assert(readiness.ready, "Local mock extraction backend should be ready");
    }),
    run("extraction backend blocks production mock by default", () => {
      const backend = loadBackendModule({
        NODE_ENV: "production",
        PIPELINE_EXTRACTION_BACKEND: "mock",
      });
      const readiness = backend.getExtractionBackendReadiness();
      assert(readiness.mode === "azure_databricks", "Production mock should be upgraded to Azure/Databricks");
      assert(readiness.production_mock_blocked, "Expected production mock to be blocked");
      assert(!readiness.ready, "Missing Azure/Databricks env should not be ready");
    }),
    run("extraction backend reports missing Azure/Databricks env", () => {
      const backend = loadBackendModule({
        NODE_ENV: "production",
        PIPELINE_EXTRACTION_BACKEND: "azure_databricks",
        AZURE_STORAGE_ACCOUNT: "storageacct",
      });
      const readiness = backend.getExtractionBackendReadiness();
      assert(readiness.mode === "azure_databricks", "Expected Azure/Databricks mode");
      assert(readiness.missing_env.includes("DATABRICKS_HOST"), "Expected missing Databricks host");
      assert(readiness.missing_env.includes("DATABRICKS_JOB_ID"), "Expected missing Databricks job id");
      assert(readiness.missing_env.includes("DATABRICKS_CLIENT_SECRET"), "Expected missing Databricks OAuth secret");
    }),
    run("production manual extraction requires only durable upload infrastructure", () => {
      const backend = loadBackendModule({
        NODE_ENV: "production",
        PIPELINE_EXTRACTION_BACKEND: "manual",
        AZURE_STORAGE_ACCOUNT: "storageacct",
        AZURE_STORAGE_CONTAINER_RAW: "raw",
        PIPELINE_DATABASE_URL: "postgresql://configured",
      });
      const readiness = backend.getExtractionBackendReadiness();
      assert(readiness.mode === "manual", "Expected explicit manual extraction mode");
      assert(readiness.ready, "Manual mode should be ready with durable Blob and database configuration");
      assert(!readiness.missing_env.includes("DATABRICKS_HOST"), "Manual mode must not require a fake Databricks job");
    }),
  ];
}

function mockStoreBehaviorResults() {
  return [
    run("mock upload store is idempotent by packet id", () => {
      const store = loadMockStoreModule();
      const input = {
        packet_id: "pkt_idempotent",
        referral_id: "ref_001",
        submitting_facility: "County General ED",
        source_type: "fax",
        files: [validFile()],
      };
      const first = store.createUploadTargets(input);
      const second = store.createUploadTargets(input);
      assert(first.packet_id === second.packet_id, "Expected same packet id");
      assert(first.uploads[0].blob_path === second.uploads[0].blob_path, "Expected stable upload target");
    }),
    run("mock upload completion rejects unknown packets", () => {
      const store = loadMockStoreModule();
      assert(
        store.completeUpload({ packet_id: "missing_packet", uploaded_file_ids: ["file_001"] }) === null,
        "Unknown packet completion should return null",
      );
      assert(store.getPacketStatus("missing_packet") === null, "Unknown packet status should return null");
      assert(store.getPacketFields("missing_packet") === null, "Unknown packet fields should return null");
    }),
  ];
}

function referralHardeningResults() {
  return [
    run("referral create rejects invalid workflow stage", () => {
      assertInvalid(
        referralValidation.validateReferralCreateInput({ ...validReferral(), stage: "Assessment-ish" }),
        "stage is invalid.",
      );
    }),
    run("referral create cannot skip the workflow", () => {
      assertInvalid(
        referralValidation.validateReferralCreateInput({ ...validReferral(), stage: "Accepted / Admitted" }),
        "New referrals must start in the New stage.",
      );
    }),
    run("referral create rejects server-owned workflow records", () => {
      assertInvalid(
        referralValidation.validateReferralCreateInput({ ...validReferral(), assessment: {} }),
        "Referral ids and workflow records are assigned by the server.",
      );
    }),
    run("referral create rejects oversized free text", () => {
      assertInvalid(
        referralValidation.validateReferralCreateInput({ ...validReferral(), note: "x".repeat(20_001) }),
        "note must be 20,000 characters or fewer.",
      );
    }),
    run("referral create rejects malformed requirements", () => {
      assertInvalid(
        referralValidation.validateReferralCreateInput({ ...validReferral(), requirements: [{ id: "tb" }] }),
        "requirements.label is required.",
      );
    }),
    run("referral patch rejects server-owned fields", () => {
      assertInvalid(
        referralValidation.validateReferralPatch({ version: 9 }),
        "version cannot be changed through a referral patch.",
      );
    }),
    run("referral patch accepts a bounded owner update", () => {
      const result = referralValidation.validateReferralPatch({ owner: "Eric Wilson", tags: ["priority"] });
      assertValid(result);
    }),
    run("manual intake authorization is server owned", () => {
      const authorization = {
        mode: "manual_chart",
        reason: "Source files will be attached after the chart is opened.",
        authorizedBy: "principal-1",
        authorizedByName: "Assessment User",
        authorizedAt: "2026-08-21T20:00:00.000Z",
      };
      assertInvalid(
        referralValidation.validateReferralCreateInput({ ...validReferral(), manualIntakeAuthorization: authorization }),
        "Referral ids and workflow records are assigned by the server.",
      );
      assertInvalid(
        referralValidation.validateReferralPatch({ manualIntakeAuthorization: authorization }),
        "manualIntakeAuthorization cannot be changed through a referral patch.",
      );
    }),
    run("audited manual intake unlocks packet gates without fabricating documents", () => {
      const authorization = {
        mode: "manual_chart",
        reason: "Source files will be attached after the chart is opened.",
        authorizedBy: "principal-1",
        authorizedByName: "Assessment User",
        authorizedAt: "2026-08-21T20:00:00.000Z",
      };
      const packetNeeded = {
        ...validReferral(),
        stage: "Packet Needed",
        documentName: "",
        documentStatus: "Missing",
        manualIntakeAuthorization: authorization,
      };
      assert(
        referralWorkflow.getReferralTransitionBlockers(packetNeeded, "Packet Review").length === 0,
        "Manual authorization should unlock packet review",
      );
      assert(
        referralWorkflow.getReferralTransitionBlockers({ ...packetNeeded, stage: "Packet Review" }, "Assessment").length === 0,
        "Manual authorization should unlock assessment",
      );
      assert(packetNeeded.documentStatus === "Missing", "Manual authorization must not fabricate an uploaded document");
    }),
    run("mutation origin accepts same-origin and service requests", () => {
      assert(requestSecurity.requireSameOriginMutation(new Request("https://pipeline.local/api/referrals", { method: "POST", headers: { Origin: "https://pipeline.local" } })) === null, "Same-origin mutation should pass");
      assert(requestSecurity.requireSameOriginMutation(new Request("https://pipeline.local/api/referrals", { method: "POST" })) === null, "Headerless service mutation should pass");
    }),
    run("mutation origin accepts configured custom domains behind a reverse proxy", () => {
      const requestSecurity = loadRequestSecurityModule({
        PIPELINE_ALLOWED_MUTATION_ORIGINS: "https://alamo-pipeline.com,https://www.alamo-pipeline.com",
      });
      const request = new Request("https://pipeline-prod.internal/api/auth/session", {
        method: "POST",
        headers: {
          Origin: "https://www.alamo-pipeline.com",
          "Sec-Fetch-Site": "same-origin",
        },
      });
      assert(requestSecurity.requireSameOriginMutation(request) === null, "Configured custom origin should pass through the Azure proxy");
    }),
    run("mutation origin still rejects unconfigured domains behind a reverse proxy", () => {
      const requestSecurity = loadRequestSecurityModule({
        PIPELINE_ALLOWED_MUTATION_ORIGINS: "https://www.alamo-pipeline.com",
      });
      const request = new Request("https://pipeline-prod.internal/api/auth/session", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      });
      const response = requestSecurity.requireSameOriginMutation(request);
      assert(response?.status === 403, "Unconfigured proxy origin should remain blocked");
    }),
    run("mutation origin rejects cross-site requests", () => {
      const response = requestSecurity.requireSameOriginMutation(new Request("https://pipeline.local/api/referrals", { method: "POST", headers: { Origin: "https://evil.example" } }));
      assert(response?.status === 403, "Cross-site mutation should return 403");
    }),
  ];
}

function assessmentSchemaResults() {
  return [
    run("assessment schema exposes the complete governed interview", () => {
      assert(assessmentSchema.assessmentToolFieldDefinitions.length === 157, "Expected 157 assessment fields");
      assert(
        new Set(assessmentSchema.assessmentToolFieldDefinitions.map((definition) => definition.key)).size === assessmentSchema.assessmentToolFieldDefinitions.length,
        "Every governed assessment field must be defined exactly once",
      );
      assert(assessmentInterview.assessmentInterviewQuestions.length === 151, "Expected 151 focused user-facing interview questions");
      assert(
        new Set(assessmentInterview.assessmentInterviewQuestions.map((question) => question.field)).size === assessmentInterview.assessmentInterviewQuestions.length,
        "Every interview field must appear exactly once",
      );
      const interviewFields = new Set(assessmentInterview.assessmentInterviewQuestions.map((question) => question.field));
      const nonInterviewFields = assessmentSchema.assessmentToolFieldDefinitions
        .map((definition) => definition.key)
        .filter((field) => !interviewFields.has(field));
      assert(
        JSON.stringify(nonInterviewFields) === JSON.stringify(["assessor", "unable_to_assess_reasons", "source_file", "match_confidence", "assessment_notes", "extraction_date"]),
        "Only assignment, legacy notes, unable-response support, and extraction-owned fields may stay outside the interview",
      );
      assert(
        assessmentInterview.assessmentInterviewSections.every((section) => (
          assessmentInterview.assessmentInterviewQuestions.some((question) => assessmentSchema.assessmentToolFieldDefinitions.find((definition) => definition.key === question.field)?.section === section.key)
        )),
        "Every interview section must contain at least one question",
      );
      assert(
        referralExtractionSchema.assessmentWorkbookExtractionTargets.length === assessmentSchema.assessmentToolFieldDefinitions.length - 5,
        "Expected every user-facing field except server-owned assignment and job-supplied provenance",
      );
      assert(
        referralExtractionSchema.referralPacketExtractionTargets.some((field) => field.field_key === "assessment_tool.mobility")
          && referralExtractionSchema.referralPacketExtractionTargets.some((field) => field.field_key === "referral.first_name")
          && !referralExtractionSchema.referralPacketExtractionTargets.some((field) => field.field_key === "assessment_tool.assessor"),
        "Initial packet extraction should capture intake context and reviewable clinical evidence without process metadata",
      );
      const interviewQuestion = (field) => assessmentInterview.assessmentInterviewQuestions.find((question) => question.field === field);
      assert(
        interviewQuestion("prior_setting_bucket")?.control === "select"
          && interviewQuestion("referring_facility")?.control === "text"
          && interviewQuestion("prior_setting_bucket")?.options?.some((option) => option.value === "state_hospital")
          && interviewQuestion("prior_setting_bucket")?.options?.some((option) => option.value === "residential_program"),
        "Prior placement must keep a controlled setting type and a separate placement name",
      );
      assert(
        JSON.stringify(interviewQuestion("conservatorship_type")?.options?.map((option) => option.label))
          === JSON.stringify(["LPS", "TCon", "Murphy's", "Non-Conserved"]),
        "Conserved status must use the approved four choices",
      );
      assert(
        ["lai_vs_oral", "auditory_hallucination_frequency", "tactile_hallucination_frequency"]
          .every((field) => interviewQuestion(field)?.control === "select")
          && interviewQuestion("responds_to_internal_stimuli")?.control === "yes_no",
        "Low-ambiguity categorical assessment answers must stay structured",
      );
      assert(
        ["acuity_level", "prompting_level", "self_care_status"].every((field) => interviewQuestion(field)?.control === "text")
          && ["special_diet_details", "preferred_facility_characteristics", "placement_preferences_concerns"]
            .every((field) => interviewQuestion(field)?.control === "textarea"),
        "Interpretive clinical, diet, and placement narratives must not be reduced to speculative option lists",
      );
    }),
    run("assessment extraction maps known values and banks unknown values", () => {
      const result = assessmentSchema.mapExtractedAssessmentFields(
        [
          extractedAssessmentField("referral.first_name", "Avery"),
          extractedAssessmentField("referral.last_name", "Example"),
          extractedAssessmentField("referral.date_of_birth", "1982-05-14"),
          extractedAssessmentField("assessment.mobility", "Independent with walker"),
          extractedAssessmentField("assessment.presenting_needs", "Medication stabilization"),
          extractedAssessmentField("assessment.level_of_care", "Residential"),
          extractedAssessmentField("assessment_tool.medications_at_intake", '["Olanzapine 10 mg", "Metformin 500 mg"]'),
        ],
        {
          source_file: "assessment.xlsx",
          extraction_date: "2026-08-08T18:00:00.000Z",
          match_confidence: 0.94,
        },
      );

      assert(result.data.resident_name === "Avery Example", "Expected first and last name composition");
      assert(result.data.date_of_birth === "1982-05-14", "Expected date of birth mapping");
      assert(result.data.mobility === "Independent with walker", "Expected legacy mobility mapping");
      assert(result.data.medications_at_intake.length === 2, "Expected medications to remain a list");
      assert(result.data.source_file === "assessment.xlsx", "Expected source filename from job context");
      assert(result.data.match_confidence === 0.94, "Expected job-level match confidence");
      assert(result.data.assessment_notes.includes("Presenting needs: Medication stabilization"), "Expected rich legacy text in notes");
      assert(
        result.unmapped_fields.some((field) => field.source_field_key === "assessment.level_of_care"),
        "Semantically ambiguous legacy fields must be banked",
      );
      assert(
        result.field_provenance.mobility?.[0]?.source_file === "assessment.xlsx",
        "Expected field-level source provenance",
      );
    }),
    run("assessment list extraction never comma-splits clinical text", () => {
      const result = assessmentSchema.mapExtractedAssessmentFields([
        extractedAssessmentField("assessment_tool.substances", "Alcohol, occasional use"),
      ]);
      assert(result.data.substances.length === 1, "Expected one source list item");
      assert(result.data.substances[0] === "Alcohol, occasional use", "Expected punctuation preserved");
    }),
    run("assessment validation rejects malformed structured values without throwing", () => {
      const invalid = {
        ...assessmentSchema.createEmptyAssessmentToolData(),
        assessment_date: "2026-99-99",
        medications_at_intake: "Olanzapine, Metformin",
        prior_hospitalizations_count: -1,
        match_confidence: 1.4,
        unable_to_assess_reasons: { invented_field: "No source available" },
        invented_field: "must remain visible",
      };
      const issues = assessmentSchema.validateAssessmentToolData(invalid);
      assert(issues.some((issue) => issue.field === "assessment_date"), "Expected invalid date issue");
      assert(issues.some((issue) => issue.field === "medications_at_intake"), "Expected list shape issue");
      assert(issues.some((issue) => issue.field === "prior_hospitalizations_count"), "Expected count issue");
      assert(issues.some((issue) => issue.field === "match_confidence"), "Expected confidence issue");
      assert(issues.some((issue) => issue.field === "unable_to_assess_reasons"), "Expected malformed unable-reason map issue");
      assert(issues.some((issue) => issue.message.includes("invented_field")), "Expected unknown field issue");
    }),
    run("assessment completeness requires the governed interview without requiring a pre-admission resident number", () => {
      const empty = assessmentSchema.createEmptyAssessmentToolData();
      const initial = assessmentSchema.getAssessmentToolCompleteness(empty);
      assert(initial.required_total === assessmentSchema.requiredAssessmentToolFields.length && initial.required_total === 55, "Expected all 55 core interview answers");
      assert(!initial.missing_fields.includes("resident_number"), "A pre-admission assessment must not require an ElderMark resident number");

      const identified = assessmentSchema.getAssessmentToolCompleteness({
        ...empty,
        resident_name: "Avery Example",
        date_of_birth: "1982-05-14",
        community: "San Pablo",
        assessment_date: "2026-08-08",
        assessor: "Eric Wilson",
        referral_received_date: "2026-08-01",
        referrer_name: "County Clinician",
        referrer_contact: "555-0100",
        current_location: "County hospital",
      });
      assert(identified.required_ready === 9, "Expected the nine core identity and referral answers to be captured");
      assert(identified.missing_fields.includes("diagnosis_categories"), "Clinical interview answers must remain visibly incomplete");
    }),
    run("assessment interview reveals and requires conditional follow-ups", () => {
      const data = assessmentSchema.createEmptyAssessmentToolData();
      assert(!assessmentInterview.getAssessmentInterviewQuestions("functional_adl", data).some((question) => question.field === "language_barrier_details"), "Hidden language detail must not clutter the initial interview");
      assert(!assessmentInterview.getAssessmentInterviewQuestions("physical_health", data).some((question) => question.field === "brief_change_support"), "Brief support must stay hidden when incontinence has not been reported");
      data.language_barrier = "yes";
      assert(assessmentInterview.getAssessmentInterviewQuestions("functional_adl", data).some((question) => question.field === "language_barrier_details"), "A language barrier must reveal its detail question");
      assert(assessmentInterview.getRequiredAssessmentInterviewQuestions(data).some((question) => question.field === "language_barrier_details"), "A revealed language support detail must be required");
      data.incontinence_issues = "yes";
      const physicalHealthQuestions = assessmentInterview.getAssessmentInterviewQuestions("physical_health", data);
      const briefSupport = physicalHealthQuestions.find((question) => question.field === "brief_change_support");
      const physicalHealthFields = physicalHealthQuestions.map((question) => question.field);
      assert(physicalHealthFields.indexOf("incontinence_issues") === physicalHealthFields.indexOf("ileostomy") + 1, "Incontinence must follow colostomy and ileostomy");
      assert(physicalHealthFields.indexOf("brief_change_support") === physicalHealthFields.indexOf("incontinence_issues") + 1, "Brief-changing support must immediately follow incontinence");
      assert(
        briefSupport?.control === "select"
          && JSON.stringify(briefSupport.options?.map((option) => option.label)) === JSON.stringify([
            "Client independently changes briefs",
            "Client needs help changing briefs",
            "Client needs briefs changed",
          ]),
        "Incontinence must reveal the three exact brief-changing support choices",
      );
      assert(assessmentInterview.getRequiredAssessmentInterviewQuestions(data).some((question) => question.field === "brief_change_support"), "Revealed brief-changing support must be required");
      data.dress_assistance_level = "independent";
      data.bathing_assistance_level = "some_assistance";
      assert(assessmentInterview.getAssessmentInterviewSnapshot(data).find((item) => item.label === "ADL assistance")?.value === "Yes", "The snapshot must derive ADL assistance from detailed answers");
    }),
    run("unable-to-assess answers require a question-specific explanation", () => {
      const data = assessmentSchema.createEmptyAssessmentToolData();
      data.language_barrier = "unable_to_assess";
      const blocked = assessmentCompletion.getAssessmentCompletionSummary(data);
      assert(
        blocked.missing.some((rule) => rule.key === "unable:language_barrier"),
        "An unable-to-assess answer without an explanation must block completion",
      );
      data.unable_to_assess_reasons = assessmentInterview.setAssessmentUnableReason(
        data.unable_to_assess_reasons,
        "language_barrier",
        "The client could not participate and no collateral source was available.",
      );
      const explained = assessmentCompletion.getAssessmentCompletionSummary(data);
      assert(
        !explained.missing.some((rule) => rule.key === "unable:language_barrier"),
        "A stored question-specific explanation must satisfy the unable-to-assess rule",
      );
      assert(
        assessmentInterview.getAssessmentInterviewSnapshot(data).find((item) => item.label === "Language barrier")?.value === "Unable to assess",
        "The interview snapshot must present the third response in plain language",
      );
    }),
  ];
}

function assessmentValidationResults() {
  return [
    run("assessment create protects extraction-owned provenance fields", () => {
      const result = assessmentValidation.validateAssessmentCreateRequest({
        data: { resident_number: "EM-1001", source_file: "browser-supplied.xlsx" },
      });
      assertInvalid(result, "source_file is supplied by the extraction job.");
      assertInvalid(
        assessmentValidation.validateAssessmentCreateRequest({ data: { assessor: "Browser supplied name" } }),
        "assessor must be assigned from active workspace members.",
      );
    }),
    run("assessment APIs restrict unable explanations to yes/no questions", () => {
      assertInvalid(
        assessmentValidation.validateAssessmentPatchRequest({
          if_match: 1,
          patch: { data: { unable_to_assess_reasons: { primary_diagnosis: "Not available" } } },
        }),
        "Unable-to-assess explanations may only reference yes/no questions: primary_diagnosis.",
      );
      assertValid(assessmentValidation.validateAssessmentPatchRequest({
        if_match: 1,
        patch: { data: { unable_to_assess_reasons: { language_barrier: "The client could not participate." } } },
      }));
    }),
    run("assessment patch requires optimistic versions and known fields", () => {
      assertInvalid(
        assessmentValidation.validateAssessmentPatchRequest({ if_match: 0, patch: { data: {} } }),
        "if_match must be a positive version number.",
      );
      assertInvalid(
        assessmentValidation.validateAssessmentPatchRequest({ patch: { data: {} } }),
        "if_match must be a positive version number.",
      );
      assertInvalid(
        assessmentValidation.validateAssessmentPatchRequest({ if_match: 1, patch: { invented: true } }),
        "Unknown assessment patch field: invented.",
      );
      assertInvalid(assessmentValidation.validateAssessmentPatchRequest({
        if_match: 2,
        assessor_id: "assessor@pipeline.local",
        patch: { data: { resident_number: "EM-1001" }, status: "draft" },
      }), "Change the referral assignment to change its assessor.");
      assertValid(assessmentValidation.validateAssessmentPatchRequest({
        if_match: 2,
        patch: { data: { resident_number: "EM-1001" }, status: "draft" },
      }));
      assertValid(assessmentValidation.validateAssessmentPatchRequest({
        section: "functional_adl",
        if_match_section: 2,
        patch: { review_extraction: [{ field: "mobility", action: "accept" }] },
      }));
      assertInvalid(
        assessmentValidation.validateAssessmentPatchRequest({
          section: "identity",
          if_match_section: 2,
          patch: { review_extraction: [{ field: "assessment_date", action: "reject" }] },
        }),
        "Only extracted assessment answers can be reviewed here.",
      );
      assertInvalid(
        assessmentValidation.validateAssessmentPatchRequest({
          section: "functional_adl",
          if_match_section: 2,
          patch: {
            review_extraction: [
              { field: "mobility", action: "accept" },
              { field: "mobility", action: "reject" },
            ],
          },
        }),
        "review_extraction contains a duplicate field.",
      );
      assertInvalid(
        assessmentValidation.validateAssessmentPatchRequest({
          section: "identity",
          if_match_section: 2,
          assessor_id: "entra-assessor-1",
          patch: { data: {} },
        }),
        "Change the referral assignment to change its assessor.",
      );
      assertInvalid(
        assessmentValidation.validateAssessmentPatchRequest({ if_match: 2, assessor_id: "bad id", patch: {} }),
        "Change the referral assignment to change its assessor.",
      );
    }),
    run("assessment import forces extracted values into pending review", () => {
      const result = assessmentValidation.validateAssessmentImportRequest({
        assessment_id: "asm_1001",
        if_match: 1,
        fields: [{
          field_key: "assessment_tool.primary_diagnosis",
          proposed_value: "Example diagnosis",
          confidence: 0.91,
          review_status: "accepted",
        }],
        context: { source_file: "assessment.csv", match_confidence: 0.91 },
        client_mutation_id: "import-1001",
      });
      assertValid(result);
      assert(result.value.fields[0].review_status === "pending", "Browser imports must require review");
    }),
  ];
}

function canonicalClientIntegrationResults() {
  return [
    run("assessment canonical identity can be attached once but never replaced", () => {
      assert(
        assessmentRecords.preserveCanonicalClientId(null, "client-1001") === "client-1001",
        "Expected canonical identity attachment",
      );
      assert(
        assessmentRecords.preserveCanonicalClientId("client-1001", null) === "client-1001",
        "A later empty value must not remove canonical identity",
      );
      assertThrows(
        () => assessmentRecords.preserveCanonicalClientId("client-1001", "client-2002"),
        "Expected canonical identity replacement to fail",
      );
    }),
    run("future client updates preserve the August 18 baseline and remain prepared records", () => {
      const newClient = clientUpdateContracts.prepareNewClientUpdate(
        { display_name: "Sanitized New Client" },
        "new-client-1001",
      );
      assert(newClient.source_baseline_date === "2026-08-18", "Expected immutable baseline reference");
      assert(newClient.update_type === "new_client", "Expected new-client update type");
      const assessment = clientUpdateContracts.prepareAssessmentUpdate(
        "client-1001",
        "asm-1001",
        { status: "complete" },
        "assessment-1001",
      );
      assert(assessment.canonical_client_id === "client-1001", "Expected canonical assessment identity");
      assertThrows(
        () => clientUpdateContracts.prepareAssessmentUpdate("", "asm-1001", {}, "assessment-invalid"),
        "Expected assessment update without canonical identity to fail",
      );
    }),
  ];
}

function residentLinkValidationResults() {
  const validCandidate = {
    pipeline_client_id: "client-1001",
    display_name: "Avery Example",
    date_of_birth: "1982-05-14",
    referral_id: 42,
    resident_key: "resident-1001",
    resident_number: "EM-1001",
    community_id: "san-pablo",
    match_method: "resident_number_exact",
    match_confidence: 1,
    client_mutation_id: "link-1001",
  };

  return [
    run("resident-link candidates require explicit governed identities", () => {
      assertValid(residentLinkValidation.validateResidentLinkCreate(validCandidate));
      assertInvalid(
        residentLinkValidation.validateResidentLinkCreate({ ...validCandidate, resident_key: "" }),
        "resident_key must be between 1 and 256 characters.",
      );
      assertInvalid(
        residentLinkValidation.validateResidentLinkCreate({ ...validCandidate, resident_number: null }),
        "resident_number is required for an exact resident-number candidate.",
      );
    }),
    run("resident-link review requires an optimistic version and rejection reason", () => {
      assertValid(residentLinkValidation.validateResidentLinkReview({ action: "confirm", if_match: 1 }));
      assertInvalid(
        residentLinkValidation.validateResidentLinkReview({ action: "confirm", if_match: 0 }),
        "if_match must be a positive resident-link version.",
      );
      assertInvalid(
        residentLinkValidation.validateResidentLinkReview({ action: "reject", if_match: 1 }),
        "A review note is required when rejecting a resident link.",
      );
    }),
  ];
}

function workspaceStateValidationResults() {
  const fieldKeys = [
    "name", "gender", "age", "dob", "ssn", "owner", "referralReceived",
    "admissionDate", "county", "referent", "responsiblePerson", "summary", "interview",
  ];
  const validDraft = {
    schema: 1,
    savedAt: "2026-08-12T12:00:00.000Z",
    baseVersion: 4,
    dirtyKeys: ["summary"],
    fields: Object.fromEntries(fieldKeys.map((key) => [key, { value: key === "summary" ? "Synthetic recovery note" : key === "county" ? "San Pablo" : "" }])),
    conserved: "",
    tagsInput: "synthetic",
    documents: {},
  };

  return [
    run("desktop recovery drafts require the complete bounded schema", () => {
      const parsed = workspaceStateTypes.parsePipelineReferralDraft(validDraft);
      assert(parsed?.fields.summary.value === "Synthetic recovery note", "Expected a valid recovery draft");
      assert(parsed?.fields.community.value === "San Pablo" && parsed?.fields.county.value === "", "Legacy drafts should migrate the old community slot without inventing a county");
      assert(workspaceStateTypes.parsePipelineReferralDraft({ ...validDraft, fields: { summary: { value: "Partial" } } }) === null, "Partial field maps must fail");
      assert(workspaceStateTypes.parsePipelineReferralDraft({ ...validDraft, dirtyKeys: ["invented"] }) === null, "Unknown dirty keys must fail");
      assert(workspaceStateTypes.parsePipelineReferralDraft({ ...validDraft, fields: { ...validDraft.fields, summary: { value: "x".repeat(40_001) } } }) === null, "Oversized draft fields must fail");
    }),
    run("desktop recents accept only typed bounded destinations", () => {
      assert(workspaceStateTypes.isPipelineRecentDestination({
        id: "page:referrals",
        kind: "page",
        screen: "referrals",
        title: "Referrals",
        detail: "Synthetic navigation",
        visitedAt: "2026-08-12T12:00:00.000Z",
      }), "Expected a valid recent destination");
      assert(!workspaceStateTypes.isPipelineRecentDestination({
        id: "page:unknown",
        kind: "page",
        screen: "unknown",
        title: "Unknown",
        detail: "Synthetic navigation",
        visitedAt: "2026-08-12T12:00:00.000Z",
      }), "Unknown screens must fail");
    }),
  ];
}

function loadAuthModule(env) {
  return loadTypeScriptModule(root, "lib/auth/pipeline-auth.ts", {
    process: {
      env,
    },
  });
}

function loadBackendModule(env) {
  return loadTypeScriptModule(root, "lib/extraction/backend-config.ts", {
    process: {
      env,
    },
  });
}

function loadWorkspaceStateModule(env) {
  return loadTypeScriptModule(root, "lib/pipeline/user-workspace-state-store.ts", {
    process: {
      env,
    },
  });
}

function loadRequestSecurityModule(env) {
  return loadTypeScriptModule(root, "lib/auth/request-security.ts", {
    process: {
      env,
    },
  });
}

function loadMockStoreModule() {
  return loadTypeScriptModule(root, "lib/extraction/mock-store.ts");
}

function validFile() {
  return {
    file_id: "file_001",
    filename: "packet.pdf",
    content_type: "application/pdf",
    size: 1024,
  };
}

function extractedAssessmentField(fieldKey, proposedValue) {
  return {
    field_key: fieldKey,
    proposed_value: proposedValue,
    confidence: 0.9,
    review_status: "accepted",
    source_page_no: 3,
    evidence_url: "evidence://page/3",
  };
}

function extractedCanvasField(fieldKey, proposedValue, reviewStatus) {
  return {
    field_key: fieldKey,
    proposed_value: proposedValue,
    confidence: 0.9,
    review_status: reviewStatus,
  };
}

function emptyCanvasFields() {
  return Object.fromEntries([
    "name",
    "gender",
    "age",
    "dob",
    "ssn",
    "owner",
    "referralReceived",
    "admissionDate",
    "community",
    "county",
    "referent",
    "responsiblePerson",
    "summary",
    "currentMedications",
  ].map((key) => [key, { label: key, value: "" }]));
}

function validReferral() {
  return {
    name: "Test Client",
    date: "8/7/2026",
    stage: "New",
    community: "San Pablo",
    source: "County intake",
    priority: "standard",
    tags: [],
    documentName: "packet.pdf",
    documentStatus: "Uploaded",
    owner: "Eric Wilson",
    note: "Referral summary",
    createdAt: "2026-08-07T12:00:00.000Z",
    dob: "1/1/1980",
    phone: "",
    email: "",
    payer: "",
    requirements: [],
  };
}

function run(name, fn) {
  try {
    fn();
    return { name, ok: true };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function assertValid(result) {
  assert(result.ok, `Expected valid result, got ${JSON.stringify(result)}`);
}

function assertInvalid(result, message, status) {
  assert(!result.ok, "Expected invalid result");
  assert(result.message === message, `Expected "${message}", got "${result.message}"`);
  if (status !== undefined) {
    assert(result.status === status, `Expected status ${status}, got ${result.status}`);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
