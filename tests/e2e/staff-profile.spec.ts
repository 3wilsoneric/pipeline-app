import { expect, test } from "@playwright/test";

type ProfilePayload = {
  member: {
    display_name: string;
    email: string | null;
    roles: string[];
    identity_status: string;
    profile: {
      preferred_name: string | null;
      job_title: string | null;
      team: string | null;
      work_phone: string | null;
      time_zone: string | null;
      status_message: string | null;
      version: number;
    };
  };
};

test("keeps account identity locked and profile settings editable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open profile menu for Playwright QA" }).click();
  await expect(page.getByRole("dialog", { name: "Profile settings" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Team presence" })).toHaveCount(0);
  await page.getByRole("link", { name: "Profile settings Account and display preferences" }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Profile settings" })).toBeVisible();
  await expect(page.getByText("Playwright QA", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Microsoft verified", { exact: true }).first()).toBeVisible();

  const originalResponse = await page.request.get("/api/me/profile");
  expect(originalResponse.status()).toBe(200);
  const original = await originalResponse.json() as ProfilePayload;
  const status = `Available for testing ${Date.now()}`;

  await page.getByLabel("Status message").fill(status);
  await page.getByLabel("Time zone").selectOption("America/Los_Angeles");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile preferences saved.", { exact: true })).toBeVisible();

  const savedResponse = await page.request.get("/api/me/profile");
  const saved = await savedResponse.json() as ProfilePayload;
  expect(saved.member.display_name).toBe(original.member.display_name);
  expect(saved.member.email).toBe(original.member.email);
  expect(saved.member.roles).toEqual(original.member.roles);
  expect(saved.member.identity_status).toBe(original.member.identity_status);
  expect(saved.member.profile.status_message).toBe(status);
  expect(saved.member.profile.time_zone).toBe("America/Los_Angeles");
  expect(saved.member.profile.version).toBeGreaterThan(original.member.profile.version);

  const staleResponse = await page.request.patch("/api/me/profile", {
    data: { if_match: original.member.profile.version, profile: original.member.profile },
  });
  expect(staleResponse.status()).toBe(409);

  const restoreResponse = await page.request.patch("/api/me/profile", {
    data: { if_match: saved.member.profile.version, profile: original.member.profile },
  });
  expect(restoreResponse.status()).toBe(200);
});

test("rejects invalid and cross-origin profile setting changes", async ({ page }) => {
  await page.goto("/");
  const current = await page.request.get("/api/me/profile");
  const payload = await current.json() as ProfilePayload;

  const invalid = await page.request.patch("/api/me/profile", {
    data: {
      if_match: payload.member.profile.version,
      profile: { ...payload.member.profile, time_zone: "Not/A_Time_Zone" },
    },
  });
  expect(invalid.status()).toBe(400);

  const crossOrigin = await page.request.patch("/api/me/profile", {
    headers: { Origin: "https://attacker.example" },
    data: { if_match: payload.member.profile.version, profile: payload.member.profile },
  });
  expect(crossOrigin.status()).toBe(403);
});

test("keeps profile settings usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open profile menu for Playwright QA" }).click();
  await expect(page.getByRole("dialog", { name: "Profile settings" })).toBeVisible();
  await page.getByRole("link", { name: "Profile settings Account and display preferences" }).click();
  await expect(page.getByRole("form", { name: "Profile settings" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
