import { admissionFlowToday } from "./admission-flow-day";
import type { AssessorScorecard, AssessorScorecardPerson } from "./assessor-scorecard-types";
import { scorecardRecentWindow, scorecardSelection, type ScorecardBucket, type ScorecardMeasure } from "./assessor-scorecard-presentation";

export type ScorecardNarrativeFact = { text: string; metric: ScorecardMeasure; bucket?: ScorecardBucket };
export type ScorecardNarrativeParagraph = (string | ScorecardNarrativeFact)[];
export const scorecardNarrativeText = (paragraph: ScorecardNarrativeParagraph) => paragraph.map(part => typeof part === "string" ? part : part.text).join("");
const singularLabels: Record<string, string> = {
  days: "day", "client workspaces": "client workspace", "assessment fields touched": "assessment field touched", "files uploaded": "file uploaded",
  "first chart confirmations": "first chart confirmation", "first handoffs": "first handoff", "days with saved work": "day with saved work",
  workspaces: "workspace", "first confirmations": "first confirmation", uploads: "upload", "assigned workspaces": "assigned workspace",
  "overdue assignments": "overdue assignment", "completion items": "completion item", "clicks / taps": "click / tap", "minutes with foreground activity": "minute with foreground activity",
};
const number = (value: number) => value.toLocaleString("en-US");
const date = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00Z`));
const dateShift = (value: string, days: number) => new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Findings use the same evidence as the drill-down. They describe saved work,
// not attendance, clinical quality or the cause of a delay.
export function scorecardNarrative(snapshot: AssessorScorecard, person: AssessorScorecardPerson) {
  const count = (metric: ScorecardMeasure, bucket?: ScorecardBucket) => scorecardSelection(person, metric, bucket).value ?? 0;
  const fact = (metric: ScorecardMeasure, label: string, bucket?: ScorecardBucket): ScorecardNarrativeFact => ({ text: `${number(count(metric, bucket))} ${count(metric, bucket) === 1 ? singularLabels[label] ?? label : label}`, metric, ...(bucket ? { bucket } : {}) });
  const recent = scorecardRecentWindow(snapshot);
  const recentDates = `${date(recent.start)}–${date(dateShift(recent.end, -1))}`;
  const peers = snapshot.people.filter(other => other.id !== person.id);
  const leads = (metric: ScorecardMeasure) => peers.length > 0 && count(metric) > 0 && peers.every(other => count(metric) > (scorecardSelection(other, metric).value ?? 0));
  const recentHandoffs = count("handoffs", recent);
  const teamHandoffs = snapshot.people.reduce((sum, other) => sum + (scorecardSelection(other, "handoffs", recent).value ?? 0), 0);
  const teamConfirmations = snapshot.people.reduce((sum, other) => sum + (scorecardSelection(other, "confirmed", recent).value ?? 0), 0);
  const concentrated = recentHandoffs >= 2 && recentHandoffs > teamHandoffs / 2;
  const fieldClients = new Set(person.evidence.fields.map(item => item.referralId)).size;
  const comparable = peers.filter(other => other.evidence.clients.length === count("clients") && new Set(other.evidence.fields.map(item => item.referralId)).size > fieldClients)
    .sort((a, b) => b.evidence.fields.length - a.evidence.fields.length || a.name.localeCompare(b.name))[0];
  let lead = "Recorded activity and completed steps.";
  if (!count("days") && !count("clients")) lead = "No saved work recorded in this period.";
  else if (concentrated) lead = "Most recent handoffs are concentrated here.";
  else if (leads("days") && leads("uploads")) lead = "Most recorded workdays and document uploads.";
  else if (leads("clients")) lead = "Broadest involvement across client workspaces.";
  else if (comparable) lead = "Same number of clients, less recorded assessment activity.";
  else if (leads("days")) lead = "Most days with recorded work.";

  const work: ScorecardNarrativeParagraph = ["Recorded work on ", fact("days", "days"), " across ", fact("clients", "client workspaces"), ", with ", fact("fields", "assessment fields touched"), " and ", fact("uploads", "files uploaded"), "."];
  if (fieldClients) work.push(` Field contributions cover ${number(fieldClients)} of those workspaces.`);
  const comparison: ScorecardNarrativeParagraph = comparable ? [`${comparable.name} also contributed to ${number(count("clients"))} workspaces, with assessment-field activity on ${new Set(comparable.evidence.fields.map(item => item.referralId)).size}.`] : [];

  const completed: ScorecardNarrativeParagraph = ["Recorded ", fact("confirmed", "first chart confirmations"), " and ", fact("handoffs", "first handoffs"), " in the selected period."];
  // Attribute shared work only when a dated confirmation precedes the handoff.
  // Multiple actors at the latest timestamp are ambiguous and stay unassigned.
  const collaborators = new Map<string, number>();
  for (const send of person.evidence.handoffs) {
    if (!send.at) continue;
    const confirmations = snapshot.people.flatMap(other => other.evidence.confirmed.filter(item => item.referralId === send.referralId && item.at && Date.parse(item.at) <= Date.parse(send.at!)).map(item => ({ person: other, at: Date.parse(item.at!) })));
    const latest = Math.max(...confirmations.map(item => item.at));
    const actors = new Map(confirmations.filter(item => item.at === latest).map(item => [item.person.id, item.person]));
    const actor = actors.size === 1 ? [...actors.values()][0] : undefined;
    if (actor && actor.id !== person.id) collaborators.set(actor.name, (collaborators.get(actor.name) ?? 0) + 1);
  }
  const shared: ScorecardNarrativeParagraph = [];
  for (const [name, total] of collaborators) shared.push(`${shared.length ? " " : ""}${total} of these handoffs followed charts confirmed by ${name}.`);
  if (collaborators.size) shared.push(" Sending and preparing the record are shared contributions.");

  const pattern: ScorecardNarrativeParagraph = [`${recentDates}: `, fact("days", "days with saved work", recent), " across ", fact("clients", "workspaces", recent), ", ", fact("confirmed", "first confirmations", recent), ", ", fact("handoffs", "first handoffs", recent), ", and ", fact("uploads", "uploads", recent), "."];
  const change: ScorecardNarrativeParagraph = [];
  const length = Math.round((Date.parse(recent.end) - Date.parse(recent.start)) / 86_400_000);
  const previousStart = dateShift(recent.start, -length);
  // Do not compare with an earlier window outside the selected data coverage.
  const coveredStart = admissionFlowToday(new Date(snapshot.since));
  if (length === 14 && previousStart >= coveredStart) {
    const previous: ScorecardBucket = { start: previousStart, end: recent.start, label: `${date(previousStart)}–${date(dateShift(recent.start, -1))}`, partial: false, counts: {} };
    const before = count("days", previous), now = count("days", recent);
    if (before !== now) change.push(`Saved-work days ${now < before ? "fell" : "rose"} from `, fact("days", `in ${previous.label}`, previous), ` to ${now} in the recent window.`);
  }
  if (concentrated) change.push(`${change.length ? " " : ""}This is ${recentHandoffs} of the team's ${teamHandoffs} first handoffs in that window.`);

  if (count("confirmed", recent) >= 2 && count("confirmed", recent) > teamConfirmations / 2) change.push(`${change.length ? " " : ""}Also ${count("confirmed", recent)} of the team's ${teamConfirmations} first chart confirmations in that window.`);

  const open: ScorecardNarrativeParagraph = ["Currently ", fact("assigned", "assigned workspaces"), ...(count("overdue") ? [", including ", fact("overdue", "overdue assignments")] : []), ", plus ", fact("gaps", "completion items"), ". Completion items can include already-admitted clients."];
  const trackedStart = snapshot.usageSince && snapshot.usageSince > snapshot.since ? snapshot.usageSince : snapshot.since;
  const trackedDates = `${date(admissionFlowToday(new Date(trackedStart)))}–${date(admissionFlowToday(new Date(snapshot.through)))}`;
  const usage: ScorecardNarrativeParagraph = person.usage === null || !snapshot.usageSince ? ["Click and active-time history are unavailable for this assessor."] : [
    `Click tracking covers ${trackedDates} here: `, fact("interactions", "clicks / taps"), " and ", fact("activeMinutes", "minutes with foreground activity"), ". Earlier activity is unavailable; active minutes are not hours worked.",
  ];
  const question = count("assigned") && count("clients", recent) && !count("confirmed", recent) && !recentHandoffs
    ? "What is preventing updated clients from reaching a first confirmation or handoff? Review the next action and who owns it on each current assignment."
    : concentrated ? "Who covers handoffs when this assessor is unavailable, and is this concentration intentional?"
    : count("overdue") ? "Which overdue assignments are waiting on outside information, and which need the assessor's next action?"
    : count("assigned") ? "Which current clients are ready for the next step, and what is keeping the others open?"
    : count("gaps") ? "Which completion items still need this assessor's information or correction?"
    : "No current assignments or completion items are recorded for this assessor.";
  const sections = [
    { kind: "overview", paragraphs: [work, comparison, completed, shared].filter(paragraph => paragraph.length > 0) },
    { kind: "recent", paragraphs: [pattern, change].filter(paragraph => paragraph.length > 0) },
    { kind: "current", paragraphs: [open] },
    { kind: "usage", paragraphs: [usage] },
  ];
  return { lead, sections, paragraphs: sections.flatMap(section => section.paragraphs), question };
}
