import { expect, test, type Locator, type Page } from "@playwright/test";

const viewports = [
  { label: "small phone", width: 320, height: 568 },
  { label: "large phone", width: 430, height: 932 },
  { label: "iPad portrait", width: 768, height: 1024 },
  { label: "constrained app window", width: 900, height: 700 },
  { label: "iPad landscape", width: 1024, height: 768 },
  { label: "medium desktop", width: 1180, height: 780 },
  { label: "desktop breakpoint", width: 1280, height: 800 },
  { label: "common laptop", width: 1366, height: 768 },
  { label: "desktop", width: 1440, height: 900 },
] as const;

test.describe("Responsive application navigation", () => {
  for (const viewport of viewports) {
    test(`keeps navigation complete and unclipped on ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockReferralDirectory(page);
      await page.goto("/?view=referrals");
      await expect(page.getByRole("main", { name: "Referral workspaces" })).toBeVisible();

      for (const name of ["Open referrals", "Open calendar", "Open client profiles", "Open reports", "Create new referral"]) {
        await expect(page.getByRole("button", { name })).toBeVisible();
      }
      await expect(page.getByRole("button", { name: "Pipeline home" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Open profile menu/ })).toBeVisible();
      await expectNoDocumentOverflow(page);
      await expectNavigationDockDoesNotScroll(page);
      await expectNavigationItemsDoNotOverlap(page);
      await expectVisibleNavigationLabelsAreContained(page);
      await expect(page.getByRole("button", { name: "Open guide launcher" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Resume guided tutorial" })).toHaveCount(0);
      if (viewport.width >= 360) {
        await expect(page.getByRole("button", { name: "Open guided tutorials" })).toBeVisible();
      }

      if (viewport.width >= 1280) {
        await expect(page.getByText("Workspaces", { exact: true })).toBeVisible();
      } else {
        await expect(page.getByText("Workspaces", { exact: true })).toBeHidden();
      }

      if (viewport.width < 1280) {
        await page.getByRole("button", { name: "Browse workspaces by month and community" }).click();
        const dialog = page.getByRole("dialog", { name: "Browse workspaces" });
        await expect(dialog).toBeVisible();
        await expandMonth(dialog.getByRole("button", { name: /September 2026/ }));
        await expect(dialog.getByRole("button", { name: "San Pablo" })).toBeVisible();
        await dialog.getByRole("button", { name: "San Pablo" }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Browse workspaces by month and community" })).toContainText("September 2026 · San Pablo");
      } else {
        const archive = page.getByRole("navigation", { name: "Browse workspaces by date and community" });
        await expect(archive).toBeVisible();
        await expect(archive.getByRole("button", { name: "Recent" })).toHaveCount(0);
        await expandMonth(archive.getByRole("button", { name: /September 2026/ }));
        await expect(archive.getByRole("button", { name: /September 2026/ })).toContainText("2,583");
        await expect(archive.getByRole("button", { name: "San Pablo" })).toBeVisible();
        await expectCommunityRowsAreAdjacent(archive);
      }

      await expectNoDocumentOverflow(page);
    });
  }
});

async function expandMonth(button: Locator) {
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
}

async function expectCommunityRowsAreAdjacent(archive: Locator) {
  const allCommunities = archive.getByRole("button", { name: "All communities", exact: true });
  const firstCommunity = archive.getByRole("button", { name: "San Pablo", exact: true });
  const [allBox, firstBox] = await Promise.all([
    allCommunities.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { bottom: box.bottom };
    }),
    firstCommunity.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { top: box.top };
    }),
  ]);
  expect(firstBox.top - allBox.bottom).toBeLessThanOrEqual(1);
}

async function mockReferralDirectory(page: Page) {
  await page.route(/\/api\/referrals(?:\/directory|\/changes)?(?:\?|$)/, async (route) => {
    if (route.request().url().includes("/changes")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ changed: false, sequence: 1 }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        referrals: [],
        total: 0,
        revision: 1,
        next_cursor: null,
        progress: {},
        file_total: 0,
        facets: {
          communities: [
            { value: "San Pablo", count: 7 },
            { value: "Turlock", count: 5 },
          ],
          counties: [],
          stages: [],
          owners: [],
          priorities: [],
          tags: [],
          months: [
            { value: "2026-09", count: 2583 },
            { value: "2026-08", count: 4 },
          ],
        },
      }),
    });
  });
}

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
}

async function expectNavigationDockDoesNotScroll(page: Page) {
  const dimensions = await page.getByTestId("primary-navigation-dock").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectNavigationItemsDoNotOverlap(page: Page) {
  const boxes = await page.getByTestId("primary-navigation").getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }),
  );
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index].left).toBeGreaterThanOrEqual(boxes[index - 1].right - 1);
  }
}

async function expectVisibleNavigationLabelsAreContained(page: Page) {
  const labels = await page.getByTestId("primary-navigation").locator("button > span").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => {
        const label = element.getBoundingClientRect();
        const button = element.parentElement?.getBoundingClientRect();
        return button ? { labelLeft: label.left, labelRight: label.right, buttonLeft: button.left, buttonRight: button.right } : null;
      })
      .filter((value): value is NonNullable<typeof value> => value !== null),
  );

  for (const label of labels) {
    expect(label.labelLeft).toBeGreaterThanOrEqual(label.buttonLeft - 1);
    expect(label.labelRight).toBeLessThanOrEqual(label.buttonRight + 1);
  }
}
