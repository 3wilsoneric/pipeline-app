#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function load(file, stubs) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(output, { module: loaded, exports: loaded.exports, require: (id) => stubs[id] ?? {}, Buffer, URL, URLSearchParams, Request, Response, Date, console, Map, Set }, { filename: file });
  return loaded.exports;
}
const checks = [];
let allowed = true;
let unavailable = false;
let pages = 0;
const metadata = { source: "alamo_platform", snapshot_id: "fixture", generated_at: "2026-09-12T00:00:00Z", data_as_of: "2026-09-12", retrieved_at: "2026-09-12T00:00:00Z", freshness: { status: "fresh", age_hours: 0, max_age_hours: 24, warning: null } };
const resident = { resident_key: "site:71", canonical_client_id: null, resident_number: "71", display_name: "Fixture Person", community_name: "Fixture community", unit: "1", admit_date: "2026-01-02", care_level: "Fixture" };
const clinical = {
  async getClinicalRoster() { pages++; if (unavailable) throw Error("source unavailable"); return { ...metadata, residents: [resident], total: 2, limit: 1, next_cursor: "next", query: "", community: null }; },
  getClinicalClients() { throw Error("Current Clients must not read all enhanced clients"); },
  async getClinicalResident() { return { ...metadata, resident }; },
  clinicalDataErrorResponse() { return Response.json({ error: "Source unavailable" }, { status: 503 }); },
};
const directory = load("app/api/profiles/directory/route.ts", {
  "@/lib/auth/pipeline-auth": { async requirePipelineUser() { return allowed ? { ok: true, user: { id: "fixture-owner" } } : { ok: false, response: new Response(null, { status: 403 }) }; } },
  "@/lib/observability/api-logging": { withApiLogging: (_request, _route, fn) => fn({ requestId: "fixture" }) },
  "@/lib/clinical/clinical-data": clinical,
  "@/lib/pipeline/client-workspace-store": { async getClinicalClientWorkspaceSummaries() { return new Map(); }, listPipelineClientWorkspaces() { throw Error("Imported workspaces cannot populate current Clients"); } },
});
const path = "https://pipeline.invalid/api/profiles/directory?scope=current";
const response = await directory.GET(new Request(path));
const payload = await response.json();
assert.equal(payload.total, 2);
assert.equal(payload.clients.length, 1);
assert.equal(payload.clients[0].current_resident, true);
assert.equal(payload.clients[0].canonical_client_id, "");
assert.equal(payload.clients[0].profile_key, "resident:site:71");
assert.match(response.headers.get("cache-control"), /private, no-store/);
checks.push("current Clients uses the platform census, including residents without canonical identities");
assert.equal((await directory.GET(new Request(path + "&cursor=" + encodeURIComponent(payload.next_cursor)))).status, 200);
const wrongCursor = Buffer.from(JSON.stringify({ phase: "pipeline", offset: 0 })).toString("base64url");
assert.equal((await directory.GET(new Request(path + "&cursor=" + wrongCursor))).status, 400);
checks.push("current census pagination never spills into imported or Pipeline-only workspaces");
allowed = false;
const before = pages;
assert.equal((await directory.GET(new Request(path))).status, 403);
assert.equal(pages, before);
allowed = true;
unavailable = true;
assert.equal((await directory.GET(new Request(path))).status, 503);
checks.push("authorization and upstream failures never substitute fake current clients");
const profile = load("lib/pipeline/unified-profile.ts", { "@/lib/clinical/clinical-data": clinical });
const current = await profile.getCurrentCensusClientProfile(new Request(path), "resident:site:71", {});
assert.equal(current.client.canonical_client_id, "");
assert.equal(current.client.display_name, resident.display_name);
assert.equal(current.resident.resident_number, "71");
assert.equal(current.pipeline.referrals.length, 0);
assert.equal(current.pipeline.assessments.length, 0);
assert.equal(current.pipeline.permissions.can_review_identity, false);
checks.push("unlinked current residents open with real census facts and no guessed patient joins");
const chart = loadTypeScriptModule(process.cwd(), "lib/pipeline/client-medical-chart.ts");
const identity = { name: "Fixture Person", gender: null, community: "Fixture community" };
const draft = { status: "draft", assessment_date: "2026-09-12", primary_diagnosis: "Draft diagnosis" };
const model = chart.buildClientMedicalChart(identity, { ...resident, primary_diagnosis: "Platform diagnosis" }, [], [draft]);
assert.equal(model.assessmentDate, null);
assert.equal(model.priorities[0].value, "Platform diagnosis");
const signed = chart.buildClientMedicalChart(identity, resident, [], [draft, { ...draft, status: "complete", signed_at: "2026-09-12T10:00:00Z" }]);
assert.equal(signed.assessmentDate, "2026-09-12");
checks.push("drafts neither claim an assessment occurred nor override platform clinical data; signed encounters remain visible");
const medicalChart = load("components/pipeline/ClientMedicalChart.tsx", { "react/jsx-runtime": jsxRuntime });
let stateIndex = 0;
const transferredChart = load("components/pipeline/TransferredWorkspaceChart.tsx", {
  "react/jsx-runtime": jsxRuntime,
  react: { useEffect() {}, useState(initial) { return [stateIndex++ === 3 ? [{ id: "fixture-file", referralId: 71, previewUrl: "/api/files/fixture/preview" }] : initial, () => {}]; } },
  "@/components/pipeline/ClientMedicalChart": medicalChart,
  "@/components/pipeline/ClientProfileView": { ClientDocumentGallery: ({ documents }) => React.createElement("a", { href: documents[0].previewUrl }, "Open chart file") },
  "@/lib/pipeline/structured-narrative": loadTypeScriptModule(process.cwd(), "lib/pipeline/structured-narrative.ts"),
});
const fields = [
  { label: "NAME", value: "Fixture Person" }, { label: "DOB", value: "01/02/1990" },
  { label: "Owner (@name):", value: "Original owner" }, { label: "County:", value: "Source county" },
  { label: "Client phone:", value: "Source contact" }, { label: "AGE", value: "" },
  { label: "Summary", value: "Preserved introduction\n\n## Reason for referral\nRecorded reason\n\n## Current presentation\n<script>untrusted source text</script>" },
];
const transferredModel = transferredChart.buildTransferredClientChart(fields);
assert.equal(transferredModel.assessmentDate, null);
assert.equal(transferredModel.priorities.length, 0);
assert.equal(transferredModel.identity.length, 2);
assert.equal(transferredModel.care.find((fact) => fact.label === "Owner").value, "Original owner");
const html = renderToStaticMarkup(React.createElement(transferredChart.default, {
  referral: { id: 71, clientId: "fixture", createdAt: "2026-08-20T00:00:00Z" }, fields,
}));
assert.match(html, /Client medical chart/i);
assert.match(html, /lg:grid-cols-6/);
assert.match(html, /Referral information/);
assert.match(html, /Original owner/);
assert.match(html, /Preserved introduction/);
assert.match(html, /Recorded reason/);
assert.match(html, /&lt;script&gt;untrusted source text&lt;\/script&gt;/);
assert.doesNotMatch(html, /## Reason for referral|## Current presentation|Latest assessment|Clinical priorities/);
assert(html.indexOf("Open chart file") < html.indexOf("Referral summary"));
const canvasSource = readFileSync("components/pipeline/ReferralPacketCanvas.tsx", "utf8");
assert.match(canvasSource, /lg:flex lg:gap-3/);
assert.doesNotMatch(canvasSource, /lg:grid-cols-\[minmax\(120px,1fr\)_minmax\(0,2fr\)_auto\]/);
checks.push("transferred charts use the established compact chart, openable files precede readable notes, original facts remain intact, and desktop stages sit beside the name");
console.log(JSON.stringify({ ok: true, checks }, null, 2));
