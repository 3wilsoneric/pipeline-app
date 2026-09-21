import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";
import { pickAssessmentToolData } from "../../lib/assessment/assessment-tool-schema";

test("a delayed offline reconciliation cannot delete another open assessment's recovery draft", async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Requires encrypted assessment recovery.");
  const first = await createFixture(page, "Recoveryalpha Example");
  const second = await createFixture(page, "Recoverybeta Example");
  const firstBefore = await first.read();
  const secondBefore = pickAssessmentToolData(await second.read());
  const localAnswer = "Synthetic typed answer awaiting conflict review";
  const remoteAnswer = "Synthetic answer from another assessor";
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let conflictReturned = false;
  let reconciliationStarted = false;
  let reconciliationFinished = false;
  let holdReconciliation = false;

  // Disable server draft recovery so an intact encrypted browser copy is the
  // only way the original unsaved answer can survive this assessment switch.
  await page.route("**/api/me/assessment-drafts/**", (route) => route.fulfill({ status: 503, json: { error: "Synthetic recovery outage" } }));
  await page.goto(first.href);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  const input = page.locator("#assessment-prior_awol_failed_placements");
  await input.click();
  await expect(input).toBeFocused();
  await page.context().setOffline(true);
  await input.fill(localAnswer);
  await input.blur();
  await expect(page.locator('[data-guide-target="assessment-save-status"]')).toContainText(/Offline|queued/i);
  // A real folder-tab navigation persists the complete encrypted recovery copy.
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Chart", exact: true }).click();
  await expect.poll(() => encryptedDraftExists(page)).toBe(true);
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Assessment", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit Prior AWOL / failed placements", exact: true })).toContainText(localAnswer);

  const remote = await page.request.patch(first.api, { data: {
    if_match: firstBefore.version, client_mutation_id: randomUUID(),
    patch: { data: { prior_awol_failed_placements: remoteAnswer } },
  } });
  expect(remote.status(), await remote.text()).toBe(200);
  await page.route(`**${first.api}`, async (route) => {
    if (route.request().method() === "PATCH") {
      const response = await route.fetch();
      conflictReturned = response.status() === 409;
      await route.fulfill({ response });
      return;
    }
    if (route.request().method() !== "GET" || !holdReconciliation || !conflictReturned) return route.continue();
    reconciliationStarted = true;
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
    reconciliationFinished = true;
  });

  try {
    holdReconciliation = true;
    await page.context().setOffline(false);
    await expect.poll(() => reconciliationStarted).toBe(true);
    await page.evaluate((href) => { history.pushState(null, "", href); dispatchEvent(new PopStateEvent("popstate")); }, second.href);
    await expect(page.getByTestId("packet-workspace")).toContainText(secondBefore.resident_name!);
    await expect(page.locator("#assessment-prior_awol_failed_placements")).toHaveValue("");
    await expect.poll(() => encryptedDraftExists(page)).toBe(true);
    holdReconciliation = false;
    release();
    await expect.poll(() => reconciliationFinished).toBe(true);
    // Let the completed handler reach its cleanup, not just route.fulfill.
    await page.waitForTimeout(400);
    expect(await encryptedDraftExists(page)).toBe(true);
    expect(pickAssessmentToolData(await second.read())).toEqual(secondBefore);
    expect((await first.read()).prior_awol_failed_placements).toBe(remoteAnswer);
    await page.goto(first.href);
    await expect(page.getByRole("button", { name: "Edit Prior AWOL / failed placements", exact: true })).toContainText(localAnswer);
    await expect(page.getByRole("button", { name: "Keep mine", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Keep mine", exact: true }).click();
    await expect.poll(async () => (await first.read()).prior_awol_failed_placements).toBe(localAnswer);
    expect(pickAssessmentToolData(await second.read())).toEqual(secondBefore);
  } finally { release(); await page.context().setOffline(false); }
});

async function createFixture(page: Page, name: string) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name, owner: "", tags: [] });
  const assessment = await startOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  const api = `/api/assessments/${assessment.assessment_id}`;
  return {
    api,
    href: `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`,
    read: async () => (await (await page.request.get(api)).json()).assessment,
  };
}

async function encryptedDraftExists(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("pipeline-offline-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<Array<{ kind: string }>>((resolve, reject) => {
      const request = database.transaction("records").objectStore("records").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return records.some((record) => record.kind === "assessment-draft");
  });
}
