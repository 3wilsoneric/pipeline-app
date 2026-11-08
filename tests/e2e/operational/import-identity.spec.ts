import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { actorApiContext } from "../support/pipeline-actors";
import { createOperationalReferral, type OperationalReferral } from "../support/operational-api";
import { finalizeClientFileImport } from "../../../scripts/lib/client-file-import-finalization.mjs";

let api: APIRequestContext;
let sql: ReturnType<typeof postgres>;
let first: OperationalReferral, second: OperationalReferral;
let firstPerson: string, secondPerson: string, batchId: string;
const sourceSha = "a".repeat(64);

test.beforeEach(async ({ baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
  test.skip(process.env.PIPELINE_DATABASE_MODE !== "postgres", "Import review has only a PostgreSQL adapter.");
  api = await actorApiContext("assessmentCoordinator", baseURL!);
  sql = postgres(process.env.PIPELINE_DATABASE_URL!, { ssl: false, max: 4 });
  first = await createOperationalReferral(api);
  second = await createOperationalReferral(api);
  const people = await sql`select referral_id, person_id from pipeline.referrals where referral_id in (${first.id}, ${second.id})`;
  firstPerson = people.find(row => Number(row.referral_id) === first.id)!.person_id;
  secondPerson = people.find(row => Number(row.referral_id) === second.id)!.person_id;
  batchId = randomUUID();
  await sql`insert into pipeline.client_file_import_batches(import_batch_id, source_system, manifest_sha256, status, item_count, created_by)
    values (${batchId}, 'import', ${randomUUID().replaceAll("-", "").repeat(2)}, 'ready', 1, 'synthetic')`;
});
test.afterEach(async () => { await Promise.all([api?.dispose(), sql?.end()]); });

async function item(id: string) {
  return (await sql`select i.*, b.source_system from pipeline.client_file_import_items i
    join pipeline.client_file_import_batches b using (import_batch_id) where import_item_id=${id}`)[0];
}
async function makeItem(status = "confirmed") {
  const id = randomUUID();
  await sql`insert into pipeline.client_file_import_items (
    import_item_id, import_batch_id, source_item_id, source_client_name, source_file_name,
    source_content_type, source_byte_size, source_sha256, match_status, matched_person_id, matched_referral_id
  ) values (${id}, ${batchId}, ${id}, 'Synthetic Import', 'synthetic.txt',
    'text/plain', 1, ${sourceSha}, ${status}, ${firstPerson}, ${first.id})`;
  return item(id);
}
function finalize(row: postgres.Row, tx?: postgres.TransactionSql) {
  const input = {
    row, sourceCommunity: "San Pablo", category: "other", byteSize: 1,
    sha256: sourceSha, containerName: "synthetic", blobKey: row.import_item_id,
  };
  return tx ? finalizeClientFileImport(tx, input) : sql.begin(transaction => finalizeClientFileImport(transaction, input));
}
function review(id: string, version = 1, action = "confirm") {
  return api.patch(`/api/files/import-review/${id}`, { data: {
    if_match: version, action, target_client_id: `pipeline:${second.clientId}`, referral_id: second.id,
  } });
}
async function snapshot(id: string) {
  return {
    item: await item(id),
    documents: await sql`select * from pipeline.documents where source_system='import' and source_external_id=${`${batchId}:${id}`} order by document_id`,
    jobs: await sql`select j.* from pipeline.extraction_jobs j join pipeline.documents d using(document_id)
      where d.source_system='import' and d.source_external_id=${`${batchId}:${id}`} order by j.extraction_job_id`,
    people: (await sql`select count(*)::int as count from pipeline.people`)[0].count,
    audits: await sql`select * from pipeline.audit_events where entity_type='client_file_import_item' and entity_id=${id} order by to_version`,
  };
}

for (const action of ["confirm", "create_client", "reject"]) {
  test(`imported identity rejects ${action} without changing records`, async () => {
    // Status, pointer, and a legacy unlinked artifact each protect existing identity.
    for (const mode of ["imported", "pointer", "status", "artifact"]) {
      const row = await makeItem();
      expect(await finalize(row)).toBe(true);
      if (mode === "pointer" || mode === "artifact") {
        await sql`update pipeline.client_file_import_items set match_status='confirmed' where import_item_id=${row.import_item_id}`;
      }
      if (mode === "status" || mode === "artifact") {
        await sql`update pipeline.client_file_import_items set imported_document_id=null where import_item_id=${row.import_item_id}`;
      }
      const saved = await snapshot(row.import_item_id);
      const response = await review(row.import_item_id, 2, action);
      expect(response.status(), `${mode}: ${await response.text()}`).toBe(409);
      expect(await snapshot(row.import_item_id)).toEqual(saved);
    }
  });

  test(`pre-import ${action} preserves normal review and stale conflicts`, async () => {
    for (const status of ["unmatched", "candidate", "confirmed", "rejected"]) {
      const row = await makeItem(status);
      const before = await snapshot(row.import_item_id);
      const response = await review(row.import_item_id, 1, action);
      expect(response.status(), await response.text()).toBe(200);
      const after = await snapshot(row.import_item_id);
      expect(after.item.version).toBe(2);
      expect(after.item.match_status).toBe(action === "reject" ? "rejected" : "confirmed");
      expect(after.documents).toHaveLength(0);
      expect(after.jobs).toHaveLength(0);
      expect(after.audits).toHaveLength(1);
      expect(after.people).toBe(before.people + (action === "create_client" ? 1 : 0));
      if (action === "confirm") {
        expect(after.item.matched_person_id).toBe(secondPerson);
        expect(Number(after.item.matched_referral_id)).toBe(second.id);
      } else if (action === "reject") {
        expect(after.item.matched_person_id).toBeNull();
        expect(after.item.matched_referral_id).toBeNull();
      }
      expect((await review(row.import_item_id, 1, action)).status()).toBe(409);
      expect(await snapshot(row.import_item_id)).toEqual(after);
    }
  });
}

test("stale finalization after review creates no document or extraction job", async () => {
  for (const action of ["confirm", "create_client", "reject"]) {
    const row = await makeItem();
    const response = await review(row.import_item_id, 1, action);
    expect(response.status(), await response.text()).toBe(200);
    const saved = await snapshot(row.import_item_id);
    expect(await finalize(row)).toBe(false);
    expect(await snapshot(row.import_item_id)).toEqual(saved);
  }
});

test("concurrent finalizers commit one identity and retries have no side effects", async () => {
  const row = await makeItem();
  expect((await Promise.all([finalize(row), finalize(row)])).sort()).toEqual([false, true]);
  const saved = await snapshot(row.import_item_id);
  expect(saved.documents).toHaveLength(1);
  expect(saved.jobs).toHaveLength(1);
  expect(saved.item.version).toBe(2);
  expect(saved.item.match_status).toBe("imported");
  expect(saved.item.imported_document_id).toBe(saved.documents[0].document_id);
  expect(saved.documents[0].person_id).toBe(saved.item.matched_person_id);
  expect(saved.documents[0].referral_id).toBe(saved.item.matched_referral_id);
  expect(await finalize(row)).toBe(false);
  expect(await snapshot(row.import_item_id)).toEqual(saved);
});

test("review waits for an in-flight finalization and cannot reassign its artifact", async () => {
  const row = await makeItem();
  let pending: ReturnType<typeof review> | undefined;
  await sql.begin(async tx => {
    expect(await finalize(row, tx)).toBe(true);
    const [{ pid }] = await tx`select pg_backend_pid() as pid`;
    pending = review(row.import_item_id, 2);
    await expect.poll(async () => Number((await sql`select count(*) as count from pg_stat_activity
      where datname=current_database() and ${pid} = any(pg_blocking_pids(pid))`)[0].count)).toBeGreaterThan(0);
  });
  expect((await pending!).status()).toBe(409);
  const saved = await snapshot(row.import_item_id);
  expect(saved.item.match_status).toBe("imported");
  expect(saved.item.version).toBe(2);
  expect(saved.documents).toHaveLength(1);
  expect(saved.jobs).toHaveLength(1);
  expect(saved.documents[0].person_id).toBe(firstPerson);
  expect(saved.item.matched_person_id).toBe(firstPerson);
  expect(saved.audits).toHaveLength(0);
});

test("review and finalization races never split item and document identity", async () => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await makeItem();
    const [didImport, response] = await Promise.all([finalize(row), review(row.import_item_id)]);
    const after = await snapshot(row.import_item_id);
    expect(after.item.version).toBe(2);
    if (didImport) {
      expect(response.status()).toBe(409);
      expect(after.item.match_status).toBe("imported");
      expect(after.documents).toHaveLength(1);
      expect(after.jobs).toHaveLength(1);
      expect(after.documents[0].person_id).toBe(after.item.matched_person_id);
      expect(after.documents[0].referral_id).toBe(after.item.matched_referral_id);
    } else {
      expect(response.status(), await response.text()).toBe(200);
      expect(after.item.match_status).toBe("confirmed");
      expect(after.item.matched_person_id).toBe(secondPerson);
      expect(after.documents).toHaveLength(0);
      expect(after.jobs).toHaveLength(0);
    }
  }
});

