import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

// Authoring-only runtime, never shipped to browsers or production servers.
const runtime = process.env.PIPELINE_ARTIFACT_MODULES || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const requireArtifact = createRequire(path.join(runtime, "_authoring.cjs"));
const { Workbook, SpreadsheetFile, FileBlob } = await import(requireArtifact.resolve("@oai/artifact-tool"));
const contract = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-workbook-contract.ts", { crypto: webcrypto });
const { assessmentWorkbookLayout: layout, assessmentWorkbookFields: fields } = contract;
const presentation = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-workbook-presentation.ts");
const { workbookFieldStatusFormula } = presentation;
const fingerprint = await contract.assessmentWorkbookFingerprint();
const out = path.resolve("outputs/assessment-excel");
await fs.mkdir(out, { recursive: true });
const workbook = Workbook.create();
const start = workbook.worksheets.add("Start Here");
for (const section of layout) workbook.worksheets.add(section.sheet);
const data = workbook.worksheets.add("Pipeline_Data");
const codebook = workbook.worksheets.add("Codebook");
const emerald = "#12644F", ink = "#233B32";

function conditionalGuidance(rule) {
  if (!rule) return "";
  const parent = fields.find((f) => f.key === rule.field);
  const labels = (Array.isArray(rule.value) ? rule.value : [rule.value]).map((v) => parent?.question?.options?.find((o) => o.value === v)?.label ?? String(v));
  const relation = { equals: "is", includes: "includes", not_equals: "is not", one_of: "is" }[rule.operator];
  return `Only if ${parent?.label ?? rule.field} ${relation} ${labels.join(" or ")}.`;
}

const wrappedLines = (text, width) => text.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / width)), 0);

