import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

const { buildPlatformAdmissionsSummary } = loadEntry("lib/pipeline/platform-admissions-summary.ts");
const now = new Date("2026-09-26T15:00:00.000Z");

let nextId = 1;
const referral = (overrides) => ({
  referralId: nextId++,
  clientName: "Jordan Lee",
  community: "San Pablo",
  owner: "Andrew",
  priority: "standard",
  receivedDate: "2026-09-02",
  decisionOutcome: null,
  decidedAt: null,
  plannedAdmissionDate: null,
  actualAdmissionDate: null,
  assessmentScheduledDate: null,
  assessmentScheduledDurationMinutes: null,
  assessmentComplete: false,
  currentWorkspace: true,
  boardColumn: "in_progress",
  boardStatus: "Assessment scheduled",
  nextAction: "Prepare assessment",
  hoursSinceUpdate: 30,
  stale: false,
  unassigned: false,
  managementProfile: {
    dateOfBirth: "1981-04-03",
    referralSource: "County behavioral health",
    referringCounty: "Contra Costa",
    payer: "Private pay",
    responsiblePerson: "Morgan Lee",
    conservedStatus: "no",
    documentStatus: "Reviewed",
    assessmentStatus: "complete",
    assessmentSigned: true,
    assessmentDate: "2026-09-18",
    openRequirements: 2,
    blockingRequirements: 1,
    overview: ["Current setting: acute psychiatric hospital"],
    supportSnapshot: [{ label: "Mobility", value: "Independent" }],
    medications: ["Medication A", "Medication B"],
    medicationSource: "signed_assessment",
  },
  pipelinePath: "/?view=referrals&screen=packet&referralId=1",
  ...overrides,
});

// The builder runs in a VM context; compare plain values, not cross-realm prototypes.
function summarize(referrals) {
  return JSON.parse(JSON.stringify(buildPlatformAdmissionsSummary({ now, referrals })));
}

test("snapshots the live board by column and status with client identity and drill-down rows", () => {
  const summary = summarize([
    referral({ clientName: "Alex Morgan", boardColumn: "received", boardStatus: "Referral received", stale: true, unassigned: true, receivedDate: "2026-09-20", assessmentScheduledDate: "2026-09-27" }),
    referral({}),
    referral({ community: "Turlock", boardColumn: "decision", boardStatus: "Accept", decisionOutcome: "accepted", receivedDate: "2026-09-01", decidedAt: "2026-09-05T10:00:00Z", plannedAdmissionDate: "2026-09-30" }),
    referral({ boardColumn: "decision", boardStatus: "Awaiting admit", decisionOutcome: "accepted", receivedDate: "2026-09-03", decidedAt: "2026-09-08T10:00:00Z", plannedAdmissionDate: "2026-09-25" }),
    referral({ boardColumn: "decision", boardStatus: "Denied", decisionOutcome: "declined", receivedDate: "2026-09-10", decidedAt: "2026-09-13T10:00:00Z" }),
    referral({ boardColumn: null, boardStatus: "Completed", decisionOutcome: "accepted", receivedDate: "2026-08-20", decidedAt: "2026-08-30T10:00:00Z", actualAdmissionDate: "2026-09-12" }),
    referral({ currentWorkspace: false, boardColumn: "received", boardStatus: "Referral received", receivedDate: "2025-01-01" }),
  ]);

  assert.equal(summary.board.total, 5);
  assert.deepEqual(summary.board.columns.map((column) => [column.key, column.count]), [["received", 1], ["in_progress", 1], ["decision", 3]]);
  const decision = summary.board.columns.find((column) => column.key === "decision");
  assert.deepEqual(decision.statuses.filter((row) => row.count), [
    { status: "Accepted, requirements open", count: 1 },
    { status: "Awaiting admit", count: 1 },
    { status: "Declined", count: 1 },
  ]);
  const newest = summary.board.cards.find((card) => card.column === "received");
  assert.equal(newest.client_name, "Alex Morgan");
  assert.deepEqual(newest.flags, { stale: true, unassigned: true, move_in_overdue: false });
  assert.equal(newest.owner, "Unassigned");
  assert.equal(newest.days_open, 6);
  assert.equal(newest.days_since_update, 1);
  const overdue = summary.board.cards.find((card) => card.status === "Awaiting admit");
  assert.equal(overdue.flags.move_in_overdue, true);
  assert.equal(overdue.planned_admission_date, "2026-09-25");
  assert.equal(summary.board.cards[0].days_open >= summary.board.cards.at(-1).days_open, true, "oldest referrals first");

  assert.deepEqual(summary.metrics, { on_board: 5, stale: 1, unassigned: 1, awaiting_admission: 2 });
  assert.deepEqual(summary.upcoming_admissions, { next_7_days: 1, next_30_days: 1, past_planned_date: 1, no_planned_date: 0 });
  assert.deepEqual(summary.history.month_outcomes, { month: "2026-09", received: 5, accepted: 2, declined: 1, admitted: 1 });
  assert.equal(summary.history.decision_timing.decisions_counted, 4);
  assert.equal(summary.history.decision_timing.median_days_to_decision, 4.5);
  assert.deepEqual(newest.management_profile, {
    date_of_birth: "1981-04-03",
    referral_source: "County behavioral health",
    referring_county: "Contra Costa",
    payer: "Private pay",
    responsible_person: "Morgan Lee",
    conserved_status: "no",
    document_status: "Reviewed",
    assessment_status: "complete",
    assessment_signed: true,
    assessment_date: "2026-09-18",
    open_requirements: 2,
    blocking_requirements: 1,
    overview: ["Current setting: acute psychiatric hospital"],
    support_snapshot: [{ label: "Mobility", value: "Independent" }],
    medications: ["Medication A", "Medication B"],
    medication_source: "signed_assessment",
  });
  assert.equal(summary.contract_version, "3.1");
  assert.equal(summary.briefing.timezone, "America/Los_Angeles");
  assert.equal(summary.briefing.window_end, "2026-09-26");
  assert.deepEqual(summary.briefing.coverage, {
    recent_referrals_complete: true,
    assessments_complete: true,
    move_ins_complete: true,
    weekly_trend_complete: true,
  });
  assert.deepEqual(summary.briefing.recent_referrals.map((row) => row.client_name), ["Alex Morgan"]);
  assert.equal(summary.briefing.recent_referrals[0].source_name, "County behavioral health");
  assert.deepEqual(summary.briefing.upcoming_assessments.map((row) => [row.client_name, row.scheduled_at]), [["Alex Morgan", "2026-09-27"]]);
  assert.equal(summary.briefing.planned_move_ins.length, 1);
  assert.equal(summary.briefing.planned_move_ins[0].readiness, "blocked");
  assert.equal(summary.briefing.weekly_trend.length, 12);
  assert.deepEqual(summary.briefing.weekly_trend.at(-1), { week_start: "2026-09-21", received: 0, accepted: 0 });
});

