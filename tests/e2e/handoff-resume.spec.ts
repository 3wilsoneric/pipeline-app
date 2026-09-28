import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, readOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "./support/operational-api";

for (const width of [1440, 390]) test(`accepted work resumes the client handoff without recording arrival at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Synthetic Handoff ${width}`, owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await signOperationalAssessment(page.request, assessment);
  await recordOperationalAcceptance(page.request, await readOperationalReferral(page.request, referral.id));
  const writes: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && /\/(transition|meet-client-email)$/.test(new URL(request.url()).pathname)) writes.push(request.url());
  });
  const workspace = `/?view=referrals&screen=packet&referralId=${referral.id}`;
  await page.goto(workspace);
  const handoff = page.getByRole("region", { name: "Prepare client handoff", exact: true });
  await expect(handoff).toBeVisible();
  await expect(page).toHaveURL(/workspaceView=workflow/);
  await expect(handoff.getByRole("list", { name: "Handoff progress" })).toContainText("Assessment signed");
  await expect(page.getByRole("button", { name: "Confirm admitted", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Actual admission date", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Mark admitted", exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath(`handoff-steps-${width}.png`), animations: "disabled" });
  await handoff.getByLabel("Planned admission date", { exact: true }).fill("2026-10-12");
  await handoff.getByRole("button", { name: "Review email & packet", exact: true }).click();
  await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toBeVisible();

  // A normal reopen must override an old saved Chart location.
  await page.goto(`${workspace}&workspaceStage=chart&workspaceEntry=resume`);
  await expect(page).toHaveURL(/workspaceView=email/);
  await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`handoff-resume-${width}.png`), animations: "disabled" });
  // Explicit earlier-work links remain accessible and stable after reload.
  await page.goto(`${workspace}&workspaceStage=chart`);
  await expect(page.getByRole("region", { name: "Chart", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Chart", exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  const saved = await readOperationalReferral(page.request, referral.id) as typeof referral & { stage: string; actualAdmissionDate?: string };
  expect(saved.stage).not.toBe("Accepted / Admitted");
  expect(saved.actualAdmissionDate).toBeUndefined();
});

test("signed work opens Decision while unsigned work keeps its questionnaire location", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Resume Decision", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const workspace = `/?view=referrals&screen=packet&referralId=${referral.id}`;
  await page.goto(`${workspace}&workspaceStage=assessment&workspaceEntry=resume`);
  await expect(page.getByRole("region", { name: "Assessment", exact: true })).toBeVisible();
  await signOperationalAssessment(page.request, assessment);
  await page.goto(`${workspace}&workspaceStage=assessment&workspaceEntry=resume`);
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/workspaceView=workflow/);
  await expect(page.getByRole("region", { name: "Prepare client handoff", exact: true })).toHaveCount(0);
});

test("late handoff loading does not override a deliberate navigation choice", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Handoff Navigation", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await signOperationalAssessment(page.request, assessment);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/referrals/${referral.id}/assessments`, async route => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceEntry=resume`);
    await expect(page.locator('[data-guide-target="packet-workspace"]')).toHaveAttribute("data-performance-ready", "packet");
    await page.getByRole("button", { name: "Workspace files", exact: true }).click();
    await expect(page).toHaveURL(/workspaceView=files/);
    const delivered = page.waitForResponse(response => response.url().endsWith(`/referrals/${referral.id}/assessments`));
    release();
    await delivered;
    await expect(page.getByRole("region", { name: "Files", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/workspaceView=files/);
  } finally { release(); }
});
