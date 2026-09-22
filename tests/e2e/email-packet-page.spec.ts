import { confirmReferralFileLabels } from "./support/referral-upload";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createOperationalReferral, recordOperationalAcceptance } from "./support/operational-api";
import { renderMeetClientEmail } from "../../lib/notifications/meet-client-email-template";
import type { AxeResults } from "axe-core";

test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Recipient drafts require the isolated desktop workspace-state store.");

async function settleHandoff(page: Page) {
  const overview = page.getByRole("region", { name: "Email and referral packet", exact: true });
  await expect(overview).toBeVisible();
  await overview.evaluate(async (element) => {
    const surface = element.closest(".pipeline-step-enter") ?? element;
    for (const animation of surface.getAnimations({ subtree: true })) {
      if (animation.effect?.getComputedTiming().iterations !== Infinity) await animation.finished;
    }
  });
}

async function referralWithAssessment(page: Page, signed = true) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Packet ${randomUUID().replaceAll(/[^a-z]/g, "")}`, community: "San Pablo", owner: "", tags: [], documentName: "", documentStatus: "Missing",
  });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: {
      current_location: 'Synthetic facility <img src=x onerror="alert(1)">', family_involvement: "Sister helps with appointments.",
      medications_at_intake: ["Synthetic recorded medication"], im_injections: "yes", im_injections_details: "Synthetic injection and recorded dose",
      injection_frequency: "Synthetic injection - every 4 weeks", last_injection: "Synthetic injection - date unknown",
      assault_history: "yes", last_assault_details: "Historical incident; no current incident described", assaults_last_two_years_count: 0,
      current_safety_measures: "Recorded support plan",
    },
  } });
  expect(created.status()).toBe(201);
  const { assessment } = await created.json();
  if (signed) expect((await page.request.post(`/api/assessments/${assessment.assessment_id}/sign`, { data: { if_match: assessment.version, client_mutation_id: randomUUID() } })).status()).toBe(200);
  const { work_items: workItems } = await (await page.request.get(`/api/referrals/${referral.id}/work-items`)).json();
  const agreement = workItems.find((item: { type: string }) => item.type === "signed_admission_agreement");
  expect(agreement).toBeDefined();
  const received = await page.request.patch(`/api/referrals/${referral.id}/work-items/${agreement.id}`, { data: {
    if_match: agreement.version, client_mutation_id: randomUUID(), patch: { status: "received", evidenceDocumentName: "Synthetic admission agreement.pdf" },
  } });
  expect(received.status()).toBe(200);
  if (signed) {
    const current = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
    await recordOperationalAcceptance(page.request, current);
  }
  return { referral, assessment };
}

for (const width of [1440, 1280, 834, 390, 320]) test(`Finish tab preserves the email URL and readable canonical preview at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  const { referral } = await referralWithAssessment(page);
  // Exercise live-mode editing independently of the isolated demo send guard.
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async (route) => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email = { ...payload.email, example_only: false, can_send: true };
    await route.fulfill({ response, json: payload });
  });
  let sends = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/meet-client-email")) sends += 1; });
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`;
  await page.goto(url);
  const email = page.getByRole("region", { name: "Email and referral packet", exact: true });
  const stages = page.getByRole("navigation", { name: "Workspace stages" });
  const finishTab = stages.getByRole("button", { name: /Finish & send/ });
  const stagePicker = stages.getByRole("combobox", { name: "Workspace view", exact: true });
  await expect(email).toBeVisible();
  if (width < 640) await expect(stagePicker.locator("option:checked")).toHaveText("Finish & send");
  else await expect(finishTab).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Chart pages" })).toHaveCount(0);
  await expect(email.getByRole("heading", { name: "Review the client summary", exact: true })).toBeVisible();
  await expect(email.getByRole("region", { name: "Medications & injections", exact: true })).toContainText("Synthetic recorded medication");
  await expect(email.getByRole("region", { name: "Behavior & safety", exact: true })).toContainText("Historical incident; no current incident described");
  await expect(email.locator("iframe")).toHaveCount(0);
  const folder = page.getByTestId("workspace-chart-folder");
  const header = page.getByTestId("workspace-folder-header");
  for (const button of await header.getByRole("button").all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  }
  expect(Math.abs((await folder.boundingBox())!.y - (await header.boundingBox())!.y - (await header.boundingBox())!.height)).toBeLessThanOrEqual(1);
  await email.getByRole("button", { name: "Preview email", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  await expect(composer).toBeVisible();
  const verification = composer.getByRole("checkbox", { name: /I verified/ });
  await expect(verification).toBeInViewport();
  await expect(composer.getByRole("button", { name: "Email draft to assessor", exact: true })).toBeInViewport();
  await expect(page.getByRole("region", { name: "Client medical chart", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toHaveCount(0);
  await expect(email.getByRole("button", { name: "Email draft to assessor", exact: true })).toBeDisabled();
  await expect(email.locator("details").filter({ hasText: "Delivery details" })).not.toHaveAttribute("open");
  const preview = page.frameLocator('iframe[title="Meet the Client email preview"]');
  await expect(preview.getByRole("heading", { name: "Meet the Client", exact: true })).toBeVisible();
  await expect(preview.locator("body")).toContainText('Synthetic facility <img src=x onerror="alert(1)">');
  await expect(preview.locator("body")).toContainText("Received; signatures still need review.");
  await expect(preview.locator("body")).toContainText("Synthetic injection - date unknown");
  await expect(preview.locator("tr").filter({ hasText: "Next injection due" })).toContainText("Not recorded; confirm");
  await expect(preview.getByRole("heading", { name: "Behavior & safety", exact: true })).toBeVisible();
  await expect(preview.locator("body")).toContainText("Historical incident; no current incident described");
  await expect(preview.locator("img, script")).toHaveCount(0);
  await expect(email.locator("iframe")).toHaveAttribute("sandbox", "");
  const response = await page.request.get(`/api/referrals/${referral.id}/admission-summary`);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const payload = await response.json();
  const { user } = await (await page.request.get("/api/auth/me")).json();
  expect(payload.email.preview).toEqual(renderMeetClientEmail(payload.report.meetClient, user.name, "Preview — assigned when sent", payload.email.admission_packet.files.map((file: { name: string }) => file.name), undefined, { demo: payload.email.example_only, packetLinkPreview: true }));
  const dataSheet = await page.request.get(`/api/referrals/${referral.id}/admission-summary?download=chart`);
  expect(dataSheet.status()).toBe(200);
  expect(await dataSheet.text()).toContain("Received; signatures still need review.");
  await expect(page.locator('[data-guide-target="packet-workspace"]')).toHaveAttribute("data-performance-ready", "packet");
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  const recipients = email.getByRole("combobox", { name: /^To/ });
  await recipients.click();
  await expect(recipients).toBeFocused();
  await recipients.fill("care@example.invalid");
  await recipients.press("Enter");
  await expect(email.getByRole("list", { name: "To recipients", exact: true })).toContainText("care@example.invalid");
  await composer.getByRole("button", { name: "Close email preview", exact: true }).click();
  await expect(email.getByRole("button", { name: "Manage files", exact: true })).toHaveCount(0);
  if (width < 640) await stagePicker.selectOption({ label: "Files" });
  else await page.getByRole("button", { name: "Workspace files", exact: true }).click();
  await expect(page).toHaveURL(/workspaceView=files/);
  if (width < 640) await stagePicker.selectOption({ label: "Chart" });
  else await stages.getByRole("button", { name: /Chart/ }).click();
  const chart = page.getByRole("article", { name: "Referral chart", exact: true });
  await expect(chart).toBeVisible();
  await expect(folder.getByRole("button", { name: "New referral", exact: true })).toHaveCount(0);
  const chartFolder = page.getByTestId("assessment-client-folder");
  expect(Math.abs((await chartFolder.boundingBox())!.y - (await header.boundingBox())!.y - (await header.boundingBox())!.height)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath(`flush-chart-${width}.png`), animations: "disabled" });
  if (width < 640) await stagePicker.selectOption({ label: "Finish & send" });
  else {
    await finishTab.focus();
    await page.keyboard.press("Enter");
  }
  await email.getByRole("button", { name: "Preview email", exact: true }).click();
  await expect(email.getByRole("list", { name: "To recipients", exact: true })).toContainText("care@example.invalid");
  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0);
  await expect(email.getByRole("button", { name: "Preview email", exact: true })).toBeFocused();
  if (width < 640) await stagePicker.selectOption({ label: "Chart" });
  else await stages.getByRole("button", { name: /Chart/ }).click();
  await expect(page).toHaveURL(/workspaceStage=chart/);
  if (width < 640) {
    await expect(stagePicker.locator("option:checked")).toHaveText("Chart");
    await stagePicker.selectOption({ label: "Finish & send" });
  } else {
    await expect(stages.getByRole("button", { name: /Chart/ })).toHaveAttribute("aria-current", "page");
    await finishTab.click();
  }
  await expect(page).toHaveURL(/workspaceView=email/);
  await expect(email).toBeVisible();
  await page.screenshot({ path: info.outputPath(`handoff-overview-${width}.png`), fullPage: false, animations: "disabled" });
  await email.getByRole("button", { name: "Preview email", exact: true }).click();
  await page.reload();
  await expect(page.locator('[data-guide-target="packet-workspace"]')).toHaveAttribute("data-performance-ready", "packet");
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  await expect(email).toBeVisible();
  await email.getByRole("button", { name: "Preview email", exact: true }).click();
  await expect(preview.getByRole("heading", { name: "Meet the Client", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await preview.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(preview.locator("li").first()).toHaveCSS("font-size", "17px");
  if (width === 1440) expect((await preview.locator(".email-sheet").boundingBox())!.width).toBeGreaterThan(1000);
  await page.getByTestId("packet-workspace").evaluate((element) => element.scrollTo({ top: 0 }));
  await page.screenshot({ path: info.outputPath(`email-packet-${width}.png`), fullPage: false, animations: "disabled" });
  expect(sends).toBe(0);
});

for (const width of [1440, 390, 320]) test(`handoff points to the next unfinished step at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width > 640 ? 768 : 850 });
  const { referral, assessment } = await referralWithAssessment(page, false);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`;
  let sends = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
  await page.goto(url);
  const readiness = page.getByRole("region", { name: "Handoff readiness", exact: true });
  const expectNextActionVisible = async (name: string) => {
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
    const action = readiness.getByRole("button", { name, exact: true });
    await expect(action).toBeInViewport({ ratio: 1 });
    const bounds = (await action.boundingBox())!;
    expect(await action.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
    })).toBe(true);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    return action;
  };
  await expect(readiness.getByRole("heading", { name: "Sign the assessment", exact: true })).toBeVisible();
  const reviewAssessment = await expectNextActionVisible("Review & sign assessment");
  await expect(readiness.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Preview email", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Manage files", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close workspace", exact: true })).toHaveCount(0);
  await expect(readiness.getByRole("button", { name: "Open decision", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settleHandoff(page);
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run('[aria-label="Email and referral packet"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
  });
  expect(violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`next-step-unsigned-${width}.png`), animations: "disabled" });
  await reviewAssessment.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/assessmentMode=review/);
  await expect(page.getByRole("region", { name: "Assessment chart review", exact: true })).toBeVisible();

  // Sign only the synthetic test record to exercise the next presentation state.
  const current = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(current.signed_at).toBeNull();
  expect((await page.request.post(`/api/assessments/${assessment.assessment_id}/sign`, { data: { if_match: current.version, client_mutation_id: randomUUID() } })).status()).toBe(200);
  await page.goto(url);
  await expect(readiness.getByRole("heading", { name: "Record the admission decision", exact: true })).toBeVisible();
  await expectNextActionVisible("Open decision");
  await expect(readiness.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Preview email", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`next-step-decision-${width}.png`), animations: "disabled" });
  await readiness.getByRole("button", { name: "Open decision", exact: true }).click();
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toBeVisible();

  // Eligibility is a presentation fixture; no admission decision or email is submitted.
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async (route) => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email.eligible = true;
    await route.fulfill({ response, json: payload });
  });
  await page.goto(url);
  await expect(readiness.getByRole("heading", { name: "Review the client summary", exact: true })).toBeVisible();
  await expectNextActionVisible("Preview email");
  await expect(readiness.getByRole("button")).toHaveCount(1);
  await expect(readiness.getByRole("button", { name: "Open decision", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`next-step-email-${width}.png`), animations: "disabled" });
  await readiness.getByRole("button", { name: "Preview email", exact: true }).click();
  await page.getByRole("button", { name: "Close email preview", exact: true }).click();
  await expect(readiness.getByRole("heading", { name: "Demo review complete", exact: true })).toBeVisible();
  await expect(readiness.getByRole("button")).toHaveCount(1);
  await expectNextActionVisible("Close workspace");
  await expect(readiness.getByRole("button", { name: "Close workspace", exact: true })).toBeFocused();
  await readiness.getByRole("button", { name: "Close workspace", exact: true }).click();
  await expect(page).not.toHaveURL(/screen=packet/);
  expect(sends).toBe(0);
});

test("chart load failure leaves the finish tab reachable", async ({ page }) => {
  const { referral } = await referralWithAssessment(page, false);
  await page.route(`**/api/referrals/${referral.id}/assessments*`, (route) => route.fulfill({ status: 503, json: { error: "Synthetic unavailable chart" } }));
  const failedLoad = page.waitForResponse((response) => response.url().endsWith(`/api/referrals/${referral.id}/assessments`) && response.status() === 503);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  await failedLoad;
  await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Finish & send/ }).click();
  await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign the assessment" })).toBeVisible();
});

test("unsigned handoff offers only assessment review while stage navigation stays available", async ({ page }) => {
  const { referral, assessment } = await referralWithAssessment(page, false);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  await expect(page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Chart/ })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Finish & send/ }).click();
  await expect(page.getByRole("heading", { name: "Sign the assessment" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview email", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Handoff readiness", exact: true }).getByRole("button")).toHaveCount(1);
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Decision/ }).click();
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Accept", exact: true })).toBeVisible();
  const current = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(current.signed_at).toBeNull();
  expect(current.meet_client_sent_at).toBeFalsy();
});

test("packet controls show attachments and retain explicit send confirmation and failure recovery", async ({ page }, info) => {
  const { referral } = await referralWithAssessment(page);
  let previewedAssessment: { assessmentId: string; assessmentVersion: number };
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async (route) => {
    const response = await route.fetch(); const payload = await response.json();
    previewedAssessment = payload.report;
    payload.email = { ...payload.email, example_only: false, can_send: true, configured: true, draft_recipient: { id: "assessor", name: "Synthetic Assessor", email: "assessor@example.invalid" }, sender: "admissions@example.invalid", eligible: true, ready: true, blockers: [], allowed_recipient_domains: ["example.invalid"],
      admission_packet: { files: [{ document_id: "synthetic-packet", name: "Synthetic referral packet.pdf", category: "admission", byte_size: 2048, ready: true }], total_bytes: 2048, ready: true, delivery_mode: "direct" } };
    await route.fulfill({ response, json: payload });
  });
  // Presentation/transport fixture only. No provider delivery occurs in this browser test.
  let sends = 0; let sentBody: Record<string, unknown> = {};
  await page.route(`**/api/referrals/${referral.id}/outlook-draft`, route => route.fulfill({ json: { draft: null, occupied: false } }));
  await page.route(`**/api/referrals/${referral.id}/meet-client-email?delivery=email_draft`, async (route) => {
    sends += 1; sentBody = route.request().postDataJSON();
    await route.fulfill({ status: 409, json: { error: "The assessment changed. Refresh the packet before sending." } });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  const send = page.getByRole("button", { name: "Email draft to assessor", exact: true });
  await expect(page.getByRole("button", { name: /^(Upload files|Review packet files)$/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Synthetic referral packet.pdf" })).toHaveAttribute("href", "/api/files/synthetic-packet/download");
  const recipients = page.getByRole("combobox", { name: /^To/ });
  await recipients.fill("care@example.invalid");
  await recipients.press("Enter");
  await expect(send).toBeDisabled(); expect(sends).toBe(0);
  await expect(page.getByRole("status", { name: "Email delivery status", exact: true })).toHaveText("Preview");
  await page.getByRole("checkbox", { name: /I verified/ }).check();
  await expect(send).toBeEnabled();
  await expect(page.getByRole("status", { name: "Email delivery status", exact: true })).toHaveText("Ready to email draft");
  await expect(page.getByText("Recipients verified", { exact: true })).toBeVisible();
  await recipients.fill("other@example.invalid");
  await recipients.press("Enter");
  await expect(page.getByRole("checkbox", { name: /I verified/ })).not.toBeChecked();
  await expect(send).toBeDisabled();
  await page.getByRole("button", { name: "Remove other@example.invalid from To", exact: true }).click();
  await page.getByRole("checkbox", { name: /I verified/ }).check();
  await page.getByTestId("packet-workspace").evaluate((element) => element.scrollTo({ top: 0 }));
  await page.screenshot({ path: info.outputPath("email-packet-with-attachments.png"), animations: "disabled" });
  await send.click();
  await expect(page.getByRole("region", { name: "Email and referral packet", exact: true }).getByRole("alert")).toContainText("Refresh the packet");
  await expect(page.getByRole("status", { name: "Email delivery status", exact: true })).not.toHaveText("Sent");
  expect(sends).toBe(1);
  expect(sentBody).toMatchObject({ confirmed: true, recipients: ["care@example.invalid"], if_match: expect.any(Number), assessment_id: previewedAssessment!.assessmentId, if_match_assessment: previewedAssessment!.assessmentVersion, client_mutation_id: expect.any(String) });
  await expect(page.getByRole("list", { name: "To recipients", exact: true })).toContainText("care@example.invalid");
  const refreshed = page.waitForResponse((response) => response.url().endsWith(`/api/referrals/${referral.id}/admission-summary`));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await refreshed;
  await expect(page.getByRole("checkbox", { name: /I verified/ })).not.toBeChecked();
  await expect(send).toBeDisabled();
  await page.unrouteAll({ behavior: "wait" });
});

test("missing packet is repaired from email review, without a general files action", async ({ page }) => {
  const { referral } = await referralWithAssessment(page);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  const overview = page.getByRole("region", { name: "Email and referral packet", exact: true });
  await expect(overview.getByRole("button", { name: "Preview email", exact: true })).toBeVisible();
  await expect(overview.getByRole("button")).toHaveCount(1);
  await overview.getByRole("button", { name: "Preview email", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  await expect(composer.getByRole("link", { name: "Open Client data sheet.html", exact: true })).toBeVisible();
  await composer.getByRole("button", { name: "Upload files", exact: true }).click();
  await expect(page).toHaveURL(/workspaceView=files/);
  await expect(composer).toHaveCount(0);
});

test("a recorded send remains distinct from preview after reopening", async ({ page }) => {
  const { referral } = await referralWithAssessment(page);
  const original = await (await page.request.get(`/api/referrals/${referral.id}/admission-summary`)).json();
  expect(original.email.sent_at).toBeNull();
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async (route) => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email = { ...payload.email, example_only: false, sent_at: "2026-09-19T12:00:00.000Z" };
    await route.fulfill({ response, json: payload });
  });
  let sends = 0;
  page.on("request", (request) => { if (request.url().endsWith("/meet-client-email")) sends++; });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await expect(page.getByRole("status", { name: "Email delivery status", exact: true })).toHaveText("Sent");
  await expect(page.getByRole("heading", { name: "Handoff sent", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close workspace", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("status", { name: "Email delivery status", exact: true })).toHaveText("Sent");
  await expect(page.getByRole("button", { name: "Email draft to assessor", exact: true })).toHaveCount(0);
  await page.locator("summary").filter({ hasText: "Review email again" }).click();
  await page.getByRole("button", { name: "View email", exact: true }).click();
  await expect(page.getByRole("combobox", { name: /^To/ })).toBeDisabled();
  expect(sends).toBe(0);
});

test("draft recovery blocks entry until ready, then refreshing preserves handoff recipients", async ({ page }) => {
  const { referral } = await referralWithAssessment(page);
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async (route) => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email = { ...payload.email, example_only: false, can_send: true };
    await route.fulfill({ response, json: payload });
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/referrals/${referral.id}/canvas`, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  const recipients = page.getByRole("combobox", { name: /^To/ });
  try {
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("inert", "");
  } finally { release(); }
  await expect(page.locator('[data-guide-target="packet-workspace"]')).toHaveAttribute("data-performance-ready", "packet");
  await expect(page.getByTestId("packet-workspace")).not.toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  await recipients.fill("care@example.invalid");
  await recipients.press("Enter");
  await expect(page.getByRole("list", { name: "To recipients", exact: true })).toContainText("care@example.invalid");
  const refreshed = page.waitForResponse((response) => response.url().endsWith(`/api/referrals/${referral.id}/admission-summary`));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await refreshed;
  await expect(page.getByRole("list", { name: "To recipients", exact: true })).toContainText("care@example.invalid");
});

