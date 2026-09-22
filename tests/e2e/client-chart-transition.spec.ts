import { expect, test, type Page } from "@playwright/test";
import { clientDirectoryFixture, unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";

test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });

declare global {
  interface Window {
    chartTransitionProbe: { calls: number; ready: boolean; finished: boolean; error?: string; duration?: string; sourceWidth?: number; paused?: number };
  }
}

async function fixtures(page: Page) {
  await page.route("**/api/profiles/**", (route) => route.fulfill({ json: unifiedProfileFixture }));
  await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: {
    ...clientDirectoryFixture,
    clients: [{ ...clientDirectoryFixture.clients[0], profile_key: "transition-client" }],
    total: 1, next_cursor: null,
  } }));
}

async function probe(page: Page, freeze = false) {
  await page.addInitScript((freeze) => {
    window.chartTransitionProbe = { calls: 0, ready: false, finished: false };
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (options) => {
      const result = window.chartTransitionProbe;
      result.calls += 1;
      const source = Array.from(document.querySelectorAll<HTMLElement>("button, [data-client-chart-preview]")).find((node) => getComputedStyle(node).viewTransitionName.endsWith("pipeline-client-chart"));
      const transitionName = source ? getComputedStyle(source).viewTransitionName : "pipeline-client-chart";
      result.sourceWidth = source?.getBoundingClientRect().width;
      const transition = start(options);
      void transition.ready.then(() => {
        result.duration = getComputedStyle(document.documentElement, `::view-transition-group(${transitionName})`).animationDuration;
        if (freeze) {
          const animations = document.getAnimations().filter((animation) => animation.effect instanceof KeyframeEffect && animation.effect.pseudoElement?.startsWith("::view-transition"));
          for (const animation of animations) { animation.pause(); animation.currentTime = 90; }
          result.paused = animations.length;
        }
        result.ready = true;
      }, (error) => { result.error = String(error); });
      void transition.finished.then(() => { result.finished = true; }, (error) => { result.error = String(error); });
      return transition;
    };
  }, freeze);
}

for (const layout of ["cards", "list"] as const) {
  test(`expands the ${layout} preview into the cached chart without changing its route`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await fixtures(page);
    await probe(page, true);
    await page.goto("/?screen=profiles");
    await page.getByRole("button", { name: /file cabinet$/ }).first().click();
    if (layout === "list") await page.getByRole("button", { name: "Show clients as a list", exact: true }).click();
    const card = page.getByRole("button", { name: "Open profile for Avery Example", exact: true });
    const warm = page.waitForResponse((response) => response.url().endsWith("/api/profiles/transition-client"));
    await card.hover();
    await warm;
    await card.click();
    await expect(page).toHaveURL(/screen=profile&clientId=transition-client/);
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.ready)).toBe(true);
    const result = await page.evaluate(() => window.chartTransitionProbe);
    expect(result.error).toBeUndefined();
    expect(result.calls).toBe(1);
    expect(result.duration).toBe("0.24s");
    expect(result.paused).toBeGreaterThan(0);
    if (layout === "list") expect(result.sourceWidth).toBe(58);
    else expect(result.sourceWidth).toBeGreaterThan(600);
    await page.screenshot({ path: testInfo.outputPath(`chart-expansion-${layout}-midpoint.png`) });
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
    await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.finished)).toBe(true);
    await expect(page.getByTestId("client-profile-folder")).toHaveCSS("overflow-y", "visible");
    await expect(page.getByRole("button", { name: "Back to profiles", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.className)).not.toContain("transitionRoot");
    await expect(card).toHaveCSS("view-transition-name", "none");
  });
}

for (const fallback of ["reduce", "unsupported", "throws"] as const) {
  test(`opens the chart normally with ${fallback} transitions`, async ({ page }) => {
    await fixtures(page);
    await page.emulateMedia({ reducedMotion: fallback === "reduce" ? "reduce" : "no-preference" });
    if (fallback === "reduce") await probe(page);
    else await page.addInitScript((fallback) => {
      Object.defineProperty(document, "startViewTransition", { configurable: true, value: fallback === "unsupported" ? undefined : () => { throw new Error("Transition unavailable"); } });
    }, fallback);
    await page.goto("/?screen=profiles");
    await page.getByRole("button", { name: /file cabinet$/ }).first().click();
    await page.getByRole("button", { name: "Open profile for Avery Example", exact: true }).click();
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await expect(page).toHaveURL(/screen=profile&clientId=transition-client/);
    if (fallback === "reduce") expect(await page.evaluate(() => window.chartTransitionProbe.calls)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.className)).not.toContain("transitionRoot");
  });
}

