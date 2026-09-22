import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import postgres from "postgres";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Buffer, Request, Response, Headers, URL, AbortSignal, structuredClone, setTimeout, clearTimeout, process,
    require: (name) => name === "server-only" ? {} : dependencies[name] ?? require(name), ...globals });
  return exports;
}
const secret = "synthetic-packet-verification-secret-32-characters";
function fixture(sql, directory) {
  const globals = { process: { env: { PIPELINE_ENTRA_SESSION_SECRET: secret, PIPELINE_PACKET_LINK_STORE_PATH: directory, PIPELINE_AUTH_MODE: "mock" } } };
  const store = load("lib/notifications/admission-packet-store.ts", {
    "@/lib/database/pipeline-database": { getPipelineDatabaseMode: () => sql ? "postgres" : "local_file", getPipelineSql: () => sql },
  }, globals);
  let withdrawn = false;
  const access = load("lib/notifications/admission-packet-access.ts", {
    "./admission-packet-store": store, "@/lib/pipeline/referral-store": { getReferral: async () => withdrawn ? null : { id: 1 } },
  }, globals);
  const create = async () => {
    const id = randomUUID();
    await store.createAdmissionPacket({ schema: 1, id, referralId: 1, assessmentId: "synthetic", assessmentVersion: 2,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      message: { subject: "Synthetic handoff", body: "Fixture message" }, files: [{ id: "file-1", name: "Synthetic.html", contentType: "text/html", byteSize: 5, source: { kind: "generated", content: "Hello" } }],
      recipients: [{ email: "recipient@example.invalid", requestedAt: [], sessions: [] }], events: [] });
    return id;
  };
  const audit = load("lib/pipeline/meet-client-delivery-audit.ts", { "@/lib/database/pipeline-database": { getPipelineDatabaseReadiness: () => ({ ready: Boolean(sql) }), getPipelineSql: () => sql } }, { process: { ...process, env: { PIPELINE_MEET_CLIENT_DELIVERY_AUDIT_PATH: join(directory, "audit.json") } } });
  return { store, access, create, audit, withdraw: () => { withdrawn = true; } };
}
async function exerciseAccess(f) {
  const audit = { mutationId: randomUUID(), deliveryId: randomUUID(), referralId: 1, assessmentId: "synthetic", assessmentVersion: 3, decisionId: "decision", actorId: "staff", actorName: "Synthetic Staff", recipientCount: 1, recipientDomains: ["example.invalid"], attachmentCount: 1, attachmentBytes: 5, provider: "microsoft_graph", status: "reserved", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  assert.equal(await f.audit.reserveMeetClientDelivery(audit), true);
  await f.audit.completeMeetClientDelivery(audit, "unconfirmed", "provider_timeout");
  assert.equal(await f.audit.reserveMeetClientDelivery({ ...audit, mutationId: randomUUID(), deliveryId: randomUUID() }), false, "unknown sends survive new request identities");
  assert.equal(await f.audit.reserveMeetClientDelivery({ ...audit, assessmentVersion: 4, mutationId: randomUUID(), deliveryId: randomUUID() }), false, "a changed assessment must not bypass an unresolved workspace handoff");
  const safe = { ...audit, referralId: 2, assessmentVersion: 4, mutationId: randomUUID(), deliveryId: randomUUID() };
  assert.equal(await f.audit.reserveMeetClientDelivery(safe), true);
  await f.audit.completeMeetClientDelivery(safe, "failed", "graph_send_message_rejected", true);
  assert.equal(await f.audit.reserveMeetClientDelivery({ ...safe, mutationId: randomUUID(), deliveryId: randomUUID() }), true, "definite rejections permit a safe retry");
  const concurrent = await Promise.all([10, 11].map(assessmentVersion => f.audit.reserveMeetClientDelivery({ ...audit, referralId: 3, assessmentVersion, mutationId: randomUUID(), deliveryId: randomUUID() })));
  assert.equal(concurrent.filter(Boolean).length, 1, "one workspace handoff wins across concurrent versions");
  const sentChanged = { ...audit, referralId: 4, mutationId: randomUUID(), deliveryId: randomUUID() };
  assert.equal(await f.audit.reserveMeetClientDelivery(sentChanged), true);
  await f.audit.completeMeetClientDelivery(sentChanged, "sent_needs_review", "owner_acknowledged_outlook_changes");
  assert.equal(await f.audit.reserveMeetClientDelivery({ ...sentChanged, mutationId: randomUUID(), deliveryId: randomUUID() }), true, "explicit review permits a replacement without certifying the old assessment");
  await f.audit.completeMeetClientDelivery(sentChanged, "sent_needs_review", "replayed_acknowledgment");
  assert.equal(await f.audit.reserveMeetClientDelivery({ ...sentChanged, mutationId: randomUUID(), deliveryId: randomUUID() }), false, "replaying an old completion cannot release a replacement reservation");
  const id = await f.create();
  const now = Date.now();
  await assert.rejects(f.access.readVerifiedPacket(id, ""), { status: 401 });
  assert.equal(await f.access.requestPacketCode(id, "outsider@example.invalid", now), null);
  const challenge = await f.access.requestPacketCode(id, " RECIPIENT@EXAMPLE.INVALID ", now);
  assert.match(challenge.code, /^\d{8}$/);
  assert.equal(await f.access.requestPacketCode(id, challenge.email, now + 1), null);
  await assert.rejects(f.access.verifyPacketCode(id, "outsider@example.invalid", challenge.code, now), { status: 401 });
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => f.access.verifyPacketCode(id, challenge.email, challenge.code, now)));
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1, "code can be used once across concurrent callers");
  const token = attempts.find((result) => result.status === "fulfilled").value.token;
  assert.equal((await f.access.readVerifiedPacket(id, token, "file-1", now)).file.name, "Synthetic.html");
  await assert.rejects(f.access.readVerifiedPacket(id, token, "another-file", now), { status: 404 });
  await assert.rejects(f.access.readVerifiedPacket(await f.create(), token, undefined, now), { status: 401 });
  await assert.rejects(f.access.readVerifiedPacket(id, token, undefined, now + 3600_001), { status: 401 });
  await f.store.manageAdmissionPacketLink(id, 1, "revoke", { id: "staff", name: "Fixture Staff" });
  await assert.rejects(f.access.readVerifiedPacket(id, token), { status: 410 });
  await assert.rejects(f.store.manageAdmissionPacketLink(id, 2, "renew", { id: "staff", name: "Fixture Staff" }), { status: 404 });
  await f.store.manageAdmissionPacketLink(id, 1, "renew", { id: "staff", name: "Fixture Staff" });
  await assert.rejects(f.access.readVerifiedPacket(id, token), { status: 401 });
  const next = await f.access.requestPacketCode(id, challenge.email, now + 61_000);
  const renewed = await f.access.verifyPacketCode(id, next.email, next.code, now + 61_000);
  await f.access.closePacketSession(id, renewed.token);
  await assert.rejects(f.access.readVerifiedPacket(id, renewed.token, undefined, now + 61_000), { status: 401 });
  const lockedId = await f.create();
  const locked = await f.access.requestPacketCode(lockedId, challenge.email, now);
  const wrong = locked.code === "00000000" ? "11111111" : "00000000";
  for (let i = 0; i < 5; i++) await assert.rejects(f.access.verifyPacketCode(lockedId, locked.email, wrong, now), { status: 401 });
  await assert.rejects(f.access.verifyPacketCode(lockedId, locked.email, locked.code, now), { status: 401 });
  for (let i = 1; i < 5; i++) assert.ok(await f.access.requestPacketCode(lockedId, locked.email, now + i * 61_000));
  assert.equal(await f.access.requestPacketCode(lockedId, locked.email, now + 5 * 61_000), null);
  const expiredId = await f.create();
  const expired = await f.access.requestPacketCode(expiredId, challenge.email, now);
  await assert.rejects(f.access.verifyPacketCode(expiredId, expired.email, expired.code, now + 600_001), { status: 401 });
  const attachmentId = await f.create();
  const oldChallenge = await f.access.requestPacketCode(attachmentId, challenge.email, now);
  const oldSession = await f.access.verifyPacketCode(attachmentId, challenge.email, oldChallenge.code, now);
  await f.store.withAdmissionPacket(attachmentId, packet => { packet.outlook = { ownerId: "staff", mailbox: "staff@example.invalid", status: "draft", deliveryMode: "attachments",
    attachmentHashes: { "file-1": "pinned-hash" }, attachmentsReady: true, operation: { id: "operation", expiresAt: now + 300_000 } }; });
  assert.equal(await f.access.requestPacketCode(attachmentId, challenge.email, now + 61_000), null);
  await assert.rejects(f.access.readVerifiedPacket(attachmentId, oldSession.token, "file-1", now), { status: 410 });
  await assert.rejects(f.store.manageAdmissionPacketLink(attachmentId, 1, "renew", { id: "staff", name: "Fixture" }), { status: 409 });
  const persistedDraft = await f.store.withAdmissionPacket(attachmentId, packet => structuredClone(packet.outlook));
  assert.equal(persistedDraft.attachmentHashes["file-1"], "pinned-hash"); assert.equal(persistedDraft.operation.id, "operation");
  // Attachment-only history must not crowd older, still manageable links out
  // of the 50-link listing in either storage adapter.
  for (let index = 0; index < 50; index++) {
    const draftId = await f.create();
    await f.store.withAdmissionPacket(draftId, packet => { packet.outlook = { ...persistedDraft }; });
  }
  f.withdraw();
  assert.equal(await f.access.requestPacketCode(id, challenge.email, now + 3_600_001), null);
  const records = await f.store.listAdmissionPacketLinks(1);
  assert.equal(records.length, 4);
  assert.equal(JSON.stringify(records).includes("recipient@example.invalid"), false);
}

