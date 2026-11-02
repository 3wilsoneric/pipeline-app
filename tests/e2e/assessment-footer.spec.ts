import { closeTestBrowser } from "./support/browser-lifecycle";
import { expect, test, webkit } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { openHandoffConfirmation } from "./support/assessment-navigation";
import { createOperationalReferral } from "./support/operational-api";

for (const width of [1440, 768, 390, 320]) {
  test(`assessment footer follows preparation, interview and decision at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 950 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
      name: `Footer ${randomUUID().replace(/[^a-z]/g, "")}`, owner: "", tags: [], documentName: "", documentStatus: "Missing",
    });
    const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
      client_mutation_id: randomUUID(), data: { secondary_diagnoses: ["Synthetic prepared information"] },
    } });
    expect(created.status()).toBe(201);
    const { assessment } = await created.json();
    const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`;
    await page.goto(url);
    const footer = page.locator('footer[aria-label="Assessment actions"]');
    const primary = footer.locator("[data-assessment-primary-action]");
    const entryAction = width >= 640 ? page.getByRole("region", { name: "Interview", exact: true }).getByRole("button", { name: "Start now", exact: true }) : footer.getByRole("button", { name: "Next section", exact: true });
    await expect(footer).toBeInViewport();
    await expect(footer.getByRole("button", { name: "Confirm chart", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "Schedule interview", exact: true })).toBeHidden();
    await expect(entryAction).toHaveCount(1);
    await expect(entryAction).toBeVisible();
    await expect(footer.getByRole("button", { name: "Confirm chart", exact: true })).toHaveCount(0);
    expect((await read()).started_at).toBeNull();

    const appointment = page.getByRole("region", { name: "Interview", exact: true });
    await appointment.getByRole("button", { name: "Schedule interview", exact: true }).click();
    const schedule = page.getByRole("dialog", { name: "Schedule interview", exact: true });
    await schedule.getByLabel("Assessment date and time").fill("2027-09-20T10:00");
    await schedule.getByRole("button", { name: "Schedule interview", exact: true }).click();
    await expect(schedule).toHaveCount(0);
    await expect.poll(async () => Boolean((await read()).scheduled_start_at)).toBe(true);
    expect((await read()).started_at).toBeNull();
    await expect(entryAction).toBeVisible();

    await expect(page.getByRole("button", { name: "Begin assessment", exact: true })).toHaveCount(0);
    await appointment.getByRole("button", { name: "Edit assessment appointment", exact: true }).click();
    await expect(schedule).toBeInViewport();
    await schedule.getByRole("button", { name: "Close schedule", exact: true }).click();
    await expect(appointment.getByRole("button", { name: "Edit assessment appointment", exact: true })).toBeFocused();
    expect((await read()).started_at).toBeNull();
    await expect(entryAction).toHaveCount(1);
    await expect(footer.getByRole("button", { name: /Schedule interview|Change appointment/ })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`assessment-footer-ready-${width}.png`) });

    await openHandoffConfirmation(page);
    const chartReview = page.getByRole("region", { name: "Assessment chart review", exact: true });
    await expect(chartReview).toContainText("Synthetic prepared information");
    await expect(primary.getByRole("button", { name: "Confirm chart", exact: true })).toBeInViewport();
    expect(await page.getByTestId("assessment-client-folder").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`chart-review-${width}.png`) });
    await chartReview.getByRole("button", { name: "Back to questions", exact: true }).click();
    await expect(chartReview).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "Confirm chart", exact: true })).toHaveCount(0);
    await openHandoffConfirmation(page);
    // Unanswered questions remain permissible; the signature still uses the existing save path.
    await primary.getByRole("button", { name: "Confirm chart", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Everything correct and included?", exact: true }).getByRole("button", { name: "Confirm & continue", exact: true }).click();
    await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toBeVisible();
    const signed = await read();
    expect(signed.signed_at).toBeTruthy();
    expect(signed.secondary_diagnoses).toEqual(["Synthetic prepared information"]);
    expect(signed.meet_client_sent_at).toBeFalsy();
    await page.goto(url);
    await openHandoffConfirmation(page);
    await expect(primary.getByRole("button")).toHaveCount(0);
    await expect(footer.getByRole("button", { name: /^(Begin|Sign) assessment$/ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toBeVisible();
    expect((await read()).meet_client_sent_at).toBeFalsy();
  });
}

test("interview date closes on Escape and outside press without exiting the assessment in WebKit", async ({ baseURL }) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });
    await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=prepare&assessmentSection=prior_history");
    await expect(page.getByTestId("packet-workspace")).not.toHaveAttribute("inert", "");
    await expect(page.locator('[data-guide-target="packet-workspace"]')).toHaveAttribute("data-performance-ready", "packet");
    const surface = page.locator("[data-assessment-view]");
    const more = surface.getByRole("button", { name: /^Interview date/ });
    const menu = page.getByRole("dialog", { name: "Interview date", exact: true });
    await expect(surface.locator('[data-guide-target="assessment-save-status"]')).toContainText("Practice changes saved locally");
    await more.press("Enter");
    await expect(menu).toBeVisible();
    await expect(menu.locator("#assessment-assessment_date")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(surface).toBeVisible();
    await expect(more).toBeFocused();
    await more.tap();
    await page.mouse.click(1, 1);
    await expect(menu).toBeHidden();
    const appointmentButton = page.getByRole("region", { name: "Assessment progress", exact: true }).getByRole("button", { name: "Schedule interview", exact: true });
    await appointmentButton.tap();
    const schedule = page.getByRole("dialog", { name: "Schedule interview", exact: true });
    await schedule.getByRole("button", { name: "Close schedule", exact: true }).tap();
    await expect(appointmentButton).toBeFocused();
    await expect(surface).toBeVisible();
  } finally {
    await closeTestBrowser(browser);
  }
});

for (const width of [1440, 390]) {
  test(`signing does not depend on the retired start endpoint at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
      name: `Optional start ${randomUUID().replace(/[^a-z]/g, "")}`, owner: "", tags: [], documentName: "", documentStatus: "Missing",
    });
    const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { secondary_diagnoses: ["Synthetic retained answer"] } } });
    expect(created.status()).toBe(201);
    const { assessment } = await created.json();
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
    const footer = page.locator('footer[aria-label="Assessment actions"]');
    await expect(page.locator("[data-assessment-view]")).toBeVisible();
    let startRequests = 0;
    await page.route(`**/api/assessments/${assessment.assessment_id}/start`, (route) => { startRequests++; return route.fulfill({ status: 503, json: { error: "Synthetic start unavailable" } }); });
    await expect(page.getByRole("button", { name: "Begin assessment", exact: true })).toHaveCount(0);
    await openHandoffConfirmation(page);
    await footer.getByRole("button", { name: "Confirm chart", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Everything correct and included?", exact: true }).getByRole("button", { name: "Confirm & continue", exact: true }).click();
    await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toBeVisible();
    const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.signed_at).toBeTruthy();
    expect(saved.started_at).toBeNull();
    expect(startRequests).toBe(0);
    expect(saved.secondary_diagnoses).toEqual(["Synthetic retained answer"]);
    expect(saved.meet_client_sent_at).toBeFalsy();
  });
}
