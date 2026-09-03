import { expect, test } from "@playwright/test";

test("clarifies workflow questions without replacing record search", async ({ page }) => {
  const searchRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/search") {
      searchRequests.push(request.url());
    }
  });

  await page.goto("/?view=referrals");
  await page.getByRole("button", { name: "Open search" }).click();

  const input = page.getByRole("textbox", { name: "Search or ask" });
  await input.fill("how do i assine an assesment to an assesor?");

  await expect(page.getByRole("heading", { name: "Did you mean?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assign an assessor", exact: true })).toBeVisible();
  await expect.poll(() => searchRequests).toHaveLength(0);

  await page.getByRole("button", { name: "Assign an assessor", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Assign an assessor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open workspaces" })).toBeVisible();

  const ordinarySearch = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/search" && url.searchParams.get("q") === "Antonia Albarran";
  });
  await input.fill("Antonia Albarran");
  await ordinarySearch;

  await expect(page.getByRole("heading", { name: "Did you mean?" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Assign an assessor" })).toHaveCount(0);
});