for (const width of [1440, 390]) test(`handoff stays readable with a full recipient list at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 850 });
  const { referral } = await referralWithAssessment(page);
  const to = Array.from({ length: 18 }, (_, index) => ({ name: `Example staff ${index + 1}`, email: `staff${index + 1}@example.invalid` }));
  await page.route("**/api/community-recipient-lists", (route) => route.fulfill({ json: { lists: [{ community: "San Pablo", to, cc: [], version: 1, sourceDates: [], updatedAt: null }] } }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  const overview = page.getByRole("region", { name: "Email and referral packet", exact: true });
  await settleHandoff(page);
  await expect(overview.getByRole("button", { name: "Manage files", exact: true })).toHaveCount(0);
  await expect(overview.locator("iframe")).toHaveCount(0);
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const checkA11y = (selector: string) => page.evaluate(async (scope) => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run(scope, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
  }, selector);
  expect(await checkA11y('[aria-label="Email and referral packet"]')).toEqual([]);
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  await modal.evaluate(async (element) => { for (const animation of element.getAnimations({ subtree: true })) await animation.finished; });
  await expect(modal.getByRole("list", { name: "To recipients", exact: true }).locator("li")).toHaveCount(18);
  await expect(modal.getByRole("button", { name: "Close email preview", exact: true })).toBeInViewport();
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await checkA11y('dialog[aria-label="Meet the Client email"]')).toEqual([]);
  await page.screenshot({ path: info.outputPath(`large-recipient-list-${width}.png`), animations: "disabled" });
});

for (const width of [1440, 390]) test(`review shows the record and opens an unresolved section at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const { referral, assessment } = await referralWithAssessment(page, false);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
  const review = page.getByRole("region", { name: "Assessment chart review", exact: true });
  await expect(review.getByRole("heading", { name: "Review assessment", exact: true })).toBeVisible();
  await expect(review).toContainText("Recorded answers");
  await expect(page.getByRole("button", { name: "Sign & continue to decision", exact: true })).toBeInViewport();
  const gaps = review.locator("details");
  await gaps.locator("summary").click();
  await expect(gaps).toContainText("They do not prevent signing");
  await page.screenshot({ path: info.outputPath(`review-gaps-${width}.png`), animations: "disabled" });
  await gaps.getByRole("button").first().click();
  await expect(page).not.toHaveURL(/assessmentMode=review/);
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.signed_at).toBeNull();
  expect(saved.medications_at_intake).toEqual(["Synthetic recorded medication"]);
});

