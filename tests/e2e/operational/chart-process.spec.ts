import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, readOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "../support/operational-api";
import { actorApiContext, actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";

// Chart built by the process (docs/design/DECISIONS.md, "Chart built by the process"): finished steps drop off the
// rail and are filed into the Chart in the order of the work, each with its stamp and the way back in.
test("finished steps are filed into the Chart and leave the rail", async ({ browser, baseURL }) => {
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
    await expect(page.getByRole("heading", { name: "Referral chart", exact: true })).toBeVisible();
    // The rail lists only what is left.
    await expect(rail.getByRole("button", { name: "Chart", exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Finish & send", exact: true })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Assessment", exact: true })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Decision", exact: true })).toHaveCount(0);
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
    // A filed step reopens from its section, and shows in the rail while it is on screen.
    await stages.nth(1).getByRole("button", { name: "Open decision", exact: true }).click();
    await expect(rail.getByRole("button", { name: "Decision", exact: true })).toHaveAttribute("aria-current", "page");
    await rail.getByRole("button", { name: "Chart", exact: true }).click();
    await expect(rail.getByRole("button", { name: "Decision", exact: true })).toHaveCount(0);
    await stages.nth(0).getByRole("button", { name: "Open assessment", exact: true }).click();
    await expect(rail.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
  } finally {
    await context.close();
    await api.dispose();
  }
});
