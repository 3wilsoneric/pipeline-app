import type { Page } from "@playwright/test";

export async function editPreparedAnswer(page: Page, label: string) {
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