for (const width of [390, 834]) test(`demo admission packet includes every uploaded file and its message at ${width}px`, async ({ page }, info) => {
  const { referral } = await referralWithAssessment(page);
  await page.setViewportSize({ width, height: 900 });
  const uploaded = ["Admission note.txt", "Assessment notes.txt", "Medication list.txt"];
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=files`);
  await page.getByLabel("Choose referral documents", { exact: true }).setInputFiles(uploaded.map((name) => ({ name, mimeType: "text/plain", buffer: Buffer.from(`Synthetic ${name}`) })));
  await confirmReferralFileLabels(page, { "Admission note.txt": "referral_packet", "Assessment notes.txt": "assessment", "Medication list.txt": "medication_list" });
  await expect.poll(async () => {
    const response = await page.request.get(`/api/referrals/${referral.id}/admission-summary`);
    const payload = await response.json();
    return payload.email.admission_packet.files.filter((file: { generated: boolean }) => !file.generated).map((file: { name: string }) => file.name).sort();
  }).toEqual([...uploaded].sort());
  const payload = await (await page.request.get(`/api/referrals/${referral.id}/admission-summary`)).json();
  expect(payload.email).toMatchObject({ example_only: true, ready: false, can_send: false });
  expect(payload.email.admission_packet.files).toHaveLength(4);
  expect(payload.email.preview.subject).toMatch(/^\[DEMO\]/);
  for (const name of uploaded) expect(payload.email.preview.html).toContain(name);
  let attempts = 0;
  page.on("request", (request) => { if (request.url().endsWith("/meet-client-email")) attempts++; });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await expect(page.getByRole("status").filter({ hasText: "Not production yet" })).toBeVisible();
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  await expect(composer.getByRole("status").filter({ hasText: "Not production yet" })).toBeInViewport();
  const attachments = composer.getByRole("region", { name: "Referral packet attachments", exact: true });
  await expect(attachments.getByRole("heading", { name: "Admission packet", exact: true })).toBeVisible();
  for (const name of uploaded) await expect(attachments.getByRole("link", { name: `Open ${name}`, exact: true })).toBeVisible();
  await expect(attachments.getByRole("link")).toHaveCount(4);
  const preview = page.frameLocator('iframe[title="Meet the Client email preview"]');
  await expect(preview.getByText("Not production yet — no email will be sent. This admission packet is a demo.", { exact: true })).toBeVisible();
  await expect(preview.getByText("Hello team,", { exact: true })).toBeVisible();
  await expect(composer.getByRole("button", { name: "Email draft to assessor", exact: true })).toBeDisabled();
  await expect(composer.getByRole("button", { name: "Close email preview", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`demo-admission-packet-${width}.png`), animations: "disabled" });
  await composer.getByRole("button", { name: "Close email preview", exact: true }).click();
  expect(attempts).toBe(0);
});

for (const width of [1440, 834, 390]) test(`Assessor draft clearly remains nonproduction at ${width}px`, async ({ page }, info) => {
  const { referral } = await referralWithAssessment(page);
  await page.setViewportSize({ width, height: 900 });
  let writes = 0;
  page.on("request", request => { if (request.method() === "POST" && /outlook-draft|meet-client-email/.test(request.url())) writes++; });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await settleHandoff(page);
  await expect(page.getByRole("status").filter({ hasText: "Not production yet" })).toBeVisible();
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  const outlook = composer.getByRole("region", { name: "Email draft to assessor" });
  await expect(outlook.getByText("Not production yet", { exact: true })).toBeVisible();
  await expect(outlook.getByRole("button", { name: "Email draft to assessor", exact: true })).toBeDisabled();
  await expect(outlook.getByRole("button", { name: "Email draft to assessor", exact: true })).toBeInViewport();
  await expect(outlook).toContainText("no email will be sent");
  await expect(composer.getByRole("button", { name: "Close email preview", exact: true })).toBeInViewport();
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => (await (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe.run('dialog[aria-label="Meet the Client email"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target }) => target) })));
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`outlook-nonproduction-${width}.png`), animations: "disabled" });
  expect(writes).toBe(0);
});

for (const width of [834, 390]) test(`saved Outlook draft reopens without offering a second handoff at ${width}px`, async ({ page }, info) => {
  const { referral } = await referralWithAssessment(page);
  await page.setViewportSize({ width, height: 900 });
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async route => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email = { ...payload.email, example_only: false, can_send: true };
    await route.fulfill({ response, json: payload });
  });
  await page.route(`**/api/referrals/${referral.id}/outlook-draft`, route => route.fulfill({ json: { occupied: false, draft: {
    packet_id: randomUUID(), status: "draft", mailbox: "assessor@example.invalid", web_link: "https://outlook.office.com/mail/drafts/fixture",
    prepared_at: "2026-09-21T00:00:00Z", assessment_version: 2, file_count: 1,
  } } }));
  let sent = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("meet-client-email")) sent++; });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  const outlook = composer.getByRole("region", { name: "Outlook handoff" });
  await expect(outlook.getByRole("heading", { name: "Your Outlook draft" })).toBeVisible();
  await expect(composer.getByRole("button", { name: "Pipeline", exact: true })).toHaveCount(0);
  await expect(composer.getByRole("button", { name: "Email draft to assessor", exact: true })).toHaveCount(0);
  await expect(outlook.getByRole("link", { name: "Reopen draft" })).toHaveAttribute("href", "https://outlook.office.com/mail/drafts/fixture");
  await expect(outlook).toContainText("not sent");
  await outlook.getByRole("button", { name: "Remove draft", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Remove this Outlook draft?" });
  await expect(confirmation).toBeVisible();
  const bounds = (await confirmation.boundingBox())!;
  expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThan(3);
  await page.screenshot({ path: info.outputPath(`outlook-existing-draft-${width}.png`), animations: "disabled" });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(sent).toBe(0);
});
