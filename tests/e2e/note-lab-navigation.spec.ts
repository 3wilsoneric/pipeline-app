import { expect, test } from "@playwright/test";

test("assessment field progress is user-scoped, resumable, and directly navigable", async ({ page }) => {
  const response = await page.goto("/note-lab");
  expect(response?.ok()).toBeTruthy();

  const rail = page.getByRole("complementary", { name: "Assessment field progress" });
  const fields = rail.getByRole("button", { name: /^Field \d+:/ });
  await expect(fields).toHaveCount(15);

  const firstField = fields.nth(0);
  await expect(firstField).toHaveAttribute("aria-current", "step");
  expect(await reviewedFieldCount(fields)).toBe(0);
  await expect(page.getByText("Past note to review")).toHaveCount(0);
  await expect(page.getByText("No historical example for this field.")).toHaveCount(0);

  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(fields.nth(1)).toHaveAttribute("aria-current", "step");
  expect(await reviewedFieldCount(fields)).toBe(1);

  await page.reload();
  await expect(fields.nth(1)).toHaveAttribute("aria-current", "step");
  expect(await reviewedFieldCount(fields)).toBe(1);

  const ninthField = fields.nth(8);
  const ninthLabel = await ninthField.getAttribute("aria-label");
  await ninthField.click();
  await expect(ninthField).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    fieldNameFromAccessibleLabel(ninthLabel),
  );

  await page.getByRole("button", { name: "Next field" }).click();
  await expect(fields.nth(9)).toHaveAttribute("aria-current", "step");
  expect(await reviewedFieldCount(fields)).toBe(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    fieldNameFromAccessibleLabel(await fields.nth(9).getAttribute("aria-label")),
  );
});

async function reviewedFieldCount(fields: ReturnType<import("@playwright/test").Page["getByRole"]>) {
  const labels = await fields.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? ""));
  return labels.filter((label) => label.endsWith(", reviewed")).length;
}

function fieldNameFromAccessibleLabel(label: string | null) {
  if (!label) throw new Error("Assessment field is missing its accessible label.");
  return label.replace(/^Field \d+: /, "").replace(/, reviewed$/, "");
}
