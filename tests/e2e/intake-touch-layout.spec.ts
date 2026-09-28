import { expect, test, chromium, webkit, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

for (const [engine, browserType] of [["Chromium", chromium], ["WebKit", webkit]] as const) {
  test(`${engine} intake remains usable through touch, rotation and keyboard resizing`, async ({ baseURL }, info) => {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
      await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
      const workspace = page.getByTestId("packet-workspace");
      await expect(workspace).toHaveAttribute("aria-busy", "false");
      const name = page.locator('[data-workspace-field="name"] input');
      const header = page.getByTestId("workspace-folder-header");
      const dock = page.getByTestId("primary-navigation-dock");

      for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size);
        // Document review stays collapsed; short landscape screens can scroll to the field.
        const review = page.getByRole("region", { name: "Extraction review", exact: true });
        await expect(review).toBeHidden();
        // The current attachment-first intake places identity below the upload
        // area; assert reachability, not the retired fixed vertical offset.
        await name.scrollIntoViewIfNeeded();
        await expect(name).toBeInViewport();
        await expect(name).toHaveCSS("font-size", "16px");
        await expect(page.getByTestId("document-checklist-panel")).not.toHaveAttribute("open");
        const controls = [...await header.getByRole("button").all(), ...await page.locator(size.width < 640 ? "[data-phone-header] > div" : '[data-testid="primary-navigation-dock"]').getByRole("button").all()];
        for (const control of controls) {
          const box = (await control.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(size.width);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (size.width < 640) {
          expect((await page.locator("[data-pipeline-header]").boundingBox())!.height).toBeLessThanOrEqual(56);
          await expect(dock).toBeHidden();
          const content = await page.locator(".pipeline-surfaces main").first().boundingBox();
          expect(content!.y).toBeGreaterThanOrEqual((await page.locator("[data-phone-header]").boundingBox())!.height);
          expect(content!.y + content!.height).toBeLessThanOrEqual(size.height + 1);
        }
        await page.screenshot({ path: info.outputPath(`intake-${engine}-${size.width}.png`), animations: "disabled" });
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await name.tap();
      const surname = randomUUID().replace(/[^a-z]/g, "");
      const clientName = `Touch ${surname[0].toUpperCase()}${surname.slice(1)}`;
      await name.fill(clientName);
      // Visual-viewport simulation checks our layout response, not a physical keyboard.
      await resizeVisualViewport(page, 430);
      await expect(page.locator(".pipeline-surfaces")).toHaveAttribute("data-mobile-keyboard", "true");
      await expect(dock).toBeHidden();
      await expect(name).toBeFocused();
      await expect.poll(async () => (await name.boundingBox())!.y).toBeGreaterThanOrEqual((await header.boundingBox())!.height);
      expect((await name.boundingBox())!.y + (await name.boundingBox())!.height).toBeLessThanOrEqual(430);
      await page.screenshot({ path: info.outputPath(`intake-${engine}-keyboard.png`) });
      const email = page.locator('[data-workspace-field="email"] input');
      await email.tap();
      await email.fill("touch-layout@example.invalid");
      await expect(email).toBeFocused();
      await expect.poll(async () => (await email.boundingBox())!.y).toBeGreaterThanOrEqual((await header.boundingBox())!.height);
      expect((await email.boundingBox())!.y + (await email.boundingBox())!.height).toBeLessThanOrEqual(430);
      await page.screenshot({ path: info.outputPath(`intake-${engine}-deep-field-keyboard.png`) });
      await page.evaluate(() => {
        Reflect.deleteProperty(window.visualViewport!, "height");
        window.visualViewport!.dispatchEvent(new Event("resize"));
      });
      await email.blur();
      await expect(page.getByRole("button", { name: /^Open page menu/ })).toBeVisible();
      await expect(name).toHaveValue(clientName);
      await header.getByRole("button", { name: "Create referral", exact: true }).tap();
      await expect(page).toHaveURL(/referralId=\d+/);
      const savedReferralId = new URL(page.url()).searchParams.get("referralId");
      await expect(header.getByRole("button", { name: "Create referral", exact: true })).toHaveCount(0);
      await page.getByRole("dialog", { name: "Workspace created", exact: true }).getByRole("button", { name: "Close workspace created", exact: true }).tap();
      await header.getByLabel("Workspace view", { exact: true }).selectOption({ label: "Assessment" });
      await expect(page.locator('[data-assessment-phase="preparation"]')).toBeVisible();
      await page.screenshot({ path: info.outputPath(`preparation-${engine}-phone.png`) });
      for (const width of [768, 1024, 1194]) {
        await page.setViewportSize({ width, height: 900 });
        const preparedName = page.getByRole("textbox", { name: "Resident name", exact: true });
        await expect(preparedName).toHaveValue(clientName);
        expect((await preparedName.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect((await page.getByRole("button", { name: "Next section", exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        const preparation = page.getByTestId("assessment-client-folder");
        await expect(preparation.locator(":scope > strong")).toHaveCount(0);
        const headerBox = (await header.boundingBox())!;
        expect(Math.abs((await preparation.boundingBox())!.y - headerBox.y - headerBox.height)).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`preparation-${engine}-${width}.png`), animations: "disabled" });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await header.getByLabel("Workspace view", { exact: true }).selectOption({ label: "Chart" });
      await page.getByRole("button", { name: "Edit referral details", exact: true }).tap();
      await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe(savedReferralId);
      const savedReferral = await (await page.request.get(`/api/referrals/${savedReferralId}`)).json();
      expect(savedReferral.referral.name).toBe(clientName);
      await expect(name).toHaveValue(clientName);
      await header.getByLabel("Workspace view", { exact: true }).selectOption({ label: "Files" });
      await expect(header.getByLabel("Workspace view", { exact: true })).toHaveValue("files");
      await header.getByLabel("Workspace view", { exact: true }).selectOption({ label: "Chart" });
      await page.getByRole("button", { name: "Edit referral details", exact: true }).tap();
      await page.reload();
      await expect(name).toHaveValue(clientName);
      await expect(email).toHaveValue("touch-layout@example.invalid");
      await page.getByRole("button", { name: /^Open page menu/ }).tap();
      await page.getByRole("button", { name: "Open referrals", exact: true }).tap();
      await expect(page.getByRole("main", { name: "Referral workspaces", exact: true })).toBeVisible();
      await page.getByRole("button", { name: /^Open page menu/ }).tap();
      await page.getByRole("button", { name: /^Open profile menu for/ }).tap();
      await expect(page.getByRole("dialog", { name: "Profile settings", exact: true })).toBeInViewport();
      expect(await page.locator('meta[name="viewport"]').getAttribute("content")).not.toMatch(/user-scalable=no|maximum-scale=1/);
    } finally {
      await browser.close();
    }
  });
}

async function resizeVisualViewport(page: Page, height: number) {
  await page.evaluate((height) => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: height });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  }, height);
}
