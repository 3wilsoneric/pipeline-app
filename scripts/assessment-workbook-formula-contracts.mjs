import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

// Authoring-time proof against the saved Excel formulas, independent of their
// cached values. This runtime is not required by the app or its build.
const runtime = process.env.PIPELINE_ARTIFACT_MODULES || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const requireArtifact = createRequire(path.join(runtime, "_authoring.cjs"));
const { SpreadsheetFile, FileBlob } = await import(requireArtifact.resolve("@oai/artifact-tool"));
const load = (file) => loadTypeScriptModule(process.cwd(), `lib/assessment/${file}.ts`);
const { assessmentWorkbookFields: fields, assessmentWorkbookLayout: layout } = load("assessment-workbook-contract");
const { getAssessmentQuestionConditions, assessmentInterviewQuestions } = load("assessment-interview-schema");
const { createEmptyAssessmentToolData } = load("assessment-tool-schema");
const { workbookFieldStatus } = load("assessment-workbook-presentation");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load("public/templates/pipeline-assessment-workbook.xlsx"));
let previous = [];
let checks = 0;

function verify(patch, target) {
  const data = { ...createEmptyAssessmentToolData(), ...patch };
  for (const key of new Set([...previous, ...Object.keys(patch), ...Object.keys(data.unable_to_assess_reasons)])) {
    const field = fields.find((f) => f.key === key);
    if (!field || field.value_type === "reason_map") continue;
    const sheet = workbook.worksheets.getItem(field.sheet);
    const label = (value) => field.question?.options?.find((option) => option.value === value)?.label ?? value;
    const value = data[key];
    sheet.getRange(`C${field.row}`).values = [[Array.isArray(value) ? value.map(label).join("\n") : label(value) ?? ""]];
    sheet.getRange(`D${field.row}`).values = [[data.unable_to_assess_reasons[key] ?? ""]];
  }
  previous = [...Object.keys(patch), ...Object.keys(data.unable_to_assess_reasons)];
  const field = fields.find((f) => f.key === target);
  const actual = workbook.worksheets.getItem(field.sheet).getRange(`E${field.row}`).values[0][0];
  assert.equal(actual, workbookFieldStatus(field, data), `${target}: ${JSON.stringify(patch)}`);
  const sectionIndex = layout.findIndex((s) => s.sheet === field.sheet);
  const sectionChecks = layout[sectionIndex].fields.map((f) => workbookFieldStatus({ ...f, sheet: field.sheet }, data));
  const context = `${target}: ${JSON.stringify(patch)}`;
  for (const [sheet, firstRow] of [["Start Here", 16], [layout.at(-1).sheet, 18]]) {
    assert.equal(workbook.worksheets.getItem(sheet).getRange(`C${firstRow + sectionIndex}`).values[0][0], sectionChecks.filter((s) => ["Needs answer", "Explain why"].includes(s)).length, `${context}; ${sheet} missing total`);
    assert.equal(workbook.worksheets.getItem(sheet).getRange(`D${firstRow + sectionIndex}`).values[0][0], sectionChecks.filter((s) => s.startsWith("Review")).length, `${context}; ${sheet} review total`);
  }
  checks++;
}

for (const field of fields.filter((f) => f.question?.showWhen)) {
  const active = {};
  const rules = getAssessmentQuestionConditions(field.question);
  for (const rule of rules) {
    const alternative = assessmentInterviewQuestions.find((q) => q.field === rule.field)?.options?.find((o) => o.value !== rule.value)?.value;
    active[rule.field] = rule.operator === "includes" ? [rule.value] : rule.operator === "one_of" ? rule.value[0] : rule.operator === "not_equals" ? alternative : rule.value;
  }
  verify(active, field.key);
  const value = field.value_type === "integer" ? 0 : field.value_type === "string_list" ? ["Synthetic answer"] : "Synthetic retained answer";
  verify({ ...active, [field.key]: value }, field.key);
  for (const rule of rules) {
    const choices = assessmentInterviewQuestions.find((question) => question.field === rule.field)?.options ?? [];
    for (const answer of [null, ...choices.map((choice) => rule.operator === "includes" ? [choice.value] : choice.value)]) {
      verify({ ...active, [rule.field]: answer }, field.key);
      verify({ ...active, [rule.field]: answer, [field.key]: value }, field.key);
    }
  }
}
verify({ diabetic: "unable_to_assess" }, "diabetic");
verify({ diabetic: "unable_to_assess", unable_to_assess_reasons: { diabetic: "Client requested a break." } }, "diabetic");
verify({ diabetic: "no", unable_to_assess_reasons: { diabetic: "Earlier reason retained." } }, "diabetic");
verify({ prior_hospitalizations_count: 0 }, "prior_hospitalizations_count");
verify({ arrest_history: "no", arrest_in_last_two_years: "yes" }, "arrest_last_two_years_details");
verify({}, "resident_name");
console.log(`Excel formula parity verified: ${checks} live states, with section totals recalculated.`);

if (process.argv.includes("--render")) {
  const out = path.resolve("outputs/assessment-excel");
  for (const section of [{ sheet: "Start Here" }, ...layout]) {
    const preview = await workbook.render({ sheetName: section.sheet, range: section.sheet === "Start Here" ? "B1:E27" : "B1:E10", scale: 1, format: "png" });
    await fs.writeFile(path.join(out, `${section.sheet.replaceAll(" ", "-")}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
  const finish = await workbook.render({ sheetName: layout.at(-1).sheet, range: "B16:E36", scale: 1, format: "png" });
  await fs.writeFile(path.join(out, "finish-checklist.png"), new Uint8Array(await finish.arrayBuffer()));
  const reference = await workbook.render({ sheetName: "Codebook", range: "B1:D15", scale: 1, format: "png" });
  await fs.writeFile(path.join(out, "answer-reference.png"), new Uint8Array(await reference.arrayBuffer()));
}
