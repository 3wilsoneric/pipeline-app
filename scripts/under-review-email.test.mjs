import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);

function load(path, dependencies, globals = {}) {
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, process, fetch: globals.fetch, Request, Response, Headers, URL, URLSearchParams, AbortSignal,
    require: (name) => name === "server-only" ? {} : dependencies[name] ?? (name.startsWith("@/") ? {} : require(name)) });
  return exports;
}

const record = { recommendationId: "7e04d02b-0067-41f7-bf72-b5d06f1bef31", version: 2, outcome: "needs_more_information" };
function coordinator(send, mode = "postgres") {
  let status = "";
  const sql = async (parts) => {
    const query = parts.join("?");
    if (query.includes("insert into")) {
      if (status) return [];
      status = "sending";
      return [{ recommendation_id: record.recommendationId }];
    }
    if (query.includes("select status")) return [{ status }];
    if (query.includes("set status = 'sent'")) status = "sent";
    if (query.includes("set status = 'failed'")) status = "failed";
    return [];
  };
  const notificationModule = load("lib/notifications/under-review-email.ts", {
    "@/lib/database/pipeline-database": { getPipelineSql: () => sql },
    "@/lib/pipeline/referral-store": { getReferralStoreReadiness: () => ({ mode }) },
    "./microsoft-graph-mail": { getGraphMailReadiness: () => ({ configured: true }), sendUnderReviewEmail: send },
  });
  return { notify: notificationModule.notifyUnderReview, status: () => status };
}

test("Under Review emails once per recommendation version and never on replay", async () => {
  let calls = 0;
  const source = coordinator(async () => { calls++; });
  assert.equal(await source.notify(82, record, "Reviewed message"), "sent");
  assert.equal(await source.notify(82, record, "Reviewed message"), "sent");
  assert.equal(source.status(), "sent");
  assert.equal(calls, 1);
  assert.equal(await source.notify(82, { ...record, outcome: "accept" }, "Reviewed message"), "unavailable");
});

test("ambiguous provider failures do not trigger duplicate mail", async () => {
  let calls = 0;
  const source = coordinator(async () => { calls++; throw Error("synthetic timeout"); });
  assert.equal(await source.notify(82, record, "Reviewed message"), "failed");
  assert.equal(await source.notify(82, record, "Reviewed message"), "failed");
  assert.equal(source.status(), "failed");
  assert.equal(calls, 1);
});

test("local mode never sends an unclaimed email", async () => {
  const source = coordinator(async () => { throw Error("must not send"); }, "local");
  assert.equal(await source.notify(82, record, "Reviewed message"), "unavailable");
});

test("an empty message never claims or sends an email", async () => {
  const source = coordinator(async () => { throw Error("must not send"); });
  assert.equal(await source.notify(82, record, " "), "unavailable");
  assert.equal(source.status(), "");
});

test("Microsoft 365 mail targets only Andrew and Sandeep with the reviewed message", async () => {
  const calls = [];
  const mail = load("lib/notifications/microsoft-graph-mail.ts", {
    "@/lib/demo/demo-environment": { getPipelineDemoEnvironment: () => ({ enabled: false }) },
  }, { fetch: async (url, init) => {
    calls.push({ url, init });
    return String(url).includes("oauth2") ? Response.json({ access_token: "synthetic" }) : new Response(null, { status: 202 });
  } });
  const previous = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "production", PIPELINE_GRAPH_TENANT_ID: "synthetic", PIPELINE_GRAPH_CLIENT_ID: "synthetic", PIPELINE_GRAPH_CLIENT_SECRET: "synthetic", PIPELINE_MEET_CLIENT_SENDER: "sender@example.invalid", PIPELINE_MEET_CLIENT_LIVE_ENABLED: "true", PIPELINE_DEMO_MODE: "false" });
  try { await mail.sendUnderReviewEmail(82, "Reviewed context for the decision.\nhttps://alamo-pipeline.com/?referralId=82"); }
  finally { process.env = previous; }
  assert.equal(calls.length, 2);
  const message = JSON.parse(calls[1].init.body).message;
  assert.deepEqual(Array.from(message.toRecipients, (item) => item.emailAddress.address), ["andrew@aaahealthservices.com", "sandeep@aaahealthservices.com"]);
  assert.equal(message.body.content, "Reviewed context for the decision.\nhttps://alamo-pipeline.com/?referralId=82");
});
