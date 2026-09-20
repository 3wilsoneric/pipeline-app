import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { clean, loadEntry } from "./contact-import-fixtures.mjs";
import * as identity from "../lib/pipeline/client-identity-presentation.mjs";
import * as months from "../lib/pipeline/workspace-month.mjs";
import * as personaDemo from "../shared/persona-demo-config.mjs";

const referrals = [
  ...Array.from({ length: 205 }, (_, index) => ({ id: index + 1, community: "San Pablo", date: "2026-09-01", ownerId: "assessor-a" })),
  { id: 206, community: "San Pablo", date: "2026-08-01", ownerId: "assessor-a" },
  { id: 207, community: "Turlock", date: "2026-09-01", ownerId: "assessor-b" },
  { id: 208, community: "Unassigned", date: "2026-09-01", ownerId: "assessor-a" },
  { id: 209, community: "San Pablo", date: "2026-09-01", ownerId: "assessor-a", deletedAt: "2026-09-02T00:00:00Z" },
].map((referral) => ({ name: `Synthetic workspace ${referral.id}`, stage: "New", priority: "standard", tags: [], workspaceStatus: "active", ...referral }));

function loadStore(mode, sql) {
  return loadEntry("lib/pipeline/referral-store.ts", {
    "./document-lifecycle-policy": loadEntry("lib/pipeline/document-lifecycle-policy.ts"),
    "@/lib/pipeline/client-identity-presentation.mjs": identity,
    "@/lib/pipeline/workspace-month.mjs": months,
    "@/shared/persona-demo-config.mjs": personaDemo,
    "@/lib/database/pipeline-database": { getPipelineSql: () => sql, getPipelineDatabaseReadiness: () => ({ mode, ready: true }) },
  }, {
    process: { ...process, env: { ...process.env, PIPELINE_REFERRAL_STORE_MODE: mode } },
    __pipelineReferralStore: { initialized: true, referrals, revision: 0 },
  });
}

async function checkCounts(store) {
  const all = clean(await store.listReferralFacets("", { workspaceStatus: "all" }));
  assert.deepEqual(all.months, [
    { value: "2026-09", count: 207, communities: [{ value: "San Pablo", count: 205 }, { value: "Turlock", count: 1 }] },
    { value: "2026-08", count: 1, communities: [{ value: "San Pablo", count: 1 }] },
  ]);
  const mine = clean(await store.listReferralFacets("", { assignedOwnerId: "assessor-a" }));
  assert.deepEqual(mine.months[0], { value: "2026-09", count: 206, communities: [{ value: "San Pablo", count: 205 }] });
  const search = clean(await store.listReferralFacets("Synthetic workspace 207"));
  assert.deepEqual(search.months, [{ value: "2026-09", count: 1, communities: [{ value: "Turlock", count: 1 }] }]);
}

test("archive counts include all pages, separate months, exclude deleted rows, and respect owner/search scope", async () => {
  await checkCounts(loadStore("local_file"));
});

test("PostgreSQL archive counts match the local adapter", { skip: !process.env.PIPELINE_COMMUNITY_COUNTS_TEST_URL }, async () => {
  const url = new URL(process.env.PIPELINE_COMMUNITY_COUNTS_TEST_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/pipeline_community_counts_fixture");
  const sql = postgres(url.href, { ssl: false, max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      await tx`create schema pipeline`;
      await tx`create table pipeline.referrals (
        community text, county text, stage text, priority text, tags text[], owner_id text, owner_name text,
        search_text text, workspace_month date, workspace_status text, data jsonb, deleted_at timestamptz
      )`;
      for (const referral of referrals) {
        await tx`insert into pipeline.referrals (community, stage, priority, tags, owner_id, search_text, workspace_month, workspace_status, data, deleted_at)
          values (${referral.community}, ${referral.stage}, ${referral.priority}, ${referral.tags}, ${referral.ownerId}, ${referral.name.toLowerCase()}, ${referral.date}, ${referral.workspaceStatus}, '{}', ${referral.deletedAt ?? null})`;
      }
      await checkCounts(loadStore("postgres", tx));
      await tx`drop schema pipeline cascade`;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
