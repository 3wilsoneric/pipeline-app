import assert from "node:assert/strict";
import test from "node:test";
import { clean, loadEntry } from "./contact-import-fixtures.mjs";

const assessor = { id: "synthetic-assessor", name: "Synthetic Assessor", roles: ["reviewer"] };
const supervisor = { id: "synthetic-supervisor", name: "Synthetic Supervisor", roles: ["assessment_coordinator"] };
const jsonError = (error, status) => Response.json({ error }, { status });
const schedule = { status: "scheduled", start_at: "2026-09-17T09:00:00-07:00", duration_minutes: 60, method: "in_person", location: "Synthetic interview room" };
const command = { if_match: 7, client_mutation_id: "synthetic-schedule", schedule };

function fixture(options = {}) {
  const user = options.user ?? assessor;
  const referral = Object.freeze({
    id: 42, name: "Synthetic Scheduling Client", dob: "1980-01-02", community: "San Pablo",
    source: "Synthetic county referral", owner: assessor.name, ownerId: assessor.id,
    stage: "New", documentStatus: "Missing", packetId: "", requirements: [],
    ...options.referral,
  });
  let assessment = {
    assessment_id: "synthetic-assessment", referral_id: 42, version: 7, status: "draft",
    assessor_id: assessor.id, schedule_status: "unscheduled", signed_at: null, ...options.assessment,
  };
  const calls = { patches: [], access: [], contacts: [] };
  class ScheduleConflict extends Error {
    conflicts = [{ assessment_id: "synthetic-overlap" }];
  }
  const dependencies = {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async (_request, roles = ["admin", "assessment_coordinator", "reviewer", "viewer"]) => {
      if (options.unauthenticated) return { ok: false, response: jsonError("Unauthorized", 401) };
      return roles.some((role) => user.roles.includes(role)) ? { ok: true, user } : { ok: false, response: jsonError("Forbidden", 403) };
    } },
    "@/lib/auth/assessor-session-policy": { pipelineAuditActor: () => ({ id: user.id, name: user.name }) },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _route, handler) => handler() },
    "@/lib/pipeline/referral-access": { requireMutableReferralAccess: async (_user, id) => {
      calls.access.push(id);
      return options.inaccessible ? { ok: false, response: jsonError("Referral not found.", 404) } : { ok: true, referral };
    } },
    "@/lib/pipeline/contact-store": {
      requireContactStore: () => ({ ok: true }),
      getContactSchedulingReadiness: async (id) => { calls.contacts.push(id); return { blockers: options.contactBlockers ?? [] }; },
    },
    "@/lib/assessment/assessment-store": {
      AssessmentScheduleConflictError: ScheduleConflict,
      requireAssessmentStore: () => ({ ok: true }),
      getAssessment: async () => assessment,
      patchAssessment: async (...args) => {
        calls.patches.push(clean(args));
        if (options.versionConflict) return { ok: false, conflict: true, assessment };
        if (options.slotConflict && !args[3].allowScheduleConflict) throw new ScheduleConflict("The assessor already has an assessment at this time.");
        const patch = args[1];
        assessment = { ...assessment, version: assessment.version + 1 };
        if (patch.schedule) assessment = { ...assessment, schedule_status: patch.schedule.status, scheduled_start_at: patch.schedule.start_at };
        if (patch.mark_started) assessment = { ...assessment, started_at: "2026-09-17T16:00:00.000Z" };
        return { ok: true, assessment };
      },
    },
  };
  const post = (action, body, origin = "http://localhost") => loadEntry(`app/api/assessments/[assessmentId]/${action}/route.ts`, dependencies).POST(
    new Request(`http://localhost/api/assessments/synthetic-assessment/${action}`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ assessmentId: "synthetic-assessment" }) },
  );
  return { post, calls, referral };
}

test("assigned assessors and supervisors can schedule and reschedule without a packet or manual authorization", async () => {
  for (const user of [assessor, supervisor]) {
    for (const status of ["scheduled", "rescheduled"]) {
      const current = fixture({ user });
      const requested = { ...schedule, status };
      const response = await current.post("schedule", { ...command, schedule: requested });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.assessment.schedule_status, status);
      assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
      assert.deepEqual(current.calls.access, [42]);
      assert.deepEqual(current.calls.contacts, [42]);
      assert.deepEqual(current.calls.patches, [["synthetic-assessment", { schedule: requested }, { id: user.id, name: user.name }, {
        expectedVersion: 7, mutationId: "synthetic-schedule", allowScheduleConflict: false,
      }]]);
      assert.equal(current.referral.documentStatus, "Missing");
      assert.equal(current.referral.packetId, "");
      assert.equal(current.referral.manualIntakeAuthorization, undefined);
      assert.equal(result.assessment.signed_at, null);
    }
  }
});

