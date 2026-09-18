import { expect, test, webkit } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

for (const width of [1440, 768, 390]) {
  test(`assessment footer follows preparation, interview and decision at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
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
    const more = footer.locator('summary[aria-label="More assessment actions"]');
    await expect(footer).toBeInViewport();
    await expect(footer.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "Schedule assessment", exact: true })).toBeHidden();
    if (width < 640) await footer.locator('summary[aria-label="Assessment progress actions"]').click();
    await expect(primary.getByRole("button")).toHaveCount(1);
    await expect(primary.getByRole("button", { name: "Begin assessment", exact: true })).toBeVisible();

    await more.click();
    const menu = footer.getByRole("group", { name: "More assessment actions", exact: true });
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
    await expect(primary.getByRole("button", { name: "Begin assessment", exact: true })).toBeVisible();
    await expect(primary.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCount(0);

    await primary.getByRole("button", { name: "Begin assessment", exact: true }).click();
    const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
    await begin.getByRole("button", { name: "Begin assessment", exact: true }).click();
    await expect(begin).toHaveCount(0);
    await expect.poll(async () => Boolean((await read()).started_at)).toBe(true);
    await expect(primary.getByRole("button", { name: "Sign assessment", exact: true })).toBeVisible();
    await expect(primary.getByRole("button")).toHaveCount(1);
    await expect(footer.getByRole("button", { name: "Begin assessment", exact: true })).toHaveCount(0);
    await expect(footer.getByRole("button", { name: /Schedule assessment|Reschedule assessment/ })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`assessment-footer-started-${width}.png`) });

    // Unanswered questions remain permissible; the signature still uses the existing save path.
    page.once("dialog", (dialog) => dialog.accept());
    await primary.getByRole("button", { name: "Sign assessment", exact: true }).click();
    await expect(page.locator("#admission-workflow")).toBeVisible();
    const signed = await read();
    expect(signed.signed_at).toBeTruthy();
    expect(signed.secondary_diagnoses).toEqual(["Synthetic prepared information"]);
    expect(signed.meet_client_sent_at).toBeFalsy();
    await page.goto(url);
    if (width < 640) await footer.locator('summary[aria-label="Assessment progress actions"]').click();
    await expect(primary.getByRole("button", { name: "Admission decision", exact: true })).toBeVisible();
    await expect(primary.getByRole("button")).toHaveCount(1);
    await expect(footer.getByRole("button", { name: /^(Begin|Sign) assessment$/ })).toHaveCount(0);
    await primary.getByRole("button", { name: "Admission decision", exact: true }).click();
    await expect(page.locator("#admission-workflow")).toBeVisible();
    expect((await read()).meet_client_sent_at).toBeFalsy();
  });
}

test("secondary actions close on Escape and outside press without exiting the assessment in WebKit", async ({ baseURL }) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });
    await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=prepare&assessmentSection=prior_history");
    const surface = page.getByRole("dialog", { name: "Assessment interview", exact: true });
    const more = surface.locator('summary[aria-label="More assessment actions"]');
    const menu = surface.getByRole("group", { name: "More assessment actions", exact: true });
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
    await surface.getByRole("heading", { name: "Client information", exact: true }).tap();
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
