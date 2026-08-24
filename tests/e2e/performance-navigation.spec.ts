import { expect, test } from "@playwright/test";

test.describe("Pipeline warm navigation and bounded reads", () => {
  test("keeps one shell and restores work surfaces through browser history", async ({ page }) => {
    let documentRequests = 0;
    page.on("request", (request) => {
      if (request.resourceType() === "document") documentRequests += 1;
    });

    await page.goto("/?view=referrals");
    await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
    await expect(page.locator('header[data-persistence-check="same-shell"]')).toBeVisible();
    expect(documentRequests).toBe(initialDocumentRequests);
  });

  test("loads the referral directory once without requesting a derived action worklist", async ({ page }) => {
    let directoryRequests = 0;
    let worklistRequests = 0;
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === "/api/referrals/directory") directoryRequests += 1;
      if (pathname === "/api/operations/referral-worklist") worklistRequests += 1;
    });

    await page.goto("/?view=referrals");
    await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
    await expect.poll(() => directoryRequests).toBe(1);
    expect(worklistRequests).toBe(0);

    await expect(page.getByRole("button", { name: "Needs action", exact: true })).toHaveCount(0);
    expect(worklistRequests).toBe(0);
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
