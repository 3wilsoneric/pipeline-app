import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { clinicalFixture } from "./support/pipeline-clinical-fixtures";

let clinicalServer: Server;
test.beforeAll(async () => {
  clinicalServer = createServer((request, response) => {
    const payload = request.url?.includes("/residents/") ? clinicalFixture.resident : clinicalFixture.roster;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => clinicalServer.listen(Number(process.env.PIPELINE_E2E_CLINICAL_PORT ?? "3299"), "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>((resolve) => clinicalServer.close(() => resolve())); });

test("the historical report API still returns governed resident rows and CSV", async ({ request }) => {
  const headers = { authorization: "Bearer playwright-clinical-token" };
  const response = await request.get("/api/operations/reports?report_id=clients_by_community&client_scope=current", { headers });
  expect(response.status(), await response.text()).toBe(200);
  const payload = await response.json();
  expect(payload.report.columns.map((column: { label: string }) => column.label)).toContain("Community");
  expect(JSON.stringify(payload.report)).toContain("San Pablo");
  expect(JSON.stringify(payload.report)).not.toContain("Not recorded");

  const exported = await request.post("/api/operations/reports", {
    headers: { ...headers, origin: "http://127.0.0.1:" + (process.env.PORT ?? "3000") },
    data: { report_id: "clients_by_community", client_scope: "current" },
  });
  expect(exported.status(), await exported.text()).toBe(200);
  expect(exported.headers()["content-type"]).toContain("text/csv");
  const csv = await exported.text();
  expect(csv).toContain('"Client","Community","County","Status","Admission date","Referrals"');
  expect(csv).toContain("San Pablo");
});

test("the historical source and chart reports include existing workspaces", async ({ request }) => {
  const created = await request.post("/api/referrals", { data: { client_mutation_id: randomUUID(), referral: {
    name: "Clara Rivera", date: "2026-09-10", createdAt: "2026-09-10T12:00:00Z", stage: "New", community: "San Pablo", county: "Contra Costa County", source: "Sample Referral Hospital", priority: "standard", documentName: "", documentStatus: "Missing", owner: "Unassigned", note: "", dob: "1980-04-12", phone: "", email: "", payer: "", requirements: [],
  } } });
  expect(created.status(), await created.text()).toBe(201);
  const headers = { authorization: "Bearer playwright-clinical-token" };
  const sources = await request.get("/api/operations/reports?report_id=referral_sources", { headers });
  expect(sources.status()).toBe(200);
  expect(JSON.stringify((await sources.json()).report)).toContain("Sample Referral Hospital");
  const completeness = await request.get("/api/operations/reports?report_id=chart_completeness", { headers });
  expect(completeness.status()).toBe(200);
  const chart = JSON.stringify((await completeness.json()).report);
  expect(chart).toContain("Clara Rivera");
  expect(chart).toContain("Primary diagnosis");
  expect(chart).toContain("Face sheet");
});

test("new filters reject invalid input and incompatible scopes", async ({ request }) => {
  for (const query of ["county=" + "x".repeat(121), "client_scope=bad", "care_topic=bad", "month=2026-13"]) {
    expect((await request.get(`/api/operations/reports?report_id=clients_by_community&${query}`)).status()).toBe(400);
  }
  expect((await request.get("/api/operations/reports?report_id=assessment_completion&month=")).status()).toBe(400);
  expect((await request.get("/api/operations/reports?report_id=chart_completeness&client_scope=current")).status()).toBe(400);
});
