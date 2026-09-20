import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createOperationalReferral } from "./support/operational-api";

async function openStage(page: Page, label: string, width: number) {
  const stages = page.getByRole("navigation", { name: "Workspace stages" });
  if (width < 640) await stages.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption({ label });
  else await stages.getByRole("button", { name: label, exact: true }).click();
}

for (const width of [1440, 834, 390]) {
  test(`review, signature, decision and email remain distinct at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
      name: `Finish clarity ${randomUUID()}`, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing",
    }, { assigneeId: "provisional:allo:annette" });
    const response = await page.request.post(`/api/referrals/${referral.id}/assessments`, {
      data: { client_mutation_id: randomUUID(), data: { current_symptoms: "Synthetic assessment answer retained through review" } },
    });
    expect(response.status()).toBe(201);
    const { assessment } = await response.json();
    const readAssessment = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    const readWorkflow = async () => (await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json());
    let sends = 0;
    page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });

    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const footer = page.locator('footer[aria-label="Assessment actions"]');
    await expect(footer).toBeVisible();
    await expect(footer.locator('[data-guide-target="assessment-sign"]')).toHaveCount(0);
    await footer.getByRole("button", { name: "Review assessment", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review assessment", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("The admission decision and email are separate.");
    await expect(page.getByRole("article", { name: "Assessment record", exact: true })).toBeVisible();
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toHaveCount(0);
    expect((await readAssessment()).signed_at).toBeNull();

    await page.getByRole("button", { name: "Back to questions", exact: true }).click();
    if (width < 640) {
      await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
      await page.getByRole("dialog", { name: "Questionnaire sections", exact: true }).getByRole("button", { name: /^Review assessment/ }).click();
    } else {
      await page.getByLabel("Assessment section", { exact: true }).selectOption("provenance_qc");
      await footer.getByRole("button", { name: "Review assessment", exact: true }).click();
    }
    const sign = footer.getByRole("button", { name: "Sign & continue to decision", exact: true });
    await expect(sign).toBeEnabled();
    await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("Synthetic assessment answer retained through review");
    await page.screenshot({ path: info.outputPath(`assessment-review-${width}.png`) });
    page.once("dialog", (dialog) => dialog.dismiss());
    await sign.click();
    expect((await readAssessment()).signed_at).toBeNull();
    page.once("dialog", (dialog) => dialog.accept());
    await sign.click();
    const decision = page.getByRole("region", { name: "Admission decision", exact: true });
    await expect(decision).toBeVisible();
    expect((await readAssessment()).signed_at).toBeTruthy();
    expect((await readWorkflow()).decision).toBeNull();
    expect(sends).toBe(0);

    await decision.getByRole("radio", { name: "Accept", exact: true }).check();
    page.once("dialog", (dialog) => dialog.accept());
    await decision.getByRole("button", { name: "Record decision", exact: true }).click();
    await expect(decision.getByRole("heading", { name: "Decision recorded", exact: true })).toBeVisible();
    await expect(decision.getByLabel("Admission date (optional)")).toHaveValue("");
    await decision.getByRole("button", { name: "Review email & packet", exact: true }).click();
    const email = page.getByRole("region", { name: "Email and referral packet", exact: true });
    await expect(email).toBeVisible();
    await expect(email.getByRole("button", { name: "Review assessment", exact: true })).toBeInViewport();
    await expect(email).toContainText("Only Send email & packet sends this handoff.");
    expect((await readAssessment()).meet_client_sent_at).toBeFalsy();
    expect((await readWorkflow()).decision.outcome).toBe("accepted");
    await page.screenshot({ path: info.outputPath(`handoff-next-step-${width}.png`) });
    await email.getByRole("button", { name: "Review assessment", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review assessment", exact: true })).toBeVisible();
    await openStage(page, "Chart", width);
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
    await expect(footer.locator('[data-guide-target="assessment-sign"]')).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "Review assessment", exact: true })).toHaveCount(0);
    await page.reload();
    await expect(footer.getByRole("button", { name: "Continue to decision", exact: true })).toBeVisible();
    expect((await readAssessment()).current_symptoms).toBe("Synthetic assessment answer retained through review");
    expect(sends).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
