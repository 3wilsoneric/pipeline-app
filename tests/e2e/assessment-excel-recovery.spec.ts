import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";
import { changeWorkbook } from "./support/workbook-runtime";
import { pickAssessmentToolData } from "../../lib/assessment/assessment-tool-schema";
import { assessmentWorkbookFields, assessmentWorkbookLayout } from "../../lib/assessment/assessment-workbook-contract";
const historySheet = assessmentWorkbookLayout.findIndex((section) => section.key === "prior_history") + 2;

test.describe("workbook recovery integration boundaries", () => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Build with NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED=true and run with PIPELINE_DESKTOP_E2E=true.");

  test("late recovery cannot replace newer typing or an explicitly restored workbook answer", async ({ page }) => {
    const fixture = await createFixture(page, "Synthetic Excel late recovery");
    const saved = await fixture.read();
    const baseData = pickAssessmentToolData(saved);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let requested = false;
    let delivered = false;
    await page.route(`**/api/me/assessment-drafts/${saved.assessment_id}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      requested = true;
      await held;
      await route.fulfill({ json: { version: 1, draft: {
        schema: 1, assessmentId: saved.assessment_id, referralId: fixture.referral.id,
        savedAt: new Date().toISOString(), baseVersion: saved.version, sectionVersions: saved.section_versions,
        dirtySections: ["prior_history"], activeSection: "prior_history", baseData,
        data: { ...baseData, prior_awol_failed_placements: "Older recovered typing", crisis_er_utilization: "Older recovered workbook answer" },
      } } });
      delivered = true;
    });
    await page.goto(fixture.href);
    await expect.poll(() => requested).toBe(true);
    const input = page.locator("#assessment-prior_awol_failed_placements");
    await input.fill("Newer typed answer");
    await input.blur();
    await expect.poll(async () => (await fixture.read()).prior_awol_failed_placements).toBe("Newer typed answer");
    const { dialog, bytes } = await downloadCopy(page);
    const changed = changeWorkbook(bytes, [{ sheet: historySheet, cell: "C11", value: "Newer Excel answer" }]);
    await page.getByLabel("Choose workbook").setInputFiles({ name: "copy.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: changed });
    await dialog.getByRole("button", { name: "Commit 1 change", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    release();
    await expect.poll(() => delivered).toBe(true);
    await expect.soft(page.getByRole("button", { name: "Edit Prior AWOL / failed placements", exact: true })).toContainText("Newer typed answer");
    await expect.soft(page.getByRole("button", { name: "Edit Crisis / ER utilization", exact: true })).toContainText("Newer Excel answer");
    expect((await fixture.read()).crisis_er_utilization).toBe("Newer Excel answer");
  });

  test("a late workbook save cannot populate the next open assessment", async ({ page }) => {
    const first = await createFixture(page, "Excelalpha Example");
    const second = await createFixture(page, "Excelbeta Example");
    const secondBefore = pickAssessmentToolData(await second.read());
    await page.goto(first.href);
    const { dialog, bytes } = await downloadCopy(page);
    const location = assessmentWorkbookFields.find((field) => field.key === "current_location")!;
    const changed = changeWorkbook(bytes, [{ sheet: assessmentWorkbookLayout.findIndex((section) => section.sheet === location.sheet) + 2, cell: `C${location.row}`, value: "Synthetic imported first location" }, { sheet: historySheet, cell: "C7", value: "First assessment Excel answer" }]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let requestStarted = false;
    let requestFinished = false;
    const wrongTargetWrites: unknown[] = [];
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().endsWith(`/api/assessments/${second.assessment.assessment_id}`) && request.postDataJSON()?.patch?.workbook_restore) wrongTargetWrites.push(request.postDataJSON());
    });
    await page.route(`**/api/assessments/${first.assessment.assessment_id}`, async (route) => {
      if (route.request().method() !== "PATCH" || !route.request().postDataJSON()?.patch?.workbook_restore) return route.continue();
      requestStarted = true;
      await held;
      await route.fulfill({ response: await route.fetch() });
      requestFinished = true;
    });
    await page.getByLabel("Choose workbook").setInputFiles({ name: "copy.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: changed });
    await dialog.getByRole("button", { name: "Commit 2 changes", exact: true }).click();
    await expect.poll(() => requestStarted).toBe(true);
    // Exercise a browser-history route change while the original request is in flight.
    try {
      await page.evaluate((href) => { history.pushState(null, "", href); dispatchEvent(new PopStateEvent("popstate")); }, second.href);
      await expect(page.locator('[data-guide-target="packet-workspace"]')).toContainText(secondBefore.resident_name!);
      await expect(dialog).toHaveCount(0);
    } finally { release(); }
    await expect.poll(() => requestFinished).toBe(true);
    await expect.poll(async () => (await first.read()).current_location).toBe("Synthetic imported first location");
    expect(pickAssessmentToolData(await second.read())).toEqual(secondBefore);
    expect(wrongTargetWrites).toEqual([]);
    await expect(page.locator('[data-guide-target="packet-workspace"]')).not.toContainText("First assessment Excel answer");
  });
});

async function createFixture(page: Page, name: string) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name, owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  return {
    referral, assessment,
    href: `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`,
    read: async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment,
  };
}

async function downloadCopy(page: Page) {
  const dialog = page.locator('dialog[aria-describedby="excel-preview-description"]');
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download current assessment", exact: true }).click();
  return { dialog, bytes: await fs.readFile((await (await pending).path())!) };
}
