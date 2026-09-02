export const operationsReportIds = [
  "active_referrals",
  "workspace_inventory",
  "document_coverage",
  "intake_review",
  "assessor_workload",
  "missing_documents",
  "assessment_schedule",
  "assessment_completion",
  "decisions",
  "ehr_handoff",
  "supervisor_exceptions",
] as const;

export type OperationsReportId = (typeof operationsReportIds)[number];
export type OperationsReportFilterKey = "month" | "community" | "owner";

export type OperationsReportDefinition = {
  id: OperationsReportId;
  label: string;
  description: string;
  cadence: "Current" | "Monthly";
  audience: "Operations" | "Assessment team" | "Supervisors";
  filters: OperationsReportFilterKey[];
  supervisor_only?: boolean;
};

export type OperationsReportColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
  format?: "date" | "datetime" | "duration";
};

export type OperationsReportRow = {
  row_id: string;
  referral_id: number | null;
  client_name: string | null;
  community: string | null;
  values: Record<string, string | number | null>;
};

export type OperationsReportMetric = {
  label: string;
  value: string;
  detail: string;
};

export type OperationsReportFilters = {
  report_id: OperationsReportId;
  month: string;
  community: string;
  owner: string;
};

export type OperationsReportFacet = {
  value: string;
  count: number;
};

export type OperationsReportResult = {
  definition: OperationsReportDefinition;
  columns: OperationsReportColumn[];
  metrics: OperationsReportMetric[];
  rows: OperationsReportRow[];
  row_count: number;
  truncated: boolean;
  generated_at: string;
};

export type OperationsReportResponse = {
  catalog: OperationsReportDefinition[];
  facets: {
    communities: OperationsReportFacet[];
    owners: OperationsReportFacet[];
  };
  filters: OperationsReportFilters;
  report: OperationsReportResult;
};

export function isOperationsReportId(value: unknown): value is OperationsReportId {
  return typeof value === "string" && operationsReportIds.includes(value as OperationsReportId);
}
