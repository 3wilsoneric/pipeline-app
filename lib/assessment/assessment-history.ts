import type { AssessmentToolData, AssessmentToolFieldKey } from "./assessment-tool-schema";

export function isHistoryOverviewField(field: AssessmentToolFieldKey): field is "hospitalization_history" | "forensic_history" {
  return field === "hospitalization_history" || field === "forensic_history";
}

export function earlierHistoryAnswers(data: AssessmentToolData, field: AssessmentToolFieldKey): string {
  const rows: Array<[string, unknown]> = field === "hospitalization_history" ? [
    ["Prior hospitalizations", data.prior_hospitalizations_count],
    ["Most recent hospitalization", data.most_recent_hospitalization],
    ["Prior 5150 / 5250 holds", data.prior_5150_5250_holds],
    ["Crisis / ER use", data.crisis_er_utilization],
  ] : field === "forensic_history" ? [
    ["Forensic involvement", data.forensic_involvement],
    ["Forensic details", data.forensic_involvement_details],
    ["Arrest history", data.arrest_history],
    ["Most recent arrest", data.most_recent_arrest_date],
    ["Charge", data.most_recent_arrest_charge],
    ["Time in jail", data.most_recent_arrest_jail_time],
    ["Arrest in the last two years", data.arrest_in_last_two_years],
    ["Recent arrest details", data.arrest_last_two_years_details],
    ["Total arrests", data.total_arrests],
  ] : [];
  return rows.filter(([, value]) => value !== null && value !== "" && value !== undefined)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}
