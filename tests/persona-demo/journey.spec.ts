import { confirmReferralFileLabels } from "../e2e/support/referral-upload";
import { expect, test } from "@playwright/test";
import {
  completeOperationalAssessment,
  createOperationalAssessment,
  createOperationalReferral,
  markOperationalPacketReviewed,
  recordOperationalAcceptance,
  resolveOperationalDecisionRequirements,
  signOperationalAssessment,
  submitOperationalRecommendation,
} from "../e2e/support/operational-api";

test("normal shell, simple profile, real role restrictions and switching", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Switch to Assessor", exact: true })).toBeVisible();
  await expect(page.locator("[data-pipeline-demo-banner]")).toHaveCount(0);
  await page.getByRole("button", { name: "Open profile menu for Alex Morgan" }).click();
  const profile = page.getByRole("dialog", { name: "Profile settings" });
  await expect(profile.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await expect(profile).not.toContainText("God mode");
  await expect(profile).not.toContainText("Process tester");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to Assessor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Switch to Supervisor", exact: true })).toBeVisible();
  const user = (await (await page.request.get("/api/auth/me")).json()).user;
  expect(user.id).toBe("practice-assessor");
  expect(user.roles).toEqual(["reviewer", "viewer"]);
  const directory = await page.request.get("/api/profiles/directory?limit=1");
  expect(directory.status()).toBe(200);
  expect((await directory.json()).clinical_warning).toBeNull();
  const cursor = Buffer.from(JSON.stringify({ phase: "pipeline", offset: 0 })).toString("base64url");
  const pagedDirectory = await page.request.get(`/api/profiles/directory?limit=1&cursor=${cursor}`);
  expect(pagedDirectory.status()).toBe(200);
  expect((await pagedDirectory.json()).clients).toEqual((await directory.json()).clients);
  expect((await page.request.get("/api/profiles/directory?cursor=invalid")).status()).toBe(400);
  expect((await page.request.get(`/api/profiles/directory?q=${"x".repeat(201)}`)).status()).toBe(400);
  await expect(page.getByRole("button", { name: "Open reports", exact: true })).toHaveCount(0);
  expect((await page.request.get("/api/operations/reports")).status()).toBe(403);
  expect((await page.request.post("/api/auth/assessor-session", { data: { target_principal_id: "practice-supervisor" } })).status()).toBe(403);
  expect((await page.request.get("/api/referrals", { headers: { "x-pipeline-persona": "supervisor" } })).status()).toBe(409);
  expect((await page.request.post("/api/demo/persona", { data: { persona: "admin" } })).status()).toBe(400);
  expect((await page.request.post("/api/demo/persona", { data: { persona: "supervisor" }, headers: { origin: "https://example.com" } })).status()).toBe(403);
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch to Supervisor", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const switchBounds = await page.getByRole("button", { name: "Switch to Supervisor", exact: true }).boundingBox();
  expect(switchBounds!.x).toBeGreaterThanOrEqual(0);
  expect(switchBounds!.x + switchBounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("assessor-home-mobile.png") });
});