function base(sheet, lastRow) {
  sheet.showGridLines = false;
  sheet.tabColor = emerald;
  sheet.getRange(`A1:E${lastRow}`).format.font = { name: "Arial", size: 12, color: ink };
  sheet.getRange(`A1:E${lastRow}`).format.verticalAlignment = "top";
  sheet.getRange(`A1:E${lastRow}`).format.wrapText = true;
  sheet.getRange("A:A").format.columnWidth = 3;
  sheet.getRange("B:B").format.columnWidth = 34;
  sheet.getRange("C:C").format.columnWidth = 49;
  sheet.getRange("D:D").format.columnWidth = 20;
  sheet.getRange("E:E").format.columnWidth = 19;
  sheet.getRange("B1:E1").format.font = { name: "Arial", size: 18, bold: true, color: emerald };
  sheet.getRange("B1:E1").format.rowHeight = 30;
  sheet.getRange("B2:E3").format.rowHeight = 24;
}
base(start, 27);
start.getRange("B1").values = [["Assessment working copy"]];
start.mergeCells("B1:E1");
start.getRange("B2").values = [["Download from the assessment to include current answers."]];
start.getRange("B3").values = [["The saved time will appear here."]];
start.mergeCells("B2:E2"); start.mergeCells("B3:E3");
const instructions = [
  "1. Open your current section below. The order matches the assessment in Pipeline.",
  "2. Edit the Answer cells. Choose from dropdowns; enter list items on separate lines.",
  "3. Check amber rows, save this file, then upload it to the same assessment and review the changes.",
  "Blank = not answered. If you cannot assess a question, select Unable to assess and explain why beside it.",
  "Not applicable = skip. Review previous answer = an earlier detail no longer fits; it has not been deleted.",
  "This copy does not update itself or sign the assessment. Keep it in approved secure storage.",
  "Long notes stay in the cell. Expand its row to read more; existing continuation rows remain mapped.",
];
instructions.forEach((line, i) => { start.mergeCells(`B${i + 5}:E${i + 5}`); start.getRange(`B${i + 5}`).values = [[line]]; start.getRange(`B${i + 5}:E${i + 5}`).format.rowHeight = 29; });
const fieldGuidance = new Map();
for (const [i, section] of layout.entries()) {
  const sheet = workbook.worksheets.getItem(section.sheet);
  base(sheet, section.key === "provenance_qc" ? 36 : section.lastRow);
  sheet.freezePanes.freezeRows(5);
  sheet.getRange("B1").values = [[section.label]];
  sheet.mergeCells("B1:C1");
  sheet.getRange("D1").values = [[`Section ${i + 1} of ${layout.length}`]];
  sheet.mergeCells("D1:E1");
  sheet.getRange("D1:E1").format.font = { name: "Arial", size: 11, color: "#596E63" };
  sheet.getRange("B2").values = [["Client name"]];
  sheet.getRange("C2").values = [["Copy saved time"]];
  sheet.mergeCells("C2:E2");
  sheet.mergeCells("B3:E3");
  sheet.getRange("B3").values = [["Answer the applicable questions. Amber = needs attention; gray = not applicable. Keep rows in place."]];
  sheet.getRange("B3:E3").format.font = { name: "Arial", size: 10, color: "#5D6C64" };
  sheet.getRange("B4:E4").format.rowHeight = 7;
  sheet.getRange("B5:E5").values = [["Question", "Answer", "Why unable?", "Check"]];
  sheet.getRange("B5:E5").format = { fill: emerald, font: { name: "Arial", size: 11, bold: true, color: "#FFFFFF" }, rowHeight: 25 };
  for (const field of section.fields) {
    const { row, question } = field;
    const guidance = [conditionalGuidance(question?.showWhen), question?.help, question?.control === "multi_select" ? `One per line: ${question.options.map((o) => o.label).join("; ")}.` : "", field.editable ? "" : "Reference only."].filter(Boolean).join("\n");
    fieldGuidance.set(field.key, guidance);
    sheet.getRange(`A${row}:D${row}`).values = [[field.key, field.label + (guidance ? `\n${guidance}` : ""), "", ""]];
    sheet.getRange(`B${row}:E${row}`).format.rowHeight = Math.max(question?.control === "textarea" || field.value_type === "string_list" ? 72 : 34, wrappedLines(field.label, 32) * 15 + (guidance ? wrappedLines(guidance, 40) * 12 : 0) + 12);
    sheet.getRange(`B${row}`).format.font = { name: "Arial", size: 12, bold: !guidance, color: ink };
    sheet.getRange(`C${row}`).format.fill = field.editable ? "#F0F7F3" : "#EFF1F0";
    sheet.getRange(`D${row}:E${row}`).format.font = { name: "Arial", size: 10, color: "#59675F" };
    sheet.getRange(`D${row}`).format.fill = "#F5F6F5";
    sheet.getRange(`B${row}:E${row}`).format.borders = { bottom: { style: "thin", color: "#D8E3DC" } };
    sheet.getRange(`E${row}`).formulas = [[workbookFieldStatusFormula({ ...field, sheet: section.sheet })]];
    sheet.getRange(`B${row}:E${row}`).conditionalFormats.addCustom(`$E${row}="Not applicable"`, { fill: "#F1F3F2", font: { color: "#68756F" } });
    sheet.getRange(`E${row}`).conditionalFormats.addCustom(`OR($E${row}="Needs answer",$E${row}="Explain why",LEFT($E${row},6)="Review")`, { fill: "#FFF0CA", font: { color: "#70511D", bold: true } });
    if (question?.control === "yes_no") sheet.getRange(`D${row}`).conditionalFormats.addCustom(`OR($C${row}="Unable to assess",$C${row}="unable_to_assess")`, { fill: "#FFF6DF", font: { color: ink } });
    if (field.value_type === "date") sheet.getRange(`C${row}`).setNumberFormat("yyyy-mm-dd");
    else if (["integer", "confidence"].includes(field.value_type)) sheet.getRange(`C${row}`).setNumberFormat(field.value_type === "integer" ? "0" : "0.00");
    else sheet.getRange(`C${row}`).setNumberFormat("@");
    if (question?.options && question.control !== "multi_select") sheet.getRange(`C${row}`).dataValidation = { rule: { type: "list", values: question.options.map((o) => o.label) } };
    if (question?.control === "number" || question?.control === "rating") sheet.dataValidations.add({ range: `C${row}`, rule: { type: "whole", operator: "between", formula1: question.min ?? 0, formula2: question.max ?? 10000 } });
    for (let c = 1; c < field.chunks; c++) {
      sheet.getRange(`A${row + c}:D${row + c}`).values = [[`${field.key}:${c}`, `${field.label} (continued)`, "", ""]];
      sheet.getRange(`B${row + c}:D${row + c}`).format.rowHeight = 88;
      sheet.getRange(`C${row + c}`).setNumberFormat("@");
    }
  }
}
function sectionChecklist(sheet, firstRow) {
  sheet.getRange(`B${firstRow - 1}:E${firstRow - 1}`).values = [["Open section", "Missing answers / explanations", "Previous details to review", ""]];
  sheet.mergeCells(`D${firstRow - 1}:E${firstRow - 1}`);
  sheet.getRange(`B${firstRow - 1}:E${firstRow - 1}`).format = { fill: emerald, font: { name: "Arial", size: 11, bold: true, color: "#FFFFFF" }, rowHeight: 32, wrapText: true };
  layout.forEach((view, i) => {
    const row = firstRow + i;
    const checks = `'${view.sheet}'!E6:E${view.lastRow}`;
    sheet.getRange(`B${row}`).values = [[`${i + 1}. ${view.label}`]];
    sheet.getRange(`B${row}`).format.font = { name: "Arial", size: 12, color: emerald };
    sheet.getRange(`C${row}`).formulas = [[`=COUNTIF(${checks},"Needs answer")+COUNTIF(${checks},"Explain why")`]];
    sheet.getRange(`D${row}`).formulas = [[`=COUNTIF(${checks},"Review previous answer")+COUNTIF(${checks},"Review previous reason")`]];
    sheet.mergeCells(`D${row}:E${row}`);
    sheet.getRange(`B${row}:E${row}`).format.rowHeight = 32;
    sheet.getRange(`B${row}:E${row}`).format.borders = { bottom: { style: "thin", color: "#E3EAE6" } };
    sheet.getRange(`C${row}:E${row}`).format.horizontalAlignment = "center";
    sheet.getRange(`C${row}:D${row}`).setNumberFormat("0");
    sheet.getRange(`C${row}:D${row}`).conditionalFormats.add("cellIs", { operator: "greaterThan", formula: 0, format: { fill: "#FFF0CA", font: { color: "#70511D", bold: true } } });
  });
}
sectionChecklist(start, 16);
const finish = workbook.worksheets.getItem(layout.find((s) => s.key === "provenance_qc").sheet);
finish.mergeCells("B16:E16"); finish.getRange("B16").values = [["Before you upload"]];
finish.getRange("B16:E16").format = { font: { name: "Arial", size: 16, bold: true, color: emerald }, rowHeight: 30 };
sectionChecklist(finish, 18);
[
  "1. Open sections with missing answers. Explain anything you could not assess.",
  "2. Review retained details. Keep useful history, or clear it deliberately; nothing is deleted automatically.",
  "3. Save this workbook to approved storage, then drop it into the same assessment in Pipeline.",
  "4. Review the populated preview and commit only the changes you intend. Confirm the save status in Pipeline.",
  "These checks cover answers, not signatures or clinical approval. Review sources and sign only in Pipeline.",
].forEach((line, i) => { finish.mergeCells(`B${32 + i}:E${32 + i}`); finish.getRange(`B${32 + i}`).values = [[line]]; finish.getRange(`B${32 + i}:E${32 + i}`).format.rowHeight = 30; });
data.getRange("A1:B3").values = [["Format", contract.assessmentBackupVersion], ["Questionnaire fingerprint", fingerprint], ["Working copy identity", ""]];
fields.forEach((field, i) => { data.getRange(`A${i + 6}:R${i + 6}`).values = [[field.key, `${field.sheet}!C${field.row}`, ...Array(16).fill("")]]; });
base(codebook, fields.length + 5);
codebook.getRange("B1").values = [["Answer reference"]];
codebook.getRange("B3:D3").values = [["Question", "What to enter", "Section"]];
codebook.getRange("B3:D3").format = { fill: emerald, font: { name: "Arial", size: 11, bold: true, color: "#FFFFFF" }, rowHeight: 25 };
codebook.getRange("D:D").format.columnWidth = 35;
fields.filter((field) => field.editable).forEach((field, i) => {
  const choices = field.question?.options?.map((o) => o.label).join("; ") || ({ string: "Text or notes", string_list: "One item per line", date: "Date (YYYY-MM-DD)", integer: "Whole number", confidence: "Number from 0 to 1", timestamp: "Date and time" }[field.value_type] ?? "Text");
  codebook.getRange(`B${i + 5}:D${i + 5}`).values = [[field.label, choices, field.sheet]];
  codebook.getRange(`B${i + 5}:D${i + 5}`).format.rowHeight = Math.max(34, wrappedLines(choices, 58) * 16 + 12);
  codebook.getRange(`B${i + 5}:D${i + 5}`).format.borders = { bottom: { style: "thin", color: "#E3EAE6" } };
});

