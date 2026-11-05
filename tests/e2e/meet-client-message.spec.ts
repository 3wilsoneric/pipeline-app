import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, readOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "./support/operational-api";
import { openRecipients } from "./support/handoff-review";

test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Handoff drafts use the isolated workspace-state store.");

async function messageCase(page: Page) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Message Client", community: "San Pablo", owner: "", plannedAdmissionDate: "2026-10-01" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await signOperationalAssessment(page.request, assessment);
  await recordOperationalAcceptance(page.request, await readOperationalReferral(page.request, referral.id));
  await page.route("**/api/community-recipient-lists", route => route.fulfill({ json: { lists: [] } }));
  return referral;
}
async function openEditor(page: Page, referralId: number) {
  await page.goto(`/?view=referrals&screen=packet&referralId=${referralId}&workspaceView=email`);
  const review = await openRecipients(page);
  await review.getByRole("button", { name: "Edit message", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Meet the Client", exact: true });
  await expect(editor.getByRole("heading", { name: "Edit Meet the Client", exact: true })).toBeFocused();
  await expect.poll(() => editor.evaluate(element => element.getAnimations().filter(animation => animation.playState === "running").length)).toBe(0);
  return editor;
}
async function resetLayout(page: Page) {
  const current = await (await page.request.get("/api/me/meet-client-layout")).json();
  expect((await page.request.put("/api/me/meet-client-layout", { data: { if_match: current.version, layout: { sectionOrder: ["message", "bio", "coordination", "medications", "safety", "diet", "billing", "support"], sectionFormats: {} } } })).status()).toBe(200);
}

for (const width of [1440, 834, 390]) test(`large section editor saves wording and personal layout at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await resetLayout(page);
  const referral = await messageCase(page);
  let sends = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
  const editor = await openEditor(page, referral.id);
  const bounds = (await editor.boundingBox())!;
  expect(bounds.width).toBeGreaterThanOrEqual(Math.min(width - 48, 1100));
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  await editor.getByRole("textbox", { name: "Subject", exact: true }).fill("Arrival arrangements");
  const body = editor.getByRole("textbox", { name: "Edit Meet the client", exact: true });
  await expect(body).toHaveAttribute("spellcheck", "true");
  await expect(body).toHaveAttribute("autocorrect", "off");
  const text = "Synthetic personal wording <script>text only</script>\nCall before arrival.";
  await body.fill(text);
  await editor.getByRole("combobox", { name: "Format Meet the client", exact: true }).selectOption("bullets");
  const move = editor.locator('summary[aria-label="Move Meet the client"]');
  await move.focus(); await move.press("Alt+ArrowDown");
  await expect(editor.locator("[data-message-section]").first()).toHaveAttribute("data-message-section", "coordination");
  await expect(move).toBeFocused();
  await editor.getByRole("button", { name: "Add a note", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Edit Message", exact: true })).toBeFocused();
  await editor.getByRole("textbox", { name: "Edit Message", exact: true }).fill("Synthetic note for this client only.");
  await expect(editor.getByRole("status").filter({ hasText: "Your layout is saved" })).toBeVisible();
  await editor.getByRole("button", { name: "Preview email", exact: true }).click();
  const preview = editor.frameLocator('iframe[title="Edited Meet the Client email preview"]');
  await expect(preview.locator("body")).toContainText("Synthetic personal wording <script>text only</script>");
  await expect(preview.locator("li").filter({ hasText: "Call before arrival." })).toHaveCount(1);
  await expect(preview.locator("script")).toHaveCount(0);
  await expect(preview.getByRole("img", { name: "Alamo Health Management" })).toBeVisible();
  await expect(preview.locator("body")).toContainText("10/01/2026");
  await expect(preview.locator("body")).toContainText("Client data sheet.pdf");
  await editor.getByRole("button", { name: "Back to editing", exact: true }).click();
  await body.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`message-editor-${width}.png`) });
  await page.addScriptTag({ path: createRequire(process.cwd() + "/package.json").resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
    return (await axe.run({ include: ['dialog[data-meet-client-editor]'] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
  });
  expect(violations).toEqual([]);
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Edit message", exact: true })).toBeFocused();
  const saved = await (await page.request.get(`/api/referrals/${referral.id}/handoff-recipients`)).json();
  expect(saved.draft.message.sectionText.bio).toBe(text);
  expect(saved.draft.message.subject).toBe("Arrival arrangements");
  expect(saved.layout).toEqual({ sectionOrder: ["message", "coordination", "bio", "medications", "safety", "diet", "billing", "support"], sectionFormats: { bio: "bullets" } });
  expect(JSON.stringify(saved.layout)).not.toContain("Synthetic personal");
  const current = await readOperationalReferral(page.request, referral.id);
  expect((await page.request.patch(`/api/referrals/${referral.id}`, { data: { if_match: current.version, patch: { plannedAdmissionDate: "2026-10-02" } } })).status()).toBe(200);
  await openEditor(page, referral.id);
  await expect(body).toHaveValue(text);
  await expect(editor).toContainText("10/02/2026");
  await page.keyboard.press("Escape");
  await expect(editor).not.toBeVisible();
  const next = await messageCase(page);
  await openEditor(page, next.id);
  await expect(body).not.toHaveValue(text);
  await expect(editor.getByRole("combobox", { name: "Format Meet the client", exact: true })).toHaveValue("bullets");
  await expect(editor.locator("[data-message-section]").first()).toHaveAttribute("data-message-section", "coordination");
  await expect(editor.getByRole("textbox", { name: "Edit Message", exact: true })).toHaveCount(0);
  expect(sends).toBe(0);
});

test("draft and layout failures retain edits; lost layout acknowledgments recover without overwriting another session", async ({ page }) => {
  await resetLayout(page);
  const referral = await messageCase(page);
  const editor = await openEditor(page, referral.id);
  const endpoint = `**/api/referrals/${referral.id}/handoff-recipients`;
  await page.route(endpoint, route => route.request().method() === "PUT" ? route.fulfill({ status: 503, json: { error: "Synthetic save interruption" } }) : route.continue());
  const body = editor.getByRole("textbox", { name: "Edit Meet the client", exact: true });
  await body.fill("Keep this message through the interruption.");
  await expect(editor.getByRole("alert")).toContainText("Synthetic save interruption");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await expect(editor).toBeVisible();
  await page.unroute(endpoint);
  await editor.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(editor.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  await page.route(endpoint, async route => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fetch();
    await route.fulfill({ status: 503, json: { error: "Synthetic lost draft response" } });
  });
  await body.fill("Keep this message through the interruption.");
  await editor.getByRole("button", { name: "Add a note", exact: true }).click();
  await editor.getByRole("textbox", { name: "Edit Message", exact: true }).fill("Lost response note");
  await expect(editor.getByRole("alert")).toContainText("Synthetic lost draft response");
  await page.unroute(endpoint);
  await editor.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(editor.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  await page.route("**/api/me/meet-client-layout", async route => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fetch();
    await route.fulfill({ status: 503, json: { error: "Synthetic lost layout response" } });
  });
  await editor.getByRole("combobox", { name: "Format Meet the client", exact: true }).selectOption("paragraphs");
  await expect(editor.getByRole("alert")).toContainText("Synthetic lost layout response");
  await page.unroute("**/api/me/meet-client-layout");
  await editor.getByRole("button", { name: "Retry layout save", exact: true }).click();
  await expect(editor.getByRole("status").filter({ hasText: "Your layout is saved" })).toBeVisible();
  const latest = await (await page.request.get("/api/me/meet-client-layout")).json();
  const newer = { ...latest.layout, sectionFormats: { bio: "bullets" } };
  expect((await page.request.put("/api/me/meet-client-layout", { data: { layout: newer, if_match: latest.version } })).status()).toBe(200);
  await editor.getByRole("combobox", { name: "Format Meet the client", exact: true }).selectOption("default");
  await expect(editor.getByRole("alert")).toContainText("changed in another session");
  await editor.getByRole("button", { name: "Retry layout save", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("changed elsewhere");
  expect((await (await page.request.get("/api/me/meet-client-layout")).json()).layout).toEqual(newer);
  await editor.getByRole("button", { name: "Use latest default", exact: true }).click();
  await expect(editor.getByRole("combobox", { name: "Format Meet the client", exact: true })).toHaveValue("bullets");
  await expect(body).toHaveValue("Keep this message through the interruption.");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await openEditor(page, referral.id);
  await expect(body).toHaveValue("Keep this message through the interruption.");
});

test("message draft validation and optimistic versions preserve the saved handoff", async ({ page, baseURL }) => {
  const referral = await messageCase(page);
  const endpoint = `/api/referrals/${referral.id}/handoff-recipients`;
  const draft = { community: "San Pablo", to: [], cc: [], message: { subject: "Arrival", body: "Call before arrival." } };
  expect((await page.request.put(endpoint, { data: { if_match: 0, draft } })).status()).toBe(200);
  expect((await page.request.put(endpoint, { data: { if_match: 0, draft: { ...draft, message: { ...draft.message, body: "Stale edit" } } } })).status()).toBe(409);
  for (const message of [{ subject: "Bad\r\nBcc: injected@example.invalid", body: "Okay" }, { subject: "Okay", body: "x".repeat(20_001) }, { subject: "Okay", body: 42 }]) {
    expect((await page.request.put(endpoint, { data: { if_match: 1, draft: { ...draft, message } } })).status()).toBe(400);
  }
  expect((await page.request.put(endpoint, { headers: { Origin: "https://untrusted.example.invalid" }, data: { if_match: 1, draft } })).status()).toBe(403);
  expect((await page.request.put(endpoint, { headers: { Origin: baseURL! }, data: { if_match: 1, draft: { ...draft, community: "Turlock" } } })).status()).toBe(409);
  const saved = await (await page.request.get(endpoint)).json();
  expect(saved.version).toBe(1);
  expect(saved.draft.message).toEqual(draft.message);
  expect((await page.request.post(`/api/referrals/${referral.id}/meet-client-email`, { data: { if_match: referral.version, confirmed: true, recipients: ["care@example.invalid"], message: draft.message, client_mutation_id: randomUUID() } })).status()).toBe(403);
});

test("section navigation, expanding text and preview preserve the writing position", async ({ page }, info) => {
  const referral = await messageCase(page);
  const editor = await openEditor(page, referral.id);
  const outline = editor.getByRole("navigation", { name: "Email sections" });
  await outline.getByRole("button", { name: "Meet the client", exact: true }).click();
  const body = editor.getByRole("textbox", { name: "Edit Meet the client", exact: true });
  await expect(body).toBeFocused();
  const text = Array.from({ length: 14 }, (_, index) => `Synthetic paragraph ${index + 1}: This long section remains fully readable without scrolling inside the writing field.`).join("\n\n");
  await body.fill(text);
  await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(2);
  await body.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(24, 53); });
  const position = await editor.locator('[data-editor-field="bio"]').evaluate(element => {
    let parent = element.parentElement!;
    while (getComputedStyle(parent).overflowY !== "auto") parent = parent.parentElement!;
    return parent.scrollTop;
  });
  await editor.getByRole("button", { name: "Preview email", exact: true }).click();
  await expect(editor.frameLocator('iframe[title="Edited Meet the Client email preview"]').locator("body")).toContainText("Synthetic paragraph 14");
  await editor.getByRole("button", { name: "Back to editing", exact: true }).click();
  await expect(body).toBeFocused();
  expect(await body.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([24, 53]);
  expect(await body.evaluate(element => {
    let parent = element.parentElement!;
    while (getComputedStyle(parent).overflowY !== "auto") parent = parent.parentElement!;
    return parent.scrollTop;
  })).toBe(position);
  const move = editor.locator('summary[aria-label="Move Meet the client"]');
  await move.click();
  await page.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  await expect(move.locator("..")).not.toHaveAttribute("open", "");
  await expect(move).toBeFocused();
  await outline.getByRole("button", { name: "Med room", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Edit Med room", exact: true })).toBeFocused();
  await expect(outline.getByRole("button", { name: "Med room", exact: true })).toHaveAttribute("aria-current", "location");
  await page.screenshot({ path: info.outputPath("section-navigation.png") });
});

test("undo and redo restore wording, resets, formats, order and removed notes through the real save path", async ({ page }) => {
  await resetLayout(page);
  const referral = await messageCase(page);
  const editor = await openEditor(page, referral.id);
  const body = editor.getByRole("textbox", { name: "Edit Meet the client", exact: true });
  const section = editor.locator('[data-message-section="bio"]');
  const original = await body.inputValue();
  await body.fill("Synthetic edited introduction.");
  await section.locator("summary").click();
  await section.getByRole("button", { name: "Use assessment text", exact: true }).click();
  await expect(body).toHaveValue(original);
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(body).toHaveValue("Synthetic edited introduction.");
  await editor.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(body).toHaveValue(original);
  await body.press("ControlOrMeta+z");
  await expect(body).toHaveValue("Synthetic edited introduction.");
  const format = editor.getByRole("combobox", { name: "Format Meet the client", exact: true });
  await format.selectOption("bullets");
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(format).toHaveValue("default");
  await editor.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(format).toHaveValue("bullets");
  await editor.locator('summary[aria-label="Move Meet the client"]').press("Alt+ArrowDown");
  await expect(editor.locator("[data-message-section]").first()).toHaveAttribute("data-message-section", "coordination");
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.locator("[data-message-section]").first()).toHaveAttribute("data-message-section", "bio");
  await editor.getByRole("button", { name: "Add a note", exact: true }).click();
  await editor.getByRole("textbox", { name: "Edit Message", exact: true }).fill("A note to recover.");
  await editor.locator('summary[aria-label="Move Message"]').click();
  await editor.getByRole("button", { name: "Remove note", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Edit Message", exact: true })).toHaveCount(0);
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Edit Message", exact: true })).toHaveValue("A note to recover.");
  await editor.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Edit Message", exact: true })).toHaveCount(0);
  await expect(editor.getByRole("textbox", { name: "Subject", exact: true })).toBeFocused();
  await editor.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Edit Message", exact: true })).toHaveValue("A note to recover.");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await openEditor(page, referral.id);
  await expect(body).toHaveValue("Synthetic edited introduction.");
  await expect(format).toHaveValue("bullets");
  await expect(editor.getByRole("textbox", { name: "Edit Message", exact: true })).toHaveValue("A note to recover.");
  await expect(editor.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

for (const width of [1440, 834, 390]) test(`document editor visual review at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await resetLayout(page);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Jordan Rivera — sample", community: "San Pablo", owner: "", plannedAdmissionDate: "2026-11-12" });
  await signOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  await recordOperationalAcceptance(page.request, await readOperationalReferral(page.request, referral.id));
  const editor = await openEditor(page, referral.id);
  const body = editor.getByRole("textbox", { name: "Edit Meet the client", exact: true });
  await body.fill("Jordan enjoys music, morning walks, and small group activities. A calm introduction and a consistent routine help them settle in.\n\nOffer a tour of the community on arrival and introduce the team one person at a time.");
  await editor.getByRole("textbox", { name: "Edit Admission & coordination", exact: true }).fill("Planned arrival: November 12, in the morning.\nPrimary contact: the referring care coordinator.\nPlease confirm transportation before arrival.");
  if (width < 768) {
    await editor.getByRole("combobox", { name: "Go to email section", exact: true }).selectOption("bio");
  } else {
    await editor.getByRole("navigation", { name: "Email sections" }).getByRole("button", { name: "Meet the client", exact: true }).click();
  }
  await expect(body).toBeFocused();
  await expect(editor.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await editor.evaluate(element => element.scrollTop)).toBe(0);
  const frame = (await editor.boundingBox())!;
  const heading = (await editor.getByRole("heading", { name: "Edit Meet the Client", exact: true }).boundingBox())!;
  const done = (await editor.getByRole("button", { name: "Done", exact: true }).boundingBox())!;
  expect(heading.y).toBeGreaterThanOrEqual(frame.y);
  expect(done.y + done.height).toBeLessThanOrEqual(frame.y + frame.height);
  expect(done.y + done.height).toBeGreaterThan(frame.y + frame.height - 40);
  await page.screenshot({ path: info.outputPath(`editor-writing-${width}.png`) });
  await editor.getByRole("button", { name: "Preview email", exact: true }).click();
  await expect(editor.frameLocator('iframe[title="Edited Meet the Client email preview"]').getByRole("img", { name: "Alamo Health Management" })).toBeVisible();
  await expect(editor.locator('iframe').locator('..')).toHaveCSS("opacity", "1");
  await page.screenshot({ path: info.outputPath(`editor-preview-${width}.png`) });
});

for (const reducedMotion of ["no-preference", "reduce"] as const) test(`editor motion preserves section order, preview and focus with ${reducedMotion}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion });
  await resetLayout(page);
  const referral = await messageCase(page);
  const editor = await openEditor(page, referral.id);
  await editor.getByRole("textbox", { name: "Subject", exact: true }).fill("Arrival details for the care team");
  const body = editor.getByRole("textbox", { name: "Edit Meet the client", exact: true });
  await body.fill("Keep this client wording through section moves and preview.");
  const move = editor.locator('summary[aria-label="Move Meet the client"]');
  await move.press("Alt+ArrowDown");
  await move.press("Alt+ArrowDown");
  await expect.poll(() => editor.locator("[data-message-section]").evaluateAll(elements => elements.slice(0, 3).map(element => element.getAttribute("data-message-section")))).toEqual(["coordination", "medications", "bio"]);
  await expect(move).toBeFocused();
  await editor.getByRole("button", { name: "Add a note", exact: true }).click();
  await editor.getByRole("textbox", { name: "Edit Message", exact: true }).fill("A note at the start of the letter.");
  await expect(editor.locator("[data-message-section]").first()).toHaveAttribute("data-message-section", "message");
  const nav = editor.getByRole("navigation", { name: "Email sections" });
  await nav.getByRole("button", { name: "Meet the client", exact: true }).click();
  await expect(body).toBeFocused();
  await expect(nav.locator("[aria-current]")).toHaveCount(1);
  await expect(nav.getByRole("button", { name: "Meet the client", exact: true })).toHaveAttribute("aria-current", "location");
  await expect.poll(() => nav.evaluate(element => {
    const highlight = element.querySelector<HTMLElement>('span[aria-hidden="true"]')!.getBoundingClientRect();
    const selected = element.querySelector("[aria-current]")!.getBoundingClientRect();
    return Math.abs(highlight.top - selected.top) + Math.abs(highlight.height - selected.height);
  })).toBeLessThan(1);
  if (reducedMotion === "reduce") expect(await editor.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
  await expect.poll(() => editor.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
  expect(await editor.locator("[data-message-section]").evaluateAll(elements => elements.every((element, index) => !index || element.getBoundingClientRect().top >= elements[index - 1].getBoundingClientRect().bottom - 1))).toBe(true);
  await editor.getByRole("button", { name: "Preview email", exact: true }).click();
  const letter = editor.locator("iframe").locator("..");
  await expect(letter.locator("dd")).toHaveText("[DEMO] Arrival details for the care team");
  const files = letter.locator("details");
  await expect(files.locator("summary")).toContainText("1 attachment");
  await files.locator("summary").click();
  await expect(files.getByRole("listitem")).toHaveText("Client data sheet.pdf");
  await page.keyboard.press("Escape");
  await expect(files).not.toHaveAttribute("open", "");
  await expect(files.locator("summary")).toBeFocused();
  await expect(editor).toBeVisible();
  await expect(letter).toHaveCSS("opacity", "1");
  await expect(editor.frameLocator("iframe").locator("body")).toContainText("Keep this client wording through section moves and preview.");
  await editor.getByRole("button", { name: "Back to editing", exact: true }).click();
  await expect(body).toBeFocused();
  await expect(body).toHaveValue("Keep this client wording through section moves and preview.");
  await editor.getByRole("button", { name: "Done", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Edit message", exact: true })).toBeFocused();
});