test("uses an explicit fallback when the referral has no recorded name", () => {
  const summary = summarize([referral({ clientName: "  " })]);
  assert.equal(summary.board.cards[0].client_name, "Name not recorded");
});

test("uses the canonical appointment timestamp and excludes appointments that already ended", () => {
  const summary = summarize([
    referral({ clientName: "Future appointment", assessmentScheduledDate: "2026-09-26T17:00:00.000Z", assessmentScheduledDurationMinutes: 60 }),
    referral({ clientName: "Appointment in progress", assessmentScheduledDate: "2026-09-26T14:30:00.000Z", assessmentScheduledDurationMinutes: 60 }),
    referral({ clientName: "Appointment ended", assessmentScheduledDate: "2026-09-26T13:00:00.000Z", assessmentScheduledDurationMinutes: 60 }),
  ]);
  assert.deepEqual(summary.briefing.upcoming_assessments.map((row) => row.client_name), [
    "Appointment in progress",
    "Future appointment",
  ]);
});

test("marks capped briefing slices incomplete instead of presenting truncation as complete", () => {
  const referrals = Array.from({ length: 501 }, (_, index) => referral({
    clientName: `Client ${index + 1}`,
    receivedDate: "2026-09-25",
    assessmentScheduledDate: index < 101 ? "2026-09-27" : null,
    decisionOutcome: "accepted",
    decidedAt: "2026-09-25",
    plannedAdmissionDate: index < 101 ? "2026-09-26" : null,
  }));
  const summary = summarize(referrals);
  assert.deepEqual(summary.briefing.coverage, {
    recent_referrals_complete: false,
    assessments_complete: false,
    move_ins_complete: false,
    weekly_trend_complete: true,
  });
  assert.equal(summary.briefing.recent_referrals.length, 500);
  assert.equal(summary.briefing.upcoming_assessments.length, 100);
  assert.equal(summary.briefing.planned_move_ins.length, 100);
});

test("platform summary route requires its own secret and never a browser session", async () => {
  let reads = 0;
  const route = (env) => loadEntry("app/api/integrations/platform/admissions-summary/route.ts", {
    "@/lib/auth/internal-worker-auth": loadEntry("lib/auth/internal-worker-auth.ts", {}, { process: { ...process, env } }),
    "@/lib/observability/api-logging": { withApiLogging: (_request, _route, handler) => handler() },
    "@/lib/pipeline/operations-snapshot": { getPlatformAdmissionsSummary: async () => { reads++; return { ok: true }; } },
  });
  const request = (token) => new Request("https://alamo-pipeline.com/api/integrations/platform/admissions-summary", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const configured = { PIPELINE_PLATFORM_SUMMARY_SECRET: "platform-secret", PIPELINE_WORKER_SHARED_SECRET: "worker-secret" };

  assert.equal((await route({}).GET(request("anything"))).status, 503);
  assert.equal((await route(configured).GET(request())).status, 401);
  assert.equal((await route(configured).GET(request("worker-secret"))).status, 401);
  assert.equal(reads, 0);
  const response = await route(configured).GET(request("platform-secret"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(reads, 1);
});
