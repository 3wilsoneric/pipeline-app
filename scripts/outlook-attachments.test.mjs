import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
const require = createRequire(import.meta.url);
function load(file, dependencies, globals = {}) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Buffer, Request, Response, Headers, URL, URLSearchParams, AbortSignal, structuredClone, process,
    require: name => name === "server-only" ? {} : dependencies[name] ?? require(name), ...globals });
  return exports;
}
class PacketAccessError extends Error { constructor(message, status) { super(message); this.status = status; } }
function fixture({ live = true, sizeRefusal = false, lostResponse = false, unsafeUpload = false, unsafePage = false } = {}) {
  const uploadOrigin = unsafeUpload ? "https://unexpected.invalid" : "https://outlook.office.com";
  const uploaded = [], requests = [], sessions = new Map(); let sourceChanged = false, lose = lostResponse;
  const small = Buffer.from("Synthetic uploaded file");
  const large = Buffer.alloc(5 * 1024 * 1024, 7);
  const chart = Buffer.from("<h1>Synthetic client</h1>");
  const contents = { chart, small, duplicate: Buffer.from("Different file with same name"), large };
  const packet = { referralId: 1, outlook: { attachmentHashes: {} }, files: Object.entries(contents).map(([id, content]) => ({ id, name: id === "duplicate" ? "small.txt" : `${id}.txt`, contentType: "text/plain", byteSize: content.length, source: id === "chart" ? { kind: "generated", content: content.toString() } : { kind: "blob", container: "files", key: id, etag: '"pinned"' } })) };
  const add = (name, bytes) => { const item = { id: `attachment-${uploaded.length}`, name, bytes, "@odata.type": "#microsoft.graph.fileAttachment", size: bytes.length + 1024 }; uploaded.push(item); return item; };
  const sourceResponse = (url, init) => {
      assert.equal(init.headers["If-Match"], '"pinned"'); assert.equal(init.redirect, "error");
      if (sourceChanged) return new Response(null, { status: 412 });
      const bytes = contents[url.pathname.slice(1)];
      const match = init.headers.Range?.match(/^bytes=(\d+)-(\d+)$/);
      return new Response(match ? bytes.subarray(Number(match[1]), Number(match[2]) + 1) : bytes, { status: match ? 206 : 200 });
  };
  const request = async (urlValue, init = {}) => {
    const url = new URL(urlValue); requests.push({ url: url.toString(), init });
    if (url.hostname === "storage.invalid") return sourceResponse(url, init);
    if (url.hostname === "outlook.office.com") {
      assert.equal(init.method, "PUT"); assert.equal(init.headers.Authorization, undefined);
      assert.equal(init.headers["Content-Type"], "application/octet-stream"); assert.equal(init.redirect, "error");
      assert.ok(init.body.byteLength < 4 * 1024 * 1024);
      const session = sessions.get(url.pathname); session.chunks.push(Buffer.from(init.body));
      const bytes = Buffer.concat(session.chunks); if (bytes.length < session.size) return Response.json({ nextExpectedRanges: [`${bytes.length}-`] });
      assert.equal(bytes.length, session.size); add(session.name, bytes);
      return new Response(null, { status: 201 });
    }
    assert.equal(url.hostname, "graph.microsoft.com");
    assert.match(init.headers.Authorization, /^Bearer fixture-token$/);
    assert.doesNotMatch(url.pathname, /\/send(?:Mail)?$/);
    if (url.pathname.endsWith("/$value")) return new Response(uploaded.find(item => url.pathname.includes(`/${item.id}/`)).bytes);
    if (init.method === "POST") {
      if (sizeRefusal) return Response.json({ error: { code: "ErrorMessageSizeExceeded" } }, { status: 413 });
      const input = JSON.parse(init.body);
      if (url.pathname.endsWith("/createUploadSession")) {
        const path = `/upload/${sessions.size}`; sessions.set(path, { ...input.AttachmentItem, chunks: [] });
        return Response.json({ uploadUrl: `${uploadOrigin}${path}` }, { status: 201 });
      }
      add(input.name, Buffer.from(input.contentBytes, "base64"));
      if (lose) { lose = false; throw new Error("Response lost after upload"); }
      return Response.json({ id: uploaded.at(-1).id }, { status: 201 });
    }
    assert.match(url.pathname, /\/attachments$/);
    return Response.json({ value: uploaded.map(({ id, name, isInline, size, "@odata.type": type }) => ({ id, name, isInline, size, "@odata.type": type })), ...(unsafePage ? { "@odata.nextLink": "https://unexpected.invalid/steal" } : {}) });
  };
  const graph = loadTypeScriptModule(process.cwd(), "lib/notifications/microsoft-graph-mail.ts", { fetch: request, process: { env: { NODE_ENV: "production", PIPELINE_MEET_CLIENT_LIVE_ENABLED: live ? "true" : "false" } } });
  const mail = load("lib/notifications/outlook-mail.ts", { "./admission-packet-store": { PacketAccessError }, "./microsoft-graph-mail": graph, "./outlook-draft-contract": loadTypeScriptModule(process.cwd(), "lib/notifications/outlook-draft-contract.ts") }, { fetch: request });
  const files = load("lib/notifications/admission-packet-files.ts", {
    "@/lib/extraction/document-assets": { getDocumentReferralId: async () => 1, getDocumentOriginalAsset: async id => ({ container: "files", blobKey: id, contentType: "text/plain" }) },
    "@/lib/extraction/azure-blob": { getAzureBlobUploadSigner: () => ({ createReadUrl: async (_container, key) => `https://storage.invalid/${key}` }) },
    "@/lib/extraction/http-byte-range": {}, "@/lib/pipeline/base-path": {}, "./admission-packet-store": { PacketAccessError },
  });
  const owner = load("lib/notifications/outlook-attachments.ts", { "./admission-packet-files": files, "./admission-packet-store": { PacketAccessError }, "./microsoft-graph-mail": graph, "./meet-client-attachment-policy": loadTypeScriptModule(process.cwd(), "lib/notifications/meet-client-attachment-policy.ts"), "./outlook-mail": mail }, { fetch: request });
  const progress = async (id, hash) => { if (id) packet.outlook.attachmentHashes[id] = hash; };
  return { packet, uploaded, contents, requests, graph, mail, changeSource: () => { sourceChanged = true; },
    ensure: () => owner.ensureOutlookAttachments("fixture-token", "message", packet, progress), match: () => owner.outlookAttachmentsMatch("fixture-token", "message", packet) };
}

