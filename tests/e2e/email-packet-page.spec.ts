import { readPdfText } from "./support/pdf";
import { openAdmitDate, openSummary, openFiles, openRecipients, confirmRecipients } from "./support/handoff-review";
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

async function addRecipient(page: Page, address = "care@example.invalid") {
  const field = page.getByRole("combobox", { name: /^To/ });
  await field.fill(address); await field.press("Enter");
  await expect(page.getByRole("list", { name: "To recipients", exact: true })).toContainText(address);
}
async function openPreview(page: Page) {
  await openRecipients(page); await addRecipient(page); return confirmRecipients(page);
}
async function checkA11y(page: Page, selector: string) {
  await page.locator(selector).evaluate(async element => {
    for (const animation of element.getAnimations({ subtree: true })) {
      if (animation.effect?.getComputedTiming().iterations !== Infinity) await animation.finished;
    }
  });
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async scope => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run(scope, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
  }, selector);
}

test("admit date retries a lost save response without duplicating the change", async ({ page }) => {
  const { referral } = await referralWithAssessment(page);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`;
  const mutationIds: string[] = [];
  let savedVersion = 0;
  await page.route(`**/api/referrals/${referral.id}`, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    mutationIds.push(route.request().postDataJSON().client_mutation_id);
    if (mutationIds.length > 1) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    savedVersion = (await response.json()).referral.version;
    await route.abort("failed");
  });
  await page.goto(url);
  const dialog = await openAdmitDate(page);
  await expect(dialog.getByRole("button", { name: "Confirm admit date", exact: true })).toBeDisabled();
  await dialog.getByLabel("Planned admit date", { exact: true }).fill("2026-10-02");
  await dialog.getByRole("button", { name: "Confirm admit date", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Check client summary", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Confirm admit date", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Check client summary", exact: true })).toBeVisible();
  expect(mutationIds).toHaveLength(2); expect(mutationIds[1]).toBe(mutationIds[0]);
  const saved = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  expect(saved.version).toBe(savedVersion); expect(saved.plannedAdmissionDate).toBe("2026-10-02");
  await page.reload();
  await openAdmitDate(page);
  await expect(page.getByLabel("Planned admit date", { exact: true })).toHaveValue("2026-10-02");
});

test("a changed admit date must be reloaded and the confirmed date populates the email", async ({ page }) => {
  const { referral } = await referralWithAssessment(page);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  const dialog = await openAdmitDate(page);
  await dialog.getByLabel("Planned admit date", { exact: true }).fill("2026-10-03");
  const current = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  const externalSave = await page.request.patch(`/api/referrals/${referral.id}`, { data: {
    if_match: current.version, if_match_sections: { intake: current.sectionVersions.intake }, client_mutation_id: randomUUID(), patch: { plannedAdmissionDate: "2026-10-04" },
  } });
  expect(externalSave.status()).toBe(200);
  await dialog.getByRole("button", { name: "Confirm admit date", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirm admit date", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Reload saved date", exact: true }).click();
  const date = await openAdmitDate(page);
  await expect(date.getByLabel("Planned admit date", { exact: true })).toHaveValue("2026-10-04");
  await date.getByRole("button", { name: "Confirm admit date", exact: true }).click();
  const summary = page.getByRole("dialog", { name: "Check client summary", exact: true });
  await summary.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByLabel("Planned admit date", { exact: true }).fill("2026-10-05");
  await page.getByRole("button", { name: "Confirm admit date", exact: true }).click();
  await page.getByRole("button", { name: "Confirm summary", exact: true }).click();
  await page.getByRole("button", { name: "Confirm packet", exact: true }).click();
  await addRecipient(page); await confirmRecipients(page);
  const email = page.frameLocator('iframe[title="Meet the Client email preview"]').locator("body");
  await expect(email).toContainText("2026-10-05"); await expect(email).not.toContainText("2026-10-04");
});

test("Decision requires an admit date and carries it into the first handoff check", async ({ page }) => {
  const { referral } = await referralWithAssessment(page);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const button = page.getByRole("button", { name: "Review email & packet", exact: true });
  await expect(button).toBeDisabled();
  await page.getByLabel("Planned admission date", { exact: true }).fill("2026-10-06");
  await button.click();
  await openAdmitDate(page);
  await expect(page.getByLabel("Planned admit date", { exact: true })).toHaveValue("2026-10-06");
});

for (const width of [1440, 1280, 834, 390, 320]) test(`guided checks lead to the branded email at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const { referral } = await referralWithAssessment(page);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`;
  let writes = 0;
  page.on("request", request => { if (request.method() === "POST" && /outlook-draft|meet-client-email/.test(request.url())) writes++; });
  await page.goto(url); await settleHandoff(page);
  const overview = page.getByRole("region", { name: "Handoff readiness", exact: true });
  await expect(overview.getByRole("button")).toHaveCount(1);
  await expect(overview.getByRole("button", { name: "Review handoff", exact: true })).toBeInViewport();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preview email", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`guided-start-${width}.png`), animations: "disabled" });
  const date = await openAdmitDate(page);
  await expect(date.getByRole("button", { name: "Confirm admit date", exact: true })).toBeDisabled();
  expect(await checkA11y(page, 'dialog[aria-label="Confirm admit date"]')).toEqual([]);
  expect(await date.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`guided-date-${width}.png`), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(overview).not.toContainText("Checked");
  const summary = await openSummary(page);
  await expect(summary.getByRole("region", { name: "Medications & injections" })).toContainText("Synthetic recorded medication");
  await expect(summary.getByRole("region", { name: "Behavior & safety" })).toContainText("Historical incident");
  await expect(summary.getByRole("button", { name: "Confirm summary", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(summary).toHaveCount(0);
  await expect(overview.getByRole("button", { name: "Continue review", exact: true })).toBeFocused();
  await page.reload(); await settleHandoff(page);
  const files = await openFiles(page);
  await expect(files.getByRole("link", { name: "Open Client data sheet.pdf", exact: true })).toHaveAttribute("href", `/api/referrals/${referral.id}/admission-summary?download=chart`);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(files.getByRole("button", { name: "Confirm packet", exact: true })).toBeInViewport();
  await files.getByRole("button", { name: "Confirm packet", exact: true }).click();
  const recipients = page.getByRole("dialog", { name: "Check recipients", exact: true });
  await expect(recipients.getByRole("button", { name: "Preview email", exact: true })).toBeDisabled();
  await addRecipient(page);
  await expect(recipients.getByRole("button", { name: "Preview email", exact: true })).toBeDisabled();
  const composer = await confirmRecipients(page);
  await expect(composer.getByRole("combobox")).toHaveCount(0);
  await expect(composer.getByRole("region", { name: "Referral packet attachments" })).toHaveCount(0);
  await expect(composer.getByRole("button", { name: "Finish demo review", exact: true })).toBeInViewport();
  await expect(composer.getByRole("button", { name: "Save to Outlook Drafts", exact: true })).toHaveCount(0);
  await expect(composer.locator("iframe")).toHaveAttribute("sandbox", "");
  const preview = page.frameLocator('iframe[title="Meet the Client email preview"]');
  await expect(preview.getByRole("img", { name: "Alamo Health Management", exact: true })).toBeVisible();
  await expect.poll(() => preview.getByRole("img", { name: "Alamo Health Management", exact: true }).evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
  await expect(preview.locator("body")).not.toContainText("Pipeline");
  await expect(preview.locator("body")).not.toContainText("one-time code");
  await expect(preview.locator("body")).not.toContainText("secure packet");
  await expect(preview.locator("body")).toContainText("Client data sheet.pdf");
  await expect(preview.locator("body")).toContainText("2026-10-01");
  await expect(preview.locator("body")).toContainText('Synthetic facility <img src=x onerror="alert(1)">');
  await expect(preview.locator("body")).toContainText("Received; signatures still need review.");
  await expect(preview.locator("img")).toHaveCount(1);
  await expect(preview.locator("script, [onerror]")).toHaveCount(0);
  expect(await composer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await checkA11y(page, 'dialog[aria-label="Meet the Client email"]')).toEqual([]);
  await page.screenshot({ path: info.outputPath(`guided-email-${width}.png`), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0);
  await expect(overview.getByRole("button", { name: "Preview email", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Demo review complete", exact: true })).toHaveCount(0);
  await overview.getByRole("button", { name: "Preview email", exact: true }).click();
  await composer.getByRole("button", { name: "Finish demo review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Demo review complete", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close workspace", exact: true })).toBeFocused();
  expect(writes).toBe(0);
  await page.reload();
  await openRecipients(page);
  await expect(page.getByRole("list", { name: "To recipients", exact: true })).toContainText("care@example.invalid");
  await expect(page.getByRole("checkbox", { name: /I verified/ })).not.toBeChecked();
  await page.keyboard.press("Escape");
  const stages = page.getByRole("navigation", { name: "Workspace stages" });
  if (width < 640) await stages.getByRole("combobox", { name: "Workspace view" }).selectOption({ label: "Chart" });
  else await stages.getByRole("button", { name: /Chart/ }).click();
  await expect(page).toHaveURL(/workspaceStage=chart/);
  await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
  const response = await page.request.get(`/api/referrals/${referral.id}/admission-summary`);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const payload = await response.json();
  const { user } = await (await page.request.get("/api/auth/me")).json();
  expect(payload.email.preview).toEqual(renderMeetClientEmail(payload.report.meetClient, user.name, "Preview — assigned when sent", payload.email.admission_packet.files.map((file: { name: string }) => file.name), undefined, { demo: payload.email.example_only }));
  const dataSheet = await page.request.get(`/api/referrals/${referral.id}/admission-summary?download=chart`);
  expect(dataSheet.status()).toBe(200);
  expect(dataSheet.headers()["content-type"]).toBe("application/pdf");
  expect(await readPdfText(await dataSheet.body())).toContain("Received; signatures still need review.");
});

for (const width of [1440, 834, 390]) test(`unsigned and undecided records retain one next action at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const { referral, assessment } = await referralWithAssessment(page, false);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`;
  await page.goto(url);
  const readiness = page.getByRole("region", { name: "Handoff readiness", exact: true });
  await expect(readiness.getByRole("button")).toHaveCount(1);
  await expect(readiness.getByRole("button", { name: "Review & sign assessment", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Preview email", exact: true })).toHaveCount(0);
  await readiness.getByRole("button", { name: "Review & sign assessment", exact: true }).click();
  await expect(page).toHaveURL(/assessmentMode=review/);
  const current = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(current.signed_at).toBeNull();
  expect((await page.request.post(`/api/assessments/${assessment.assessment_id}/sign`, { data: { if_match: current.version, client_mutation_id: randomUUID() } })).status()).toBe(200);
  await page.goto(url);
  await expect(readiness.getByRole("button")).toHaveCount(1);
  await expect(readiness.getByRole("button", { name: "Open decision", exact: true })).toBeInViewport();
  await readiness.getByRole("button", { name: "Open decision", exact: true }).click();
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toBeVisible();
});

test("recipient changes clear authorization and preview edits persist without changing recipients", async ({ page }) => {
  const { referral } = await referralWithAssessment(page);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await openRecipients(page); await addRecipient(page);
  const verified = page.getByRole("checkbox", { name: /I verified/ });
  await verified.check(); await addRecipient(page, "other@example.invalid");
  await expect(verified).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Preview email", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Remove other@example.invalid from To", exact: true }).click();
  const composer = await confirmRecipients(page);
  await composer.getByRole("button", { name: "Edit message", exact: true }).click();
  await composer.getByRole("textbox", { name: "Subject", exact: true }).fill("Demo arrival coordination");
  await composer.getByRole("textbox", { name: "Meet the Client message", exact: true }).fill("Hello team,\nPlease prepare a quiet welcome. Synthetic example only.");
  await composer.getByRole("button", { name: "Back to email preview", exact: true }).click();
  await expect(page.frameLocator('iframe[title="Meet the Client email preview"]').locator("body")).toContainText("Please prepare a quiet welcome.");
  await composer.getByRole("button", { name: "Back", exact: true }).click();
  await expect(verified).toBeChecked();
  await expect(page.getByRole("list", { name: "To recipients", exact: true })).toContainText("care@example.invalid");
  await page.keyboard.press("Escape"); await page.reload();
  await openRecipients(page); await expect(verified).not.toBeChecked();
  const reopened = await confirmRecipients(page);
  await expect(reopened.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Demo arrival coordination");
  await expect(page.frameLocator('iframe[title="Meet the Client email preview"]').locator("body")).toContainText("Please prepare a quiet welcome.");
});

test("packet changes and assessment corrections return to their existing workspace views", async ({ page }) => {
  const { referral } = await referralWithAssessment(page);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`;
  await page.goto(url); const files = await openFiles(page);
  await expect(files.getByRole("link", { name: "Open Client data sheet.pdf", exact: true })).toBeVisible();
  await files.getByRole("button", { name: "Change packet files", exact: true }).click();
  await expect(page).toHaveURL(/workspaceView=files/); await expect(files).toHaveCount(0);
  await page.goto(url); const summary = await openSummary(page);
  await summary.getByRole("button", { name: "Correct the assessment", exact: true }).click();
  await expect(page).toHaveURL(/assessmentMode=review/); await expect(summary).toHaveCount(0);
});

