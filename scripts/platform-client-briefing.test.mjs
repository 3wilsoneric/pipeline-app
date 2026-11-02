import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";

const { buildPlatformClientBriefing } = loadEntry("lib/pipeline/platform-client-briefing.ts");

test("client briefing bearer secret is separate from the aggregate summary secret", () => {
  const { requirePlatformClientBriefing } = loadEntry("lib/auth/internal-worker-auth.ts", {}, {
    process: { env: {
      PIPELINE_PLATFORM_CLIENT_BRIEFING_SECRET: "client-only-secret",
      PIPELINE_PLATFORM_SUMMARY_SECRET: "aggregate-secret",
    } },
  });
  const request = (secret) => new Request("http://localhost/api/integrations/platform/client-briefing", {
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(requirePlatformClientBriefing(request("client-only-secret")), null);
  assert.equal(requirePlatformClientBriefing(request("aggregate-secret")).status, 401);
});

test("the integration endpoint accepts launch-to-current and bounded rolling windows", async () => {
  const route = loadEntry("app/api/integrations/platform/client-briefing/route.ts", {
    "@/lib/auth/internal-worker-auth": { requirePlatformClientBriefing: () => null },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _name, run) => run() },
    "@/lib/pipeline/operations-snapshot": { getPlatformClientBriefing: async () => ({ contract_version: "1.0" }) },
  });
  const week = await route.GET(new Request("http://localhost/api/integrations/platform/client-briefing?start=2026-06-29&end=2026-07-05"));
  assert.equal(week.status, 200);
  const launch = await route.GET(new Request("http://localhost/api/integrations/platform/client-briefing?start=2026-07-01&end=2026-10-31"));
  assert.equal(launch.status, 200);
  const sinceLaunch = await route.GET(new Request("http://localhost/api/integrations/platform/client-briefing?start=2026-07-01&end=2026-11-02"));
  assert.equal(sinceLaunch.status, 200);
  assert.match(launch.headers.get("cache-control"), /no-store/);
  const rollingThirtyDays = await route.GET(new Request("http://localhost/api/integrations/platform/client-briefing?start=2026-10-02&end=2026-10-31"));
  assert.equal(rollingThirtyDays.status, 200);
  const calendarOctober = await route.GET(new Request("http://localhost/api/integrations/platform/client-briefing?start=2026-10-01&end=2026-10-31"));
  assert.equal(calendarOctober.status, 400);
  const fiveDays = await route.GET(new Request("http://localhost/api/integrations/platform/client-briefing?start=2026-07-01&end=2026-07-05"));
  assert.equal(fiveDays.status, 200);
  const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const futureResponse = await route.GET(new Request(`http://localhost/api/integrations/platform/client-briefing?start=2026-07-01&end=${future}`));
  assert.equal(futureResponse.status, 400);
});

function admission(overrides = {}) {
  return {
    referralId: 42,
    clientName: "Sample Client",
    community: "San Pablo",
    referringCounty: "Sacramento",
    assessor: "Assessor A",
    assessmentAssessor: "Assessor B",
    receivedAt: "2026-10-01",
    assessmentCreatedAt: "2026-10-02T12:00:00.000Z",
    assessmentStartedAt: "2026-10-03T12:00:00.000Z",
    assessmentCompletedAt: "2026-10-03T13:30:00.000Z",
    assessmentSignedAt: "2026-10-04T12:00:00.000Z",
    acceptedAt: "2026-10-05T12:00:00.000Z",
    admittedAt: "2026-10-15",
    handoffSentAt: "2026-10-14T12:00:00.000Z",
    dateOfBirth: "1980-10-16",
    assessment: {
      prior_setting_bucket: "imd_mhrc",
      current_location: "Treatment center",
      conservatorship_type: "lps",
      diagnosis_categories: ["schizophrenia"],
      substance_abuse_history: "yes",
      im_injections: "yes",
      ambulatory: "yes",
      bathing_assistance_level: "independent",
      dress_assistance_level: "independent",
      medications_at_intake: ["Medication recorded"],
      assessment_notes: "Never send raw notes to Platform",
    },
    pipelinePath: "/?view=referrals&screen=packet&referralId=42",
    ...overrides,
  };
}

