import { expect, test } from "@playwright/test";
import { assessmentToolSections } from "../../lib/assessment/assessment-tool-schema";
import { openAssessmentFixture } from "./support/assessment-fixture";

test("every interview section keeps its reference, URL and client data consistent", async ({ page }) => {
  const { read } = await openAssessmentFixture(page, { mode: "interview", section: "diagnosis_clinical" });
  const before = await read();
  const picker = page.getByLabel("Assessment section", { exact: true });
  const topic = page.locator("[data-split-topic]");
  // This fully recorded topic has no question heading. Its deep link must still
  // open its own reference, instead of falling back to the identity topic.
  await expect(page.locator('[data-assessment-group-heading="diagnosis_clinical"]')).toHaveCount(0);
  await expect(topic).toHaveAttribute("data-split-topic", "diagnosis_clinical");
  for (const section of assessmentToolSections) {
    await picker.selectOption(section);
    await expect(picker).toHaveValue(section);
    await expect(topic).toHaveAttribute("data-split-topic", section);
    await expect(page).toHaveURL(new RegExp(`assessmentSection=${section}(?:&|$)`));
  }
  expect(await read()).toEqual(before);
});

test("back-to-back section changes preserve the final destination after reload", async ({ page }) => {
  await openAssessmentFixture(page, { mode: "interview", section: "diagnosis_clinical" });
  const picker = page.getByLabel("Assessment section", { exact: true });
  for (const finalSection of ["prior_history", "medication", "identity", "diagnosis_clinical"]) {
    await picker.evaluate((element, destination) => {
      const select = element as HTMLSelectElement;
      for (const section of ["functional_adl", "legal_conservatorship", destination]) {
        select.value = section;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, finalSection);
    await expect(picker).toHaveValue(finalSection);
    await expect(page).toHaveURL(new RegExp(`assessmentSection=${finalSection}(?:&|$)`));
    await page.reload();
    await expect(picker).toHaveValue(finalSection);
    await expect(page.locator("[data-split-topic]")).toHaveAttribute("data-split-topic", finalSection);
  }
});
