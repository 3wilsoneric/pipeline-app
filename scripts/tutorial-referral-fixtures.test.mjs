import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
const sample = loadTypeScriptModule(process.cwd(), "lib/training/tutorial-referral.ts");

test("referral tutorials open local samples while reports stay separate", () => {
  for (const id of ["assessor-shift", "create-referral", "start-assessment", "complete-assessment", "review-chart", "record-decision", "prepare-packet", "workspace-files"]) assert.equal(typeof sample.tutorialReferralEntry(id), "number");
  assert.equal(sample.tutorialReferralEntry("run-report"), undefined);
  const state = sample.createTutorialReferral();
  assert.equal(state.referral.id, 0);
  assert.equal(state.assessment.referral_id, 0);
  assert.equal(state.assessment.signed_at, null);
  assert.equal(state.sentAt, null);
  assert.equal(sample.tutorialBoardItem(state).next_action, "Schedule the assessment");
  assert.equal(sample.tutorialBoardItem(state).workflow_status, "ready_to_schedule");
});

test("jumping through all steps preserves answers and never sends", () => {
  let state = sample.createTutorialReferral();
  state.assessment.additional_information = "A locally edited answer";
  const id = state.assessment.assessment_id;
  for (let index = 0; index < sample.tutorialReferralSteps.length; index++) {
    state = sample.prepareTutorialStep(state, index);
    assert.equal(state.assessment.assessment_id, id);
    assert.equal(state.assessment.additional_information, "A locally edited answer");
    assert.equal(state.sentAt, null);
  }
  assert.notEqual(state.referral.stage, "Accepted / Admitted");
  assert.equal(state.referral.actualAdmissionDate, undefined, "tutorial navigation must not invent an arrival");
  assert.equal(sample.prepareTutorialStep(state, 3).assessment.additional_information, "A locally edited answer");
});

test("denied and under-review samples never silently become accepted", () => {
  for (const outcome of ["declined", "under-review"]) {
    let state = sample.createTutorialReferral();
    if (outcome === "declined") state.referral.admissionDecision = sample.tutorialDecision(state, "declined");
    else state.underReview = true;
    state = sample.prepareTutorialStep(state, 8);
    assert.equal(state.referral.actualAdmissionDate, undefined);
    assert.notEqual(state.referral.admissionDecision?.outcome, "accepted");
    assert.equal(state.sentAt, null);
  }
});

test("restart produces independent original data", () => {
  const first = sample.prepareTutorialStep(sample.createTutorialReferral(), 8);
  first.assessment.additional_information = "Changed";
  first.referral.name = "Changed";
  first.sentAt = new Date().toISOString();
  first.packetRecipient = "changed@example.invalid";
  const reset = sample.createTutorialReferral();
  assert.equal(reset.referral.name, "Taylor Rivera");
  assert.notEqual(reset.assessment.additional_information, "Changed");
  assert.equal(reset.referral.admissionDecision, undefined);
  assert.equal(reset.referral.actualAdmissionDate, undefined);
  assert.equal(reset.sentAt, null);
  assert.equal(reset.packetRecipient, "community@example.invalid");
});

test("instructions describe the recorded outcome, not a fictional completion", () => {
  const state = sample.createTutorialReferral();
  assert.match(sample.tutorialStepInstruction(state, 7), /has not been sent/);
  state.referral.admissionDecision = sample.tutorialDecision(state, "accepted");
  const acceptedInstruction = sample.tutorialStepInstruction(state, 5);
  assert.match(acceptedInstruction, /Review the email and packet now/);
  assert.match(acceptedInstruction, /add the planned admission date before sending/);
  assert.match(acceptedInstruction, /Acceptance alone does not send anything/);
  state.sentAt = new Date().toISOString();
  assert.match(sample.tutorialStepInstruction(state, 6), /Simulated send complete/);
  assert.match(sample.tutorialStepInstruction(state, 7), /awaiting admission/);
  assert.match(sample.tutorialStepInstruction(state, 8), /does not mark someone admitted/);
  state.sentAt = null;
  state.referral.admissionDecision = sample.tutorialDecision(state, "declined");
  assert.match(sample.tutorialStepInstruction(state, 5), /Denied/);
  assert.match(sample.tutorialStepInstruction(state, 8), /denied sample/);
  state.referral.admissionDecision = undefined;
  state.underReview = true;
  assert.match(sample.tutorialStepInstruction(state, 5), /Saved under review/);
  assert.match(sample.tutorialStepInstruction(state, 8), /remains under review/);
});

test("sticking-point help follows the decision and packet state", () => {
  const state = sample.createTutorialReferral();
  assert.match(sample.tutorialStepHelp(state, 5)[0].action, /Record decision/);
  state.underReview = true;
  assert.match(sample.tutorialStepHelp(state, 6)[0].action, /no admission packet/);
  state.underReview = false;
  state.referral.admissionDecision = sample.tutorialDecision(state, "accepted");
  state.sentAt = new Date().toISOString();
  assert.match(sample.tutorialStepHelp(state, 5)[0].action, /locked/);
  assert.doesNotMatch(sample.tutorialStepHelp(state, 5)[0].action, /Change sample decision/);
  assert.match(sample.tutorialStepHelp(state, 6)[0].action, /simulated send/);
});

test("instructions are short and steps have distinct names", () => {
  assert.equal(new Set(sample.tutorialReferralSteps.map((step) => step.title)).size, sample.tutorialReferralSteps.length);
  for (const step of sample.tutorialReferralSteps) {
    assert.ok(step.instruction.split(/\s+/).length <= 25, step.title);
    assert.ok(step.target);
  }
});
