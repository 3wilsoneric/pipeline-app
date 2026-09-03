import { expect, test } from "@playwright/test";

test("God mode opens another account with full administrator authority", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Open profile menu for Playwright QA" }).click();
  await page.getByRole("button", { name: /God mode/ }).click();

  const picker = page.getByRole("dialog", { name: "God mode" });
  await expect(picker).toBeVisible();
  await expect(picker.getByText("Imported Allo account", { exact: true })).toHaveCount(8);
  await picker.getByRole("button", { name: /Jazmine Saldana Imported Allo account/ }).click();

  await expect(page.getByRole("button", { name: "Exit God mode for Jazmine Saldana" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open profile menu for Jazmine Saldana" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.getByRole("button", { name: "Exit God mode for Jazmine Saldana" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  const effectiveIdentity = await page.request.get("/api/auth/me");
  expect(effectiveIdentity.status()).toBe(200);
  await expect(effectiveIdentity.json()).resolves.toMatchObject({
    user: {
      id: "provisional:allo:jazmine-saldana",
      email: "",
      name: "Jazmine Saldana",
      roles: ["admin", "assessment_coordinator", "reviewer", "viewer"],
      delegation: {
        initiatedBy: { name: "Playwright QA" },
        target: { id: "provisional:allo:jazmine-saldana" },
      },
    },
  });

  const signatureAccess = await page.evaluate(async () => {
    const response = await fetch("/api/assessments/not-a-real-assessment/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return { status: response.status, body: await response.text() };
  });
  expect(signatureAccess.status, signatureAccess.body).toBe(404);

  await page.getByRole("button", { name: "Exit God mode for Jazmine Saldana" }).click();
  await expect(page.getByRole("button", { name: "Open profile menu for Playwright QA" })).toBeVisible();

  const restoredIdentity = await page.request.get("/api/auth/me");
  expect(restoredIdentity.status()).toBe(200);
  await expect(restoredIdentity.json()).resolves.toMatchObject({
    user: {
      name: "Playwright QA",
      roles: expect.arrayContaining(["admin"]),
    },
  });
});

test("God mode rejects a cross-origin browser mutation", async ({ request }) => {
  const response = await request.post("/api/auth/assessor-session", {
    headers: { Origin: "https://attacker.example" },
    data: { target_principal_id: "provisional:allo:jazmine-saldana" },
  });

  expect(response.status()).toBe(403);
});
