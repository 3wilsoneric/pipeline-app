import { openRecipients, confirmRecipients } from "./support/handoff-review";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { activeOperationalAssessor, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";

async function openStage(page: Page, label: string, width: number) {
  const stages = page.getByRole("navigation", { name: "Workspace stages" });
  if (width < 640) await stages.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption({ label });
  else await stages.getByRole("button", { name: label, exact: true }).click();
}

for (const width of [1440, 834, 390, 320]) {
  test(`decision, chart confirmation, signature and email remain distinct at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const assessor = await activeOperationalAssessor(page.request);
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
      name: `Finish clarity ${randomUUID()}`, owner: assessor.display_name, tags: [], documentName: "", documentStatus: "Missing",
    }, { assigneeId: assessor.principal_id });
    const response = await page.request.post(`/api/referrals/${referral.id}/assessments`, {
      data: { client_mutation_id: randomUUID(), data: { current_symptoms: "Synthetic assessment answer retained through review" } },
    });
    expect(response.status()).toBe(201);
    const { assessment } = await response.json();
    await startOperationalAssessment(page.request, assessment);
    const readAssessment = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    const readWorkflow = async () => (await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json());
    let sends = 0;
    page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });

    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    await openStage(page, "Assessment", width);
    const footer = page.locator('footer[aria-label="Assessment actions"]');
    await expect(footer).toBeVisible();
    await expect(footer.locator('[data-guide-target="assessment-sign"]')).toHaveCount(0);
    if (width < 640) await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    await page.getByRole("button", { name: "Continue to decision", exact: true }).click();
    const decision = page.getByRole("region", { name: "Admission decision", exact: true });
    await expect(decision).toBeVisible();
    expect((await readAssessment()).signed_at).toBeNull();
    await decision.getByRole("radio", { name: "Accept", exact: true }).check();
    await decision.getByRole("button", { name: "Record decision", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Record acceptance", exact: true }).click();
    await expect(page).toHaveURL(/workspaceView=email/);
    await expect(page.getByRole("heading", { name: "Confirm chart", exact: true })).toBeVisible();
    await expect(page.getByRole("article", { name: "Assessment record", exact: true })).toBeVisible();
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toHaveCount(0);
    expect((await readAssessment()).signed_at).toBeNull();
    expect((await readWorkflow()).decision.outcome).toBe("accepted");
    // Corrections return to the same Handoff confirmation without recording another decision.
    await page.getByRole("button", { name: "Back to questions", exact: true }).click();
    if (width < 640) await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    await page.getByRole("button", { name: "Continue to Handoff", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Confirm chart", exact: true })).toBeInViewport();
    const sign = footer.getByRole("button", { name: "Confirm chart", exact: true });
    await expect(sign).toBeEnabled();
    await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("Synthetic assessment answer retained through review");
    await page.screenshot({ path: info.outputPath(`assessment-review-${width}.png`) });
    await sign.click();
    const signature = page.getByRole("alertdialog", { name: "Everything correct and included?", exact: true });
    const cancel = signature.getByRole("button", { name: "Cancel", exact: true });
    await expect(cancel).toBeFocused();
    await expect(signature).toContainText("Confirm the chart is ready for Meet the Client.");
    await page.screenshot({ path: info.outputPath(`assessment-sign-${width}.png`), animations: "disabled" });
    await cancel.click();
    await expect(sign).toBeFocused();
    expect((await readAssessment()).signed_at).toBeNull();
    await sign.click();
    await page.keyboard.press("Escape");
    await expect(signature).toHaveCount(0);
    await expect(sign).toBeFocused();
    expect((await readAssessment()).signed_at).toBeNull();
    await sign.click();
    await page.keyboard.press("Tab");
    await expect(signature.getByRole("button", { name: "Confirm & continue", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(signature.getByRole("button", { name: "Confirm & continue", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(cancel).toBeFocused();
    const signRoute = `**/api/assessments/${assessment.assessment_id}/sign`;
    await page.route(signRoute, (route) => route.fulfill({ status: 503, json: { error: "Synthetic signature unavailable. Retry signing." } }));
    await signature.getByRole("button", { name: "Confirm & continue", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Synthetic signature unavailable" })).toBeVisible();
    expect((await readAssessment()).signed_at).toBeNull();
    expect((await readAssessment()).current_symptoms).toBe("Synthetic assessment answer retained through review");
    expect(sends).toBe(0);
    await page.unroute(signRoute);
    await sign.click();
    await signature.getByRole("button", { name: "Confirm & continue", exact: true }).click();
    await expect(page).toHaveURL(/workspaceView=email/);
    expect((await readAssessment()).signed_at).toBeTruthy();
    expect((await readWorkflow()).decision.outcome).toBe("accepted");
    expect(sends).toBe(0);
    await expect(page.getByRole("region", { name: "Handoff follow-through", exact: true })).toBeVisible();
    const email = page.getByRole("region", { name: "Email and referral packet", exact: true });
    await expect(email).toBeVisible();
    const inlineReview = email.getByRole("region", { name: "Review client handoff", exact: true });
    await expect(inlineReview).toBeVisible();
    await inlineReview.getByLabel("Planned admit date", { exact: true }).fill("2026-10-01");
    expect((await readAssessment()).meet_client_sent_at).toBeFalsy();
    expect((await readWorkflow()).decision.outcome).toBe("accepted");
    await page.screenshot({ path: info.outputPath(`handoff-next-step-${width}.png`) });
    await openRecipients(page);
    await page.getByRole("combobox", { name: /^To/ }).fill("Example recipient <example@example.invalid>");
    await page.getByRole("combobox", { name: /^To/ }).press("Enter");
    await confirmRecipients(page);
    const composer = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
    await expect(composer.getByRole("status").filter({ hasText: "Not production yet" })).toHaveText("Not production yet — no draft will be created and no email will be sent.");
    await expect(page.frameLocator('iframe[title="Meet the Client email preview"]').getByRole("heading", { name: "Meet the Client", exact: true })).toBeVisible();
    await composer.getByRole("button", { name: "Close email preview", exact: true }).click();
    await openStage(page, "Chart", width);
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
    await expect(footer.locator('[data-guide-target="assessment-sign"]')).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "Review assessment", exact: true })).toBeHidden();
    await page.reload();
    await openStage(page, "Assessment", width);
    if (width >= 640) await expect(page.getByRole("button", { name: "Next: Decision", exact: true })).toHaveCount(0);
    expect((await readAssessment()).current_symptoms).toBe("Synthetic assessment answer retained through review");
    expect(sends).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
