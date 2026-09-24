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
    for (const name of ["0001_pipeline_core", "0002_workflow_engine", "0003_operational_hardening", "0004_document_processing", "0006_user_workspace_state", "0008_client_workspaces", "0012_referral_trash", "0033_workflow_continuity", "0038_assessment_packet_finalization", "0040_referral_email_drafts", "0042_admission_packet_links"]) {
      execFileSync(binary("psql"), [url, "-v", "ON_ERROR_STOP=1", "-f", join(root, "database/migrations", `${name}.sql`)], { stdio: "pipe" });
    }
    await checkAssessorEmailPersistence(sql);
    await checkCommunicationPersistence(sql);
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

async function checkCommunicationPersistence(sql) {
  const db = { getPipelineDatabaseMode: () => "postgres", getPipelineSql: () => sql };
  const store = () => loadEntry("lib/notifications/admission-packet-store.ts", { "@/lib/database/pipeline-database": db });
  const [referral] = await sql`select referral_id from pipeline.referrals limit 1`;
  const referralId = Number(referral.referral_id);
  const base = { schema: 1, referralId, assessmentId: "assessor-email-test", assessmentVersion: 7, createdAt: "2026-09-23T12:00:00.000Z", expiresAt: "2026-10-23T12:00:00.000Z", files: [{ id: "sheet", name: "Saved sheet.pdf", byteSize: 7, contentType: "application/pdf", source: { kind: "generated", encoding: "base64", content: Buffer.from("%PDF-qa").toString("base64") } }], recipients: [], message: { subject: "Preserved email", body: "Exact copy" }, events: [],
    communication: { status: "ready", ownerId: "coordinator", assessorId: "assessor", clientName: "Synthetic Client", community: "San Pablo", requestKey: "stable-key", html: "<h1>Preserved email</h1>", archiveObjects: [] } };
  const records = Array.from({ length: 22 }, (_, i) => ({ ...base, id: randomUUID(), createdAt: new Date(Date.UTC(2026, 8, 23, 12, 0, i)).toISOString() }));
  for (const record of records) await store().createAdmissionPacket(record);
  const first = await store().listCommunicationPackets({ ownerId: "assessor", query: "synthetic" });
  assert.equal(first.items.length, 20); assert.ok(first.nextCursor);
  const second = await store().listCommunicationPackets({ ownerId: "assessor", cursor: first.nextCursor });
  assert.equal(second.items.length, 2); assert.equal(second.nextCursor, undefined);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 22);
  assert.equal((await store().listCommunicationPackets({ ownerId: "other" })).items.length, 0);
  assert.equal((await store().listCommunicationPackets({ referralId: referralId + 500 })).items.length, 0);
  assert.equal((await store().findPreparedCommunication(referralId, "coordinator", "stable-key")).id, records.at(-1).id);
  const chosen = records[0].id;
  const transitions = await Promise.allSettled([1, 2].map(() => store().withAdmissionPacket(chosen, packet => {
    if (packet.communication.status !== "ready") throw new Error("already started");
    packet.communication.status = "sending";
    packet.events.push({ action: "meet_client_email_submitted", at: "2026-09-23T13:00:00.000Z", actorId: "coordinator", actorName: "Synthetic Coordinator" });
  })));
  assert.equal(transitions.filter(item => item.status === "fulfilled").length, 1);
  const restored = await store().withAdmissionPacket(chosen, packet => structuredClone(packet));
  assert.equal(restored.communication.html, base.communication.html); assert.equal(restored.events.length, 0);
  assert.equal((await sql`select 1 from pipeline.audit_events where metadata->>'packet_id' = ${chosen}`).length, 1);
  assert.equal((await store().listAdmissionPacketLinks(referralId)).length, 0);
  const [document] = await sql`insert into pipeline.documents (referral_id, category, file_name, content_type, byte_size, sha256, blob_container, blob_key, processing_status, uploaded_by, malware_scan_status, deleted_at)
    values (${referralId}, 'Other', 'Withdrawn.pdf', 'application/pdf', 7, ${"a".repeat(64)}, 'raw', 'withdrawn.pdf', 'quarantined', 'fixture', 'infected', now()) returning document_id::text`;
  const assets = loadEntry("lib/extraction/document-assets.ts", { "@/lib/database/pipeline-database": db });
  assert.equal(await assets.getDocumentFileMetadata(document.document_id), null, "ordinary file routes still hide removed files");
  assert.equal((await assets.getDocumentFileMetadata(document.document_id, { includeDeleted: true })).malware_scan_status, "infected", "history still sees adverse verdicts after withdrawal");
  const archive = { container: "artifacts", key: `communications/${referralId}/${chosen}/original` };
  await store().withAdmissionPacket(chosen, packet => { packet.communication.archiveObjects = [archive]; });
  await sql`update pipeline.referrals set deleted_at = now() - interval '31 days', delete_after = now() - interval '1 day', deleted_by = 'fixture', deleted_by_name = 'Fixture' where referral_id = ${referralId}`;
  let rejectDelete = true; const deletions = [];
  const retention = loadEntry("lib/pipeline/referral-retention.ts", {
    "@/lib/database/pipeline-database": { ...db, getPipelineDatabaseReadiness: () => ({ ready: true }) },
    "@/lib/extraction/azure-blob": { getAzureBlobUploadSigner: () => ({ deleteBlob: async (container, key) => { if (rejectDelete) throw new Error("synthetic storage outage"); deletions.push({ container, key }); return true; } }) },
    "@/lib/observability/pipeline-metrics": { recordPipelineMetric: () => {} },
  });
  assert.equal((await retention.purgeExpiredReferrals(100, true)).eligible, 1);
  assert.equal((await retention.purgeExpiredReferrals(100, false)).failed, 1);
  assert.ok(await store().withAdmissionPacket(chosen, packet => packet), "failed cleanup preserves records for retry");
  rejectDelete = false;
  assert.equal((await retention.purgeExpiredReferrals(100, false)).deleted, 1);
  assert.deepEqual(deletions, [archive, { container: "raw", key: "withdrawn.pdf" }]);
  assert.equal(await store().withAdmissionPacket(chosen, packet => packet), null, "referral retention cascades to saved messages");
}

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
