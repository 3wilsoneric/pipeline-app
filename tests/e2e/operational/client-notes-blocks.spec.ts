import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createOperationalReferral } from "../support/operational-api";
import { actorApiContext, actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";

test("slash blocks keep note content, keyboard access and exact saved structure through reload", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Operational run.");
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const { page, context } = await actorPage(browser, "assessorA", url);
  try {
    const referral = await createOperationalReferral(api, "assessorA");
    const narrative = "Original narrative — keep every word.\nSingle line break stays.";
    const legacy = "- [x] Existing checklist\n\n1. Existing numbered line\n\n> Client words <img src=x onerror=alert(1)>";
    const original = `${narrative}\n\n${legacy}`;
    await api.put(`/api/referrals/${referral.id}/notes/notes`, { data: { body: original, if_match: 0 } });
    const saved = async () => ((await (await api.get(`/api/referrals/${referral.id}/notes`)).json()).blocks as { block_key: string; body: string }[]).find((item) => item.block_key === "notes")?.body;
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const toggle = page.locator('button[aria-label="Notes"][aria-expanded]');
    await toggle.click();
    const panel = page.getByRole("dialog", { name: "Notes", exact: true });
    const rows = panel.locator("[data-note-paragraph]");
    const last = () => rows.last().locator("textarea");
    await expect(rows.first().locator("textarea")).toHaveValue(narrative);
    await expect(rows.nth(1).locator("textarea")).toHaveValue("- [x] Existing checklist");
    await expect(panel.getByRole("checkbox")).toHaveCount(0);
    expect(await saved()).toBe(original);
    await last().focus(); await last().press("ControlOrMeta+A"); await last().press("ArrowRight"); await last().press("Enter");
    await last().pressSequentially("/");
    const menu = page.getByRole("listbox", { name: "Note blocks" });
    await expect(menu.getByRole("option")).toHaveText([
      "Bullet points", "Client report", "Observations", "Staff / case manager report", "History & timeline", "Medication follow-up", "Records to clarify", "Placement preferences", "Follow-up questions", "Heading",
    ]);
    await page.addScriptTag({ content: readFileSync(require.resolve("axe-core/axe.min.js"), "utf8") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: { include: string[] }) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> } }).axe;
      return (await axe.run({ include: ['[data-client-notes]', '[role="listbox"]'] })).violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""));
    });
    expect(violations).toEqual([]);
    await page.screenshot({ animations: "disabled", path: ".data/notes-quiet-pass-20261101/slash-menu-desktop.png" });
    await last().press("Escape");
    await expect(menu).toHaveCount(0); await expect(panel).toBeVisible(); await expect(last()).toHaveValue("/");
    await last().fill("/section"); await last().press("Enter");
    await expect(rows.last()).toHaveAttribute("data-block-kind", "heading");
    await expect(last()).toBeFocused(); await last().fill("Interview observations"); await last().press("Enter");
    await expect(rows.last()).toHaveAttribute("data-block-kind", "text");
    await last().fill("/medication"); await menu.getByRole("option", { name: "Medication follow-up", exact: true }).click();
    await expect(rows.nth(5).locator("textarea")).toHaveValue("Medication follow-up");
    await expect(last()).toBeFocused(); await expect(last()).toHaveValue("");
    await last().fill("/bullet"); await menu.getByRole("option", { name: "Bullet points" }).click();
    await last().fill("First observation"); await last().press("Enter");
    await expect(rows.last()).toHaveAttribute("data-block-kind", "bullet");
    await last().fill("Second observation"); await last().press("Enter"); await last().press("Enter");
    await expect(rows.last()).toHaveAttribute("data-block-kind", "text");
    // Normal slashes and URLs never open commands or replace text.
    await last().fill("https://example.invalid/a/b"); await expect(menu).toHaveCount(0);
    const expected = `${original}\n\n## Interview observations\n\n## Medication follow-up\n\n- First observation\n\n- Second observation\n\nhttps://example.invalid/a/b`;
    await panel.getByRole("button", { name: "Close notes" }).click();
    await expect.poll(saved).toBe(expected);
    await page.reload(); await toggle.click();
    await expect(rows).toHaveCount(9); await expect(rows.nth(4)).toHaveAttribute("data-block-kind", "heading");
    await expect(rows.nth(1).locator("textarea")).toHaveValue("- [x] Existing checklist"); await expect(panel.locator("img")).toHaveCount(0);
    // Reorder the entire heading, including its persisted formatting.
    await rows.nth(5).locator("summary").press("ArrowUp");
    await expect(rows.nth(4).locator("textarea")).toHaveValue("Medication follow-up");
    await panel.getByRole("button", { name: "Close notes" }).click();
    await expect.poll(saved).toBe(expected.replace("## Interview observations\n\n## Medication follow-up", "## Medication follow-up\n\n## Interview observations"));
    await toggle.click();
    await page.screenshot({ animations: "disabled", path: ".data/notes-quiet-pass-20261101/structured-notes.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await last().focus(); await last().press("ControlOrMeta+A"); await last().press("ArrowRight"); await last().press("Enter");
    await last().fill("/history");
    await expect(menu).toBeVisible();
    await page.screenshot({ animations: "disabled", path: ".data/notes-quiet-pass-20261101/slash-menu-phone.png" });
    const rect = await menu.boundingBox(); expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
    await menu.getByRole("option", { name: "History & timeline", exact: true }).click();
    await expect(last()).toBeFocused(); await last().pressSequentially("Earlier placement recorded.");
    await panel.getByRole("button", { name: "Close notes" }).click();
    await expect.poll(saved).toContain("\n\n## History & timeline\n\nEarlier placement recorded.");
  } finally { await context.close(); await api.dispose(); }
});

