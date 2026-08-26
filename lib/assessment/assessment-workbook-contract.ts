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
