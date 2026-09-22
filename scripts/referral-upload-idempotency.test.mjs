import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { clean, loadEntry } from "./contact-import-fixtures.mjs";
import { pipelineContentSecurityPolicy } from "../shared/pipeline-security-headers.mjs";

const referral = { id: 42, community: "Synthetic community" };
const packet = () => new File(["%PDF-1.4\nSynthetic upload bytes\n%%EOF"], "synthetic.pdf", { type: "application/pdf" });

test("upload policy permits only the configured valid storage account without weakening other directives", () => {
  const policy = pipelineContentSecurityPolicy({ storageAccount: "pipelinesynthetic" });
  assert.match(policy, /connect-src [^;]* https:\/\/pipelinesynthetic\.blob\.core\.windows\.net;/);
  assert.doesNotMatch(policy, /\*\.blob|unsafe-eval/);
  for (const storageAccount of ["", "https://evil.invalid", "ok; connect-src *", "UPPERCASE", "ab", "a".repeat(25)]) {
    assert.equal(pipelineContentSecurityPolicy({ storageAccount }), pipelineContentSecurityPolicy());
  }
  assert.match(policy, /object-src 'none'; frame-ancestors 'none';/);
  assert.match(pipelineContentSecurityPolicy({ development: true }), /'unsafe-eval'/);
});

function fixture({ azure = false, lostReservation = false, lostCompletion = false, failWrites = false, stalledPuts = 0, stallTarget = "original" } = {}) {
  const reservations = new Map();
  const deadlines = new Map();
  let nextDeadline = 0;
  const calls = { reservations: [], local: [], blobs: [], completions: [], timeouts: [] };
  class ApiError extends Error {
    constructor(message, status = 0) { super(message); this.status = status; }
  }
  const fetchPipelineJson = async (url, init) => {
    if (url === "/api/uploads/create-url") {
      const body = JSON.parse(init.body);
      calls.reservations.push(body);
      if (!reservations.has(body.packet_id)) reservations.set(body.packet_id, { body, documentId: `document-${reservations.size + 1}` });
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (lostReservation) { lostReservation = false; throw new ApiError("Synthetic interrupted response", 503); }
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
      if (lostCompletion) { lostCompletion = false; throw new ApiError("Synthetic interrupted response", 503); }
      return { packet_id: body.packet_id, status: "received", documents: [{ file_id: saved.body.files[0].file_id, document_id: saved.documentId }] };
    }
    if (url.endsWith("/status")) return { status: "received", page_count: 0 };
    throw new Error(`Unexpected request: ${url}`);
  };
  const client = () => loadEntry("lib/pipeline/referral-packet-upload.ts", {
    "@/lib/auth/authenticated-fetch": { fetchPipelineJson, PipelineApiError: ApiError },
  }, {
    crypto: webcrypto, Blob, File, FormData, Error,
    window: {
      setTimeout: (callback, delay) => {
        if (delay < 1_000) return setTimeout(callback, 0); // Retry backoff only.
        calls.timeouts.push(delay);
        const id = ++nextDeadline;
        deadlines.set(id, callback);
        return id;
      },
      clearTimeout: (id) => { deadlines.delete(id); },
    },
    fetch: async (url, init) => {
      calls.blobs.push({ url, bytes: await init.body.text(), type: init.headers["Content-Type"], signal: init.signal });
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.signal.aborted, false);
      if (stalledPuts > 0 && url.endsWith(`/${stallTarget}`)) {
        stalledPuts -= 1;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("Synthetic stalled transfer aborted")), { once: true });
          assert.equal(deadlines.size, 1);
          const [id, expire] = [...deadlines][0];
          queueMicrotask(() => { deadlines.delete(id); expire(); });
        });
      }
      return { ok: !failWrites, status: failWrites ? 503 : 201 };
    },
  });
  return { client, calls, reservations, deadlines, allowWrites: () => { failWrites = false; stalledPuts = 0; } };
}

test("archived charts reject upload locally before reserving or transferring files", async () => {
  const current = fixture();
  const client = current.client();
  const historical = { ...referral, workspaceStatus: "historical" };
  await assert.rejects(client.uploadReferralPacket(historical, packet(), "a".repeat(64), "face_sheet"), /imported chart.*read-only/);
  await assert.rejects(client.uploadReferralSupportingDocument(historical, packet(), "other"), /imported chart.*read-only/);
  assert.equal(current.calls.reservations.length, 0);
  assert.equal(current.calls.blobs.length, 0);
  assert.equal(current.calls.completions.length, 0);
});

