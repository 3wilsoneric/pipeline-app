import { expect, test } from "@playwright/test";

test("development removes stale desktop assets without clearing unrelated caches", async ({ page }) => {
  test.skip(process.env.PIPELINE_PREVIEW_E2E !== "true", "Requires the isolated development preview.");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const unrelated = await caches.open("unrelated-preview-cache");
    await unrelated.put("/unrelated-preview-asset", new Response("keep"));
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  // The unregistered worker releases its current clients on the next navigation.
  await page.reload();
  await expect.poll(() => page.evaluate(async () => ({
    workers: (await navigator.serviceWorker.getRegistrations()).length,
    pipelineCaches: (await caches.keys()).filter((key) => key.startsWith("pipeline-static-")),
    unrelated: (await caches.keys()).includes("unrelated-preview-cache"),
  }))).toEqual({ workers: 0, pipelineCaches: [], unrelated: true });
  await expect(page.locator('.pipeline-surfaces')).toHaveCSS("--surface-canvas", "#edf3f2");
});
