import { assessmentConversationSections, assessmentInterviewFieldLabel, assessmentInterviewQuestions, assessmentInterviewSections } from "./assessment-interview-schema";
import { assessmentToolFieldDefinitions, type AssessmentToolFieldKey } from "./assessment-tool-schema";

export const assessmentWorkbookSchemaVersion = "PIPELINE_ASSESSMENT_WORKBOOK_V1";
export const assessmentWorkbookDataSheet = "Pipeline_Data";
export const assessmentWorkbookCodebookSheet = "Codebook";

export const assessmentWorkbookDataHeaders = [
  "schema_version",
  "field_key",
  "label",
  "section",
  "value_type",
  "required",
  "source_sheet",
  "source_cell",
  "value",
] as const;

export const assessmentWorkbookTemplatePath = "/templates/pipeline-assessment-workbook.xlsx";

export const assessmentBackupVersion = "PIPELINE_ASSESSMENT_BACKUP_V2";
export const workbookReadOnlyFields = new Set<AssessmentToolFieldKey>(["assessor", "source_file", "match_confidence", "extraction_date"]);
export const workbookChunkLength = 30000;

// One owner for the template, reader and writer. Extra cells prevent Excel's
// 32,767-character limit from silently truncating long notes or lists.
export const assessmentWorkbookLayout = assessmentConversationSections.map((view, index) => {
  const section = assessmentInterviewSections.find((item) => item.key === view.key)!;
  let row = 6;
  const definitions = assessmentToolFieldDefinitions.filter((item) => item.section === section.key);
  const ordered = [...assessmentInterviewQuestions.map((q) => definitions.find((d) => d.key === q.field)).filter((d) => d !== undefined), ...definitions.filter((d) => !assessmentInterviewQuestions.some((q) => q.field === d.key))];
  const fields = ordered.map((definition) => {
    const question = assessmentInterviewQuestions.find((q) => q.field === definition.key);
    const chunks = definition.value_type === "string_list" ? 14 : definition.key === "assessment_notes" ? 2 : 1;
    const entry = { ...definition, label: assessmentInterviewFieldLabel(definition.key), question, row, chunks, editable: !workbookReadOnlyFields.has(definition.key) && definition.value_type !== "reason_map" };
    row += chunks;
    return entry;
  });
  return { ...section, label: view.label, sheet: `${String(index + 1).padStart(2, "0")} ${view.label}`.slice(0, 31), fields, lastRow: row - 1 };
});

export const assessmentWorkbookFields = assessmentWorkbookLayout.flatMap((s) => s.fields.map((f) => ({ ...f, sheet: s.sheet })));

export async function assessmentWorkbookFingerprint() {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: assessmentBackupVersion, layout: assessmentWorkbookLayout }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}
