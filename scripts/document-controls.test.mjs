import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { loadEntry, root } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const policy = loadEntry("lib/pipeline/document-lifecycle-policy.ts");
test("file undo has an exact deadline and preserves later checklist and chart changes", () => {
  const before = { documentName: "old.pdf", documentStatus: "Uploaded", documentHash: "a".repeat(64), phone: "saved", sectionVersions: { documents: 2 },
    requirements: [{ id: "item", status: "reviewed", evidenceDocumentId: "doc", evidenceDocumentName: "old.pdf", version: 3 }] };
  const removed = policy.detachDocument(before, { id: "doc", name: "old.pdf" }, "now", true);
  assert.equal(removed.referral.requirements[0].status, "needed");
  assert.equal(removed.referral.phone, "saved");
  const restored = policy.restoreDocumentLinks({ ...removed.referral, sectionVersions: { documents: 3 } }, removed.recovery, "later");
  assert.equal(restored.requirements[0].status, "reviewed");
  assert.equal(restored.documentName, "old.pdf");
  const newer = { ...removed.referral, phone: "new", documentName: "new.pdf", documentStatus: "Uploaded", requirements: [{ id: "item", version: 5, status: "received", evidenceDocumentId: "new-doc" }] };
  const kept = policy.restoreDocumentLinks(newer, removed.recovery, "later");
  assert.equal(kept.requirements[0].evidenceDocumentId, "new-doc");
  assert.equal(kept.phone, "new");
  assert.equal(kept.documentName, "new.pdf");
  const deleted = { deletedAt: new Date(0).toISOString(), deletionId: "one", undoUntil: new Date(86400000).toISOString() };
  assert.equal(policy.canRestoreDocument(deleted, "one", 86399999), true);
  assert.equal(policy.canRestoreDocument(deleted, "one", 86400000), false);
  assert.equal(policy.canRestoreDocument(deleted, "old-event", 1), false);
});

