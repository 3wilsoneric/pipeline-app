import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

const { buildPlatformAdmissionsSummary } = loadEntry("lib/pipeline/platform-admissions-summary.ts");
const now = new Date("2026-09-26T15:00:00.000Z");

let nextId = 1;
const referral = (overrides) => ({
  referralId: nextId++,
  community: "San Pablo",
  owner: "Andrew",
  priority: "standard",
  receivedDate: "2026-09-02",
  decisionOutcome: null,
  decidedAt: null,
  plannedAdmissionDate: null,
  actualAdmissionDate: null,
  currentWorkspace: true,
  boardColumn: "in_progress",
  boardStatus: "Assessment scheduled",
  nextAction: "Prepare assessment",
  hoursSinceUpdate: 30,
  stale: false,
  unassigned: false,
  pipelinePath: "/?view=referrals&screen=packet&referralId=1",
  ...overrides,
});

// The builder runs in a VM context; compare plain values, not cross-realm prototypes.
function summarize(referrals) {
  return JSON.parse(JSON.stringify(buildPlatformAdmissionsSummary({ now, referrals })));
}

test("snapshots the live board by column and status with drill-down rows and no client identity", () => {
  const summary = summarize([
    referral({ boardColumn: "received", boardStatus: "Referral received", stale: true, unassigned: true, receivedDate: "2026-09-20", name: "Leaked Client" }),
    referral({}),
    referral({ community: "Turlock", boardColumn: "decision", boardStatus: "Accept", decisionOutcome: "accepted", receivedDate: "2026-09-01", decidedAt: "2026-09-05T10:00:00Z", plannedAdmissionDate: "2026-09-30" }),
    referral({ boardColumn: "decision", boardStatus: "Awaiting admit", decisionOutcome: "accepted", receivedDate: "2026-09-03", decidedAt: "2026-09-08T10:00:00Z", plannedAdmissionDate: "2026-09-20" }),
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
  assert.deepEqual(newest.flags, { stale: true, unassigned: true, move_in_overdue: false });
  assert.equal(newest.owner, "Unassigned");
  assert.equal(newest.days_open, 6);
  assert.equal(newest.days_since_update, 1);
  const overdue = summary.board.cards.find((card) => card.status === "Awaiting admit");
  assert.equal(overdue.flags.move_in_overdue, true);
  assert.equal(overdue.planned_admission_date, "2026-09-20");
  assert.equal(summary.board.cards[0].days_open >= summary.board.cards.at(-1).days_open, true, "oldest referrals first");

  assert.deepEqual(summary.metrics, { on_board: 5, stale: 1, unassigned: 1, awaiting_admission: 2 });
  assert.deepEqual(summary.upcoming_admissions, { next_7_days: 1, next_30_days: 1, past_planned_date: 1, no_planned_date: 0 });
  assert.deepEqual(summary.history.month_outcomes, { month: "2026-09", received: 5, accepted: 2, declined: 1, admitted: 1 });
  assert.equal(summary.history.decision_timing.decisions_counted, 4);
  assert.equal(summary.history.decision_timing.median_days_to_decision, 4.5);
  assert.ok(!JSON.stringify(summary).includes("Leaked"), "only documented fields leave Pipeline");
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
