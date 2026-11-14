import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadEntry } from "./contact-import-fixtures.mjs";

const { renderAssessorScorecardPdf } = loadEntry("lib/pipeline/assessor-scorecard-pdf.ts");
const owner = { id: "f73371d5-d2b4-48b4-a32b-1edc7c88869f", email: "ericwilsonalamo@outlook.com", roles: ["admin"] };
const snapshot = {
  period: "launch", since: "2026-09-18T07:00:00Z", through: "2026-11-13T20:00:00Z", usageSince: null,
  unattributedEvents: 2, unassignedWorkspaces: 1, unassignedGapItems: 3,
  people: Array.from({ length: 8 }, (_, i) => ({
    id: String(i), name: i === 0 ? "Alexandria Montgomery-Washington" : `Synthetic Assessor ${i + 1}`, active: i !== 7,
    evidence: Object.fromEntries(["interviews", "confirmed", "clients", "fields", "uploads", "handoffs", "resends", "sendIssues", "assigned", "overdue", "gaps"].map(key => [key, Array.from({ length: i + 1 }, () => ({ client: "PRIVATE CLIENT SHOULD NOT BE EXPORTED", detail: "PRIVATE NOTES", referralId: 1 }))])),
    activeDays: i + 2, interviewSpanHours: i ? 12.25 : null, interviewSpanSamples: i,
    usage: i ? { interactions: 1000 + i, activeMinutes: 98, days: 3 } : null,
  })),
};

test("PDF keeps all summary measures, full names, provenance and private evidence out of the export", async () => {
  const bytes = await renderAssessorScorecardPdf(snapshot, "name");
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const items = (await page.getTextContent()).items.filter(item => "str" in item);
      for (const item of items.filter(item => item.str.trim())) {
        assert.ok(item.transform[4] >= 35 && item.transform[4] + item.width <= 758, `text fits page: ${item.str}`);
        assert.ok(item.transform[5] >= 12 && item.transform[5] <= 600, `text fits vertically: ${item.str}`);
      }
      pages.push(items.map(item => item.str).join(" "));
    }
    const content = pages.join(" ").replace(/\s+/g, " ");
    for (const person of snapshot.people) assert.ok(content.includes(person.name));
    for (const label of ["Charts confirmed", "Fields touched", "Files uploaded", "Additional handoffs", "Overdue assignments", "Interview interval", "Counting rules"]) assert.ok(content.toLowerCase().includes(label.toLowerCase()), label);
    assert.match(content, /Sep 18, 2026 - Nov 13, 2026/);
    assert.match(content, /Historical clicks and active minutes are unavailable/);
    assert.doesNotMatch(content, /PRIVATE CLIENT|PRIVATE NOTES/);
    pages.forEach((text, i) => assert.match(text, new RegExp(`Page ${i + 1}`)));
    await mkdir("tmp/pdfs", { recursive: true });
    await writeFile("tmp/pdfs/assessor-scorecard-preview.pdf", bytes);
  } finally { await task.destroy(); }
});

test("empty exports are explicit and long rosters paginate without dropping people", async () => {
  for (const people of [[], Array.from({ length: 35 }, (_, i) => ({ ...snapshot.people[i % 8], id: String(i), name: `Roster Person ${String(i + 1).padStart(2, "0")}` }))]) {
    const bytes = await renderAssessorScorecardPdf({ ...snapshot, people }, "name");
    const task = getDocument({ data: new Uint8Array(bytes) });
    const doc = await task.promise;
    try {
      let text = "";
      for (let n = 1; n <= doc.numPages; n++) text += (await (await doc.getPage(n)).getTextContent()).items.map(item => item.str ?? "").join(" ");
      for (const person of people) assert.ok(text.split(person.name).length - 1 >= 12, `${person.name} appears in every visual measure and the timeline`);
      if (!people.length) assert.match(text, /No assessor records in this period/);
    } finally { await task.destroy(); }
  }
});

test("PDF endpoint shares private access, fresh database reads, validated filters and no-store headers", async () => {
  let reads = 0, rendered = 0;
  const route = user => loadEntry("app/api/operations/assessor-scorecard/route.ts", {
    "@/lib/auth/pipeline-auth": { requirePipelineUser: async () => user ? { ok: true, user } : { ok: false, response: new Response(null, { status: 401 }) } },
    "@/lib/database/pipeline-database": { getPipelineDatabaseReadiness: () => ({ ready: true }) },
    "@/lib/observability/api-logging": { withApiLogging: async (_req, _path, run) => run() },
    "@/lib/pipeline/assessor-scorecard": { getAssessorScorecard: async (_user, period) => { reads++; assert.equal(period, "launch"); return snapshot; } },
    "@/lib/pipeline/assessor-scorecard-pdf": { renderAssessorScorecardPdf: async (data, sort) => { rendered++; assert.equal(data, snapshot); assert.equal(sort, "name"); return Buffer.from("%PDF-test"); } },
  });
  const url = "https://pipeline.invalid/api/operations/assessor-scorecard?period=launch&format=pdf&sort=name";
  for (const user of [null, { ...owner, delegation: {} }, { ...owner, id: "other", email: "other@example.invalid" }]) assert.equal((await route(user).GET(new Request(url))).status, user ? 403 : 401);
  assert.equal((await route(owner).GET(new Request(url.replace("sort=name", "sort=bad")))).status, 400);
  assert.equal(reads, 0); assert.equal(rendered, 0);
  const response = await route(owner).GET(new Request(url));
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.match(response.headers.get("content-disposition"), /launch-2026-11-13.pdf/);
  assert.equal(await response.text(), "%PDF-test"); assert.equal(reads, 1); assert.equal(rendered, 1);
});
