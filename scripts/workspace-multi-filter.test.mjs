import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { join, resolve } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
import { currentWorkspaceMonth } from "../lib/pipeline/workspace-month.mjs";

const root = resolve(import.meta.dirname, "..");
const clean = (value) => JSON.parse(JSON.stringify(value));
const query = loadTypeScriptModule(root, "lib/pipeline/referral-query.ts");
const ownerIdentity = loadTypeScriptModule(root, "lib/pipeline/referral-owner-identity.ts");
const referrals = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1, name: `Filter Fixture ${i + 1}`, stage: "New", date: "2026-09-17",
  community: ["San Pablo", "Santa Clarita", "Turlock"][i % 3], county: "Fixture County",
  owner: i === 9 ? "Alex  Assessor" : ["Alex Assessor", "Blair Assessor", "pending"][Math.floor(i / 3) % 3],
  ownerId: `owner-${Math.floor(i / 3) % 3}`, source: "Synthetic", priority: "standard",
  documentName: `filter-${i + 1}.pdf`, documentStatus: "Uploaded", requirements: [],
  note: "", workspaceStatus: "active", createdAt: "2026-09-17T12:00:00.000Z", updatedAt: "2026-09-17T12:00:00.000Z",
}));

test("owner menus omit retired and unassigned entries and combine whitespace duplicates", () => {
  const names = ["Marta", "Lorena Renaud", "Lily Florian", "Unassigned", "pending", "", "Sandeep  Singh", "Sandeep Singh", "Annette Everhart", "Vince Ceja", "Andrew Dominici", "Jazmine Saldana", "Eric Wilson"];
  assert.deepEqual(clean(ownerIdentity.ownerFilterOptions(names)), ["Andrew Dominici", "Annette Everhart", "Eric Wilson", "Jazmine Saldana", "Sandeep Singh", "Vince Ceja"]);
  assert.equal(names[6], "Sandeep  Singh");
});

test("repeated query parameters validate every value and cannot supply assignment scope", () => {
  const parsed = query.parseReferralListQuery(new URLSearchParams("community=San+Pablo&community=Santa+Clarita&owner=Alex+Assessor&owner=Blair+Assessor&assignedOwnerId=other&scope=mine"));
  assert.equal(parsed.ok, true);
  assert.deepEqual(clean(parsed.value.communities), ["San Pablo", "Santa Clarita"]);
  assert.deepEqual(clean(parsed.value.owners), ["Alex Assessor", "Blair Assessor"]);
  assert.equal(parsed.value.assignedOwnerId, undefined);
  assert.equal(parsed.value.scope, "mine");
  for (const value of ["community=San+Pablo&community=Invalid", `owner=Alex&owner=${"x".repeat(201)}`, Array(51).fill("owner=Alex").join("&")]) {
    assert.equal(query.parseReferralListQuery(new URLSearchParams(value)).ok, false);
  }
  assert.equal(query.parseReferralListQuery(new URLSearchParams("community=San+Pablo&owner=Alex")).value.community, "San Pablo");
  assert.equal(query.parseReferralListQuery(new URLSearchParams("month=2026-10&carryover=true")).value.includeCarryover, true);
  assert.equal(query.parseReferralListQuery(new URLSearchParams("carryover=maybe")).ok, false);
});

function loadStore(sql, records = referrals) {
  return loadTypeScriptModule(root, "lib/pipeline/referral-store.ts", {
    __pipelineSql: sql,
    __pipelineReferralStore: { initialized: true, revision: 1, nextId: 13, referrals: structuredClone(records), auditEvents: [], createMutations: new Map(), patchMutations: new Map(), persistQueue: Promise.resolve() },
    process: { ...process, env: { ...process.env, NODE_ENV: "test", PIPELINE_DATABASE_MODE: sql ? "postgres" : "disconnected", PIPELINE_REFERRAL_STORE_MODE: sql ? "postgres" : "local_file", PIPELINE_DATABASE_URL: sql ? "disposable-test-only" : "", PIPELINE_ALLOW_LOCAL_REFERRAL_STORE: "true" } },
  });
}

