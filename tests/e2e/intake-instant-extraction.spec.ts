import { referralDocumentAutofillEnabled } from "../../lib/extraction/contracts";
import { chromium, expect, test, webkit, type Locator } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

function faceSheet() {
  const canvas = createCanvas(1400, 900);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 1400, 900);
  context.fillStyle = "black";
  context.font = "32px Arial";
  ["ADMISSION RECORD", "Referring Facility: Example Behavioral Health", "Resident Name: Example, Sage", "Date of Birth: 01/15/1980 Age: 46", "Gender: Female", "Responsible Person: Jamie Example", "Allergies: NKDA"].forEach((line, index) => context.fillText(line, 50, 80 + index * 90));
  return canvas.toBuffer("image/png");
}

async function drop(target: Locator, names: string[], bytes = faceSheet()) {
  await target.evaluate((element, { names, bytes }) => {
    const dataTransfer = new DataTransfer();
    names.forEach((name) => dataTransfer.items.add(new File([new Uint8Array(bytes)], name, { type: "image/png" })));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, { names, bytes: [...bytes] });
}

for (const [browserName, browserType, width] of [["chromium", chromium, 1440], ["webkit", webkit, 390]] as const) {
  test(`${browserName}: drop immediately runs real OCR before creation, shows progress and protects typing`, async ({ baseURL }, info) => {
    test.setTimeout(90_000);
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({ baseURL, viewport: { width, height: 900 } });
      await page.emulateMedia({ reducedMotion: "reduce" });
      let release = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/api/uploads/preview", async (route) => { await gate; await route.continue(); });
      const creations: string[] = [];
      page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/referrals") creations.push(request.url()); });
      await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
      await drop(page.getByTestId("document-checklist-toggle"), ["synthetic-face-sheet.png"]);
      const progress = page.getByRole("region", { name: "Reading intake files" });
      await expect(progress).toContainText("Reading synthetic-face-sheet.png");
      await expect(page.getByRole("progressbar", { name: "File extraction progress" })).not.toHaveAttribute("aria-valuenow");
      expect(creations).toEqual([]);
      await progress.screenshot({ path: info.outputPath("reading-files.png"), animations: "disabled" });
      const manualName = `Human A${randomUUID().replace(/[^a-f]/g, "").slice(0, 10)}`;
      await page.getByRole("textbox", { name: "NAME", exact: true }).fill(manualName);
      release();
      await expect(progress).toContainText("suggested details ready below", { timeout: 60_000 });
      const dob = page.getByLabel("Date of birth", { exact: true });
      await expect(dob).toHaveValue("1980-01-15");
      await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(manualName);
      await expect(page.locator('[data-workspace-field="dob"]')).toContainText("Suggested");
      expect(creations).toEqual([]);
      await page.getByRole("button", { name: "Use suggested Date of birth", exact: true }).click();
      await expect(page.locator('[data-workspace-field="dob"]')).not.toContainText("Suggested");
      await dob.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath("suggested-details.png"), animations: "disabled" });
      await page.getByRole("button", { name: "Create referral", exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
      const id = new URL(page.url()).searchParams.get("referralId");
      await expect.poll(async () => (await (await page.request.get(`/api/referrals/${id}`)).json()).referral.documentStatus).toBe("Uploaded");
      await page.reload();
      const saved = (await (await page.request.get(`/api/referrals/${id}`)).json()).referral;
      expect(saved.name).toBe(manualName);
      expect(saved.dob).toBe("1980-01-15");
      expect(saved.fieldSources.dob).toBe("synthetic-face-sheet.png");
      // Merely displaying a suggestion never turns it into a confirmed chart fact.
      expect(saved.gender ?? "").toBe("");
      expect(saved.packetFields.find((field: { field_key: string }) => field.field_key === "referral.gender").review_status).toBe("pending");
    } finally { await browser.close(); }
  });
}

function proposed(value: string, key = "referral.full_name") {
  return { fields: [{ field_key: key, version: 1, proposed_value: value, review_status: "pending", source_page_no: 1, confidence: 0.94, is_conflict: false, candidates: [] }], pageCount: 1, pagesRead: 1 };
}

