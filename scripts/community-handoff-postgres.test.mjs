import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { loadEntry, root } from "./contact-import-fixtures.mjs";

// Disposable loopback cluster only. Never reads the application's database URL.
test("recipient drafts: migrated PostgreSQL persistence, private ownership, concurrent CAS and non-destructive rollback", { skip: process.env.PIPELINE_HANDOFF_POSTGRES !== "true" }, async () => {
  const directory = mkdtempSync("/tmp/pipeline-handoff-pg-");
  const data = join(directory, "data");
  const socket = join(directory, "socket");
  const binary = (name) => process.env.PIPELINE_HANDOFF_PG_BIN ? join(process.env.PIPELINE_HANDOFF_PG_BIN, name) : name;
  let started = false;
  let sql;
  try {
    mkdirSync(socket);
    execFileSync(binary("initdb"), ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    execFileSync(binary("pg_ctl"), ["-D", data, "-l", join(directory, "postgres.log"), "-w", "start", "-o", `-p ${port} -h 127.0.0.1 -k ${socket} -F`], { stdio: "pipe" });
    started = true;
    sql = postgres({ host: "127.0.0.1", port, database: "postgres", username: process.env.USER, ssl: false, max: 4, prepare: false, onnotice: () => {} });
    const url = `postgres://${encodeURIComponent(process.env.USER)}@127.0.0.1:${port}/postgres`;
    for (const name of ["0001_pipeline_core", "0006_user_workspace_state", "0033_workflow_continuity", "0038_assessment_packet_finalization", "0040_referral_email_drafts", "0042_admission_packet_links"]) {
      execFileSync(binary("psql"), [url, "-v", "ON_ERROR_STOP=1", "-f", join(root, "database/migrations", `${name}.sql`)], { stdio: "pipe" });
    }
    await checkAssessorEmailPersistence(sql);
    const dependencies = {
      "@/lib/auth/pipeline-auth": { getPipelineAuthMode: () => "entra_jwt" },
      "@/lib/desktop/desktop-server-config": { isPipelineDesktopStateEnabled: () => false },
      "@/lib/database/pipeline-database": { getPipelineSql: () => sql, getPipelineDatabaseReadiness: () => ({ mode: "postgres", ready: true }) },
    };
    const owner = () => loadEntry("lib/pipeline/user-workspace-state-store.ts", dependencies, { process: { ...process, env: { NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED: "true" } } });
    const store = owner();
    const input = { principalId: "synthetic-a", kind: "referral_email_draft", key: "7", payload: { community: "San Pablo", to: [{ name: "Team", email: "team@example.invalid" }], cc: [] }, expectedVersion: 0, ttlDays: 30 };
    assert.equal((await store.putUserWorkspaceState(input)).ok, true);
    assert.equal((await owner().getUserWorkspaceState(input.principalId, input.kind, input.key)).version, 1);
    assert.equal(await store.getUserWorkspaceState("synthetic-b", input.kind, input.key), null);
    assert.equal((await store.putUserWorkspaceState(input)).ok, false);
    const outcomes = await Promise.all([store.putUserWorkspaceState({ ...input, expectedVersion: 1 }), owner().putUserWorkspaceState({ ...input, expectedVersion: 1 })]);
    assert.equal(outcomes.filter((item) => item.ok).length, 1);
    assert.equal((await owner().getUserWorkspaceState(input.principalId, input.kind, input.key)).version, 2);
    const rollback = join(root, "database/rollbacks/0040_referral_email_drafts.sql");
    assert.throws(() => execFileSync(binary("psql"), [url, "-v", "ON_ERROR_STOP=1", "-f", rollback], { stdio: "pipe" }));
    assert.equal((await store.getUserWorkspaceState(input.principalId, input.kind, input.key)).version, 2);
    assert.equal((await sql`select 1 from pipeline.schema_migrations where migration_id = '0040_referral_email_drafts'`).length, 1);
    await sql`delete from pipeline.user_workspace_state where state_kind = 'referral_email_draft'`;
    execFileSync(binary("psql"), [url, "-v", "ON_ERROR_STOP=1", "-f", rollback], { stdio: "pipe" });
    assert.equal((await sql`select 1 from pipeline.schema_migrations where migration_id = '0040_referral_email_drafts'`).length, 0);
    await assert.rejects(() => store.putUserWorkspaceState(input), { code: "23514" });
    assert.ok(readFileSync(rollback, "utf8").includes("Never delete recipient drafts"));
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    if (started) execFileSync(binary("pg_ctl"), ["-D", data, "-w", "stop", "-m", "fast"], { stdio: "pipe" });
    rmSync(directory, { recursive: true, force: true });
  }
});

async function checkAssessorEmailPersistence(sql) {
  const database = { getPipelineDatabaseMode: () => "postgres", getPipelineDatabaseReadiness: () => ({ ready: true }), getPipelineSql: () => sql };
  const owner = () => loadEntry("lib/pipeline/meet-client-delivery-audit.ts", { "@/lib/database/pipeline-database": database });
  const packetOwner = () => loadEntry("lib/notifications/admission-packet-store.ts", { "@/lib/database/pipeline-database": database });
  const [person] = await sql`insert into pipeline.people (display_name) values ('Synthetic inbox test') returning person_id`;
  const [referral] = await sql`insert into pipeline.referrals (person_id, stage, community, created_by, created_by_name, updated_by, updated_by_name)
    values (${person.person_id}, 'Assessment', 'San Pablo', 'fixture', 'Fixture', 'fixture', 'Fixture') returning referral_id`;
  const referralId = Number(referral.referral_id);
  await sql`insert into pipeline.assessments (assessment_id, referral_id, status, version, created_by, created_by_name, updated_by, updated_by_name)
    values ('assessor-email-test', ${referralId}, 'complete', 7, 'fixture', 'Fixture', 'fixture', 'Fixture')`;
  const audit = { deliveryId: randomUUID(), mutationId: randomUUID(), referralId, assessmentId: 'assessor-email-test', assessmentVersion: 7, decisionId: 'fixture',
    status: 'reserved', actorId: 'fixture', actorName: 'Fixture', recipientCount: 1, recipientDomains: ['example.invalid'], attachmentCount: 1, attachmentBytes: 7,
    provider: 'assessor_email', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const rival = { ...audit, deliveryId: randomUUID() };
  const reservations = await Promise.all([owner().reserveMeetClientDelivery(audit), owner().reserveMeetClientDelivery(rival)]);
  assert.equal(reservations.filter(Boolean).length, 1);
  const winner = reservations[0] ? audit : rival;
  await owner().completeMeetClientDelivery(winner, 'assessor_emailed');
  const [unsent] = await sql`select meet_client_sent_at, version from pipeline.assessments where assessment_id = 'assessor-email-test'`;
  assert.equal(unsent.meet_client_sent_at, null); assert.equal(unsent.version, 7);
  assert.equal(await owner().reserveMeetClientDelivery({ ...winner, deliveryId: randomUUID() }), false);
  const packet = { schema: 1, id: winner.deliveryId, referralId, assessmentId: winner.assessmentId, assessmentVersion: 7,
    createdAt: winner.createdAt, expiresAt: winner.createdAt, files: [], recipients: [], message: { subject: 'Synthetic', body: 'Fixture' }, events: [],
    outlook: { transport: 'assessor_email', ownerId: 'fixture', mailbox: 'staff@example.invalid', status: 'draft', deliveryMode: 'attachments', audit: winner, referralVersion: 1, packetRevision: '1'.repeat(64) } };
  await packetOwner().createAdmissionPacket(packet);
  assert.equal((await packetOwner().findWorkspaceOutlookDraft(referralId)).outlook.transport, 'assessor_email');
  assert.equal((await packetOwner().listAdmissionPacketLinks(referralId)).length, 0);
  await owner().completeMeetClientDelivery(winner, 'failed', 'assessor_closed_inbox_copy', true);
  const replacement = { ...winner, deliveryId: randomUUID() };
  assert.equal(await owner().reserveMeetClientDelivery(replacement), true);
  await owner().completeMeetClientDelivery(winner, 'failed', 'assessor_closed_inbox_copy', true);
  assert.equal(await owner().reserveMeetClientDelivery({ ...winner, deliveryId: randomUUID() }), false, 'old closure cannot unlock replacement');
  await owner().completeMeetClientDelivery(replacement, 'sent');
  const [sent] = await sql`select meet_client_sent_at, meet_client_sent_version from pipeline.assessments where assessment_id = 'assessor-email-test'`;
  assert.ok(sent.meet_client_sent_at); assert.equal(sent.meet_client_sent_version, 7);
  const events = await sql`select action from pipeline.audit_events where entity_id = ${String(referralId)}`;
  assert.ok(events.some(event => event.action === 'meet_client_packet_emailed_to_assessor'));
}
