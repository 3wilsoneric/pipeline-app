import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const contract = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-workbook-contract.ts", { crypto: webcrypto });
const tool = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-tool-schema.ts");
const interview = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-interview-schema.ts");
const presentation = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-workbook-presentation.ts");
const completion = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-completion.ts");
const archive = unzipSync(new Uint8Array(readFileSync("public/templates/pipeline-assessment-workbook.xlsx")));
const text = (path) => strFromU8(archive[path]);
const unescapeXml = (value) => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity]);
const fingerprint = await contract.assessmentWorkbookFingerprint();
const keys = contract.assessmentWorkbookFields.map((f) => f.key);
assert.equal(new Set(keys).size, keys.length, "Duplicate mapped field");
assert.equal([...keys].sort().join(","), tool.assessmentToolFieldDefinitions.map((f) => f.key).sort().join(","), "Unmapped assessment field");
assert.ok(text("xl/worksheets/sheet14.xml").includes(fingerprint), "Excel is stale. Run npm run generate:assessment-workbook after changing the assessment.");
assert.ok(text("xl/worksheets/sheet14.xml").includes(contract.assessmentBackupVersion));
assert.match(text("xl/workbook.xml"), /name="Pipeline_Data"[^>]*state="veryHidden"/);
assert.equal(contract.assessmentWorkbookLayout.map((s) => s.key).join(","), interview.assessmentConversationSections.map((s) => s.key).join(","));
assert.equal(contract.assessmentWorkbookLayout.map((s) => s.label).join(","), interview.assessmentConversationSections.map((s) => s.label).join(","));
assert.match(text("xl/workbook.xml"), /calcMode="auto"/);
const styles = text("xl/styles.xml");
assert.match(styles, /protection locked="0"/);
const styleTable = styles.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
const styleCount = Number(styleTable[1].match(/\bcount="(\d+)"/)[1]);
const styleEntries = styleTable[2].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g);
assert.equal(styleCount, (styleTable[2].match(/<xf\b/g) ?? []).length, "Workbook style count does not match its entries");
const formats = new Map([...styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]+)"/g)].map((match) => [match[1], match[2]]));
for (const [index, section] of contract.assessmentWorkbookLayout.entries()) {
  const xml = text(`xl/worksheets/sheet${index + 2}.xml`);
  assert.match(xml, /sheetProtection sheet="1"/);
  assert.match(xml, /state="frozen"/);
  assert.match(xml, /fitToWidth="1"/);
  for (const field of section.fields) {
    assert.ok(xml.includes(`>${field.key}<`), `Missing mapping ${field.key}`);
    assert.ok(xml.includes(`r="C${field.row}"`), `Missing answer ${field.key}`);
    const checkCell = xml.match(new RegExp(`<c\\b[^>]*r="E${field.row}"[^>]*>([\\s\\S]*?)<\\/c>`))?.[1];
    const formula = checkCell?.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
    assert.ok(formula, `Missing live guidance for ${field.key}`);
    assert.equal(unescapeXml(formula), presentation.workbookFieldStatusFormula({ ...field, sheet: section.sheet }).slice(1), `Stale guidance for ${field.key}. Regenerate the workbook.`);
    for (const cell of [...Array.from({ length: field.chunks }, (_, offset) => `C${field.row + offset}`), `D${field.row}`]) {
      const tag = xml.match(new RegExp(`<c\\b[^>]*\\br="${cell}"[^>]*>`))?.[0];
      const style = styleEntries[Number(tag?.match(/\bs="(\d+)"/)?.[1] ?? 0)];
      assert.ok(style, `Missing style for ${field.key} ${cell}`);
      assert.equal(/<protection\b[^>]*locked="0"/.test(style), field.editable, `Incorrect editability for ${field.key} ${cell}`);
      if (cell !== `C${field.row}`) continue;
      const expectedFormat = field.value_type === "date" ? "yyyy-mm-dd" : field.value_type === "integer" ? "0" : field.value_type === "confidence" ? "0.00" : "@";
      assert.equal(formats.get(style.match(/\bnumFmtId="(\d+)"/)[1]), expectedFormat, `Incorrect answer format for ${field.key}`);
    }
    if (field.question?.options && field.question.control !== "multi_select") assert.ok(xml.includes(`sqref="C${field.row}"`), `Missing choices ${field.key}`);
  }
}
for (const key of ["source_file", "match_confidence", "extraction_date", "unable_to_assess_reasons"]) {
  const field = contract.assessmentWorkbookFields.find((f) => f.key === key);
  assert.match(text("xl/worksheets/sheet13.xml"), new RegExp(`<row\\b[^>]*r="${field.row}"[^>]*hidden="1"`));
}
const residentNumber = contract.assessmentWorkbookFields.find((f) => f.key === "resident_number");
assert.equal(residentNumber.editable, false, "Resident number is an internal identity, not an assessment answer");
assert.match(text("xl/worksheets/sheet2.xml"), new RegExp(`<row\\b[^>]*r="${residentNumber.row}"[^>]*hidden="1"`));
assert.ok(!text("xl/worksheets/sheet15.xml").includes(">Resident number<"), "Internal identity must not appear in the answer reference");
assert.match(text("xl/worksheets/sheet13.xml"), /Before you upload/);
assert.match(text("xl/worksheets/sheet13.xml"), /COUNTIF/);
assert.ok(text("xl/worksheets/sheet13.xml").indexOf("<hyperlinks>") < text("xl/worksheets/sheet13.xml").indexOf("<pageMargins"), "Checklist links must precede print settings in worksheet XML");

