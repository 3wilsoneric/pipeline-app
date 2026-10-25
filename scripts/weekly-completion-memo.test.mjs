import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const { buildWeeklyCompletionMemo } = loadTypeScriptModule(process.cwd(), "lib/pipeline/weekly-completion-memo.ts");
const { completionMemoAddendumReason, completionMemoCorrectionField } = loadTypeScriptModule(process.cwd(), "lib/pipeline/completion-memo-fields.ts");
const { createEmptyAssessmentToolData } = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-tool-schema.ts");
const assessor = { id: "assessor-1", name: "Assigned Assessor", roles: ["reviewer"] };
const coordinator = { id: "coordinator-1", name: "Admissions Coordinator", roles: ["assessment_coordinator"] };
const accepted = { outcome: "accepted", decidedAt: "2026-10-18T12:00:00Z" };
const needed = (id, status = "needed") => ({
  id, type: "medication_list", label: "Medication list", requiredFor: "move_in", status,
  owner: assessor.name, ownerId: assessor.id, nextStep: "Review medication list", blocker: false,
});
const referral = (id, extra = {}) => ({
  id, name: `Synthetic Client ${id}`, community: "Turlock", owner: assessor.name, ownerId: assessor.id,
  date: "2026-10-15", dob: "1970-01-01", source: "Synthetic facility", county: "Synthetic County",
  gender: "Unknown",
  stage: "Community Review", workflowStatus: "approved_for_placement", workspaceStatus: "active",
  documentStatus: "Uploaded", requirements: [needed(`med-${id}`)], admissionDecision: accepted,
  ...extra,
});
const work = (file, extra = {}) => ({
  referral_id: file.id, outcome_state: "accepted", workflow_status: file.workflowStatus,
  assessment_state: "signed", assessment_complete: true, planned_admission_date: undefined,
  actual_admission_date: file.actualAdmissionDate, ...extra,
});
const monday = new Date("2026-10-26T16:00:00Z");

test("Monday memo recurs by Pacific week and scopes assessor work", () => {
  const mine = referral(1);
  const other = referral(2, { owner: "Other Assessor", ownerId: "assessor-2" });
  const cancelled = referral(3, { placementCancellation: { reason: "Did not move in" } });
  const historical = referral(4, { workspaceStatus: "historical" });
  const resolved = referral(5, { requirements: [needed("done", "reviewed")] });
  const contexts = new Map([1, 2, 3, 4, 5].map((id) => [id, { assessmentSigned: true, packetSentAt: "2026-10-18T12:00:00Z", decision: accepted }]));
  const inputs = { work: [mine, other, cancelled, historical, resolved].map((file) => work(file)), referrals: [mine, other, cancelled, historical, resolved], contexts, now: monday };
  const personal = buildWeeklyCompletionMemo({ ...inputs, viewer: assessor });
  assert.equal(personal.is_monday, true);
  assert.equal(personal.week_key, "2026-10-26");
  assert.deepEqual(Array.from(personal.clients, (client) => client.referral_id), [1]);
  assert.deepEqual(Array.from(personal.clients[0].tasks, (task) => task.id), ["requirement:med-1"]);
  assert.equal(personal.clients[0].tasks[0].location.view, "files");
  const team = buildWeeklyCompletionMemo({ ...inputs, viewer: coordinator });
  assert.deepEqual(Array.from(team.clients, (client) => client.referral_id), [1, 2]);
  const sunday = buildWeeklyCompletionMemo({ ...inputs, viewer: assessor, now: new Date("2026-11-01T18:00:00Z") });
  assert.equal(sunday.is_monday, false);
  assert.equal(sunday.week_key, "2026-10-26");
  const nextMonday = buildWeeklyCompletionMemo({ ...inputs, viewer: assessor, now: new Date("2026-11-02T18:00:00Z") });
  assert.equal(nextMonday.week_key, "2026-11-02");
  const reassignedContexts = new Map(contexts);
  reassignedContexts.set(1, { ...contexts.get(1), assessmentAssessorId: "assessor-2", assessmentData: { assessor: "Other Assessor" } });
  assert.equal(buildWeeklyCompletionMemo({ ...inputs, contexts: reassignedContexts, viewer: assessor }).clients.length, 0,
    "the former referral owner does not receive the designated assessor's memo");
});

test("memo shows canonical review paths without claiming a checklist item is a missing file", () => {
  const file = referral(10, { dob: "", source: "", county: "", stage: "Accepted / Admitted", workflowStatus: "admitted", actualAdmissionDate: "2026-10-20" });
  const memo = buildWeeklyCompletionMemo({
    work: [work(file, { assessment_state: "ready_to_sign" })], referrals: [file], contexts: new Map(), viewer: assessor, now: monday,
  });
  const tasks = memo.clients[0].tasks;
  assert.deepEqual(Array.from(tasks, (task) => task.id), ["profile:dob", "profile:referent", "profile:county", "assessment:signature", "requirement:med-10", "handoff"]);
  assert.equal(tasks.find((task) => task.id === "profile:dob").location.intakeField, "dob");
  assert.equal(tasks.find((task) => task.id === "requirement:med-10").label, "Find or add medication list");
  assert.match(tasks.find((task) => task.id === "requirement:med-10").detail, /Check Files for an existing copy/);
  assert.match(tasks.find((task) => task.id === "handoff").detail, /before sending anything/);
});

