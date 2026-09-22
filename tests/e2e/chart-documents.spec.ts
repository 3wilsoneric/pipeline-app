import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { confirmReferralFileLabels } from "./support/referral-upload";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";

async function createFromIntake(page: Page) {
  const suffix = randomUUID().slice(0, 8).replace(/\d/g, "a");
  const name = `Files ${suffix[0].toUpperCase()}${suffix.slice(1)}`;
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  await page.getByRole("dialog", { name: "Workspace created", exact: true }).getByRole("button", { name: "Close workspace created" }).click();
  const id = new URL(page.url()).searchParams.get("referralId")!;
  expect(id).toBeTruthy();
  const stages = page.getByRole("navigation", { name: "Workspace stages" });
  if ((page.viewportSize()?.width ?? 1440) < 640) await expect(stages.getByRole("combobox", { name: "Workspace view" })).toHaveValue("3");
  else await expect(stages.getByRole("button", { name: /Chart$/ })).toHaveAttribute("aria-current", "page");
  return { id, name };
}

for (const width of [390, 834, 1440]) {
  test(`documents stay above the chart after creation and reload at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await createFromIntake(page);
    for (const phase of ["created", "reopened"]) {
      const documents = page.getByRole("region", { name: "Document checklist", exact: true });
      const drop = documents.getByRole("button", { name: /Drop files or choose files/ });
      await expect(drop).toBeVisible();
      await expect(page.getByTestId("document-checklist-panel")).not.toHaveAttribute("open");
      expect(await drop.evaluate((el) => el.getBoundingClientRect().bottom < window.innerHeight / 2)).toBe(true);
      expect(await documents.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`chart-documents-${width}-${phase}.png`), animations: "disabled" });
      if (phase === "created") await page.reload();
    }
  });
}

test("chart drop, updated copy, cancel and reopen preserve files and existing evidence", async ({ page }, info) => {
  const { id, name } = await createFromIntake(page);
  const inventory = async () => (await (await page.request.get(`/api/files?referral_id=${id}`)).json()).files as { id: string; name: string; category: string; downloadUrl: string }[];
  const chart = async () => (await (await page.request.get(`/api/referrals/${id}/canvas`)).json()).referral;
  const original = `Synthetic medication record for ${name}, original copy.`;
  const updated = `Synthetic medication record for ${name}, updated copy.`;
  const drop = page.getByRole("button", { name: /Drop files or choose files/ });
  await drop.evaluate((element, text) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([text], "medication-original.txt", { type: "text/plain" }));
    for (const type of ["dragenter", "dragover", "drop"]) element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
  }, original);
  expect(await inventory()).toHaveLength(0);
  await confirmReferralFileLabels(page);
  await expect.poll(async () => (await inventory()).length).toBe(1);
  const originalFile = (await inventory())[0];
  expect(originalFile.category).toBe("Medication list");
  const files = page.getByRole("region", { name: "Uploaded documents", exact: true });
  const updateButton = files.getByRole("button", { name: "Add updated copy of medication-original.txt", exact: true });
  const chooseUpdate = async () => {
    const chooser = page.waitForEvent("filechooser");
    await updateButton.click();
    await (await chooser).setFiles({ name: "new-copy.txt", mimeType: "text/plain", buffer: Buffer.from(updated) });
  };
  await chooseUpdate();
  const dialog = page.getByRole("dialog", { name: "Label your files", exact: true });
  await expect(dialog).toContainText("The original stays in Files");
  await expect(dialog.getByRole("combobox")).toHaveValue("medication_list");
  expect(await inventory()).toHaveLength(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await inventory()).toHaveLength(1);
  await chooseUpdate();
  await page.route("**/api/uploads/create-url", (route) => route.fulfill({ status: 422, json: { error: "Synthetic upload unavailable" } }));
  await confirmReferralFileLabels(page);
  await expect(page.getByTestId("workspace-save-status")).toContainText("Synthetic upload unavailable");
  await expect(page.getByRole("list", { name: "Queued referral files" })).toContainText("new-copy.txt");
  expect(await inventory()).toHaveLength(1);
  expect(await (await page.request.get(originalFile.downloadUrl)).text()).toBe(original);
  await page.unroute("**/api/uploads/create-url");
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect.poll(async () => (await inventory()).length).toBe(2);
  const newFile = (await inventory()).find((file) => file.name === "new-copy.txt")!;
  expect(newFile.category).toBe("Medication list");
  // Adding a copy must not silently displace a document already linked to the checklist.
  expect((await chart()).requirements.find((item: { type: string }) => item.type === "medication_list")?.evidenceDocumentId).toBe(originalFile.id);
  expect(await (await page.request.get(originalFile.downloadUrl)).text()).toBe(original);
  expect(await (await page.request.get(newFile.downloadUrl)).text()).toBe(updated);
  expect((await chart()).name).toBe(name);
  await page.reload();
  await page.getByTestId("document-checklist-toggle").click();
  await expect(files).toContainText(originalFile.name);
  await expect(files).toContainText(newFile.name);
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
    return (await axe.run(document.querySelector('[data-guide-target="workspace-files-upload"]')!, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
  });
  expect(violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("chart-updated-documents.png"), animations: "disabled" });
});

test("documents remain at the top when an assessment exists, without entering the interview", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Files ${randomUUID()}`, owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  await createOperationalAssessment(page.request, referral.id);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=chart`);
  const drop = page.getByRole("button", { name: /Drop files or choose files/ });
  await expect(drop).toBeVisible();
  expect(await drop.evaluate((el) => el.getBoundingClientRect().bottom < window.innerHeight / 2)).toBe(true);
  await expect(page.getByRole("button", { name: "Edit referral details", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Assessment$/ }).click();
  await expect(drop).toHaveCount(0);
  const assessment = (await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments[0];
  expect(assessment.started_at).toBeNull();
});
