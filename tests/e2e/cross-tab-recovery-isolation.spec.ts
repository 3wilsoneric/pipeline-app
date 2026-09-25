import { expect, test, type Page } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";

test.use({ serviceWorkers: "block" });
test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Encrypted per-tab recovery is covered by desktop E2E.");

async function countRecoveryRecords(page: Page, kind: string) {
  return page.evaluate(async (recordKind) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open("pipeline-offline-v1");
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      const records = await new Promise<Array<{ kind: string }>>((resolve, reject) => {
        const request = database.transaction("records").objectStore("records").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return records.filter((record) => record.kind === recordKind).length;
    } finally {
      database.close();
    }
  }, kind);
}

test("two intake tabs keep separate encrypted copies when both server saves fail", async ({ page, context }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic two-tab intake recovery", owner: "", tags: [],
  });
  const second = await context.newPage();
  for (const tab of [page, second]) {
    await tab.route(`**/api/referrals/${referral.id}`, (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "Synthetic chart save outage" } }) : route.continue());
    await tab.route("**/api/me/referral-drafts/**", (route) => route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { error: "Synthetic draft save outage" } }) : route.continue());
  }
  try {
    for (const tab of [page, second]) {
      if (tab === second) {
        const inheritedSession = await page.evaluate(() => sessionStorage.getItem("pipeline-recovery-session-v1"));
        expect(inheritedSession).toBeTruthy();
        await second.addInitScript((value) => sessionStorage.setItem("pipeline-recovery-session-v1", value), inheritedSession!);
      }
      await tab.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
      await expect(tab.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
      await tab.getByRole("button", { name: "Edit referral details", exact: true }).click();
    }
    await page.locator('[data-workspace-field="referent"] input').fill("First tab source");
    await second.locator('[data-workspace-field="referent"] input').fill("Second tab source");
    await expect.poll(() => countRecoveryRecords(page, "referral-draft")).toBe(2);
    await page.reload();
    await second.reload();
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
    await expect(second.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator('[data-workspace-field="referent"] input')).toHaveValue("First tab source");
    await expect(second.locator('[data-workspace-field="referent"] input')).toHaveValue("Second tab source");
    await second.unrouteAll();
    await second.locator('[data-workspace-field="referent"] input').fill("Second tab synced source");
    await second.locator('[data-workspace-field="referent"] input').blur();
    await expect.poll(async () => (await (await second.request.get(`/api/referrals/${referral.id}`)).json()).referral.source).toBe("Second tab synced source");
    await expect.poll(() => countRecoveryRecords(page, "referral-draft")).toBeGreaterThanOrEqual(1);
    await page.reload();
    await expect(page.locator('[data-workspace-field="referent"] input')).toHaveValue("First tab source");
  } finally {
    await second.close();
  }
});

test("two assessment tabs keep separate encrypted copies when both server saves fail", async ({ page, context }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic two-tab assessment recovery", owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  const second = await context.newPage();
  for (const tab of [page, second]) {
    await tab.route(`**/api/assessments/${assessment.assessment_id}`, (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "Synthetic assessment save outage" } }) : route.continue());
    await tab.route(`**/api/me/assessment-drafts/${assessment.assessment_id}`, (route) => route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { error: "Synthetic draft save outage" } }) : route.continue());
  }
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
    await expect(page.locator("#assessment-prior_placements")).toBeVisible();
    const inheritedSession = await page.evaluate(() => sessionStorage.getItem("pipeline-recovery-session-v1"));
    expect(inheritedSession).toBeTruthy();
    await second.addInitScript((value) => sessionStorage.setItem("pipeline-recovery-session-v1", value), inheritedSession!);
    await second.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
    await page.locator("#assessment-prior_placements").fill("First tab history");
    await second.locator("#assessment-prior_placements").fill("Second tab history");
    await page.getByRole("button", { name: "Workspace files", exact: true }).click();
    await second.getByRole("button", { name: "Workspace files", exact: true }).click();
    await expect.poll(() => countRecoveryRecords(page, "assessment-draft")).toBe(2);
    await page.reload();
    await second.reload();
    await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Assessment", exact: true }).click();
    await second.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Assessment", exact: true }).click();
    await second.getByRole("button", { name: "All questions", exact: true }).click();
    await expect(page.locator("#assessment-prior_placements")).toHaveValue("First tab history");
    await expect(second.locator("#assessment-prior_placements")).toHaveValue("Second tab history");
  } finally {
    await second.close();
  }
});
