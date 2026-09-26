import { expect, test, webkit } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

test("iPad WebKit loads the app manifest and recovers from an offline launch", async ({ baseURL }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Requires the production app runtime.");
  // WebKit's setOffline can fail before its service worker handles navigation.
  // Cut the test origin's connection instead, exercising the real cached fallback.
  let disconnected = false;
  const origin = new URL(baseURL!);
  const server = createServer((request, response) => {
    if (disconnected) { request.socket.destroy(); return; }
    const upstream = httpRequest({
      hostname: origin.hostname, port: origin.port, protocol: origin.protocol,
      path: request.url, method: request.method, headers: { ...request.headers, host: origin.host },
    }, (result) => {
      response.writeHead(result.statusCode!, result.headers);
      result.pipe(response);
    });
    upstream.on("error", () => response.destroy());
    request.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await webkit.launch();
  const page = await browser.newPage({ baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true });
  try {
    await page.goto("/");
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).toContain("viewport-fit=cover");
    expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1(?:,|$)/);
    const manifestPath = await page.locator('link[rel="manifest"]').getAttribute("href");
    const response = await page.request.get(manifestPath!);
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest).toMatchObject({ name: "Pipeline", display: "standalone", orientation: "any", start_url: "/", scope: "/" });
    for (const icon of manifest.icons as { src: string }[]) {
      const response = await page.request.get(icon.src);
      expect(response.ok(), icon.src).toBeTruthy();
      expect(response.headers()["content-type"]).toContain("image/png");
    }
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    disconnected = true;
    await page.goto("/referrals", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "A connection is required.", exact: true })).toBeVisible();
    await expect(page.getByText("No current offline assessment is available", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    disconnected = false;
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Open referrals", exact: true })).toBeVisible();
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

for (const size of [
  { width: 390, height: 844, keyboardHeight: 430 },
  { width: 507, height: 768, keyboardHeight: 420 },
  { width: 834, height: 1194, keyboardHeight: 600 },
  { width: 1194, height: 834, keyboardHeight: 450 },
]) {
  test(`WebKit appointment controls remain above the keyboard at ${size.width}px`, async ({ baseURL }, info) => {
    const browser = await webkit.launch();
    const page = await browser.newPage({ baseURL, viewport: size, hasTouch: true, isMobile: true });
    try {
      await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=schedule");
      const dialog = page.getByRole("dialog", { name: "Schedule interview", exact: true });
      await dialog.getByLabel("Assessment method", { exact: true }).selectOption("phone");
      const phone = dialog.getByLabel("Phone number to call", { exact: true });
      await phone.fill("555-010-2026");
      // Exercise visual viewport handling; this does not launch an iPadOS keyboard.
      await page.evaluate((height) => {
        Object.defineProperties(window.visualViewport!, { height: { configurable: true, value: height }, offsetTop: { configurable: true, value: 12 } });
        window.visualViewport!.dispatchEvent(new Event("resize"));
      }, size.keyboardHeight);
      await expect.poll(async () => {
        const bounds = (await dialog.boundingBox())!;
        return bounds.y + bounds.height;
      }).toBeLessThanOrEqual(size.keyboardHeight + 12);
      await expect(phone).toBeFocused();
      const field = (await phone.boundingBox())!;
      const header = (await dialog.locator("header").boundingBox())!;
      const footer = (await dialog.locator("footer").boundingBox())!;
      expect(field.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      expect(field.y + field.height).toBeLessThanOrEqual(footer.y + 1);
      for (const label of ["Back to assessment", "Schedule interview"]) {
        const button = dialog.getByRole("button", { name: label, exact: true });
        const bounds = (await button.boundingBox())!;
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.keyboardHeight + 12);
      }
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      expect(await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
        return (await axe.run('[data-assessment-scheduling="modal"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
      })).toEqual([]);
      await page.screenshot({ path: info.outputPath("appointment-keyboard.png") });
      await page.evaluate(() => {
        for (const property of ["height", "offsetTop"]) Reflect.deleteProperty(window.visualViewport!, property);
        window.visualViewport!.dispatchEvent(new Event("resize"));
      });
      await expect(phone).toHaveValue("555-010-2026");
      await dialog.getByRole("button", { name: "Back to assessment", exact: true }).tap();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    } finally {
      await browser.close();
    }
  });
}
