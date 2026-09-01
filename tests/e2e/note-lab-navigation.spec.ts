import { expect, test } from "@playwright/test";

test("assessment field rail opens any field and a fresh load starts at field one", async ({ page }) => {
  const response = await page.goto("/note-lab");
  expect(response?.ok()).toBeTruthy();

  const rail = page.getByRole("complementary", { name: "Assessment field progress" });
  const fields = rail.getByRole("button", { name: /^Field \d+:/ });
  await expect(fields).toHaveCount(15);

  const firstField = fields.nth(0);
  await expect(firstField).toHaveAttribute("aria-current", "step");
  const firstLabel = await firstField.getAttribute("aria-label");

  const ninthField = fields.nth(8);
  const ninthLabel = await ninthField.getAttribute("aria-label");
  await ninthField.click();
  await expect(ninthField).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    fieldNameFromAccessibleLabel(ninthLabel),
  );

  await page.reload();
  await expect(fields.nth(0)).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    fieldNameFromAccessibleLabel(firstLabel),
  );
});

function fieldNameFromAccessibleLabel(label: string | null) {
  if (!label) throw new Error("Assessment field is missing its accessible label.");
  return label.replace(/^Field \d+: /, "").replace(/, reviewed$/, "");
}
