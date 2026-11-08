import { expect, test } from "@playwright/test";
import { openAssessmentFixture } from "./support/assessment-fixture";

test("a delayed save cannot undo a newer choice that returns to the original answer", async ({ page }) => {
  const { assessment, read } = await openAssessmentFixture(page, { mode: "interview", section: "medication" });
  expect((await read()).im_injections).toBe("no");
  let release!: () => void;
  const acknowledgement = new Promise<void>((resolve) => { release = resolve; });
  let committed!: () => void;
  const serverCommitted = new Promise<void>((resolve) => { committed = resolve; });
  let held = false;
  await page.route(`**/api/assessments/${assessment.assessment_id}`, async (route) => {
    const request = route.request();
    if (held || request.method() !== "PATCH" || request.postDataJSON().patch?.data?.im_injections !== "yes") return route.continue();
    held = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed();
    await acknowledgement;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("complementary", { name: "Current information" }).getByRole("button", { name: "Edit IM injections", exact: true }).click();
    const choice = page.getByRole("group", { name: "IM injections", exact: true });
    await choice.getByRole("button", { name: "Yes", exact: true }).click();
    const detail = page.getByRole("textbox", { name: "Injection details", exact: true });
    await detail.fill("Synthetic conditional detail retained while changing the choice.");
    await serverCommitted;
    await choice.getByRole("button", { name: "No", exact: true }).click();
    await expect(choice.getByRole("button", { name: "No", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(detail).toBeHidden();
    release();
    await expect.poll(async () => (await read()).im_injections).toBe("no");
    await expect(choice.getByRole("button", { name: "No", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(detail).toBeHidden();
    await expect.poll(async () => (await read()).im_injections_details).toBe("Synthetic conditional detail retained while changing the choice.");
    await page.reload();
    await expect(page.getByRole("button", { name: "Edit IM injections", exact: true })).toHaveText("No");
  } finally {
    release();
  }
});
