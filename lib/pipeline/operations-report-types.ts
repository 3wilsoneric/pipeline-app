export const operationsReportIds = [
  "clients_by_community",
  "referral_sources",
  "client_care_needs",
  "chart_completeness",
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
export type OperationsReportFilterKey = "month" | "community" | "owner" | "county" | "client_scope" | "care_topic";

export const clientDataReportIds = ["clients_by_community", "referral_sources", "client_care_needs", "chart_completeness"] as const;
export const careReportTopics = [
  { value: "primary_diagnosis", label: "Primary diagnosis" },
  { value: "care_level", label: "Care level" },
  { value: "ambulatory", label: "Ambulatory" },
  { value: "dress_assistance_level", label: "Dressing assistance" },
  { value: "bathing_assistance_level", label: "Bathing assistance" },
  { value: "medication_adherence", label: "Medication adherence" },
  { value: "special_diet", label: "Special diet" },
] as const;
export type CareReportTopic = (typeof careReportTopics)[number]["value"];

export function isClientDataReport(id: OperationsReportId) {
  return (clientDataReportIds as readonly string[]).includes(id);
}

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
  county?: string;
  client_scope?: "all" | "admitted" | "current";
  care_topic?: CareReportTopic;
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
  summary?: {
    columns: OperationsReportColumn[];
    rows: OperationsReportRow[];
  };
  notes?: string[];
};

export type OperationsReportResponse = {
  catalog: OperationsReportDefinition[];
  facets: {
    communities: OperationsReportFacet[];
    owners: OperationsReportFacet[];
    counties?: OperationsReportFacet[];
  };
  filters: OperationsReportFilters;
  report: OperationsReportResult;
};

export function isOperationsReportId(value: unknown): value is OperationsReportId {
  return typeof value === "string" && operationsReportIds.includes(value as OperationsReportId);
}
