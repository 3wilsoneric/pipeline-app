import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, readOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "./support/operational-api";
import { openRecipients, confirmRecipients } from "./support/handoff-review";
import type { AxeResults } from "axe-core";

test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Requires the isolated handoff draft store.");
// Route interception must reach the page's request, including in iPad/WebKit.
// Installed-app behavior remains covered by the regular workflow suites.
test.use({ serviceWorkers: "block" });

async function chooseWorkspaceView(page: Page, label: "Files" | "Decision" | "Finish & send") {
  await expect(page.getByRole("navigation", { name: "Workspace stages", exact: true })).toBeVisible();
  const phonePicker = page.getByRole("combobox", { name: "Workspace view", exact: true });
  if (await phonePicker.isVisible()) await phonePicker.selectOption({ label });
  else await page.getByRole("button", { name: label === "Files" ? "Workspace files" : label, exact: true }).click();
}

async function openHandoff(page: Page) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Synthetic exit ${randomUUID().replace(/[^a-z]/g, "")}`, community: "San Pablo", owner: "", tags: [],
  });
  await signOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  await recordOperationalAcceptance(page.request, await readOperationalReferral(page.request, referral.id));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  const dialog = await openRecipients(page);
  await dialog.getByRole("combobox", { name: /^To/ }).fill("first@example.invalid");
  await dialog.getByRole("combobox", { name: /^To/ }).press("Enter");
  await expect(dialog.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  return { referral, dialog, endpoint: `**/api/referrals/${referral.id}/handoff-recipients` };
}

test("failed message saves remain visible and can be retried from the email preview", async ({ page }, info) => {
  const { referral, endpoint } = await openHandoff(page);
  const preview = await confirmRecipients(page);
  await page.route(endpoint, route => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, json: { error: "Synthetic message save interrupted" } }) : route.continue());
  await preview.getByRole("button", { name: "Edit message", exact: true }).click();
  const message = preview.getByRole("textbox", { name: "Meet the Client message", exact: true });
  await message.fill("Synthetic message must survive a failed save.");
  await message.blur();
  await expect(preview.getByRole("alert")).toContainText("Synthetic message save interrupted");
  await expect(message).toHaveValue("Synthetic message must survive a failed save.");
  await message.fill("Corrected while the save was unavailable.");
  await message.blur();
  await expect(message).toHaveValue("Corrected while the save was unavailable.");
  await expect(preview.getByRole("status").filter({ hasText: "Changes not saved. Retry saving." })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Finish demo review", exact: true })).toBeDisabled();
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run('dialog[aria-label="Meet the Client email"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map(({ id }) => id);
  });
  expect(violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("message-save-recovery.png"), animations: "disabled" });
  await page.unroute(endpoint);
  await preview.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referral.id}/handoff-recipients`)).json()).draft.message.body)
    .toBe("Corrected while the save was unavailable.");
  await preview.getByRole("button", { name: "Back to email preview", exact: true }).click();
  await expect(page.frameLocator('iframe[title="Meet the Client email preview"]').locator("body")).toContainText("Corrected while the save was unavailable.");
});

