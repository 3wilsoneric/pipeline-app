import { assessmentToolFieldDefinitions } from "@/lib/assessment/assessment-tool-schema";
import { admissionFlowToday } from "./admission-flow-day";
import { admissionFlowStartDate } from "./admission-flow-cohort";
import type { OperationsWorkItem } from "./operations-types";
import type { WeeklyCompletionMemo } from "./weekly-completion-memo";
import type { AssessorScorecard, AssessorScorecardPerson, ScorecardEvidence, ScorecardMetric, ScorecardPeriod } from "./assessor-scorecard-types";

export type ScorecardMember = { id: string; name: string; active: boolean; roles: string[]; mergedInto: string | null };
export type ScorecardEvent = {
  id: string; actorId: string; actorName: string; action: string; entityType: string; entityId: string;
  rootId: string | null; fields: string[]; at: string; deliveryId: string | null;
  referralId: number; client: string; community: string;
};
export type ScorecardUsage = { actorId: string; minute: string; interactions: number };
const metricKeys: ScorecardMetric[] = ["interviews", "confirmed", "clients", "fields", "uploads", "handoffs", "resends", "sendIssues", "assigned", "overdue", "gaps"];
const questionLabels = new Map(assessmentToolFieldDefinitions.map((field) => [field.key as string, field.label]));

