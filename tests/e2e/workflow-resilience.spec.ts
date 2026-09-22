import { expect, test, type Page } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";
import { confirmReferralFileLabels } from "./support/referral-upload";

async function dropDocuments(page: Page, files: { name: string; text: string }[]) {
  await page.getByRole("button", { name: /Drop files or choose files/ }).evaluate((element, files) => {
    const dataTransfer = new DataTransfer();
    for (const file of files) dataTransfer.items.add(new File([file.text], file.name, { type: "text/plain" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, files);
  await confirmReferralFileLabels(page);
}

test("the first editable assessment frame retains immediate input", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic immediate entry", owner: "", tags: [] });
  const assessment = await startOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const input = document.querySelector<HTMLTextAreaElement>("#assessment-secondary_diagnoses");
      if (!input || input.readOnly || input.disabled || input.closest("[inert]")) return;
      input.focus();
      if (document.activeElement !== input) return;
      observer.disconnect();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Synthetic immediate answer");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
    });
    observer.observe(document, { childList: true, subtree: true, attributes: true });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=prepare&assessmentSection=diagnosis_clinical`);
  await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.secondary_diagnoses).toEqual(["Synthetic immediate answer"]);
  await page.getByRole("button", { name: /^Recorded answers:/ }).click();
  await expect(page.getByRole("region", { name: "Recorded answers", exact: true })).toContainText("Synthetic immediate answer");
});

test("partial dropped batch retries without duplicating committed files and retains same-name revisions", async ({ page }, info) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic upload interruption", owner: "", tags: [], documentName: "", documentStatus: "Missing" });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
  await page.getByRole("button", { name: "Workspace files", exact: true }).click();
  const inventory = async (): Promise<{ id: string; name: string; downloadUrl: string }[]> => (await (await page.request.get(`/api/files?referral_id=${referral.id}`)).json()).files;
  const first = { name: "medication-list.txt", text: "Synthetic medication note, first revision." };
  const second = { name: "tb-results.txt", text: "Synthetic second document, original bytes." };
  let completions = 0;
  const bodies: unknown[] = [];
  await page.route("**/api/uploads/complete", async (route) => {
    completions++;
    bodies.push(route.request().postDataJSON());
    if (completions === 1) {
      expect((await route.fetch()).ok()).toBe(true);
      return route.fulfill({ status: 503, json: { error: "Synthetic lost upload reply" } });
    }
    if (completions === 2) return route.continue();
    return route.fulfill({ status: 503, json: { error: "Synthetic second file interrupted. Retry saving." } });
  });
  await dropDocuments(page, [first, second]);
  const retry = page.getByRole("button", { name: "Retry saving", exact: true });
  await expect(retry).toBeVisible();
  const notice = page.getByTestId("workspace-save-status").getByRole("alert");
  await expect(notice).toHaveCSS("font-size", "14px");
  await expect(notice).toHaveCSS("color", "rgb(89, 100, 94)");
  expect(bodies[1]).toEqual(bodies[0]);
  expect((await inventory()).map((file) => file.name)).toEqual([first.name]);
  await expect(page.getByRole("list", { name: "Queued referral files" })).toContainText(second.name);
  await expect(page.getByRole("list", { name: "Queued referral files" })).not.toContainText(first.name);
  await page.screenshot({ path: info.outputPath("partial-upload-retry.png") });
  await page.unroute("**/api/uploads/complete");
  await retry.click();
  await expect.poll(async () => (await inventory()).length).toBe(2);
  await expect(retry).toHaveCount(0);
  await page.reload();
  for (const expected of [first, second]) {
    const file = (await inventory()).find((file) => file.name === expected.name)!;
    expect(await (await page.request.get(file.downloadUrl)).text()).toBe(expected.text);
  }
  const revised = { ...first, text: "Synthetic medication note, newer revision; keep the original." };
  await dropDocuments(page, [revised]);
  await expect(page.getByTestId("workspace-save-status")).toContainText("Files uploaded");
  await dropDocuments(page, [revised]);
  await expect(page.getByTestId("workspace-save-status")).toContainText("Files uploaded");
  const revisions = (await inventory()).filter((file) => file.name === first.name);
  expect(revisions).toHaveLength(2);
  expect(new Set(revisions.map((file) => file.id)).size).toBe(2);
  const contents: string[] = [];
  for (const file of revisions) contents.push(await (await page.request.get(file.downloadUrl)).text());
  expect(contents.sort()).toEqual([first.text, revised.text].sort());
});

test("a lost assessment save reply retries the same mutation without losing the next answer", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic uncertain save", owner: "", tags: [] });
  const assessment = await startOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  const endpoint = `/api/assessments/${assessment.assessment_id}`;
  const read = async () => (await (await page.request.get(endpoint)).json()).assessment;
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=prepare&assessmentSection=diagnosis_clinical`);
  const mutations: string[] = [];
  await page.route(`**${endpoint}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    mutations.push(route.request().postDataJSON().client_mutation_id);
    if (mutations.length !== 1) return route.continue();
    expect((await route.fetch()).ok()).toBe(true);
    return route.fulfill({ status: 503, json: { error: "Synthetic lost assessment reply" } });
  });
  const diagnosis = page.locator("#assessment-secondary_diagnoses");
  await diagnosis.fill("Synthetic first answer");
  await diagnosis.blur();
  await expect(diagnosis).toHaveValue("Synthetic first answer");
  await expect.poll(() => mutations.length, { timeout: 15_000 }).toBe(2);
  expect(mutations[1]).toBe(mutations[0]);
  await expect(page.locator('[data-guide-target="assessment-save-status"]')).toContainText("Offline changes synced");
  expect((await read()).audit_events.filter((event: { action: string }) => event.action === "assessment_updated")).toHaveLength(1);
  await page.locator("#assessment-current_symptoms").fill("Synthetic next answer after interrupted saving.");
  await page.getByLabel("Assessment section", { exact: true }).selectOption({ label: "Medication & health" });
  await expect.poll(async () => (await read()).current_symptoms).toBe("Synthetic next answer after interrupted saving.");
  await page.reload();
  await page.getByLabel("Assessment section", { exact: true }).selectOption({ label: "Clinical history & presentation" });
  await page.getByRole("button", { name: /^Recorded answers:/ }).click();
  const reference = page.getByRole("region", { name: "Recorded answers", exact: true });
  await expect(reference).toContainText("Synthetic first answer");
  await expect(reference).toContainText("Synthetic next answer after interrupted saving.");
  await expect(diagnosis).toHaveValue("Synthetic first answer");
  expect((await read()).signed_at).toBeNull();
});
