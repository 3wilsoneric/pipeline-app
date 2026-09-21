import { expect, test, webkit } from "@playwright/test";

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
  await page.getByRole("link", { name: "Settings Your profile and contacts" }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  const identities = page.getByRole("region", { name: "Account & access" }).getByText("Playwright QA", { exact: true });
  await expect(identities).toHaveCount(1);
  for (const identity of await identities.all()) await expect(identity).toBeVisible();
  await expect(page.getByText("Microsoft verified", { exact: true }).first()).toBeVisible();

  const originalResponse = await page.request.get("/api/me/profile");
  expect(originalResponse.status()).toBe(200);
  const original = await originalResponse.json() as ProfilePayload;
  const status = `Available for testing ${Date.now()}`;

  await page.getByLabel("Status message").fill(status);
  await page.getByLabel("Profile time zone").selectOption("America/Los_Angeles");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();

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
  await page.getByRole("button", { name: /^Open page menu/ }).click();
  await page.getByRole("button", { name: "Open profile menu for Playwright QA" }).click();
  await expect(page.getByRole("dialog", { name: "Profile settings" })).toBeVisible();
  await page.getByRole("link", { name: "Settings Your profile and contacts" }).click();
  await expect(page.getByRole("form", { name: "Profile settings" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

const profileFixture = () => ({ member: {
  id: "settings-fixture", display_name: "Settings Tester", email: "settings@example.test", roles: ["admin"], identity_status: "entra_linked",
  profile: { preferred_name: null, job_title: null, team: null, work_phone: null, time_zone: null, status_message: null, version: 1, updated_at: null },
} });

test("profile conflict preserves local edits and carries forward remote changes for review", async ({ page }) => {
  const original = profileFixture();
  let writes = 0;
  await page.route("**/api/me/profile", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: original });
    writes++;
    const latest = { ...original, member: { ...original.member, profile: { ...original.member.profile, job_title: "Updated elsewhere", preferred_name: "Remote name", version: 2 } } };
    if (writes === 1) return route.fulfill({ status: 409, json: { error: "Profile changed", ...latest } });
    const body = route.request().postDataJSON();
    expect(body.if_match).toBe(2);
    expect(body.profile).toMatchObject({ preferred_name: "My edit", job_title: "Updated elsewhere" });
    return route.fulfill({ json: { member: { ...latest.member, profile: { ...body.profile, version: 3 } } } });
  });
  await page.goto("/settings");
  await page.getByLabel("Preferred name", { exact: true }).fill("My edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Your edits are still here");
  await expect(page.getByLabel("Preferred name", { exact: true })).toHaveValue("My edit");
  await expect(page.getByLabel("Job title", { exact: true })).toHaveValue("Updated elsewhere");
  await page.getByRole("button", { name: "Save reviewed changes", exact: true }).click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
  expect(writes).toBe(2);
});

test("failed profile load can retry and failed saves keep the entered text", async ({ page }) => {
  let available = false;
  let canSave = false;
  const original = profileFixture();
  await page.route("**/api/me/profile", async (route) => {
    if (route.request().method() === "GET") return route.fulfill(available ? { json: original } : { status: 503, json: { error: "Settings unavailable" } });
    return route.fulfill(canSave ? { json: { member: { ...original.member, profile: { ...route.request().postDataJSON().profile, version: 2 } } } } : { status: 503, json: { error: "Save unavailable" } });
  });
  await page.goto("/settings");
  await expect(page.locator("main").getByRole("alert")).toContainText("Settings unavailable");
  available = true;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByLabel("Preferred name", { exact: true }).fill("Retained text");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("Save unavailable");
  await expect(page.getByLabel("Preferred name", { exact: true })).toHaveValue("Retained text");
  canSave = true;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
});

test("pending profile save blocks navigation and further editing until the response arrives", async ({ page }) => {
  const original = profileFixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  await page.route("**/api/me/profile", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: original });
    writes++;
    await gate;
    return route.fulfill({ json: { member: { ...original.member, profile: { ...route.request().postDataJSON().profile, version: 2 } } } });
  });
  try {
    await page.goto("/settings");
    await page.getByLabel("Preferred name", { exact: true }).fill("Saving name");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByLabel("Preferred name", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Open referrals", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole("link", { name: "Edit Home", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    expect(writes).toBe(1);
    release();
    await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Preferred name", { exact: true })).toBeEnabled();
  } finally { release(); }
});

