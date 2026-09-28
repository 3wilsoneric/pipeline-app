import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { clientDirectoryFixture, unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";

async function directoryFixture(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/profiles/**", (route) => route.fulfill({ json: unifiedProfileFixture }));
  await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: {
    ...clientDirectoryFixture,
    clients: Array.from({ length: 24 }, (_, index) => ({
      ...clientDirectoryFixture.clients[0],
      profile_key: `continuity-${index}`,
      canonical_client_id: `continuity-${index}`,
      display_name: `Avery Example ${String.fromCharCode(65 + index)}`,
    })), total: 24, next_cursor: null,
  } }));
}

for (const width of [1440, 834, 390]) {
  test(`Clients keeps the cabinet, list, search, sort, scroll and focus at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await directoryFixture(page);
    await page.goto("/?screen=profiles");
    await page.getByRole("button", { name: "Open A & A Health Services San Pablo file cabinet", exact: true }).click();
    const cabinet = page.getByRole("region", { name: "A & A Health Services San Pablo file cabinet", exact: true });
    await cabinet.getByRole("button", { name: "Show clients as a list", exact: true }).click();
    const searched = page.waitForResponse((response) => response.url().includes("/api/profiles/directory") && response.url().includes("Avery"));
    await cabinet.getByRole("textbox", { name: "Search this cabinet", exact: true }).fill("Avery");
    await searched;
    const sort = cabinet.getByRole("combobox", { name: "Sort clients", exact: true });
    await sort.selectOption("recent_admission");
    const row = cabinet.getByRole("button", { name: "Open profile for Avery P", exact: true });
    await row.scrollIntoViewIfNeeded();
    const scroll = () => row.evaluate((element) => {
      let parent = element.parentElement;
      while (parent && getComputedStyle(parent).overflowY !== "auto") parent = parent.parentElement;
      return parent?.scrollTop ?? 0;
    });
    const before = await scroll();
    expect(before).toBeGreaterThan(0);
    await row.click();
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await expect(cabinet).toBeHidden();
    await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
    await expect(cabinet).toBeVisible();
    await expect(row).toBeFocused();
    await expect(cabinet.getByRole("textbox", { name: "Search this cabinet", exact: true })).toHaveValue("Avery");
    await expect(cabinet.getByRole("button", { name: "Show clients as a list", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(sort).toHaveValue("recent_admission");
    expect(await scroll()).toBeCloseTo(before, 0);
    await page.screenshot({ path: testInfo.outputPath("client-list-return.png") });
    // Native history must preserve the same directory rather than opening a fresh one.
    await row.click();
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
    await page.goBack();
    await expect(row).toBeFocused();
    await page.goForward();
    await expect(page.getByTestId("client-profile-folder")).toBeVisible();
  });
}

test("a directly opened client chart can still return to the cabinet selector", async ({ page }) => {
  await directoryFixture(page);
  await page.goto("/?screen=profile&clientId=continuity-0");
  await expect(page.getByTestId("client-profile-folder")).toBeVisible();
  await page.getByRole("button", { name: "Back to profiles", exact: true }).click();
  await expect(page.getByRole("group", { name: "Community file cabinets", exact: true })).toBeVisible();
});

test("the folder-to-chart animation still completes with the retained directory hidden", async ({ page }) => {
  await directoryFixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/?screen=profiles");
  await page.getByRole("button", { name: "Open A & A Health Services San Pablo file cabinet", exact: true }).click();
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (options) => {
      const transition = start(options);
      (window as unknown as { continuityTransition: Promise<void> }).continuityTransition = transition.ready;
      return transition;
    };
  });
  // Stacked folders expose their name tabs; the next folder covers the preview's center.
  await page.getByRole("button", { name: "Open profile for Avery A", exact: true }).getByText("Avery A", { exact: true }).click();
  await expect(page.getByTestId("client-profile-folder")).toBeVisible();
  await page.evaluate(async () => {
    const ready = (window as unknown as { continuityTransition: Promise<void> }).continuityTransition;
    if (!ready) throw new Error("The existing chart transition was not started.");
    await ready;
  });
});

test("assessment navigation retains the section through Files and Activity, and moves keyboard focus with Next", async ({ page }, testInfo) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic continuity ${randomUUID()}`, owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const snapshot = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  const before = await snapshot();
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  const section = page.getByRole("combobox", { name: "Assessment section", exact: true });
  await expect(section).toHaveValue("prior_history");
  for (const surface of ["Workspace files", "Workspace activity"]) {
    await page.getByRole("button", { name: surface, exact: true }).click();
    await expect(section).toBeHidden();
    await page.getByRole("button", { name: "Assessment", exact: true }).click();
    await expect(section).toHaveValue("prior_history");
  }
  await page.getByRole("button", { name: "Next section", exact: true }).click();
  await expect(section).not.toHaveValue("prior_history");
  // Preparation now focuses the new section heading; interview focuses its
  // first answer. Keyboard navigation must stay in the newly selected section.
  await expect(page.locator('[data-assessment-question-editor] h3')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-assessment-question-editor] :focus")).toHaveCount(1);
  await expect(page.locator('[data-guide-target="assessment-save-status"]')).toHaveCSS("font-size", "13px");
  await page.screenshot({ path: testInfo.outputPath("assessment-next-section.png") });
  // Explicit links remain authoritative, even when a prior section was retained.
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=identity`);
  await expect(section).toHaveValue("identity");
  const after = await snapshot();
  expect(after.data).toEqual(before.data);
  expect(after.version).toBe(before.version);
});

test("phone Current info preserves question focus and lets the user choose when to edit", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=interview&assessmentSection=diagnosis_clinical&demo=1");
  const assessment = page.locator("[data-phone-interview]");
  await assessment.getByRole("button", { name: "Client info", exact: true }).click();
  await page.getByRole("dialog", { name: "Client information", exact: true }).getByRole("button", { name: "Review Current symptoms", exact: true }).click();
  const answer = assessment.getByRole("textbox", { name: "Current symptoms", exact: false });
  // Keep the current phone behavior: focus the question context, not a textbox
  // that would summon the on-screen keyboard merely to review an answer.
  await expect(assessment.locator('p[tabindex="-1"]')).toBeFocused();
  await expect(answer).toBeInViewport();
  await page.keyboard.press("Tab");
  await expect(answer).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("phone-current-info-return.png") });
});
