import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, readOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "../support/operational-api";
import { actorApiContext, actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";

// Later steps never remove access to unfinished or filed work.
test("finished steps are filed into the Chart and remain in the rail", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Run with the operational configuration and PIPELINE_DESIGN_V2=true.");
  test.setTimeout(120_000);
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("viewer", url);
  const { page, context } = await actorPage(browser, "viewer", url);
  try {
    expect((await api.get("/api/members")).status()).toBe(200);
    const referral = await createOperationalReferral(api, "viewer", { owner: "Unassigned" });
    const assessment = await createOperationalAssessment(api, referral.id);
    await signOperationalAssessment(api, assessment);
    await recordOperationalAcceptance(api, await readOperationalReferral(api, referral.id));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const rail = page.getByRole("navigation", { name: "Workspace stages" });
    const chart = page.getByRole("article", { name: "Referral chart", exact: true });
    await expect(chart).toBeVisible();
    await expect(chart.getByRole("heading", { name: "Referral chart", exact: true })).toHaveClass("sr-only");
    const requirements = page.getByRole("region", { name: "Admission requirements", exact: true });
    await expect(requirements).toHaveCount(1);
    const progress = requirements.getByRole("progressbar", { name: "Admission requirements resolved" });
    await expect(progress).toBeVisible();
    expect(Number(await progress.getAttribute("max"))).toBeGreaterThan(0);
    expect(await requirements.evaluate((node) => Boolean(node.compareDocumentPosition(document.querySelector('article[aria-label="Referral chart"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    const pencil = chart.getByRole("button", { name: "Edit Phone", exact: true });
    expect((await pencil.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(pencil.locator("svg")).toHaveAttribute("width", "11");
    // Completed and unfinished steps remain directly available.
    await expect(rail.getByRole("button", { name: "Chart", exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Finish & send", exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Assessment", exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("data-step-state", "done");
    await expect(rail.getByRole("button", { name: "Decision", exact: true })).toBeVisible();
    // The Chart holds the finished steps in order, filed, and the one under way.
    const stages = page.locator("[data-chart-stage]");
    await expect(stages).toHaveCount(3);
    await expect(stages.nth(0)).toHaveAttribute("data-chart-stage", "Assessment");
    await expect(stages.nth(0)).toHaveAttribute("data-filed", "true");
    await expect(stages.nth(0)).toContainText("Assessment signed");
    await expect(stages.nth(1)).toHaveAttribute("data-chart-stage", "Decision");
    await expect(stages.nth(1)).toHaveAttribute("data-filed", "true");
    await expect(stages.nth(1)).toContainText("Decision recorded: Accepted");
    await expect(stages.nth(2)).toHaveAttribute("data-chart-stage", "Finish & send");
    await expect(stages.nth(2)).not.toHaveAttribute("data-filed", "true");
    await expect(page.locator("[data-chart-standing]")).toHaveCount(0);
    await stages.nth(0).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("chart-process.png"), fullPage: false });
    // A filed step reopens from either its chart section or its permanent rail entry.
    await stages.nth(1).getByRole("button", { name: "Open decision", exact: true }).click();
    await expect(rail.getByRole("button", { name: "Decision", exact: true })).toHaveAttribute("aria-current", "page");
    await rail.getByRole("button", { name: "Chart", exact: true }).click();
    await expect(rail.getByRole("button", { name: "Decision", exact: true })).toBeVisible();
    await stages.nth(0).getByRole("button", { name: "Open assessment", exact: true }).click();
    await expect(rail.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
  } finally {
    await context.close();
    await api.dispose();
  }
});

test("accepting first leaves the unsigned assessment editable and signable", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Requires the redesigned operational workspace.");
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const { page, context } = await actorPage(browser, "assessorA", url);
  try {
    await api.get("/api/members");
    const referral = await createOperationalReferral(api, "assessorA");
    const assessment = await createOperationalAssessment(api, referral.id);
    await recordOperationalAcceptance(api, await readOperationalReferral(api, referral.id));
    const read = async () => (await (await api.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const rail = page.getByRole("navigation", { name: "Workspace stages" });
    const assessmentTab = rail.getByRole("button", { name: "Assessment", exact: true });
    await expect(assessmentTab).toHaveAttribute("data-step-state", "active");
    await expect(page.locator('[data-chart-stage="Assessment"]')).not.toHaveAttribute("data-filed", "true");
    await expect(rail.getByRole("button", { name: "Decision", exact: true })).toHaveAttribute("data-step-state", "done");
    expect((await read()).signed_at).toBeNull();
    await assessmentTab.click();
    const answer = "Synthetic answer finished after acceptance.";
    await page.getByRole("textbox", { name: "Where the client is now", exact: true }).fill(answer);
    await page.getByRole("textbox", { name: "Where the client is now", exact: true }).blur();
    await expect.poll(async () => (await read()).current_location).toBe(answer);
    await page.getByRole("button", { name: "Begin interview", exact: true }).click();
    await page.getByRole("dialog", { name: "Begin interview", exact: true }).getByRole("button", { name: "Begin interview", exact: true }).click();
    await page.getByRole("button", { name: "Review assessment", exact: true }).click();
    await page.getByRole("button", { name: "Sign & continue to decision", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Sign this assessment?", exact: true }).getByRole("button", { name: "Sign assessment", exact: true }).click();
    await expect.poll(async () => Boolean((await read()).signed_at)).toBe(true);
    expect((await read()).current_location).toBe(answer);
    await expect(assessmentTab).toBeVisible();
    await expect(assessmentTab).toHaveAttribute("data-step-state", "done");
    await rail.getByRole("button", { name: "Chart", exact: true }).click();
    await expect(assessmentTab).toBeVisible();
  } finally {
    await context.close();
    await api.dispose();
  }
});
