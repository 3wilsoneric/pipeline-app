import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createOperationalReferral } from "./support/operational-api";
import { renderMeetClientEmail } from "../../lib/notifications/meet-client-email-template";
import type { AxeResults } from "axe-core";

test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Recipient drafts require the isolated desktop workspace-state store.");

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
  await expect(email).toContainText("Review the handoff summary");
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
  await expect(composer.getByRole("button", { name: "Send email & packet", exact: true })).toBeInViewport();
  await expect(page.getByRole("region", { name: "Client medical chart", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toHaveCount(0);
  await expect(email.getByRole("button", { name: "Send email & packet", exact: true })).toBeDisabled();
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
  expect(payload.email.preview).toEqual(renderMeetClientEmail(payload.report.meetClient, user.name, "Preview — assigned when sent", payload.email.admission_packet.files.map((file: { name: string }) => file.name)));
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
  await email.getByRole("button", { name: "Manage files", exact: true }).click();
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

test("chart load failure leaves the finish tab reachable", async ({ page }) => {
  const { referral } = await referralWithAssessment(page, false);
  await page.route(`**/api/referrals/${referral.id}/assessments*`, (route) => route.fulfill({ status: 503, json: { error: "Synthetic unavailable chart" } }));
  const failedLoad = page.waitForResponse((response) => response.url().endsWith(`/api/referrals/${referral.id}/assessments`) && response.status() === 503);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  await failedLoad;
  await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Finish & send/ }).click();
  await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review the assessment first" })).toBeVisible();
});

test("unsigned packet preview and acceptance stay accessible without signing or sending", async ({ page }) => {
  const { referral, assessment } = await referralWithAssessment(page, false);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  await expect(page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Chart/ })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Finish & send/ }).click();
  await expect(page.getByRole("heading", { name: "Review the assessment first" })).toBeVisible();
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your email preview will appear here" })).toBeVisible();
  await page.getByRole("button", { name: "Close email preview", exact: true }).click();
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Decision/ }).click();
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Accept", exact: true })).toBeVisible();
  const current = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(current.signed_at).toBeNull();
  expect(current.meet_client_sent_at).toBeFalsy();
});

test("packet controls show attachments and retain explicit send confirmation and failure recovery", async ({ page }, info) => {
  const { referral } = await referralWithAssessment(page);
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async (route) => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email = { ...payload.email, example_only: false, can_send: true, configured: true, sender: "pipeline@example.invalid", eligible: true, ready: true, blockers: [], allowed_recipient_domains: ["example.invalid"],
      admission_packet: { files: [{ document_id: "synthetic-packet", name: "Synthetic referral packet.pdf", category: "admission", byte_size: 2048, ready: true }], total_bytes: 2048, ready: true, delivery_mode: "direct" } };
    await route.fulfill({ response, json: payload });
  });
  // Presentation/transport fixture only. No provider delivery occurs in this browser test.
  let sends = 0; let sentBody: Record<string, unknown> = {};
  await page.route(`**/api/referrals/${referral.id}/meet-client-email`, async (route) => {
    sends += 1; sentBody = route.request().postDataJSON();
    await route.fulfill({ status: 409, json: { error: "The assessment changed. Refresh the packet before sending." } });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  const send = page.getByRole("button", { name: "Send email & packet", exact: true });
  await expect(page.getByRole("link", { name: "Open Synthetic referral packet.pdf" })).toHaveAttribute("href", "/api/files/synthetic-packet/download");
  const recipients = page.getByRole("combobox", { name: /^To/ });
  await recipients.fill("care@example.invalid");
  await recipients.press("Enter");
  await expect(send).toBeDisabled(); expect(sends).toBe(0);
  await expect(page.getByRole("status", { name: "Email delivery status", exact: true })).toHaveText("Preview");
  await page.getByRole("checkbox", { name: /I verified/ }).check();
  await expect(send).toBeEnabled();
  await expect(page.getByRole("status", { name: "Email delivery status", exact: true })).toHaveText("Ready to send");
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
  expect(sentBody).toMatchObject({ confirmed: true, recipients: ["care@example.invalid"], if_match: expect.any(Number), client_mutation_id: expect.any(String) });
  await expect(page.getByRole("list", { name: "To recipients", exact: true })).toContainText("care@example.invalid");
  const refreshed = page.waitForResponse((response) => response.url().endsWith(`/api/referrals/${referral.id}/admission-summary`));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await refreshed;
  await expect(page.getByRole("checkbox", { name: /I verified/ })).not.toBeChecked();
  await expect(send).toBeDisabled();
  await page.unrouteAll({ behavior: "wait" });
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
  await page.reload();
  await expect(page.getByRole("status", { name: "Email delivery status", exact: true })).toHaveText("Sent");
  await expect(page.getByRole("button", { name: "Send email & packet", exact: true })).toHaveCount(0);
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
  await expect(overview).toContainText("18 on the To / Cc list");
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
