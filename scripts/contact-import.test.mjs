import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { actor, clean, csvRequest, imports, loadContactStore, makeRoutes, userWith, validation } from "./contact-import-fixtures.mjs";

const rows = (csv) => imports.parseContactImportCsv(csv);
const facility = (name, phone = "") => rows(`organization,phone\r\n${name},${phone}`);
const plainContact = (input) => clean(validation.validateContactCreateBody({ contact: input }).value.contact);

async function localFixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "pipeline-contact-import-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "contacts.json");
  return { path, store: loadContactStore({ path, ...options }) };
}

test("CSV parses BOM, commas, escaped quotes, UTF-8, embedded newlines, and CR/LF/CRLF", () => {
  const parsed = rows('\uFEFF"organization",first_name,notes\r\n"Facility, East",,"Line 1\r\nLine 2 ""quoted"""\r\nOther,Zoë,ok');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].contact.organization, "Facility, East");
  assert.equal(parsed[0].contact.notes, 'Line 1\r\nLine 2 "quoted"');
  assert.equal(parsed[1].row, 4);
  assert.equal(parsed[1].contact.firstName, "Zoë");
  for (const newline of ["\n", "\r", "\r\n"]) assert.equal(rows(`organization${newline}Facility${newline}${newline}`).length, 1);
});

test("CSV rejects malformed quoting, unsupported/duplicate headers, huge cells and limits", () => {
  for (const csv of ['organization\n"unclosed', 'organization\n"closed"junk', 'organization\nun"quoted', "organization,Organization\nA,B", "organization,patient_diagnosis\nA,B", "email\na@example.test", "organization\n"]) {
    assert.throws(() => rows(csv), { name: "ContactImportError" });
  }
  assert.throws(() => rows(`organization\n${"x".repeat(2001)}`), /2000/);
  assert.equal(rows(`organization\n${Array.from({ length: 500 }, (_, i) => `Facility ${i}`).join("\n")}`).length, 500);
  assert.throws(() => rows(`organization\n${"Facility\n".repeat(501)}`), /500/);
  assert.throws(() => rows("x".repeat(imports.contactImportMaxBytes + 1)), { status: 413 });
  assert.equal(imports.contactImportTemplate.split("\r\n").length, 2, "Template contains headers, no mock contacts");
});

test("canonical per-row validation reports physical lines without echoing values", () => {
  const parsed = rows("organization,email,preferred_contact_method\n\nA,bad-email,\nB,b@example.test,invalid\n,,\nC,c@example.test,phone\nD,extra,column,overflow");
  const preview = imports.previewContactImport(parsed, []);
  assert.deepEqual(clean(preview.counts), { total: 5, ready: 1, duplicates: 0, invalid: 4 });
  assert.deepEqual(clean(preview.rows.map((row) => row.row)), [3, 4, 5, 6, 7]);
  assert.match(preview.rows[0].message, /email is invalid/);
  assert.match(preview.rows[1].message, /preferredContactMethod/);
  assert.match(preview.rows[2].message, /first name, last name, or organization/);
  assert.match(preview.rows[4].message, /column count/);
  assert.equal(preview.rows[0].message.includes("bad-email"), false);
  assert.equal(rows(`organization\n${"a".repeat(241)}`)[0].contact, null);
  assert.equal(rows("organization\nA\u0000B")[0].contact, null);
});

test("duplicate preview skips repeated identities, differing details, and inactive records without merging", () => {
  const original = { ...plainContact({ firstName: "Avery", lastName: "Taylor", organization: "Clinic", phone: "111" }), active: false };
  const before = JSON.stringify(original);
  const preview = imports.previewContactImport(rows("first_name,last_name,organization,phone\nAVERY,Taylor, clinic ,222\n,,Clinic,\n,,CLINIC,333\nAlex,Taylor,Clinic,111"), [original]);
  assert.deepEqual(clean(preview.counts), { total: 4, ready: 2, duplicates: 2, invalid: 0 });
  assert.match(preview.rows[0].message, /different details/);
  assert.equal(JSON.stringify(original), before);
});

