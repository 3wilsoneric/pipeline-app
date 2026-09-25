import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";
import { confirmReferralFileLabels } from "./support/referral-upload";
import { referralCanvasFieldKeys } from "../../lib/pipeline/referral-types";

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

for (const width of [1440, 390]) test(`main navigation continues with an open-tab copy when Pipeline and device storage both fail at ${width}px`, async ({ page }) => {
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
  await expect(page).toHaveURL(/screen=calendar/);
  await expect(page.getByText("Some edits are only in this open tab.")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}`));
  await expect(page.locator('[data-workspace-field="referent"] input')).toHaveValue("Synthetic unsaved source");
});

test("a dual-failed intake save retries device recovery after leaving the workspace", async ({ page }) => {
  const referral = await openEditedIntake(page);
  await page.route(`**/api/referrals/${referral.id}`, (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 503, json: { error: "Synthetic canonical save outage" } }) : route.continue());
  await page.route("**/api/me/referral-drafts/**", (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, json: { error: "Synthetic draft save outage" } }) : route.continue());
  await page.evaluate(() => {
    (window as typeof window & { originalRecoveryOpen: typeof indexedDB.open }).originalRecoveryOpen = indexedDB.open.bind(indexedDB);
    Object.defineProperty(indexedDB, "open", { configurable: true, value: () => { throw new Error("Synthetic device storage outage"); } });
  });
  await page.locator('[data-workspace-field="referent"] input').fill("Synthetic retry source");
  await openCalendar(page, 1440);
  await expect(page.getByText("Some edits are only in this open tab.")).toBeVisible();
  await page.evaluate(() => {
    const original = (window as typeof window & { originalRecoveryOpen: typeof indexedDB.open }).originalRecoveryOpen;
    Object.defineProperty(indexedDB, "open", { configurable: true, value: original });
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.getByText("Some edits are only in this open tab.")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}`));
  await expect(page.locator('[data-workspace-field="referent"] input')).toHaveValue("Synthetic retry source");
});

for (const width of [1440, 390]) test(`main navigation proceeds on a confirmed device copy and restores edits after server failure at ${width}px`, async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Requires encrypted device recovery; covered by desktop E2E.");
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
  await expect(page.getByText("Some edits are only in this open tab.")).toHaveCount(0);
});

test("failed recovery cleanup does not replay a chart edit already saved to the database", async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E === "true", "This case injects a session-storage cleanup failure.");
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic stale recovery check", owner: "", tags: [],
  });
  let chartWrites = 0;
  await page.route(`**/api/referrals/${referral.id}`, (route) => {
    if (route.request().method() === "PATCH") chartWrites += 1;
    return route.continue();
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
  const referent = page.locator('[data-workspace-field="referent"] input');
  await referent.fill("Synthetic saved source");
  const recoveryKey = `pipeline-referral-draft:${referral.id}`;
  await expect.poll(() => page.evaluate((key) => Boolean(sessionStorage.getItem(key)), recoveryKey)).toBe(true);
  await page.evaluate((key) => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (item: string) {
      if (this === sessionStorage && item === key) throw new Error("Synthetic recovery cleanup outage");
      return remove.call(this, item);
    };
  }, recoveryKey);
  await referent.press("Tab");
  await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.source).toBe("Synthetic saved source");
  await expect(page.getByTestId("workspace-save-status")).toContainText("Saved");
  expect(await page.evaluate((key) => Boolean(sessionStorage.getItem(key)), recoveryKey)).toBe(true);
  const writesBeforeReload = chartWrites;
  await page.reload();
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("workspace-save-status")).not.toContainText("Restored edits");
  await expect(page.locator('[data-workspace-field="referent"] input')).toHaveValue("Synthetic saved source");
  expect(chartWrites).toBe(writesBeforeReload);
});

