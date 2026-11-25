import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import { loadEntry } from "./contact-import-fixtures.mjs";
import * as identity from "../lib/pipeline/client-identity-presentation.mjs";
import * as months from "../lib/pipeline/workspace-month.mjs";

test("source pagination preserves PostgreSQL microseconds and equal-timestamp ties", { skip: !process.env.PIPELINE_TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.PIPELINE_TEST_DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "Only a disposable local database is allowed");
  assert.notEqual(url.href, process.env.PIPELINE_DATABASE_URL);
  url.pathname = "/postgres";
  const admin = postgres(url.href, { ssl: false, max: 1, prepare: false, onnotice() {} });
  const name = `pipeline_paging_${process.pid}`;
  let sql;
  try {
    await admin.unsafe(`create database "${name}"`);
    url.pathname = `/${name}`;
    sql = postgres(url.href, { ssl: false, max: 1, prepare: false, onnotice() {} });
    for (const file of (await readdir("database/migrations")).filter(file => file.endsWith(".sql")).sort()) {
      await sql.unsafe(await readFile(`database/migrations/${file}`, "utf8"));
    }
    const [{ person_id }] = await sql`insert into pipeline.people (display_name) values ('Synthetic Paging Client') returning person_id`;
    const actor = "paging-fixture", refs = [];
    // Every timestamp shares a millisecond; two records also share an exact
    // microsecond. Native PostgreSQL literals preserve the stored precision.
    const stamps = [123001, 123127, 123127, 123402, 123678, 123999];
    for (const [index, fraction] of stamps.entries()) {
      const stamp = `2026-10-13T17:38:56.${fraction}Z`;
      const [{ referral_id }] = await sql`insert into pipeline.referrals
        (person_id, stage, community, created_by, created_by_name, updated_by, updated_by_name, created_at, updated_at)
        values (${person_id}, 'New', 'San Pablo', ${actor}, ${actor}, ${actor}, ${actor}, ${stamp}::text::timestamptz, ${stamp}::text::timestamptz)
        returning referral_id`;
      refs.push(Number(referral_id));
      await sql`insert into pipeline.assessments
        (assessment_id, revision_root_id, referral_id, status, data, created_by, created_by_name, updated_by, updated_by_name, created_at, updated_at)
        values (${`paging-${index}`}, ${`paging-${index}`}, ${referral_id}, 'draft', '{}', ${actor}, ${actor}, ${actor}, ${actor}, ${stamp}::text::timestamptz, ${stamp}::text::timestamptz)`;
      await sql`insert into pipeline.documents
        (referral_id, person_id, category, file_name, content_type, byte_size, sha256, blob_container, blob_key, processing_status, uploaded_by, identity_status, uploaded_at)
        values (${referral_id}, ${person_id}, 'other', ${`fixture-${index}.pdf`}, 'application/pdf', 100, ${String(index).repeat(64)}, 'fixture', ${`paging/${index}`}, 'uploaded', ${actor}, 'linked', ${stamp}::text::timestamptz)`;
    }
    await sql.begin("read only", async tx => {
      const database = { getPipelineSql: () => tx, getPipelineDatabaseReadiness: () => ({ mode: "postgres", ready: true }) };
      const globals = { process: { ...process, env: { ...process.env, PIPELINE_REFERRAL_STORE_MODE: "postgres", PIPELINE_ASSESSMENT_STORE_MODE: "postgres" } } };
      const referrals = loadEntry("lib/pipeline/referral-store.ts", { "@/lib/database/pipeline-database": database, "@/lib/pipeline/client-identity-presentation.mjs": identity, "@/lib/pipeline/workspace-month.mjs": months }, globals);
      const assessments = loadEntry("lib/assessment/assessment-store.ts", { "@/lib/database/pipeline-database": database, "@/lib/pipeline/referral-store": referrals }, globals);
      for (const sort of ["created_asc", "created_desc", "updated_desc"]) await t.test(`referrals: ${sort}`, async () => {
        const ids = await collect(cursor => referrals.listReferrals({ cursor, sort, limit: 2, workspaceStatus: "all" }), "referrals", row => row.id);
        assert.deepEqual(ids.map(Number), sort === "created_asc" ? refs : [...refs].reverse());
      });
      await t.test("assessments", async () => {
        const ids = await collect(cursor => assessments.listAssessments({ cursor, limit: 2 }), "assessments", row => row.assessment_id);
        assert.deepEqual(ids, stamps.map((_, index) => `paging-${index}`).reverse());
      });
      await t.test("files", async () => {
        const expected = await tx`select document_id::text id from pipeline.documents order by uploaded_at desc, document_id::text desc`;
        const ids = await collect(cursor => referrals.listReferralFiles({ cursor, limit: 2 }), "files", row => row.id);
        assert.deepEqual(ids, expected.map(row => row.id));
      });
    });
  } finally {
    await sql?.end();
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});

async function collect(read, key, id) {
  const seen = new Set(), ids = [];
  let cursor;
  for (let page = 0; page < 5; page++) {
    const result = await read(cursor);
    assert.equal(result.total, 6);
    assert.equal(result[key].length, 2);
    for (const row of result[key]) {
      const value = id(row);
      assert.notEqual(value, undefined);
      assert.equal(seen.has(value), false, `Repeated ${key} record across page boundary`);
      seen.add(value); ids.push(value);
    }
    cursor = result.next_cursor;
    if (!cursor) return ids;
  }
  assert.fail("Cursor failed to terminate");
}
