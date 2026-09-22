import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { clean, loadEntry, root } from "./contact-import-fixtures.mjs";

test("client file counts preserve identities, deduplication and access in PostgreSQL", async () => {
  // A private loopback cluster; configured application database URLs are unused.
  const directory = mkdtempSync("/tmp/pipeline-client-counts-pg-");
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
    sql = postgres({ host: "127.0.0.1", port, database: "postgres", username: process.env.USER, ssl: false, max: 1, prepare: false, onnotice: () => {} });
    for (const name of readdirSync(join(root, "database/migrations")).filter((name) => name.endsWith(".sql")).sort()) await sql.unsafe(readFileSync(join(root, "database/migrations", name), "utf8"));
    const people = [];
    const refs = [];
    for (const key of ["a", "b", "candidate"]) {
      const person = (await sql`insert into pipeline.people(display_name) values (${`Synthetic ${key}`}) returning person_id`)[0].person_id;
      people.push(person);
      const ref = (await sql`insert into pipeline.referrals(person_id, stage, community, workspace_status, owner_id, created_by, created_by_name, updated_by, updated_by_name)
        values (${person}, 'New', 'San Pablo', ${key === "b" ? "historical" : "active"}, ${key === "a" ? "mine" : "other"}, 'fixture','Fixture','fixture','Fixture') returning referral_id`)[0].referral_id;
      refs.push(ref);
      await sql`insert into pipeline.resident_links(person_id, referral_id, resident_key, resident_number, community_id, status, match_method, created_by, created_by_name)
        values (${person}, ${ref}, ${key}, ${key === "a" || key === "candidate" ? "100" : "200"}, 'fixture', ${key === "candidate" ? "candidate" : "confirmed"}, 'manual', 'fixture', 'Fixture')`;
    }
    const documents = [
      { person: people[0], canonical: "a", ref: refs[0] }, // Both identities: count once.
      { person: people[0], canonical: null, ref: refs[0] },
      { person: null, canonical: "a", ref: null }, // Direct clinical identity.
      { person: null, canonical: "a", ref: refs[1] }, // Restricted referral.
      { person: people[1], canonical: "b", ref: refs[1] },
      { person: people[0], canonical: "a", ref: refs[0], deleted: true },
      { person: people[0], canonical: "a", ref: refs[0], identity: "unmatched" },
      { person: people[2], canonical: null, ref: refs[2] }, // Unconfirmed person link.
    ];
    await seedSummaryDocuments(sql, documents);
    await sql.begin("read only", async (tx) => {
      const owner = loadEntry("lib/pipeline/client-workspace-store.ts", {
        "@/lib/database/pipeline-database": { getPipelineSql: () => tx },
        "@/lib/pipeline/referral-store": { getReferralStoreReadiness: () => ({ mode: "postgres" }) },
        "@/lib/pipeline/resident-link-store": {},
        "@/lib/pipeline/client-identity-presentation.mjs": {},
      });
      const clients = [{ canonicalClientId: "a", residentNumbers: ["100", "100"] }, { canonicalClientId: "alias-a", residentNumbers: ["100"] }, { canonicalClientId: "b", residentNumbers: ["200"] }, { canonicalClientId: "missing", residentNumbers: [] }];
      const user = { id: "mine", name: "Mine", roles: ["admin"] };
      const summary = (referrals, active, historical, files) => ({ referralCount: referrals, activeReferralCount: active, historicalWorkspaceCount: historical, documentCount: files });
      const all = await owner.getClinicalClientWorkspaceSummaries(user, clients);
      assert.deepEqual(clean(all.get("a")), summary(1, 1, 0, 4));
      assert.deepEqual(clean(all.get("alias-a")), summary(1, 1, 0, 2));
      assert.deepEqual(clean(all.get("b")), summary(1, 0, 1, 1));
      assert.deepEqual(clean(all.get("missing")), summary(0, 0, 0, 0));
      const restricted = await owner.getClinicalClientWorkspaceSummaries({ ...user, roles: [] }, clients);
      assert.deepEqual(clean(restricted.get("a")), summary(1, 1, 0, 3));
      assert.deepEqual(clean(restricted.get("alias-a")), summary(1, 1, 0, 2));
      assert.deepEqual(clean(restricted.get("b")), summary(0, 0, 0, 0));
      assert.equal((await owner.getClinicalClientWorkspaceSummaries(user, [])).size, 0);
    });
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    if (started) execFileSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    rmSync(directory, { recursive: true, force: true }); // Only this fixture's new directory.
  }
});

async function seedSummaryDocuments(sql, documents) {
  for (const [index, document] of documents.entries()) {
    await sql`insert into pipeline.documents(person_id, canonical_client_id, referral_id, category, file_name, content_type, byte_size, sha256, blob_container, blob_key, processing_status, uploaded_by, identity_status, deleted_at)
      values (${document.person}, ${document.canonical}, ${document.ref}, 'other', 'synthetic.pdf', 'application/pdf', 1, ${String(index).repeat(64)}, 'fixture', ${`synthetic/${index}`}, 'uploaded', 'fixture', ${document.identity ?? "linked"}, ${document.deleted ? new Date() : null})`;
  }
}
