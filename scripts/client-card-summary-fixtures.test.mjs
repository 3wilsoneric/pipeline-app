import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("app/api/profiles/directory/route.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const clinical = JSON.parse(readFileSync("scripts/fixtures/alamo-pipeline-clinical.sanitized.json", "utf8"));
const fields = ["date_of_birth", "age", "payor", "primary_diagnosis", "physician", "diet", "length_of_stay_days"];

test("current directory carries validated roster details with one roster read and private caching", async () => {
  const resident = { ...clinical.resident.resident, date_of_birth: "1985-01-02" };
  const fixture = directoryFixture([resident, { ...resident, resident_key: "second-resident" }]);
  const response = await fixture.get();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const body = await response.json();
  assert.equal(body.clients.length, 2);
  assert.equal(body.clients[0].profile_key, `resident:${resident.resident_key}`);
  assert.equal(body.clients[0].canonical_client_id, resident.canonical_client_id);
  for (const field of fields) assert.equal(body.clients[0][field], resident[field], field);
  assert.deepEqual(fixture.reads, { roster: 1, summaries: 1 });
});

test("directory preserves unknown details and zero values without inference", async () => {
  const resident = { ...clinical.resident.resident, ...Object.fromEntries(fields.map((field) => [field, null])), age: 0, length_of_stay_days: 0 };
  const response = await directoryFixture([resident]).get();
  const { clients } = await response.json();
  for (const field of fields) assert.equal(clients[0][field], resident[field], field);
});

test("denied directory access cannot read or expose the additional client details", async () => {
  const fixture = directoryFixture([clinical.resident.resident], true);
  assert.equal((await fixture.get()).status, 403);
  assert.deepEqual(fixture.reads, { roster: 0, summaries: 0 });
});

function directoryFixture(residents, denied = false) {
  const reads = { roster: 0, summaries: 0 };
  const dependencies = {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async (_request, roles) => {
      assert.deepEqual(Array.from(roles), ["admin", "assessment_coordinator", "reviewer", "viewer"]);
      return denied ? { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) } : { ok: true, user: { id: "synthetic-user" } };
    } },
    "@/lib/clinical/clinical-data": { getClinicalRoster: async () => {
      reads.roster += 1;
      return { ...clinical.roster, residents, total: residents.length, next_cursor: null };
    }, clinicalDataErrorResponse: (error) => { throw error; } },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _route, action) => action() },
    "@/lib/pipeline/client-workspace-store": { getClinicalClientWorkspaceSummaries: async (user) => {
      assert.equal(user.id, "synthetic-user");
      reads.summaries += 1;
      return new Map();
    } },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, Request, Response, URL, Buffer,
    require: (name) => {
      if (dependencies[name]) return dependencies[name];
      throw new Error(`Unexpected directory dependency: ${name}`);
    },
  });
  return { reads, get: () => exports.GET(new Request("http://localhost/api/profiles/directory?scope=current")) };
}