test("retry recognizes a handoff draft saved before its response was lost", async ({ page }) => {
  const { referral, dialog, endpoint } = await openHandoff(page);
  let writes = 0;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes += 1;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    return route.fulfill({ status: 503, json: { error: "Synthetic handoff response lost" } });
  });
  await dialog.getByRole("combobox", { name: /^Cc/ }).fill("saved-despite-reply@example.invalid");
  await dialog.getByRole("combobox", { name: /^Cc/ }).press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("Synthetic handoff response lost");
  await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referral.id}/handoff-recipients`)).json()).draft.cc[0].email)
    .toBe("saved-despite-reply@example.invalid");
  await page.unroute(endpoint);
  await dialog.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  expect(writes).toBe(1);
});

for (const exit of ["Workspace files", "Change packet files"]) test(`a failed handoff save allows internal tabs and remains recoverable through ${exit}`, async ({ page }) => {
  const { referral, dialog, endpoint } = await openHandoff(page);
  await page.route(endpoint, route => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, json: { error: "Synthetic recipient save interrupted" } }) : route.continue());
  await dialog.getByRole("combobox", { name: /^Cc/ }).fill("unsaved@example.invalid");
  await dialog.getByRole("combobox", { name: /^Cc/ }).press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("Synthetic recipient save interrupted");
  if (exit === "Workspace files") await dialog.getByRole("button", { name: "Close handoff review", exact: true }).click();
  else await dialog.getByRole("button", { name: "Back", exact: true }).click();
  if (exit === "Workspace files") await chooseWorkspaceView(page, "Files");
  else await page.getByRole("button", { name: exit, exact: true }).click();
  await expect(page.locator("#packet-files")).toBeVisible();
  await expect(page).toHaveURL(/workspaceView=files/);
  await chooseWorkspaceView(page, "Finish & send");
  await expect(page.getByRole("region", { name: "Email and referral packet", exact: true }).getByRole("alert")).toContainText("Synthetic recipient save interrupted");
  const recoveredDialog = await openRecipients(page);
  await expect(recoveredDialog.getByRole("list", { name: "Cc recipients", exact: true })).toContainText("unsaved@example.invalid");
  await page.unroute(endpoint);
  await recoveredDialog.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referral.id}/handoff-recipients`)).json()).draft.cc[0].email)
    .toBe("unsaved@example.invalid");
  await recoveredDialog.getByRole("button", { name: "Close handoff review", exact: true }).click();
  await chooseWorkspaceView(page, "Files");
  await expect(page).toHaveURL(/workspaceView=files/);
});

test("unfinished recipient text survives closing review and cannot be skipped in Preview", async ({ page }) => {
  const { dialog } = await openHandoff(page);
  const verified = dialog.getByRole("checkbox", { name: /I verified/ });
  await verified.check();
  await dialog.getByRole("combobox", { name: /^Cc/ }).fill("additional@example.invalid");
  await expect(dialog.getByRole("button", { name: "Preview email", exact: true })).toBeDisabled();
  await expect(verified).not.toBeChecked();
  await dialog.getByRole("button", { name: "Close handoff review", exact: true }).click();
  await page.getByRole("button", { name: "Continue review", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: /^Cc/ })).toHaveValue("additional@example.invalid");
  await dialog.getByRole("combobox", { name: /^Cc/ }).press("Enter");
  await expect(dialog.getByRole("list", { name: "Cc recipients", exact: true })).toContainText("additional@example.invalid");
  const preview = await confirmRecipients(page);
  await expect(preview).toContainText("additional@example.invalid");
});

for (const steps of [1, 2]) test(`browser Back by ${steps} entries preserves unrecorded decisions and Forward history`, async ({ page }, info) => {
  const name = `Synthetic ${steps === 1 ? "Browserback" : "Historyjump"}${info.project.name.replace(/[^a-z]/g, "")}`;
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name, owner: "", tags: [] });
  await createOperationalAssessment(page.request, referral.id);
  await page.goto("/");
  if (page.viewportSize()!.width < 768) await page.getByRole("button", { name: /^Open page menu/ }).click();
  await page.getByRole("button", { name: "Open referrals", exact: true }).click();
  await page.getByRole("button", { name: `Open ${name} referral workspace`, exact: true }).click();
  await chooseWorkspaceView(page, "Decision");
  await page.getByRole("radio", { name: "Under review", exact: true }).check();
  await page.getByRole("textbox", { name: "What needs review?", exact: true }).fill("Synthetic decision still being considered.");
  await page.evaluate(steps => history.go(-steps), steps);
  const confirmation = page.getByRole("alertdialog", { name: "Leave without recording these changes?", exact: true });
  await expect(confirmation).toBeVisible();
  // A second Back while the choice is open must not discard edits or stack dialogs.
  await page.goBack();
  await expect(confirmation).toHaveCount(1);
  await confirmation.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "What needs review?", exact: true })).toHaveValue("Synthetic decision still being considered.");
  await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}.*workspaceView=workflow`));
  await page.goBack();
  await confirmation.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open ${name} referral workspace`, exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("textbox", { name: "Reason (optional)", exact: true })).toHaveValue("");
  const workflow = await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json();
  expect(workflow.decision).toBeNull();
});

