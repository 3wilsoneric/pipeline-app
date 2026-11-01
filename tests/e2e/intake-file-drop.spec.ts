import { closeTestBrowser } from "./support/browser-lifecycle";
import { chromium, expect, test, webkit, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
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
  test(`${name}: intake drop area queues every file and saves the batch once`, async ({ baseURL }, info) => {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ baseURL });
      await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
      await page.getByRole("textbox", { name: "NAME", exact: true }).fill(`Drop Example ${randomUUID()}`);
      const toggle = page.locator('[data-guide-target="initial-packet-upload"]');
      const documents = page.getByRole("region", { name: "Document checklist", exact: true });
      await expect(toggle).toBeVisible();
      expect(await dragFiles(toggle, ["dropped-face-sheet.pdf", "dropped-care-note.pdf"], "enter")).toEqual([true, true]);
      await expect(toggle).toBeVisible();
      await expect(documents).toHaveAttribute("data-file-drag-active", "true");
      await expect(toggle).toContainText("Release to label your files");
      await page.screenshot({ path: info.outputPath("intake-drag-over.png"), animations: "disabled" });
      expect(await dragFiles(toggle, ["dropped-face-sheet.pdf", "dropped-care-note.pdf"])).toEqual([true]);
      await expect(documents).not.toHaveAttribute("data-file-drag-active");
      const preview = page.getByTitle("Preview dropped-face-sheet.pdf", { exact: true });
      await expect(preview).toBeVisible();
      await expect(preview).toHaveAttribute("src", /^blob:/);
      await page.screenshot({ path: info.outputPath("intake-pdf-preview.png"), animations: "disabled" });
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
      await page.getByRole("region", { name: "Workspace created", exact: true }).getByRole("button", { name: "Dismiss workspace next steps" }).click();
      await page.reload();
      await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
      await expect(toggle).toBeVisible();
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
    } finally { await closeTestBrowser(browser); }
  });

  test(`${name}: labeling is cancelable, validates files, and fits a phone`, async ({ baseURL }, info) => {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 } });
      await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
      await expect(page.locator('[data-performance-ready="packet"]')).toBeVisible();
      const toggle = page.locator('[data-guide-target="initial-packet-upload"]');
      await dragFiles(toggle, ["empty.txt"]);
      const documents = page.getByRole("region", { name: "Document checklist", exact: true });
      await expect(documents.getByRole("alert")).toContainText("choose a nonempty file");
      // Validate readable feedback across theme changes, rather than the retired palette.
      await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
      const alertViolations = await documents.getByRole("alert").evaluate(async (element) => {
        const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
        return (await axe.run(element, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
      });
      expect(alertViolations).toEqual([]);
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
      const prevented = await toggle.evaluate((element) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData("text/plain", "Not a file");
        return !element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
      });
      expect(prevented).toBe(false);
      await expect(documents).not.toHaveAttribute("data-file-drag-active");
    } finally { await closeTestBrowser(browser); }
  });
}

