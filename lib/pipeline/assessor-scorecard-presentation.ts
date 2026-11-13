import type { AssessorScorecardPerson, ScorecardMetric } from "./assessor-scorecard-types";

export const scorecardLabels: Record<ScorecardMetric, string> = {
  interviews: "Interviews finished", confirmed: "Charts confirmed", clients: "Clients worked", fields: "Assessment fields touched",
  uploads: "Files uploaded", handoffs: "Handoffs sent", resends: "Additional handoffs", sendIssues: "Failed / unknown send attempts", assigned: "Assigned now", overdue: "Overdue assignments", gaps: "Open completion items",
};
export const scorecardSorts = ["interviews", "confirmed", "clients", "handoffs", "gaps", "interactions", "name"] as const;
export type ScorecardSort = typeof scorecardSorts[number];
export function sortScorecardPeople(people: AssessorScorecardPerson[], sort: ScorecardSort) {
  const total = (person: AssessorScorecardPerson) => sort === "interactions" ? person.usage?.interactions ?? -1 : sort === "name" ? 0 : person.evidence[sort].length;
  return [...people].sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name));
}
