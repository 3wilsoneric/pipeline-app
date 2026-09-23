import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { chromium, webkit } from "@playwright/test";

const base = process.env.PIPELINE_PACKET_UI_URL;
const require = createRequire(import.meta.url);
const id = "10000000-0000-4000-8000-000000000001";
for (const [name, engine, width, height] of [["desktop", chromium, 1440, 900], ["phone", chromium, 390, 844], ["ipad", webkit, 768, 1024]]) {
  test(`recipient packet ${name}: guided verification, error recovery, file list, closing, accessibility and layout`, { skip: !base }, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width, height }, ...(name === "ipad" ? { isMobile: true, hasTouch: true } : {}) });
      let verified = false;
      const staffAuthRequests = [];
      page.on("request", (request) => {
        if (/\/api\/auth\/|login\.microsoftonline\.com/.test(request.url())) staffAuthRequests.push(request.url());
      });
      await page.route(`**/api/admission-packets/${id}`, async (route) => {
        const request = route.request();
        if (request.method() === "POST") {
          const body = request.postDataJSON();
          if (body.action === "request_code") return route.fulfill({ json: { message: "Check your inbox for the latest code." } });
          if (body.action === "close") { verified = false; return route.fulfill({ json: { ok: true } }); }
          if (body.code !== "12345678") return route.fulfill({ status: 401, json: { error: "That code is invalid or expired. Request a new code and try again." } });
          verified = true; return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill(verified ? { json: { expires_at: "2026-10-21T12:00:00Z", session_expires_at: Date.now() + 3600_000,
          message: { subject: "Synthetic admission handoff", body: "Hello team,\nPlease review all records before arrival." },
          files: [{ id: "file1", name: "Referral records — a long filename that must wrap on a phone.pdf", byteSize: 90 * 1024 ** 2 }, { id: "file2", name: "Client data sheet.pdf", byteSize: 32768 }] } }
          : { status: 401, json: { error: "Verify your email." } });
      });
      await page.goto(`${base}/admission-packet/${id}`);
      await page.getByRole("button", { name: "Email me a code" }).waitFor();
      assert.equal(await page.getByText("Synthetic admission handoff").count(), 0);
      await page.getByLabel("Your email").fill("recipient@example.invalid");
      await page.getByRole("button", { name: "Email me a code" }).click();
      await page.getByLabel("Email code").waitFor();
      assert.equal(await page.getByLabel("Email code").evaluate((node) => node === document.activeElement), true);
      await page.getByLabel("Email code").fill("00000000");
      await page.getByRole("button", { name: "Verify & open packet" }).click();
      await page.getByRole("alert").filter({ hasText: "invalid or expired" }).waitFor();
      await page.getByLabel("Email code").fill("12345678");
      await page.getByRole("button", { name: "Verify & open packet" }).click();
      await page.getByRole("heading", { name: "Your admission packet", exact: true }).waitFor();
      assert.equal(await page.locator("main a[href*='/files/']").count(), 2);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("main"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations.map(({ id, impact }) => ({ id, impact })));
      assert.deepEqual(violations, []);
      mkdirSync(".data/packet-ui-evidence", { recursive: true });
      await page.screenshot({ path: `.data/packet-ui-evidence/${name}.png`, fullPage: true });
      await page.getByRole("button", { name: "Close secure packet" }).click();
      await page.getByRole("button", { name: "Email me a code" }).waitFor();
      assert.equal(await page.getByText("Synthetic admission handoff").count(), 0);
      assert.deepEqual(staffAuthRequests, [], "packet access must work without staff identity initialization");
    } finally { await browser.close(); }
  });
}
