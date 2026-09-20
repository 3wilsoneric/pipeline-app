import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const types = loadTypeScriptModule(process.cwd(), "lib/pipeline/user-workspace-state-types.ts");
const validation = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-validation.ts");
const schema = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-tool-schema.ts");
// These pure save helpers need no authentication effects or browser singleton.
const state = {};
const stateSource = ts.transpileModule(readFileSync("components/pipeline/assessment-workspace-state.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
new Function("exports", "require", stateSource)(state, () => ({}));
const source = { export_id: "0cb2b2ac-cb04-4444-9999-888888888888", exported_at: "2026-09-19T18:00:00.000Z" };
const secondSource = { ...source, export_id: "0cb2b2ac-cb04-4444-9999-777777777777" };
const data = { ...schema.createEmptyAssessmentToolData(), prior_placements: "Synthetic imported placements" };
const draft = { schema: 1, assessmentId: "synthetic-workbook", savedAt: source.exported_at, baseVersion: 1,
  sectionVersions: {}, dirtySections: ["prior_history"], data, baseData: schema.createEmptyAssessmentToolData() };

test("legacy drafts remain valid and per-field workbook source survives canonical draft parsing", () => {
  assert.ok(types.parsePipelineAssessmentDraft(draft));
  const workbookSources = { prior_placements: source };
  assert.equal(JSON.stringify(types.parsePipelineAssessmentDraft({ ...draft, workbookSources }).workbookSources), JSON.stringify(workbookSources));
});

test("a whole-assessment restore supports every canonical section but not duplicates or unknown sections", () => {
  assert.ok(types.parsePipelineAssessmentDraft({ ...draft, dirtySections: schema.assessmentToolSections }));
  assert.equal(types.parsePipelineAssessmentDraft({ ...draft, dirtySections: ["identity", "identity"] }), null);
  assert.equal(types.parsePipelineAssessmentDraft({ ...draft, dirtySections: ["unknown"] }), null);
});

for (const [label, workbookSources] of [
  ["unknown field", { unknown: source }],
  ["array", [source]],
  ["oversized identifier", { prior_placements: { ...source, export_id: "a".repeat(5000) } }],
  ["invalid timestamp", { prior_placements: { ...source, exported_at: "not-a-date" } }],
  ["extra metadata", { prior_placements: { ...source, arbitrary: "not permitted" } }],
  ["missing metadata", { prior_placements: {} }],
]) {
  test(`rejects ${label} in recovery source`, () => { assert.equal(types.parsePipelineAssessmentDraft({ ...draft, workbookSources }), null); });
}

test("workbook PATCH and recovery share bounded source validation", () => {
  assert.equal(validation.validateAssessmentPatchRequest({ if_match: 1, patch: { data: { prior_placements: "Synthetic" }, workbook_restore: source } }).ok, true);
  assert.equal(validation.validateAssessmentPatchRequest({ if_match: 1, patch: { data: { prior_placements: "Synthetic" }, workbook_restore: { ...source, extra: true } } }).ok, false);
});

test("section flush separates manual answers and distinct workbook copies", () => {
  const values = { prior_placements: "Imported one", crisis_er_utilization: "Imported two", prior_awol_failed_placements: "Manual" };
  const groups = state.assessmentSaveGroups(values, { ...data, ...values }, { prior_placements: source, crisis_er_utilization: secondSource });
  assert.equal(JSON.stringify(groups), JSON.stringify([
    { data: { prior_placements: "Imported one" }, workbook_restore: source },
    { data: { crisis_er_utilization: "Imported two" }, workbook_restore: secondSource },
    { data: { prior_awol_failed_placements: "Manual" } },
  ]));
});

test("an older queued value never borrows a newer import's provenance", () => {
  const groups = state.assessmentSaveGroups({ prior_placements: "Older manual" }, data, { prior_placements: source });
  assert.equal(groups[0].workbook_restore, undefined);
});

test("only the acknowledged current workbook answer loses pending source", () => {
  const sources = { prior_placements: source, crisis_er_utilization: secondSource };
  const sent = { prior_placements: data.prior_placements, crisis_er_utilization: null };
  const remaining = state.acknowledgeAssessmentWorkbookSave(sources, data, sent, source);
  assert.equal(remaining.prior_placements, undefined);
  assert.equal(JSON.stringify(remaining.crisis_er_utilization), JSON.stringify(secondSource));
  assert.equal(JSON.stringify(state.acknowledgeAssessmentWorkbookSave(sources, { ...data, prior_placements: "Newer answer" }, sent, source)), JSON.stringify(sources));
  assert.equal(JSON.stringify(state.acknowledgeAssessmentWorkbookSave(sources, data, sent, undefined)), JSON.stringify(sources));
});