test("an existing artifact must match both client identity and uploaded source", async () => {
  for (const mismatch of ["person", "referral", "canonical", "sha256", "bytes", "blob"]) {
    const row = await makeItem();
    expect(await finalize(row)).toBe(true);
    const docId = (await item(row.import_item_id)).imported_document_id;
    await sql`update pipeline.client_file_import_items set match_status='confirmed', imported_document_id=null where import_item_id=${row.import_item_id}`;
    if (mismatch === "person") await sql`update pipeline.documents set person_id=${secondPerson} where document_id=${docId}`;
    if (mismatch === "referral") await sql`update pipeline.documents set referral_id=${second.id} where document_id=${docId}`;
    if (mismatch === "canonical") await sql`update pipeline.documents set canonical_client_id='synthetic-other' where document_id=${docId}`;
    if (mismatch === "sha256") await sql`update pipeline.documents set sha256=${"b".repeat(64)} where document_id=${docId}`;
    if (mismatch === "bytes") await sql`update pipeline.documents set byte_size=2 where document_id=${docId}`;
    if (mismatch === "blob") await sql`update pipeline.documents set blob_key='different-source' where document_id=${docId}`;
    const saved = await snapshot(row.import_item_id);
    await expect(finalize(await item(row.import_item_id))).rejects.toThrow("document_identity_conflict");
    expect(await snapshot(row.import_item_id)).toEqual(saved);
  }
});

