import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`tactile commands stay immediate, stable and keyboard usable with ${reducedMotion} motion`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      const measured = window as unknown as { tactileStyleCosts: number[] };
      measured.tactileStyleCosts = [];
      document.addEventListener("pointerdown", (event) => {
        const command = (event.target as Element).closest(".pipeline-command");
        if (!command) return;
        const start = performance.now();
        getComputedStyle(command).getPropertyValue("scale");
        measured.tactileStyleCosts.push(performance.now() - start);
      }, true);
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
    const button = page.getByRole("button", { name: "Open calendar", exact: true });
    await expect(button).toBeVisible();
    await expect(button).toHaveJSProperty("clientWidth", 189);
    const resting = await button.evaluate((node) => ({ width: node.clientWidth, height: node.clientHeight }));
    await button.hover();
    await expect(button).not.toHaveCSS("box-shadow", "none");
    await page.waitForLoadState("networkidle");
    const apiRequests: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/")) apiRequests.push(request.url()); });
    const before = apiRequests.length;
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    for (let sample = 0; sample < 12; sample += 1) {
      await button.hover();
      await page.mouse.down();
      await expect(button).toHaveCSS("background-image", /linear-gradient/);
      await expect(button).toHaveCSS("scale", reducedMotion === "reduce" ? "none" : "0.97");
      await expect(button).toHaveJSProperty("clientWidth", resting.width);
      await expect(button).toHaveJSProperty("clientHeight", resting.height);
      if (sample === 0) await page.screenshot({ path: testInfo.outputPath(`pressed-${reducedMotion}.png`) });
      await page.mouse.move(1, 1);
      await page.mouse.up();
    }
    expect(apiRequests.length).toBe(before);
    const addedApiRequests = apiRequests.length - before;
    const costs = await page.evaluate(() => (window as unknown as { tactileStyleCosts: number[] }).tactileStyleCosts);
    expect(costs).toHaveLength(12);
    await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await button.focus();
    // Switch from mouse modality using real keyboard navigation; programmatic
    // focus after a mouse press correctly does not imply :focus-visible.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS("outline-style", "solid");
    await expect(button).toHaveCSS("outline-width", "2px");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/screen=calendar/);
    expect(costs.sort((a, b) => a - b)[Math.ceil(costs.length * 0.95) - 1]).toBeLessThan(5);
    await testInfo.attach("bounded-style-cost", { body: JSON.stringify({ samples: costs.length, cpuSlowdown: 4, maxPointerDownStyleReadMs: Math.max(...costs), addedApiRequests }), contentType: "application/json" });
    // No new runtime JavaScript or motion package: keep the added stylesheet tiny.
    expect(gzipSync(readFileSync("app/control-polish.css")).length).toBeLessThan(1500);
  });
}

test("disabled create action does not get hover or press animation", async ({ page }) => {
  await page.goto("/?view=referrals&screen=packet&draftId=tactile-disabled-control");
  const create = page.getByRole("button", { name: "Create referral", exact: true });
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  // Incomplete intake is allowed. The real disabled state is a pending save.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/referrals", async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  await create.click();
  await expect(create).toBeDisabled();
  await create.hover({ force: true });
  await page.mouse.down();
  await expect(create).toHaveCSS("scale", "none");
  await expect(create).toHaveCSS("background-image", "none");
  await page.mouse.up();
  release();
  await expect(page).toHaveURL(/referralId=\d+/);
});

test("workspace actions menu keeps the destructive action reachable behind its confirmation", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Menu Workspace", owner: "", tags: [] });
  let deletions = 0;
  page.on("request", (request) => { if (request.method() === "DELETE" && request.url().includes(`/api/referrals/${referral.id}`)) deletions += 1; });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
  const header = page.getByTestId("workspace-folder-header");
  await expect(header).toBeVisible();
  // The destructive action no longer sits beside the stage tabs.
  await expect(header.getByRole("button", { name: "Move workspace to trash" })).toHaveCount(0);
  const menu = header.locator('summary[aria-label="More workspace actions"]');
  await expect(menu).toBeVisible();
  const trigger = (await menu.boundingBox())!;
  expect(trigger.height).toBeGreaterThanOrEqual(44);
  expect(trigger.width).toBeGreaterThanOrEqual(44);
  await menu.focus();
  await page.keyboard.press("Enter");
  const trash = page.getByRole("button", { name: "Move workspace to trash", exact: true });
  await expect(trash).toBeVisible();
  expect((await trash.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(trash).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await trash.click();
  const dialog = page.getByRole("dialog", { name: "Move workspace to trash?", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("restored from Trash for 30 days");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(deletions).toBe(0);
  expect((await page.request.get(`/api/referrals/${referral.id}`)).status()).toBe(200);
});

for (const width of [1440, 834]) {
  test(`admission requirement controls and workspace status stay above micro-type at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Standard Workspace", owner: "", tags: [] });
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
    await page.locator("summary", { hasText: "Admission details" }).click();
    const requirement = page.getByRole("combobox", { name: /status$/ }).first();
    await expect(requirement).toBeVisible();
    const control = await requirement.evaluate((node) => ({ height: node.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(node).fontSize) }));
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.fontSize).toBeGreaterThanOrEqual(14);
    const stage = page.getByRole("combobox", { name: "Workflow stage", exact: true });
    expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Saving instructions and workflow distinctions stay readable.
    const smallEssential = await page.evaluate(() => {
      const essential = /\b(sav(e|ed|ing)|sync|unsaved|draft|pending|retry|sign(ed|ing)?|sent|decision|recorded|required|missing)\b/i;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const found: string[] = [];
      while (walker.nextNode()) {
        const element = walker.currentNode.parentElement;
        const text = walker.currentNode.textContent?.trim() ?? "";
        if (!element || text.length < 12 || !essential.test(text)) continue;
        const style = getComputedStyle(element);
        if (style.visibility === "hidden" || element.closest(".sr-only") || element.getBoundingClientRect().height === 0) continue;
        if (parseFloat(style.fontSize) <= 11) found.push(`${Math.round(parseFloat(style.fontSize))}px: ${text.slice(0, 60)}`);
      }
      return found;
    });
    expect(smallEssential).toEqual([]);
  });
}

test("keyboard focus in the workspace clears the sticky header and action footer", async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1112 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Focus Workspace", owner: "", tags: [] });
  await createOperationalAssessment(page.request, referral.id);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
  await expect(page.getByTestId("workspace-folder-header")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const obscured: string[] = [];
  for (let step = 0; step < 45; step += 1) {
    await page.keyboard.press("Tab");
    // Let the navigation rail finish its own transition before hit-testing.
    await page.waitForTimeout(220);
    const covered = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > innerHeight) return null;
      const hit = document.elementFromPoint(
        Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)),
        Math.max(0, Math.min(innerHeight - 1, rect.top + Math.min(rect.height / 2, 8))),
      );
      if (!hit || element.contains(hit) || hit.contains(element)) return null;
      const cover = hit.closest("header, footer, [data-testid='workspace-folder-header']");
      return cover ? `${(element.getAttribute("aria-label") || element.textContent || element.tagName).trim().slice(0, 40)} under ${cover.getAttribute("aria-label") ?? cover.tagName}` : null;
    });
    if (covered) obscured.push(covered);
  }
  expect(obscured).toEqual([]);
});
