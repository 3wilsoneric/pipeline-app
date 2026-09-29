import test from "node:test";
import assert from "node:assert/strict";
import { loadEntry, clean } from "./contact-import-fixtures.mjs";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const metadata = { snapshot_id: "one", data_as_of: "2026-09-28", freshness: { status: "fresh" } };
const resident = { display_name: "Example Person", resident_number: "71", date_of_birth: null, community_name: "Current community", canonical_client_id: null };
const client = { canonical_client_id: "client-one", display_name: "Example Person", resident_numbers: ["71"], enrichment: { date_of_birth: "1980-02-29T00:00:00-08:00" }, resident_profiles: [], resident_profile: null };
const presentation = loadTypeScriptModule(process.cwd(), "lib/pipeline/client-profile-presentation.ts");

function harness({ clients = [client], pages, detail = { ...metadata, client }, stale = false, hang = false } = {}) {
  const calls = { pages: 0, details: 0, keys: [] };
  const clinical = {
    async getClinicalClients(_request, { cursor }) {
      calls.pages++;
      if (hang) return new Promise(() => {});
      return pages?.[Number(cursor ?? 0)] ?? { ...metadata, clients, next_cursor: null, ...(stale ? { freshness: { status: "stale" } } : {}) };
    },
    async getClinicalClient() { calls.details++; if (detail instanceof Error) throw detail; return detail; },
    ClinicalDataError: class extends Error {},
  };
  const index = loadEntry("lib/clinical/clinical-client-directory-index.ts", { "./clinical-data": clinical });
  const demographics = loadEntry("lib/clinical/clinical-resident-demographics.ts", {
    "./clinical-data": clinical,
    "./clinical-client-directory-index": { async getClinicalClientDirectoryIndex(request, key) { calls.keys.push(key); return index.getClinicalClientDirectoryIndex(request, key); } },
    "@/lib/pipeline/client-profile-presentation": presentation,
  }, { setTimeout, clearTimeout });
  return { ...demographics, calls };
}
const request = (session = "one") => new Request("https://pipeline.invalid/api/profiles/resident%3Asite%3A71", { headers: { cookie: `session=${session}` } });
const current = (patch = {}) => ({ ...metadata, resident: { ...resident, ...patch } });

test("current client DOB comes from the unique resident-number record; no identity or input mutation", async () => {
  const h = harness(); const before = current();
  const after = await h.supplementResidentBirthDate(request(), before);
  assert.deepEqual(clean(after), { ...before, resident: { ...before.resident, date_of_birth: "1980-02-29" } });
  assert.equal(before.resident.date_of_birth, null);
  assert.equal(after.resident.canonical_client_id, null);
  assert.equal(h.calls.details, 1);
  const sections = presentation.buildClientProfileSections(after.resident);
  assert(sections.some(s => s.facts.some(f => f.label === "Date of birth" && f.value.includes("1980"))));
});

test("existing DOB, missing resident number, and stale census never initiate matching", async () => {
  const h = harness();
  for (const input of [current({ date_of_birth: "1971-01-01" }), current({ resident_number: null }), { ...current(), freshness: { status: "stale" } }]) {
    assert.equal(await h.supplementResidentBirthDate(request(), input), input);
  }
  assert.equal(h.calls.pages, 0); assert.equal(h.calls.details, 0);
});

test("same name alone, ambiguous resident number, or changed name cannot supply a DOB", async () => {
  for (const clients of [[{ ...client, resident_numbers: ["other"] }], [client, { ...client, canonical_client_id: "other" }], [{ ...client, display_name: "Different Person" }]]) {
    const h = harness({ clients }); const input = current();
    assert.equal(await h.supplementResidentBirthDate(request(), input), input);
    assert.equal(h.calls.details, 0);
  }
});

test("stale or mixed-snapshot directory is not identity evidence", async () => {
  for (const options of [{ stale: true }, { pages: [{ ...metadata, clients: [client], next_cursor: "1" }, { ...metadata, snapshot_id: "two", clients: [], next_cursor: null }] }]) {
    const h = harness(options); const input = current();
    assert.equal(await h.supplementResidentBirthDate(request(), input), input);
    assert.equal(h.calls.details, 0);
  }
});

test("full record must recheck ID, resident number, name, freshness and one valid nonfuture DOB", async () => {
  const variants = [
    { ...client, canonical_client_id: "other" }, { ...client, resident_numbers: ["other"] }, { ...client, display_name: "Other Person" },
    { ...client, enrichment: {} }, { ...client, enrichment: { date_of_birth: "1980-02-30" } },
    { ...client, enrichment: { date_of_birth: "2030-01-01" } },
    { ...client, resident_profiles: [{ date_of_birth: "1981-01-01" }] },
    { ...client, resident_profiles: [{ date_of_birth: "invalid" }] },
  ];
  for (const detail of [...variants.map(client => ({ ...metadata, client })), { ...metadata, client, freshness: { status: "stale" } }, new Error("unavailable")]) {
    const h = harness({ detail }); const input = current();
    assert.equal(await h.supplementResidentBirthDate(request(), input), input);
  }
});

test("duplicate consistent structured dates are accepted without shifting the calendar day", async () => {
  const h = harness({ detail: { ...metadata, client: { ...client, resident_profiles: [{ date_of_birth: { value: "02/29/1980" } }] } } });
  assert.equal((await h.supplementResidentBirthDate(request(), current())).resident.date_of_birth, "1980-02-29");
});

test("directory caching is isolated by full session and coalesces concurrent same-session reads", async () => {
  const h = harness();
  await Promise.all([h.supplementResidentBirthDate(request(), current()), h.supplementResidentBirthDate(request(), current())]);
  assert.equal(h.calls.pages, 1);
  await h.supplementResidentBirthDate(request("two"), current());
  assert.equal(h.calls.pages, 2);
  assert.equal(h.calls.keys[0], h.calls.keys[1]);
  assert.notEqual(h.calls.keys[1], h.calls.keys[2]);
  assert(!h.calls.keys.some(key => key.includes("session=")));
});

test("unresponsive optional DOB lookup returns the unchanged usable chart within a bounded wait", async () => {
  const h = harness({ hang: true }); const input = current(); const start = performance.now();
  assert.equal(await h.supplementResidentBirthDate(request(), input), input);
  assert(performance.now() - start < 2500);
});
