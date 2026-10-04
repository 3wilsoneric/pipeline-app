import { expect, test, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { noteHeadings } from "@/lib/pipeline/client-notes";
import { createOperationalAssessment, createOperationalReferral } from "../support/operational-api";
import { actorApiContext, actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";
import { openAllQuestions, openAssessmentChart, returnToAssessmentQuestions } from "../support/assessment-navigation";

test.beforeEach(() => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Isolated redesign operational run.");
});

async function openNote(panel: Locator, key: string) {
  const block = panel.locator(`[data-note-heading="${key}"]`);
  const field = block.locator("textarea");
  await expect(field).toBeEditable();
  return field;
}

test("creating a workspace then editing preparation keeps the saved referral address across reload", async ({ browser, baseURL }) => {
  const url = requireOperationalBaseURL(baseURL);
  const { page, context } = await actorPage(browser, "assessorA", url);
  try {
    const name = `Synthetic ${randomUUID()}`;
    await page.goto("/?view=referrals&screen=packet");
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
    await page.getByRole("button", { name: "Create referral", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Workspace created", exact: true });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Close workspace created", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toMatch(/^\d+$/);
    const id = new URL(page.url()).searchParams.get("referralId");
    await returnToAssessmentQuestions(page);
    await page.getByRole("button", { name: "Prepare assessment", exact: true }).click();
    const answer = page.getByRole("textbox", { name: "Where the client is now", exact: true });
    await answer.fill("Synthetic preparation immediately after creation");
    await openAssessmentChart(page);
    expect(new URL(page.url()).searchParams.get("referralId")).toBe(id);
    expect(new URL(page.url()).searchParams.has("draftId")).toBe(false);
    await page.reload();
    await expect(page.getByText(`Referral #${id}`, { exact: false })).toBeVisible();
    await returnToAssessmentQuestions(page);
    await expect(answer).toHaveValue("Synthetic preparation immediately after creation");
  } finally { await context.close(); }
});

test("existing topic notes become one editable note without losing their saved originals", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const { page, context } = await actorPage(browser, "assessorA", url);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const referral = await createOperationalReferral(api, "assessorA");
    const assessment = await createOperationalAssessment(api, referral.id);
    const read = async () => (await (await api.get(`/api/referrals/${referral.id}/notes`)).json()).blocks as { block_key: string; body: string }[];
    const expected = new Map(noteHeadings().map(({ key }, index) => [key,
      `Synthetic heading ${index}: café — 中文 🙂\n` + "Line of plain text <strong>not markup</strong>.\n".repeat(25)]));
    for (const [key, body] of expected) {
      expect((await api.put(`/api/referrals/${referral.id}/notes/${encodeURIComponent(key)}`, { data: { body, if_match: 0 } })).status()).toBe(200);
    }
    const combined = noteHeadings().map(({ key, label }) => `${label}\n${expected.get(key)}`).join("\n\n");
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const toggle = page.locator('button[aria-label="Notes"][aria-expanded]');
    await toggle.click();
    const panel = page.getByRole("dialog", { name: "Notes", exact: true });
    const field = await openNote(panel, "notes");
    await expect(field).toHaveValue(combined);
    await expect(panel.locator("[data-note-heading]")).toHaveCount(1);
    const edited = `${combined}\n\nNew note after consolidation.`;
    await field.fill(edited);
    // Close immediately, without waiting for the debounce or an explicit save.
    await panel.getByRole("button", { name: "Close notes" }).click();
    await toggle.click();
    await expect(await openNote(panel, "notes")).toHaveValue(edited);
    await panel.getByRole("button", { name: "Close notes" }).click();
    await returnToAssessmentQuestions(page);
    await openAllQuestions(page);
    const answer = page.getByRole("textbox", { name: "Where the client is now", exact: true });
    await answer.fill("Synthetic assessment answer beside many notes");
    await openAssessmentChart(page);
    await returnToAssessmentQuestions(page);
    await openAllQuestions(page);
    await expect(answer).toHaveValue("Synthetic assessment answer beside many notes");
    await expect.poll(async () => (await (await api.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.current_location)
      .toBe("Synthetic assessment answer beside many notes");
    await openAssessmentChart(page);
    await page.reload();
    await toggle.click();
    await expect(await openNote(panel, "notes")).toHaveValue(edited);
    await expect.poll(async () => Object.fromEntries((await read()).map(block => [block.block_key, block.body])).notes).toBe(edited);
    for (const [key, body] of expected) expect(Object.fromEntries((await read()).map(block => [block.block_key, block.body]))[key]).toBe(body);
    const olderTabKey = noteHeadings()[0].key;
    expect((await api.put(`/api/referrals/${referral.id}/notes/${encodeURIComponent(olderTabKey)}`, {
      data: { body: "Synthetic note from an older open tab", if_match: 1 },
    })).status()).toBe(200);
    await page.reload();
    await toggle.click();
    await expect(await openNote(panel, "notes")).toHaveValue(/Synthetic note from an older open tab/);
    await (await openNote(panel, "notes")).fill("");
    await panel.getByRole("button", { name: "Close notes" }).click();
    await expect.poll(async () => Object.fromEntries((await read()).map(block => [block.block_key, block.body])).notes).toBe("");
    await expect(toggle).not.toHaveAttribute("data-has-note", "true");
    await page.reload();
    await toggle.click();
    await expect(await openNote(panel, "notes")).toHaveValue("");
    expect(errors).toEqual([]);
  } finally { await context.close(); await api.dispose(); }
});

test("a delayed summary cannot put a deleted note back into the preview", async ({ browser, baseURL }) => {
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const { page, context } = await actorPage(browser, "assessorA", url);
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let entered = () => {};
  const captured = new Promise<void>(resolve => { entered = resolve; });
  let finished = () => {};
  const delivered = new Promise<void>(resolve => { finished = resolve; });
  try {
    const referral = await createOperationalReferral(api, "assessorA");
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const toggle = page.locator('button[aria-label="Notes"][aria-expanded]');
    await toggle.click();
    const panel = page.getByRole("dialog", { name: "Notes", exact: true });
    const field = await openNote(panel, "notes");
    let holdNext = true;
    await page.route("**/api/client-notes/latest?*", async route => {
      if (!holdNext) return route.continue();
      holdNext = false;
      const response = await route.fetch();
      entered();
      await held;
      await route.fulfill({ response });
      finished();
    });
    await field.fill("Synthetic summary that will arrive too late");
    await field.blur();
    await captured;
    await field.fill("");
    await panel.getByRole("button", { name: "Close notes" }).click();
    await expect.poll(async () => (await (await api.get(`/api/referrals/${referral.id}/notes`)).json()).blocks[0]?.body).toBe("");
    await expect(toggle).not.toHaveAttribute("data-has-note", "true");
    release();
    await delivered;
    await toggle.click();
    await expect(await openNote(panel, "notes")).toHaveValue("");
    await expect(toggle).not.toHaveAttribute("data-has-note", "true");
  } finally { release(); await context.close(); await api.dispose(); }
});

test("a slow notes reply cannot restore deleted text or prevent editing another client", async ({ browser, baseURL }) => {
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const { page, context } = await actorPage(browser, "assessorA", url);
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let entered = () => {};
  const saving = new Promise<void>(resolve => { entered = resolve; });
  try {
    const first = await createOperationalReferral(api, "assessorA");
    const second = await createOperationalReferral(api, "assessorA");
    const endpoint = `**/api/referrals/${first.id}/notes/notes`;
    let requests = 0;
    await page.route(endpoint, async route => {
      requests++;
      if (requests === 1) { const response = await route.fetch(); entered(); await held; await route.fulfill({ response }); }
      else await route.continue();
    });
    await page.goto(`/?view=referrals&screen=packet&referralId=${first.id}&workspaceStage=chart`);
    const toggle = page.locator('button[aria-label="Notes"][aria-expanded]');
    const panel = page.getByRole("dialog", { name: "Notes", exact: true });
    await toggle.click();
    const field = await openNote(panel, "notes");
    await field.fill("Synthetic text that will be deleted while its reply is delayed");
    await field.blur();
    await saving;
    await field.fill("");
    await panel.getByRole("button", { name: "Close notes" }).click({ timeout: 1000 });
    await page.getByRole("button", { name: "Workspace files", exact: true }).click({ timeout: 1000 });
    await expect(page.locator("#packet-files")).toBeVisible();
    release();
    await expect.poll(async () => (await (await api.get(`/api/referrals/${first.id}/notes`)).json()).blocks[0]?.body).toBe("");
    expect(requests).toBe(2);
    await page.goto(`/?view=referrals&screen=packet&referralId=${second.id}&workspaceStage=chart`);
    await toggle.click();
    await expect(await openNote(panel, "notes")).toHaveValue("");
    await (await openNote(panel, "notes")).fill("Synthetic second client only");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect.poll(async () => (await (await api.get(`/api/referrals/${second.id}/notes`)).json()).blocks[0]?.body).toBe("Synthetic second client only");
    await page.goto(`/?view=referrals&screen=packet&referralId=${first.id}&workspaceStage=chart`);
    await toggle.click();
    await expect(await openNote(panel, "notes")).toHaveValue("");
  } finally { release(); await context.close(); await api.dispose(); }
});

test("another person's note conflict preserves local typing and allows Chart navigation until resolved", async ({ browser, baseURL }) => {
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const other = await actorApiContext("assessmentCoordinator", url);
  const { page, context } = await actorPage(browser, "assessorA", url);
  try {
    const referral = await createOperationalReferral(api, "assessorA");
    await createOperationalAssessment(api, referral.id);
    const endpoint = `/api/referrals/${referral.id}/notes/notes`;
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const toggle = page.locator('button[aria-label="Notes"][aria-expanded]');
    const panel = page.getByRole("dialog", { name: "Notes", exact: true });
    await toggle.click();
    const field = await openNote(panel, "notes");
    expect((await other.put(endpoint, { data: { body: "Synthetic other person's saved version", if_match: 0 } })).status()).toBe(200);
    await field.fill("Synthetic local draft must remain visible");
    await field.blur();
    await expect(panel.getByRole("alert")).toContainText("changed on another screen");
    await expect(field).toHaveValue("Synthetic local draft must remain visible");
    await page.keyboard.press("Escape");
    await returnToAssessmentQuestions(page);
    await openAllQuestions(page);
    await page.getByRole("textbox", { name: "Where the client is now", exact: true }).fill("Synthetic work continues during note conflict");
    await openAssessmentChart(page);
    await toggle.click();
    await expect(await openNote(panel, "notes")).toHaveValue("Synthetic local draft must remain visible");
    await panel.getByRole("button", { name: "Use theirs", exact: true }).click();
    await expect(field).toHaveValue("Synthetic other person's saved version");
    await expect(panel.getByRole("alert")).toHaveCount(0);
    expect((await other.put(endpoint, { data: { body: "Synthetic newer remote version", if_match: 1 } })).status()).toBe(200);
    await field.fill("Synthetic explicit local choice");
    await field.blur();
    await expect(panel.getByRole("alert")).toContainText("changed on another screen");
    await panel.getByRole("button", { name: "Keep mine", exact: true }).click();
    await expect(panel).toContainText("All notes saved");
    const blocks = (await (await api.get(`/api/referrals/${referral.id}/notes`)).json()).blocks;
    expect(blocks).toEqual([expect.objectContaining({ body: "Synthetic explicit local choice", version: 3 })]);
    await page.reload();
    await toggle.click();
    await expect(await openNote(panel, "notes")).toHaveValue("Synthetic explicit local choice");
  } finally { await context.close(); await api.dispose(); await other.dispose(); }
});
