#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const directory = await mkdtemp(join(tmpdir(), "pipeline-personal-board-"));
const users = [
  { id: "assessor-one", name: "Assessor One", roles: ["reviewer"] },
  { id: "supervisor-one", name: "Supervisor One", roles: ["assessment_coordinator", "reviewer"] },
  { id: "admin-one", name: "Admin One", roles: ["admin"] },
];
function referral(id, owner, date, extra = {}) {
  return { id, name: `Avery ${id}`, owner: owner.name, ownerId: owner.id, owners: [], date,
    stage: "Packet Review", workflowStatus: "ready_to_schedule", workspaceStatus: "active", workspaceOrigin: "pipeline",
    community: "Turlock", county: "Stanislaus County", priority: "standard", source: "Synthetic", note: "", tags: [], requirements: [],
    packetId: `personal-board-${id}`, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", version: 1, ...extra };
}
const referrals = [
  referral(1, users[0], "09/01/2026", { updatedAt: "2026-09-30T00:00:00Z" }),
  referral(2, users[0], "09/17/2026", { owners: [{ id: users[1].id, name: users[1].name, responsibilities: ["creator"] }] }),
  referral(3, users[1], "2026-09-15", { name: "Blair Example" }),
  referral(4, users[2], "2026-09-16", { name: "Cameron Example" }),
  referral(5, users[1], "2026-09-19", { owners: [{ id: users[0].id, name: users[0].name, responsibilities: ["assigning_supervisor"] }], workflowStatus: "recommendation_submitted", stage: "Community Review" }),
  referral(6, users[0], "2026-09-12", { stage: "Declined", workflowStatus: "declined" }),
  referral(7, users[0], "2026-09-13", { stage: "Accepted / Admitted", workflowStatus: "admitted" }),
  referral(8, users[0], "2026-09-20", { deletedAt: "2026-09-20T01:00:00Z" }),
  referral(9, users[1], "", { name: "Zoe Older", workspaceStatus: "historical", createdAt: "2024-01-01T00:00:00Z" }),
  referral(10, users[0], "2026-09-17", { name: "Avery Tie", ownerId: undefined }),
];
const environment = { ...process.env, NODE_ENV: "test", PIPELINE_DATABASE_MODE: "local_file", PIPELINE_DATABASE_URL: "",
  PIPELINE_REFERRAL_STORE_MODE: "local_file", PIPELINE_REFERRAL_STORE_PATH: join(directory, "referrals.json"),
  PIPELINE_ASSESSMENT_STORE_MODE: "local_file", PIPELINE_ASSESSMENT_STORE_PATH: join(directory, "assessments.json"),
  PIPELINE_RESIDENT_LINK_STORE_MODE: "local_file", PIPELINE_RESIDENT_LINK_STORE_PATH: join(directory, "links.json"),
  PIPELINE_EXTRACTION_BACKEND: "mock", PIPELINE_DEMO_MODE: "false" };
try {
  await writeFile(environment.PIPELINE_REFERRAL_STORE_PATH, JSON.stringify({ version: 1, revision: 1, next_id: 11, referrals }));
  const globals = { process: Object.assign(Object.create(process), { env: environment }) };
  const operations = loadTypeScriptModule(process.cwd(), "lib/pipeline/operations-snapshot.ts", globals);
  for (const [index, expected] of [[0, [5, 10, 2, 7, 6, 1]], [1, [5, 2, 3]], [2, [4]]]) {
    const summary = await operations.getHomeWorkflowSummary(users[index]);
    assert.deepEqual(Array.from(summary.board_items, (item) => item.referral_id), expected, `personal Board and receipt order for ${users[index].roles}`);
    assert.equal(summary.active_total, expected.filter((id) => ![6, 7].includes(id)).length);
  }
  const store = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-store.ts", globals);
  const first = await store.listReferrals({ workspaceStatus: "all", sort: "received_desc", limit: 3 });
  const second = await store.listReferrals({ workspaceStatus: "all", sort: "received_desc", limit: 3, cursor: first.next_cursor });
  assert.deepEqual(Array.from(first.referrals, (r) => r.id), [5, 10, 2]);
  assert.deepEqual(Array.from(second.referrals, (r) => r.id), [4, 3, 7]);
  assert.equal(first.total, 9, "all dates/owners and history included; Trash excluded");
  const names = await store.listReferrals({ workspaceStatus: "all", sort: "client_asc", nameInitial: "Z", limit: 1 });
  assert.deepEqual(Array.from(names.referrals, (r) => r.id), [9], "name index searches beyond loaded pages");
  const match = await store.listReferrals({ workspaceStatus: "all", query: "Blair", owner: users[1].name, community: "Turlock", stage: "Packet Review" });
  assert.deepEqual(Array.from(match.referrals, (r) => r.id), [3]);
  const access = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-access.ts", globals);
  for (const user of users) assert.equal((await access.requireMutableReferralAccess(user, 3)).ok, true, "personal Board does not change edit access");
  const flow = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-flow.ts", globals);
  assert.equal(flow.isFinishedBoardReferral({ workflow_status: "admitted", assessment_is_reassessment: true, flow_state: "assessment" }), false);
  const query = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-query.ts", globals);
  assert.equal(query.parseReferralListQuery(new URLSearchParams("sort=received_desc&initial=A&workspace=all&scope=team")).ok, true);
  assert.equal(query.parseReferralListQuery(new URLSearchParams("initial=AB")).ok, false);
  if (process.env.PIPELINE_TEST_DATABASE_URL) {
    const url = new URL(process.env.PIPELINE_TEST_DATABASE_URL);
    assert.equal(url.hostname, "localhost", "PostgreSQL fixture only permits the disposable local database");
    assert.match(url.pathname, /^\/pipeline_board_browser_[a-z0-9_]+$/);
    const { default: postgres } = await import("postgres");
    const sql = postgres(url.toString(), { ssl: false, max: 1, onnotice: () => undefined });
    try {
      assert.equal(Number((await sql`select count(*) as count from pipeline.referrals`)[0].count), 0, "fixture database must be empty");
      const dates = loadTypeScriptModule(process.cwd(), "lib/pipeline/calendar-date.ts");
      for (const file of referrals) {
        const [person] = await sql`insert into pipeline.people(external_client_id, display_name) values (${`board-fixture-${file.id}`}, ${file.name}) returning person_id`;
        await sql`insert into pipeline.referrals(referral_id, person_id, stage, workflow_status, community, owner_id, owner_name, priority, source, received_date, search_text, data, created_at, updated_at, deleted_at, delete_after, deleted_by, deleted_by_name, workspace_status, created_by, created_by_name, updated_by, updated_by_name)
          values (${file.id}, ${person.person_id}, ${file.stage}, ${file.workflowStatus}, ${file.community}, ${file.ownerId ?? null}, ${file.owner}, ${file.priority}, ${file.source}, ${dates.normalizeCalendarDate(file.date)}::date, ${`${file.name} ${file.community} ${file.owner}`.toLowerCase()}, ${sql.json(file)}, ${file.createdAt}, ${file.updatedAt}, ${file.deletedAt ?? null}, ${file.deletedAt ? "2026-10-20T00:00:00Z" : null}, ${file.deletedAt ? "fixture" : null}, ${file.deletedAt ? "Fixture" : null}, ${file.workspaceStatus}, 'fixture', 'Fixture', 'fixture', 'Fixture')`;
      }
      const databaseGlobal = { __pipelineSql: sql };
      const pgEnvironment = { ...environment, PIPELINE_DATABASE_MODE: "postgres", PIPELINE_REFERRAL_STORE_MODE: "postgres", PIPELINE_DATABASE_URL: url.toString(), PIPELINE_DATABASE_SSL_MODE: "disable" };
      const pgStore = loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-store.ts", { globalThis: databaseGlobal, process: Object.assign(Object.create(process), { env: pgEnvironment }) });
      for (const options of [
        { workspaceStatus: "all", sort: "received_desc", limit: 3 },
        { workspaceStatus: "all", sort: "received_desc", limit: 3, cursor: first.next_cursor },
        { workspaceStatus: "all", sort: "client_asc", nameInitial: "Z", limit: 1 },
        { workspaceStatus: "all", query: "Blair", owner: users[1].name, community: "Turlock", stage: "Packet Review" },
      ]) {
        const local = await store.listReferrals(options);
        const pg = await pgStore.listReferrals(options);
        assert.deepEqual(Array.from(pg.referrals, (r) => r.id), Array.from(local.referrals, (r) => r.id), "PostgreSQL and local query parity");
        assert.equal(pg.total, local.total);
      }
      const namePage = await pgStore.listReferrals({ workspaceStatus: "all", sort: "client_asc", limit: 2 });
      const nextNamePage = await pgStore.listReferrals({ workspaceStatus: "all", sort: "client_asc", limit: 2, cursor: namePage.next_cursor });
      assert.equal(nextNamePage.referrals.length, 2, "non-date cursors remain valid with receipt sorting available");
      console.log(JSON.stringify({ ok: true, postgres: "real adapter: receipt sort/ties, pagination, alphabet, combined filters, all records and name cursor parity" }));
    } finally { await sql.end(); }
  }
  console.log(JSON.stringify({ ok: true, checks: "personal owners/assessors across roles; legacy names; submitted and finished work; stable receipt order/ties; pagination; historical/all-owner search; alphabet and combined filters; unchanged edit access; query validation" }));
} finally { await rm(directory, { recursive: true, force: true }); }
