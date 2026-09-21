import { expect, test } from "@playwright/test";
import { actorApiContext, actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";

test.describe("tutorial access follows shared Pipeline access", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Isolated operational identities required.");

  for (const actor of ["admin", "assessmentCoordinator", "assessorA", "assessorB", "viewer"] as const) {
    test(`${actor} can open every sample step without owning a referral`, async ({ browser, baseURL }) => {
      const url = requireOperationalBaseURL(baseURL);
      const { page, context } = await actorPage(browser, actor, url);
      const writes: string[] = [];
      page.on("request", (request) => {
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && /\/api\/(referrals|assessments|files|uploads|packets)([/?]|$)/.test(new URL(request.url()).pathname)) {
          writes.push(request.method() + " " + new URL(request.url()).pathname);
        }
      });
      try {
        await page.goto("/");
        await expect(page.locator('[data-pipeline-ready="guided-coach"]')).toBeAttached();
        await page.getByRole("button", { name: "Open guided tutorials" }).click();
        const menu = page.getByRole("dialog", { name: "Tutorials", exact: true });
        for (const name of ["Create a referral & add files", "Schedule an appointment", "Fill out the assessment", "Review & sign", "Record a decision", "Prepare the admission packet"]) {
          await expect(menu.getByRole("button", { name, exact: true })).toBeEnabled();
        }
        await expect(menu.getByRole("button", { name: "View reports", exact: true })).toHaveCount(actor === "admin" || actor === "assessmentCoordinator" ? 1 : 0);
        await menu.getByRole("button", { name: /Walk through a referral/ }).click();
        await expect(page.getByTestId("tutorial-referral-session")).toBeVisible();
        for (let step = 0; step < 9; step++) {
          await page.locator("#tutorial-step").selectOption(String(step));
          await expect(page.locator("#tutorial-step")).toHaveValue(String(step));
          await expect(page.getByRole("navigation", { name: "Tutorial navigation" }).getByRole("button").last()).toBeEnabled();
        }
        await page.getByRole("button", { name: "Restart tutorial", exact: true }).click();
        await expect(page.locator("#tutorial-step")).toHaveValue("0");
        await page.getByRole("button", { name: "Close tutorial", exact: true }).click();
        await expect(page).toHaveURL(url + "/");
        expect(writes).toEqual([]);
      } finally { await context.close(); }
    });
  }

  test("anonymous and unassigned outsiders cannot open the sample through a direct link", async ({ playwright, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const anonymous = await playwright.request.newContext({ baseURL: url });
    const outsider = await actorApiContext("outsider", url);
    try {
      for (const api of [anonymous, outsider]) {
        const response = await api.get("/tutorials/referral?task=review-chart", { maxRedirects: 0 });
        expect(response.status()).toBe(307);
        expect(response.headers().location).toContain("/sign-in?next=");
      }
    } finally { await anonymous.dispose(); await outsider.dispose(); }
  });
});