let branches = 0;
for (const field of contract.assessmentWorkbookFields.filter((f) => f.question?.showWhen)) {
  const active = tool.createEmptyAssessmentToolData();
  const rules = interview.getAssessmentQuestionConditions(field.question);
  for (const rule of rules) {
    const option = interview.assessmentInterviewQuestions.find((q) => q.field === rule.field)?.options?.find((o) => o.value !== rule.value)?.value;
    active[rule.field] = rule.operator === "includes" ? [rule.value] : rule.operator === "one_of" ? rule.value[0] : rule.operator === "not_equals" ? option : rule.value;
  }
  assert.equal(interview.isAssessmentQuestionVisible(field.question, active), true, `${field.key} must become applicable`);
  for (const rule of rules) {
    const inactive = { ...active, [rule.field]: null };
    assert.equal(interview.isAssessmentQuestionVisible(field.question, inactive), false, `${field.key} must respect parent ${rule.field}`);
    assert.equal(presentation.workbookFieldStatus(field, inactive), "Not applicable");
    inactive[field.key] = field.value_type === "integer" ? 0 : field.value_type === "string_list" ? ["Synthetic retained answer"] : "Synthetic retained answer";
    assert.equal(presentation.workbookFieldStatus(field, inactive), "Review previous answer");
    branches++;
  }
}
const field = (key) => contract.assessmentWorkbookFields.find((item) => item.key === key);
const unable = { ...tool.createEmptyAssessmentToolData(), diabetic: "unable_to_assess" };
assert.equal(presentation.workbookFieldStatus(field("diabetic"), unable), "Explain why");
unable.unable_to_assess_reasons.diabetic = "Client requested a break.";
assert.equal(presentation.workbookFieldStatus(field("diabetic"), unable), "Answered");
unable.diabetic = "no";
assert.equal(presentation.workbookFieldStatus(field("diabetic"), unable), "Review previous reason");
const nested = { ...tool.createEmptyAssessmentToolData(), arrest_history: "no", arrest_in_last_two_years: "yes" };
assert.equal(completion.getAssessmentCompletionSummary(nested).missing.some((rule) => rule.fields.includes("arrest_last_two_years_details")), false);
assert.equal(presentation.workbookFieldStatus(field("prior_hospitalizations_count"), { ...tool.createEmptyAssessmentToolData(), prior_hospitalizations_count: 0 }), "Answered");
console.log(`Conditional guidance verified: ${branches} parent branches, nested follow-ups, retained answers, reasons and zero values.`);
console.log(`Excel coverage and freshness verified: ${keys.length} fields, ${contract.assessmentWorkbookLayout.length} sections, ${fingerprint}.`);

const sample = contract.assessmentWorkbookLayout.flatMap((s) => s.fields).find((f) => f.question?.options?.length);
const originalLabel = sample.question.label;
sample.question.label = `${originalLabel} changed`;
assert.notEqual(await contract.assessmentWorkbookFingerprint(), fingerprint, "Question changes must invalidate the workbook");
sample.question.label = originalLabel;
const originalChoice = sample.question.options[0].label;
sample.question.options[0].label = `${originalChoice} changed`;
assert.notEqual(await contract.assessmentWorkbookFingerprint(), fingerprint, "Choice changes must invalidate the workbook");
sample.question.options[0].label = originalChoice;