test("a recorded send remains read-only and distinct from a demo review after reopening", async ({ page }) => {
  const { referral } = await referralWithAssessment(page);
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async route => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email = { ...payload.email, example_only: false, sent_at: "2026-09-19T12:00:00.000Z" };
    await route.fulfill({ response, json: payload });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await expect(page.getByRole("status", { name: "Email delivery status", exact: true })).toHaveText("Sent");
  await page.reload(); await expect(page.getByRole("heading", { name: "Handoff sent", exact: true })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Review email again" }).click();
  await page.getByRole("button", { name: "View email", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  await expect(composer.getByRole("combobox")).toHaveCount(0);
  await expect(composer.getByRole("textbox", { name: "Subject" })).toHaveAttribute("readonly", "");
  await expect(composer.getByRole("button", { name: "Save to Outlook Drafts", exact: true })).toHaveCount(0);
  await expect(composer.getByRole("button", { name: "Edit message", exact: true })).toHaveCount(0);
});

for (const width of [1440, 390]) test(`recipient check remains readable with a full list at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 850 });
  const { referral } = await referralWithAssessment(page);
  const to = Array.from({ length: 18 }, (_, index) => ({ name: `Example staff ${index + 1}`, email: `staff${index + 1}@example.invalid` }));
  await page.route("**/api/community-recipient-lists", route => route.fulfill({ json: { lists: [{ community: "San Pablo", to, cc: [], version: 1, sourceDates: [], updatedAt: null }] } }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  const dialog = await openRecipients(page);
  await expect(dialog.getByRole("list", { name: "To recipients", exact: true }).locator("li")).toHaveCount(18);
  await expect(dialog.getByRole("button", { name: "Preview email", exact: true })).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Close handoff review", exact: true })).toBeInViewport();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await checkA11y(page, 'dialog[aria-label="Check recipients"]')).toEqual([]);
  await page.screenshot({ path: info.outputPath(`guided-recipients-${width}.png`), animations: "disabled" });
});
for (const width of [1440, 390]) test(`review shows the record and opens an unresolved section at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const { referral, assessment } = await referralWithAssessment(page, false);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
  const review = page.getByRole("region", { name: "Assessment chart review", exact: true });
  await expect(review.getByRole("heading", { name: "Review assessment", exact: true })).toBeVisible();
  await expect(review).toContainText("Recorded answers");
  await expect(page.getByRole("button", { name: "Sign & continue to decision", exact: true })).toBeInViewport();
  await expect(review).toContainText("They do not prevent signing");
  const gaps = review.getByRole("list", { name: "Answers by section", exact: true });
  await page.screenshot({ path: info.outputPath(`review-gaps-${width}.png`), animations: "disabled" });
  await gaps.getByRole("button").first().click();
  await expect(page).not.toHaveURL(/assessmentMode=review/);
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.signed_at).toBeNull();
  expect(saved.medications_at_intake).toEqual(["Synthetic recorded medication"]);
});

for (const width of [390, 834]) test(`packet check includes every uploaded file before email preview at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const { referral } = await referralWithAssessment(page);
  const uploaded = ["Admission note.txt", "Assessment notes.txt", "Medication list.txt"];
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=files`);
  await page.getByLabel("Choose referral documents", { exact: true }).setInputFiles(uploaded.map(name => ({ name, mimeType: "text/plain", buffer: Buffer.from(`Synthetic ${name}`) })));
  await confirmReferralFileLabels(page, { "Admission note.txt": "referral_packet", "Assessment notes.txt": "assessment", "Medication list.txt": "medication_list" });
  await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referral.id}/admission-summary`)).json()).email.admission_packet.files.filter((file: { generated: boolean }) => !file.generated).map((file: { name: string }) => file.name).sort()).toEqual([...uploaded].sort());
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  const dialog = await openFiles(page);
  for (const name of uploaded) await expect(dialog.getByRole("link", { name: `Open ${name}`, exact: true })).toBeVisible();
  await expect(dialog.getByRole("link")).toHaveCount(4);
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`guided-packet-${width}.png`), animations: "disabled" });
  await dialog.getByRole("button", { name: "Confirm packet", exact: true }).click();
  await addRecipient(page); await confirmRecipients(page);
  const body = page.frameLocator('iframe[title="Meet the Client email preview"]').locator("body");
  for (const name of ["Client data sheet.pdf", ...uploaded]) await expect(body).toContainText(name);
  await expect(body).not.toContainText("one-time code");
  await expect(body).not.toContainText("secure packet");
  await expect(body).toContainText("Not production yet — no email will be sent.");
});

for (const width of [834, 390]) test(`saved Outlook draft retains its frozen audience and recovery at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const { referral } = await referralWithAssessment(page);
  const draft = { packet_id: randomUUID(), status: "draft", mailbox: "assessor@example.invalid", web_link: "https://outlook.office.com/mail/drafts/fixture",
    prepared_at: "2026-09-21T00:00:00Z", assessment_version: 2, file_count: 1, to_recipients: ["reviewed@example.invalid"], cc_recipients: [] };
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async route => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email = { ...payload.email, example_only: false, can_send: true, outlook_draft: draft };
    await route.fulfill({ response, json: payload });
  });
  await page.route(`**/api/referrals/${referral.id}/outlook-draft`, route => route.fulfill({ json: { occupied: false, outlook_client_id: "00000000-0000-4000-8000-000000000001", draft } }));
  let sent = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("meet-client-email")) sent++; });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await page.getByRole("button", { name: "Continue with Outlook draft", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  await expect(composer).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Confirm admit date", exact: true })).toHaveCount(0);
  await composer.getByRole("button", { name: "Use Outlook Drafts instead", exact: true }).click();
  const outlook = composer.getByRole("region", { name: "Outlook handoff" });
  await expect(outlook.getByRole("heading", { name: "Your Outlook draft" })).toBeVisible();
  await expect(composer.getByRole("region", { name: "Prepared handoff details" })).toContainText("reviewed@example.invalid");
  await expect(composer.getByRole("button", { name: "Save to Outlook Drafts", exact: true })).toHaveCount(0);
  await expect(outlook.getByRole("link", { name: "Reopen draft" })).toHaveAttribute("href", "https://outlook.office.com/mail/drafts/fixture");
  await outlook.getByRole("button", { name: "Remove draft", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Remove this Outlook draft?" });
  await expect(confirmation).toBeVisible();
  const bounds = (await confirmation.boundingBox())!;
  expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThan(3);
  await page.screenshot({ path: info.outputPath(`outlook-existing-draft-${width}.png`), animations: "disabled" });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click(); expect(sent).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "Continue with Outlook draft", exact: true }).click();
  await expect(page.getByRole("region", { name: "Prepared handoff details" })).toContainText("reviewed@example.invalid");
  expect(sent).toBe(0);
});

