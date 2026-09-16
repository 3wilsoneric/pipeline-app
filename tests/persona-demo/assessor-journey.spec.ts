import { expect, test } from "@playwright/test";
import { isInternalWorkspaceTag, visibleWorkspaceTags } from "../../lib/pipeline/workspace-presentation";

test("Assessor's Workshop leads from presentation into a reset synthetic assessment case", async ({ page }, testInfo) => {
  await page.goto("/training");
  await expect(page.getByRole("link", { name: "Open Assessor's Workshop presentation" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Quick help" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open assessment lab", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Open Assessor's Workshop presentation" }).click();
  await expect(page).toHaveURL(/\/training\/demo\?journey=1/);
  await expect(page.getByRole("heading", { name: "Find your referral. Keep the work together." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Try the .* walkthrough|Start the assessment walkthrough|Try Language Lab in the assessment/ })).toHaveCount(0);
  await page.getByLabel("Jump to slide").selectOption("9");
  await expect(page.getByRole("heading", { name: "Write the answer, not the example" })).toBeVisible();
  await expect(page.getByText("Prior placements: setting", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Enter demo" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3266/", { timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Switch to Supervisor", exact: true })).toBeVisible();
  const assigned = page.getByRole("region", { name: "Current work", exact: true });
  await expect(assigned).toContainText("Assigned referrals");
  await expect(assigned.getByRole("button", { name: "Open Taylor Rivera", exact: true })).toBeVisible();
  const personal = await (await page.request.get("/api/operations/home")).json();
  expect(personal.scope).toBe("personal");
  expect(personal.workflow.active_total).toBe(7);
  expect(personal.workflow.flow_counts).toMatchObject({ ready_to_schedule: 3, scheduled: 2, assessment: 2 });
  await page.screenshot({ path: testInfo.outputPath("assessor-home.png") });

  await assigned.getByRole("button", { name: "Open Taylor Rivera", exact: true }).click();
  await expect(page).toHaveURL(/referralId=1/);
  const schedule = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
  if (!(await schedule.isVisible())) await page.getByRole("button", { name: "02 Assessment" }).click();
  await expect(schedule).toBeVisible();
  const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await schedule.getByLabel("Assessment date and time").fill(`${day}T10:30`);
  await schedule.getByRole("combobox", { name: "Assessment method" }).selectOption("zoom");
  await schedule.getByRole("textbox", { name: "Zoom meeting link" }).fill("https://example.invalid/practice-assessment");
  await schedule.getByRole("button", { name: "Schedule assessment", exact: true }).click();
  const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
  await expect(begin).toBeVisible();
  await begin.getByRole("button", { name: "Begin assessment", exact: true }).click();
  const interview = page.getByRole("dialog", { name: "Assessment interview", exact: true });
  await expect(interview).toBeVisible();
  await interview.getByRole("button", { name: "Switch to Supervisor", exact: true }).click();
  await expect(page.getByRole("button", { name: "Switch to Assessor", exact: true })).toBeVisible();
  const team = await (await page.request.get("/api/operations/home")).json();
  expect(team.scope).toBe("team");
  expect(team.workflow.active_total).toBe(9);
  expect(team.workflow.unassigned_total).toBe(2);
  expect(team.workflow.active_items.some((item: { referral_id: number }) => item.referral_id === 1)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("supervisor-home-mobile.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("explicit setup is idempotent and refuses a foreign Origin", async ({ request }) => {
  expect(visibleWorkspaceTags(["pipeline-assessor-journey-v1", "pipeline-assessor-journey-taylor", "care"])).toEqual(["care"]);
  expect(isInternalWorkspaceTag("pipeline-assessor-journey-taylor")).toBe(true);
  const first = await request.post("/api/demo/journey");
  expect(first.status(), JSON.stringify(await first.json())).toBe(200);
  const firstBody = await first.json();
  expect(firstBody.seeded_count).toBe(9);
  const second = await request.post("/api/demo/journey");
  expect(second.status()).toBe(200);
  expect(await second.json()).toEqual(firstBody);
  expect((await request.post("/api/demo/journey", { headers: { Origin: "https://example.com" } })).status()).toBe(403);
  const briefing = await (await request.get("/api/operations/home")).json();
  expect(briefing.workflow.active_total).toBe(9);
});

test("opening Assessor's Workshop and resetting it restores only the original practice cases", async ({ page }) => {
  const initialReset = page.waitForResponse((response) => response.url().includes("/api/demo/journey?reset=1") && response.request().method() === "POST");
  await page.goto("/training/demo?journey=1");
  await expect(page.getByRole("button", { name: "Reset demo" })).toBeVisible();
  const first = await initialReset;
  expect(first.status(), JSON.stringify(await first.json())).toBe(200);
  const originalId = (await first.json()).primary_referral_id as number;
  const original = (await (await page.request.get(`/api/referrals/${originalId}`)).json()).referral;
  expect(original.name).toBe("Taylor Rivera");
  const changedNote = "Changed only for the reset test.";
  const changed = await page.request.patch(`/api/referrals/${originalId}`, { data: {
    if_match: original.version,
    if_match_sections: { intake: original.sectionVersions.intake },
    client_mutation_id: crypto.randomUUID(),
    patch: { note: changedNote },
  } });
  expect(changed.status(), JSON.stringify(await changed.json())).toBe(200);

  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page).toHaveURL(/\/training\/demo\?journey=1/);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/referrals/${originalId}`);
    return response.status();
  }, { timeout: 90_000 }).toBe(404);
  const fresh = await page.request.post("/api/demo/journey");
  expect(fresh.status()).toBe(200);
  const freshId = (await fresh.json()).primary_referral_id as number;
  expect(freshId).not.toBe(originalId);
  expect((await (await page.request.get(`/api/referrals/${freshId}`)).json()).referral.note).toBe(original.note);
  const listing = await (await page.request.get("/api/referrals?workspace=active&limit=200")).json();
  expect(listing.referrals).toHaveLength(9);
  expect(listing.referrals.map((referral: { name: string }) => referral.name).sort()).toEqual([
    "Carmen Diaz", "Elena Brooks", "Iris Morgan", "Lena Park", "Maya Torres", "Micah Evans", "Noah Chen", "Samir Patel", "Taylor Rivera",
  ]);
  const home = await (await page.request.get("/api/operations/home")).json();
  expect(home.workflow.active_total).toBe(9);
});
