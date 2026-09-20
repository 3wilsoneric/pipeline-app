import { expect, test, webkit, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

async function openAssessmentReview(page: Page) {
  if (page.viewportSize()!.width < 640) {
    await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    await page.getByRole("dialog", { name: "Questionnaire sections", exact: true }).getByRole("button", { name: /^Review assessment/ }).click();
  } else {
    await page.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("provenance_qc");
    await page.locator('footer[aria-label="Assessment actions"]').getByRole("button", { name: "Review assessment", exact: true }).click();
  }
}

for (const width of [1440, 768, 390, 320]) {
  test(`assessment footer follows preparation, interview and decision at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 950 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
      name: `Footer ${randomUUID().replace(/[^a-z]/g, "")}`, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing",
    }, { assigneeId: "provisional:allo:annette" });
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
    const more = page.locator('summary[aria-label="Assessment details"]');
    await expect(footer).toBeInViewport();
    await expect(footer.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "Schedule assessment", exact: true })).toBeHidden();
    await expect(primary.getByRole("button")).toHaveCount(width < 640 ? 0 : 1);
    await expect(width < 640 ? page.getByRole("navigation", { name: "Question steps" }).getByRole("button", { name: /Next/ }) : primary.getByRole("button", { name: "Next section", exact: true })).toBeVisible();
    await expect(footer.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCount(0);
    expect((await read()).started_at).toBeNull();

    await more.click();
    const menu = page.getByRole("group", { name: "Assessment details", exact: true });
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await menu.getByRole("button", { name: "Schedule assessment", exact: true }).click();
    const schedule = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
    await schedule.getByLabel("Assessment date and time").fill("2027-09-20T10:00");
    await schedule.getByRole("button", { name: "Schedule assessment", exact: true }).click();
    await expect(schedule).toHaveCount(0);
    await expect.poll(async () => Boolean((await read()).scheduled_start_at)).toBe(true);
    expect((await read()).started_at).toBeNull();
    await expect(width < 640 ? page.getByRole("navigation", { name: "Question steps" }).getByRole("button", { name: /Next/ }) : primary.getByRole("button", { name: "Next section", exact: true })).toBeVisible();

    await more.click();
    await menu.getByRole("button", { name: "Begin assessment", exact: true }).click();
    const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
    await expect(begin).toBeInViewport();
    const modalBounds = (await begin.boundingBox())!;
    expect(modalBounds.x).toBeGreaterThanOrEqual(0);
    expect(modalBounds.x + modalBounds.width).toBeLessThanOrEqual(width);
    expect(modalBounds.y + modalBounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(begin).toContainText("you can answer questions and sign without it");
    await expect(begin.getByRole("button", { name: "Not now", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(begin.getByRole("button", { name: "Record start", exact: true })).toBeFocused();
    await page.getByRole("button", { name: width < 640 ? "Back to previous page" : "Workspaces", exact: true }).evaluate((button) => (button as HTMLButtonElement).focus());
    await expect(begin.getByRole("button", { name: "Record start", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(begin).toHaveCount(0);
    await expect(more).toBeFocused();
    expect((await read()).started_at).toBeNull();
    await more.click();
    await menu.getByRole("button", { name: "Begin assessment", exact: true }).click();
    await page.screenshot({ path: info.outputPath(`start-modal-${width}.png`) });
    await begin.getByRole("button", { name: "Record start", exact: true }).click();
    await expect(begin).toHaveCount(0);
    await expect.poll(async () => Boolean((await read()).started_at)).toBe(true);
    await expect(width < 640 ? page.getByRole("navigation", { name: "Question steps" }).getByRole("button", { name: /Next/ }) : primary.getByRole("button", { name: "Next section", exact: true })).toBeVisible();
    await expect(primary.getByRole("button")).toHaveCount(width < 640 ? 0 : 1);
    await expect(footer.getByRole("button", { name: "Begin assessment", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("button", { name: /Schedule assessment|Reschedule assessment/ })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`assessment-footer-started-${width}.png`) });

    await openAssessmentReview(page);
    const chartReview = page.getByRole("region", { name: "Assessment chart review", exact: true });
    await expect(chartReview).toContainText("Synthetic prepared information");
    await expect(primary.getByRole("button", { name: "Sign & continue to decision", exact: true })).toBeInViewport();
    expect(await page.getByTestId("assessment-client-folder").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`chart-review-${width}.png`) });
    await chartReview.getByRole("button", { name: "Back to questions", exact: true }).click();
    await expect(chartReview).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCount(0);
    await openAssessmentReview(page);
    // Unanswered questions remain permissible; the signature still uses the existing save path.
    page.once("dialog", (dialog) => dialog.accept());
    await primary.getByRole("button", { name: "Sign & continue to decision", exact: true }).click();
    await expect(page.locator("#admission-workflow")).toBeVisible();
    const signed = await read();
    expect(signed.signed_at).toBeTruthy();
    expect(signed.secondary_diagnoses).toEqual(["Synthetic prepared information"]);
    expect(signed.meet_client_sent_at).toBeFalsy();
    await page.goto(url);
    await openAssessmentReview(page);
    await expect(primary.getByRole("button", { name: "Continue to decision", exact: true })).toBeVisible();
    await expect(primary.getByRole("button")).toHaveCount(1);
    await expect(footer.getByRole("button", { name: /^(Begin|Sign) assessment$/ })).toHaveCount(0);
    await primary.getByRole("button", { name: "Continue to decision", exact: true }).click();
    await expect(page.locator("#admission-workflow")).toBeVisible();
    expect((await read()).meet_client_sent_at).toBeFalsy();
  });
}

test("secondary actions close on Escape and outside press without exiting the assessment in WebKit", async ({ baseURL }) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });
    await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=prepare&assessmentSection=prior_history");
    const surface = page.locator("[data-assessment-view]");
    const more = surface.locator('summary[aria-label="Assessment details"]');
    const menu = surface.getByRole("group", { name: "Assessment details", exact: true });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(menu.getByRole("button", { name: "Schedule assessment", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(surface).toBeVisible();
    await expect(more).toBeFocused();
    await more.tap();
    await surface.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true }).tap();
    await expect(menu).toBeHidden();
    await more.tap();
    await menu.getByRole("button", { name: "Schedule assessment", exact: true }).tap();
    const schedule = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
    await schedule.getByRole("button", { name: "Close schedule", exact: true }).tap();
    await expect(more).toBeFocused();
    await expect(surface).toBeVisible();
  } finally {
    await browser.close();
  }
});

for (const width of [1440, 390]) {
  test(`start collection can fail or be skipped without blocking signing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
      name: `Optional start ${randomUUID().replace(/[^a-z]/g, "")}`, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing",
    }, { assigneeId: "provisional:allo:annette" });
    const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { secondary_diagnoses: ["Synthetic retained answer"] } } });
    expect(created.status()).toBe(201);
    const { assessment } = await created.json();
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
    const footer = page.locator('footer[aria-label="Assessment actions"]');
    await expect(page.locator("[data-assessment-view]")).toBeVisible();
    await page.locator('summary[aria-label="Assessment details"]').click();
    await page.getByRole("button", { name: "Begin assessment", exact: true }).click();
    await page.route(`**/api/assessments/${assessment.assessment_id}/start`, (route) => route.fulfill({ status: 503, json: { error: "Synthetic start unavailable" } }));
    const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
    await begin.getByRole("button", { name: "Record start", exact: true }).click();
    await expect(begin.getByRole("alert")).toContainText("Synthetic start unavailable");
    await begin.getByRole("button", { name: "Not now", exact: true }).click();
    await openAssessmentReview(page);
    page.once("dialog", (dialog) => dialog.accept());
    await footer.getByRole("button", { name: "Sign & continue to decision", exact: true }).click();
    await expect(page.locator("#admission-workflow")).toBeVisible();
    const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.signed_at).toBeTruthy();
    expect(saved.started_at).toBeNull();
    expect(saved.secondary_diagnoses).toEqual(["Synthetic retained answer"]);
    expect(saved.meet_client_sent_at).toBeFalsy();
  });
}