const thisMonth = currentWorkspaceMonth();
const priorDate = new Date(`${thisMonth}-01T00:00:00.000Z`);
priorDate.setUTCMonth(priorDate.getUTCMonth() - 1);
const priorMonth = priorDate.toISOString().slice(0, 7);
const carryoverRecords = [
  { id: 101, name: "Carryover Open", ownerId: "owner-0" },
  { id: 102, name: "Carryover Declined", stage: "Declined", admissionDecision: { outcome: "declined" } },
  { id: 103, name: "Carryover Planned", ownerId: "owner-0", admissionDecision: { outcome: "accepted" }, plannedAdmissionDate: `${thisMonth}-15` },
  { id: 104, name: "Carryover Admitted", admissionDecision: { outcome: "accepted" }, actualAdmissionDate: `${priorMonth}-28` },
  { id: 105, name: "Carryover Historical", workspaceStatus: "historical" },
  { id: 106, name: "Carryover Terminal", stage: "Accepted / Admitted" },
  { id: 107, name: "Carryover Archived", workspaceStatus: "archived" },
  { id: 108, name: "Current Intake", ownerId: "owner-0", date: `${thisMonth}-01`, workspaceMonth: thisMonth },
].map((item) => ({
  stage: "New", community: "San Pablo", owner: "Fixture Assessor", ownerId: "owner-1",
  source: "Synthetic", priority: "standard", documentName: "fixture.pdf", documentStatus: "Uploaded",
  requirements: [], note: "", workspaceStatus: "active", workspaceOrigin: "pipeline",
  date: `${priorMonth}-01`, workspaceMonth: priorMonth, createdAt: `${priorMonth}-01T12:00:00.000Z`,
  updatedAt: `${priorMonth}-01T12:00:00.000Z`, ...item,
  ...(item.id === 108 ? { createdAt: `${thisMonth}-01T12:00:00.000Z`, updatedAt: `${thisMonth}-01T12:00:00.000Z` } : {}),
}));