test("chart load failure leaves the finish tab and its next action reachable", async ({ page }) => {
  const { referral } = await referralWithAssessment(page, false);
  await page.route(`**/api/referrals/${referral.id}/assessments*`, route => route.fulfill({ status: 503, json: { error: "Synthetic unavailable chart" } }));
  const failure = page.waitForResponse(response => response.url().endsWith(`/api/referrals/${referral.id}/assessments`) && response.status() === 503);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`); await failure;
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Finish & send/ }).click();
  await expect(page.getByRole("heading", { name: "Sign the assessment", exact: true })).toBeVisible();
});

test("workspace recovery blocks entry and refreshing requires checks without losing recipients", async ({ page }) => {
  const { referral } = await referralWithAssessment(page);
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async route => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email = { ...payload.email, example_only: false, can_send: true };
    await route.fulfill({ response, json: payload });
  });
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/referrals/${referral.id}/canvas`, async route => { await gate; await route.continue(); });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  try { await expect(page.getByTestId("packet-workspace")).toHaveAttribute("inert", ""); } finally { release(); }
  await expect(page.getByTestId("packet-workspace")).not.toHaveAttribute("inert", "");
  const composer = await openPreview(page);
  await composer.locator("summary").filter({ hasText: "Delivery details" }).click();
  const refreshed = page.waitForResponse(response => response.url().endsWith(`/api/referrals/${referral.id}/admission-summary`));
  await composer.getByRole("button", { name: "Refresh", exact: true }).click(); await refreshed;
  await expect(composer).toHaveCount(0);
  await openRecipients(page);
  await expect(page.getByRole("list", { name: "To recipients", exact: true })).toContainText("care@example.invalid");
  await expect(page.getByRole("checkbox", { name: /I verified/ })).not.toBeChecked();
});