test("stream reader bounds actual bytes, ignores lying content-length, rejects encoding/content type", async () => {
  const utf8 = new TextEncoder().encode("organization\nCafé");
  let index = 0;
  const request = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "text/csv" }, duplex: "half", body: new ReadableStream({ pull(controller) { if (index < utf8.length) controller.enqueue(utf8.slice(index, ++index)); else controller.close(); } }) });
  assert.equal(await imports.readContactImportCsv(request), "organization\nCafé");
  await assert.rejects(() => imports.readContactImportCsv(csvRequest("x".repeat(imports.contactImportMaxBytes + 1), "preview", undefined, { "content-length": "1" })), { status: 413 });
  await assert.rejects(() => imports.readContactImportCsv(csvRequest("organization\nA", "preview", undefined, { "Content-Type": "application/json" })), { status: 415 });
  await assert.rejects(() => imports.readContactImportCsv(csvRequest(new Uint8Array([0xff]))), /UTF-8/);
});

test("local additive import previews without writes, survives restart, replays exactly, rejects ID payload mismatch", async (t) => {
  const { path, store } = await localFixture(t);
  const input = rows("organization,phone\nFacility A,111\nFacility A,222\nFacility B,333");
  const preview = await store.previewContactDirectoryImport(input);
  assert.equal(preview.counts.ready, 2);
  await assert.rejects(() => stat(path), { code: "ENOENT" });
  const result = await store.importContactDirectory(input, actor, "batch-1");
  assert.equal(result.ok, true);
  assert.equal(result.summary.counts.imported, 2);
  assert.equal(result.summary.counts.duplicates, 1);
  const contents = await readFile(path, "utf8");
  const restarted = loadContactStore({ path });
  const replay = await restarted.importContactDirectory(input, actor, "batch-1");
  assert.equal(replay.idempotentReplay, true);
  assert.deepEqual(clean(replay.summary), clean(result.summary));
  assert.equal(await readFile(path, "utf8"), contents, "Replay must not write, audit, or increment revision");
  const repeated = await restarted.importContactDirectory(input, actor, "batch-2");
  assert.equal(repeated.summary.counts.imported, 0);
  assert.equal((await restarted.searchContacts("", 50)).length, 2);
  const mismatch = await restarted.importContactDirectory(facility("Changed"), actor, "batch-1");
  assert.equal(mismatch.status, 409);
  const audit = JSON.parse(await readFile(path, "utf8")).auditEvents;
  assert.equal(audit.length, 2);
  assert.equal(JSON.stringify(audit).includes("Facility A"), false);
  assert.equal(audit[0].metadata.contact_values_redacted, true);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("first local mutation loads existing records; individual create/link/edit remain compatible", async (t) => {
  const { path } = await localFixture(t);
  const seeded = loadContactStore({ path });
  const created = await seeded.createContact(plainContact({ organization: "Existing Facility", phone: "111" }), actor, "individual-1");
  const before = clean(created.record);
  const restarted = loadContactStore({ path });
  const added = await restarted.importContactDirectory(facility("New Facility"), actor, "import-first");
  assert.equal(added.summary.counts.imported, 1);
  assert.deepEqual(clean(await restarted.getContact(created.record.id)), before);
  const repeat = await restarted.createContact(plainContact({ organization: "Existing Facility", phone: "111" }), actor, "individual-1");
  assert.equal(repeat.idempotentReplay, true);
  const link = await restarted.attachReferralContact(42, { contactId: created.record.id, role: "referral_source", relationship: "", notes: "", primaryForScheduling: false }, actor, "link-1");
  const edit = await restarted.updateContact(created.record.id, { phone: "999" }, 1, actor, "edit-1");
  assert.equal(edit.record.version, 2);
  assert.equal((await restarted.listReferralContacts(42))[0].contact.phone, "999");
  assert.equal((await restarted.updateContact(created.record.id, { phone: "888" }, 1, actor, "edit-stale")).conflict, true);
  assert.equal((await restarted.attachReferralContact(42, { contactId: created.record.id, role: "referral_source", relationship: "", notes: "", primaryForScheduling: false }, actor, "link-1")).record.id, link.record.id);
  const skip = await restarted.importContactDirectory(facility("Existing Facility", "222"), actor, "different-details");
  assert.equal(skip.summary.counts.imported, 0);
  assert.equal((await restarted.getContact(created.record.id)).phone, "999");
  assert.equal((await restarted.getContact(created.record.id)).version, 2);
});

test("invalid rows prevent all additions; concurrent local batches produce no duplicate contacts", async (t) => {
  const { store, path } = await localFixture(t);
  const invalid = await store.importContactDirectory(rows("organization,email\nValid,v@example.test\nInvalid,bad"), actor, "invalid");
  assert.equal(invalid.status, 422);
  assert.equal((await store.searchContacts("", 50)).length, 0);
  await assert.rejects(() => stat(path), { code: "ENOENT" });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.importContactDirectory(facility("Concurrent Facility"), actor, `race-${i}`)));
  assert.equal(results.reduce((count, result) => count + result.summary.counts.imported, 0), 1);
  assert.equal((await store.searchContacts("", 50)).length, 1);
});

