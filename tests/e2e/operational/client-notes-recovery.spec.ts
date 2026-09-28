import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral } from "../support/operational-api";
import { actorApiContext, operationalActorHeaders, requireOperationalBaseURL } from "../support/pipeline-actors";

test("phone notes survive closing, reload and failed saves, then sync once without blocking assessment", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Redesign operational run.");
  const url = requireOperationalBaseURL(baseURL);
  const api = await actorApiContext("assessorA", url);
  const context = await browser.newContext({ baseURL: url, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    serviceWorkers: "block", extraHTTPHeaders: operationalActorHeaders("assessorA", url) });
  const page = await context.newPage();
  try {
    const referral = await createOperationalReferral(api, "assessorA");
    await createOperationalAssessment(api, referral.id);
    const endpoint = `**/api/referrals/${referral.id}/notes/before`;
    await page.route(endpoint, (route) => route.fulfill({ status: 503, json: { error: "Synthetic notes outage" } }));
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
    const toggle = page.getByRole("button", { name: "Notes", exact: true });
    await toggle.click();
    const panel = page.getByRole("dialog", { name: "Notes", exact: true });
    const text = panel.getByRole("textbox", { name: "Before the interview notes", exact: true });
    await expect(text).toBeEditable();
    await text.fill("Synthetic phone note — keep through reload");
    await text.blur();
    await expect(panel).toContainText("Waiting to sync");
    await expect.poll(() => page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open("pipeline-offline-v1"); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
      try {
        const records = await new Promise<Array<{ kind: string; ciphertext?: ArrayBuffer; body?: string }>>((resolve, reject) => {
          const read = database.transaction("records").objectStore("records").getAll(); read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
        });
        return records.some((record) => record.kind === "client-notes-draft" && record.ciphertext instanceof ArrayBuffer && !record.body);
      } finally { database.close(); }
    })).toBe(true);
    await panel.getByRole("button", { name: "Close notes", exact: true }).click();
    await expect(page.locator("[data-assessment-view]")).toBeVisible();
    await toggle.click();
    await expect(text).toHaveValue("Synthetic phone note — keep through reload");
    await page.reload();
    await toggle.click();
    await expect(text).toHaveValue("Synthetic phone note — keep through reload");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(panel.getByRole("button", { name: "Close notes" })).toBeInViewport();
    await page.unroute(endpoint);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(panel).toContainText("All notes saved");
    const blocks = (await (await api.get(`/api/referrals/${referral.id}/notes`)).json()).blocks;
    expect(blocks).toEqual([expect.objectContaining({ body: "Synthetic phone note — keep through reload", version: 1 })]);
  } finally { await context.close(); await api.dispose(); }
});
