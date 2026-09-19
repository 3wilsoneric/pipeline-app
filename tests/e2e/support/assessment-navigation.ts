import type { Page } from "@playwright/test";

export async function openAssessmentChart(page: Page) {
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
    await page.getByRole("dialog", { name: "Questionnaire sections", exact: true }).getByRole("button", { name: /^Review & sign/ }).click();
  }
}

export async function returnToAssessmentQuestions(page: Page) {
  const workspace = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  if (await workspace.isVisible()) {
    await workspace.getByRole("button", { name: /Assessment$/ }).click();
    return;
  }
  const pages = page.getByRole("navigation", { name: "Client file pages", exact: true });
  if (await pages.count()) await pages.getByRole("button", { name: "Assessment", exact: true }).click();
  else await page.getByRole("button", { name: "Return to questions", exact: true }).click();
}
