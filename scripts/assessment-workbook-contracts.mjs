import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const contract = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-workbook-contract.ts", { crypto: webcrypto });
const tool = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-tool-schema.ts");
const archive = unzipSync(new Uint8Array(readFileSync("public/templates/pipeline-assessment-workbook.xlsx")));
const text = (path) => strFromU8(archive[path]);
const fingerprint = await contract.assessmentWorkbookFingerprint();
const keys = contract.assessmentWorkbookFields.map((f) => f.key);
assert.equal(new Set(keys).size, keys.length, "Duplicate mapped field");
assert.equal([...keys].sort().join(","), tool.assessmentToolFieldDefinitions.map((f) => f.key).sort().join(","), "Unmapped assessment field");
assert.ok(text("xl/worksheets/sheet14.xml").includes(fingerprint), "Excel is stale. Run npm run generate:assessment-workbook after changing the assessment.");
assert.ok(text("xl/worksheets/sheet14.xml").includes(contract.assessmentBackupVersion));
assert.match(text("xl/workbook.xml"), /name="Pipeline_Data"[^>]*state="veryHidden"/);
const styles = text("xl/styles.xml");
assert.match(styles, /protection locked="0"/);
for (const [index, section] of contract.assessmentWorkbookLayout.entries()) {
  const xml = text(`xl/worksheets/sheet${index + 2}.xml`);
  assert.match(xml, /sheetProtection sheet="1"/);
  assert.match(xml, /state="frozen"/);
  assert.match(xml, /fitToWidth="1"/);
  for (const field of section.fields) {
    assert.ok(xml.includes(`>${field.key}<`), `Missing mapping ${field.key}`);
    assert.ok(xml.includes(`r="C${field.row}"`), `Missing answer ${field.key}`);
    if (field.question?.options && field.question.control !== "multi_select") assert.ok(xml.includes(`sqref="C${field.row}"`), `Missing choices ${field.key}`);
  }
}
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
