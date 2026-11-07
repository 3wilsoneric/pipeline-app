import { expect, test } from "@playwright/test";
import { actorApiContext, actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";

test.describe("retired tutorial links preserve shared Pipeline access", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Isolated operational identities required.");

  for (const actor of ["admin", "assessmentCoordinator", "assessorA", "assessorB", "viewer"] as const) {
    test(`${actor} returns to the app instead of a tutorial`, async ({ browser, baseURL }) => {
      const url = requireOperationalBaseURL(baseURL);
      const { page, context } = await actorPage(browser, actor, url);
      try {
        await page.goto("/tutorials/referral?task=review-chart");
        await expect(page).toHaveURL(url + "/");
        await expect(page.getByTestId("tutorial-referral-session")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Open guided tutorials" })).toHaveCount(0);
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
