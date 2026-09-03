import assert from "node:assert/strict";
import process from "node:process";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const assistant = loadTypeScriptModule(root, "lib/pipeline/pipeline-question-assistant.ts");

const checks = [];
function check(name, callback) {
  callback();
  checks.push(name);
  console.log(`PASS ${name}`);
}

check("ordinary names remain record searches", () => {
  assert.equal(assistant.interpretPipelineQuestion("Antonia Albarran"), null);
  assert.equal(assistant.interpretPipelineQuestion("Santa Clarita"), null);
});

check("a short punctuated workflow topic is treated as a question", () => {
  const result = assistant.interpretPipelineQuestion("documents?");
  assert.equal(result?.kind, "answer");
  assert.equal(result?.intent.id, "manage-documents");
});

check("assignment typos produce a deterministic did-you-mean choice", () => {
  const result = assistant.interpretPipelineQuestion("how do i assine an assesment to an assesor?");
  assert.equal(result?.kind, "clarify");
  assert.equal(result?.options[0].id, "assign-assessor");
  assert.equal(result?.options[0].action.type, "navigate");
  assert.equal(result?.options[0].action.screen, "referrals");
});

check("an ambiguous assessment question asks for clarification", () => {
  const result = assistant.interpretPipelineQuestion("assessment");
  assert.equal(result?.kind, "clarify");
  assert.equal(
    result?.options.map((option) => option.id).join(","),
    "begin-assessment,finish-assessment,schedule-assessment",
  );
});

check("workflow questions map to fixed answers and actions", () => {
  const cases = [
    ["How do I create a new referral?", "create-referral", "packet"],
    ["Where is my queue?", "find-my-work", "my_work"],
    ["How do I schedule the interview?", "schedule-assessment", "ready_to_schedule"],
    ["Where can I see assessor performance reports?", "use-reports", "operations"],
    ["What belongs on the assessment calendar?", "use-calendar", "calendar"],
    ["How do I find a client profile?", "find-client", "profiles"],
    ["How do I upload a face sheet?", "manage-documents", "files"],
    ["What information is still missing?", "review-missing-data", "referrals"],
  ];
  for (const [query, intentId, destination] of cases) {
    const result = assistant.interpretPipelineQuestion(query);
    assert.equal(result?.kind, "answer", query);
    assert.equal(result?.intent.id, intentId, query);
    assert.equal(result?.intent.action.type === "navigate" ? result.intent.action.screen : result?.intent.action.mode, destination, query);
  }
});

check("unsupported questions never invent an answer", () => {
  const result = assistant.interpretPipelineQuestion("How do I change my Microsoft password?");
  assert.equal(result?.kind, "unsupported");
  assert.equal(result?.options.length, 3);
});

check("returned intents expose no internal matching vocabulary", () => {
  const result = assistant.interpretPipelineQuestion("How do I finish an assessment?");
  assert.equal(result?.kind, "answer");
  assert.equal("phrases" in result.intent, false);
  assert.equal("keywords" in result.intent, false);
});

console.log(`\n${checks.length} deterministic question-assistant checks passed.`);
