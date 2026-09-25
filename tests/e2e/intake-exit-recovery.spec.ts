import { expect, test, type Page } from "@playwright/test";
import { createOperationalReferral } from "./support/operational-api";

test.use({ serviceWorkers: "block" });

async function openEditedIntake(page: Page) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic intake exit recovery", owner: "", tags: [],
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
  return referral;
}

async function openCalendar(page: Page, width: number) {
  if (width < 640) await page.getByRole("button", { name: /^Open page menu/ }).click();
  await page.getByRole("button", { name: "Open calendar", exact: true }).click();
}

for (const width of [1440, 390]) test(`main navigation keeps an intake open when neither Pipeline nor device can preserve its edits at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const referral = await openEditedIntake(page);
  await page.route(`**/api/referrals/${referral.id}`, (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 503, json: { error: "Synthetic canonical save outage" } }) : route.continue());
  await page.route("**/api/me/referral-drafts/**", (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, json: { error: "Synthetic draft save outage" } }) : route.continue());
  await page.evaluate(() => {
    Object.defineProperty(indexedDB, "open", { configurable: true, value: () => { throw new Error("Synthetic device storage outage"); } });
  });
  const referent = page.locator('[data-workspace-field="referent"] input');
  await referent.fill("Synthetic unsaved source");
  await openCalendar(page, width);
  await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}`));
  await expect(referent).toHaveValue("Synthetic unsaved source");
  await expect(page.getByTestId("workspace-save-status").getByRole("alert")).toContainText("could not be saved to Pipeline or this device");
});

for (const width of [1440, 390]) test(`main navigation proceeds on a confirmed device copy and restores edits after server failure at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const referral = await openEditedIntake(page);
  await page.route(`**/api/referrals/${referral.id}`, (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 503, json: { error: "Synthetic canonical save outage" } }) : route.continue());
  await page.route("**/api/me/referral-drafts/**", (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, json: { error: "Synthetic draft save outage" } }) : route.continue());
  await page.locator('[data-workspace-field="referent"] input').fill("Synthetic device-only source");
  await openCalendar(page, width);
  await expect(page).toHaveURL(/screen=calendar/);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
  await expect(page.getByTestId("workspace-save-status")).toContainText("Saved on this device · waiting to sync");
  await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
  await expect(page.locator('[data-workspace-field="referent"] input')).toHaveValue("Synthetic device-only source");
});

test("a confirmed chart save permits navigation when both draft stores are unavailable", async ({ page }) => {
  const referral = await openEditedIntake(page);
  await page.route("**/api/me/referral-drafts/**", (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, json: { error: "Synthetic draft save outage" } }) : route.continue());
  await page.evaluate(() => {
    Object.defineProperty(indexedDB, "open", { configurable: true, value: () => { throw new Error("Synthetic device storage outage"); } });
  });
  await page.locator('[data-workspace-field="referent"] input').fill("Synthetic chart-saved source");
  await openCalendar(page, 1440);
  await expect(page).toHaveURL(/screen=calendar/);
  await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.source).toBe("Synthetic chart-saved source");
});