test("persistence failure restores contacts/idempotency/audit and the same ID can retry", async (t) => {
  let fail = true;
  const { path, store } = await localFixture(t, { fs: { ...fs, writeFile: (...args) => fail ? Promise.reject(new Error("synthetic disk failure")) : fs.writeFile(...args) } });
  await assert.rejects(() => store.importContactDirectory(facility("Recoverable"), actor, "retry"), /disk failure/);
  assert.equal((await store.searchContacts("", 50)).length, 0);
  fail = false;
  const recovered = await store.importContactDirectory(facility("Recoverable"), actor, "retry");
  assert.equal(recovered.idempotentReplay, false);
  assert.equal(recovered.summary.counts.imported, 1);
  assert.equal(JSON.parse(await readFile(path, "utf8")).auditEvents.length, 1);
});

test("atomic rename failure preserves prior disk/memory state; permissions are settled before commit", async (t) => {
  let failRename = false;
  const { path, store } = await localFixture(t, { fs: {
    ...fs,
    rename: (...args) => failRename ? Promise.reject(new Error("synthetic rename failure")) : fs.rename(...args),
    chmod: (file, ...args) => file.endsWith("contacts.json")
      ? Promise.reject(new Error("No fallible chmod after rename")) : fs.chmod(file, ...args),
  } });
  const saved = await store.createContact(plainContact({ organization: "Prior Facility" }), actor, "prior");
  const before = await readFile(path, "utf8");
  failRename = true;
  await assert.rejects(() => store.importContactDirectory(facility("New Facility"), actor, "rename-retry"), /rename failure/);
  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual(clean(await store.getContact(saved.record.id)), clean(saved.record));
  assert.equal((await store.searchContacts("", 50)).length, 1);
  failRename = false;
  assert.equal((await store.importContactDirectory(facility("New Facility"), actor, "rename-retry")).summary.counts.imported, 1);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("failed load releases the queue and does not overwrite the unreadable store", async (t) => {
  const { path, store } = await localFixture(t);
  await writeFile(path, "unreadable");
  await assert.rejects(() => store.importContactDirectory(facility("New"), actor, "load"));
  assert.equal(await readFile(path, "utf8"), "unreadable");
  await writeFile(path, JSON.stringify({ schema: 1, revision: 0, contacts: [], links: [], mutations: {}, auditEvents: [] }));
  assert.equal((await store.importContactDirectory(facility("New"), actor, "load")).summary.counts.imported, 1);
});

test("import API enforces authentication/roles/same-origin before effects, requires commit ID, returns per-row errors", async (t) => {
  const { store } = await localFixture(t);
  for (const user of [undefined, userWith([]), { ...userWith(["admin"]), accessScope: "note_lab" }]) {
    const { importer } = makeRoutes(store, { user });
    assert.equal((await importer.POST(csvRequest("organization\nFacility", "commit", "id"))).status, user ? 403 : 401);
    assert.equal((await importer.GET(new Request("http://localhost/api/contacts/import"))).status, user ? 403 : 401);
  }
  // Approved shared-workspace access includes every Pipeline role; shared
  // community recipient lists have their own stricter management policy.
  for (const role of ["admin", "assessment_coordinator", "reviewer", "viewer"]) {
    const { importer } = makeRoutes(store, { user: userWith([role]) });
    assert.equal((await importer.POST(csvRequest("organization\nFacility"))).status, 200);
    assert.equal((await importer.GET(new Request("http://localhost/api/contacts/import"))).status, 200);
  }
  const { importer } = makeRoutes(store, { user: userWith(["assessment_coordinator"]) });
  for (const headers of [{ Origin: "https://evil.test" }, { "sec-fetch-site": "cross-site" }, { Origin: "", Referer: "https://evil.test/file" }]) {
    assert.equal((await importer.POST(csvRequest("organization\nFacility", "commit", "id", headers))).status, 403);
  }
  assert.equal((await importer.POST(csvRequest("organization\nFacility", "commit"))).status, 400);
  assert.equal((await importer.POST(csvRequest("organization\nFacility", "commit", "not valid"))).status, 400);
  assert.equal((await importer.POST(csvRequest("organization\nFacility", "wrong-mode"))).status, 400);
  const invalid = await importer.POST(csvRequest("organization,email\nA,bad", "commit", "id"));
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).preview.rows[0].row, 2);
  assert.equal((await store.searchContacts("", 50)).length, 0);
  const template = await importer.GET(new Request("http://localhost/api/contacts/import"));
  assert.match(template.headers.get("Content-Disposition"), /template.csv/);
  assert.equal(await template.text(), imports.contactImportTemplate);
});

