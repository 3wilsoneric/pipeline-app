import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { clean, loadEntry } from "./contact-import-fixtures.mjs";

const referral = { id: 42, community: "Synthetic community" };
const packet = () => new File(["%PDF-1.4\nSynthetic upload bytes\n%%EOF"], "synthetic.pdf", { type: "application/pdf" });

function fixture({ azure = false, lostReservation = false, lostCompletion = false, failWrites = false } = {}) {
  const reservations = new Map();
  const calls = { reservations: [], local: [], blobs: [], completions: [] };
  class ApiError extends Error {
    constructor(status) { super("Synthetic interrupted response"); this.status = status; }
  }
  const fetchPipelineJson = async (url, init) => {
    if (url === "/api/uploads/create-url") {
      const body = JSON.parse(init.body);
      calls.reservations.push(body);
      if (!reservations.has(body.packet_id)) reservations.set(body.packet_id, { body, documentId: `document-${reservations.size + 1}` });
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (lostReservation) { lostReservation = false; throw new ApiError(503); }
      const host = azure ? "synthetic.blob.core.windows.net" : "mock-storage.local";
      return { packet_id: body.packet_id, sentinel_url: `https://${host}/${body.packet_id}/done`, uploads: [{ file_id: body.files[0].file_id, signed_url: `https://${host}/${body.packet_id}/original` }] };
    }
    if (url === "/api/uploads/local") {
      calls.local.push({ packetId: init.body.get("packet_id"), fileId: init.body.get("file_id"), bytes: await init.body.get("file").text() });
      return {};
    }
    if (url === "/api/uploads/complete") {
      const body = JSON.parse(init.body);
      calls.completions.push(body);
      const saved = reservations.get(body.packet_id);
      if (lostCompletion) { lostCompletion = false; throw new ApiError(503); }
      return { packet_id: body.packet_id, status: "received", documents: [{ file_id: saved.body.files[0].file_id, document_id: saved.documentId }] };
    }
    if (url.endsWith("/status")) return { status: "received", page_count: 0 };
    throw new Error(`Unexpected request: ${url}`);
  };
  const client = () => loadEntry("lib/pipeline/referral-packet-upload.ts", {
    "@/lib/auth/authenticated-fetch": { fetchPipelineJson, PipelineApiError: ApiError },
  }, {
    crypto: webcrypto, Blob, File, FormData, Error,
    window: { setTimeout: (callback) => setTimeout(callback, 0) },
    fetch: async (url, init) => {
      calls.blobs.push({ url, bytes: await init.body.text(), type: init.headers["Content-Type"] });
      return { ok: !failWrites, status: failWrites ? 503 : 201 };
    },
  });
  return { client, calls, reservations, allowWrites: () => { failWrites = false; } };
}

