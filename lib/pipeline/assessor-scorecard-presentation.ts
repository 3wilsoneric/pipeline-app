import type { AssessorScorecard, AssessorScorecardPerson, ScorecardEvidence, ScorecardMetric } from "./assessor-scorecard-types";

export const scorecardLabels: Record<ScorecardMetric, string> = {
  interviews: "Interviews finished", confirmed: "Charts confirmed", clients: "Clients worked", fields: "Assessment fields touched",
  uploads: "Files uploaded", handoffs: "Handoffs sent", resends: "Additional handoffs", sendIssues: "Failed / unknown send attempts", assigned: "Assigned now", overdue: "Overdue assignments", gaps: "Open completion items",
};
export const scorecardSorts = ["days", "interviews", "confirmed", "clients", "handoffs", "gaps", "interactions", "name"] as const;
export type ScorecardSort = typeof scorecardSorts[number];
export function sortScorecardPeople(people: AssessorScorecardPerson[], sort: ScorecardSort) {
  const total = (person: AssessorScorecardPerson) => sort === "days" ? person.activeDays : sort === "interactions" ? person.usage?.interactions ?? -1 : sort === "name" ? 0 : person.evidence[sort].length;
  return [...people].sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name));
}

export const scorecardMeasures = { ...scorecardLabels, days: "Days with recorded work", interactions: "Clicks / taps", activeMinutes: "Active minutes" };
export type ScorecardMeasure = keyof typeof scorecardMeasures;
// Presentation names only: the audit measures and PDF counting rules are unchanged.
export const scorecardDisplayLabels: Record<ScorecardMeasure, string> = {
  ...scorecardMeasures, confirmed: "Assessments confirmed", handoffs: "Handoffs sent", gaps: "Items to complete",
};
export const scorecardDefinitions: Record<ScorecardMeasure, string> = {
  days: "Pacific days with a substantive saved contribution. Empty autosaves and app visits do not count. Not an attendance measure.",
  confirmed: "First chart confirmation per assessment. Later confirmations add no credit; denied cases count too.",
  interviews: "Recorded interview-finish events only. Older assessments may have no separate finish event.",
  clients: "Distinct workspaces this assessor contributed to during the selected period.",
  handoffs: "First accepted email send per workspace. This does not confirm recipient delivery.",
  interactions: "Recorded clicks, taps and keyboard activations. Activity, not a performance grade.",
  activeMinutes: "Minutes with a foreground interaction, deduplicated across tabs. Not hours worked.",
  fields: "Each assessment field counts once per assessor in the period. This does not measure answer quality.",
  uploads: "Documents uploaded by this assessor during the selected period.",
  resends: "Accepted sends after the first handoff. Recipient delivery is not confirmed by this count.",
  sendIssues: "Send attempts that failed or returned an unknown result.",
  assigned: "Workspaces currently assigned to this assessor. Overdue assignments are included.",
  overdue: "Current assignments whose due date has passed.",
  gaps: "Open completion-memo items, including admitted clients. Items can depend on other teams; this is not a quality grade.",
};
export function scorecardValue(person: AssessorScorecardPerson, measure: ScorecardMeasure): number | null {
  return measure === "days" ? person.activeDays : measure === "interactions" || measure === "activeMinutes" ? person.usage?.[measure] ?? null : person.evidence[measure].length;
}
export function scorecardAxisMaximum(values: (number | null)[]) {
  const maximum = Math.max(1, ...values.map(value => value ?? 0));
  const step = Math.max(2, 2 * 10 ** (Math.floor(Math.log10(maximum)) - 1));
  return Math.ceil(maximum / step) * step;
}

const pacificDay = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};
export type ScorecardBucket = { start: string; end: string; label: string; partial: boolean; counts: Record<string, number> };
export function scorecardBucketEvidence(evidence: ScorecardEvidence[], bucket: ScorecardBucket) {
  return evidence.filter(item => {
    const day = item.at ? pacificDay(item.at) : null;
    return day !== null && day >= bucket.start && day < bucket.end;
  });
}

export function scorecardPersonColor(people: AssessorScorecardPerson[], id: string) {
  const colors = ["report-blue", "primary", "stage-violet", "stage-amber", "slate"];
  const identities = [...people].sort((a, b) => a.id.localeCompare(b.id));
  return colors[Math.max(0, identities.findIndex(person => person.id === id)) % colors.length];
}

export const scorecardTrendMeasures = ["days", "clients", "confirmed", "handoffs", "uploads"] as const;
export type ScorecardTrendMeasure = typeof scorecardTrendMeasures[number];