test("assessment start may skip scheduling without inventing an appointment", async () => {
  const skipped = fixture();
  const response = await skipped.post("start", { if_match: 7, client_mutation_id: "synthetic-skip" });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.assessment.schedule_status, "unscheduled");
  assert.equal(result.assessment.scheduled_start_at, undefined);
  assert.ok(result.assessment.started_at);
});

test("saving a no-packet appointment flows directly into the real start route", async () => {
  const current = fixture();
  const scheduled = await current.post("schedule", command);
  assert.equal(scheduled.status, 200, JSON.stringify(await scheduled.clone().json()));
  const started = await current.post("start", { if_match: 8, client_mutation_id: "synthetic-start" });
  assert.equal(started.status, 200);
  assert.deepEqual(current.calls.patches[1], ["synthetic-assessment", { mark_started: true }, { id: assessor.id, name: assessor.name }, { expectedVersion: 8, mutationId: "synthetic-start" }]);
});

test("authentication, restricted access, referral visibility and same-origin boundaries still deny scheduling", async () => {
  for (const [options, status] of [
    [{ unauthenticated: true }, 401],
    [{ user: { ...assessor, roles: ["unknown"] } }, 403],
    [{ user: { ...assessor, accessScope: "note_lab" } }, 403],
    [{ inaccessible: true }, 404],
  ]) {
    const current = fixture(options);
    assert.equal((await current.post("schedule", command)).status, status);
    assert.equal(current.calls.patches.length, 0);
  }
  const current = fixture();
  assert.equal((await current.post("schedule", command, "https://other.invalid")).status, 403);
  assert.equal(current.calls.access.length, 0);
});

test("all Pipeline staff may save scheduling regardless of assignment", async () => {
  for (const role of ["admin", "assessment_coordinator", "reviewer", "viewer"]) {
    const current = fixture({ user: { ...assessor, roles: [role] }, assessment: { assessor_id: "someone-else" } });
    const response = await current.post("schedule", command);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(current.calls.patches.length, 1);
  }
});

test("assignment, profile identity and contact scheduling gaps are advisory", async () => {
  for (const [options, blocker] of [
    [{ user: supervisor, assessment: { assessor_id: null } }, "Assign an assessor before scheduling."],
    [{ referral: { dob: "" } }, "Complete the client name, date of birth, community, and referral source."],
    [{ contactBlockers: ["Confirm a scheduling contact."] }, "Confirm a scheduling contact."],
  ]) {
    const current = fixture(options);
    const response = await current.post("schedule", command);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.deepEqual(result.warnings, [blocker]);
    assert.equal(current.calls.patches.length, 1);
    assert.equal(result.assessment.schedule_status, "scheduled");
  }
});

test("schedule and optimistic-version validation still reject malformed or stale saves", async () => {
  for (const invalid of [
    { ...command, if_match: 0 },
    { ...command, schedule: { ...schedule, start_at: "2026-09-17T09:00:00" } },
    { ...command, schedule: { ...schedule, duration_minutes: 5 } },
    { ...command, schedule: { ...schedule, method: "invalid" } },
    { ...command, allow_conflict: "yes" },
  ]) {
    const current = fixture();
    assert.equal((await current.post("schedule", invalid)).status, 400);
    assert.equal(current.calls.patches.length, 0);
  }
  const current = fixture({ versionConflict: true });
  const response = await current.post("schedule", command);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).conflict, true);
});

test("slot conflicts remain visible as alerts while authorized scheduling continues", async () => {
  for (const user of [assessor, supervisor]) {
    const current = fixture({ user, slotConflict: true });
    const response = await current.post("schedule", command);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(current.calls.patches[0][3].allowScheduleConflict, false);
    assert.equal(result.assessment.schedule_status, "scheduled");
    assert.equal(current.calls.patches.length, 2);
    assert.equal(current.calls.patches[1][3].allowScheduleConflict, true);
    assert.deepEqual(result.warnings, ["This assessor has another assessment during that time. The appointment was saved with an overlap alert."]);
  }
});
