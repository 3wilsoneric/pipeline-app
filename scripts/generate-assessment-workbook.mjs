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
const { Workbook, SpreadsheetFile } = await import(requireArtifact.resolve("@oai/artifact-tool"));
const contract = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-workbook-contract.ts", { crypto: webcrypto });
const { assessmentWorkbookLayout: layout, assessmentWorkbookFields: fields } = contract;
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
  return `Complete when ${parent?.label ?? rule.field} ${relation} ${labels.join(" or ")}.`;
}

const wrappedLines = (text, width) => text.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / width)), 0);

function base(sheet, lastRow) {
  sheet.showGridLines = false;
  sheet.tabColor = emerald;
  sheet.getRange(`A1:D${lastRow}`).format.font = { name: "Arial", size: 12, color: ink };
  sheet.getRange(`A1:D${lastRow}`).format.verticalAlignment = "top";
  sheet.getRange(`A1:D${lastRow}`).format.wrapText = true;
  sheet.getRange("A:A").format.columnWidth = 3;
  sheet.getRange("B:B").format.columnWidth = 43;
  sheet.getRange("C:C").format.columnWidth = 64;
  sheet.getRange("D:D").format.columnWidth = 31;
  sheet.getRange("B1:D1").format.font = { name: "Arial", size: 20, bold: true, color: emerald };
  sheet.getRange("B1:D1").format.rowHeight = 35;
  sheet.getRange("B2:D3").format.rowHeight = 30;
}
base(start, 26);
start.getRange("B1").values = [["Assessment working copy"]];
start.getRange("B2").values = [["Download from the assessment to include current answers."]];
start.getRange("B3").values = [["The saved time will appear here."]];
start.mergeCells("B2:D2"); start.mergeCells("B3:D3");
const instructions = [
  "Work in the answer cells. Your existing answers are already filled in.",
  "Choice fields have dropdowns. For lists, enter one item per line (Alt+Enter in Excel).",
  "If unable to assess, explain why in the column beside the question. Leave unknown answers blank.",
  "Save this file in Excel, then drop it into Excel backup in the same Pipeline assessment.",
  "Pipeline checks the changes before applying them. Clearing an answer needs your confirmation.",
  "This is a working copy, not a signature or a continuously updating backup.",
  "Contains private client information once populated. Use approved secure storage.",
  "Long answers continue in the rows below. Expand a row if needed; the full text remains in the cell.",
];
instructions.forEach((line, i) => { start.mergeCells(`B${i + 5}:D${i + 5}`); start.getRange(`B${i + 5}`).values = [[line]]; start.getRange(`B${i + 5}:D${i + 5}`).format.rowHeight = 28; });
for (const [i, section] of layout.entries()) {
  start.getRange(`B${i + 15}`).values = [[`${i + 1}. ${section.label}`]];
  start.getRange(`B${i + 15}`).format.rowHeight = 24;
  start.getRange(`B${i + 15}`).format.font = { name: "Arial", size: 13, color: emerald };
  const sheet = workbook.worksheets.getItem(section.sheet);
  base(sheet, section.lastRow);
  sheet.freezePanes.freezeRows(5);
  sheet.getRange("B1").values = [[section.label]];
  sheet.getRange("C1").values = [[`Section ${i + 1} of ${layout.length}`]];
  sheet.getRange("C1").format.font = { name: "Arial", size: 12, color: "#596E63" };
  sheet.getRange("B2").values = [["Client name"]];
  sheet.getRange("C2").values = [["Copy saved time"]];
  sheet.mergeCells("C2:D2");
  sheet.mergeCells("B3:D3");
  sheet.getRange("B3").values = [["Fill the answer cells. Keep labels and rows in place. Save the file before restoring it in Pipeline."]];
  sheet.getRange("B3:D3").format.font = { name: "Arial", size: 11, color: "#5D6C64" };
  sheet.getRange("B5:D5").values = [["Question", "Answer", "If unable, explain why"]];
  sheet.getRange("B5:D5").format = { fill: emerald, font: { name: "Arial", size: 12, bold: true, color: "#FFFFFF" }, rowHeight: 28 };
  for (const field of section.fields) {
    const { row, question } = field;
    const guidance = [question?.help, conditionalGuidance(question?.showWhen), question?.control === "multi_select" ? `One per line: ${question.options.map((o) => o.label).join("; ")}.` : "", field.editable ? "" : field.value_type === "reason_map" ? "Use the explanation column beside each question." : "Managed by Pipeline; reference only."].filter(Boolean).join("\n");
    sheet.getRange(`A${row}:D${row}`).values = [[field.key, field.label + (guidance ? `\n${guidance}` : ""), "", ""]];
    sheet.getRange(`B${row}:D${row}`).format.rowHeight = Math.max(question?.control === "textarea" ? 88 : 58, wrappedLines(`${field.label}\n${guidance}`, 38) * 16 + 20);
    sheet.getRange(`B${row}`).format.font = { name: "Arial", size: 12, bold: true, color: ink };
    sheet.getRange(`C${row}:D${row}`).format.fill = field.editable ? "#F0F7F3" : "#EFF1F0";
    sheet.getRange(`B${row}:D${row}`).format.borders = { bottom: { style: "thin", color: "#D8E3DC" } };
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
data.getRange("A1:B3").values = [["Format", contract.assessmentBackupVersion], ["Questionnaire fingerprint", fingerprint], ["Working copy identity", ""]];
fields.forEach((field, i) => { data.getRange(`A${i + 6}:R${i + 6}`).values = [[field.key, `${field.sheet}!C${field.row}`, ...Array(16).fill("")]]; });
base(codebook, fields.length + 5);
codebook.getRange("B1").values = [["Answer reference"]];
codebook.getRange("B3:D3").values = [["Question", "Available choices / type", "Section"]];
fields.forEach((field, i) => {
  const choices = field.question?.options?.map((o) => o.label).join("; ") || field.value_type;
  codebook.getRange(`B${i + 5}:D${i + 5}`).values = [[field.label, choices, field.sheet]];
  codebook.getRange(`B${i + 5}:D${i + 5}`).format.rowHeight = Math.max(50, wrappedLines(choices, 58) * 16 + 16);
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
const xfs = xfBody.match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g);
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
  source = source.replace("</sheetData>", '</sheetData><sheetProtection sheet="1" objects="1" scenarios="1" selectLockedCells="0" selectUnlockedCells="0" formatRows="0"/>');
  source = source.replace("</sheetPr>", '<pageSetUpPr fitToPage="1"/></sheetPr>');
  source = source.replace("</worksheet>", '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>');
  archive[file] = strToU8(source);
}
archive["xl/workbook.xml"] = strToU8(strFromU8(archive["xl/workbook.xml"]).replace(/<sheet\b([^>]*name="Pipeline_Data"[^>]*?)\/>/, (_, attrs) => `<sheet${attrs.replace(/\sstate="[^"]*"/, "")} state="veryHidden"/>`));
archive["xl/workbook.xml"] = strToU8(strFromU8(archive["xl/workbook.xml"]).replace("</workbook>", `<definedNames>${layout.map((s, i) => `<definedName name="_xlnm.Print_Area" localSheetId="${i + 1}">'${s.sheet}'!$B$1:$D$${s.lastRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="${i + 1}">'${s.sheet}'!$1:$5</definedName>`).join("")}</definedNames></workbook>`));
archive["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(archive["xl/worksheets/sheet1.xml"]).replace("</worksheet>", `<hyperlinks>${layout.map((s, i) => `<hyperlink ref="B${i + 15}" location="'${s.sheet}'!B1"/>`).join("")}</hyperlinks></worksheet>`));
const bytes = zipSync(archive);
await fs.writeFile(path.join(out, "pipeline-assessment-workbook.xlsx"), bytes);
await fs.writeFile("public/templates/pipeline-assessment-workbook.xlsx", bytes);
console.log(`Generated ${fields.length} mapped fields; fingerprint ${fingerprint}.`);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 20 } })).ndjson);
if (!process.argv.includes("--no-preview")) {
  for (const name of ["Start Here", ...layout.map((s) => s.sheet), "Codebook", "Pipeline_Data"]) {
    const preview = await workbook.render({ sheetName: name, range: name === "Start Here" ? "B1:D26" : name === "Pipeline_Data" ? "A1:B8" : "B1:D10", scale: 1.3, format: "png" });
    await fs.writeFile(path.join(out, `${name.replaceAll(" ", "-")}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
}