for (const mode of ["azure_databricks", "manual", "unavailable"] as const) {
  test(`${mode}: unsupported preview sends no file bytes and normal creation still saves the file`, async ({ page }) => {
    let capabilityChecks = 0;
    let previewPosts = 0;
    await page.route("**/api/health", (route) => {
      capabilityChecks += 1;
      return route.fulfill({ status: mode === "unavailable" ? 503 : 200, json: { checks: { extraction_backend: { mode, ready: true } } } });
    });
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/uploads/preview") previewPosts += 1;
    });
    await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
    await drop(page.getByTestId("document-checklist-toggle"), ["normal-upload.png"]);
    await expect.poll(() => capabilityChecks).toBeGreaterThan(0);
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(`Manual A${randomUUID().replace(/[^a-f]/g, "").slice(0, 10)}`);
    await page.getByRole("button", { name: "Create referral", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
    const id = new URL(page.url()).searchParams.get("referralId");
    await expect.poll(async () => (await (await page.request.get(`/api/referrals/${id}`)).json()).referral.documentStatus).toBe("Uploaded");
    await expect(page.getByRole("region", { name: "Reading intake files" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry reading" })).toHaveCount(0);
    expect(previewPosts).toBe(0);
  });
}

test("replacement cancels stale results; extra files are read and conflicts are not guessed", async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  await page.route("**/api/uploads/preview", async (route) => {
    const call = ++calls;
    if (call === 1) await gate;
    await route.fulfill({ json: proposed(call === 1 ? "Obsolete Person" : call === 2 ? "Current Person" : "Different Person") }).catch(() => undefined);
  });
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await drop(page.getByTestId("document-checklist-toggle"), ["obsolete.png"]);
  await expect.poll(() => calls).toBe(1);
  await page.getByTestId("initial-packet-input").setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: faceSheet() });
  release();
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Current Person");
  await drop(page.getByTestId("document-checklist-toggle"), ["extra.png"]);
  await expect.poll(() => calls).toBe(3);
  await expect(page.locator('[data-workspace-field="name"]')).toContainText("The files disagree");
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Use suggested NAME:", exact: true })).toHaveCount(0);
});

test("failure has retry, does not lose the attachment, and clearing a file removes its suggestions", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/uploads/preview", (route) => ++calls === 1
    ? route.fulfill({ status: 422, json: { error: "Synthetic scan failed." } })
    : route.fulfill({ json: proposed("Recovered Person") }));
  await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
  await drop(page.getByTestId("document-checklist-toggle"), ["retry-me.png"]);
  const progress = page.getByRole("region", { name: "Reading intake files" });
  await expect(progress.getByRole("alert")).toContainText("Synthetic scan failed");
  await expect(page.getByRole("group", { name: "Upload initial referral document" })).toContainText("retry-me.png");
  await progress.getByRole("button", { name: "Retry reading" }).click();
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Recovered Person");
  await page.getByRole("button", { name: "Remove selected initial referral document" }).click();
  await expect(progress).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("");
});

test("an extra file on an existing intake suggests missing details and saves only after confirmation", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { dob: "", name: "Existing Person", owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  await page.route("**/api/uploads/preview?*", (route) => route.fulfill({ json: proposed("1980-01-15", "referral.date_of_birth") }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake&workspaceField=name`);
  await page.getByTestId("document-checklist-toggle").click();
  await drop(page.getByRole("group", { name: "Drop additional referral documents" }), ["extra-evidence.png"]);
  await expect(page.getByLabel("Date of birth", { exact: true })).toHaveValue("1980-01-15");
  expect((await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.dob).toBe("");
  await page.getByRole("button", { name: "Use suggested Date of birth", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.dob).toBe("1980-01-15");
  await page.reload();
  await expect(page.getByLabel("Date of birth", { exact: true })).toHaveValue("1980-01-15");
  expect((await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.fieldSources.dob).toBe("extra-evidence.png");
});

test("preview validates origin, file signature, and workspace before parsing", async ({ request, baseURL }) => {
  const headers = { "Content-Type": "image/png", Origin: baseURL! };
  const invalid = await request.post("/api/uploads/preview", { headers, data: Buffer.from("not really an image") });
  expect(invalid.status()).toBe(415);
  expect(invalid.headers()["cache-control"]).toContain("no-store");
  expect((await request.post("/api/uploads/preview", { headers: { ...headers, Origin: "https://untrusted.invalid" }, data: faceSheet() })).status()).toBe(403);
  expect((await request.post("/api/uploads/preview?referralId=invalid", { headers, data: faceSheet() })).status()).toBe(400);
  expect((await request.post("/api/uploads/preview?referralId=999999999", { headers, data: faceSheet() })).status()).toBe(404);
  expect((await request.post("/api/uploads/preview", { headers: { ...headers, "Content-Type": "text/plain" }, data: "unsupported" })).status()).toBe(415);
});

// Kept for the future extraction rollout; attachment-only.spec.ts covers the paused product.
test.skip(!referralDocumentAutofillEnabled, "Document reading and autofill are temporarily disabled.");