test("intake saves on switch and the assigned workspace appears for the assessor", async ({ page }, testInfo) => {
  const name = uniqueName();
  await page.goto("/");
  await page.getByRole("button", { name: "Create new referral", exact: true }).click();
  await page.getByRole("combobox", { name: "Requested community", exact: true }).selectOption("San Pablo");
  await page.getByRole("combobox", { name: "Client county", exact: true }).selectOption("Contra Costa County");
  await page.getByRole("combobox", { name: "Assessor", exact: true }).selectOption("practice-assessor");
  await page.getByRole("textbox", { name: "NAME", exact: true }).click();
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(name);
  await expect(page.getByTestId("document-checklist-panel")).not.toHaveAttribute("open");
  const packet = syntheticPdf();
  await page.getByTestId("document-checklist-toggle").click();
  await page.getByTestId("referral-documents-input").setInputFiles({ name: "practice-packet.pdf", mimeType: "application/pdf", buffer: packet });
    await confirmReferralFileLabels(page, {}, "face_sheet");
  // Do not manually save: the role switch must persist these exact pending edits.
  await page.getByRole("button", { name: "Switch to Assessor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Switch to Supervisor", exact: true })).toBeVisible();
  const listing = await (await page.request.get(`/api/referrals?workspace=all&q=${encodeURIComponent(name)}`)).json();
  expect(listing.referrals).toHaveLength(1);
  const referral = listing.referrals[0];
  expect(referral.ownerId).toBe("practice-assessor");
  expect(referral.updatedBy.id).toBe("practice-supervisor");
  const downloaded = await page.request.get(`/api/referrals/${referral.id}/packet`);
  expect(downloaded.status()).toBe(200);
  expect(await downloaded.body()).toEqual(packet);
  await expect(page.getByRole("region", { name: "Current work", exact: true })).toContainText(name);
  await page.getByRole("region", { name: "Current work", exact: true }).getByRole("button", { name: `Open ${name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}(?:&|$)`));
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(name);
  await page.getByRole("textbox", { name: "Client phone:", exact: true }).click();
  await page.getByRole("textbox", { name: "Client phone:", exact: true }).fill("555-010-0200");
  await page.getByRole("button", { name: "Switch to Supervisor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Switch to Assessor", exact: true })).toBeVisible();
  const saved = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  expect(saved.phone).toBe("555-010-0200");
  expect(saved.updatedBy.id).toBe("practice-assessor");
  await page.screenshot({ path: testInfo.outputPath("supervisor-home.png") });
});

test("failed intake save leaves the original account and typed data intact", async ({ page }) => {
  await page.goto(`/?view=referrals&screen=packet&draftId=${crypto.randomUUID()}`);
  await expect(page.getByRole("button", { name: "Switch to Assessor", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "NAME", exact: true }).click();
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill("Unsaved Practice Client");
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Unsaved Practice Client");
  await page.route("**/api/referrals", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ status: 503, json: { error: "Save unavailable" } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Switch to Assessor", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Finish saving this intake" })).toBeVisible();
  expect((await (await page.request.get("/api/auth/me")).json()).user.demoPersona).toBe("supervisor");
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Unsaved Practice Client");
});