test("server recovery left after a confirmed save is cleared without another chart write", async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Requires server-backed recovery in the test app.");
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic stale server recovery", owner: "", tags: [],
  });
  let chartWrites = 0;
  await page.route(`**/api/referrals/${referral.id}`, (route) => {
    if (route.request().method() === "PATCH") chartWrites += 1;
    return route.continue();
  });
  const savedValue = "Synthetic confirmed source";
  const current = await (await page.request.get(`/api/referrals/${referral.id}`)).json();
  const updated = await page.request.patch(`/api/referrals/${referral.id}`, { data: {
    if_match: current.referral.version,
    if_match_sections: { intake: current.referral.sectionVersions.intake },
    client_mutation_id: randomUUID(),
    patch: { source: savedValue },
  } });
  expect(updated.ok(), await updated.text()).toBe(true);
  const draft = {
    schema: 1, savedAt: new Date().toISOString(), dirtyKeys: ["referent"],
    fields: Object.fromEntries(referralCanvasFieldKeys.map((key) => [key, { value: key === "referent" ? savedValue : "" }])),
    conserved: "", tagsInput: "", documents: {},
  };
  const seeded = await page.request.put(`/api/me/referral-drafts/${referral.id}`, { data: { if_match: 0, draft } });
  expect(seeded.ok(), await seeded.text()).toBe(true);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByTestId("workspace-save-status")).not.toContainText("Restored edits");
  await expect.poll(async () => (await (await page.request.get(`/api/me/referral-drafts/${referral.id}`)).json()).draft).toBeNull();
  expect(chartWrites).toBe(0);
});

test("navigation confirms a newer intake edit made while the first recovery write is pending", async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Requires server-backed intake recovery; covered by desktop E2E.");
  const referral = await openEditedIntake(page);
  await page.route(`**/api/referrals/${referral.id}`, (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 503, json: { error: "Synthetic chart save outage" } }) : route.continue());
  await page.evaluate(() => {
    Object.defineProperty(indexedDB, "open", { configurable: true, value: () => { throw new Error("Synthetic device storage outage"); } });
  });
  let releaseFirst!: () => void;
  let firstEntered!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
  let draftWrites = 0;
  await page.route(`**/api/me/referral-drafts/${referral.id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    draftWrites += 1;
    if (draftWrites === 1) { firstEntered(); await firstGate; }
    return route.continue();
  });
  try {
    const source = page.locator('[data-workspace-field="referent"] input');
    await source.fill("First source");
    const leaving = page.getByRole("button", { name: "Open calendar", exact: true }).click();
    await entered;
    await source.fill("Second source");
    releaseFirst();
    await leaving;
    await expect(page).toHaveURL(/screen=calendar/);
    await expect.poll(() => draftWrites).toBeGreaterThanOrEqual(2);
    const saved = await (await page.request.get(`/api/me/referral-drafts/${referral.id}`)).json();
    expect(saved.draft.fields.referent.value).toBe("Second source");
  } finally {
    releaseFirst();
  }
});

test("reopening navigation does not re-encrypt an unchanged queued file", async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Requires encrypted queued-file recovery; covered by desktop E2E.");
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await expect(page.locator('[data-performance-ready="packet"]')).toBeVisible();
  await page.evaluate(() => {
    const original = crypto.subtle.encrypt.bind(crypto.subtle);
    (window as typeof window & { recoveryEncryptions: number }).recoveryEncryptions = 0;
    Object.defineProperty(crypto.subtle, "encrypt", { configurable: true, value: (...args: Parameters<typeof crypto.subtle.encrypt>) => {
      (window as typeof window & { recoveryEncryptions: number }).recoveryEncryptions += 1;
      return original(...args);
    } });
  });
  await page.getByTestId("document-checklist-toggle").click();
  await page.getByTestId("referral-documents-input").setInputFiles({
    name: "queued-recovery.txt", mimeType: "text/plain", buffer: Buffer.alloc(256 * 1024, 65),
  });
  await confirmReferralFileLabels(page, { "queued-recovery.txt": "assessment" });
  await expect(page.getByTestId("workspace-save-status")).toContainText("Saved on this device");
  const encryptedBeforeExit = await page.evaluate(() => (window as typeof window & { recoveryEncryptions: number }).recoveryEncryptions);
  expect(encryptedBeforeExit).toBeGreaterThan(0);
  await openCalendar(page, 1440);
  await expect(page).toHaveURL(/screen=calendar/);
  const encryptedAfterExit = await page.evaluate(() => (window as typeof window & { recoveryEncryptions: number }).recoveryEncryptions);
  expect(encryptedAfterExit).toBe(encryptedBeforeExit);
});
