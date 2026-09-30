import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";

test.use({ serviceWorkers: "block" });

for (const width of [1440, 390]) test(`background presence retires and returns without blocking assessment saves at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic presence lifecycle", owner: "Annette Everhart", tags: [],
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  const presenceUrl = `/api/referrals/${referral.id}/presence`;
  const posts: Array<{ lease_id: string; section: string }> = [];
  const releases: string[] = [];
  let failPresence = false;
  await page.route(`**${presenceUrl}`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") posts.push(request.postDataJSON());
    if (request.method() === "DELETE") releases.push(request.postDataJSON().lease_id);
    if (failPresence) return route.fulfill({ status: 503, json: { error: "Synthetic presence failure" } });
    return route.continue();
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history&assessmentMode=interview`);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  const answer = page.locator("#assessment-prior_placements");
  await expect(answer).toBeEditable();
  // Both owners must use the shared lifecycle: chart + active assessment.
  await expect.poll(() => posts.some((post) => post.section.startsWith("assessment:"))).toBe(true);
  await expect.poll(() => posts.some((post) => !post.section.startsWith("assessment:"))).toBe(true);
  const activeIds = (await (await page.request.get(presenceUrl)).json()).presence.map((item: { lease_id: string }) => item.lease_id) as string[];
  expect(activeIds.length).toBeGreaterThanOrEqual(2);
  const before = posts.length;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => activeIds.every((id) => releases.includes(id))).toBe(true);
  await expect.poll(async () => (await (await page.request.get(presenceUrl)).json()).presence.length).toBe(0);
  // Wait past the real renewal interval; the unit test covers 20 minutes and races.
  await page.waitForTimeout(16_000);
  expect(posts.length).toBe(before);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => posts.length).toBeGreaterThan(before);
  await expect.poll(async () => (await (await page.request.get(presenceUrl)).json()).presence.length).toBeGreaterThanOrEqual(2);
  expect(posts.slice(before).every((post) => !activeIds.includes(post.lease_id))).toBe(true);

  // An advisory outage must never become an answer-save gate.
  failPresence = true;
  const beforeFailure = posts.length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => posts.length).toBeGreaterThan(beforeFailure);
  await answer.fill("Synthetic saved answer while presence is unavailable");
  await answer.blur();
  await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.prior_placements)
    .toBe("Synthetic saved answer while presence is unavailable");
  await page.reload();
  await expect(answer).toHaveValue("Synthetic saved answer while presence is unavailable");
  await expect(page.getByRole("heading", { name: "This page could not load." })).toHaveCount(0);
});