test("same referral schedules, captures an assessment, returns to supervisor and reaches a decision", async ({ page }, testInfo) => {
  const supervisor = { id: "practice-supervisor", name: "Alex Morgan", email: "supervisor@pipeline.example", expectedRoles: ["admin"] };
  let referral = await createOperationalReferral(page.request, supervisor, {
    name: uniqueName(), owner: "Jordan Lee", county: "Contra Costa County", phone: "555-010-0200", email: "casey@example.invalid",
  }, { assigneeId: "practice-assessor" });
  referral = await markOperationalPacketReviewed(page.request, referral);
  let assessment = await createOperationalAssessment(page.request, referral.id);
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to Assessor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Switch to Supervisor", exact: true })).toBeVisible();
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  const schedule = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
  await expect(schedule).toBeVisible();
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await schedule.getByLabel("Assessment date and time").fill(`${day}T10:30`);
  await schedule.getByRole("combobox", { name: "Assessment method" }).selectOption("zoom");
  await schedule.getByRole("textbox", { name: "Zoom meeting link" }).fill("https://zoom.us/j/123456789");
  await schedule.getByRole("button", { name: "Schedule assessment", exact: true }).click();
  const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
  await expect(begin).toBeVisible();
  await begin.getByRole("button", { name: "Begin assessment", exact: true }).click();
  const guided = page.locator('[data-guided-assessment="true"]');
  await expect(guided).toBeVisible();
  await expect(guided.getByRole("button", { name: "Switch to Supervisor", exact: true })).toBeVisible();
  await guided.getByRole("button", { name: "Full assessment" }).click();
  const chart = page.locator('[data-assessment-view="chart"]');
  const answer = "Synthetic practice note entered immediately before switching accounts.";
  await chart.getByRole("textbox", { name: /Prior 5150/ }).fill(answer);
  const workspaceUrl = page.url();
  await chart.getByRole("button", { name: "Open assessment lab", exact: true }).click();
  const lab = page.getByRole("dialog", { name: "Assessment lab", exact: true });
  await lab.getByLabel("Resident name *", { exact: true }).fill("LAB-ONLY answer, do not put on referral");
  await lab.getByRole("button", { name: "History", exact: true }).click();
  await lab.getByRole("textbox", { name: /Prior 5150/ }).fill("LAB-ONLY narrative");
  await lab.getByRole("button", { name: "Back to referral", exact: true }).click();
  await expect(page).toHaveURL(workspaceUrl);
  await expect(chart.getByRole("textbox", { name: /Prior 5150/ })).toHaveValue(answer);
  await chart.getByRole("button", { name: "Switch to Supervisor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Switch to Assessor", exact: true })).toBeVisible();
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.prior_5150_5250_holds).toBe(answer);
  expect(saved.assessor_id).toBe("practice-assessor");
  expect(saved.scheduled_method).toBe("zoom");
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await guided.getByRole("button", { name: "Full assessment" }).click();
  await expect(chart.getByRole("textbox", { name: /Prior 5150/ })).toHaveValue(answer);
  await chart.getByRole("button", { name: "Switch to Assessor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Switch to Supervisor", exact: true })).toBeVisible();
  assessment = await completeOperationalAssessment(page.request, saved);
  assessment = await signOperationalAssessment(page.request, assessment);
  referral = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  referral = await submitOperationalRecommendation(page.request, referral, assessment);
  expect((await page.request.put(`/api/referrals/${referral.id}/decision`, { data: {
    if_match: referral.version, if_match_section: referral.sectionVersions.decision, outcome: "accepted", reason_code: "", reason_note: "",
  } })).status()).toBe(403);
  await page.getByRole("button", { name: "Switch to Supervisor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Switch to Assessor", exact: true })).toBeVisible();
  await resolveOperationalDecisionRequirements(page.request, referral.id);
  referral = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  await recordOperationalAcceptance(page.request, referral);
  expect((await page.request.post(`/api/referrals/${referral.id}/meet-client-email`, { data: {
    confirmed: true, client_mutation_id: crypto.randomUUID(), recipients: ["care@example.invalid"],
  } })).status()).toBe(503);
  await page.screenshot({ path: testInfo.outputPath("supervisor-decision.png") });
});

function uniqueName() {
  const suffix = Array.from(crypto.randomUUID().slice(0, 8), (character) => String.fromCharCode(97 + character.charCodeAt(0) % 26)).join("");
  return `Avery ${suffix[0].toUpperCase()}${suffix.slice(1)}`;
}

function syntheticPdf() {
  const content = `BT /F1 12 Tf 50 700 Td (Synthetic practice packet ${crypto.randomUUID()}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("a tab cannot save under an account switched in another tab", async ({ page, context }) => {
  await page.goto(`/?view=referrals&screen=packet&draftId=${crypto.randomUUID()}`);
  await expect(page.getByRole("button", { name: "Switch to Assessor", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "NAME", exact: true }).click();
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill("Unsent Practice Client");
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "Switch to Assessor", exact: true }).click();
  await expect(other.getByRole("button", { name: "Switch to Supervisor", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Switch to Assessor", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Finish saving this intake" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Unsent Practice Client");
  expect((await (await page.request.get("/api/auth/me")).json()).user.demoPersona).toBe("assessor");
  const listing = await (await page.request.get("/api/referrals?workspace=all&q=Unsent%20Practice%20Client")).json();
  expect(listing.referrals).toHaveLength(0);
});