for (const width of [1440, 390]) test(`Outlook readiness explains a missing upload beside the action at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const { referral } = await referralWithAssessment(page);
  // Exercise real attachment readiness, with only the demo presentation flag overridden.
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async route => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email = { ...payload.email, example_only: false, can_send: true };
    await route.fulfill({ response, json: payload });
  });
  await page.route(`**/api/referrals/${referral.id}/outlook-draft`, route => route.fulfill({ json: { occupied: false, draft: null } }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  const composer = await openPreview(page);
  await composer.getByRole("button", { name: "Use Outlook Drafts instead", exact: true }).click();
  const outlook = composer.getByRole("region", { name: "Outlook handoff" });
  await expect(outlook.getByText("Upload at least one file to this workspace before sending the admission packet.", { exact: true })).toBeVisible();
  await expect(outlook).not.toContainText("Finish the email review and verify recipients");
  await expect(outlook).not.toContainText("Go back to recipients");
  expect(await outlook.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await checkA11y(page, 'section[aria-label="Outlook handoff"]')).toEqual([]);
  await outlook.getByText("Upload at least one file to this workspace before sending the admission packet.", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`outlook-readiness-${width}.png`), animations: "disabled" });
});

test.describe("assessor inbox delivery", () => {
  // Network responses below are synthetic; service workers must not bypass the route fixtures.
  test.use({ serviceWorkers: "block" });
for (const width of [1440, 834, 390]) test(`email packet to assessor: clear next step, reload and forwarding confirmation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const { referral, assessment } = await referralWithAssessment(page);
  let draft: Record<string, unknown> | null = null;
  let sends = 0;
  let outlookConnects = 0;
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async route => {
    const response = await route.fetch(); const payload = await response.json();
    payload.email = { ...payload.email, example_only: false, can_send: true, ready: true, blockers: [], outlook_draft: draft };
    await route.fulfill({ json: payload });
  });
  await page.route(`**/api/referrals/${referral.id}/outlook-draft`, async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "connect") outlookConnects++;
      expect(body.action).toBe("forwarded"); expect(body.confirmed).toBe(true);
      draft = { ...draft, status: "sent" };
    }
    await route.fulfill({ json: { draft, occupied: false, account_email: "assessor@example.invalid", email_configured: true, email_sender: "admissions@alamo-pipeline.com" } });
  });
  await page.route(`**/api/referrals/${referral.id}/meet-client-email?delivery=assessor`, async route => {
    sends++;
    expect(route.request().headers()["x-pipeline-outlook-token"]).toBeUndefined();
    const body = route.request().postDataJSON();
    expect(body.recipients).toContain("care@example.invalid"); expect(body.confirmed).toBe(true);
    draft = { packet_id: "00000000-0000-4000-8000-000000000001", status: "draft", delivery_method: "assessor_email", mailbox: "assessor@example.invalid", prepared_at: new Date().toISOString(), assessment_version: assessment.version + 1, file_count: 1, to_recipients: body.recipients, cc_recipients: body.cc_recipients };
    await route.fulfill({ json: { draft } });
  });
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`;
  await page.goto(url); await settleHandoff(page); await openPreview(page);
  const inbox = page.getByRole("region", { name: "Email packet to assessor" });
  await expect(inbox.getByText("assessor@example.invalid", { exact: true })).toBeVisible();
  await expect(inbox.getByRole("button", { name: "Email packet to me", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Connect Outlook", exact: true })).toHaveCount(0);
  expect(await checkA11y(page, 'dialog[open]')).toEqual([]);
  await inbox.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `output/assessor-email-${width}.png`, fullPage: true });
  await inbox.getByRole("button", { name: "Email packet to me", exact: true }).click();
  await expect(inbox.getByRole("button", { name: "I forwarded the handoff" })).toBeVisible();
  await page.reload(); await settleHandoff(page);
  await page.getByRole("button", { name: "Continue inbox handoff" }).click();
  await expect(inbox.getByRole("button", { name: "Email packet to me", exact: true })).toHaveCount(0);
  await inbox.getByRole("button", { name: "I forwarded the handoff" }).click();
  await expect(page.getByRole("alertdialog", { name: "Did you forward the complete handoff?" })).toBeVisible();
  await page.getByRole("button", { name: "Yes, I sent it", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Handoff sent" })).toBeVisible();
  expect(sends).toBe(1); expect(outlookConnects).toBe(0);
});

});