test("eight simultaneous selections of the same packet share one reservation, transfer and document", async () => {
  for (const azure of [false, true]) {
    const current = fixture({ azure });
    const client = current.client();
    const digest = await client.hashPacket(packet());
    const results = await Promise.all(Array.from({ length: 8 }, () => client.uploadReferralPacket(referral, packet(), digest, "face_sheet")));
    assert.equal(current.calls.reservations.length, 1);
    assert.equal(current.calls.reservations[0].processing_intent, "preview_only");
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
  assert.equal(current.deadlines.size, 0);
});

for (const stallTarget of ["original", "done"]) {
  test(`a stalled ${stallTarget} PUT aborts and retries with a fresh deadline and the same document`, async () => {
    const current = fixture({ azure: true, stalledPuts: 1, stallTarget });
    const file = packet();
    const saved = await current.client().uploadReferralSupportingDocument(referral, file, "other");
    const attempts = current.calls.blobs.filter(({ url }) => url.endsWith(`/${stallTarget}`));
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].signal.aborted, true);
    assert.equal(attempts[1].signal.aborted, false);
    assert.notEqual(attempts[0].signal, attempts[1].signal);
    assert.equal(attempts[0].url, attempts[1].url);
    assert.equal(attempts[0].bytes, attempts[1].bytes);
    assert.deepEqual(current.calls.timeouts, [120_000, 120_000, 120_000]);
    assert.equal(current.deadlines.size, 0);
    assert.equal(current.calls.reservations.length, 1);
    assert.equal(current.calls.completions.length, 1);
    assert.equal(saved.documents.length, 1);
    assert.equal(current.calls.blobs.find(({ url }) => url.endsWith("/original")).bytes, await file.text());
  });

  test(`three stalled ${stallTarget} PUTs stop without completing; an explicit retry keeps the original file and identity`, async () => {
    const current = fixture({ azure: true, stalledPuts: 3, stallTarget });
    const client = current.client();
    const file = packet();
    await assert.rejects(client.uploadReferralSupportingDocument(referral, file, "other"), (error) => {
      assert.equal(error.status, 408);
      assert.match(error.message, /timed out.*still queued.*retry/);
      assert.doesNotMatch(error.message, /https:\/\//);
      return true;
    });
    const attempts = current.calls.blobs.filter(({ url }) => url.endsWith(`/${stallTarget}`));
    assert.equal(attempts.length, 3);
    assert.ok(attempts.every(({ signal }) => signal.aborted));
    assert.equal(new Set(attempts.map(({ signal }) => signal)).size, 3);
    assert.equal(current.calls.completions.length, 0);
    assert.equal(current.deadlines.size, 0);
    current.allowWrites();
    const saved = await client.uploadReferralSupportingDocument(referral, file, "other");
    assert.equal(saved.documents.length, 1);
    assert.equal(current.reservations.size, 1);
    assert.deepEqual(current.calls.reservations[0], current.calls.reservations[1]);
    assert.ok(current.calls.blobs.filter(({ url }) => url.endsWith("/original")).every(({ bytes }) => bytes === current.calls.blobs[0].bytes));
    assert.equal(await file.text(), current.calls.blobs[0].bytes);
    assert.equal(current.deadlines.size, 0);
  });
}

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


test("attachment MIME validation accepts any format without admitting unsafe headers or sending it to extraction", () => {
  const contracts = loadEntry("lib/extraction/contracts.ts");
  const input = { referral_id: "42", submitting_facility: "Synthetic", source_type: "manual", processing_intent: "preview_only", files: [{ file_id: "one", filename: "one.docx", size: 1, content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }] };
  assert.equal(contracts.validateCreateUploadUrlRequest(input).ok, true);
  assert.equal(contracts.validateCreateUploadUrlRequest({ ...input, processing_intent: "extract_referral" }).ok, false);
  for (const content_type of ["text/html\r\nX-Bad: yes", "text/html; charset=utf8", "x".repeat(129)]) {
    assert.equal(contracts.validateCreateUploadUrlRequest({ ...input, files: [{ ...input.files[0], content_type }] }).ok, false);
  }
});
