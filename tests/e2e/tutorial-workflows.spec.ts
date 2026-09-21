import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

async function library(page: Page) {
  await expect(page.locator('[data-pipeline-ready="guided-coach"]')).toBeAttached();
  const more = page.getByRole("button", { name: /^Open page menu/ });
  if (await more.isVisible()) await more.click();
  await page.getByRole("button", { name: "Open guided tutorials" }).click();
  return page.getByRole("dialog", { name: "Tutorials", exact: true });
}

function observeLiveWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && /\/api\/(assessments|referrals|files|uploads|packets|demo|me\/(assessment-drafts|referral-drafts))([/?]|$)/.test(new URL(request.url()).pathname)) writes.push(request.method() + " " + request.url());
  });
  return writes;
}

async function chooseStep(page: Page, index: number) {
  await page.locator("#tutorial-step").selectOption(String(index));
  await expect(page.locator("#tutorial-step")).toHaveValue(String(index));
}

async function checkAccess(page: Page, selector: string) {
  await page.addScriptTag({ path: createRequire(process.cwd() + "/package.json").resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async (include) => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
    return (await axe.run({ include: [include] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
  }, selector);
  expect(violations).toEqual([]);
}

for (const width of [1440, 390]) {
  test("compact menu launches a fictional referral at " + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const panel = await library(page);
    await expect(panel.getByRole("button", { name: "Create a referral & add files", exact: true })).toBeVisible();
    await expect(panel.locator("button:disabled")).toHaveCount(0);
    await expect(panel.getByText(/open a referral|in this workspace|Show control/i)).toHaveCount(0);
    await checkAccess(page, '[role="dialog"][aria-label="Tutorials"]');
    await page.screenshot({ path: info.outputPath("library.png") });
    await panel.getByRole("button", { name: /Walk through a referral/ }).click();
    await expect(page).toHaveURL(/\/tutorials\/referral\?/);
    await expect(page.getByTestId("tutorial-referral-session")).toBeVisible();
    await expect(page.locator('[data-guide-target="home-board-card"]')).toHaveCount(1);
    await expect(page.locator('[data-guide-target="home-board-card"]')).toContainText("Schedule the assessment");
    expect(new URL(page.url()).searchParams.has("referralId")).toBe(false);
    await page.screenshot({ path: info.outputPath("board.png") });
  });
}

for (const width of [1440, 1024, 390]) {
  test("all steps fit and never mutate live data at " + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = observeLiveWrites(page);
    await page.goto("/tutorials/referral");
    for (let index = 0; index < 9; index++) {
      await chooseStep(page, index);
      const guide = page.getByRole("complementary", { name: "Tutorial steps", exact: true });
      await expect(guide.getByRole("navigation", { name: "Tutorial navigation" }).getByRole("button")).toHaveCount(2);
      const guideBox = (await guide.boundingBox())!;
      expect(guideBox.x).toBeGreaterThanOrEqual(0);
      expect(guideBox.x + guideBox.width).toBeLessThanOrEqual(width + 1);
      expect(guideBox.y + guideBox.height).toBeLessThanOrEqual(901);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (index === 2) {
        const dialog = page.getByRole("dialog", { name: "Schedule interview", exact: true });
        await expect(dialog).toBeVisible();
        const box = (await dialog.boundingBox())!;
        if (width >= 960) expect(box.x + box.width).toBeLessThanOrEqual(guideBox.x + 1);
        else expect(box.y + box.height).toBeLessThanOrEqual(guideBox.y + 1);
      }
      if ([2, 3, 4, 5, 6].includes(index)) await page.screenshot({ path: info.outputPath(`step-${index}.png`) });
    }
    expect(writes).toEqual([]);
  });
}

test("intake edits survive Next and Back; restart and refresh reset them", async ({ page }) => {
  const writes = observeLiveWrites(page);
  await page.goto("/tutorials/referral?task=create-referral");
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill("Morgan Testcase");
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Schedule interview", exact: true })).toContainText("Morgan Testcase");
  await chooseStep(page, 1);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Morgan Testcase");
  await page.getByRole("button", { name: "Restart tutorial", exact: true }).click();
  await expect(page.locator("#tutorial-step")).toHaveValue("0");
  await chooseStep(page, 1);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Taylor Rivera");
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill("Changed again");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Taylor Rivera");
  expect(writes).toEqual([]);
});

test("scheduling saves locally and retains the chosen time", async ({ page }) => {
  const writes = observeLiveWrites(page);
  await page.goto("/tutorials/referral?task=start-assessment");
  const dialog = page.getByRole("dialog", { name: "Schedule interview", exact: true });
  await dialog.getByLabel("Assessment date and time", { exact: true }).fill("2026-10-02T10:00");
  await dialog.getByLabel("Assessment method", { exact: true }).selectOption("phone");
  await dialog.getByLabel("Phone number to call", { exact: true }).fill("5550100200");
  await dialog.getByRole("button", { name: "Schedule interview", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#tutorial-step")).toHaveValue("3");
  await chooseStep(page, 2);
  await expect(dialog.getByLabel("Assessment date and time", { exact: true })).toHaveValue("2026-10-02T10:00");
  expect(writes).toEqual([]);
});

test("assessment edits survive review and return", async ({ page }) => {
  const writes = observeLiveWrites(page);
  await page.goto("/tutorials/referral?task=complete-assessment");
  await page.getByLabel("Assessment section", { exact: true }).selectOption("provenance_qc");
  const answer = page.locator('[data-working-field="placement_process_questions"] textarea');
  await answer.fill("Fictional answer retained across steps.");
  await chooseStep(page, 4);
  await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("Fictional answer retained across steps.");
  await chooseStep(page, 3);
  await page.getByLabel("Assessment section", { exact: true }).selectOption("provenance_qc");
  await page.getByRole("button", { name: /Edit Placement questions/ }).click();
  await expect(answer).toHaveValue("Fictional answer retained across steps.");
  expect(writes).toEqual([]);
});

test("sign, accept, preview and simulate send stay local without confirming admission", async ({ page }, info) => {
  const writes = observeLiveWrites(page);
  await page.goto("/tutorials/referral?task=review-chart");
  await page.locator('[data-guide-target="assessment-sign"]').click();
  const signature = page.getByRole("dialog", { name: "Sign assessment", exact: true });
  await signature.getByRole("button", { name: "Sign assessment", exact: true }).click();
  await expect(page.locator("#tutorial-step")).toHaveValue("5");
  await page.getByRole("radio", { name: "Accept", exact: true }).check();
  await page.getByRole("button", { name: "Record decision", exact: true }).click();
  await page.getByLabel("Planned admission date", { exact: true }).fill("2026-10-04");
  await page.getByRole("button", { name: "Review email & packet", exact: true }).click();
  await expect(page.locator("#tutorial-step")).toHaveValue("6");
  await expect(page.frameLocator('iframe[title="Sample Meet the Client email"]').getByText("2026-10-04", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Recipients checked" }).check();
  await page.getByRole("button", { name: "Simulate send", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("No email was sent");
  await chooseStep(page, 7);
  await expect(page.getByRole("button", { name: "Confirm admitted", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Actual admission date", { exact: true })).toHaveCount(0);
  await chooseStep(page, 8);
  await page.getByRole("button", { name: "Open decision folder", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Decision folder", exact: true }).getByRole("button", { name: "Open Taylor Rivera", exact: true })).toContainText("Awaiting admission");
  await page.screenshot({ path: info.outputPath("finished.png") });
  expect(writes).toEqual([]);
});

for (const outcome of ["Deny", "Under review"]) test(outcome + " does not fabricate an admission", async ({ page }) => {
  const writes = observeLiveWrites(page);
  await page.goto("/tutorials/referral?task=record-decision");
  await page.getByRole("radio", { name: outcome, exact: true }).check();
  await page.getByRole("button", { name: outcome === "Deny" ? "Record decision" : "Save under review", exact: true }).click();
  await page.getByRole("navigation", { name: "Tutorial navigation" }).getByRole("button", { name: "Next step", exact: true }).click();
  await expect(page.locator("#tutorial-step")).toHaveValue("8");
  await chooseStep(page, 7);
  await expect(page.getByText("No admission is needed for this outcome.")).toBeVisible();
  expect(writes).toEqual([]);
});

test("files are labeled locally without requesting upload URLs", async ({ page }) => {
  const writes = observeLiveWrites(page);
  await page.goto("/tutorials/referral?task=create-referral");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Drop files or choose files/ }).click();
  await (await chooser).setFiles({ name: "Fictional face sheet.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% test-only upload metadata") });
  await page.getByRole("button", { name: /Add .*file/ }).click();
  await expect(page.getByText("Fictional face sheet.pdf", { exact: true })).toBeVisible();
  await chooseStep(page, 6);
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  await expect(page.getByText("Fictional face sheet.pdf", { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test("Show me where focuses the field without changing it", async ({ page }) => {
  const writes = observeLiveWrites(page);
  await page.goto("/tutorials/referral?task=create-referral");
  await page.getByRole("button", { name: "Show me where", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Taylor Rivera");
  expect(writes).toEqual([]);
});

test("scheduling keeps tutorial controls keyboard-accessible", async ({ page }) => {
  await page.goto("/tutorials/referral?task=start-assessment");
  const dialog = page.getByRole("dialog", { name: "Schedule interview", exact: true });
  await expect(dialog).toHaveAttribute("aria-modal", "false");
  await page.getByRole("button", { name: "Show me where", exact: true }).click();
  await expect(dialog.getByLabel("Assessment date and time")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#tutorial-step")).toHaveValue("3");
  await checkAccess(page, '[aria-label="Tutorial steps"]');
});

test("a task shortcut opens a prepared sample at the selected step", async ({ page }) => {
  await page.goto("/");
  const panel = await library(page);
  await panel.getByRole("button", { name: "Review & sign", exact: true }).click();
  expect(new URL(page.url()).searchParams.has("referralId")).toBe(false);
  await expect(page.locator("#tutorial-step")).toHaveValue("4");
  await expect(page.getByRole("region", { name: "Assessment chart review" })).toBeVisible();
});

test("signed sample stays editable until a simulated send", async ({ page }) => {
  const writes = observeLiveWrites(page);
  await page.goto("/tutorials/referral?task=prepare-packet");
  await page.getByRole("button", { name: "Edit assessment", exact: true }).click();
  await page.getByLabel("Assessment section", { exact: true }).selectOption("provenance_qc");
  await page.locator('[data-working-field="placement_process_questions"] textarea').fill("Fictional post-sign edit.");
  await chooseStep(page, 6);
  await page.getByRole("tab", { name: "Assessment chart", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Fictional post-sign edit.");
  await page.getByRole("checkbox", { name: "Recipients checked" }).check();
  await page.getByRole("button", { name: "Simulate send", exact: true }).click();
  await chooseStep(page, 5);
  await expect(page.getByRole("button", { name: "Change sample decision", exact: true })).toHaveCount(0);
  await chooseStep(page, 3);
  await page.getByLabel("Assessment section", { exact: true }).selectOption("provenance_qc");
  await expect(page.locator('[data-working-field="additional_information"] textarea')).not.toBeEditable();
  expect(writes).toEqual([]);
});

test("packet tabs support keyboard navigation", async ({ page }) => {
  await page.goto("/tutorials/referral?task=prepare-packet");
  await page.getByRole("tab", { name: "Meet the Client", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Assessment chart", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveAccessibleName("Assessment chart");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Files", exact: true })).toBeFocused();
  await checkAccess(page, '[data-testid="tutorial-referral-session"]');
});

test("reports guide remains read-only with two navigation buttons", async ({ page }) => {
  let downloads = 0;
  const writes = observeLiveWrites(page);
  page.on("download", () => downloads++);
  await page.goto("/");
  const panel = await library(page);
  await panel.getByRole("button", { name: "View reports", exact: true }).click();
  const coach = page.getByTestId("guided-coach-panel");
  await expect(coach).toBeVisible();
  await expect(page).toHaveURL(/screen=operations/);
  for (let step = 0; step < 5; step++) {
    await expect(coach.locator("footer button")).toHaveCount(2);
    await coach.locator("footer").getByRole("button", { name: step === 4 ? "Done" : "Next", exact: true }).click();
  }
  expect(downloads).toBe(0);
  expect(writes).toEqual([]);
});

test("retired training routes remain disabled", async ({ page }) => {
  await page.goto("/training");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Learning Center", exact: true })).toHaveCount(0);
});

test("close returns to normal work without demo flags", async ({ page }) => {
  await page.goto("/tutorials/referral?returnTo=%2F%3Fview%3Dreferrals");
  await page.getByRole("button", { name: "Close tutorial", exact: true }).click();
  await expect(page).toHaveURL(/\/\?view=referrals$/);
  await expect(page.getByTestId("tutorial-referral-session")).toHaveCount(0);
  await expect(page.getByTestId("guided-coach-panel")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("demo")).toBe(false);
});

test("external return URLs are ignored", async ({ page, baseURL }) => {
  await page.goto("/tutorials/referral?returnTo=https%3A%2F%2Fexample.com");
  await page.getByRole("button", { name: "Close tutorial", exact: true }).click();
  await expect(page).toHaveURL(baseURL + "/");
});

test("reports are hidden from assessor roles including dispatched starts", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({ response, json: { ...payload, user: { ...payload.user, roles: ["reviewer"] } } });
  });
  await page.goto("/");
  const panel = await library(page);
  await expect(panel.getByRole("button", { name: "View reports", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("pipeline:guided-coach", { detail: { type: "start", tutorialId: "run-report" } })));
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("guided-coach-panel")).toHaveCount(0);
});

test("an unnamed supervisor cannot see or dispatch the Reports tutorial", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({ response, json: { ...payload, user: { ...payload.user, id: "other-supervisor", email: "other@example.invalid", roles: ["assessment_coordinator", "reviewer", "viewer"] } } });
  });
  await page.goto("/");
  const panel = await library(page);
  await expect(panel.getByRole("button", { name: "Create a referral & add files", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "View reports", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("pipeline:guided-coach", { detail: { type: "start", tutorialId: "run-report" } })));
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("guided-coach-panel")).toHaveCount(0);
});

test("Escape closes the menu without navigating", async ({ page }) => {
  await page.goto("/");
  const panel = await library(page);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open guided tutorials" })).toBeFocused();
});