test("changing the admit date after a lost response never replays the older date", async ({ page }) => {
  const { referral, dialog } = await openHandoff(page);
  await dialog.getByRole("button", { name: "Close handoff review", exact: true }).click();
  await chooseWorkspaceView(page, "Decision");
  const date = page.getByLabel("Planned admission date", { exact: true });
  const review = page.getByRole("button", { name: "Review email & packet", exact: true });
  const mutations: string[] = [];
  await page.route(`**/api/referrals/${referral.id}`, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    mutations.push(route.request().postDataJSON().client_mutation_id);
    if (mutations.length !== 1) return route.continue();
    expect((await route.fetch()).status()).toBe(200);
    return route.fulfill({ status: 503, json: { error: "Synthetic date reply lost" } });
  });
  await date.fill("2026-10-04");
  await review.click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic date reply lost" })).toBeVisible();
  await date.fill("2026-10-05");
  await review.click();
  await expect.poll(() => mutations.length).toBe(2);
  expect(mutations[1]).not.toBe(mutations[0]);
  await expect(date).toHaveValue("2026-10-05");
  await expect(page.getByRole("alert")).toBeVisible();
  await review.click();
  await expect(page.getByRole("button", { name: "Review handoff", exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.plannedAdmissionDate).toBe("2026-10-05");
});

test("browser Back from contact settings saves unfinished addresses and remains on a failed save", async ({ page }) => {
  let list = { community: "San Pablo", version: 1, updatedAt: null, sourceDates: [], to: [] as { name: string; email: string }[], cc: [] as { name: string; email: string }[] };
  let fail = true;
  await page.route("**/api/community-recipient-lists", async route => {
    if (route.request().method() !== "PUT") return route.fulfill({ json: { lists: [list], canManage: true } });
    if (fail) return route.fulfill({ status: 503, json: { error: "Synthetic contacts save interrupted" } });
    const command = route.request().postDataJSON();
    list = { ...list, to: command.to, cc: command.cc, version: list.version + 1 };
    return route.fulfill({ json: { list } });
  });
  await page.goto("/settings");
  await page.getByRole("link", { name: /^Community contact lists/ }).click();
  const cc = page.getByRole("combobox", { name: /^Cc/ });
  await cc.fill("retain@example.invalid");
  await page.goBack();
  await expect(page.getByRole("alert", { name: "Contact list error", exact: true })).toContainText("Synthetic contacts save interrupted");
  await expect(page).toHaveURL(/\/settings\/contact-lists/);
  await expect(cc).toHaveValue("retain@example.invalid");
  fail = false;
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goForward();
  await expect(page.getByRole("list", { name: "Cc recipients", exact: true })).toContainText("retain@example.invalid");
  expect(list.cc.map(contact => contact.email)).toEqual(["retain@example.invalid"]);
});

test("an invalid unfinished address remains editable across workspace tabs", async ({ page }) => {
  const { referral, dialog } = await openHandoff(page);
  await dialog.getByRole("combobox", { name: /^Cc/ }).fill("unfinished");
  await dialog.getByRole("button", { name: "Close handoff review", exact: true }).click();
  await chooseWorkspaceView(page, "Files");
  await expect(page).toHaveURL(/workspaceView=files/);
  await chooseWorkspaceView(page, "Finish & send");
  const recoveredDialog = await openRecipients(page);
  await expect(recoveredDialog.getByRole("combobox", { name: /^Cc/ })).toHaveValue("unfinished");
  await recoveredDialog.getByRole("combobox", { name: /^Cc/ }).fill("finished@example.invalid");
  await recoveredDialog.getByRole("combobox", { name: /^Cc/ }).press("Enter");
  await expect(recoveredDialog.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  await recoveredDialog.getByRole("button", { name: "Close handoff review", exact: true }).click();
  await chooseWorkspaceView(page, "Files");
  await expect(page).toHaveURL(/workspaceView=files/);
  expect((await (await page.request.get(`/api/referrals/${referral.id}/handoff-recipients`)).json()).draft.cc[0].email).toBe("finished@example.invalid");
});

test("Retry saving after a draft load failure restores the saved recipients", async ({ page }) => {
  const { endpoint } = await openHandoff(page);
  await page.route(endpoint, route => route.request().method() === "GET"
    ? route.fulfill({ status: 503, json: { error: "Synthetic draft load interrupted" } }) : route.continue());
  await page.reload();
  const dialog = await openRecipients(page);
  await expect(dialog.getByRole("alert")).toContainText("Recipient drafts could not be loaded");
  await page.unroute(endpoint);
  await dialog.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(dialog.getByRole("list", { name: "To recipients", exact: true })).toContainText("first@example.invalid");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await confirmRecipients(page);
});
