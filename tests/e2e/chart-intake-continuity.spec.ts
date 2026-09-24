import { expect, test, type APIRequestContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { clinicalFixture } from "./support/pipeline-clinical-fixtures";
import type { Referral } from "../../lib/pipeline/referral-types";

let clinicalServer: Server;
const headers = { authorization: "Bearer playwright-clinical-token" };
test.beforeAll(async () => {
  if (process.env.PIPELINE_DATABASE_MODE === "postgres") {
    const database = new URL(process.env.PIPELINE_DATABASE_URL!);
    if (database.hostname !== "127.0.0.1" || !database.pathname.endsWith("_test")) {
      throw new Error("Chart continuity tests require an explicitly isolated local test database.");
    }
    const sql = postgres(process.env.PIPELINE_DATABASE_URL!, { ssl: false, max: 1 });
    try {
      await sql`insert into pipeline.workspace_members (principal_id, display_name, email, roles)
        values ('chart-intake-fixture-assessor', 'Chart Intake Assessor', 'chart-intake@example.invalid', array['reviewer'])
        on conflict (principal_id) do nothing`;
    } finally { await sql.end(); }
  }
  clinicalServer = createServer((request, response) => {
    if (request.url?.includes("/assets/")) {
      response.writeHead(404);
      response.end();
      return;
    }
    const client = structuredClone(clinicalFixture.client) as { client: Record<string, unknown> };
    const resident = structuredClone(clinicalFixture.resident) as { resident: Record<string, unknown> };
    resident.resident.date_of_birth = "1984-06-12";
    resident.resident.resident_number = "R-100";
    if (request.url?.includes("R-200")) {
      resident.resident.resident_key = "337:R-200";
      resident.resident.resident_number = "R-200";
      resident.resident.canonical_client_id = null;
    }
    client.client.enrichment = { ...(client.client.enrichment as object), active_medications: ["Synthetic medication alpha", "Synthetic medication beta"], date_of_birth: "1984-06-12" };
    const payload = request.url?.includes("/residents/") ? resident : request.url?.includes("/clients/") ? client : clinicalFixture.roster;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => clinicalServer.listen(Number(process.env.PIPELINE_E2E_CLINICAL_PORT ?? "3299"), "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>((resolve) => clinicalServer.close(() => resolve())); });

async function createSource(request: APIRequestContext, overrides: Partial<Referral> = {}) {
  const response = await request.post("/api/referrals", { data: { client_mutation_id: randomUUID(), referral: {
    name: `Chart Fixture ${randomUUID().slice(0, 8).replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)))}`, date: "2026-08-10", stage: "New", community: "San Pablo",
    source: "Old referrer", priority: "standard", tags: [], documentName: "Old packet.pdf", documentStatus: "Uploaded",
    owner: "Unassigned", note: "Original referral narrative", createdAt: "2026-08-10T12:00:00Z", dob: "1984-06-12",
    gender: "Female", county: "Los Angeles", currentMedications: "Old medication history", phone: "555-0101",
    email: "fixture@example.invalid", payer: "Example Plan", conserved: "no",
    responsiblePerson: "Fixture contact", requirements: [], workspaceOrigin: "allo", ...overrides,
  } } });
  expect(response.status(), await response.text()).toBe(201);
  let referral = (await response.json()).referral as Referral;
  if (process.env.PIPELINE_DATABASE_MODE === "postgres" && ["allo", "import"].includes(overrides.workspaceOrigin ?? "allo")) {
    // The public create API cannot mint imported provenance; establish it only in this isolated test database.
    const sql = postgres(process.env.PIPELINE_DATABASE_URL!, { ssl: false, max: 1 });
    try {
      await sql`update pipeline.referrals
        set workspace_origin = ${overrides.workspaceOrigin ?? "allo"},
            source_workspace_id = ${`fixture-${referral.id}`},
            data = jsonb_set(data, '{workspaceOrigin}', ${JSON.stringify(overrides.workspaceOrigin ?? "allo")}::jsonb),
            workspace_status = ${overrides.workspaceStatus === "historical" ? "historical" : "active"}
        where referral_id = ${referral.id}`;
    } finally { await sql.end(); }
    referral = (await (await request.get(`/api/referrals/${referral.id}`)).json()).referral as Referral;
  }
  if (referral.workspaceStatus === "historical") return referral;
  // New intakes cannot claim an admission date. Populate the existing chart
  // through its versioned update API so the next intake must clear real data.
  const chartUpdate = await request.patch(`/api/referrals/${referral.id}`, { data: {
    if_match: referral.version,
    client_mutation_id: randomUUID(),
    patch: { admissionDate: "2026-08-15" },
  } });
  expect(chartUpdate.status(), await chartUpdate.text()).toBe(200);
  return (await chartUpdate.json()).referral as Referral;
}

test("a chart allows another intake while retries remain idempotent", async ({ page }, testInfo) => {
  const source = await createSource(page.request);
  expect(source.admissionDate).toBe("2026-08-15");
  const before = await (await page.request.get(`/api/referrals/${source.id}/canvas`)).json();
  await page.goto(`/?view=referrals&screen=packet&referralId=${source.id}&workspaceStage=chart`);
  await expect(page.getByRole("button", { name: "Create intake", exact: true })).toBeVisible();
  // Start a fresh episode from Clients, not a duplicate action inside an intake.
  await page.goto(`/?screen=profile&clientId=pipeline:${source.clientId}`);
  await expect(page.getByRole("button", { name: "Create intake", exact: true })).toBeVisible();
  const createdRequest = page.waitForRequest((request) => request.url().endsWith(`/referrals/${source.id}/new-intake`) && request.method() === "POST");
  const createdResponse = page.waitForResponse((response) => response.url().endsWith(`/referrals/${source.id}/new-intake`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create intake", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Assign new intake" })).toBeVisible();
  await page.getByRole("dialog", { name: "Assign new intake" }).getByRole("button", { name: "Create intake", exact: true }).click();
  const response = await createdResponse;
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()).referral as Referral;
  expect(created.id).not.toBe(source.id);
  expect(created.clientId).toBe(source.clientId);
  expect(created.documentName).toBe("");
  expect(created.documentStatus).toBe("Missing");
  expect(created.admissionDate).toBe("");
  expect(created.assessment).toBeUndefined();
  expect(created.admissionDecision).toBeUndefined();
  expect(created.fieldSources?.currentMedications).toContain(`workspace #${source.id}`);
  await expect(page).toHaveURL(new RegExp(`referralId=${created.id}.*workspaceField=name`));
  await expect(page.locator("#packet-page-1")).toBeVisible();
  await expect(page.locator(`input[value="${created.name}"]`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create intake", exact: true })).toHaveCount(0);
  const membersResponse = await page.request.get("/api/members?scope=assessors");
  expect(membersResponse.ok()).toBeTruthy();
  const members = (await membersResponse.json()).members as { principal_id: string; display_name: string }[];
  expect(members.length).toBeGreaterThan(0);
  const ownerField = page.getByRole("combobox", { name: "Assessor", exact: true });
  await ownerField.focus();
  const ownerSave = page.waitForResponse((response) => response.url().endsWith(`/api/referrals/${created.id}`) && response.request().method() === "PATCH");
  await ownerField.selectOption(members[0].principal_id);
  await ownerField.press("Tab");
  const ownerResponse = await ownerSave;
  expect(ownerResponse.status(), await ownerResponse.text()).toBe(200);
  await expect.poll(async () => {
    const result = await page.request.get(`/api/referrals/${created.id}`);
    return ((await result.json()) as { referral: Referral }).referral.ownerId;
  }).toBe(members[0].principal_id);
  await expect(page.getByText("if_match_sections is missing: workflow.")).toHaveCount(0);
  const mutation = (await createdRequest).postDataJSON();
  const replay = await page.request.post(`/api/referrals/${source.id}/new-intake`, { data: mutation });
  expect(replay.status(), await replay.text()).toBe(201);
  expect((await replay.json()).referral.id).toBe(created.id);
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => page.request.post(`/api/referrals/${source.id}/new-intake`, { data: mutation })));
  for (const response of concurrent) {
    expect(response.status()).toBe(201);
    expect((await response.json()).referral.id).toBe(created.id);
  }
  const freshMutation = { client_mutation_id: randomUUID() };
  const simultaneous = await Promise.all(Array.from({ length: 8 }, () => page.request.post(`/api/referrals/${source.id}/new-intake`, { data: freshMutation })));
  const simultaneousIds = new Set<number>();
  for (const response of simultaneous) {
    expect(response.status(), await response.text()).toBe(201);
    simultaneousIds.add((await response.json()).referral.id);
  }
  expect(simultaneousIds.size).toBe(1);
  expect(simultaneousIds.has(created.id)).toBe(false);
  const duplicateId = [...simultaneousIds][0];
  const duplicate = (await (await page.request.get(`/api/referrals/${duplicateId}`)).json()).referral as Referral;
  expect(duplicate.clientId).toBe(created.clientId);
  expect((await (await page.request.get(`/api/referrals/${source.id}/canvas`)).json()).referral).toEqual(before.referral);
  await page.goto(`/?view=referrals&screen=packet&referralId=${source.id}&workspaceStage=chart`);
  await expect(page.getByRole("button", { name: "Create intake", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("seeded-intake.png"), fullPage: true });
});

test("an assessor can create their own intake from an older chart", async ({ page }) => {
  test.skip(process.env.PIPELINE_MOCK_USER_ROLES !== "reviewer", "Run with an assessor role fixture.");
  const source = await createSource(page.request, { workspaceOrigin: "import", workspaceStatus: "historical" });
  await page.goto(`/?view=referrals&screen=packet&referralId=${source.id}&workspaceStage=chart`);
  await page.getByRole("button", { name: "Create intake", exact: true }).click();
  const assignment = page.getByRole("dialog", { name: "Assign new intake" });
  const members = await (await page.request.get("/api/members?scope=assessors")).json() as { current_principal_id: string };
  await expect(assignment.getByRole("combobox", { name: "Assessor" })).toHaveValue("");
  const createdResponse = page.waitForResponse((response) => response.url().endsWith(`/referrals/${source.id}/new-intake`) && response.request().method() === "POST");
  await assignment.getByRole("button", { name: "Create intake", exact: true }).click();
  const response = await createdResponse;
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()).referral as Referral;
  expect(created.ownerId).toBe(members.current_principal_id);
  await expect(page.locator("#packet-page-1")).toBeVisible();
});

test("saved client workspaces offer a new intake with carried chart details", async ({ page }, testInfo) => {
  const ordinary = await createSource(page.request, { workspaceOrigin: "pipeline" });
  await page.goto(`/?view=referrals&screen=packet&referralId=${ordinary.id}&workspaceStage=chart`);
  await expect(page.getByRole("button", { name: "Create intake", exact: true })).toHaveCount(0);
  const source = await createSource(page.request, { workspaceOrigin: "import", workspaceStatus: "historical" });
  const memberList = await (await page.request.get("/api/members?scope=assessors")).json() as {
    members: { principal_id: string; display_name: string }[]; current_principal_id: string;
  };
  const selectedAssessor = memberList.members.find((member) => member.principal_id !== memberList.current_principal_id);
  expect(selectedAssessor).toBeDefined();
  await page.goto(`/?view=referrals&screen=packet&referralId=${source.id}&workspaceStage=chart`);
  const action = page.getByRole("button", { name: "Create intake", exact: true });
  await expect(action).toBeVisible();
  await expect(page.getByTestId("workspace-folder-header").getByRole("button", { name: "Create intake", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-new-intake-action.png"), fullPage: false });
  const createdResponse = page.waitForResponse((response) => response.url().endsWith(`/referrals/${source.id}/new-intake`) && response.request().method() === "POST");
  await action.click();
  const assignment = page.getByRole("dialog", { name: "Assign new intake" });
  await expect(assignment).toBeVisible();
  await assignment.getByRole("combobox", { name: "Assessor" }).selectOption(selectedAssessor!.principal_id);
  await assignment.getByRole("button", { name: "Create intake", exact: true }).click();
  const response = await createdResponse;
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()).referral as Referral;
  expect(created.clientId).toBe(source.clientId);
  expect(created.name).toBe(source.name);
  expect(created.phone).toBe(source.phone);
  expect(created.admissionDate).toBe("");
  expect(created.documentName).toBe("");
  expect(created.ownerId).toBe(selectedAssessor!.principal_id);
  expect(created.owners?.map((owner) => owner.id)).toEqual([selectedAssessor!.principal_id]);
  expect(created.workspaceOrigin).toBe("pipeline");
  expect(created.workspaceStatus).toBe("active");
  await expect(page).toHaveURL(new RegExp(`referralId=${created.id}.*workspaceField=name`));
  await expect(page.locator("#packet-page-1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create intake", exact: true })).toHaveCount(0);
  const stages = page.getByRole("navigation", { name: "Workspace stages" });
  if ((page.viewportSize()?.width ?? 0) < 640) {
    const view = stages.getByRole("combobox", { name: "Workspace view" });
    await expect(view).toHaveValue("1");
    await expect(view.getByRole("option", { name: "Assessment" })).toHaveCount(1);
    await expect(view.getByRole("option", { name: "Decision" })).toHaveCount(1);
    await expect(view.getByRole("option", { name: "Finish & send" })).toHaveCount(1);
    await view.selectOption("3");
    await expect(page.getByRole("region", { name: "Chart", exact: true })).toBeVisible();
    await view.selectOption("1");
  } else {
    await expect(stages.getByRole("button", { name: "Intake", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(stages.getByRole("button", { name: "Assessment", exact: true })).toBeVisible();
    await expect(stages.getByRole("button", { name: "Decision", exact: true })).toBeVisible();
    await expect(stages.getByRole("button", { name: "Finish & send", exact: true })).toBeVisible();
    await stages.getByRole("button", { name: "Chart", exact: true }).click();
    await expect(page.getByRole("region", { name: "Chart", exact: true })).toBeVisible();
    await stages.getByRole("button", { name: "Intake", exact: true }).click();
  }
  await expect(page.locator("#packet-page-1")).toBeVisible();
  await page.reload();
  await expect(page.locator("#packet-page-1")).toBeVisible();
  expect((await (await page.request.get(`/api/referrals/${source.id}`)).json()).referral).toEqual(source);
  const active = await (await page.request.get("/api/referrals?limit=100")).json() as { referrals: Referral[] };
  expect(active.referrals.some((referral) => referral.id === created.id)).toBe(true);
  expect(active.referrals.some((referral) => referral.id === source.id)).toBe(false);
  await page.goto(`/?view=referrals&screen=packet&referralId=${source.id}&workspaceStage=chart`);
  await expect(page.getByRole("button", { name: "Create intake", exact: true })).toBeVisible();
});

test("Clients and Workspace resolve the same confirmed chart, and new intake retains the connection", async ({ page }, testInfo) => {
  const source = await createSource(page.request, { county: "Alameda" });
  const linkResponse = await page.request.post("/api/resident-links", { headers, data: {
    pipeline_client_id: source.clientId, display_name: source.name, referral_id: source.id, resident_key: "337:R-100", resident_number: "R-100",
    community_id: "337", match_method: "manual", client_mutation_id: randomUUID(),
  } });
  expect(linkResponse.status(), await linkResponse.text()).toBe(201);
  const link = (await linkResponse.json()).link;
  const unconfirmed = await (await page.request.get(`/api/profiles/${encodeURIComponent(`pipeline:${source.clientId}`)}`, { headers })).json();
  expect(unconfirmed.client.enrichment.active_medications).toBeUndefined();
  const confirm = await page.request.patch(`/api/resident-links/${link.link_id}`, { headers, data: { action: "confirm", if_match: link.version, review_note: "Synthetic identity verified for chart continuity" } });
  expect(confirm.status(), await confirm.text()).toBe(200);
  const canonical = await (await page.request.get("/api/profiles/client-sanitized-100", { headers })).json();
  const workspace = await (await page.request.get(`/api/profiles/${encodeURIComponent(`pipeline:${source.clientId}`)}`, { headers })).json();
  expect(workspace.client).toEqual(canonical.client);
  expect(workspace.resident).toEqual(canonical.resident);
  expect(workspace.pipeline.documents).toEqual(canonical.pipeline.documents);
  expect(workspace.pipeline.referrals).toEqual(canonical.pipeline.referrals);
  expect(workspace.client.enrichment.active_medications).toContain("Synthetic medication beta");
  await page.setExtraHTTPHeaders(headers);
  await page.goto(`/?screen=profile&clientId=pipeline:${source.clientId}`);
  await expect(page.getByRole("article", { name: "Client medical chart" })).toContainText("Sanitized diagnosis");
  await expect(page.getByRole("article", { name: "Client medical chart" })).toContainText("Synthetic medication beta");
  await expect(page.getByRole("article", { name: "Client medical chart" })).toContainText("Female");
  await page.screenshot({ path: testInfo.outputPath("linked-chart.png"), fullPage: true });
  const sql = process.env.PIPELINE_DATABASE_MODE === "postgres"
    ? postgres(process.env.PIPELINE_DATABASE_URL!, { ssl: false, max: 1 }) : null;
  const beforePerson = sql ? await sql`select * from pipeline.people where external_client_id = ${source.clientId!}` : null;
  const response = await page.request.post(`/api/referrals/${source.id}/new-intake`, { headers, data: { client_mutation_id: randomUUID() } });
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()).referral;
  expect(created.clientId).toBe(source.clientId);
  expect(created.currentMedications).toContain("Synthetic medication beta");
  expect(created.currentMedications).not.toContain("Old medication history");
  const reopened = await (await page.request.get(`/api/referrals/${created.id}/canvas`)).json();
  expect(reopened.referral.name).toBe(created.name);
  if (sql) {
    try {
      expect(await sql`select * from pipeline.people where external_client_id = ${source.clientId!}`).toEqual(beforePerson);
      const rows = await sql`select person_id from pipeline.referrals where referral_id in (${source.id}, ${created.id})`;
      expect(new Set(rows.map((row) => row.person_id)).size).toBe(1);
    } finally { await sql.end(); }
  }
  const updated = await (await page.request.get("/api/profiles/client-sanitized-100", { headers })).json();
  expect(updated.pipeline.referrals.map((referral: Referral) => referral.id)).toContain(created.id);
  expect(updated.pipeline.documents.some((file: { referralId: number }) => file.referralId === source.id)).toBe(true);
});

test("source validation rejects malformed, missing and cross-origin intake requests", async ({ request }) => {
  const source = await createSource(request);
  const ordinary = await createSource(request, { workspaceOrigin: "pipeline" });
  expect((await request.post(`/api/referrals/${ordinary.id}/new-intake`, { data: { client_mutation_id: randomUUID() } })).status()).toBe(201);
  expect((await request.post(`/api/referrals/${source.id}/new-intake`, { data: {} })).status()).toBe(400);
  expect((await request.post(`/api/referrals/${source.id}/new-intake`, { data: { client_mutation_id: randomUUID(), assignee_id: "unknown-member" } })).status()).toBe(422);
  expect((await request.post(`/api/referrals/${source.id}oops/new-intake`, { data: { client_mutation_id: randomUUID() } })).status()).toBe(400);
  expect((await request.post("/api/referrals/99999999/new-intake", { data: { client_mutation_id: randomUUID() } })).status()).toBe(404);
  expect((await request.post(`/api/referrals/${source.id}/new-intake`, { headers: { origin: "https://wrong.invalid" }, data: { client_mutation_id: randomUUID() } })).status()).toBe(403);
});

test("a census-only client includes its confirmed workspace records in either chart", async ({ request }) => {
  const source = await createSource(request, { county: "Contra Costa", workspaceOrigin: "pipeline" });
  const linkResponse = await request.post("/api/resident-links", { headers, data: {
    pipeline_client_id: source.clientId, display_name: source.name, referral_id: source.id,
    resident_key: "337:R-200", resident_number: "R-200", community_id: "337",
    match_method: "manual", client_mutation_id: randomUUID(),
  } });
  expect(linkResponse.status(), await linkResponse.text()).toBe(201);
  const { link } = await linkResponse.json();
  const confirm = await request.patch(`/api/resident-links/${link.link_id}`, { headers, data: {
    action: "confirm", if_match: link.version, review_note: "Synthetic census identity verified",
  } });
  expect(confirm.status(), await confirm.text()).toBe(200);
  const client = await (await request.get(`/api/profiles/${encodeURIComponent("resident:337:R-200")}`, { headers })).json();
  const workspace = await (await request.get(`/api/profiles/${encodeURIComponent(`pipeline:${source.clientId}`)}`, { headers })).json();
  expect(client.client).toEqual(workspace.client);
  expect(client.pipeline).toEqual(workspace.pipeline);
  expect(client.pipeline.connection.status).toBe("confirmed");
  expect(client.pipeline.referrals.some((referral: Referral) => referral.id === source.id)).toBe(true);
  expect(client.pipeline.documents.some((file: { referralId: number }) => file.referralId === source.id)).toBe(true);
});
