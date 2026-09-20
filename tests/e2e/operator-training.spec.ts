import { expect, test } from "@playwright/test";
import { clientDirectoryFixture } from "./support/pipeline-clinical-fixtures";

const trainingUrl = process.env.PIPELINE_E2E_TRAINING_URL ?? "/training";
const homeUrl = trainingUrl.startsWith("http") ? new URL("/", trainingUrl).toString() : "/";

test.describe("Pipeline Learning Center", () => {
  test.beforeEach(async ({ page }) => {
    // These guide tests do not certify delegated Alamo access or use its roster.
    await page.route("**/api/profiles/directory**", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...clientDirectoryFixture, clients: [], total: 0, next_cursor: null }),
    }));
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem("operator-training-e2e-initialized") === "true") return;
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("pipeline-operator-training:")) window.localStorage.removeItem(key);
        if (key.startsWith("pipeline-guided-coach:")) window.localStorage.removeItem(key);
      }
      window.sessionStorage.setItem("operator-training-e2e-initialized", "true");
    });
  });

  test("starts an assessor workflow and advances through real controls", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await startGuide(page, "Check my work");

    await expect(page.getByRole("dialog", { name: /Check my work guided tutorial/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check your queue" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: /Check my work guided tutorial/ })).toContainText("Continue working reopens saved work when available.");
    await expect(page.locator('[data-guide-target="my-queue"]')).toBeVisible();
    await page.getByRole("dialog", { name: /Check my work guided tutorial/ }).getByRole("button", { name: "Continue", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
    await page.getByLabel("Open referrals").click();
    await expect(page).toHaveURL(/view=referrals/);
    await expect(page.getByRole("heading", { name: "Search for the referral" })).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("lets an operator skip a step without performing its action", async ({ page }) => {
    await mockTrainingProgress(page);
    await startGuide(page, "Find a referral");

    await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
    await expect(page.getByTestId("guide-spotlight-outline")).toBeVisible();
    await page.getByRole("button", { name: "Skip step" }).click();
    await expect(page).toHaveURL(/view=referrals/);
    await expect(page.getByRole("heading", { name: "Search referrals" })).toBeVisible();
  });

  test("guides referral intake without covering the upload control", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await startGuide(page, "Create a referral");

    await expect(page.getByRole("heading", { name: "Select New referral" })).toBeVisible();
    await page.getByLabel("Create new referral").click();
    await expect(page).toHaveURL(/view=referrals&screen=packet/);

    const coach = page.getByTestId("guided-coach-panel");
    const upload = page.getByRole("group", { name: "Upload initial referral document" });
    await expect(page.getByRole("heading", { name: "Upload the packet" })).toBeVisible();
    await expect(coach).not.toContainText("This step is on another Pipeline page.");
    await expect(page.getByTestId("guide-spotlight-outline")).toBeVisible();
    await expect(upload).toBeVisible();
    await expect(upload.getByRole("button", { name: "Choose file" })).toBeVisible();
    await expectGuideDoesNotCoverTarget(coach, upload);

    const fileChooserPromise = page.waitForEvent("filechooser");
    await upload.getByRole("button", { name: "Choose file" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "training-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Not an accepted referral document"),
    });
    await expect(page.getByTestId("document-checklist-panel").getByRole("alert").filter({ hasText: "Upload a PDF, JPEG, PNG, TIFF, or HEIC referral document." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upload the packet" })).toBeVisible();

    await dropTrainingPdf(upload, "training-referral.pdf");
    await expect(page.getByRole("alert").filter({ hasText: "Upload a PDF" })).toHaveCount(0);
    await expect(upload.getByText("training-referral.pdf", { exact: true })).toBeVisible();
    await expect(upload.getByText(/Ready to upload/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Verify identity" })).toBeVisible();
    await expectGuideDoesNotCoverTarget(coach, page.locator('[data-guide-target~="intake-identity"]'));

    await page.getByRole("button", { name: "Skip step" }).click();
    await expect(page.getByRole("heading", { name: "Assign the referral" })).toBeVisible();
    await expectGuideDoesNotCoverTarget(coach, page.locator('[data-guide-target~="intake-routing"]'));
    await page.getByRole("button", { name: "Skip step" }).click();
    await expect(page.getByRole("heading", { name: "Add medication information" })).toBeVisible();
    await expectGuideDoesNotCoverTarget(coach, page.locator('[data-guide-target~="intake-medications"]'));
    await page.getByRole("button", { name: "Skip step" }).click();
    await expect(page.getByRole("heading", { name: "Review before creating" })).toBeVisible();
    await expect(coach).toContainText("Finish this guide without creating a live referral.");
    await expectGuideDoesNotCoverTarget(coach, page.locator('[data-guide-target~="create-workspace"]'));
    await page.getByRole("button", { name: "Skip and finish" }).click();
    await expect(coach).toBeHidden();
    await expect.poll(() => errors).toEqual([]);
  });

  test("clears a paused walkthrough on reload", async ({ page }) => {
    await mockTrainingProgress(page);
    await startGuide(page, "Find a referral");
    await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
    await page.getByRole("button", { name: "Pause tutorial" }).click();

    await page.reload();
    await page.getByRole("button", { name: "Open guided tutorials" }).click();
    await expect(page.getByRole("dialog", { name: "Guided tutorial library" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue where you stopped/ })).toHaveCount(0);
  });

  test("keeps an unfinished walkthrough closed on an ordinary return", async ({ page }) => {
    await mockTrainingProgress(page);
    await startGuide(page, "Find a referral");
    await expect(page.getByRole("dialog", { name: /Find a referral guided tutorial/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("dialog", { name: /guided tutorial/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Open guided tutorials" }).click();
    await expect(page.getByRole("dialog", { name: "Guided tutorial library" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue where you stopped/ })).toHaveCount(0);
  });

  test("old Learning Center URLs return to the app with Help available", async ({ page }) => {
    for (const route of ["/training", "/training/demo"]) {
      await page.goto(route);
      await expect(page).toHaveURL(new URL("/", test.info().project.use.baseURL).toString());
      await expect(page.getByRole("button", { name: "Open guided tutorials" })).toBeVisible();
      await expect(page.getByText("Temporarily unavailable while we make improvements.")).toHaveCount(0);
    }
  });

  test("Help opens and closes without leaving the current intake draft", async ({ page }) => {
    await mockTrainingProgress(page);
    await page.goto(`/?view=referrals&screen=packet&draftId=${crypto.randomUUID()}`);
    const name = page.getByTestId("intake-client-folder").locator('[data-workspace-field="name"] input');
    await name.fill("Synthetic Help Draft");
    const currentUrl = page.url();
    await page.getByRole("button", { name: "Open guided tutorials" }).click();
    await page.getByRole("button", { name: "Close guided tutorials", exact: true }).click();
    await expect(name).toHaveValue("Synthetic Help Draft");
    await expect(page).toHaveURL(currentUrl);
  });

  test("guides report selection, unapplied filters, and the export checkpoint", async ({ page }) => {
    const queries: URLSearchParams[] = [];
    const exports: string[] = [];
    const catalog = [
      { id: "clients_by_community", label: "Clients by community", description: "Current clients", cadence: "Current", audience: "Supervisors", filters: ["community", "client_scope"] },
      { id: "assessment_completion", label: "Assessment completion", description: "Completed assessments", cadence: "Monthly", audience: "Supervisors", filters: ["month", "community"] },
    ];
    await mockTrainingProgress(page);
    await page.route("**/api/operations/reports**", (route) => {
      const request = route.request();
      if (request.method() !== "GET") exports.push(request.method());
      const query = new URL(request.url()).searchParams;
      queries.push(query);
      const definition = catalog.find((item) => item.id === query.get("report_id")) ?? catalog[0];
      return route.fulfill({ json: {
        catalog,
        facets: { communities: [{ value: "Turlock", count: 1 }], owners: [] },
        filters: { report_id: definition.id, month: query.get("month") ?? "", community: query.get("community") ?? "", owner: "", county: "", client_scope: query.get("client_scope") ?? "all" },
        report: { definition, columns: [], metrics: [], rows: [], row_count: 0, truncated: false, generated_at: "2026-09-13T12:00:00Z" },
      } });
    });
    await startGuide(page, "Run a report");
    await page.getByRole("button", { name: "Open reports", exact: true }).click();
    const coach = page.getByRole("dialog", { name: "Run a report guided tutorial" });
    const report = page.getByRole("combobox", { name: "Report", exact: true });
    await expect(coach.getByRole("heading", { name: "Choose the report" })).toBeVisible();
    await report.click();
    await report.press("Escape");
    await expect(coach.getByRole("heading", { name: "Choose the report" })).toBeVisible();
    // Commit an actual selection, not just focus/open the dropdown.
    await report.selectOption("assessment_completion");
    await expect(coach.getByRole("heading", { name: "Set the report filters" })).toBeVisible();
    await page.getByLabel("Report month", { exact: true }).fill("2026-08");
    await expect(coach.getByRole("heading", { name: "Apply the filters" })).toBeVisible();
    await expect(coach).toContainText("Select Apply to refresh the result.");
    await expect(page.getByRole("button", { name: "Export CSV", exact: true })).toBeDisabled();
    expect(queries.at(-1)?.get("month")).not.toBe("2026-08");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(coach.getByRole("heading", { name: "Check the results" })).toBeVisible();
    await expect.poll(() => queries.at(-1)?.get("month")).toBe("2026-08");
    await expect(page.getByRole("button", { name: "Export CSV", exact: true })).toBeEnabled();
    await coach.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(coach).toContainText("The guide does not download it for you.");
    expect(exports).toEqual([]);
  });

  test("keeps the referral upload guide clear at a narrow viewport", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await mockTrainingProgress(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await startGuide(page, "Create a referral");

    await expect(page.getByRole("heading", { name: "Select New referral" })).toBeVisible();
    await page.getByRole("button", { name: /^Open page menu/ }).click();
    await expect(page.getByTestId("guide-spotlight-outline")).toBeVisible();
    await page.getByLabel("Create new referral").click();
    await expect(page).toHaveURL(/view=referrals&screen=packet/);

    const coach = page.getByTestId("guided-coach-panel");
    const upload = page.getByRole("group", { name: "Upload initial referral document" });
    await expect(page.getByRole("heading", { name: "Upload the packet" })).toBeVisible();
    await expectGuideDoesNotCoverTarget(coach, upload);
    await expect(upload.getByRole("button", { name: "Choose file" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect.poll(() => errors).toEqual([]);
  });

  for (const width of [1440, 834, 320]) {
    test(`Help is the Learning Center and starts existing walkthroughs at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await mockTrainingProgress(page);
      await page.goto("/?screen=calendar");
      const help = page.getByRole("button", { name: "Open guided tutorials", exact: true });
      const openHelp = async () => {
        if (width < 640 && !await help.isVisible()) await page.getByRole("button", { name: /^Open page menu/ }).click();
        await help.click();
      };
      if (width < 640) await page.getByRole("button", { name: /^Open page menu/ }).click();
      await expect(help).toBeVisible();
      await expect(help).toHaveAttribute("title", "Help · Learning Center");
      await page.getByRole("button", { name: /Open profile menu for/ }).click();
      await expect(page.getByRole("dialog", { name: "Profile settings", exact: true }).getByText(/Learning Center/)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await openHelp();
      const library = page.getByRole("dialog", { name: "Guided tutorial library" });
      await expect(library.getByText("Learning Center", { exact: true })).toBeVisible();
      await expect(library.getByRole("heading", { name: "Guided walkthroughs" })).toBeVisible();
      await expect(page).toHaveURL(/screen=calendar/);
      const bounds = (await library.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`help-walkthroughs-${width}.png`) });
      await library.getByRole("button", { name: /Find a referral/ }).click();
      await expect(page.getByRole("dialog", { name: "Find a referral guided tutorial" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Open Workspaces" })).toBeVisible();
      await page.getByRole("button", { name: "Pause tutorial", exact: true }).click();
      await openHelp();
      await expect(library.getByRole("button", { name: /Continue where you stopped/ })).toBeVisible();
      await library.getByRole("button", { name: "Close guided tutorials", exact: true }).click();
      await expect(library).toBeHidden();
    });
  }

});

function watchBrowserErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    // Negative upload validation and optional local health/progress endpoints
    // intentionally return HTTP errors; assert their visible result separately.
    if (message.type() === "error" && !message.text().includes("/_next/webpack-hmr") && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectGuideDoesNotCoverTarget(
  coach: import("@playwright/test").Locator,
  target: import("@playwright/test").Locator,
) {
  await expect(coach).toBeVisible();
  await expect(target).toBeVisible();
  await expect.poll(async () => {
    const [coachBox, targetBox] = await Promise.all([coach.boundingBox(), target.boundingBox()]);
    if (!coachBox || !targetBox) return false;
    const overlapWidth = Math.max(0, Math.min(coachBox.x + coachBox.width, targetBox.x + targetBox.width) - Math.max(coachBox.x, targetBox.x));
    const overlapHeight = Math.max(0, Math.min(coachBox.y + coachBox.height, targetBox.y + targetBox.height) - Math.max(coachBox.y, targetBox.y));
    return overlapWidth * overlapHeight === 0;
  }).toBe(true);
}

async function dropTrainingPdf(target: import("@playwright/test").Locator, name: string) {
  await target.evaluate((element, fileName) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(["%PDF-1.4\n% Pipeline training fixture\n"], fileName, {
        type: "application/pdf",
      }),
    );
    element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, name);
}

async function mockTrainingProgress(page: import("@playwright/test").Page) {
  let revision = 0;
  let progress = {
    version: 2,
    curriculumVersion: "2026.09.operator.1",
    role: "assessment_coordinator",
    completedActivityIds: [] as string[],
    activeModuleId: "pipeline-purpose",
    activeActivityId: "learn",
    evidence: {},
    confidence: {},
    scenarioResults: {},
    tutorialResults: {},
  };

  await page.route("**/api/training/progress", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() as { progress?: typeof progress };
      if (payload.progress) progress = payload.progress;
      revision += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ revision, progress, updatedAt: new Date().toISOString(), persistence: "browser" }),
    });
  });
}

async function startGuide(page: import("@playwright/test").Page, title: string) {
  await page.goto(homeUrl);
  if ((page.viewportSize()?.width ?? 1440) < 640) await page.getByRole("button", { name: /^Open page menu/ }).click();
  await page.getByRole("button", { name: "Open guided tutorials", exact: true }).click();
  await page.getByRole("dialog", { name: "Guided tutorial library", exact: true }).getByRole("button", { name: new RegExp("^" + title) }).click();
}