test("API preview is side-effect free, commit/retry response is stable and logs never contain CSV/query/error values", async (t) => {
  const { store } = await localFixture(t);
  const logs = [];
  const { importer, directory } = makeRoutes(store, { user: userWith(["admin"]), logs });
  const csv = "organization,notes\nSensitive Fixture,private-notes-fixture";
  const preview = await importer.POST(csvRequest(csv));
  assert.equal(preview.status, 200);
  assert.equal((await store.searchContacts("", 50)).length, 0);
  const first = await importer.POST(csvRequest(csv, "commit", "stable"));
  assert.equal(first.status, 201);
  const retry = await importer.POST(csvRequest(csv, "commit", "stable"));
  assert.equal(retry.status, 200);
  assert.deepEqual((await retry.json()).summary, (await first.json()).summary);
  const search = await directory.GET(new Request("http://localhost/api/contacts?q=Sensitive%20Fixture&limit=10"));
  assert.equal(search.status, 200);
  assert.deepEqual(Object.keys(await search.json()), ["contacts"]);
  assert.match(search.headers.get("Cache-Control"), /private, no-store/);
  assert.equal(logs.some((line) => /Sensitive Fixture|private-notes-fixture/.test(line)), false);
  const failing = makeRoutes({ ...store, previewContactDirectoryImport: () => { throw new Error(csv); } }, { user: userWith(["admin"]), logs });
  const failure = await failing.importer.POST(csvRequest(csv));
  assert.equal(failure.status, 500);
  assert.equal(JSON.stringify(await failure.json()).includes("private-notes-fixture"), false);
  assert.equal(logs.some((line) => line.includes("private-notes-fixture")), false);
});

test("approved users can search shared contacts; explicit referral searches and individual writes still check access", async (t) => {
  const { store } = await localFixture(t);
  for (const role of ["admin", "assessment_coordinator", "reviewer", "viewer"]) {
    const { directory } = makeRoutes(store, { user: userWith([role]) });
    assert.equal((await directory.GET(new Request("http://localhost/api/contacts?q=Clinic&limit=50"))).status, 200);
    assert.equal((await directory.GET(new Request("http://localhost/api/contacts?referral_id="))).status, 400);
    assert.equal((await directory.GET(new Request("http://localhost/api/contacts?referral_id=99"))).status, 404);
    assert.equal((await directory.GET(new Request(`http://localhost/api/contacts?q=${"x".repeat(161)}`))).status, 400);
    assert.equal((await directory.GET(new Request("http://localhost/api/contacts?limit=51"))).status, 400);
  }
  const { directory } = makeRoutes(store, { user: userWith(["reviewer"]) });
  assert.equal((await directory.GET(new Request("http://localhost/api/contacts"))).status, 200);
  assert.equal((await directory.GET(new Request("http://localhost/api/contacts?referral_id=99"))).status, 404);
  assert.equal((await directory.GET(new Request("http://localhost/api/contacts?referral_id=42"))).status, 200);
  const post = (referral_id) => directory.POST(new Request("http://localhost/api/contacts", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ referral_id, contact: { organization: "Individual Facility" }, client_mutation_id: "individual" }) }));
  assert.equal((await post(undefined)).status, 400);
  assert.equal((await post(99)).status, 404);
  assert.equal((await post(42)).status, 201);
  assert.equal((await post(42)).status, 200);
});