// The artifact runtime does not expose worksheet protection, row hiding or
// print setup. Add those standard OOXML features after its styled export.
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(out, "authoring.xlsx"));
const archive = unzipSync(new Uint8Array(await fs.readFile(path.join(out, "authoring.xlsx"))));
for (const file of Object.keys(archive).filter((p) => /^xl\/(styles\.xml|workbook\.xml|worksheets\/sheet\d+\.xml)$/.test(p))) {
  archive[file] = strToU8(strFromU8(archive[file]).replaceAll('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"').replace(/<(\/?)x:/g, "<$1"));
}
let styles = strFromU8(archive["xl/styles.xml"]);
const xfBody = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1];
// Match self-closing styles first so they cannot absorb the following style.
const xfs = xfBody.match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g);
const unlocked = xfs.map((xf) => (xf.endsWith("/>") ? xf.replace(/\/>$/, "><protection locked=\"0\"/></xf>") : xf.replace("</xf>", '<protection locked="0"/></xf>')).replace("<xf ", "<xf applyProtection=\"1\" "));
styles = styles.replace(/<cellXfs[^>]*>[\s\S]*?<\/cellXfs>/, `<cellXfs count="${xfs.length * 2}">${xfs.join("")}${unlocked.join("")}</cellXfs>`);
archive["xl/styles.xml"] = strToU8(styles);
for (const [i, section] of layout.entries()) {
  const file = `xl/worksheets/sheet${i + 2}.xml`;
  let source = strFromU8(archive[file]);
  const editable = new Set(section.fields.filter((f) => f.editable).flatMap((f) => [...Array.from({ length: f.chunks }, (_, c) => `C${f.row + c}`), `D${f.row}`]));
  source = source.replace(/<c\b([^>]*?)(\/?)>/g, (whole, attrs, slash) => {
    const cell = attrs.match(/\br="([^"]+)"/)?.[1];
    if (!editable.has(cell)) return whole;
    const style = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? 0) + xfs.length;
    return `<c${attrs.replace(/\s+s="\d+"/, "")} s="${style}"${slash}>`;
  });
  source = source.replace(/<col\b([^>]*?)\/>/g, (whole, attrs) => /\bmin="1"/.test(attrs) ? `<col${attrs.replace(/\s+hidden="[^"]*"/, "")} hidden="1"/>` : whole);
  for (const field of section.fields) for (let c = 1; c < field.chunks; c++) source = source.replace(new RegExp(`<row r="${field.row + c}"([^>]*)>`), `<row r="${field.row + c}"$1 hidden="1">`);
  for (const field of section.fields) {
    if (["source_file", "match_confidence", "extraction_date", "unable_to_assess_reasons"].includes(field.key)) source = source.replace(new RegExp(`<row r="${field.row}"([^>]*)>`), `<row r="${field.row}"$1 hidden="1">`);
    const guidance = fieldGuidance.get(field.key);
    if (!guidance) continue;
    const label = `<r><rPr><b/><sz val="12"/><color rgb="FF233B32"/></rPr><t>${escapeXml(field.label)}</t></r>`;
    const help = `<r><rPr><b val="0"/><sz val="10"/><color rgb="FF59675F"/></rPr><t xml:space="preserve">\n${escapeXml(guidance)}</t></r>`;
    source = source.replace(new RegExp(`<c\\b([^>]*\\br="B${field.row}"[^>]*)>[\\s\\S]*?<\\/c>`), (_, attrs) => `<c${attrs.replace(/\s+t="[^"]*"/, "")} t="inlineStr"><is>${label}${help}</is></c>`);
  }
  source = source.replace("</sheetData>", '</sheetData><sheetProtection sheet="1" objects="1" scenarios="1" selectLockedCells="0" selectUnlockedCells="0" formatRows="0"/>');
  source = source.replace("</sheetPr>", '<pageSetUpPr fitToPage="1"/></sheetPr>');
  source = source.replace(/<pageMargins\b[^>]*\/>/g, "");
  source = source.replace("</worksheet>", '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>');
  archive[file] = strToU8(source);
}
archive["xl/workbook.xml"] = strToU8(strFromU8(archive["xl/workbook.xml"]).replace(/<sheet\b([^>]*name="Pipeline_Data"[^>]*?)\/>/, (_, attrs) => `<sheet${attrs.replace(/\sstate="[^"]*"/, "")} state="veryHidden"/>`));
archive["xl/workbook.xml"] = strToU8(strFromU8(archive["xl/workbook.xml"]).replace(/<calcPr\b[^>]*\/>/g, "").replace("</workbook>", `<definedNames>${layout.map((s, i) => `<definedName name="_xlnm.Print_Area" localSheetId="${i + 1}">'${s.sheet}'!$B$1:$E$${s.key === "provenance_qc" ? 36 : s.lastRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="${i + 1}">'${s.sheet}'!$1:$5</definedName>`).join("")}</definedNames><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`));
for (const [file, firstRow] of [["xl/worksheets/sheet1.xml", 16], ["xl/worksheets/sheet13.xml", 18]]) {
  const links = layout.map((s, i) => `<hyperlink ref="B${i + firstRow}" location="'${s.sheet}'!B1"/>`).join("");
  const source = strFromU8(archive[file]);
  const before = source.includes("<pageMargins") ? "<pageMargins" : "</worksheet>";
  archive[file] = strToU8(source.replace(before, `<hyperlinks>${links}</hyperlinks>${before}`));
}
const bytes = zipSync(archive);
await fs.writeFile(path.join(out, "pipeline-assessment-workbook.xlsx"), bytes);
await fs.writeFile("public/templates/pipeline-assessment-workbook.xlsx", bytes);
console.log(`Generated ${fields.length} mapped fields; fingerprint ${fingerprint}.`);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 20 } })).ndjson);
if (!process.argv.includes("--no-preview")) {
  const rendered = await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(out, "pipeline-assessment-workbook.xlsx")));
  for (const name of ["Start Here", ...layout.map((s) => s.sheet)]) {
    const preview = await rendered.render({ sheetName: name, range: name === "Start Here" ? "B1:E27" : "B1:E10", scale: 1, format: "png" });
    await fs.writeFile(path.join(out, `${name.replaceAll(" ", "-")}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
}

function escapeXml(value) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
