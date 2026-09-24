import { confirmReferralFileLabels } from "../support/referral-upload";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { actorApiContext, operationalActorHeaders, requireOperationalBaseURL, syntheticReferralInput } from "../support/pipeline-actors";

async function actorPage(browser: Browser, actor: "assessorA", baseURL: string) {
  // These tests observe or interrupt requests. A service worker can bypass Playwright's routing/body capture.
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: operationalActorHeaders(actor, baseURL), serviceWorkers: "block" });
  return { context, page: await context.newPage() };
}

test.describe("field exit saves and single uploads", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Requires isolated operational stores.");
  test.setTimeout(90_000);

  test("the served policy permits a PUT to the runtime storage account and rejects other accounts", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      const response = await page.goto("/");
      const policy = response!.headers()["content-security-policy"];
      expect(policy).toContain("https://pipelinesynthetic.blob.core.windows.net");
      expect(policy).not.toContain("https://*.blob.core.windows.net");
      let transfers = 0;
      await page.route("https://*.blob.core.windows.net/**", async (route) => {
        transfers += 1;
        await route.fulfill({ status: 201, headers: { "Access-Control-Allow-Origin": new URL(url).origin } });
      });
      const put = (account: string) => page.evaluate(async (account) => {
        try {
          return (await fetch(`https://${account}.blob.core.windows.net/raw/synthetic`, {
            method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "application/octet-stream" }, body: "Synthetic bytes only",
          })).status;
        } catch { return 0; }
      }, account);
      expect(await put("pipelinesynthetic")).toBe(201);
      expect(await put("otheraccount")).toBe(0);
      expect(transfers).toBe(1);
    } finally { await context.close(); }
  });

  test("intake saves only the departed cell, even while that save is slow", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      const referral = await createReferral(api);
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
      await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
      const phone = page.getByRole("textbox", { name: "Referrer phone:", exact: true });
      const email = page.getByRole("textbox", { name: "Referrer email:", exact: true });
      await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
      await expect(phone).toBeVisible();
      const writes = recordWrites(page);
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      await page.route(`**/api/referrals/${referral.id}`, async (route) => {
        if (route.request().method() === "PATCH" && route.request().postDataJSON().patch.phone) await held;
        await route.continue();
      });
      await phone.fill("555-0123");
      await page.waitForTimeout(900); // Longer than both removed autosave timers.
      expect(writes).toEqual([]);
      await email.fill("synthetic@example.invalid");
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0].patch).toMatchObject({ phone: "555-0123" });
      expect(writes[0].patch.email).toBeUndefined();
      await page.waitForTimeout(900);
      expect(writes).toHaveLength(1);
      release();
      await expect.poll(async () => (await readReferral(api, referral.id)).phone).toBe("555-0123");
      expect((await readReferral(api, referral.id)).email).toBe("");
      await expect(email).toHaveValue("synthetic@example.invalid");
      await email.blur();
      await expect.poll(async () => (await readReferral(api, referral.id)).email).toBe("synthetic@example.invalid");
      await expect.poll(() => writes.length).toBe(2);
      await phone.focus();
      await phone.blur();
      await page.waitForTimeout(600);
      expect(writes).toHaveLength(2);
      await page.reload();
      await expect(email).toHaveValue("synthetic@example.invalid");
    } finally { await context.close(); await api.dispose(); }
  });

  test("assessment snapshots on blur, keeps the next answer local, and saves reasons on exit", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      const referral = await createReferral(api);
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
      await page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Assessment", exact: true }).click();
      const editor = page.locator('[data-assessment-view]');
      await editor.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("prior_history");
      const first = editor.getByRole("textbox", { name: /Prior 5150/ });
      const second = editor.getByRole("textbox", { name: /Crisis \/ ER utilization/ });
      const records = (await (await api.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
      const id = records[0].assessment_id;
      const read = async () => (await (await api.get(`/api/assessments/${id}`)).json()).assessment;
      const writes = recordWrites(page);
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      await page.route(`**/api/assessments/${id}`, async (route) => {
        if (route.request().method() === "PATCH" && route.request().postDataJSON().patch.data.prior_5150_5250_holds) await held;
        await route.continue();
      });
      await first.fill("Synthetic first answer");
      await page.waitForTimeout(900);
      expect(writes).toEqual([]);
      await second.fill("Synthetic second answer still being typed");
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0].patch.data).toEqual({ prior_5150_5250_holds: "Synthetic first answer" });
      release();
      await expect.poll(async () => (await read()).prior_5150_5250_holds).toBe("Synthetic first answer");
      await page.waitForTimeout(900);
      expect(writes).toHaveLength(1);
      expect((await read()).crisis_er_utilization).toBeNull();
      await expect(second).toHaveValue("Synthetic second answer still being typed");
      await second.blur();
      await expect.poll(async () => (await read()).crisis_er_utilization).toBe("Synthetic second answer still being typed");
      await second.focus();
      await second.blur();
      await page.waitForTimeout(600);
      expect(writes).toHaveLength(2);

      await editor.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("medication");
      const cell = editor.locator('[data-working-field="im_injections"]');
      await cell.getByRole("button", { name: /Unable/ }).click();
      await cell.getByRole("textbox").fill("Synthetic source unavailable");
      await page.waitForTimeout(900);
      expect(writes).toHaveLength(2);
      await page.getByTestId("workspace-folder-header").getByRole("button", { name: "Workspaces", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect.poll(async () => (await read()).im_injections).toBe("unable_to_assess");
      await expect.poll(async () => (await read()).unable_to_assess_reasons.im_injections).toBe("Synthetic source unavailable");
    } finally { await context.close(); await api.dispose(); }
  });

  test("real file selection survives a lost completion reply without duplicate documents or blocked fields", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      const referral = await createReferral(api);
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
      await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
      const canvas = createCanvas(300, 120);
      const drawing = canvas.getContext("2d");
      drawing.fillStyle = "white"; drawing.fillRect(0, 0, 300, 120);
      drawing.fillStyle = "black"; drawing.font = "20px sans-serif"; drawing.fillText("Synthetic file only", 12, 60);
      const file = { name: "single-upload-synthetic.png", mimeType: "image/png", buffer: canvas.toBuffer("image/png") };
      const reservations: string[] = [];
      let transfers = 0;
      page.on("request", (request) => {
        if (request.url().endsWith("/api/uploads/create-url")) reservations.push(request.postDataJSON().packet_id);
        if (request.url().endsWith("/api/uploads/local")) transfers += 1;
      });
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let interrupted = false;
      await page.route("**/api/uploads/complete", async (route) => {
        if (interrupted) return route.continue();
        interrupted = true;
        await held;
        await route.fetch(); // Server commits; client loses the acknowledgement.
        await route.fulfill({ status: 503, json: { error: "Synthetic lost upload acknowledgement" } });
      });
      const input = page.getByLabel("Choose referral documents");
      await expect(page.getByRole("combobox", { name: "Assessor", exact: true })).toHaveValue("assessor-a");
      await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
      await page.getByTestId("document-checklist-toggle").click();
      await input.setInputFiles(file);
      await confirmReferralFileLabels(page);
      await expect.poll(() => interrupted, { timeout: 20_000 }).toBe(true);
      await expect(page.getByRole("navigation", { name: "Workspace stages", exact: true }).getByRole("button", { name: "Assessment", exact: true })).toBeEnabled();
      const phone = page.getByRole("textbox", { name: "Referrer phone:", exact: true });
      await phone.fill("555-0199");
      await phone.blur();
      await expect.poll(async () => (await readReferral(api, referral.id)).phone).toBe("555-0199");
      release();
      const files = async () => (await (await api.get(`/api/files?referral_id=${referral.id}`)).json()).files.filter((item: { name: string }) => item.name === file.name);
      await expect.poll(async () => (await files()).length).toBe(1);
      await expect(page.getByTestId("workspace-save-status")).toContainText("Files uploaded");
      expect(transfers).toBe(1);
      await page.reload();
      await expect(page.getByRole("combobox", { name: "Assessor", exact: true })).toHaveValue("assessor-a");
      await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
      await page.getByTestId("document-checklist-toggle").click();
      await input.setInputFiles(file);
      await confirmReferralFileLabels(page);
      await expect.poll(() => reservations.length).toBe(2);
      await expect(page.getByTestId("workspace-save-status")).toContainText("Files uploaded");
      expect(new Set(reservations).size).toBe(1);
      expect(await files()).toHaveLength(1);
      const digest = createHash("sha256").update(file.buffer).digest("hex");
      const stored = await readFile(join(process.env.PIPELINE_E2E_DOCUMENT_STORE_PATH!, digest, "original.png"));
      expect(stored).toEqual(file.buffer);
    } finally { await context.close(); await api.dispose(); }
  });

  test("a new intake draft saves on blur and creates one referral with one initial packet", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      await api.get("/api/auth/me");
      await page.goto("/");
      await page.getByRole("button", { name: "Create new referral", exact: true }).click();
      const name = `Upload ${randomUUID().replace(/\d/g, "x")}`;
      const input = page.getByRole("textbox", { name: "NAME", exact: true });
      await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
      await expect(input).toBeEditable();
      const writes = recordWrites(page);
      await input.fill(name);
      await page.waitForTimeout(900);
      expect(writes).toEqual([]);
      await input.blur();
      await expect.poll(() => writes.length).toBe(1);
      await expect(page.getByTestId("workspace-save-status")).toContainText("Draft saved");
      const creations: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === "/api/referrals") creations.push(request.url());
      });
      const canvas = createCanvas(240, 100);
      const drawing = canvas.getContext("2d");
      drawing.fillStyle = "white"; drawing.fillRect(0, 0, 240, 100);
      drawing.fillStyle = "black"; drawing.font = "18px sans-serif"; drawing.fillText("Synthetic intake", 12, 50);
      const packet = { name: "initial-synthetic.png", mimeType: "image/png", buffer: canvas.toBuffer("image/png") };
      await page.getByTestId("document-checklist-toggle").click();
      await page.getByTestId("referral-documents-input").setInputFiles(packet);
      await confirmReferralFileLabels(page, {}, "face_sheet");
      const creation = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/referrals" && response.ok());
      await page.getByRole("button", { name: "Create referral", exact: true }).click();
      const created = [(await (await creation).json()).referral.id];
      expect(creations).toHaveLength(1);
      await expect(page.getByTestId("workspace-save-status")).toContainText("Packet uploaded and ready for review", { timeout: 20_000 });
      const files = (await (await api.get(`/api/files?referral_id=${created[0]}`)).json()).files;
      expect(files.filter((file: { name: string }) => file.name === packet.name)).toHaveLength(1);
      const download = await api.get(`/api/referrals/${created[0]}/packet`);
      expect(download.status()).toBe(200);
      expect(await download.body()).toEqual(packet.buffer);
      const saved = await readReferral(api, created[0]);
      const evidence = await api.get(`/api/packets/${saved.packetId}/evidence/referral.packet_summary`);
      expect(evidence.status()).toBe(404); // Attachment-only intake creates no extracted-field evidence.
      expect(download.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'self';");
      const removal = await api.delete(`/api/files/${files[0].id}`, { data: { confirmed: true } });
      expect(removal.status()).toBe(200);
      expect((await api.get(`/api/referrals/${created[0]}/packet`)).status()).toBe(404);
      expect((await api.get(`/api/packets/${saved.packetId}/evidence/referral.packet_summary`)).status()).toBe(404);
      const restored = await api.post(`/api/files/${files[0].id}`, { data: { confirmed: true, deletion_id: (await removal.json()).deletion_id } });
      expect(restored.status()).toBe(200);
      expect(await (await api.get(`/api/referrals/${created[0]}/packet`)).body()).toEqual(packet.buffer);
      expect((await readReferral(api, created[0])).name).toBe(saved.name);
      expect(created).toHaveLength(1);
    } finally { await context.close(); await api.dispose(); }
  });
});

function recordWrites(page: Page) {
  const writes: Array<{ patch: { phone?: string; email?: string; data?: Record<string, unknown> } }> = [];
  page.on("request", (request) => {
    if (["PATCH", "PUT"].includes(request.method()) && /\/api\/(?:assessments\/|referrals\/|me\/.*draft)/.test(request.url())) writes.push(request.postDataJSON());
  });
  return writes;
}

async function createReferral(api: APIRequestContext) {
  await api.get("/api/auth/me");
  const response = await api.post("/api/referrals", { data: {
    client_mutation_id: randomUUID(),
    referral: syntheticReferralInput("assessorA", { name: `Blur ${randomUUID().replace(/\d/g, "x")}`, documentName: "", documentStatus: "Missing" }),
  } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).referral;
}

async function readReferral(api: APIRequestContext, id: number) {
  const response = await api.get(`/api/referrals/${id}/canvas`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).referral;
}