test("disposable PostgreSQL document deletion, audit, undo and retention", async (t) => {
  const directory = mkdtempSync("/tmp/pipeline-document-controls-pg-");
  const data = join(directory, "data");
  const socket = join(directory, "socket");
  mkdirSync(socket);
  const port = await new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); });
  let sql;
  let started = false;
  try {
    execFileSync("initdb", ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
    execFileSync("pg_ctl", ["-D", data, "-l", join(directory, "postgres.log"), "-w", "start", "-o", `-p ${port} -h 127.0.0.1 -k ${socket} -F`], { stdio: "pipe" });
    started = true;
    sql = postgres({ host: "127.0.0.1", port, database: "postgres", username: process.env.USER, ssl: false, max: 8, prepare: false, onnotice: () => undefined });
    await sql.reserve().then(async (connection) => {
      try { for (const name of readdirSync(join(root, "database/migrations")).filter((name) => name.endsWith(".sql")).sort()) await connection.unsafe(readFileSync(join(root, "database/migrations", name), "utf8")); }
      finally { connection.release(); }
    });
    const person = (await sql`insert into pipeline.people(display_name) values ('Synthetic document owner') returning person_id`)[0];
    const row = (await sql`insert into pipeline.referrals(person_id, stage, community, owner_id, owner_name, data, created_by, created_by_name, updated_by, updated_by_name)
      values (${person.person_id}, 'New', 'San Pablo', 'fixture', 'Fixture', ${sql.json({ name: "Synthetic", ownerId: "fixture", owner: "Fixture", documentName: "", documentStatus: "Missing", note: "Keep chart" })}, 'fixture','Fixture','fixture','Fixture') returning referral_id`)[0];
    const id = Number(row.referral_id);
    // Use the actual PostgreSQL upload owner: mixed attachments must save once,
    // expose native previews directly, and never queue field extraction.
    const processing = loadEntry("lib/extraction/document-processing.ts", {
      "@/lib/database/pipeline-database": { getPipelineSql: () => sql },
      "@/lib/extraction/azure-blob": { getAzureBlobUploadSigner: () => ({
        createUploadUrls: async (input) => ({ packet_id: input.packet_id, uploads: input.files.map((file) => ({
          file_id: file.file_id, blob_path: `${input.packet_id}/${file.filename}`, expires_at: new Date(Date.now() + 60_000).toISOString(),
        })) }),
        getBlobProperties: async () => ({ exists: true, byteSize: 1 }),
      }) },
    });
    for (const contentTypes of [["application/octet-stream"], ["application/pdf", "application/zip", "text/plain", "image/png", "image/tiff", "image/heic"]]) {
      const packetId = randomUUID();
      const input = { packet_id: packetId, referral_id: String(id), source_type: "manual", submitting_facility: "Synthetic", processing_intent: "preview_only", files: contentTypes.map((content_type, index) => ({
        file_id: `file_${index}`, filename: `attachment-${index}`, content_type, size: 1, sha256: "b".repeat(64), category: "other",
      })) };
      await processing.createDurableUploadTargets(input, { id: "fixture", name: "Fixture" });
      const completion = { packet_id: packetId, uploaded_file_ids: input.files.map((file) => file.file_id) };
      const saved = await processing.completeDurableUpload(completion);
      const replay = await processing.completeDurableUpload(completion);
      assert.deepEqual(JSON.parse(JSON.stringify(replay.documents)), JSON.parse(JSON.stringify(saved.documents)));
      const jobs = await sql`select job_type from pipeline.extraction_jobs where packet_id = ${packetId}`;
      assert.equal(jobs.length, 0, "attachment-only uploads must not wait for an excluded worker");
      assert.equal(saved.status, "reviewed");
      const documents = await sql`select content_type, processing_status, preview_status, malware_scan_status from pipeline.documents where document_id in ${sql(saved.documents.map((file) => file.document_id))}`;
      assert.equal(documents.length, contentTypes.length);
      for (const document of documents) {
        assert.equal(document.processing_status, "uploaded");
        assert.equal(document.malware_scan_status, "not_scanned");
        assert.equal(document.preview_status, ["application/pdf", "text/plain", "image/png"].includes(document.content_type) ? "ready" : "unavailable");
      }
    }
    const nativePreviews = loadEntry("lib/extraction/native-document-previews.ts", {
      "@/lib/database/pipeline-database": { getPipelineSql: () => sql },
    });
    const nativeFixtures = [
      { type: "application/pdf", scan: "clean", status: "uploaded", job: "queued" },
      { type: "image/png", scan: "not_scanned", status: "uploaded", job: "dead_letter" },
      { type: "application/pdf", scan: "clean", status: "uploaded", job: "queued", deleted: true },
      { type: "application/pdf", scan: "infected", status: "uploaded", job: "queued" },
      { type: "application/pdf", scan: "pending", status: "reserved", job: "queued" },
      { type: "image/tiff", scan: "clean", status: "uploaded", job: "queued" },
      { type: "application/pdf", scan: "clean", status: "uploaded", job: "running" },
      { type: "application/pdf", scan: "clean", status: "uploaded", job: "queued", kind: "referral_packet" },
    ];
    const fixtureIds = [];
    for (const fixture of nativeFixtures) {
      const documentId = randomUUID(); fixtureIds.push(documentId);
      await sql`insert into pipeline.documents(document_id, referral_id, category, file_name, content_type, byte_size, sha256, blob_container, blob_key, processing_status, malware_scan_status, uploaded_by, deleted_at)
        values (${documentId}, ${id}, 'other', 'synthetic', ${fixture.type}, 20, ${"a".repeat(64)}, 'raw', ${documentId}, ${fixture.status}, ${fixture.scan}, 'fixture', ${fixture.deleted ? new Date() : null})`;
      await sql`insert into pipeline.extraction_jobs(document_id,job_type,status) values (${documentId},${fixture.kind ?? "document_preview"},${fixture.job})`;
    }
    const beforeNative = await sql`select data from pipeline.referrals where referral_id=${id}`;
    assert.deepEqual(JSON.parse(JSON.stringify(await nativePreviews.reconcileNativeDocumentPreviews())), { native_ready: 2, deleted_cancelled: 1 });
    for (const [index, fixture] of nativeFixtures.entries()) {
      const [actual] = await sql`select d.preview_status,d.processing_status,d.malware_scan_status,j.status from pipeline.documents d join pipeline.extraction_jobs j using(document_id) where d.document_id=${fixtureIds[index]}`;
      assert.equal(actual.preview_status, index < 2 ? "ready" : "pending");
      assert.equal(actual.status, index < 3 ? "cancelled" : fixture.job);
      assert.equal(actual.processing_status, fixture.status);
      assert.equal(actual.malware_scan_status, fixture.scan);
    }
    const audits = await sql`select metadata from pipeline.audit_events where action='document_preview_reconciled'`;
    assert.equal(audits.length, 3);
    assert.ok(audits.every((event) => event.metadata.previous_job_status && event.metadata.reason));
    assert.deepEqual(await sql`select data from pipeline.referrals where referral_id=${id}`, beforeNative);
    assert.deepEqual(JSON.parse(JSON.stringify(await nativePreviews.reconcileNativeDocumentPreviews())), { native_ready: 0, deleted_cancelled: 0 });
    assert.equal((await sql`select entity_id from pipeline.audit_events where action='document_preview_reconciled'`).length, 3);

    const documentId = randomUUID();
    await sql`insert into pipeline.documents(document_id, referral_id, category, file_name, content_type, byte_size, sha256, blob_container, blob_key, processing_status, uploaded_by)
      values (${documentId}, ${id}, 'other', 'synthetic.pdf', 'application/pdf', 20, ${"a".repeat(64)}, 'raw', ${documentId}, 'uploaded', 'fixture')`;
    const item = { id: randomUUID(), type: "medication_list", label: "Medication list", requiredFor: "pre_assessment", status: "reviewed", version: 3,
      evidenceDocumentId: documentId, evidenceDocumentName: "synthetic.pdf", nextStep: "Review" };
    await sql`insert into pipeline.work_items(work_item_id, referral_id, person_id, type, label, gate, status, next_action, evidence_document_id, evidence_document_name, version)
      values (${item.id}, ${id}, ${person.person_id}, ${item.type}, ${item.label}, ${item.requiredFor}, ${item.status}, ${item.nextStep}, ${documentId}, ${item.evidenceDocumentName}, 3)`;
    await sql`update pipeline.referrals set data = data || ${sql.json({ requirements: [item] })}::jsonb where referral_id = ${id}`;
    const getReferral = async () => { const rows = await sql`select * from pipeline.referrals where referral_id = ${id}`; return { ...rows[0].data, id, version: rows[0].version, sectionVersions: rows[0].section_versions }; };
    const owner = loadEntry("lib/pipeline/document-lifecycle.ts", {
      "@/lib/database/pipeline-database": { getPipelineSql: () => sql },
      "@/lib/extraction/mock-store": {},
      "@/lib/extraction/document-processing": loadEntry("lib/extraction/document-processing-error.ts"),
      "@/lib/extraction/document-assets": { isDocumentId: (value) => /^[0-9a-f-]{36}$/i.test(value) },
      "./base-path": { toPipelinePath: (path) => path }, "./document-lifecycle-policy": policy,
      "./referral-store": { getReferralStoreReadiness: () => ({ mode: "postgres" }), getReferral },
      "./referral-sections": loadTypeScriptModule(root, "lib/pipeline/referral-sections.ts"),
      "./referral-ownership": loadTypeScriptModule(root, "lib/pipeline/referral-ownership.ts"),
      "./workflow-status": loadTypeScriptModule(root, "lib/pipeline/workflow-status.ts"),
    });
    const actor = { id: "fixture", name: "Fixture" };
    const user = { ...actor, roles: ["reviewer"], email: "fixture@example.invalid" };
    const completion = { packet_id: randomUUID(), status: "received", documents: [{ document_id: documentId, filename: "synthetic.pdf" }] };
    await Promise.all(Array.from({ length: 8 }, () => owner.recordUploadedDocuments(id, completion, actor)));
    assert.equal(Number((await sql`select count(*) from pipeline.audit_events where action = 'document_uploaded'`)[0].count), 1);
    await assert.rejects(owner.changeDocument(documentId, id, "delete", actor, { ...user, accessScope: "note_lab" }), /permission/);
    const deletions = await Promise.all(Array.from({ length: 8 }, () => owner.changeDocument(documentId, id, "delete", actor, user)));
    assert.equal(new Set(deletions.map((entry) => entry.deletion_id)).size, 1);
    assert.equal(Number((await sql`select count(*) from pipeline.audit_events where action = 'document_deleted'`)[0].count), 1);
    const deletion = deletions[0];
    const recoveryBefore = (await sql`select row_to_json(d)::text as snapshot from pipeline.documents d where document_id = ${documentId}`)[0].snapshot;
    const rollback = await sql.reserve();
    try { await rollback.unsafe(readFileSync(join(root, "database/rollbacks/0037_document_undo.sql"), "utf8")); }
    finally { rollback.release(); }
    assert.equal((await sql`select row_to_json(d)::text as snapshot from pipeline.documents d where document_id = ${documentId}`)[0].snapshot, recoveryBefore);
    assert.equal(Number((await sql`select count(*) from pipeline.schema_migrations where migration_id = '0037_document_undo'`)[0].count), 1);
    assert.equal(Number((await sql`select count(*) from pipeline.audit_events where action = 'document_deleted'`)[0].count), 1);
    assert.equal((await sql`select status from pipeline.work_items where work_item_id = ${item.id}`)[0].status, "needed");
    await owner.changeDocument(documentId, id, "restore", actor, user, deletion.deletion_id);
    await owner.changeDocument(documentId, id, "restore", actor, user, deletion.deletion_id);
    assert.equal(Number((await sql`select count(*) from pipeline.audit_events where action = 'document_restored'`)[0].count), 1);
    assert.equal((await getReferral()).note, "Keep chart");
    assert.equal((await sql`select status from pipeline.work_items where work_item_id = ${item.id}`)[0].status, "reviewed");
    const again = await owner.changeDocument(documentId, id, "delete", actor, user);
    await assert.rejects(owner.changeDocument(documentId, id, "restore", actor, user, deletion.deletion_id), /no longer/);
    await sql`update pipeline.documents set undo_until = now() - interval '1 second' where document_id = ${documentId}`;
    await assert.rejects(owner.changeDocument(documentId, id, "restore", actor, user, again.deletion_id), /no longer/);
    const removed = [];
    let failDeletion = true;
    const retention = loadEntry("lib/pipeline/document-undo-retention.ts", {
      "@/lib/database/pipeline-database": { getPipelineSql: () => sql },
      "@/lib/extraction/azure-blob": { getAzureBlobUploadSigner: () => ({ deleteBlob: async (...args) => {
        if (failDeletion) throw new Error("Synthetic storage outage"); removed.push(args);
      } }) },
    });
    assert.equal((await retention.purgeExpiredDocumentUndo(100, true)).eligible, 1);
    assert.equal(removed.length, 0);
    assert.equal((await retention.purgeExpiredDocumentUndo(100, false)).failed, 1);
    failDeletion = false;
    assert.equal((await retention.purgeExpiredDocumentUndo(100, false)).deleted, 1);
    assert.equal(removed.length, 1);
    assert.equal((await sql`select deletion_recovery from pipeline.documents where document_id = ${documentId}`)[0].deletion_recovery, null);
    assert.equal((await retention.purgeExpiredDocumentUndo(100, false)).eligible, 0);
    assert.equal(Number((await sql`select count(*) from pipeline.audit_events where entity_id = ${documentId}`)[0].count), 4);
    t.diagnostic("Real isolated PostgreSQL; blob deletion stubbed, no Azure or production data touched.");
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    rmSync(directory, { recursive: true, force: true }); // Exact directory created by this fixture.
  }
});