// Calendar boundaries follow the operations reports, including DST changes.
function pacificMidnight(day: string) {
  const utc = Date.parse(`${day}T00:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" })
    .formatToParts(new Date(utc)).find((part) => part.type === "timeZoneName")!.value;
  // Pacific DST changes at 02:00, so the offset before midnight applies.
  return new Date(utc - Number(offset.replace("GMT", "")) * 3600_000).toISOString();
}
export function scorecardRange(period: ScorecardPeriod, now = new Date()) {
  const today = admissionFlowToday(now);
  const day = new Date(`${today}T12:00:00Z`);
  if (period === "week") day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  if (period === "30d") day.setUTCDate(day.getUTCDate() - 29);
  return { since: pacificMidnight(period === "launch" ? admissionFlowStartDate : day.toISOString().slice(0, 10)), through: now.toISOString() };
}

export function buildAssessorScorecard(input: {
  period: ScorecardPeriod; since: string; through: string; usageSince: string | null;
  members: ScorecardMember[]; events: ScorecardEvent[]; usage: ScorecardUsage[];
  work: OperationsWorkItem[]; memo: WeeklyCompletionMemo; memoOwners: Record<number, string | null>;
}): AssessorScorecard {
  const members = new Map(input.members.map((member) => [member.id, member]));
  function canonical(id: string | undefined | null): string | null {
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const member = members.get(id);
      if (!member) return null;
      if (!member.mergedInto) return id;
      id = member.mergedInto;
    }
    return null;
  }
  const people = new Map<string, AssessorScorecardPerson>();
  function person(id: string) {
    let value = people.get(id);
    if (!value) {
      const member = members.get(id)!;
      value = { id, name: member.name, active: member.active, evidence: Object.fromEntries(metricKeys.map((key) => [key, [] as ScorecardEvidence[]])) as AssessorScorecardPerson["evidence"], interviewSpanHours: null, interviewSpanSamples: 0, activeDays: 0, usage: input.usageSince ? { interactions: 0, activeMinutes: 0, days: 0 } : null };
      people.set(id, value);
    }
    return value;
  }
  for (const member of input.members) if (member.active && !member.mergedInto && member.roles.some((role) => ["reviewer", "assessment_coordinator", "admin"].includes(role))) person(member.id);
  const unique = new Set<string>();
  function add(id: string, metric: ScorecardMetric, evidence: ScorecardEvidence) {
    const key = `${id}:${metric}:${evidence.key}`;
    if (unique.has(key)) return;
    unique.add(key);
    person(id).evidence[metric].push(evidence);
  }
  const days = new Map<string, Set<string>>();
  const spans = new Map<string, number[]>();
  const started = new Map<string, number>();
  const firstMilestones = new Set<string>();
  const sentWorkspaces = new Set<number>();
  const deliveries = new Set<string>();
  let unattributedEvents = 0;
  const fieldActions = new Set(["assessment_updated", "assessment_completed", "assessment_signed", "assessment_supplemented", "extraction_confirmed"]);
  const substantiveActions = new Set([...fieldActions, "referral_created", "referral_updated", "referral_stage_changed", "assessment_created", "assessment_assigned", "assessment_scheduled", "assessment_rescheduled", "assessment_cancelled", "assessment_no_show", "assessment_started", "assessment_interview_completed", "assessment_addendum_added", "admission_decision_recorded", "document_uploaded", "requirement_updated", "meet_client_summary_sent", "meet_client_summary_failed", "meet_client_summary_unconfirmed"]);
  // Stable sorting preserves the database's microsecond order for same-ms events.
  for (const event of [...input.events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (event.at > input.through) continue;
    // Lifecycle writes also project their action onto the referral. That is the
    // same work, not another completed assessment or another set of answers.
    if ((event.action.startsWith("assessment_") || event.action === "extraction_confirmed") && event.entityType !== "assessment") continue;
    const root = event.rootId || event.entityId;
    if (event.action === "assessment_started" && !started.has(root)) started.set(root, Date.parse(event.at));
    const milestone = event.action === "assessment_signed" || event.action === "assessment_interview_completed";
    const milestoneKey = `${root}:${event.action}`;
    const first = !firstMilestones.has(milestoneKey);
    if (milestone) firstMilestones.add(milestoneKey);
    const deliveryKey = event.deliveryId || event.id;
    const firstHandoff = !sentWorkspaces.has(event.referralId);
    if (event.action === "meet_client_summary_sent") {
      if (deliveries.has(deliveryKey)) continue;
      deliveries.add(deliveryKey);
      sentWorkspaces.add(event.referralId);
    }
    if (event.at < input.since || /\(God mode by /i.test(event.actorName)) continue;
    if (!substantiveActions.has(event.action) && !(event.action.startsWith("work_item_") && event.fields.length)) continue;
    // Empty autosaves and workflow projections are not substantive contributions.
    if (["assessment_updated", "referral_updated", "referral_stage_changed"].includes(event.action) && !event.fields.length) continue;
    const actor = canonical(event.actorId);
    if (!actor) { unattributedEvents++; continue; }
    const evidence = { key: String(event.referralId), referralId: event.referralId, client: event.client, community: event.community, at: event.at, detail: "Recorded contribution" };
    add(actor, "clients", evidence);
    if (!days.has(actor)) days.set(actor, new Set());
    days.get(actor)!.add(admissionFlowToday(new Date(event.at)));
    if (milestone && first) {
      add(actor, event.action === "assessment_signed" ? "confirmed" : "interviews", { ...evidence, key: root, detail: event.action === "assessment_signed" ? "First chart confirmation" : "Interview finished" });
      const start = started.get(root);
      if (event.action === "assessment_interview_completed" && start !== undefined && start <= Date.parse(event.at)) {
        spans.set(actor, [...(spans.get(actor) ?? []), (Date.parse(event.at) - start) / 3600_000]);
      }
    }
    if (fieldActions.has(event.action)) {
      for (const field of event.fields) if (questionLabels.has(field)) add(actor, "fields", { ...evidence, key: `${root}:${field}`, detail: questionLabels.get(field)! });
    }
    if (event.action === "document_uploaded") add(actor, "uploads", { ...evidence, key: event.entityId, detail: "Document uploaded" });
    if (event.action === "meet_client_summary_sent") add(actor, firstHandoff ? "handoffs" : "resends", { ...evidence, key: deliveryKey, detail: "Handoff accepted for sending; recipient delivery not confirmed" });
    if (["meet_client_summary_failed", "meet_client_summary_unconfirmed"].includes(event.action)) add(actor, "sendIssues", { ...evidence, key: event.deliveryId || event.id, detail: event.action.endsWith("unconfirmed") ? "Send result unconfirmed" : "Send failed" });
  }
  let unassignedWorkspaces = 0, unassignedGapItems = 0;
  for (const work of input.work.filter((item) => item.board.stage !== null)) {
    const actor = canonical(work.owner_id);
    if (!actor) { unassignedWorkspaces++; continue; }
    const evidence = { key: String(work.referral_id), referralId: work.referral_id, client: work.client_name, community: work.community, at: work.assignment_due_at, detail: work.next_action || "Current assignment" };
    add(actor, "assigned", evidence);
    if (work.assignment_overdue) add(actor, "overdue", evidence);
  }
  for (const client of input.memo.clients) {
    const actor = canonical(input.memoOwners[client.referral_id]);
    if (!actor) { unassignedGapItems += client.tasks.length; continue; }
    for (const task of client.tasks) add(actor, "gaps", { key: `${client.referral_id}:${task.id}`, referralId: client.referral_id, client: client.client_name, community: client.community, at: null, detail: task.label });
  }
  const usageMinutes = new Map<string, Set<string>>(), usageDays = new Map<string, Set<string>>();
  for (const sample of input.usage) {
    const actor = canonical(sample.actorId);
    if (!actor || sample.minute < input.since || sample.minute > input.through) continue;
    const usage = person(actor).usage;
    if (!usage) continue;
    usage.interactions += sample.interactions;
    if (!usageMinutes.has(actor)) { usageMinutes.set(actor, new Set()); usageDays.set(actor, new Set()); }
    usageMinutes.get(actor)!.add(sample.minute);
    usageDays.get(actor)!.add(admissionFlowToday(new Date(sample.minute)));
  }
  for (const value of people.values()) {
    value.activeDays = days.get(value.id)?.size ?? 0;
    const times = (spans.get(value.id) ?? []).sort((a, b) => a - b);
    value.interviewSpanSamples = times.length;
    value.interviewSpanHours = times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null;
    if (value.usage) { value.usage.activeMinutes = usageMinutes.get(value.id)?.size ?? 0; value.usage.days = usageDays.get(value.id)?.size ?? 0; }
  }
  return { period: input.period, since: input.since, through: input.through, usageSince: input.usageSince, people: [...people.values()].sort((a, b) => b.evidence.interviews.length - a.evidence.interviews.length || a.name.localeCompare(b.name)), unattributedEvents, unassignedWorkspaces, unassignedGapItems };
}
