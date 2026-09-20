import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const catalog = loadTypeScriptModule(root, "lib/training/operator-guided-tutorials.ts");
const state = loadTypeScriptModule(root, "lib/training/operator-guided-tour-state.ts");
const navigation = loadTypeScriptModule(root, "lib/training/operator-guide-navigation.ts");
const packet = "/?view=referrals&screen=packet";

test("every guide has distinct steps, local routes, and real source anchors", () => {
  assert.equal(new Set(catalog.operatorGuidedTutorialIds).size, catalog.operatorGuidedTutorials.length);
  for (const guide of catalog.operatorGuidedTutorials) {
    assert.equal(new Set(guide.steps.map((step) => step.id)).size, guide.steps.length);
    for (const step of guide.steps) {
      assert.ok(step.route.startsWith("/?") || step.route === "/");
      assert.ok(step.completion?.length > 30, "Expected screen result: " + step.id);
      assert.notEqual(step.completion, "Walkthrough step reviewed.");
      assert.ok(!/language lab|defensible assessment|finding, source, timeframe/i.test(step.instruction));
      const file = catalog.operatorGuideTargetSources[step.target];
      assert.ok(file, step.target);
      assert.ok(readFileSync(root + "/" + file, "utf8").includes(step.target), step.target);
      if (/sign|decision|packet-send|export/.test(step.id)) assert.equal(step.advance, "confirm");
    }
  }
});

test("jumping preserves reviewed steps without crediting skipped work", () => {
  let current = state.reduceOperatorGuideState(state.emptyOperatorGuideState(), { type: "start", tutorialId: "complete-assessment" });
  current = state.reduceOperatorGuideState(current, { type: "next" });
  const reviewed = [...current.reviewedStepIds];
  current = state.reduceOperatorGuideState(current, { type: "go-to-step", stepIndex: 4 });
  assert.equal(current.stepIndex, 4);
  assert.deepEqual([...current.reviewedStepIds], reviewed);
  assert.equal(state.operatorGuideCanComplete(current), false);
  current = state.reduceOperatorGuideState(current, { type: "go-to-step", stepIndex: 0 });
  assert.deepEqual([...current.reviewedStepIds], reviewed);
});

test("skips and mid-guide starts do not receive completion credit", () => {
  const guide = catalog.getOperatorGuidedTutorial("complete-assessment");
  let current = state.reduceOperatorGuideState(state.emptyOperatorGuideState(), { type: "start", tutorialId: guide.id });
  for (let index = 0; index < guide.steps.length - 1; index++) {
    current = state.reduceOperatorGuideState(current, { type: "next", skipped: index === 1 });
  }
  assert.equal(state.operatorGuideCanComplete(current), false);
  current = state.reduceOperatorGuideState(current, { type: "finish" });
  assert.equal(current.completedTutorialIds.includes(guide.id), false);
  current = state.reduceOperatorGuideState(current, { type: "start", tutorialId: guide.id, stepIndex: guide.steps.length - 1 });
  assert.equal(state.operatorGuideCanComplete(current), false);
  current = state.reduceOperatorGuideState(current, { type: "restart" });
  for (let index = 0; index < guide.steps.length - 1; index++) current = state.reduceOperatorGuideState(current, { type: "next" });
  assert.equal(state.operatorGuideCanComplete(current, true), false);
  assert.equal(state.operatorGuideCanComplete(current), true);
  current = state.reduceOperatorGuideState(current, { type: "finish" });
  assert.equal(current.completedTutorialIds.includes(guide.id), true);
});

test("workspace routes retain identity and use the canonical location switch", () => {
  const current = packet + "&referralId=42&workspaceStage=assessment&assessmentSection=functional_adl&assessmentMode=review";
  const files = navigation.resolveGuideDestination(packet + "&workspaceView=files", current, "workspace");
  const params = new URL(files, "https://test.invalid").searchParams;
  assert.equal(params.get("referralId"), "42");
  assert.equal(params.get("workspaceView"), "files");
  assert.equal(params.has("workspaceStage"), false);
  assert.equal(params.has("assessmentSection"), false);
  assert.equal(params.has("assessmentMode"), false);
  assert.equal(navigation.resolveGuideDestination(packet, "/", "workspace"), null);
  assert.equal(navigation.resolveGuideDestination(packet, packet + "&draftId=unsaved", "workspace"), null);
  assert.equal(navigation.resolveGuideDestination(packet, "/", "app"), null);
});

test("fresh practice never inherits a live referral or an old draft", () => {
  const route = packet + "&workspaceStage=assessment&trainingAssessment=interview";
  const fresh = navigation.resolveGuideDestination(route, packet + "&referralId=42&draftId=live", "practice", "fresh-practice");
  const params = new URL(fresh, "https://test.invalid").searchParams;
  assert.equal(params.get("draftId"), "fresh-practice");
  assert.equal(params.has("referralId"), false);
  const next = navigation.resolveGuideDestination(route, fresh, "practice");
  assert.equal(new URL(next, "https://test.invalid").searchParams.get("draftId"), "fresh-practice");
  const review = navigation.resolveGuideDestination(packet + "&workspaceStage=assessment&assessmentMode=review", fresh, "workspace");
  assert.equal(new URL(review, "https://test.invalid").searchParams.get("trainingAssessment"), "interview");
  assert.equal(navigation.resolveGuideDestination("/", fresh, "app"), "/");
});

test("Home is not a wildcard and report guides follow the role catalog", () => {
  assert.equal(navigation.guideRouteMatches("/", packet), false);
  assert.equal(navigation.guideRouteMatches("/", "/"), true);
  assert.equal(navigation.guideRouteMatches(packet, packet + "&referralId=42"), true);
  assert.equal(catalog.guidedTutorialsForRoles(["reviewer"]).some((guide) => guide.id === "run-report"), false);
  assert.equal(catalog.guidedTutorialsForRoles(["admin"]).some((guide) => guide.id === "run-report"), true);
  assert.match(readFileSync(root + "/app/(pipeline)/training/layout.tsx", "utf8"), /redirect\(toPipelinePath\("\/"\)\)/);
});
