#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";

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
const readableChartText = load("components/pipeline/ReadableChartText.tsx", { "react/jsx-runtime": jsxRuntime });
const medicalChart = load("components/pipeline/ClientMedicalChart.tsx", {
  "react/jsx-runtime": jsxRuntime, "@/components/pipeline/ReadableChartText": readableChartText,
});
const fixtureCache = new Map();
const authenticatedFetch = { readPipelineJsonCache: (key) => fixtureCache.get(key) };
const clientProfile = load("components/pipeline/ClientProfileView.tsx", {
  react: React, "react/jsx-runtime": jsxRuntime, "lucide-react": icons,
  "@/lib/auth/authenticated-fetch": authenticatedFetch,
  "@/lib/clinical/clinical-value-presentation": loadTypeScriptModule(process.cwd(), "lib/clinical/clinical-value-presentation.ts"),
  "@/lib/pipeline/client-profile-presentation": loadTypeScriptModule(process.cwd(), "lib/pipeline/client-profile-presentation.ts"),
  "@/lib/pipeline/client-medical-chart": chart,
  "@/lib/pipeline/client-identity-presentation.mjs": loadTypeScriptModule(process.cwd(), "lib/pipeline/client-identity-presentation.mjs"),
  "@/components/pipeline/ClientMedicalChart": medicalChart,
  "@/components/pipeline/ReadableChartText": readableChartText,
});
const transferredChart = load("components/pipeline/TransferredWorkspaceChart.tsx", {
  "react/jsx-runtime": jsxRuntime, react: React,
  "@/lib/auth/authenticated-fetch": authenticatedFetch,
  "@/components/pipeline/ClientProfileView": clientProfile,
  "@/lib/pipeline/referral-ownership": loadTypeScriptModule(process.cwd(), "lib/pipeline/referral-ownership.ts"),
  "@/lib/pipeline/workspace-presentation": loadTypeScriptModule(process.cwd(), "lib/pipeline/workspace-presentation.ts"),
});
const fields = [
  { label: "NAME", value: "Fixture Person" }, { label: "DOB", value: "01/02/1990" },
  { label: "Owner (@name):", value: "Original owner" }, { label: "County:", value: "Source county" },
  { label: "Client phone:", value: "Source contact" }, { label: "AGE", value: "" },
  { label: "Summary", value: "Preserved introduction\n\n## Reason for referral\nRecorded reason\n\n## Current presentation\n<script>untrusted source text</script>" },
];
const source = { facts: [], sections: [], unmappedEvidence: [], sourceSections: [] };
const referral = { id: 71, clientId: "fixture", name: "Fixture Person", owner: "Original owner", community: "Fixture community", createdAt: "2026-08-20T00:00:00Z" };
const file = { id: "fixture-file", referralId: 71, name: "Actual packet.pdf", category: "Referral packet", status: "received", uploadedAt: "2026-08-20", thumbnailUrl: "/api/files/fixture/thumbnail", previewUrl: "/api/files/fixture/preview" };
const chartProfile = {
  ...current, ...metadata, source: "pipeline", profile_origin: "pipeline", resident: null,
  client_database: { fields: [] },
  client: { ...current.client, canonical_client_id: "fixture", enrichment: {}, source_documents: [], facts: [],
    resident_episode_history: [], resident_profiles: [], community_names: ["Fixture community"] },
  pipeline: { ...current.pipeline, connection: { status: "pipeline_only", suggestions: [] },
    referrals: [referral], assessments: [{ ...draft, referral_id: 71 }, { ...draft, referral_id: 999 }],
    documents: [file, { ...file, id: "other-referral-file", referralId: 999, name: "Do not show other workspace.pdf" }] },
};
const scoped = transferredChart.scopeWorkspaceClientProfile(chartProfile, referral, fields, source);
assert.equal(scoped.pipeline.documents.length, 1);
assert.equal(scoped.pipeline.assessments.length, 1);
assert.equal(scoped.pipeline.referrals.length, 0);
assert.equal(scoped.client.enrichment.date_of_birth, "01/02/1990");
assert.equal(chartProfile.pipeline.documents.length, 2);
assert.equal(chartProfile.client.enrichment.date_of_birth, undefined);
fixtureCache.set("/api/profiles/pipeline%3Afixture", chartProfile);
const html = renderToStaticMarkup(React.createElement(transferredChart.default, {
  referral, fields,
}, React.createElement("button", { "data-testid": "existing-assessment-actions" }, "Existing assessment actions")));
assert.match(html, /Client medical chart/i);
assert.match(html, /lg:grid-cols-6/);
assert.match(html, /Referral information/);
assert.match(html, /Original owner/);
assert.match(html, /Preserved introduction/);
assert.match(html, /Recorded reason/);
assert.match(html, /&lt;script&gt;untrusted source text&lt;\/script&gt;/);
assert.doesNotMatch(html, /## Reason for referral|## Current presentation|Latest assessment|Do not show other workspace/);
assert.match(html, /Client files/);
assert.match(html, /aria-label="Open Actual packet.pdf"/);
assert.match(html, /src="\/api\/files\/fixture\/thumbnail"/);
assert.match(html, /href="\/api\/files\/fixture\/preview"/);
assert.match(html, /existing-assessment-actions/);
fixtureCache.set("/api/profiles/pipeline%3Afixture", scoped);
const clientsHtml = renderToStaticMarkup(React.createElement(clientProfile.default, { residentKey: "pipeline:fixture", onBack() {}, onOpenWorkspace() {} }));
const article = (markup) => markup.match(/<article aria-label="Client medical chart"[\s\S]*?<\/article>/)[0];
assert.equal(article(html), article(clientsHtml));
const galleryHtml = renderToStaticMarkup(React.createElement(clientProfile.ClientDocumentGallery, { documents: [file] }));
assert(html.includes(galleryHtml));
checks.push("workspace charts render the actual Clients chart and thumbnail gallery; referral files and drafts are scoped without changing source data or removing assessment actions");
const provenance = { sourceCanvasName: "Original ALLO chart", sourceProjectName: "Original source", capturedAt: "2026-08-20" };
const imported = { ...source,
  facts: [{ key: "dob", label: "Date of birth", value: "02/03/1980", source: provenance },
    { key: "assessment_date", label: "Assessment date", value: "2025-01-02", source: provenance }],
  sections: [{ section: "clinical", label: "Clinical", fields: [
    { targetField: "primary_diagnosis", label: "Diagnosis", evidence: [{ text: "Recorded source diagnosis", confidence: "high", source: provenance }] },
    { targetField: "mobility", label: "Mobility", evidence: [{ text: "Uncertain source mobility", confidence: "medium", source: provenance }] },
  ] }],
  unmappedEvidence: [{ text: "Original unmapped note", source: provenance }],
  sourceSections: [{ sectionId: "original", label: "Original text", source: provenance, blocks: [{ ordinal: 1, text: "Source preamble\n## Original heading\nOriginal body" }] }],
};
const importedScope = transferredChart.scopeWorkspaceClientProfile(chartProfile, referral, [], imported);
assert.equal(importedScope.client.enrichment.date_of_birth, "02/03/1980");
assert.equal(importedScope.client.enrichment.primary_diagnosis, "Recorded source diagnosis");
assert.equal(importedScope.client.enrichment.mobility, undefined);
assert.equal(importedScope.client.enrichment.latest_assessment_date, undefined);
const importedHtml = renderToStaticMarkup(React.createElement(clientProfile.ClientChartRecord, {
  profile: importedScope, supplementalSections: transferredChart.workspaceClientSections(referral, fields),
  sourceSections: transferredChart.workspaceSourceSections(imported), sourceLabel: "ALLO (imported)",
}));
for (const text of ["ALLO assessment date (imported)", "2025-01-02", "Original ALLO chart", "Uncertain source mobility", "Original unmapped note", "Source preamble", "Original heading", "Original body"]) assert(importedHtml.includes(text), text);
assert.doesNotMatch(importedHtml, /## Original heading|Latest assessment/);
assert.match(importedHtml, /<details><summary/);
checks.push("original imported facts and attributed notes remain accessible; uncertain evidence stays in source notes and imported dates never become Pipeline assessment encounters");
const canvasSource = readFileSync("components/pipeline/ReferralPacketCanvas.tsx", "utf8");
assert.match(canvasSource, /lg:flex lg:gap-3/);
assert.doesNotMatch(canvasSource, /lg:grid-cols-\[minmax\(120px,1fr\)_minmax\(0,2fr\)_auto\]/);
assert.equal((canvasSource.match(/<TransferredWorkspaceChart/g) ?? []).length, 2);
assert.doesNotMatch(canvasSource, /<ImportedWorkspaceProfile/);
assert.match(canvasSource, /<AssessmentChartWorkspace referralId=\{referralWorkspaceId\}/);
checks.push("both transferred and active workspace Chart paths use the same client renderer, and desktop stages sit beside the name");
let assessmentState = 0;
const assessmentChart = load("components/pipeline/AssessmentChartWorkspace.tsx", {
  "react/jsx-runtime": jsxRuntime, "lucide-react": icons,
  react: { ...React, useEffect() {}, useCallback: (fn) => fn,
    useState: (initial) => [assessmentState++ === 0 ? { referral, report: null } : assessmentState === 3 ? false : initial, () => {}] },
  "@/components/pipeline/ReadableChartText": readableChartText,
});
assert.equal(renderToStaticMarkup(React.createElement(assessmentChart.default, { referralId: 71, embedded: true })), "");
checks.push("an unsigned active referral does not append a second placeholder chart beneath its client chart");
console.log(JSON.stringify({ ok: true, checks }, null, 2));