test("memo names demographic, origin, assessment answer, and answer-quality gaps with exact entry points", () => {
  const file = referral(12, { name: "Pending Packet Review", gender: "", source: "Unknown", county: "", date: "" });
  const assessment = {
    ...createEmptyAssessmentToolData(),
    date_of_birth: "1971-01-01", current_symptoms: "See packet", prior_setting_bucket: "skilled_nursing_facility",
    diabetic: "unable_to_assess", unable_to_assess_reasons: {},
  };
  const memo = buildWeeklyCompletionMemo({
    work: [work(file)], referrals: [file],
    contexts: new Map([[file.id, { assessmentData: assessment, assessmentSigned: false, decision: accepted }]]),
    viewer: assessor, now: monday,
  });
  const tasks = memo.clients[0].tasks;
  const byId = (id) => tasks.find((task) => task.id === id);
  for (const field of ["name", "gender", "referent", "county", "referralReceived"]) {
    assert.equal(byId(`profile:${field}`).location.intakeField, field);
  }
  assert.equal(byId("assessment:field:resident_name").location.assessmentQuestion, "resident_name");
  assert.equal(byId("assessment:unable:diabetic").location.assessmentQuestion, "diabetic");
  assert.equal(byId("assessment:referring_facility").location.assessmentQuestion, "referring_facility");
  assert.equal(byId("review:dob").group, "review");
  assert.match(byId("review:current_symptoms").detail, /See packet/);
  assert.equal(byId("assessment:signature").group, "assessment");
});

test("memo does not invent a facility for a home setting or flag a matching birth date", () => {
  const file = referral(13, { requirements: [], dob: "1970-01-01" });
  const assessment = {
    ...createEmptyAssessmentToolData(), date_of_birth: "1970-01-01", prior_setting_bucket: "independent_family_home",
    referring_facility: null, current_symptoms: "No symptoms reported at the interview.",
  };
  const memo = buildWeeklyCompletionMemo({
    work: [work(file)], referrals: [file],
    contexts: new Map([[file.id, { assessmentData: assessment, assessmentSigned: true, packetSentAt: "2026-10-18T12:00:00Z", decision: accepted }]]),
    viewer: assessor, now: monday,
  });
  const ids = memo.clients[0].tasks.map((task) => task.id);
  assert.equal(ids.includes("assessment:referring_facility"), false);
  assert.equal(ids.includes("review:dob"), false);
  assert.equal(ids.includes("review:current_symptoms"), false);
  assert.equal(ids.includes("assessment:signature"), false);
  assert.equal(memo.clients[0].tasks.find((task) => task.id === "assessment:field:resident_name").location.assessmentMode, "review",
    "signed assessment gaps open the read-only review and correction path");
});

test("accepted clients do not receive pre-assessment provider form work", () => {
  const file = referral(11, { requirements: [{ ...needed("provider-11"), type: "provider_form", label: "Provider form", requiredFor: "pre_assessment" }] });
  const memo = buildWeeklyCompletionMemo({
    work: [work(file)], referrals: [file],
    contexts: new Map([[file.id, { assessmentSigned: true, packetSentAt: "2026-10-18T12:00:00Z", decision: accepted }]]),
    viewer: assessor, now: monday,
  });
  assert.equal(memo.clients.length, 0);
});

test("past planned dates are assigned to the coordinator view only", () => {
  const file = referral(20, { requirements: [] });
  const inputs = {
    work: [work(file, { planned_admission_date: "2026-10-01" })], referrals: [file],
    contexts: new Map([[file.id, { assessmentSigned: true, packetSentAt: "2026-10-18T12:00:00Z", decision: accepted }]]), now: monday,
  };
  assert.equal(buildWeeklyCompletionMemo({ ...inputs, viewer: assessor }).clients.length, 0);
  const team = buildWeeklyCompletionMemo({ ...inputs, viewer: coordinator });
  assert.deepEqual(Array.from(team.clients[0].tasks, (task) => task.id), ["outcome"]);
});

test("a field-specific addendum closes only its matching finalized assessment gap", () => {
  const file = referral(21, { requirements: [] });
  const assessment = { ...createEmptyAssessmentToolData(), current_symptoms: null, diagnosis_categories: [] };
  const inputs = {
    work: [work(file)], referrals: [file], viewer: assessor, now: monday,
    contexts: new Map([[file.id, {
      assessmentId: "asm-21", assessmentData: assessment, assessmentSigned: true,
      packetSentAt: "2026-10-18T12:00:00Z", decision: accepted,
      assessmentMemoCorrectionFields: ["current_symptoms"],
    }]]),
  };
  const memo = buildWeeklyCompletionMemo(inputs);
  const ids = memo.clients[0].tasks.map((task) => task.id);
  assert.equal(ids.includes("assessment:field:current_symptoms"), false);
  assert.equal(ids.includes("assessment:field:diagnosis_categories"), true);
  assert.equal(memo.clients[0].assessment_id, "asm-21");
  assert.equal(completionMemoCorrectionField(completionMemoAddendumReason("current_symptoms")), "current_symptoms");
  assert.equal(completionMemoCorrectionField("completion_review:not_a_field"), null);
});
