import { expect, test } from "@playwright/test";

test.describe("Pipeline warm navigation and bounded reads", () => {
  test("keeps one shell and restores work surfaces through browser history", async ({ page }) => {
    let documentRequests = 0;
    page.on("request", (request) => {
      if (request.resourceType() === "document") documentRequests += 1;
    });

    await page.goto("/?view=referrals");
    await expect(page.getByRole("heading", { name: "Referral packets", exact: true })).toBeVisible();
    const initialDocumentRequests = documentRequests;
    await page.locator("header").evaluate((header) => {
      header.setAttribute("data-persistence-check", "same-shell");
    });

    await page.getByRole("button", { name: "Open client profiles", exact: true }).click();
    await expect(page.getByLabel("Search clients", { exact: true })).toBeVisible();
    await expect(page.locator('header[data-persistence-check="same-shell"]')).toBeVisible();

    await page.getByRole("button", { name: "Create new referral", exact: true }).click();
    await expect(page.getByTestId("packet-workspace")).toBeVisible();
    expect(documentRequests).toBe(initialDocumentRequests);

    await page.goBack();
    await expect(page.getByLabel("Search clients", { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Referral packets", exact: true })).toBeVisible();
    await expect(page.locator('header[data-persistence-check="same-shell"]')).toBeVisible();
    expect(documentRequests).toBe(initialDocumentRequests);
  });

  test("loads the referral directory once and defers the action worklist", async ({ page }) => {
    let directoryRequests = 0;
    let worklistRequests = 0;
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/referrals/directory") directoryRequests += 1;
      if (pathname === "/api/operations/referral-worklist") worklistRequests += 1;
    });

    await page.goto("/?view=referrals");
    await expect(page.getByRole("heading", { name: "Referral packets", exact: true })).toBeVisible();
    await expect.poll(() => directoryRequests).toBe(1);
    expect(worklistRequests).toBe(0);

    await page.getByRole("button", { name: "Needs action", exact: true }).click();
    await expect(page.getByRole("region", { name: "Referral action worklist" })).toBeVisible();
    await expect.poll(() => worklistRequests).toBe(1);
  });

  test("exposes an opaque referral change sequence", async ({ request }) => {
    const listResponse = await request.get("/api/referrals?limit=1");
    expect(listResponse.ok()).toBeTruthy();
    const list = await listResponse.json() as { revision: number };

    const unchangedResponse = await request.get(`/api/referrals/changes?after=${list.revision}`);
    expect(unchangedResponse.ok()).toBeTruthy();
    expect(unchangedResponse.headers()["server-timing"]).toMatch(/^app;dur=\d+$/);
    await expect(unchangedResponse.json()).resolves.toEqual({
      changed: false,
      sequence: list.revision,
    });

    const invalidResponse = await request.get("/api/referrals/changes?after=not-a-sequence");
    expect(invalidResponse.status()).toBe(400);
  });
});
