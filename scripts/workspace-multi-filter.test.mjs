import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import net from "node:net";
import { join, resolve } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

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
});

function loadStore(sql) {
  return loadTypeScriptModule(root, "lib/pipeline/referral-store.ts", {
    __pipelineSql: sql,
    __pipelineReferralStore: { initialized: true, revision: 1, nextId: 13, referrals: structuredClone(referrals), auditEvents: [], createMutations: new Map(), patchMutations: new Map(), persistQueue: Promise.resolve() },
    process: { ...process, env: { ...process.env, NODE_ENV: "test", PIPELINE_DATABASE_MODE: sql ? "postgres" : "disconnected", PIPELINE_REFERRAL_STORE_MODE: sql ? "postgres" : "local_file", PIPELINE_DATABASE_URL: sql ? "disposable-test-only" : "", PIPELINE_ALLOW_LOCAL_REFERRAL_STORE: "true" } },
  });
}

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
  } finally {
    if (sql) await sql.end({ timeout: 5 });
    if (started) execFileSync(binary("pg_ctl"), ["-D", data, "-w", "stop", "-m", "fast"], { stdio: "pipe" });
    rmSync(directory, { recursive: true, force: true });
  }
});
