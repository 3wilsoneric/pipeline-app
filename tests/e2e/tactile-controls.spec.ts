import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

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