test("slow chart reads and failures never hold the directory behind an animation", async ({ page }) => {
  await fixtures(page);
  await probe(page);
  let finishRead: (() => void) | undefined;
  const pendingRead = new Promise<void>((resolve) => { finishRead = resolve; });
  await page.route("**/api/profiles/transition-client", async (route) => {
    await pendingRead;
    await route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
  });
  try {
    await page.goto("/?screen=profiles");
    await page.getByRole("button", { name: /file cabinet$/ }).first().click();
    await page.getByRole("button", { name: "Open profile for Avery Example", exact: true }).click();
    await expect(page).toHaveURL(/screen=profile&clientId=transition-client/);
    await expect(page.getByLabel("Loading admitted-client profile", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.finished)).toBe(true);
    finishRead!();
    await expect(page.getByRole("alert").filter({ hasText: "This client profile could not be loaded." })).toBeVisible();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open profile for Avery Example", exact: true })).toBeVisible();
  } finally { finishRead!(); }
});

test("back navigation interrupts a running expansion cleanly", async ({ page }) => {
  await fixtures(page);
  await probe(page, true);
  await page.goto("/?screen=profiles");
    await page.getByRole("button", { name: /file cabinet$/ }).first().click();
  await page.getByRole("button", { name: "Open profile for Avery Example", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.ready)).toBe(true);
  await page.goBack();
  await expect(page).toHaveURL(/screen=profiles/);
  await expect(page.getByRole("button", { name: "Open profile for Avery Example", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.className)).not.toContain("transitionRoot");
});

test.describe("recorded motion preview", () => {
  test("opens a folder and list thumbnail at natural speed", async ({ page }) => {
    await fixtures(page);
    await probe(page);
    await page.goto("/?screen=profiles");
    await page.getByRole("button", { name: /file cabinet$/ }).first().click();
    const card = page.getByRole("button", { name: "Open profile for Avery Example", exact: true });
    const warm = page.waitForResponse((response) => response.url().endsWith("/api/profiles/transition-client"));
    await card.hover();
    await warm;
    await card.click();
    await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.finished)).toBe(true);
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await page.getByRole("button", { name: "Show clients as a list", exact: true }).click();
    await page.evaluate(() => { window.chartTransitionProbe.finished = false; });
    await card.click();
    await expect.poll(() => page.evaluate(() => window.chartTransitionProbe.finished)).toBe(true);
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
  });
});

