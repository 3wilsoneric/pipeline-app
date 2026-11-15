export type ScorecardPeriod = "30d" | "week" | "launch";
export type ScorecardMetric = "interviews" | "confirmed" | "clients" | "fields" | "uploads" | "handoffs" | "resends" | "sendIssues" | "assigned" | "overdue" | "gaps";
export type ScorecardEvidence = {
  key: string;
  referralId: number;
  client: string;
  community: string;
  at: string | null;
  detail: string;
};
export type AssessorScorecardPerson = {
  id: string;
  name: string;
  active: boolean;
  evidence: Record<ScorecardMetric, ScorecardEvidence[]>;
  interviewSpanHours: number | null;
  interviewSpanSamples: number;
  activeDays: number;
  // First substantive contribution per assessor, Pacific day and workspace.
  // Unlike evidence.clients, a workspace can recur on subsequent days.
  recordedWork: ScorecardEvidence[];
  usage: { interactions: number; activeMinutes: number; days: number } | null;
};
export type AssessorScorecard = {
  period: ScorecardPeriod;
  since: string;
  through: string;
  usageSince: string | null;
  people: AssessorScorecardPerson[];
  unattributedEvents: number;
  unassignedWorkspaces: number;
  unassignedGapItems: number;
};
