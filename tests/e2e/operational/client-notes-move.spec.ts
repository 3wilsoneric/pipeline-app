import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral } from "../support/operational-api";
import { actorApiContext, actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";

for (const mode of ["prepare", "interview"]) {
  test(`notes lift, move and dock in ${mode} without losing pending text`, async ({ browser, baseURL }) => {
    test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Redesign operational run.");
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const referral = await createOperationalReferral(api, "assessorA");
      await createOperationalAssessment(api, referral.id);
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=${mode}`);
      const note = page.locator("[data-client-notes]");
      const text = note.getByRole("textbox", { name: "Notes", exact: true });
      const value = "First paragraph — café 中文.\n\nSecond paragraph.\nA line kept with it.";
      await expect(text).toBeEnabled();
      await text.fill(value);
      const grip = note.getByRole("button", { name: "Move notes", exact: true });
      const box = await grip.boundingBox();
      await page.mouse.move(box!.x + 20, box!.y + 20);
      await page.mouse.down();
      await page.waitForTimeout(350);
      await page.mouse.move(660, 180, { steps: 12 });
      await page.mouse.up();
      const floating = page.getByRole("dialog", { name: "Notes", exact: true });
      await expect(floating).toBeVisible();
      await expect(page.locator("[data-client-notes]")).toHaveCount(1);
      await expect.poll(() => note.locator("textarea").evaluateAll((fields) => fields.map((field) => (field as HTMLTextAreaElement).value))).toEqual(value.split(/\n{2,}/));
      // The underlying assessment remains usable; the note is not a modal.
      await expect(floating).not.toHaveAttribute("aria-modal", "true");
      const last = note.locator("textarea").last();
      await last.fill(`${await last.inputValue()}\n\nAdded while floating.`);
      await floating.getByRole("button", { name: "Dock notes", exact: true }).click();
      await expect(floating).toHaveCount(0);
      await expect.poll(() => note.locator("textarea").evaluateAll((fields) => fields.map((field) => (field as HTMLTextAreaElement).value))).toEqual(`${value}\n\nAdded while floating.`.split(/\n{2,}/));

      // Keyboard users can lift and position the same editor, and Escape docks it.
      await grip.focus();
      await page.keyboard.press("Enter");
      await expect(floating).toBeVisible();
      const before = await floating.boundingBox();
      await floating.getByRole("button", { name: "Move notes" }).press("ArrowLeft");
      await expect.poll(async () => (await floating.boundingBox())!.x).toBeLessThan(before!.x);
      await page.keyboard.press("Escape");
      await expect(floating).toHaveCount(0);

      // Dropping onto the original Notes location docks it without another click.
      await grip.click();
      await expect(floating).toBeVisible();
      const source = await floating.getByRole("button", { name: "Move notes" }).boundingBox();
      const target = await page.locator("[data-notes-detached]").boundingBox();
      await page.mouse.move(source!.x + 20, source!.y + 20);
      await page.mouse.down();
      await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 12 });
      await page.mouse.up();
      await expect(floating).toHaveCount(0);
      await expect.poll(() => note.locator("textarea").evaluateAll((fields) => fields.map((field) => (field as HTMLTextAreaElement).value))).toEqual(`${value}\n\nAdded while floating.`.split(/\n{2,}/));
      await expect.poll(async () => ((await (await api.get(`/api/referrals/${referral.id}/notes`)).json()).blocks as { block_key: string; body: string }[]).find((block) => block.block_key === "notes")?.body).toBe(`${value}\n\nAdded while floating.`);
      await page.reload();
      await expect.poll(() => note.locator("textarea").evaluateAll((fields) => fields.map((field) => (field as HTMLTextAreaElement).value))).toEqual(`${value}\n\nAdded while floating.`.split(/\n{2,}/));
      expect(errors).toEqual([]);
    } finally { await context.close(); await api.dispose(); }
  });
}

test("floating workspace notes remain reachable after moving, cancellation and viewport changes", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Redesign operational run.");
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const { page, context } = await actorPage(browser, "assessorA", url);
  try {
    const referral = await createOperationalReferral(api, "assessorA");
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const toggle = page.locator('button[aria-label="Notes"][aria-expanded]');
    await toggle.click();
    const panel = page.getByRole("dialog", { name: "Notes", exact: true });
    const handle = panel.getByRole("button", { name: "Move notes", exact: true });
    await expect(handle).toBeFocused();
    await expect(panel.getByLabel("Move paragraph 1", { exact: true })).toHaveCount(0);
    const writingArea = panel.locator("[data-note-editor]");
    const writingBox = await writingArea.boundingBox();
    await writingArea.click({ position: { x: 60, y: writingBox!.height - 24 } });
    await expect(panel.getByRole("textbox", { name: "Notes", exact: true })).toBeFocused();
    const initial = await panel.boundingBox();
    const grip = await handle.boundingBox();
    await page.mouse.move(grip!.x + 20, grip!.y + 20);
    await page.mouse.down();
    await page.mouse.move(620, 100, { steps: 10 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(panel).toBeVisible();
    await expect.poll(async () => (await panel.boundingBox())!.x).toBe(initial!.x);
    await handle.press("ArrowLeft");
    await page.setViewportSize({ width: 850, height: 640 });
    await expect.poll(async () => { const rect = await panel.boundingBox(); return Boolean(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 850 && rect.y + rect.height <= 640); }).toBe(true);
    await panel.getByRole("textbox", { name: "Notes", exact: true }).fill("Saved after moving the window.");
    await panel.getByRole("button", { name: "Close notes" }).click();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await expect(panel.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue("Saved after moving the window.");
  } finally { await context.close(); await api.dispose(); }
});

test("paragraph drag and keyboard editing preserve the shared plain-text note exactly", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Redesign operational run.");
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const { page, context } = await actorPage(browser, "assessorA", url);
  try {
    const referral = await createOperationalReferral(api, "assessorA");
    const path = `/api/referrals/${referral.id}/notes/notes`;
    const first = "  First — 中文 🙂\nA line in the same paragraph.";
    const second = "Second <strong>plain text</strong>.  ";
    const third = "Third paragraph.";
    const original = `${first}\n\n\n${second}\n\n${third}`;
    expect((await api.put(path, { data: { body: original, if_match: 0 } })).status()).toBe(200);
    const saved = async () => ((await (await api.get(`/api/referrals/${referral.id}/notes`)).json()).blocks as { block_key: string; body: string }[]).find((block) => block.block_key === "notes")?.body;
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const toggle = page.locator('button[aria-label="Notes"][aria-expanded]');
    await toggle.click();
    const panel = page.getByRole("dialog", { name: "Notes", exact: true });
    const rows = panel.locator("[data-note-paragraph]");
    await expect(rows).toHaveCount(3);
    const contents = () => rows.locator("textarea").evaluateAll((fields) => fields.map((field) => (field as HTMLTextAreaElement).value));
    await expect.poll(contents).toEqual([first, second, third]);
    expect(await saved()).toBe(original);
    await page.clock.install();
    await rows.nth(0).locator("summary").dragTo(rows.nth(2));
    await expect.poll(contents).toEqual([second, third, first]);
    await page.clock.runFor(5000);
    await expect.poll(saved).toBe(`${second}\n\n\n${third}\n\n${first}`);
    await rows.nth(2).locator("summary").press("ArrowUp");
    await expect.poll(contents).toEqual([second, first, third]);
    await page.clock.runFor(5000);
    await expect.poll(saved).toBe(`${second}\n\n\n${first}\n\n${third}`);

    // Enter creates a paragraph; Shift+Enter keeps a line in that paragraph.
    const last = rows.last().locator("textarea");
    await last.focus();
    await last.press("ControlOrMeta+A");
    await last.press("ArrowRight");
    await last.press("Enter");
    await expect(rows).toHaveCount(4);
    await expect(rows.last().locator("textarea")).toBeFocused();
    await page.keyboard.type("Fourth");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("continued");
    await panel.getByRole("button", { name: "Close notes" }).click();
    await toggle.click();
    await expect.poll(contents).toEqual([second, first, third, "Fourth\ncontinued"]);
    await expect.poll(saved).toBe(`${second}\n\n\n${first}\n\n${third}\n\nFourth\ncontinued`);

    // Touch users have the same ordering controls without a drag gesture.
    await page.setViewportSize({ width: 390, height: 844 });
    await rows.nth(0).locator("summary").click();
    await rows.nth(0).getByRole("button", { name: "Move down", exact: true }).click();
    const final = `${first}\n\n\n${second}\n\n${third}\n\nFourth\ncontinued`;
    await page.clock.runFor(5000);
    await expect.poll(saved).toBe(final);
    await page.reload();
    await toggle.click();
    await expect.poll(contents).toEqual([first, second, third, "Fourth\ncontinued"]);
    expect(await saved()).toBe(final);
  } finally { await context.close(); await api.dispose(); }
});

test("deleting a carried-over paragraph stays deleted through an offline reload", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Redesign operational run.");
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const { page, context } = await actorPage(browser, "assessorA", url);
  try {
    const referral = await createOperationalReferral(api, "assessorA");
    const path = `/api/referrals/${referral.id}/notes`;
    expect((await api.put(`${path}/notes`, { data: { body: "Original note", if_match: 0 } })).status()).toBe(200);
    expect((await api.put(`${path}/before`, { data: { body: "Later legacy paragraph", if_match: 0 } })).status()).toBe(200);
    let available = false;
    await page.route(`**${path}/notes`, (route) => available ? route.continue() : route.abort("failed"));
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const toggle = page.locator('button[aria-label="Notes"][aria-expanded]');
    await toggle.click();
    const panel = page.getByRole("dialog", { name: "Notes", exact: true });
    await expect(panel.locator("textarea")).toHaveCount(2);
    await page.clock.install();
    await panel.locator("textarea").last().fill("");
    await panel.locator("textarea").last().press("Backspace");
    await expect(panel.locator("textarea")).toHaveCount(1);
    await expect(panel.locator("textarea")).toHaveValue("Original note");
    await page.clock.runFor(5000);
    await expect(panel).toContainText("Waiting to sync");
    await panel.getByRole("button", { name: "Close notes" }).click();
    await page.reload();
    await toggle.click();
    await expect(panel.locator("textarea")).toHaveCount(1);
    await expect(panel.locator("textarea")).toHaveValue("Original note");
    available = true;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(panel).toContainText("All notes saved");
    await page.reload();
    await toggle.click();
    await expect(panel.locator("textarea")).toHaveCount(1);
    await expect(panel.locator("textarea")).toHaveValue("Original note");
    const saved = (await (await api.get(path)).json()).blocks;
    expect(saved).toEqual(expect.arrayContaining([
      expect.objectContaining({ block_key: "notes", body: "Original note", version: 2 }),
      expect.objectContaining({ block_key: "before", body: "Later legacy paragraph", version: 1 }),
    ]));
  } finally { await context.close(); await api.dispose(); }
});