test("leaving unsaved profile edits requires an explicit discard in the site dialog", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/me/profile", async (route) => {
    if (route.request().method() === "PATCH") writes++;
    return route.fulfill({ json: profileFixture() });
  });
  await page.goto("/settings");
  await page.getByLabel("Preferred name", { exact: true }).fill("Keep this");
  await page.getByRole("button", { name: "Open referrals", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Leave without saving?", exact: true });
  await dialog.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Preferred name", { exact: true })).toHaveValue("Keep this");
  await page.getByRole("link", { name: "Edit Home", exact: true }).click();
  await dialog.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page).toHaveURL(/editHome=1/);
  expect(writes).toBe(0);
});

for (const account of [
  { name: "Eric Wilson", email: "ericwilsonalamo@outlook.com", roles: ["admin"] },
  { name: "Andrew Dominici", email: "andrew@aaahealthservices.com", roles: ["assessment_coordinator", "reviewer", "viewer"] },
  { name: "Sandeep Singh", email: "sandeep@aaahealthservices.com", roles: ["assessment_coordinator", "reviewer", "viewer"] },
]) {
  test(`${account.name} gets the same prominent contact directory controls`, async ({ page }) => {
    const fixture = profileFixture();
    await page.route("**/api/me/profile", (route) => route.fulfill({ json: { member: { ...fixture.member, display_name: account.name, email: account.email, roles: account.roles } } }));
    await page.goto("/settings");
    const contacts = page.getByRole("region", { name: "Contacts", exact: true });
    await expect(contacts).toBeInViewport();
    const profile = page.getByRole("heading", { name: "Your profile", exact: true });
    expect((await contacts.boundingBox())!.y).toBeLessThan((await profile.boundingBox())!.y);
    await page.locator("summary").filter({ hasText: "Contact & facility directory" }).click();
    await expect(page.getByRole("button", { name: "CSV template", exact: true })).toBeVisible();
    await expect(page.getByLabel("Contacts or referral facilities CSV", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeDisabled();
  });
}

test("unassigned roles do not see directory controls", async ({ page }) => {
  const fixture = profileFixture();
  await page.route("**/api/me/profile", (route) => route.fulfill({ json: { member: { ...fixture.member, roles: [] } } }));
  await page.goto("/settings");
  await expect(page.getByRole("form", { name: "Profile settings", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Contacts", exact: true })).toHaveCount(0);
});

for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 834, height: 1194 }, { width: 1194, height: 834 }]) {
  test(`Settings is readable and usable in touch WebKit at ${size.width}px`, async ({ baseURL }, info) => {
    const browser = await webkit.launch();
    const page = await browser.newPage({ baseURL, viewport: size, hasTouch: true, isMobile: true });
    try {
      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "Your profile", exact: true })).toBeVisible();
      await page.locator("summary").filter({ hasText: "Contact & facility directory" }).click();
      await page.getByLabel("Contacts or referral facilities CSV", { exact: true }).setInputFiles({ name: "settings-fixture.csv", mimeType: "text/csv", buffer: Buffer.from("organization,email\nSettings Fixture,settings@example.test") });
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(page.getByRole("region", { name: "Contact import preview", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (const control of await page.getByRole("form", { name: "Profile settings", exact: true }).locator("input, select, button").all()) {
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.getByLabel("Preferred name", { exact: true }).evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");
      await page.screenshot({ path: info.outputPath(`settings-directory-${size.width}.png`) });
      await page.getByLabel("Status message", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`settings-profile-${size.width}.png`) });
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
        return (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }));
      });
      expect(violations).toEqual([]);
    } finally { await browser.close(); }
  });
}
