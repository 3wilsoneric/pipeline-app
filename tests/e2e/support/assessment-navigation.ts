import { expect, type Page } from "@playwright/test";

export async function editPreparedAnswer(page: Page, label: string) {
  // Preparation keeps recorded fields editable; interview references expose Edit.
  const input = page.getByRole("textbox", { name: label, exact: true });
  await expect.poll(async () =>
    await input.isVisible() ||
    await page.getByRole("complementary", { name: "Current information", exact: true }).isVisible() ||
    await page.getByRole("button", { name: "Client info", exact: true }).isVisible() ||
    await page.getByRole("button", { name: /^Recorded answers:/ }).isVisible()
  ).toBe(true);
  if (await input.isVisible()) return;
  const reference = page.getByRole("complementary", { name: "Current information", exact: true });
  if (await reference.isVisible()) {
    if (!await reference.getByRole("button", { name: `Edit ${label}`, exact: true }).isVisible()) {
      await reference.getByRole("button", { name: /^Current information/ }).click();
    }
    await reference.getByRole("button", { name: `Edit ${label}`, exact: true }).click();
    return;
  }
  const clientInfo = page.getByRole("button", { name: "Client info", exact: true });
  if (await clientInfo.isVisible()) {
    await clientInfo.click();
    await page.getByRole("dialog", { name: "Client information", exact: true }).getByLabel("Reference information").selectOption("all");
    await page.getByRole("dialog", { name: "Client information", exact: true }).getByRole("button", { name: `Review ${label}`, exact: true }).click();
    return;
  }
  const recorded = page.getByRole("region", { name: "Recorded answers", exact: true });
  if (!await recorded.isVisible()) await page.getByRole("button", { name: /^Recorded answers:/ }).click();
  await recorded.getByRole("button", { name: `Edit ${label}`, exact: true }).click();
}

// Redesign interview layout (docs/design/DECISIONS.md, "Interview layout") tucks the record rail away during the
// interview; a person opens it with the arrow before choosing another step, and so do the tests. No-op otherwise.
export async function leaveInterviewFullScreen(page: Page) {
  // It turns on just after a layout change (such as a resize), so give it a moment to appear.
  const on = await page.locator("html[data-interview-focus]").waitFor({ state: "attached", timeout: 1_500 }).then(() => true, () => false);
  if (!on) return;
  const toggle = page.locator("[data-interview-rail-toggle]");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}

// All questions: a button beside Interview, or (redesign interview) the first choice in the section dropdown.
export async function openAllQuestions(page: Page) {
  const button = page.locator("[data-assessment-view]").getByRole("button", { name: "All questions", exact: true }).first();
  const choice = page.locator('select[aria-label="Assessment section"]:has(option[value="all-questions"])').first();
  await button.or(choice).first().waitFor();
  if (await button.isVisible()) { await button.click(); return; }
  await choice.selectOption("all-questions");
}

export async function openAssessmentChart(page: Page) {
  await leaveInterviewFullScreen(page);
  const stagePicker = page.getByRole("combobox", { name: "Workspace view", exact: true });
  if (await stagePicker.isVisible()) {
    await stagePicker.selectOption({ label: "Chart" });
    return;
  }
  const workspace = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  if (await workspace.isVisible()) {
    await workspace.getByRole("button", { name: /Chart$/ }).click();
    return;
  }
  const pages = page.getByRole("navigation", { name: "Client file pages", exact: true });
  if (await pages.count()) {
    await pages.getByRole("button", { name: "Chart", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    await page.getByRole("dialog", { name: "Questionnaire sections", exact: true }).getByRole("button", { name: /^Review assessment/ }).click();
  }
}

export async function returnToAssessmentQuestions(page: Page) {
  const stagePicker = page.getByRole("combobox", { name: "Workspace view", exact: true });
  if (await stagePicker.isVisible()) {
    await stagePicker.selectOption({ label: "Assessment" });
    return;
  }
  const workspace = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  if (await workspace.isVisible()) {
    await workspace.getByRole("button", { name: /Assessment$/ }).click();
    return;
  }
  const pages = page.getByRole("navigation", { name: "Client file pages", exact: true });
  if (await pages.count()) await pages.getByRole("button", { name: "Assessment", exact: true }).click();
  else await page.getByRole("button", { name: "Return to questions", exact: true }).click();
}
