import { expect, test } from "@playwright/test";
import { assessmentInterviewSections } from "../../lib/assessment/assessment-interview-schema";

test("lab starts fresh, exposes answer help and conditionals, and clicks through every section", async ({ page }, testInfo) => {
  await page.goto("/");
  const entry = page.getByRole("button", { name: "Open assessment lab", exact: true });
  await entry.click();
  const lab = page.getByRole("dialog", { name: "Assessment lab", exact: true });
  const rail = lab.getByRole("navigation", { name: "Practice assessment sections" });
  await expect(lab.getByRole("heading", { name: "Client & referral", exact: true })).toBeVisible();
  await expect(lab.getByLabel("Resident name *", { exact: true })).toHaveValue("");
  await expect(lab.getByLabel("Captured", { exact: true })).toHaveCount(0);
  await expect(rail.getByRole("button")).toHaveText(assessmentInterviewSections.map((section) => section.label));
  await lab.getByLabel("Resident name *", { exact: true }).fill("Lab only, not a referral");
  await rail.getByRole("button", { name: "Function", exact: true }).click();
  await lab.getByLabel("Answer help for ADL needs", { exact: true }).click();
  const help = lab.locator("details[open]");
  await expect(help.getByText("Example", { exact: true })).toBeVisible();
  await expect(help).toContainText("State exactly what the client can do");
  await rail.getByRole("button", { name: "Physical health", exact: true }).click();
  await expect(lab.getByLabel("Support *", { exact: true })).toHaveCount(0);
  await lab.getByRole("group", { name: "Incontinence issues", exact: true }).getByRole("button", { name: "Yes", exact: true }).click();
  await lab.getByLabel("Support *", { exact: true }).selectOption("needs_help_changing_briefs");
  await lab.getByRole("button", { name: "Back to Pipeline", exact: true }).click();
  await expect(lab).toHaveCount(0);
  await expect(entry).toBeFocused();
  await entry.click();
  await expect(lab.getByLabel("Resident name *", { exact: true })).toHaveValue("");
  await expect(lab.getByLabel("Captured", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("assessment-lab.png") });
  for (let index = 0; index < assessmentInterviewSections.length; index += 1) {
    await expect(lab.getByRole("heading", { name: assessmentInterviewSections[index].label, exact: true })).toBeVisible();
    await lab.getByRole("button", { name: index === assessmentInterviewSections.length - 1 ? "Done" : "Next", exact: true }).click();
  }
  await expect(lab).toHaveCount(0);
});

test("mobile profile and Learning Center expose the lab; direct lab reloads blank", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open profile menu for Alex Morgan" }).click();
  await page.getByRole("dialog", { name: "Profile settings" }).getByRole("button", { name: "Open assessment lab", exact: true }).click();
  const lab = page.getByRole("dialog", { name: "Assessment lab", exact: true });
  await expect(lab.getByLabel("Assessment section", { exact: true })).toBeVisible();
  const next = lab.getByRole("button", { name: "Next", exact: true });
  await expect(next).toBeVisible();
  const bounds = await next.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await lab.getByLabel("Assessment section", { exact: true }).selectOption("prior_history");
  await lab.getByLabel("Answer help for Prior placements").click();
  await page.screenshot({ path: testInfo.outputPath("assessment-lab-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(lab).toHaveCount(0);
  await page.goto("/training");
  await page.locator("[data-operator-academy]").getByRole("button", { name: "Open assessment lab", exact: true }).click();
  await expect(lab.getByLabel("Resident name *", { exact: true })).toHaveValue("");
  await page.keyboard.press("Escape");
  const response = await page.goto("/note-lab/practice");
  expect(response?.status()).toBe(200);
  await page.getByLabel("Resident name *", { exact: true }).fill("Discard this practice answer");
  await page.reload();
  await expect(page.getByLabel("Resident name *", { exact: true })).toHaveValue("");
  await expect(page.getByRole("heading", { name: "Client & referral", exact: true })).toBeVisible();
});
