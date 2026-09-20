import { expect, test, webkit } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";

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
  await expect(page.getByText("List saved locally.", { exact: true }).first()).toBeVisible();
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
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Turlock 2 contacts" }).click();
  await expect(page.getByRole("heading", { name: "San Pablo", exact: true })).toBeVisible();
  await page.unroute("**/api/community-recipient-lists");
  const current = (await (await request.get("/api/community-recipient-lists")).json()).lists[0];
  const update = await request.put("/api/community-recipient-lists", { data: { ...current, mutationId: crypto.randomUUID(), to: [{ name: "Remote", email: "remote@example.test" }] } });
  expect(update.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await expect(page.getByRole("alert", { name: "Contact list error" })).toContainText("changed in another tab");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload saved list" }).click();
  await expect(page.getByRole("button", { name: "Remove Remote from To" })).toBeVisible();
});

for (const width of [320, 390, 834, 1440]) {
  test(`contact chips and controls fit at ${width}px`, async ({ page }) => {
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    for (const button of await page.getByRole("button", { name: /^Remove / }).all()) {
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      if (mobile) { expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44); }
    }
    await page.getByRole("button", { name: "Save list", exact: true }).click();
    await expect(page.getByText("List saved locally.", { exact: true }).first()).toBeVisible();
  });
}

test("assessor account cannot read or write community mailing lists", async ({ page, request }) => {
  const switched = await request.post("/api/demo/persona", { data: { persona: "assessor" } });
  expect(switched.ok()).toBeTruthy();
  const cookies = await request.storageState();
  await page.context().addCookies(cookies.cookies);
  await page.goto(destination);
  await expect(page.getByRole("alert", { name: "Contact list error" })).toContainText("Insufficient role");
  expect((await request.get("/api/community-recipient-lists")).status()).toBe(403);
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
    await expect(page.getByText("List saved locally.", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.setViewportSize({ width: 834, height: 1112 });
    await page.getByRole("button", { name: "Remove Extra from Cc" }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove Extra from Cc" })).toBeVisible();
    await page.addScriptTag({ path: createRequire(resolve('package.json')).resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (element: Element, options: object) => Promise<{ violations: { id: string; impact: string }[] }> } }).axe;
      return (await axe.run(document.querySelector('form[aria-label="San Pablo contact list"]')!, { runOnly: ['wcag2a', 'wcag2aa'] })).violations;
    });
    expect(violations).toEqual([]);
  } finally { await browser.close(); }
});
