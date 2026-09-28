import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import postgres from "postgres";
import ts from "typescript";

const connection = process.env.PIPELINE_TEST_DATABASE_URL;
const local = connection && ["localhost", "127.0.0.1", "::1"].includes(new URL(connection).hostname);

test("Outlook invitations create once, update the assigned attendee, and cancel without client details", async () => {
  const source = readFileSync("lib/assessment/assessment-outlook-calendar.ts", "utf8")
    + "\nexport { synchronizeEvent as testSynchronizeEvent };\n";
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const load = id => {
    if (id === "server-only") return {};
    if (id === "node:crypto") return { randomUUID };
    if (id === "@/lib/database/pipeline-database") return {};
    if (id === "@/lib/notifications/microsoft-graph-mail") return { graphAccessToken: async () => "synthetic-token" };
    throw new Error(`Unexpected import ${id}`);
  };
  new Function("require", "exports", js)(load, exports);
  const sync = exports.testSynchronizeEvent;
  const previous = globalThis.fetch;
  const env = {
    PIPELINE_MEET_CLIENT_SENDER: process.env.PIPELINE_MEET_CLIENT_SENDER,
    PIPELINE_CANONICAL_ORIGIN: process.env.PIPELINE_CANONICAL_ORIGIN,
  };
  process.env.PIPELINE_MEET_CLIENT_SENDER = "admissions@example.test";
  process.env.PIPELINE_CANONICAL_ORIGIN = "https://alamo-pipeline.com";
  const calls = [];
  const response = (status, body) => new Response(body ? JSON.stringify(body) : null, { status });
  try {
    const row = { assessment_id: "synthetic-assessment", transaction_id: randomUUID(), event_id: null };
    const appointment = {
      referral_id: 3000, scheduled_start_at: "2026-10-20T17:00:00Z", scheduled_duration_minutes: 60,
      scheduled_method: "phone", scheduled_location: "", schedule_status: "scheduled", assessor_id: "assessor-a",
      assessor_email: "one@example.test", workspace_status: "active", deleted_at: null,
    };
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return response(201, { id: "graph-event-1" }); };
    assert.deepEqual(await sync(row, appointment), { eventId: "graph-event-1" });
    const created = JSON.parse(calls[0].init.body);
    assert.equal(created.transactionId, row.transaction_id);
    assert.equal(created.subject, "Pipeline assessment");
    assert.equal(created.sensitivity, "private");
    assert.equal(created.location.displayName, "Phone");
    assert.deepEqual(created.attendees.map(item => item.emailAddress.address), ["one@example.test"]);
    assert.equal(created.start.timeZone, "UTC");
    assert.equal(created.end.dateTime, "2026-10-20T18:00:00.000");
    assert.match(created.body.content, /referralId=3000/);
    assert.doesNotMatch(JSON.stringify(created), /Calendar Fixture|client name/i);

    calls.length = 0;
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      if (init.method === "PATCH") return response(200, { id: "graph-event-1" });
      return response(200, { id: "graph-event-1", start: { dateTime: "2026-10-20T17:00:00Z" },
        end: { dateTime: "2026-10-20T18:00:00Z" }, location: { displayName: "Phone" },
        attendees: [{ emailAddress: { address: "one@example.test" } }] });
    };
    const rescheduled = { ...appointment, assessor_email: "two@example.test", scheduled_method: "video", scheduled_start_at: "2026-10-20T19:00:00Z" };
    assert.deepEqual(await sync({ ...row, event_id: "graph-event-1" }, rescheduled), { eventId: "graph-event-1" });
    assert.deepEqual(calls.map(call => call.init.method), [undefined, "PATCH"]);
    assert.deepEqual(JSON.parse(calls[1].init.body).attendees.map(item => item.emailAddress.address), ["two@example.test"]);
    assert.equal(JSON.parse(calls[1].init.body).location.displayName, "Video");

    calls.length = 0;
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return response(200, { id: "graph-event-1", start: { dateTime: "2026-10-20T17:00:00Z" },
        end: { dateTime: "2026-10-20T18:00:00Z" }, location: { displayName: "Phone" },
        attendees: [{ emailAddress: { address: "one@example.test" } }] });
    };
    assert.deepEqual(await sync({ ...row, event_id: "graph-event-1" }, appointment), { eventId: "graph-event-1" });
    assert.equal(calls.length, 1, "a retry of an already-matching event must not resend an update");

    calls.length = 0;
    let lostResponse = true;
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      if (lostResponse) { lostResponse = false; throw new Error("response lost after Graph accepted creation"); }
      return response(201, { id: "graph-event-2" });
    };
    await assert.rejects(sync(row, appointment), /provider_unconfirmed/);
    assert.deepEqual(await sync(row, appointment), { eventId: "graph-event-2" });
    assert.equal(JSON.parse(calls[0].init.body).transactionId, JSON.parse(calls[1].init.body).transactionId,
      "an uncertain creation retry must use the same Graph transaction ID");

    calls.length = 0;
    assert.deepEqual(await sync({ ...row, last_error_code: "provider_unconfirmed" },
      { ...appointment, schedule_status: "cancelled" }),
      { eventId: null, retryCode: "uncertain_create_requires_reconciliation" },
      "a cancellation after a lost create response cannot silently claim Outlook is clear");
    assert.equal(calls.length, 0);

    calls.length = 0;
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return response(204); };
    assert.deepEqual(await sync({ ...row, event_id: "graph-event-1" }, { ...appointment, schedule_status: "cancelled" }), { eventId: null });
    assert.equal(calls[0].init.method, "DELETE");
  } finally {
    globalThis.fetch = previous;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("assessment schedule, reassignment, cancellation and deletion queue one durable Outlook event", { skip: !local }, async () => {
  const sql = postgres(connection, { ssl: false, max: 1, prepare: false });
  const assessmentId = `outlook-fixture-${randomUUID()}`;
  let personId;
  let referralId;
  try {
    [{ person_id: personId }] = await sql`
      insert into pipeline.people (display_name) values ('Calendar Fixture') returning person_id
    `;
    [{ referral_id: referralId }] = await sql`
      insert into pipeline.referrals
        (person_id, stage, community, created_by, created_by_name, updated_by, updated_by_name)
      values (${personId}, 'New', 'San Pablo', 'fixture', 'Fixture', 'fixture', 'Fixture')
      returning referral_id
    `;
    await sql`
      insert into pipeline.assessments
        (assessment_id, referral_id, status, created_by, created_by_name,
          updated_by, updated_by_name, revision_root_id)
      values (${assessmentId}, ${referralId}, 'draft', 'fixture', 'Fixture', 'fixture', 'Fixture', ${assessmentId})
    `;
    assert.equal((await ledger())[0]?.desired_version, undefined, "unscheduled assessments send no invite");
    await sql`
      update pipeline.assessments set schedule_status = 'scheduled',
        scheduled_start_at = '2026-10-20T17:00:00Z', scheduled_duration_minutes = 60,
        scheduled_method = 'phone', assessor_id = 'synthetic-assessor'
      where assessment_id = ${assessmentId}
    `;
    assert.equal(Number((await ledger())[0].desired_version), 1);
    await assert.rejects(sql.begin(async tx => {
      await tx`
        update pipeline.assessments set scheduled_start_at = '2026-10-20T18:00:00Z'
        where assessment_id = ${assessmentId}
      `;
      throw new Error("roll back the assessment mutation");
    }));
    assert.equal(Number((await ledger())[0].desired_version), 1, "the invite queue rolls back with the schedule");
    await sql`
      update pipeline.assessments set schedule_status = 'rescheduled',
        scheduled_start_at = '2026-10-20T18:00:00Z', assessor_id = 'another-synthetic-assessor'
      where assessment_id = ${assessmentId}
    `;
    assert.equal(Number((await ledger())[0].desired_version), 2);
    await sql`update pipeline.assessments set data = '{"fixture":true}' where assessment_id = ${assessmentId}`;
    assert.equal(Number((await ledger())[0].desired_version), 2, "unrelated assessment edits do not resend invitations");
    await sql`update pipeline.assessments set schedule_status = 'cancelled' where assessment_id = ${assessmentId}`;
    assert.equal(Number((await ledger())[0].desired_version), 3);
    await sql`
      update pipeline.assessment_outlook_calendar set event_id = 'synthetic-event', status = 'synced'
      where assessment_id = ${assessmentId}
    `;
    await sql`delete from pipeline.assessments where assessment_id = ${assessmentId}`;
    const removed = (await ledger())[0];
    assert.equal(Number(removed.desired_version), 4);
    assert.equal(removed.status, "pending", "deletion must cancel the organizer meeting");
  } finally {
    await sql`delete from pipeline.assessment_outlook_calendar where assessment_id = ${assessmentId}`;
    if (referralId) await sql`delete from pipeline.referrals where referral_id = ${referralId}`;
    if (personId) await sql`delete from pipeline.people where person_id = ${personId}`;
    await sql.end();
  }

  async function ledger() {
    return sql`
      select desired_version, status from pipeline.assessment_outlook_calendar
      where assessment_id = ${assessmentId}
    `;
  }
});
