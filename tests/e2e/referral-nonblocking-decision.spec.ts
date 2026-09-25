import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

test("a checklist save does not freeze or erase a draft decision", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Example Nonblocking Decision ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  let releaseSave = () => {};
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  let heldSave = false;
  await page.route(`**/api/referrals/${referral.id}/work-items/*`, async (route) => {
    if (route.request().method() === "PATCH" && !heldSave) {
      heldSave = true;
      await saveGate;
    }
    await route.continue();
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
    const panel = page.getByRole("region", { name: "Admission decision", exact: true });
    await panel.getByText("Admission paperwork & EHR handoff").click();
    const requirement = panel.locator('select[aria-label$=" status"]').first();
    await expect(requirement).toBeVisible();
    const current = await requirement.inputValue();
    await requirement.selectOption(current === "received" ? "needed" : "received");
    await expect.poll(() => heldSave).toBe(true);
    const accept = panel.getByRole("radio", { name: "Accept", exact: true });
    await expect(accept).toBeEnabled();
    await accept.check();
    const reason = panel.getByLabel("Reason (optional)", { exact: true });
    await reason.fill("Synthetic decision draft while paperwork saves.");
    await expect(panel.getByRole("button", { name: "Record decision", exact: true })).toBeDisabled();
    releaseSave();
    await expect(requirement).not.toBeDisabled();
    await expect(accept).toBeChecked();
    await expect(panel.locator("textarea").first()).toHaveValue("Synthetic decision draft while paperwork saves.");
    await expect(panel.getByRole("button", { name: "Record decision", exact: true })).toBeEnabled();
  } finally {
    releaseSave();
  }
});

test("two paperwork changes queue without dropping either selection", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Example Queued Paperwork ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  let releaseFirst = () => {};
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let requests = 0;
  await page.route(`**/api/referrals/${referral.id}/work-items/*`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    requests += 1;
    if (requests === 1) await firstGate;
    return route.continue();
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
    const panel = page.getByRole("region", { name: "Admission decision", exact: true });
    await panel.getByText("Admission paperwork & EHR handoff").click();
    const statuses = panel.locator('select[aria-label$=" status"]');
    await expect.poll(() => statuses.count()).toBeGreaterThanOrEqual(2);
    const first = statuses.nth(0);
    const second = statuses.nth(1);
    const firstTarget = await first.inputValue() === "received" ? "needed" : "received";
    const secondTarget = await second.inputValue() === "received" ? "needed" : "received";
    await first.selectOption(firstTarget);
    await expect.poll(() => requests).toBe(1);
    await expect(second).toBeEnabled();
    await second.selectOption(secondTarget);
    await expect(second).toHaveValue(secondTarget);
    await expect(second.locator("xpath=..")).toContainText("Status queued");
    expect(requests).toBe(1);
    releaseFirst();
    await expect.poll(() => requests).toBe(2);
    await expect(first).toBeEnabled();
    await expect(second).toBeEnabled();
    await page.reload();
    await panel.getByText("Admission paperwork & EHR handoff").click();
    await expect(statuses.nth(0)).toHaveValue(firstTarget);
    await expect(statuses.nth(1)).toHaveValue(secondTarget);
  } finally {
    releaseFirst();
  }
});

test("a failed paperwork change stays visible and can be retried", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Example Paperwork Retry ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  let requests = 0;
  await page.route(`**/api/referrals/${referral.id}/work-items/*`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    requests += 1;
    if (requests === 1) return route.fulfill({ status: 503, json: { error: "Synthetic save failure" } });
    return route.continue();
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const panel = page.getByRole("region", { name: "Admission decision", exact: true });
  await panel.getByText("Admission paperwork & EHR handoff").click();
  const status = panel.locator('select[aria-label$=" status"]').first();
  const original = await status.inputValue();
  const target = original === "received" ? "needed" : "received";
  await status.selectOption(target);
  await expect(status.locator("xpath=..")).toContainText("Status not saved");
  await expect(status).toHaveValue(original);
  await status.selectOption(target);
  await expect.poll(() => requests).toBe(2);
  await expect(status).toBeEnabled();
  await page.reload();
  await panel.getByText("Admission paperwork & EHR handoff").click();
  await expect(panel.locator('select[aria-label$=" status"]').first()).toHaveValue(target);
});

test("paperwork failure stays visible after leaving Decision for Files", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Example Decision Tab Save ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  let releaseFirst = () => {};
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let requests = 0;
  await page.route(`**/api/referrals/${referral.id}/work-items/*`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    requests += 1;
    if (requests === 1) {
      await firstGate;
      return route.fulfill({ status: 503, json: { error: "Synthetic save failure" } });
    }
    return route.continue();
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
    const panel = page.getByRole("region", { name: "Admission decision", exact: true });
    await panel.getByText("Admission paperwork & EHR handoff").click();
    const status = panel.locator('select[aria-label$=" status"]').first();
    const original = await status.inputValue();
    const target = original === "received" ? "needed" : "received";
    await status.selectOption(target);
    await expect.poll(() => requests).toBe(1);
    await page.getByRole("button", { name: "Workspace files", exact: true }).click();
    await expect(page.getByRole("region", { name: "Files", exact: true })).toBeVisible();
    await expect(page.getByText("1 paperwork change saving or queued…")).toBeVisible();
    releaseFirst();
    await expect(page.getByText("1 paperwork change not saved. Open Decision to retry.")).toBeVisible();
    await page.getByRole("button", { name: "Pipeline home", exact: true }).click();
    await expect(page.getByText("Leave with unsaved paperwork changes?", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stay and retry", exact: true }).click();
    await expect(page.getByRole("region", { name: "Files", exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Decision", exact: true }).click();
    await expect(status.locator("xpath=..")).toContainText("Status not saved");
    await expect(status).toHaveValue(original);
    await status.selectOption(target);
    await expect.poll(() => requests).toBe(2);
    await expect(page.getByText("1 paperwork change not saved. Open Decision to retry.")).toBeHidden();
    await page.reload();
    await panel.getByText("Admission paperwork & EHR handoff").click();
    await expect(panel.locator('select[aria-label$=" status"]').first()).toHaveValue(target);
  } finally {
    releaseFirst();
  }
});

test("an unrecorded decision draft survives an internal tab round-trip", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Example Decision Draft ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const panel = page.getByRole("region", { name: "Admission decision", exact: true });
  await panel.getByRole("radio", { name: "Accept", exact: true }).check();
  await panel.getByLabel("Reason (optional)", { exact: true }).fill("Synthetic draft retained while reviewing files.");
  await page.getByRole("button", { name: "Workspace files", exact: true }).click();
  await expect(page.getByRole("region", { name: "Files", exact: true })).toBeVisible();
  await expect(panel).toBeHidden();
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Decision", exact: true }).click();
  await expect(panel.getByRole("radio", { name: "Accept", exact: true })).toBeChecked();
  await expect(panel.locator("textarea").first()).toHaveValue("Synthetic draft retained while reviewing files.");
  await page.getByRole("button", { name: "Workspace files", exact: true }).click();
  await page.getByRole("button", { name: "Pipeline home", exact: true }).click();
  await expect(page.getByText("Leave without recording these changes?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByRole("region", { name: "Files", exact: true })).toBeVisible();
});