test("eight simultaneous selections of the same packet share one reservation, transfer and document", async () => {
  for (const azure of [false, true]) {
    const current = fixture({ azure });
    const client = current.client();
    const digest = await client.hashPacket(packet());
    const results = await Promise.all(Array.from({ length: 8 }, () => client.uploadReferralPacket(referral, packet(), digest, "face_sheet")));
    assert.equal(current.calls.reservations.length, 1);
    assert.equal(current.reservations.size, 1);
    assert.equal(current.calls.completions.length, 1);
    assert.equal(current.calls.local.length, azure ? 0 : 1);
    assert.equal(current.calls.blobs.length, azure ? 2 : 0); // File plus completion sentinel, not two documents.
    assert.equal(new Set(results.map((result) => result.document.document_id)).size, 1);
    assert.match(results[0].packetId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(azure ? current.calls.blobs[0].bytes : current.calls.local[0].bytes, await packet().text());
  }
});

test("lost reservation/completion acknowledgements retry the same identity without another transfer or document", async () => {
  const current = fixture({ lostReservation: true, lostCompletion: true });
  const client = current.client();
  const saved = await client.uploadReferralSupportingDocument(referral, packet(), "other");
  assert.equal(saved.documents.length, 1);
  assert.equal(current.calls.reservations.length, 2);
  assert.deepEqual(current.calls.reservations[0], current.calls.reservations[1]);
  assert.equal(current.calls.local.length, 1);
  assert.equal(current.calls.completions.length, 2);
  assert.deepEqual(current.calls.completions[0], current.calls.completions[1]);
  assert.equal(current.reservations.size, 1);
});

test("a retry after reload or downstream-link failure reuses the document; different referrals/files/categories remain independent", async () => {
  const current = fixture();
  const first = await current.client().uploadReferralSupportingDocument(referral, packet(), "other");
  const replay = await current.client().uploadReferralSupportingDocument(referral, packet(), "other");
  assert.equal(replay.documents[0].document_id, first.documents[0].document_id);
  assert.equal(current.reservations.size, 1);
  for (const [target, file, category] of [
    [{ ...referral, id: 43 }, packet(), "other"],
    [referral, new File(["different contents"], "synthetic.pdf", { type: "application/pdf" }), "other"],
    [referral, packet(), "tb_test"],
  ]) await current.client().uploadReferralSupportingDocument(target, file, category);
  assert.equal(current.reservations.size, 4);
});

test("a failed binary transfer cannot complete an upload and an explicit retry reuses its reservation", async () => {
  const current = fixture({ azure: true, failWrites: true });
  const client = current.client();
  await assert.rejects(client.uploadReferralSupportingDocument(referral, packet(), "other"));
  assert.equal(current.calls.completions.length, 0);
  assert.equal(current.calls.blobs.length, 3);
  current.allowWrites();
  const saved = await client.uploadReferralSupportingDocument(referral, packet(), "other");
  assert.equal(saved.documents.length, 1);
  assert.equal(current.reservations.size, 1);
  assert.deepEqual(current.calls.reservations[0], current.calls.reservations[1]);
});

test("production reservation serializes the same identity before checking or inserting its document", async () => {
  const calls = [];
  let reserved = false;
  let inserts = 0;
  let previous = Promise.resolve();
  const packetId = "01234567-1234-5123-8123-012345678901";
  const input = { packet_id: packetId, referral_id: "42", submitting_facility: "Synthetic", source_type: "manual", files: [{ file_id: "file_stable", sha256: "a".repeat(64), category: "other", filename: "synthetic.pdf", content_type: "application/pdf", size: 10 }] };
  const sql = { begin: async (handler) => {
    const turn = previous;
    let release;
    previous = new Promise((resolve) => { release = resolve; });
    const localCalls = [];
    const tx = async (strings, ...values) => {
      const query = strings.join("?").replace(/\s+/g, " ").trim();
      localCalls.push(query);
      calls.push({ query, values: clean(values) });
      if (query.includes("pg_advisory_xact_lock")) { await turn; return []; }
      assert.match(localCalls[0], /pg_advisory_xact_lock/, "Duplicate lookup must run after serialization");
      if (query.startsWith("select referral_id")) return [{ referral_id: 42, person_id: "synthetic-person" }];
      if (query.startsWith("select packet_id")) return reserved ? [{ packet_id: packetId, referral_id: 42 }] : [];
      if (query.startsWith("select pf.file_id")) return [{ file_id: "file_stable", expected_sha256: "a".repeat(64), category: "other" }];
      if (query.startsWith("insert into pipeline.packet_uploads")) reserved = true;
      if (query.startsWith("insert into pipeline.documents")) { inserts += 1; return [{ document_id: "synthetic-document" }]; }
      return [];
    };
    try { return await handler(tx); } finally { release(); }
  } };
  const processing = loadEntry("lib/extraction/document-processing.ts", {
    "@/lib/database/pipeline-database": { getPipelineSql: () => sql },
    "@/lib/extraction/azure-blob": { getAzureBlobUploadSigner: () => ({ createUploadUrls: async () => ({ packet_id: packetId, uploads: [{ file_id: "file_stable", blob_path: "synthetic-path", expires_at: "2026-09-20T00:00:00Z" }] }) }) },
  });
  await Promise.all(Array.from({ length: 8 }, () => processing.createDurableUploadTargets(input, { id: "synthetic-assessor", name: "Synthetic" })));
  assert.equal(inserts, 1);
  assert.equal(calls.filter((call) => call.query.includes("pg_advisory_xact_lock")).length, 8);
  assert.deepEqual(calls[0].values, [`upload:${packetId}`]);
});
