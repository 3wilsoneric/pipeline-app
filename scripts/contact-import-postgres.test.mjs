import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";

import { actor, clean, imports, loadContactStore, root, validation } from "./contact-import-fixtures.mjs";

// Opt-in only, always creates its own loopback cluster. Deliberately ignores all
// configured application/test URLs so no existing database can be touched.
test("disposable PostgreSQL contact import: additive, atomic, concurrent, retry-safe and legacy-compatible", { skip: process.env.PIPELINE_CONTACT_IMPORT_POSTGRES !== "true" }, async (t) => {
  // macOS's default temp directory can exceed PostgreSQL's Unix socket limit.
  const directory = mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "pipeline-contact-import-pg-"));
  const data = join(directory, "data");
  const socket = join(directory, "socket");
  mkdirSync(socket);
  const binary = (name) => process.env.PIPELINE_CONTACT_IMPORT_PG_BIN ? join(process.env.PIPELINE_CONTACT_IMPORT_PG_BIN, name) : name;
  let started = false;
  let sql;
  try {
    execFileSync(binary("initdb"), ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
    const port = await availablePort();
    execFileSync(binary("pg_ctl"), ["-D", data, "-l", join(directory, "postgres.log"), "-w", "start", "-o", `-p ${port} -h 127.0.0.1 -k ${socket} -F`], { stdio: "pipe" });
    started = true;
    sql = postgres({ host: "127.0.0.1", port, database: "postgres", username: process.env.USER, ssl: false, max: 8, prepare: false, onnotice: () => undefined });
    const migrationSql = postgres({ host: "127.0.0.1", port, database: "postgres", username: process.env.USER, ssl: false, max: 1, prepare: false, onnotice: () => undefined });
    try {
      for (const name of ["0001_pipeline_core.sql", "0003_operational_hardening.sql", "0034_contact_directory.sql"]) {
        await migrationSql.unsafe(readFileSync(join(root, "database", "migrations", name), "utf8"));
      }
    } finally { await migrationSql.end({ timeout: 5 }); }
    const version = (await sql`select current_setting('server_version') as version`)[0].version;
    t.diagnostic(`Disposable PostgreSQL ${version}`);
    const store = loadContactStore({ sql });
    const rows = (csv) => imports.parseContactImportCsv(csv);

    await t.test("preview/commit preserves existing inactive and differing records; replay is audit-neutral", async () => {
      const individual = await store.createContact(validation.validateContactCreateBody({ contact: { organization: "Existing", phone: "111" } }).value.contact, actor, "individual");
      const before = clean(individual.record);
      const batch = rows("organization,phone\nExisting,999\nNew,222\nNew,333");
      assert.equal((await store.previewContactDirectoryImport(batch)).counts.ready, 1);
      assert.equal((await sql`select count(*)::int as count from pipeline.contacts`)[0].count, 1);
      const result = await store.importContactDirectory(batch, actor, "batch");
      assert.equal(result.summary.counts.imported, 1);
      assert.equal(result.summary.counts.duplicates, 2);
      assert.deepEqual(clean(await store.getContact(individual.record.id)), before);
      const auditBefore = (await sql`select count(*)::int as count from pipeline.audit_events`)[0].count;
      const replay = await loadContactStore({ sql }).importContactDirectory(batch, actor, "batch");
      assert.equal(replay.idempotentReplay, true);
      assert.deepEqual(clean(replay.summary), clean(result.summary));
      assert.equal((await sql`select count(*)::int as count from pipeline.audit_events`)[0].count, auditBefore);
      assert.equal((await store.importContactDirectory(batch, actor, "batch-again")).summary.counts.imported, 0);
      assert.equal((await store.importContactDirectory(rows("organization\nChanged"), actor, "batch")).status, 409);
      await store.updateContact(individual.record.id, { active: false }, 1, actor, "inactive");
      assert.equal((await store.importContactDirectory(rows("organization\nExisting"), actor, "inactive-batch")).summary.counts.imported, 0);
      assert.equal((await store.getContact(individual.record.id)).active, false);
      const audit = await sql`select metadata, before_values, after_values from pipeline.audit_events`;
      assert.equal(audit.every((event) => event.metadata.contact_values_redacted && event.before_values === null && event.after_values === null), true);
      assert.equal(JSON.stringify(audit).includes("Existing"), false);
      const keys = await sql`select entity_id from pipeline.idempotency_keys where entity_type = 'contact_import'`;
      assert.equal(JSON.stringify(keys).includes("Existing"), false, "Import receipts contain hashes/counts/IDs only");
    });

    await t.test("invalid batch adds nothing and concurrent separate batches import one identity", async () => {
      const before = (await sql`select count(*)::int as count from pipeline.contacts`)[0].count;
      const invalid = await store.importContactDirectory(rows("organization,email\nValid,v@example.test\nInvalid,bad"), actor, "invalid");
      assert.equal(invalid.status, 422);
      assert.equal((await sql`select count(*)::int as count from pipeline.contacts`)[0].count, before);
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.importContactDirectory(rows("organization\nConcurrent"), actor, `concurrent-${i}`)));
      assert.equal(results.reduce((count, result) => count + result.summary.counts.imported, 0), 1);
      assert.equal((await sql`select count(*)::int as count from pipeline.contacts where organization = 'Concurrent'`)[0].count, 1);
      const sameId = await Promise.all(Array.from({ length: 4 }, () => store.importContactDirectory(rows("organization\nSame ID"), actor, "same-id")));
      assert.equal(sameId.filter((result) => !result.idempotentReplay).length, 1);
      assert.equal((await sql`select count(*)::int as count from pipeline.contacts where organization = 'Same ID'`)[0].count, 1);
    });

    await t.test("late audit failure rolls back contacts, revision, receipt and audit; same ID retries", async () => {
      await sql.unsafe(`create function pipeline.reject_contact_import() returns trigger language plpgsql as $$ begin if NEW.action = 'contacts_imported' then raise exception 'synthetic audit failure'; end if; return NEW; end $$;
        create trigger reject_contact_import before insert on pipeline.audit_events for each row execute function pipeline.reject_contact_import();`);
      const auditBefore = (await sql`select count(*)::int as count from pipeline.audit_events`)[0].count;
      const revisionBefore = (await sql`select revision from pipeline.store_revisions where store_name = 'contacts'`)[0].revision;
      await assert.rejects(() => store.importContactDirectory(rows("organization\nRecoverable"), actor, "recover"), /synthetic audit failure/);
      assert.equal((await sql`select count(*)::int as count from pipeline.contacts where organization = 'Recoverable'`)[0].count, 0);
      assert.equal((await sql`select count(*)::int as count from pipeline.audit_events`)[0].count, auditBefore);
      assert.equal((await sql`select revision from pipeline.store_revisions where store_name = 'contacts'`)[0].revision, revisionBefore);
      assert.equal((await sql`select count(*)::int as count from pipeline.idempotency_keys where mutation_id = 'recover'`)[0].count, 0);
      await sql`drop trigger reject_contact_import on pipeline.audit_events`;
      const recovered = await store.importContactDirectory(rows("organization\nRecoverable"), actor, "recover");
      assert.equal(recovered.summary.counts.imported, 1);
      assert.equal(recovered.idempotentReplay, false);
    });

    await t.test("legacy individual create/link/edit/version checks still work with imported facilities", async () => {
      const batch = await store.importContactDirectory(rows("organization\nLinked Facility"), actor, "linked");
      const contactId = batch.summary.rows[0].contactId;
      const person = await sql`insert into pipeline.people (display_name) values ('Synthetic Referral Fixture') returning person_id`;
      const referral = await sql`insert into pipeline.referrals (person_id, stage, community, created_by, created_by_name, updated_by, updated_by_name)
        values (${person[0].person_id}, 'New', 'fixture', ${actor.id}, ${actor.name}, ${actor.id}, ${actor.name}) returning referral_id`;
      const id = Number(referral[0].referral_id);
      const input = { contactId, role: "referral_source", relationship: "", notes: "", primaryForScheduling: false };
      const attached = await store.attachReferralContact(id, input, actor, "attach");
      assert.equal((await store.attachReferralContact(id, input, actor, "attach")).record.id, attached.record.id);
      const edit = await store.updateContact(contactId, { phone: "999" }, 1, actor, "edit");
      assert.equal(edit.record.version, 2);
      assert.equal((await store.listReferralContacts(id))[0].contact.phone, "999");
      assert.equal((await store.updateContact(contactId, { phone: "888" }, 1, actor, "stale")).conflict, true);
      assert.equal((await store.searchContacts("Linked Facility", 10))[0].id, contactId);
      assert.equal((await store.isContactLinkedToReferral(contactId, id)), true);
    });
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    if (started) execFileSync(binary("pg_ctl"), ["-D", data, "-w", "stop", "-m", "fast"], { stdio: "pipe" });
    rmSync(directory, { recursive: true, force: true });
  }
});

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