test.describe("return to the originating client list", () => {
  const cabinet = "A & A Health Services San Pablo";
  const roster = Array.from({ length: 40 }, (_, index) => ({
    ...clientDirectoryFixture.clients[0],
    canonical_client_id: `client-roster-${index}`,
    profile_key: `roster-${index}`,
    display_name: `Morgan ${["Ash", "Bell", "Cald", "Dun", "Ever", "Fen", "Gale", "Hart", "Irv", "Jun"][index % 10]}${["by", "ton", "wood", "mont"][Math.floor(index / 10)]}`,
    // Even rows were admitted within three months of the 2026-08-07 census.
    admit_date: new Date(Date.UTC(index % 2 ? 2025 : 2026, 5, 1 + index)).toISOString().slice(0, 10),
  }));
  const otherCabinet = [{ ...clientDirectoryFixture.clients[0], canonical_client_id: "client-bayview", profile_key: "bayview", display_name: "Jordan Pike", current_community: "Bayview Terrace", community_names: ["Bayview Terrace"] }];

  async function rosterFixtures(page: Page) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/profiles/**", (route) => route.fulfill({ json: unifiedProfileFixture }));
    await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: {
      ...clientDirectoryFixture, clients: [...roster, ...otherCabinet], total: roster.length + otherCabinet.length, next_cursor: null,
    } }));
  }

  const listScrollTop = (page: Page) => page.getByRole("list", { name: `${cabinet} clients` }).evaluate((list) => {
    let node: HTMLElement | null = list.parentElement;
    while (node && getComputedStyle(node).overflowY !== "auto") node = node.parentElement;
    return node?.scrollTop ?? -1;
  });

  /** Filtered, sorted, searched, scrolled List; opens the 15th row and returns its name and scroll offset. */
  async function openChartFromFilteredList(page: Page, query?: string) {
    await page.goto("/?screen=profiles");
    await page.getByRole("button", { name: `Open ${cabinet} file cabinet`, exact: true }).click();
    await page.getByRole("button", { name: "Show clients as a list", exact: true }).click();
    await page.getByLabel("Filter profiles by admission date").selectOption("last_3_months");
    await page.getByLabel("Sort clients", { exact: true }).selectOption("recent_admission");
    if (query) {
      const searched = page.waitForResponse((response) => new URL(response.url()).searchParams.get("q") === query);
      await page.getByRole("textbox", { name: "Search this cabinet", exact: true }).fill(query);
      await searched;
    }
    const rows = page.getByRole("list", { name: `${cabinet} clients` }).getByRole("button", { name: /^Open profile for / });
    await expect(rows).toHaveCount(20);
    const row = rows.nth(14);
    await row.scrollIntoViewIfNeeded();
    const scrollTop = await listScrollTop(page);
    expect(scrollTop).toBeGreaterThan(200);
    const name = (await row.getAttribute("aria-label"))!;
    await row.click();
    await expect(page).toHaveURL(/screen=profile&clientId=roster-/);
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    return { name, scrollTop };
  }

  async function expectOriginatingList(page: Page, origin: { name: string; scrollTop: number }, query = "") {
    await expect(page).toHaveURL(/screen=profiles/);
    await expect(page.getByRole("region", { name: `${cabinet} file cabinet`, exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search this cabinet", exact: true })).toHaveValue(query);
    await expect(page.getByLabel("Filter profiles by admission date")).toHaveValue("last_3_months");
    await expect(page.getByLabel("Sort clients", { exact: true })).toHaveValue("recent_admission");
    await expect(page.getByRole("button", { name: "Show clients as a list", exact: true })).toHaveAttribute("aria-pressed", "true");
    const row = page.getByRole("button", { name: origin.name, exact: true });
    await expect(row).toBeFocused();
    await expect(row).toBeInViewport({ ratio: 1 });
    expect(Math.abs(await listScrollTop(page) - origin.scrollTop)).toBeLessThanOrEqual(2);
  }

  test("a filtered, scrolled List → chart → Back returns to the same cabinet, query, mode and row", async ({ page }) => {
    await rosterFixtures(page);
    const origin = await openChartFromFilteredList(page, "morgan");
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await expectOriginatingList(page, origin, "morgan");

    // Contextual Back is browser Back: Forward reopens the chart, Back returns to the same row.
    await page.goForward();
    await expect(page).toHaveURL(/screen=profile&clientId=roster-/);
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await page.goBack();
    await expectOriginatingList(page, origin, "morgan");
    // Free-text searches never enter the URL or history state.
    expect(page.url()).not.toContain("morgan");
    expect(JSON.stringify(await page.evaluate(() => window.history.state))).not.toContain("morgan");

    // All cabinets stays a separate explicit action, and it also gives up the saved return.
    await page.getByRole("button", { name: "Back to cabinets", exact: true }).click();
    await expect(page.getByRole("region", { name: `${cabinet} file cabinet`, exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Search clients", exact: true })).toBeFocused();
    await page.reload();
    await expect(page.getByRole("button", { name: `Open ${cabinet} file cabinet`, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: `${cabinet} file cabinet`, exact: true })).toHaveCount(0);
  });

  test("stacked Folders keep their positions and return focus to the opened folder", async ({ page }) => {
    await rosterFixtures(page);
    await page.goto("/?screen=profiles");
    await page.getByRole("button", { name: `Open ${cabinet} file cabinet`, exact: true }).click();
    const folders = page.getByRole("list", { name: `${cabinet} clients` }).getByRole("button", { name: /^Open profile for / });
    await expect(folders).toHaveCount(40);
    const folder = folders.nth(9);
    await folder.scrollIntoViewIfNeeded();
    const scrollTop = await listScrollTop(page);
    const name = (await folder.getAttribute("aria-label"))!;
    // Stacked folders overlap by design: the visible name tab is what a person clicks.
    await folder.locator(":scope > strong").click();
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    const opened = page.getByRole("button", { name, exact: true });
    await expect(opened).toBeFocused();
    await expect(opened.locator(":scope > strong")).toBeInViewport({ ratio: 1 });
    expect(Math.abs(await listScrollTop(page) - scrollTop)).toBeLessThanOrEqual(2);
  });

  test("reloading the chart still returns to the originating cabinet, filters, mode and row", async ({ page }) => {
    await rosterFixtures(page);
    const origin = await openChartFromFilteredList(page, "morgan");
    await page.reload();
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    // The search text was memory-only; everything else came from this tab's history entry.
    await expectOriginatingList(page, origin);
  });

  test("a direct chart link falls back to all cabinets", async ({ page }) => {
    await rosterFixtures(page);
    await page.goto("/?screen=profile&clientId=roster-4");
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await expect(page).toHaveURL(/screen=profiles/);
    await expect(page.getByRole("button", { name: `Open ${cabinet} file cabinet`, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: `${cabinet} file cabinet`, exact: true })).toHaveCount(0);
  });

  test("another signed-in identity never restores the previous viewer's list", async ({ page }) => {
    await rosterFixtures(page);
    await openChartFromFilteredList(page);
    await page.route("**/api/auth/me", (route) => route.fulfill({ json: {
      user: { id: "synthetic-second-viewer", name: "Second viewer", email: "second@example.invalid", roles: ["viewer"] },
    } }));
    await page.reload();
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await expect(page).toHaveURL(/screen=profiles/);
    await expect(page.getByRole("button", { name: `Open ${cabinet} file cabinet`, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: `${cabinet} file cabinet`, exact: true })).toHaveCount(0);
  });
});

test.describe("stay history counts", () => {
  type ProfileFixture = typeof unifiedProfileFixture & {
    client: { resident_episode_history: { discharge_date: string | null }[] };
    history: Record<string, unknown>;
  };
  const chartFixture = () => structuredClone(unifiedProfileFixture) as ProfileFixture;
  const openChart = async (page: Page, profile: unknown) => {
    await page.route("**/api/profiles/**", (route) => route.fulfill({ json: profile }));
    await page.goto("/?screen=profile&clientId=transition-client");
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
  };

  test("reports two governed stays with the current one named", async ({ page }) => {
    await openChart(page, unifiedProfileFixture);
    await expect(page.getByTestId("client-stay-count")).toHaveText("2 recorded stays · 1 current");
  });

  test("says one current stay with no previous stays instead of a bare count", async ({ page }) => {
    const fixture = chartFixture();
    fixture.client.resident_episode_history = fixture.client.resident_episode_history.filter((episode) => !episode.discharge_date);
    await openChart(page, fixture);
    await expect(page.getByTestId("client-stay-count")).toHaveText("1 current stay · no previous stays recorded");
  });

  test("an unreadable placement history is unknown, never zero stays", async ({ page }) => {
    const fixture = chartFixture();
    fixture.client.resident_episode_history = [];
    fixture.history = { ...fixture.history, status: "unavailable", warning: "Placement history is temporarily unavailable." };
    await openChart(page, fixture);
    await expect(page.getByTestId("client-stay-count")).toHaveText("Stay history unavailable");
    await expect(page.getByText("Placement history is temporarily unavailable.")).toBeVisible();
    await expect(page.getByText(/recorded stay/)).toHaveCount(0);
  });

  test("a disagreeing placement history source is explained, not merged", async ({ page }) => {
    const fixture = chartFixture();
    fixture.history = { ...fixture.history, status: "available", episode_count: 5, current_episode_count: 1, warning: "Imported placement history." };
    await openChart(page, fixture);
    await expect(page.getByTestId("client-stay-count")).toHaveText("2 recorded stays · 1 current");
    await expect(page.getByText("Placement history lists 5 stays; the stays below come from the governed client record.")).toBeVisible();
  });
});