test("matching legacy artifact can finalize without duplicating documents or active jobs", async () => {
  const row = await makeItem();
  expect(await finalize(row)).toBe(true);
  const saved = await snapshot(row.import_item_id);
  await sql`update pipeline.client_file_import_items set match_status='confirmed', imported_document_id=null where import_item_id=${row.import_item_id}`;
  expect(await finalize(await item(row.import_item_id))).toBe(true);
  const after = await snapshot(row.import_item_id);
  expect(after.item.imported_document_id).toBe(saved.item.imported_document_id);
  expect(after.item.version).toBe(3);
  expect(after.documents).toEqual(saved.documents);
  expect(after.jobs).toHaveLength(1);
});

test("failed item commit rolls back the document and extraction job together", async () => {
  const row = await makeItem();
  const saved = await snapshot(row.import_item_id);
  // A disposable-database constraint injects a failure at the last write.
  await sql`alter table pipeline.client_file_import_items add constraint synthetic_import_commit_failure
    check (match_status <> 'imported') not valid`;
  try {
    await expect(finalize(row)).rejects.toMatchObject({ code: "23514" });
    expect(await snapshot(row.import_item_id)).toEqual(saved);
  } finally {
    await sql`alter table pipeline.client_file_import_items drop constraint synthetic_import_commit_failure`;
  }
});

test("unconfirmed, missing and already-imported items cannot create artifacts", async () => {
  for (const status of ["unmatched", "candidate", "rejected", "imported"]) {
    const row = await makeItem(status);
    const saved = await snapshot(row.import_item_id);
    expect(await finalize(row)).toBe(false);
    expect(await snapshot(row.import_item_id)).toEqual(saved);
  }
  const row = await makeItem();
  expect(await finalize(row)).toBe(true);
  await sql`update pipeline.client_file_import_items set match_status='confirmed' where import_item_id=${row.import_item_id}`;
  const saved = await snapshot(row.import_item_id);
  expect(await finalize(await item(row.import_item_id))).toBe(false);
  expect(await finalize({ ...row, import_item_id: randomUUID() })).toBe(false);
  expect(await snapshot(row.import_item_id)).toEqual(saved);
});

test("failed review audit rolls back people and identity changes", async () => {
  await sql`alter table pipeline.audit_events add constraint synthetic_import_audit_failure
    check (entity_type <> 'client_file_import_item') not valid`;
  try {
    for (const action of ["confirm", "create_client", "reject"]) {
      const row = await makeItem();
      const saved = await snapshot(row.import_item_id);
      expect((await review(row.import_item_id, 1, action)).status()).toBe(500);
      expect(await snapshot(row.import_item_id)).toEqual(saved);
    }
  } finally {
    await sql`alter table pipeline.audit_events drop constraint synthetic_import_audit_failure`;
  }
});
