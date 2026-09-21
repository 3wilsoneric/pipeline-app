import { expect, test, webkit } from "@playwright/test";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createOperationalAssessment, createOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "./support/operational-api";

test.skip(process.env.PORT !== "3355", "Uses a dedicated synthetic demo on port 3355, never real contact lists.");
const destination = "/settings/contact-lists";
const seed = () => ({ schema: 1, lists: ["San Pablo", "Santa Clarita", "Turlock", "Victoria's House", "JC Wallace"].map((community) => ({
  community, version: 1, sourceDates: ["2026-09-15"], updatedAt: null,
  to: [{ name: "Alex Taylor", email: "alex@example.test" }], cc: [{ name: "Casey Lee", email: "casey@example.test" }],
})) });

test.beforeEach(async () => {
  const directory = resolve(".data/persona-demo-3355");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "community-recipient-lists.json"), JSON.stringify(seed()), { mode: 0o600 });
});

test("remove, add, undo without dropping additions, save and reload", async ({ page }) => {
  await page.goto(destination);
  await page.getByRole("button", { name: "Remove Alex Taylor from To" }).click();
  await page.getByRole("combobox", { name: /^To/ }).fill("New Person <new@example.test>");
  await page.getByRole("combobox", { name: /^To/ }).press("Enter");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove New Person from To" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Alex Taylor from To" })).toBeVisible();
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await expect(page.getByText("Contact list saved.", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove New Person from To" })).toBeVisible();
});

test("autocomplete keyboard, duplicate prevention, invalid paste and pending input on Save", async ({ page }) => {
  await page.goto(destination);
  await page.getByRole("button", { name: "Remove Alex Taylor from To" }).click();
  const input = page.getByRole("combobox", { name: /^To/ });
  await input.fill("alex"); await input.press("ArrowDown"); await input.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Alex Taylor from To" })).toBeVisible();
  await input.fill("casey@example.test"); await input.press("Enter");
  await expect(page.getByRole("list", { name: "To recipients", exact: true }).locator("li")).toHaveCount(1);
  await input.fill("valid@example.test; not-an-email"); await input.press("Enter");
  await expect(page.getByRole("alert", { name: "Contact list error" })).toContainText("Use an email address");
  await expect(input).toHaveValue("valid@example.test; not-an-email");
  await input.fill("Pending <pending@example.test>");
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove Pending from To" })).toBeVisible();
});

