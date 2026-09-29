import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { clinicalFixture } from "./support/pipeline-clinical-fixtures";

let source: Server;
test.beforeAll(async () => {
  source = createServer((request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    const missing = path.endsWith("dob-missing") || path.endsWith("DOB-2");
    const row = (id: string, number: string) => ({
      ...(clinicalFixture.clients.clients as object[])[0], canonical_client_id: id,
      display_name: "DOB Example", resident_numbers: [number],
    });
    const resident = { ...clinicalFixture.resident, resident: {
      ...(clinicalFixture.resident.resident as object), resident_key: missing ? "dob:DOB-2" : "dob:DOB-1",
      canonical_client_id: null, resident_number: missing ? "DOB-2" : "DOB-1", display_name: "DOB Example", date_of_birth: null,
    } };
    const directory = { ...clinicalFixture.clients, clients: [row("dob-found", "DOB-1"), row("dob-missing", "DOB-2")], total: 2, next_cursor: null };
    const client = { ...clinicalFixture.client, client: {
      ...(clinicalFixture.client.client as object), ...row("dob-found", "DOB-1"),
      enrichment: { date_of_birth: "1980-02-29T00:00:00-08:00" }, resident_profile: null, resident_profiles: [],
    } };
    const unavailable = path.endsWith("/clients/dob-missing");
    response.writeHead(unavailable ? 503 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(unavailable ? { error: "Fixture unavailable" } : path.includes("/residents/") ? resident : path.endsWith("/clients") ? directory : path.includes("/clients/") ? client : clinicalFixture.roster));
  });
  await new Promise<void>(resolve => source.listen(Number(process.env.PIPELINE_E2E_CLINICAL_PORT ?? "3299"), "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>(resolve => source.close(() => resolve())); });

for (const width of [1440, 390]) {
  test(`current client chart displays the verified resident-number DOB at ${width}px without writes`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.setExtraHTTPHeaders({ authorization: `Bearer dob-fixture-${width}` });
    const writes: string[] = [];
    page.on("request", request => { if (request.url().includes("/api/") && !["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
    const profile = await page.request.get("/api/profiles/resident%3Adob%3ADOB-1");
    expect(profile.status(), await profile.text()).toBe(200);
    const body = await profile.json();
    expect(body.resident.date_of_birth).toBe("1980-02-29");
    expect(body.client.enrichment.date_of_birth).toBe("1980-02-29");
    expect(body.client.canonical_client_id).toBe("");
    expect(body.pipeline.referrals).toEqual([]);
    await page.goto("/?screen=profile&clientId=resident%3Adob%3ADOB-1");
    const chart = page.getByRole("article", { name: "Client medical chart", exact: true });
    await expect(chart).toBeVisible();
    await expect(chart.getByText("Feb 29, 1980", { exact: true })).toBeVisible();
    await page.reload();
    await expect(chart.getByText("Feb 29, 1980", { exact: true })).toBeVisible();
    expect(writes.filter(path => /referrals|resident-links|assessments/.test(path))).toEqual([]);
    const unavailable = await page.request.get("/api/profiles/resident%3Adob%3ADOB-2");
    expect(unavailable.status()).toBe(200);
    expect((await unavailable.json()).resident.date_of_birth).toBeNull();
    await page.goto("/?screen=profile&clientId=resident%3Adob%3ADOB-2");
    await expect(chart).toBeVisible();
    await expect(chart.getByText("Feb 29, 1980", { exact: true })).toHaveCount(0);
    await expect(page.getByText("This page could not load.", { exact: true })).toHaveCount(0);
  });
}
