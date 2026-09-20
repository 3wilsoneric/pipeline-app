import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actorApiContext, actorPage, requireOperationalBaseURL, syntheticReferralInput } from "../support/pipeline-actors";

test.describe("referral intake usability", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational stores.");
  test.setTimeout(90_000);

  test("DOB-derived age, source suggestions and autosave work at desktop and mobile sizes", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("admin", url);
    const { context, page } = await actorPage(browser, "admin", url);
    const organization = `Intake Facility ${randomUUID().slice(0, 8)}`;
    try {
      const response = await api.post("/api/referrals", { data: { client_mutation_id: randomUUID(), referral: syntheticReferralInput("admin", { name: `Intake fixture ${randomUUID().slice(0, 8)}`, owner: "Unassigned" }) } });
      expect(response.ok(), await response.text()).toBe(true);
      const { referral } = await response.json();
      const contact = await api.post("/api/contacts", { data: {
        referral_id: referral.id,
        client_mutation_id: randomUUID(),
        contact: { firstName: "Example", lastName: "Scheduler", organization, phone: "555-0100", email: "scheduler@example.invalid" },
      } });
      expect(contact.ok(), await contact.text()).toBe(true);
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
      await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
      // Native date inputs are not textboxes in every browser's accessibility tree.
      const dob = page.locator('input[aria-label="Date of birth"]');
      await expect(dob).toBeVisible();
      await expect(dob).toHaveAttribute("type", "date");
      await expect(page.locator('[data-workspace-field="age"]')).toHaveCount(0);
      await expect(page.locator('[data-workspace-field="admissionDate"]')).toHaveCount(0);
      await dob.fill("1980-01-01");
      await expect(page.locator('[data-workspace-field="dob"]')).toContainText(`Age ${new Date().getFullYear() - 1980}`);
      await page.getByLabel("Conservatorship", { exact: true }).selectOption("yes");
      await page.getByLabel("Conservatorship", { exact: true }).selectOption("");
      const source = page.getByRole("combobox", { name: "Referral facility / source", exact: true });
      await source.fill(organization.slice(0, -2));
      await expect(page.getByRole("option", { name: new RegExp(organization) })).toBeVisible();
      await source.press("ArrowDown");
      await source.press("Enter");
      await source.blur();
      await expect(source).toHaveValue(organization);
      await expect(page.getByLabel("Client phone:", { exact: true })).toHaveValue("");
      await expect(page.getByLabel("Client email:", { exact: true })).toHaveValue("");
      await expect.poll(async () => {
        const current = await (await api.get(`/api/referrals/${referral.id}`)).json();
        return { dob: current.referral.dob, source: current.referral.source, conserved: current.referral.conserved };
      }).toEqual({ dob: "1980-01-01", source: organization, conserved: "" });
      await page.reload();
      await expect(dob).toHaveValue("1980-01-01");
      await expect(source).toHaveValue(organization);
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await dob.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await expect(dob).toBeVisible();
        await page.screenshot({ path: `/tmp/pipeline-intake-${width}.png` });
      }
      await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
      await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
      const received = page.locator('input[aria-label="Referral received:"]');
      const today = await page.evaluate(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      });
      await expect(received).toHaveValue(today);
      await source.fill(organization.slice(0, -2));
      await expect(page.getByRole("option", { name: new RegExp(organization) })).toBeVisible();
      await page.getByRole("option", { name: new RegExp(organization) }).click();
      await expect(source).toHaveValue(organization);
    } finally {
      await context.close();
      await api.dispose();
    }
  });

  test("directory import deduplicates, stays shared with approved assessors, and denies unapproved users", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("admin", url);
    const assessor = await actorApiContext("assessorA", url);
    const outsider = await actorApiContext("outsider", url);
    const { context, page } = await actorPage(browser, "admin", url);
    const stamp = randomUUID().slice(0, 8);
    const organization = `Directory Facility ${stamp}`;
    const csv = `first_name,last_name,organization,phone,email\r\nExample,Scheduler,${organization},555-0120,scheduler@example.invalid\r\n,,Directory Source ${stamp},,\r\n`;
    try {
      await page.goto("/settings");
      await page.getByText("Referral directory", { exact: true }).click();
      const directory = page.getByRole("region", { name: "Contact and facility directory" });
      await expect(directory).toBeVisible();
      const download = page.waitForEvent("download");
      await directory.getByRole("button", { name: "CSV template" }).click();
      expect((await download).suggestedFilename()).toBe("contact-directory-template.csv");
      const file = directory.getByLabel("Contacts or referral facilities CSV");
      await file.setInputFiles({ name: "directory.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await directory.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(directory.getByRole("status")).toContainText("2 new");
      await directory.getByRole("button", { name: "Import 2 new entries" }).click();
      await expect(directory.getByRole("status")).toContainText("2 entries imported");
      await file.setInputFiles({ name: "directory-again.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await directory.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(directory.getByRole("status")).toContainText("2 skipped duplicates");
      await expect(directory.getByRole("button", { name: "Import 0 new entries" })).toBeDisabled();
      await page.setViewportSize({ width: 390, height: 844 });
      await directory.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: "/tmp/pipeline-directory-390.png" });
      await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
      await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
      const source = page.getByRole("combobox", { name: "Referral facility / source", exact: true });
      await source.fill(organization.slice(0, -2));
      await page.getByRole("option", { name: new RegExp(organization) }).click();
      await expect(source).toHaveValue(organization);
      await expect(page.getByLabel("Client phone:", { exact: true })).toHaveValue("");
      expect((await assessor.get("/api/contacts?q=Directory")).status()).toBe(200);
      expect((await assessor.post("/api/contacts/import?mode=preview", { headers: { "Content-Type": "text/csv" }, data: csv })).status()).toBe(200);
      expect((await outsider.get("/api/contacts?q=Directory")).status()).toBe(403);
      expect((await outsider.post("/api/contacts/import?mode=preview", { headers: { "Content-Type": "text/csv" }, data: csv })).status()).toBe(403);
      expect((await api.post("/api/contacts/import?mode=commit", { headers: { "Content-Type": "text/csv", "x-client-mutation-id": randomUUID(), Origin: "https://untrusted.example.invalid" }, data: csv })).status()).toBe(403);
    } finally {
      await context.close();
      await api.dispose();
      await assessor.dispose();
      await outsider.dispose();
    }
  });
});