test("every file becomes a verified attachment, using pinned source bytes and large upload chunks", async () => {
  const f = fixture(); await f.ensure(); assert.equal(f.uploaded.length, 4);
  for (const file of f.packet.files) assert.equal(f.packet.outlook.attachmentHashes[file.id], createHash("sha256").update(f.contents[file.id]).digest("hex"));
  assert.equal(await f.match(), true);
  assert.equal(f.requests.filter(({ init }) => init.method === "PUT").length, 2);
  const count = f.requests.filter(({ init }) => init.method === "POST").length;
  await f.ensure(); assert.equal(f.uploaded.length, 4);
  assert.equal(f.requests.filter(({ init }) => init.method === "POST").length, count, "resume never duplicates existing attachments");
});

test("lost upload responses recover the existing file instead of creating another", async () => {
  const f = fixture({ lostResponse: true }); await assert.rejects(f.ensure(), { status: 503 });
  assert.equal(f.uploaded.length, 1); await f.ensure(); assert.equal(f.uploaded.length, 4); assert.equal(await f.match(), true);
});

test("sent validation detects same-size altered bytes, missing files and extra ordinary attachments", async () => {
  const f = fixture(); await f.ensure();
  const original = f.uploaded[0].bytes; f.uploaded[0].bytes = Buffer.alloc(original.length, 1);
  assert.equal(await f.match(), false); f.uploaded[0].bytes = original;
  const removed = f.uploaded.pop(); assert.equal(await f.match(), false); f.uploaded.push(removed);
  f.uploaded.push({ id: "signature", isInline: true }); assert.equal(await f.match(), true);
  f.uploaded.push({ id: "extra", isInline: false }); assert.equal(await f.match(), false);
});

test("a size refusal retains the manifest and reports attachment failure without a link fallback", async () => {
  const f = fixture({ sizeRefusal: true }); await assert.rejects(f.ensure(), { status: 413 });
  assert.equal(f.packet.files.length, 4); assert.equal(f.uploaded.length, 0);
  assert.ok(f.requests.every(({ url }) => !url.includes("admission-packet")));
});

test("changed source bytes and untrusted upload or pagination URLs cannot leak files or credentials", async () => {
  const changed = fixture(); changed.changeSource(); await assert.rejects(changed.ensure());
  for (const option of [{ unsafeUpload: true }, { unsafePage: true }]) {
    const f = fixture(option); await assert.rejects(f.ensure());
    assert.ok(f.requests.every(({ url }) => !url.includes("unexpected.invalid")));
  }
});

test("demo hold makes no attachment requests, and assessor readiness needs no service sender or OTP setup", async () => {
  const held = fixture({ live: false }); await assert.rejects(held.ensure(), { status: 403 }); assert.equal(held.requests.length, 0);
  const mail = loadTypeScriptModule(process.cwd(), "lib/notifications/outlook-mail.ts", { process: { env: { NODE_ENV: "production", PIPELINE_MEET_CLIENT_LIVE_ENABLED: "true",
    PIPELINE_OUTLOOK_CLIENT_ID: "00000000-0000-4000-8000-000000000001", PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS: "example.invalid" } } });
  assert.equal(mail.getOutlookMailReadiness().configured, true);
  assert.equal(mail.getOutlookMailReadiness().sender, "");
});
