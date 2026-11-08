import { expect, test } from "@playwright/test";

test.skip(process.env.PIPELINE_MOCK_USER_ACCESS_SCOPE !== "note_lab", "Requires the isolated note-lab identity server.");

test("a lab-only account can use the lab but cannot enter Pipeline", async ({ page }) => {
  const lab = await page.goto("/note-lab/practice");
  expect(lab?.status()).toBe(200);
  await expect(page.getByTestId("standalone-review-shell")).toBeVisible();

  const identity = await page.request.get("/api/auth/me");
  expect(identity.status()).toBe(200);

  const referrals = await page.request.get("/api/referrals?limit=1");
  expect(referrals.status()).toBe(403);

  await page.goto("/");
  await expect(page).toHaveURL(/\/note-lab\/practice$/);

  // A lab-only identity is redirected before Pipeline resolves any page route.
  const retired = await page.request.get("/training/demo", { maxRedirects: 0 });
  expect(retired.status()).toBe(307);
  expect(new URL(retired.headers().location, page.url()).pathname).toBe("/note-lab/practice");
  await page.goto("/training/demo");
  await expect(page).toHaveURL(/\/note-lab\/practice$/);
  await expect(page.getByTestId("standalone-review-shell")).toBeVisible();
  await expect(page.getByTestId("packet-workspace")).toHaveCount(0);
});