test("read-only intake does not accept dropped files", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "" });
  let releaseReferral = () => {};
  const loading = new Promise<void>((resolve) => { releaseReferral = resolve; });
  await page.route(`**/api/referrals/${referral.id}`, async (route) => { await loading; await route.continue(); });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: { id: "synthetic-no-edit", name: "Synthetic reader", roles: [] } } }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake&workspaceField=name`);
  const panel = page.getByRole("region", { name: "Document checklist", exact: true });
  await expect(panel).not.toHaveAttribute("data-file-drag-active");
  const uploads: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && /upload|documents/.test(request.url())) uploads.push(request.url()); });
  await dragFiles(panel, ["forbidden.pdf"], "enter");
  await dragFiles(panel, ["forbidden.pdf"]);
  await expect(panel).not.toHaveAttribute("data-file-drag-active");
  releaseReferral();
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(referral.name!);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toBeDisabled();
  await dragFiles(panel, ["forbidden.pdf"], "enter");
  await dragFiles(panel, ["forbidden.pdf"]);
  await expect(panel).not.toHaveAttribute("data-file-drag-active");
  expect(uploads).toEqual([]);
  const saved = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  expect(saved.documentName).not.toBe("forbidden.pdf");
});

for (const width of [1440, 390]) test(`selected files can be inspected and removed before upload at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await expect(page.locator('[data-performance-ready="packet"]')).toBeVisible();
  const mutations: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && /\/api\/(uploads|referrals|packets)/.test(request.url())) mutations.push(request.url()); });
  await page.evaluate(() => {
    const state = window as unknown as { previewPolicyFailures: string[]; revokedPreviews: string[] };
    state.previewPolicyFailures = [];
    state.revokedPreviews = [];
    document.addEventListener("securitypolicyviolation", event => state.previewPolicyFailures.push(event.violatedDirective));
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { state.revokedPreviews.push(url); revoke(url); };
  });
  const canvas = createCanvas(600, 400);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 600, 400);
  context.fillStyle = "black";
  context.font = "24px sans-serif";
  context.fillText("Synthetic medication list", 30, 60);
  context.fillText("Local preview fixture", 30, 110);
  await page.getByTestId("referral-documents-input").setInputFiles([
    { name: "medication-list.pdf", mimeType: "application/pdf", buffer: Buffer.from(syntheticPdf()) },
    { name: "referral-note.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic reference\n<img src=x onerror=alert(1)>\nKeep these original bytes.") },
    { name: "medication-photo.png", mimeType: "image/png", buffer: canvas.toBuffer("image/png") },
    { name: "unknown.html", mimeType: "text/html", buffer: Buffer.from("<script>window.top.__unsafePreview=true</script>") },
    { name: "mislabeled.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>window.top.__unsafePreview=true</script></html>") },
  ]);
  const dialog = page.getByRole("dialog", { name: "Label your files", exact: true });
  const pdf = dialog.getByTitle("Preview medication-list.pdf", { exact: true });
  await expect(pdf).toBeVisible();
  await expect(pdf).toHaveAttribute("src", /^blob:/);
  const url = (await pdf.getAttribute("src"))?.split("#")[0];
  await dialog.getByRole("button", { name: "Preview referral-note.txt", exact: true }).click();
  const text = dialog.locator("pre");
  await expect(text).toContainText("Keep these original bytes.");
  await expect(text.locator("img")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { revokedPreviews: string[] }).revokedPreviews)).toContain(url);
  await expect(dialog.getByRole("combobox", { name: "Document type for medication-list.pdf", exact: true })).toHaveValue("medication_list");
  await page.addScriptTag({ path: "node_modules/axe-core/axe.min.js" });
  const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof import("axe-core") }).axe.run(document.querySelector("dialog[open]")!, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations);
  expect(violations).toEqual([]);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`selected-files-preview-${width}.png`), animations: "disabled" });
  await dialog.getByRole("button", { name: "Preview medication-photo.png", exact: true }).click();
  const image = dialog.getByRole("img", { name: "Preview medication-photo.png", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(600);
  const imageUrl = await image.getAttribute("src");
  await dialog.getByRole("button", { name: "Preview unknown.html", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { revokedPreviews: string[] }).revokedPreviews)).toContain(imageUrl);
  await expect(dialog).toContainText("Preview isn’t available for this file type.");
  await dialog.getByRole("button", { name: "Preview mislabeled.pdf", exact: true }).click();
  await expect(dialog).toContainText("Preview unavailable. You can still add this file.");
  await expect(dialog.locator("iframe")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Remove mislabeled.pdf", exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Document type for mislabeled.pdf", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __unsafePreview?: boolean }).__unsafePreview)).toBeUndefined();
  await expect.poll(() => page.evaluate(() => (window as unknown as { previewPolicyFailures: string[] }).previewPolicyFailures)).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Queued referral files" })).toHaveCount(0);
  expect(mutations).toEqual([]);
});

test("medication files remain at the top and earlier typed history still saves", async ({ page }) => {
  const history = "Synthetic earlier medication history";
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "", currentMedications: history });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake&workspaceField=currentMedications`);
  await expect(page.getByRole("heading", { name: /^Medication list/ })).toHaveCount(0);
  const toggle = page.getByText("Earlier typed medication history", { exact: true });
  await toggle.click();
  const field = page.locator('[data-workspace-field="currentMedications"] textarea');
  await expect(field).toHaveValue(history);
  expect(await field.evaluate(el => Boolean(el.closest("aside")?.querySelector('[data-guide-target="workspace-files-upload"]')))).toBe(true);
  await field.fill(`${history}\nSynthetic update`);
  await page.getByRole("textbox", { name: "NAME", exact: true }).focus();
  await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.currentMedications).toBe(`${history}\nSynthetic update`);
  await page.reload();
  await page.getByText("Earlier typed medication history", { exact: true }).click();
  await expect(field).toHaveValue(`${history}\nSynthetic update`);
  await page.getByRole("button", { name: "Document checklist", exact: true }).click();
  await expect(page.getByRole("region", { name: "Document checklist", exact: true }).getByText("Signed Medication List", { exact: true })).toBeVisible();
});
