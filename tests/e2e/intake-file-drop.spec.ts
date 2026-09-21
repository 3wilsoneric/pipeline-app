import { chromium, expect, test, webkit, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { confirmReferralFileLabels } from "./support/referral-upload";
import { createOperationalReferral } from "./support/operational-api";

async function dragFiles(target: Locator, names: string[], phase: "enter" | "drop" = "drop") {
  return target.evaluate((element, { files, phase }) => {
    const dataTransfer = new DataTransfer();
    files.forEach(({ name, contents }) => dataTransfer.items.add(new File([contents], name, { type: name.endsWith(".txt") ? "text/plain" : "application/pdf" })));
    const types = phase === "enter" ? ["dragenter", "dragover"] : ["drop"];
    return types.map((type) => !element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer })));
  }, { files: names.map((name) => ({ name, contents: name === "empty.txt" ? "" : syntheticPdf() })), phase });
}

function syntheticPdf() {
  const content = `BT /F1 12 Tf 50 700 Td (Synthetic packet ${randomUUID()}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

for (const [name, browserType] of [["chromium", chromium], ["webkit", webkit]] as const) {
  test(`${name}: dropping on collapsed Documents queues every file and saves the batch once`, async ({ baseURL }, info) => {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ baseURL });
      await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
      await page.getByRole("textbox", { name: "NAME", exact: true }).fill(`Drop Example ${randomUUID()}`);
      const toggle = page.getByTestId("document-checklist-toggle");
      const panel = page.getByTestId("document-checklist-panel");
      const documents = page.getByRole("region", { name: "Document checklist", exact: true });
      await expect(panel).not.toHaveAttribute("open");
      expect(await dragFiles(toggle, ["dropped-face-sheet.pdf", "dropped-care-note.pdf"], "enter")).toEqual([true, true]);
      await expect(panel).toHaveAttribute("open", "");
      await expect(documents).toHaveAttribute("data-file-drag-active", "true");
      await expect(toggle).toContainText("Release to add files");
      await page.screenshot({ path: info.outputPath("intake-drag-over.png"), animations: "disabled" });
      expect(await dragFiles(toggle, ["dropped-face-sheet.pdf", "dropped-care-note.pdf"])).toEqual([true]);
      await expect(documents).not.toHaveAttribute("data-file-drag-active");
      await confirmReferralFileLabels(page, { "dropped-care-note.pdf": "assessment" });
      await expect(page.getByRole("list", { name: "Queued referral files" })).toContainText("dropped-face-sheet.pdf");
      const queued = page.getByRole("list", { name: "Queued referral files" });
      await expect(queued.getByRole("listitem")).toHaveCount(2);
      await expect(queued).toContainText("dropped-care-note.pdf");

      // A broad drop with an existing packet adds files rather than replacing it.
      await dragFiles(toggle, ["dropped-later-note.pdf"]);
      await confirmReferralFileLabels(page, { "dropped-later-note.pdf": "assessment" });
      await expect(queued.getByRole("listitem")).toHaveCount(3);
      await expect(page.getByRole("list", { name: "Queued referral files" })).toContainText("dropped-face-sheet.pdf");
      await page.getByRole("button", { name: "Create referral", exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
      const referralId = new URL(page.url()).searchParams.get("referralId");
      await expect.poll(async () => {
        const payload = await (await page.request.get(`/api/files?referral_id=${referralId}`)).json();
        return payload.files.map((file: { name: string }) => file.name).sort();
      }).toEqual(["dropped-care-note.pdf", "dropped-face-sheet.pdf", "dropped-later-note.pdf"]);
      await page.reload();
      await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
      await expect(panel).not.toHaveAttribute("open");
      await dragFiles(toggle, ["saved-workspace-note.pdf"], "enter");
      await dragFiles(toggle, ["saved-workspace-note.pdf"]);
      await confirmReferralFileLabels(page, { "saved-workspace-note.pdf": "tb_test" });
      await expect.poll(async () => {
        const payload = await (await page.request.get(`/api/files?referral_id=${referralId}`)).json();
        return payload.files.map((file: { name: string }) => file.name).sort();
      }).toEqual(["dropped-care-note.pdf", "dropped-face-sheet.pdf", "dropped-later-note.pdf", "saved-workspace-note.pdf"]);
      const inventory = (await (await page.request.get(`/api/files?referral_id=${referralId}`)).json()).files;
      expect(inventory.find((file: {name: string}) => file.name === "dropped-care-note.pdf").category).toBe("Assessment");
      expect(inventory.find((file: {name: string}) => file.name === "dropped-later-note.pdf").category).toBe("Assessment");
      expect(inventory.find((file: {name: string}) => file.name === "saved-workspace-note.pdf").category).toBe("TB test");
      const saved = (await (await page.request.get(`/api/referrals/${referralId}`)).json()).referral;
      expect(saved.documentName).toBe("dropped-face-sheet.pdf");
    } finally { await browser.close(); }
  });

  test(`${name}: labeling is cancelable, validates files, and fits a phone`, async ({ baseURL }, info) => {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 } });
      await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
      await expect(page.locator('[data-performance-ready="packet"]')).toBeVisible();
      const toggle = page.getByTestId("document-checklist-toggle");
      const panel = page.getByTestId("document-checklist-panel");
      await dragFiles(toggle, ["empty.txt"]);
      await expect(panel.getByRole("alert")).toContainText("choose a nonempty file");
      await expect(panel.getByRole("alert")).toHaveCSS("color", "rgb(89, 100, 94)");
      await expect(panel.getByRole("alert")).toHaveCSS("background-color", "rgb(247, 250, 249)");
      await expect(page.getByRole("dialog", { name: "Label your files" })).toHaveCount(0);
      const mutations: string[] = [];
      page.on("request", (request) => { if (request.method() === "POST" && /uploads/.test(request.url())) mutations.push(request.url()); });
      await page.getByTestId("referral-documents-input").setInputFiles([
        { name: "unknown.pdf", mimeType: "application/pdf", buffer: Buffer.from(syntheticPdf()) },
        { name: "medication-list.pdf", mimeType: "application/pdf", buffer: Buffer.from(syntheticPdf()) },
      ]);
      const dialog = page.getByRole("dialog", { name: "Label your files", exact: true });
      await expect(dialog.getByRole("button", { name: "Add files", exact: true })).toBeDisabled();
      await expect(dialog.getByRole("combobox", { name: "Document type for medication-list.pdf" })).toHaveValue("medication_list");
      expect(mutations).toEqual([]);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
        return (await axe.run(document.querySelector("dialog")!, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
      });
      expect(violations).toEqual([]);
      await page.screenshot({ path: info.outputPath("label-files-phone.png"), animations: "disabled" });
      await dialog.getByRole("button", { name: "Remove medication-list.pdf" }).click();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("list", { name: "Queued referral files" })).toHaveCount(0);
      expect(mutations).toEqual([]);
      await page.getByTestId("referral-documents-input").setInputFiles({ name: "unknown.pdf", mimeType: "application/pdf", buffer: Buffer.from(syntheticPdf()) });
      await confirmReferralFileLabels(page, { "unknown.pdf": "provider_form" });
      await expect(page.getByRole("list", { name: "Queued referral files" })).toContainText("Provider form");
      await page.getByRole("button", { name: "Remove queued unknown.pdf" }).click();
      await expect(page.getByRole("list", { name: "Queued referral files" })).toHaveCount(0);
      await toggle.click();
      const prevented = await toggle.evaluate((element) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData("text/plain", "Not a file");
        return !element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
      });
      expect(prevented).toBe(false);
      await expect(panel).not.toHaveAttribute("open");
    } finally { await browser.close(); }
  });
}

test("read-only intake does not accept dropped files", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  let releaseReferral = () => {};
  const loading = new Promise<void>((resolve) => { releaseReferral = resolve; });
  await page.route(`**/api/referrals/${referral.id}`, async (route) => { await loading; await route.continue(); });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: { id: "synthetic-no-edit", name: "Synthetic reader", roles: [] } } }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake&workspaceField=name`);
  const panel = page.getByTestId("document-checklist-panel");
  await expect(panel).not.toHaveAttribute("open");
  const uploads: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && /upload|documents/.test(request.url())) uploads.push(request.url()); });
  await dragFiles(page.getByTestId("document-checklist-toggle"), ["forbidden.pdf"], "enter");
  await dragFiles(page.getByTestId("document-checklist-toggle"), ["forbidden.pdf"]);
  await expect(panel).not.toHaveAttribute("open");
  releaseReferral();
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(referral.name!);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toBeDisabled();
  await dragFiles(page.getByTestId("document-checklist-toggle"), ["forbidden.pdf"], "enter");
  await dragFiles(page.getByTestId("document-checklist-toggle"), ["forbidden.pdf"]);
  await expect(panel).not.toHaveAttribute("open");
  expect(uploads).toEqual([]);
  const saved = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  expect(saved.documentName).not.toBe("forbidden.pdf");
});