test("local packet adapter: authorization, one-use codes, concurrent verification, expiry, throttling, renewal and revocation", async () => {
  const directory = mkdtempSync("/tmp/pipeline-packet-local-");
  try { await exerciseAccess(fixture(null, directory)); } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("PostgreSQL packet adapter: actual migrations, row locking, audit atomicity and local parity", async () => {
  const directory = mkdtempSync("/tmp/pipeline-packet-pg-");
  const data = join(directory, "data"), socket = join(directory, "socket");
  mkdirSync(socket);
  const pgBin = process.env.PIPELINE_TEST_PG_BIN || execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  const binary = (name) => join(pgBin, name);
  let started = false, sql;
  try {
    execFileSync(binary("initdb"), ["-D", data, "-A", "trust", "--no-locale", "-E", "UTF8"], { stdio: "pipe" });
    const port = await new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); });
    execFileSync(binary("pg_ctl"), ["-D", data, "-l", join(directory, "pg.log"), "-w", "start", "-o", `-p ${port} -h 127.0.0.1 -k ${socket} -F`], { stdio: "pipe" });
    started = true;
    sql = postgres({ host: "127.0.0.1", port, database: "postgres", username: process.env.USER, ssl: false, max: 10, prepare: false, onnotice: () => {} });
    const migrationConnection = await sql.reserve();
    try { for (const file of readdirSync("database/migrations").filter((file) => file.endsWith(".sql")).sort()) await migrationConnection.unsafe(readFileSync(join("database/migrations", file), "utf8")); } finally { migrationConnection.release(); }
    const rollback = readFileSync("database/rollbacks/0042_admission_packet_links.sql", "utf8").replace(/^\s*(begin|commit);$/gmi, "");
    await sql.begin((tx) => tx.unsafe(rollback));
    const restore = await sql.reserve();
    try { await restore.unsafe(readFileSync("database/migrations/0042_admission_packet_links.sql", "utf8")); } finally { restore.release(); }
    const [person] = await sql`insert into pipeline.people(display_name) values ('Synthetic Packet Fixture') returning person_id`;
    await sql`insert into pipeline.referrals(referral_id,person_id,stage,community,owner_id,owner_name,data,created_by,created_by_name,updated_by,updated_by_name) values (1,${person.person_id},'New','San Pablo','test','Test','{}','test','Test','test','Test')`;
    await exerciseAccess(fixture(sql, directory));
    await assert.rejects(sql.begin((tx) => tx.unsafe(rollback)), /Packet records exist/);
    assert.ok((await sql`select packet_id from pipeline.admission_packet_links`).length > 0);
    const audits = await sql`select action, actor_id from pipeline.audit_events where action like 'packet_%'`;
    assert.ok(audits.some((row) => row.action === "packet_access_revoked" && row.actor_id === "staff"));
    assert.ok(audits.some((row) => row.action === "packet_recipient_verified"));
    const f = fixture(sql, directory); const id = await f.create();
    const challenge = await f.access.requestPacketCode(id, "recipient@example.invalid");
    // A failed audit commit must also roll back access issuance.
    await sql`alter table pipeline.audit_events add constraint fixture_reject_packet_verification check (action <> 'packet_recipient_verified') not valid`;
    await assert.rejects(f.access.verifyPacketCode(id, challenge.email, challenge.code));
    await sql`alter table pipeline.audit_events drop constraint fixture_reject_packet_verification`;
    assert.ok((await f.access.verifyPacketCode(id, challenge.email, challenge.code)).token);
  } finally {
    await sql?.end();
    if (started) execFileSync(binary("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delivery thresholds route every file without count or size omissions", () => {
  const policy = load("lib/notifications/meet-client-attachment-policy.ts", {}, { process: { env: {} } });
  assert.equal(policy.admissionPacketDeliveryMode([{ byteSize: 1000 }], false), "direct");
  assert.equal(policy.admissionPacketDeliveryMode([{ byteSize: 4 * 1024 ** 2 }], true), "draft_upload");
  assert.equal(policy.admissionPacketDeliveryMode([{ byteSize: 4 * 1024 ** 2 }], false), "secure_link");
  assert.equal(policy.admissionPacketDeliveryMode(Array.from({ length: 205 }, () => ({ byteSize: 100 })), true), "secure_link");
  assert.equal(policy.admissionPacketDeliveryMode([{ byteSize: 1024 ** 3 }], true), "secure_link");
});

test("inventory paginates all 205 uploads, includes the chart, and detects changed or unsafe files", async () => {
  const uploads = Array.from({ length: 205 }, (_, index) => ({ id: randomUUID(), name: `Synthetic ${index}.pdf`, referralId: 1, category: "Other" }));
  let unsafe = false;
  const owner = load("lib/notifications/meet-client-attachments.ts", {
    "@/lib/extraction/document-assets": { getDocumentFileMetadata: async (id) => ({ document_id: id, file_name: uploads.find((file) => file.id === id).name, byte_size: 1024 * 1024, content_type: "application/pdf", malware_scan_status: unsafe ? "infected" : "clean" }) },
    "@/lib/extraction/azure-blob": {},
    "@/lib/extraction/document-access-policy": { isDocumentContentAvailable: (status) => status === "clean" },
    "@/lib/notifications/meet-client-attachment-policy": load("lib/notifications/meet-client-attachment-policy.ts", {}, { process: { env: {} } }),
    "@/lib/pipeline/referral-store": { listReferralFiles: async ({ cursor }) => ({ files: cursor ? uploads.slice(200) : uploads.slice(0, 200), next_cursor: cursor ? undefined : "next-page" }) },
    "./client-data-sheet": { clientDataSheetName: "Client data sheet.html", renderClientDataSheet: () => "Synthetic chart" },
  });
  const inventory = await owner.getMeetClientAttachmentInventory({ id: 1, version: 1 }, { largeAttachmentDeliveryConfigured: true });
  assert.equal(inventory.files.length, 206); assert.equal(inventory.ready, true); assert.equal(inventory.deliveryMode, "secure_link");
  uploads[0].name = "Updated filename.pdf";
  assert.notEqual((await owner.getMeetClientAttachmentInventory({ id: 1, version: 1 })).revision, inventory.revision);
  unsafe = true;
  assert.equal((await owner.getMeetClientAttachmentInventory({ id: 1, version: 1 })).ready, false);
});

test("public packet API: no pre-verification content, same-origin codes, demo guard, scoped cookie, and logout", async () => {
  const directory = mkdtempSync("/tmp/pipeline-packet-api-");
  try {
    const f = fixture(null, directory); const id = await f.create();
    let emailed, demo = false;
    const route = load("app/api/admission-packets/[packetId]/route.ts", {
      "@/lib/auth/request-security": load("lib/auth/request-security.ts"),
      "@/lib/extraction/contracts": { readJsonBody: async (request) => ({ ok: true, value: await request.json() }) },
      "@/lib/demo/demo-environment": { getPipelineDemoEnvironment: () => ({ enabled: demo, writable: demo }) },
      "@/lib/observability/api-logging": { withApiLogging: (_request, _name, handler) => handler() },
      "@/lib/notifications/admission-packet-access": f.access,
      "@/lib/notifications/admission-packet-store": f.store,
      "@/lib/notifications/admission-packet-files": { packetPrivateHeaders: { "Cache-Control": "private, no-store" } },
      "@/lib/notifications/microsoft-graph-mail": { isMeetClientLive: () => !demo, sendPacketVerificationCode: async (email, code) => { emailed = { email, code }; } },
      "@/lib/pipeline/base-path": { toPipelinePath: (path) => `/pipeline${path}` },
    });
    const context = { params: Promise.resolve({ packetId: id }) };
    const url = `https://pipeline.invalid/api/admission-packets/${id}`;
    const send = (body, origin = "https://pipeline.invalid", cookie = "") => route.POST(new Request(url, { method: "POST", headers: { ...(origin ? { Origin: origin } : {}), Cookie: cookie }, body: JSON.stringify(body) }), context);
    const anonymous = await route.GET(new Request(url), context);
    assert.equal(anonymous.status, 401); assert.doesNotMatch(await anonymous.text(), /Synthetic|Fixture message/);
    const requestCode = { action: "request_code", email: "recipient@example.invalid" };
    assert.equal((await send(requestCode, "https://outsider.invalid")).status, 403);
    assert.equal((await send(requestCode, "")).status, 403);
    demo = true; assert.equal((await send(requestCode)).status, 403); assert.equal(emailed, undefined); demo = false;
    assert.equal((await send(requestCode)).status, 200); assert.equal(emailed.email, requestCode.email);
    const verified = await send({ ...requestCode, action: "verify", code: emailed.code });
    assert.equal(verified.status, 200);
    const cookie = verified.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=3600; Secure/);
    assert.ok(cookie.includes(`Path=/pipeline/api/admission-packets/${id}`));
    const opened = await route.GET(new Request(url, { headers: { Cookie: cookie.split(";")[0] } }), context);
    assert.equal(opened.status, 200);
    const text = await opened.text(); assert.match(text, /Synthetic handoff/); assert.doesNotMatch(text, /recipient@example|challenge|sessions|source/);
    assert.equal((await send({ action: "close" }, undefined, cookie.split(";")[0])).status, 200);
    assert.equal((await route.GET(new Request(url, { headers: { Cookie: cookie.split(";")[0] } }), context)).status, 401);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("staff packet controls enforce authentication, workspace access, origin and demo boundaries", async () => {
  let authenticated = false, allowed = false, demo = false, mutations = 0, reads = 0;
  const route = load("app/api/referrals/[referralId]/admission-packets/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => authenticated ? { ok: true, user: { id: "staff" } } : { ok: false, response: new Response(null, { status: 401 }) } },
    "@/lib/auth/assessor-session-policy": { pipelineAccountableActor: (user) => user },
    "@/lib/auth/request-security": load("lib/auth/request-security.ts"),
    "@/lib/pipeline/referral-access": { requireReferralAccess: async () => allowed ? { ok: true } : { ok: false, response: new Response(null, { status: 404 }) } },
    "@/lib/extraction/contracts": { readJsonBody: async (request) => ({ ok: true, value: await request.json() }) },
    "@/lib/demo/demo-environment": { getPipelineDemoEnvironment: () => ({ enabled: demo, writable: demo }) },
    "@/lib/observability/api-logging": { withApiLogging: (_request, _name, handler) => handler() },
    "@/lib/notifications/admission-packet-files": { packetPrivateHeaders: { "Cache-Control": "private, no-store" } },
    "@/lib/notifications/admission-packet-store": { PacketAccessError: class extends Error {},
      listAdmissionPacketLinks: async () => { reads++; return []; },
      manageAdmissionPacketLink: async (id, referralId, action, actor) => { mutations++; assert.equal(referralId, 1); assert.equal(actor.id, "staff"); return { id, action }; } },
  });
  const url = "https://pipeline.invalid/api/referrals/1/admission-packets";
  const context = { params: Promise.resolve({ referralId: "1" }) };
  const get = () => route.GET(new Request(url), context);
  const post = (origin = "https://pipeline.invalid", action = "renew") => route.POST(new Request(url, { method: "POST", headers: { Origin: origin }, body: JSON.stringify({ packet_id: randomUUID(), action }) }), context);
  assert.equal((await get()).status, 401); assert.equal((await post()).status, 401);
  authenticated = true;
  assert.equal((await get()).status, 404); assert.equal((await post()).status, 404);
  allowed = true;
  assert.equal((await post("https://outsider.invalid")).status, 403);
  demo = true;
  assert.equal((await get()).status, 200); assert.equal((await post()).status, 403);
  assert.equal(reads, 0); assert.equal(mutations, 0);
  demo = false;
  assert.equal((await post(undefined, "invalid")).status, 400);
  assert.equal(mutations, 0);
  assert.equal((await get()).status, 200); assert.equal(reads, 1);
  assert.equal((await post()).status, 200); assert.equal((await post(undefined, "revoke")).status, 200);
  assert.equal(mutations, 2);
});

test("blob downloads enforce identity and ETag, support byte ranges, and never expose storage URLs", async () => {
  let withdrawn = false, status = 206;
  const f = fixture(null, "unused");
  const files = load("lib/notifications/admission-packet-files.ts", {
    "./admission-packet-store": f.store,
    "@/lib/extraction/document-assets": { getDocumentReferralId: async () => withdrawn ? 2 : 1, getDocumentOriginalAsset: async () => ({ container: "raw", blobKey: "synthetic", byteSize: 10 }) },
    "@/lib/extraction/azure-blob": { getAzureBlobUploadSigner: () => ({ createReadUrl: async () => "https://storage.invalid/private?secret" }) },
    "@/lib/extraction/http-byte-range": load("lib/extraction/http-byte-range.ts"),
    "@/lib/pipeline/base-path": { toPipelinePath: (path) => path },
  }, { fetch: async (_url, init) => { assert.equal(init.headers["If-Match"], '"original"'); assert.equal(init.headers.Range, "bytes=5-9"); return new Response("hello", { status, headers: { "Content-Range": "bytes 5-9/10", "Content-Length": "5" } }); } });
  const file = { id: "file", name: "Synthetic.pdf", contentType: "application/pdf", byteSize: 10, source: { kind: "blob", container: "raw", key: "synthetic", etag: '"original"' } };
  const request = new Request("https://pipeline.invalid/file", { headers: { Range: "bytes=5-9" } });
  const response = await files.packetFileResponse(file, 1, request);
  assert.equal(response.status, 206); assert.equal(await response.text(), "hello");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("location"), null);
  status = 412; await assert.rejects(files.packetFileResponse(file, 1, request), { status: 409 });
  withdrawn = true; await assert.rejects(files.packetFileResponse(file, 1, request), { status: 410 });
});
