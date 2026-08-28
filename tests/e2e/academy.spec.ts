import { expect, test } from "@playwright/test";

const academyUrl = process.env.PIPELINE_E2E_ACADEMY_URL ?? "/academy";

test.describe("Private Developer Academy", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem("academy-e2e-initialized") === "true") return;
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("pipeline-developer-academy:")) window.localStorage.removeItem(key);
      }
      window.sessionStorage.setItem("academy-e2e-initialized", "true");
    });
  });

  test("gates mastery evidence, persists progress, and advances between modules", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    const response = await page.goto(academyUrl);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Master the system you own." })).toBeVisible();
    await expect(page.locator('[data-academy-hydrated="true"]')).toBeVisible();
    await expect(page.getByText("Private owner program")).toBeVisible();
    await expect(page.getByRole("group", { name: "36 modules" })).toBeVisible();
    await expect(page.getByRole("group", { name: "144 activities" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Curriculum" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Learn: Repository map and runtime boundaries" })).toBeVisible();

    await page.getByRole("button", { name: "Record and continue" }).click();
    await expect(page.getByRole("heading", { name: "Trace the current implementation" })).toBeVisible();
    const traceComplete = page.getByRole("button", { name: "Record and continue" });
    await expect(traceComplete).toBeDisabled();
    await page.getByPlaceholder("Write from memory first").fill(
      "The browser owns only the current draft. Next.js establishes identity, validates the command, and PostgreSQL owns durable referral truth; Blob and worker outcomes remain separately reconcilable.",
    );
    await expect(traceComplete).toBeEnabled();
    await traceComplete.click();

    await expect(page.getByRole("heading", { name: "Draw the production runtime map" })).toBeVisible();
    await page.getByPlaceholder("Write from memory first").fill(
      "My map contains browser, Next.js, PostgreSQL, Blob, worker, and external zones. The first durable state is the authorized database commit; packet upload failure and delayed extraction remain honest partial states.",
    );
    await page.getByRole("button", { name: "Record and continue" }).click();

    await expect(page.getByRole("heading", { name: "Verify understanding" })).toBeVisible();
    await page.getByRole("button", { name: /Only the current browser has a draft value/ }).click();
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByText(/Correct\. React state is a browser draft/)).toBeVisible();
    await page.getByRole("button", { name: "Record and continue" }).click();

    await expect(page.getByRole("heading", { name: "Learn: TypeScript, contracts, and runtime validation" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Learn: TypeScript, contracts, and runtime validation" })).toBeVisible();
    await expect(page.getByText("4/4 · 2h", { exact: true })).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("connects curriculum, journeys, repository, labs, and mastery", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await page.goto(academyUrl);
    await expect(page.locator('[data-academy-hydrated="true"]')).toBeVisible();

    await page.getByRole("tab", { name: "Journeys" }).click();
    await expect(page.getByRole("heading", { name: "Journey library" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Inbound referral to durable workspace" })).toBeVisible();
    await expect(page.getByText("What remains true if PostgreSQL commits but packet upload fails?")).toBeVisible();

    await page.getByRole("tab", { name: "Repository" }).click();
    await expect(page.getByRole("heading", { name: "Repository atlas" })).toBeVisible();
    await expect(page.getByText(/matching files/)).toBeVisible();
    await page.getByPlaceholder("Search path, subsystem, or kind").fill("referral-workflow.ts");
    await expect(page.getByText("lib/pipeline/referral-workflow.ts", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Labs" }).click();
    await expect(page.getByRole("heading", { name: "Lab workbench" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Draw the production runtime map" })).toBeVisible();
    await page.getByRole("button", { name: "Open lab" }).first().click();
    await expect(page.getByRole("heading", { name: "Draw the production runtime map" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Curriculum" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Mastery" }).click();
    await expect(page.getByRole("heading", { name: "Mastery console" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Competency gates" })).toBeVisible();
    await expect(page.getByText(/\d+ of \d+ maintained files/)).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("remains usable without document overflow at a narrow desktop pane", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(academyUrl);
    await expect(page.locator('[data-academy-hydrated="true"]')).toBeVisible();

    await expect(page.getByRole("heading", { name: "Master the system you own." })).toBeVisible();
    await expect(page.getByLabel("Current module")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Learn: Repository map and runtime boundaries" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Record and continue" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByRole("tab", { name: "Repository" }).click();
    await expect(page.getByRole("heading", { name: "Repository atlas" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

function watchBrowserErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("/_next/webpack-hmr")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