export function scorecardTrendCopy(measure: ScorecardTrendMeasure, unit: string) {
  const period = unit.toLowerCase();
  const labels = { days: "Days with saved work", clients: "Clients worked on", confirmed: "Assessments confirmed", handoffs: "First handoffs sent", uploads: "Files uploaded" };
  const descriptions = {
    days: "One day counts once, whether one change or many were saved. App visits alone do not count.",
    clients: `Each client counts once per ${period} with recorded activity. The same client can count again in another ${period}.`,
    confirmed: "First chart confirmations, credited to the assessor who confirmed. Later confirmations do not add to the count.",
    handoffs: "First email send accepted per workspace. Resends are excluded; recipient delivery is not confirmed.",
    uploads: "Documents uploaded by each assessor, counted when uploaded.",
  };
  return { title: `${labels[measure]} per ${period}`, description: descriptions[measure] };
}

export function scorecardSelection(person: AssessorScorecardPerson, measure: ScorecardMeasure, bucket?: ScorecardBucket) {
  if (measure === "interactions" || measure === "activeMinutes") return { value: scorecardValue(person, measure), evidence: [] };
  const source = measure === "days" || (measure === "clients" && bucket) ? person.recordedWork : person.evidence[measure];
  let evidence = bucket ? scorecardBucketEvidence(source, bucket) : source;
  if (measure === "clients" && bucket) evidence = [...new Map(evidence.map(item => [item.referralId, item])).values()];
  const value = measure === "days" ? bucket ? new Set(evidence.map(item => pacificDay(item.at!))).size : person.activeDays : evidence.length;
  return { value, evidence };
}

export function scorecardRecentWindow(snapshot: AssessorScorecard): ScorecardBucket {
  const last = pacificDay(snapshot.through)!;
  const end = new Date(`${last}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 14);
  return { start: [start.toISOString().slice(0, 10), pacificDay(snapshot.since)!].sort().at(-1)!, end: end.toISOString().slice(0, 10), label: "Recent activity", partial: true, counts: {} };
}

// Calendar arithmetic uses UTC date-only values after conversion to Pacific days,
// so the fall/spring clock changes cannot move events into an adjacent week.
// Up to 12 bins stay readable; longer ranges use months, quarters, then years.
export function scorecardTrend(snapshot: AssessorScorecard, measure: ScorecardTrendMeasure = "confirmed") {
  const first = pacificDay(snapshot.since), last = pacificDay(snapshot.through);
  if (!first || !last || first > last) return { buckets: [], unit: "Week" as const, undated: 0 };
  const firstDate = new Date(`${first}T00:00:00Z`), lastDate = new Date(`${last}T00:00:00Z`);
  const dayMs = 86_400_000;
  const weekStart = new Date(firstDate.getTime() - ((firstDate.getUTCDay() + 6) % 7) * dayMs);
  const weeks = Math.floor((lastDate.getTime() - weekStart.getTime()) / (7 * dayMs)) + 1;
  const months = (lastDate.getUTCFullYear() - firstDate.getUTCFullYear()) * 12 + lastDate.getUTCMonth() - firstDate.getUTCMonth() + 1;
  const unit = weeks <= 12 ? "Week" : months <= 12 ? "Month" : months <= 34 ? "Quarter" : "Year";
  const cursor = unit === "Week" ? weekStart : new Date(Date.UTC(firstDate.getUTCFullYear(), unit === "Year" ? 0 : unit === "Quarter" ? Math.floor(firstDate.getUTCMonth() / 3) * 3 : firstDate.getUTCMonth(), 1));
  const buckets: ScorecardBucket[] = [];
  const shortDate = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", ...(unit === "Week" ? { day: "numeric" as const } : { year: "numeric" as const }) });
  while (cursor <= lastDate) {
    const start = cursor.toISOString().slice(0, 10);
    const label = unit === "Year" ? String(cursor.getUTCFullYear()) : unit === "Quarter" ? `Q${Math.floor(cursor.getUTCMonth() / 3) + 1} ${cursor.getUTCFullYear()}` : shortDate.format(cursor);
    if (unit === "Week") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + (unit === "Year" ? 12 : unit === "Quarter" ? 3 : 1));
    buckets.push({ start, end: cursor.toISOString().slice(0, 10), label, partial: start < first || cursor.getTime() - dayMs > lastDate.getTime(), counts: {} });
  }
  let undated = 0;
  for (const person of snapshot.people) {
    for (const bucket of buckets) bucket.counts[person.id] = 0;
    const source = measure === "days" || measure === "clients" ? person.recordedWork : person.evidence[measure];
    const seen = new Set<string>();
    for (const item of source) {
      const day = item.at ? pacificDay(item.at) : null;
      if (!day) { undated++; continue; }
      if (day < first || day > last) continue;
      const bucket = buckets.find(bin => day >= bin.start && day < bin.end);
      if (!bucket) continue;
      const key = `${bucket.start}:${measure === "days" ? day : measure === "clients" ? item.referralId : item.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bucket.counts[person.id]++;
    }
  }
  return { buckets, unit, undated };
}