test("save failure preserves edits; retry, conflict and switching are safe", async ({ page, request }) => {
  await page.goto(destination);
  await page.getByRole("button", { name: "Remove Alex Taylor from To" }).click();
  await page.route("**/api/community-recipient-lists", async (route) => route.request().method() === "PUT" ? route.fulfill({ status: 503, json: { error: "Temporarily unavailable. Try again." } }) : route.continue());
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Contact list error" })).toContainText("Temporarily unavailable");
  await expect(page.getByRole("button", { name: "Remove Alex Taylor from To" })).toHaveCount(0);
  await page.getByRole("button", { name: "Turlock 2 contacts" }).click();
  await page.getByRole("alertdialog", { name: "Switch communities?", exact: true }).getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByRole("heading", { name: "San Pablo", exact: true })).toBeVisible();
  await page.unroute("**/api/community-recipient-lists");
  const current = (await (await request.get("/api/community-recipient-lists")).json()).lists[0];
  const update = await request.put("/api/community-recipient-lists", { data: { ...current, mutationId: crypto.randomUUID(), to: [{ name: "Remote", email: "remote@example.test" }] } });
  expect(update.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Contact list error" })).toContainText("changed in another tab");
  await page.getByRole("button", { name: "Reload saved list" }).click();
  await page.getByRole("alertdialog", { name: "Reload the saved list?", exact: true }).getByRole("button", { name: "Reload saved list", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Remote from To" })).toBeVisible();
});

for (const width of [320, 390, 834, 1440]) {
  test(`contact chips and controls fit at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(destination);
    const mobile = width <= 760;
    if (mobile) await page.getByLabel("Community", { exact: true }).selectOption("Santa Clarita");
    else await page.getByRole("button", { name: "Santa Clarita 2 contacts" }).click();
    await expect(page.getByRole("heading", { name: "Santa Clarita", exact: true })).toBeVisible();
    const input = page.getByRole("combobox", { name: /^To/ });
    await input.fill('"Last, First" <long-address-for-phone-layout@example.test>; other@example.test');
    await input.press("Enter");
    await expect(page.getByRole("button", { name: "Remove Last, First from To" })).toBeVisible();
    await page.getByRole("form", { name: "Santa Clarita contact list" }).evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    // Measure settled controls, after the chip entrance transform has completed.
    await page.getByRole("list", { name: /^(To|Cc) recipients$/ }).evaluateAll(async (lists) => {
      await Promise.all(lists.flatMap((list) => list.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))));
    });
    for (const button of await page.getByRole("button", { name: /^Remove / }).all()) {
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      if (mobile) { expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44); }
    }
    await page.getByRole("button", { name: "Save list", exact: true }).click();
    await expect(page.getByText("Contact list saved.", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath(`community-contacts-${width}.png`), fullPage: true });
  });
}

test("managed defaults reach new handoffs; saved audiences change only after explicit replacement", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Community Defaults", owner: "", community: "San Pablo" });
  await signOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  await recordOperationalAcceptance(page.request, referral);
  const endpoint = `/api/referrals/${referral.id}/handoff-recipients`;
  let sends = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
  await page.goto(destination);
  await page.getByRole("combobox", { name: /^To/ }).fill("First addition <first@example.test>");
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await expect(page.getByText("Contact list saved.", { exact: true }).first()).toBeVisible();
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  const to = page.getByRole("list", { name: "To recipients", exact: true });
  await expect(to).toContainText("First addition");
  await page.getByRole("button", { name: "Remove Alex Taylor from To", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  await page.goto(destination);
  await page.getByRole("combobox", { name: /^To/ }).fill("Later addition <later@example.test>");
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await expect(page.getByText("Contact list saved.", { exact: true }).first()).toBeVisible();
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  await expect(to).toContainText("First addition");
  await expect(to).not.toContainText("Later addition");
  await expect(to).not.toContainText("Alex Taylor");
  const replace = page.getByRole("button", { name: "Use latest community list", exact: true });
  await replace.click();
  await page.getByRole("alertdialog", { name: "Use latest community list?", exact: true }).getByRole("button", { name: "Keep recipients", exact: true }).click();
  await expect(to).not.toContainText("Later addition");
  await replace.click();
  await page.getByRole("alertdialog", { name: "Use latest community list?", exact: true }).getByRole("button", { name: "Use latest list", exact: true }).click();
  await expect(to).toContainText("Later addition");
  await expect(to).toContainText("Alex Taylor");
  await expect(page.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  const saved = (await (await page.request.get(endpoint)).json()).draft;
  expect(saved.to.map((item: { email: string }) => item.email)).toEqual(["alex@example.test", "first@example.test", "later@example.test"]);
  await page.reload();
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  await expect(to).toContainText("Later addition");
  expect(sends).toBe(0);
});

test("assessors can load defaults but cannot manage shared lists", async ({ page, request }) => {
  const switched = await request.post("/api/demo/persona", { data: { persona: "assessor" } });
  expect(switched.ok()).toBeTruthy();
  const cookies = await request.storageState();
  await page.context().addCookies(cookies.cookies);
  await page.goto(destination);
  await expect(page.getByRole("list", { name: "To recipients", exact: true }).locator("li")).toHaveCount(1);
  await expect(page.getByText("View only. Change recipients on the individual handoff.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /^(To|Cc)/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save list", exact: true })).toHaveCount(0);
  const read = await request.get("/api/community-recipient-lists");
  expect(read.status()).toBe(200);
  expect((await read.json()).canManage).toBe(false);
  expect((await request.put("/api/community-recipient-lists", { data: { ...seed().lists[0], mutationId: crypto.randomUUID() } })).status()).toBe(403);
  expect((await (await request.get("/api/community-recipient-lists")).json()).lists[0].version).toBe(1);
});

test("navigation saves pending edits and stays put on failure", async ({ page }) => {
  await page.goto(destination);
  await page.getByRole("combobox", { name: /^Cc/ }).fill("nav@example.test");
  await page.route("**/api/community-recipient-lists", async (route) => route.request().method() === "PUT" ? route.fulfill({ status: 503, json: { error: "Save failed. Try again." } }) : route.continue());
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Contact list error" })).toContainText("Save failed");
  expect(page.url()).toContain(destination);
  await page.unroute("**/api/community-recipient-lists");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/u);
  await page.getByRole("link", { name: "Community contact lists" }).click();
  await expect(page.getByRole("button", { name: "Remove nav@example.test from Cc" })).toBeVisible();
});

test("Safari: dense lists remain usable on phone and iPad; accessible chip editor", async ({ baseURL }) => {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const data = seed();
    data.lists[0].to = Array.from({ length: 15 }, (_, index) => ({ name: `Team Member ${index + 1}`, email: `member${index + 1}@example.test` }));
    data.lists[0].cc = Array.from({ length: 7 }, (_, index) => ({ name: `Office Member ${index + 1}`, email: `office${index + 1}@example.test` }));
    await writeFile(resolve('.data/persona-demo-3355/community-recipient-lists.json'), JSON.stringify(data));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(destination);
    await expect(page.getByRole("list", { name: "To recipients", exact: true }).locator('li')).toHaveCount(15);
    await page.getByRole("combobox", { name: /^Cc/ }).fill("Extra <extra@example.test>");
    await page.getByRole("button", { name: "Save list", exact: true }).click();
    await expect(page.getByText("Contact list saved.", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.setViewportSize({ width: 834, height: 1112 });
    await page.getByRole("button", { name: "Remove Extra from Cc" }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove Extra from Cc" })).toBeVisible();
    // Measure the settled chip colors, not a frame halfway through its entrance fade.
    await page.getByRole("form", { name: "San Pablo contact list" }).evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
    });
    await page.addScriptTag({ path: createRequire(resolve('package.json')).resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (element: Element, options: object) => Promise<{ violations: { id: string; impact: string }[] }> } }).axe;
      return (await axe.run(document.querySelector('form[aria-label="San Pablo contact list"]')!, { runOnly: ['wcag2a', 'wcag2aa'] })).violations;
    });
    expect(violations).toEqual([]);
  } finally { await browser.close(); }
});

test("a fresh preview opens contact settings and saves its first recipient list", async ({ page }) => {
  await unlink(resolve(".data/persona-demo-3355/community-recipient-lists.json"));
  await page.goto("/settings");
  const contacts = page.getByRole("region", { name: "Contacts", exact: true });
  await expect(contacts).toBeInViewport();
  await contacts.getByRole("link", { name: /Community contact lists/ }).click();
  await expect(page.getByRole("heading", { name: "San Pablo", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /0 contacts/ })).toHaveCount(5);
  await expect(page.getByRole("alert", { name: "Contact list error" })).toHaveCount(0);
  const input = page.getByRole("combobox", { name: /^To/ });
  await input.fill("First Contact <first@example.test>");
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await expect(page.getByText("List saved locally.", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove First Contact from To" })).toBeVisible();
});