test("notes resize by pointer and keyboard, retain pending text and stay within the viewport", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Operational run.");
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const { page, context } = await actorPage(browser, "assessorA", url);
  try {
    const referral = await createOperationalReferral(api, "assessorA");
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const toggle = page.locator('button[aria-label="Notes"][aria-expanded]'); await toggle.click();
    const panel = page.getByRole("dialog", { name: "Notes", exact: true });
    const handle = page.getByRole("button", { name: "Resize notes", exact: true });
    const noteText = "Pending text survives resizing and wraps within the resized window. ".repeat(8);
    await panel.getByRole("textbox", { name: "Notes", exact: true }).fill(noteText);
    const before = await panel.boundingBox();
    const grip = await handle.boundingBox();
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2); await page.mouse.down();
    await page.mouse.move(grip!.x - 90, grip!.y + 50, { steps: 10 }); await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThan(before!.width);
    await expect.poll(() => panel.locator("textarea").evaluate((field) => field.scrollHeight <= field.clientHeight + 1)).toBe(true);
    const smaller = await panel.boundingBox();
    await handle.press("Shift+ArrowRight");
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(smaller!.width + 48, 0);
    await expect(panel.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue(noteText);
    // Drag from status text, outside the old Notes button. The whole header is the handle.
    const oldPosition = await panel.boundingBox();
    const status = await panel.locator("[data-notes-drag-header] [role=status]").boundingBox();
    await page.mouse.move(status!.x + status!.width / 2, status!.y + status!.height / 2); await page.mouse.down();
    await page.mouse.move(status!.x + status!.width / 2 - 100, status!.y + status!.height / 2 + 25, { steps: 10 }); await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.x).toBeCloseTo(oldPosition!.x - 100, 0);
    await expect(panel.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue(noteText);
    await page.setViewportSize({ width: 820, height: 600 });
    await expect.poll(async () => { const rect = await panel.boundingBox(); return rect!.x >= 0 && rect!.y >= 0 && rect!.x + rect!.width <= 820 && rect!.y + rect!.height <= 600; }).toBe(true);
    await handle.press("Escape"); await expect(panel).toHaveCount(0); await expect(toggle).toBeFocused();
    await toggle.click(); await expect(panel.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue(noteText);
    await page.setViewportSize({ width: 390, height: 844 }); await expect(handle).not.toBeVisible();
    const rect = await panel.boundingBox(); expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  } finally { await context.close(); await api.dispose(); }
});


test("notes wait for a typing pause, batch paragraph changes, and save immediately on close", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Operational run.");
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const { page, context } = await actorPage(browser, "assessorA", url);
  try {
    const referral = await createOperationalReferral(api, "assessorA");
    const endpoint = `/api/referrals/${referral.id}/notes/notes`;
    const writes: string[] = [];
    page.on("request", (request) => { if (request.method() === "PUT" && request.url().endsWith(endpoint)) writes.push(request.postDataJSON().body); });
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const toggle = page.locator('button[aria-label="Notes"][aria-expanded]'); await toggle.click();
    const panel = page.getByRole("dialog", { name: "Notes", exact: true });
    const rows = panel.locator("[data-note-paragraph]");
    await expect(rows.first().locator("textarea")).toBeEnabled();
    await page.clock.install();
    await rows.first().locator("textarea").fill("One"); await page.clock.runFor(1000);
    expect(writes).toEqual([]);
    await rows.first().locator("textarea").press("End"); await rows.first().locator("textarea").press("Enter");
    await rows.last().locator("textarea").fill("Two"); await page.clock.runFor(1000);
    await rows.first().locator("textarea").click(); await rows.first().locator("textarea").fill("One updated");
    await page.clock.runFor(4900); expect(writes).toEqual([]);
    await expect(panel).toHaveAttribute("data-status", "unsaved");
    await expect(panel.locator("[data-notes-drag-header] [role=status]")).toHaveText("Unsaved changes");
    await expect(panel.locator("[data-notes-drag-header] [role=status] svg")).toHaveCount(0);
    await page.clock.runFor(100);
    await expect.poll(() => writes).toEqual(["One updated\n\nTwo"]);
    await expect(panel.locator("[data-notes-drag-header] [role=status]")).toHaveText("All notes saved");
    await rows.last().locator("textarea").fill("Two updated");
    await panel.getByRole("button", { name: "Close notes" }).click();
    await expect.poll(() => writes).toEqual(["One updated\n\nTwo", "One updated\n\nTwo updated"]);
    await expect.poll(async () => ((await (await api.get(`/api/referrals/${referral.id}/notes`)).json()).blocks as { block_key: string; body: string }[]).find((item) => item.block_key === "notes")?.body).toBe("One updated\n\nTwo updated");
    await toggle.click(); await expect(rows.last().locator("textarea")).toHaveValue("Two updated");
  } finally { await context.close(); await api.dispose(); }
});