function build(cases, start = "2026-10-01", end = "2026-10-31") {
  return JSON.parse(JSON.stringify(buildPlatformClientBriefing({
    start,
    end,
    generatedAt: "2026-10-31T12:00:00.000Z",
    cases,
  })));
}

test("includes only recorded admissions in the selected window and keeps missing fields distinct", () => {
  const report = build([
    admission({ admittedAt: "2026-09-30", referralId: 1 }),
    admission(),
    admission({ referralId: 2, clientName: "No admission", admittedAt: null }),
    admission({ referralId: 3, clientName: "Unknown setting", admittedAt: "2026-10-31", assessment: null, assessmentSignedAt: null, handoffSentAt: null }),
    admission({ admittedAt: "2026-11-01", referralId: 4 }),
  ]);
  assert.equal(report.summary.admissions, 2);
  assert.deepEqual(report.rows.map((row) => row.referral_id), [3, 42]);
  assert.equal(report.summary.prior_settings.find((row) => row.key === "imd_mhrc").count, 1);
  assert.equal(report.summary.prior_settings.find((row) => row.key === "not_recorded").count, 1);
  assert.deepEqual(report.summary.referring_counties, [{ label: "Sacramento", count: 2 }]);
  assert.equal(report.summary.signed_assessments, 1);
  assert.equal(report.summary.handoffs_logged, 1);
  assert.equal(report.summary.median_days_referral_to_admit, 22);
  assert.equal(report.rows[1].age_at_admission, 45);
  assert.equal(JSON.stringify(report).includes("Never send raw notes"), false);
});

test("a signature after admission is visible but never becomes a negative elapsed time", () => {
  const report = build([admission({ assessmentSignedAt: "2026-10-20T12:00:00.000Z" })]);
  assert.equal(report.rows[0].signed_after_admit, true);
  assert.equal(report.rows[0].days_signed_to_admit, null);
  assert.equal(report.rows[0].days_referral_to_signed, null);
  assert.equal(report.summary.median_days_referral_to_signed, null);
  assert.equal(report.summary.signed_after_admit, 1);
  assert.equal(report.summary.median_days_signed_to_admit, null);
});

test("assessment completion time belongs to the assessment assessor, not the referral owner", () => {
  const report = build([
    admission(),
    admission({ referralId: 43, assessor: "Assessor A", assessmentAssessor: "Assessor C", assessmentStartedAt: null }),
    admission({ referralId: 44, assessor: "Assessor A", assessmentAssessor: "Assessor D", assessmentCompletedAt: "2026-10-03T11:00:00.000Z" }),
  ]);
  assert.deepEqual(report.rows.map((row) => row.assessment_assessor), ["Assessor B", "Assessor C", "Assessor D"]);
  assert.deepEqual(report.rows.map((row) => row.minutes_assessment_start_to_complete), [90, null, null]);
  assert.equal(report.rows.every((row) => row.assessor === "Assessor A"), true);
});

test("briefing separates intake-to-assessment and accepted-to-move-in intervals", () => {
  const report = build([
    admission(),
    admission({ referralId: 43, assessmentCompletedAt: null, acceptedAt: null }),
    admission({ referralId: 44, assessmentCompletedAt: "2026-10-20T12:00:00.000Z", acceptedAt: "2026-10-20T12:00:00.000Z" }),
  ]);
  assert.deepEqual(report.rows.map((row) => row.days_referral_to_assessment_complete), [2, null, null]);
  assert.deepEqual(report.rows.map((row) => row.days_accepted_to_admit), [10, null, null]);
  assert.equal(report.rows[0].accepted_at, "2026-10-05");
});

test("selected date-window boundaries are inclusive and distinct", () => {
  const cases = [
    admission({ referralId: 1, admittedAt: "2026-10-25" }),
    admission({ referralId: 2, admittedAt: "2026-10-26" }),
    admission({ referralId: 3, admittedAt: "2026-11-01" }),
  ];
  assert.deepEqual(build(cases, "2026-10-26", "2026-11-01").rows.map((row) => row.referral_id), [3, 2]);
  assert.equal(build(cases).summary.admissions, 2);
});

test("refuses silent truncation when the safe case bound is exceeded", () => {
  const cases = Array.from({ length: 501 }, (_, index) => admission({ referralId: index + 1 }));
  assert.throws(() => build(cases), /500-case safe limit/);
});
