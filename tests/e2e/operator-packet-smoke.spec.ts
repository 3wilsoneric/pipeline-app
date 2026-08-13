import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const packetPath = process.env.PIPELINE_REAL_PACKET_PATH?.trim();

test("ingests an operator-supplied packet without pre-entered demographics", async ({ page }) => {
  test.skip(!packetPath, "Set PIPELINE_REAL_PACKET_PATH to run the private packet smoke test.");
  test.setTimeout(150_000);

  const resolvedPath = path.resolve(packetPath!);
  await page.goto("/?view=referrals&screen=packet");
  await page.getByTestId("initial-packet-input").setInputFiles({
    name: path.basename(resolvedPath),
    mimeType: "application/pdf",
    buffer: readFileSync(resolvedPath),
  });
  await page.getByRole("button", { name: /^(Create referral|Save chart)$/ }).click();

  await expect(page.getByText("Packet uploaded and ready for review", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/source pages? preserved; confirm the stripped values below\./)).toBeVisible();
  const review = page.getByRole("region", { name: "Extraction review" });
  await expect(review).toBeVisible();
  await expect(review.getByRole("button", { name: /^Edit extracted / })).toHaveCount(13);
  expect(await review.getByText(/^Page \d+$/).count()).toBeGreaterThanOrEqual(1);
  expect(await review.getByText("No value found", { exact: true }).count()).toBeLessThan(13);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).not.toHaveValue("");
});