async function verifyCarryover(store) {
  const directory = { month: thisMonth, includeCarryover: true, workspaceStatus: "all" };
  const first = await store.listReferrals(directory);
  assert.equal(first.total, 3);
  assert.deepEqual(first.referrals.map((item) => item.id).sort((a, b) => a - b), [101, 103, 108]);
  assert.equal((await store.listReferrals({ month: thisMonth, workspaceStatus: "all" })).total, 1);
  assert.equal((await store.listReferrals({ month: priorMonth, includeCarryover: true, workspaceStatus: "all" })).total, 7);
  assert.equal((await store.listReferrals({ ...directory, assignedOwnerId: "owner-0" })).total, 3);
  assert.equal((await store.listReferrals({ ...directory, assignedOwnerId: "owner-1" })).total, 0);
  assert.equal((await store.listReferrals({ ...directory, query: "Carryover Planned" })).total, 1);
  const paged = [];
  let cursor;
  do {
    const page = await store.listReferrals({ ...directory, limit: 1, cursor });
    paged.push(...page.referrals.map((item) => item.id));
    cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(paged.sort((a, b) => a - b), [101, 103, 108]);
  const facets = await store.listReferralFacets("", { workspaceStatus: "all", includeCarryover: true });
  assert.equal(facets.months.find((month) => month.value === thisMonth)?.count, 3);
  assert.equal(facets.months.find((month) => month.value === priorMonth)?.count, 7);
  assert.equal(facets.stages.reduce((count, stage) => count + stage.count, 0), 8);
  assert.equal((await store.listReferralFacets("", { workspaceStatus: "all" })).months.find((month) => month.value === thisMonth)?.count, 1);
}

test("unfinished workspaces carry into the next month without changing their filing month", async () => {
  await verifyCarryover(loadStore(undefined, carryoverRecords));
});

async function verifyFilters(store) {
  const selected = { communities: ["San Pablo", "Santa Clarita"], owners: ["Alex Assessor", "Blair Assessor"] };
  const expected = [1, 2, 4, 5, 10, 11];
  for (const [method, rows, key] of [["listReferrals", "referrals", "id"], ["listReferralFiles", "files", "referralId"]]) {
    const found = [];
    let cursor;
    do {
      const page = await store[method]({ ...selected, limit: 2, cursor, workspaceStatus: "all" });
      assert.equal(page.total, 6);
      assert.ok(page[rows].length <= 2);
      found.push(...page[rows].map((row) => row[key]));
      cursor = page.next_cursor;
    } while (cursor);
    assert.deepEqual(found.sort((a, b) => a - b), expected);
    assert.equal(new Set(found).size, found.length);
    assert.equal((await store[method]({ ...selected, assignedOwnerId: "owner-1", assignedOwnerNames: [], workspaceStatus: "all" })).total, 2);
    assert.equal((await store[method]({ ...selected, assignedOwnerId: "not-assigned", assignedOwnerNames: [], workspaceStatus: "all" })).total, 0);
    assert.equal((await store[method]({ communities: ["San Pablo", "Santa Clarita"], owners: ["Unassigned"], workspaceStatus: "all" })).total, 2);
    assert.equal((await store[method]({ communities: [], owners: [], workspaceStatus: "all" })).total, 12);
    assert.equal((await store[method]({ community: "San Pablo", owner: "Blair Assessor", workspaceStatus: "all" })).total, 1);
  }
}

test("local workspace and file filters compose before pagination and retain assignment restrictions", async () => {
  await verifyFilters(loadStore());
});

// Always starts a fresh loopback cluster; never uses an application database URL.
test("PostgreSQL workspace and file filters match the local adapter", { skip: process.env.PIPELINE_FILTER_POSTGRES !== "true" }, async () => {
  const directory = mkdtempSync("/tmp/pipeline-filter-pg-");
  const data = join(directory, "data");
  const socket = join(directory, "socket");
  mkdirSync(socket);
  const binary = (name) => process.env.PIPELINE_FILTER_PG_BIN ? join(process.env.PIPELINE_FILTER_PG_BIN, name) : name;
  let started = false;
  let sql;
  try {
    execFileSync(binary("initdb"), ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
    const port = await new Promise((resolvePort, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolvePort(port)); });
    });
    execFileSync(binary("pg_ctl"), ["-D", data, "-l", join(directory, "postgres.log"), "-w", "start", "-o", `-p ${port} -h 127.0.0.1 -k ${socket} -F`], { stdio: "pipe" });
    started = true;
    sql = postgres({ host: "127.0.0.1", port, database: "postgres", username: process.env.USER, ssl: false, max: 1, prepare: false, onnotice: () => undefined });
    for (const name of readdirSync(join(root, "database/migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      await sql.unsafe(readFileSync(join(root, "database/migrations", name), "utf8"));
    }
    for (const referral of referrals) {
      const [person] = await sql`insert into pipeline.people (display_name) values (${referral.name}) returning person_id`;
      await sql`insert into pipeline.referrals (referral_id, person_id, stage, community, owner_id, owner_name, data, created_at, updated_at, created_by, created_by_name, updated_by, updated_by_name)
        values (${referral.id}, ${person.person_id}, ${referral.stage}, ${referral.community}, ${referral.ownerId}, ${referral.owner}, ${sql.json(referral)}, ${referral.createdAt}, ${referral.updatedAt}, 'fixture', 'Fixture', 'fixture', 'Fixture')`;
    }
    await verifyFilters(loadStore(sql));
    await sql`truncate table pipeline.referrals cascade`;
    for (const referral of carryoverRecords) {
      const [person] = await sql`insert into pipeline.people (display_name) values (${referral.name}) returning person_id`;
      await sql`insert into pipeline.referrals (referral_id, person_id, stage, community, workspace_status, owner_id, owner_name, search_text, data, created_at, updated_at, created_by, created_by_name, updated_by, updated_by_name)
        values (${referral.id}, ${person.person_id}, ${referral.stage}, ${referral.community}, ${referral.workspaceStatus}, ${referral.ownerId}, ${referral.owner}, ${referral.name.toLowerCase()}, ${sql.json(referral)}, ${referral.createdAt}, ${referral.updatedAt}, 'fixture', 'Fixture', 'fixture', 'Fixture')`;
    }
    await verifyCarryover(loadStore(sql, carryoverRecords));
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    if (started) execFileSync(binary("pg_ctl"), ["-D", data, "-w", "stop", "-m", "fast"], { stdio: "pipe" });
    rmSync(directory, { recursive: true, force: true });
  }
});
