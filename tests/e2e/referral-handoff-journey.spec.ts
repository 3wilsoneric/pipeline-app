import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { completeOperationalAssessment, createOperationalAssessment, createOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "./support/operational-api";
import { openAssessmentChart } from "./support/assessment-navigation";

for (const width of [1440, 834, 390]) {
  test(`saved intake reaches a clearly unsent handoff and finishes at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const name = `Example Jamie ${randomUUID().replace(/[^a-z]/g, "")}`;
    await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
    const intake = page.getByTestId("intake-client-folder");
    await intake.locator('[data-workspace-field="name"] input').fill(name);
    await intake.locator('[data-workspace-field="email"] input').fill("example@example.invalid");
    await page.getByLabel("Requested community", { exact: true }).selectOption("San Pablo");
    await page.getByRole("button", { name: "Create referral", exact: true }).click();
    await expect(page).toHaveURL(/referralId=\d+/);
    const referralId = new URL(page.url()).searchParams.get("referralId")!;
    const referral = (await (await page.request.get(`/api/referrals/${referralId}`)).json()).referral;
    expect(referral.name).toContain("Example");
    expect(referral.community).toBe("San Pablo");
    expect(referral.email).toBe("example@example.invalid");

    await page.getByRole("button", { name: "02 Questionnaire", exact: true }).click();
    await expect(page.locator("[data-assessment-view]")).toBeVisible();
    const list = await (await page.request.get(`/api/referrals/${referralId}/assessments`)).json();
    expect(list.assessments).toHaveLength(1);
    const assessment = list.assessments[0];
    expect(assessment.resident_name).toBe(referral.name);
    expect(assessment.community).toBe("San Pablo");
    // Populate the lengthy synthetic questionnaire through its real save API;
    // creation, chart review, signature, decision and finishing use the UI.
    const completed = await completeOperationalAssessment(page.request, assessment);
    const restoredIdentity = await page.request.patch(`/api/assessments/${assessment.assessment_id}`, { data: {
      if_match: completed.version, client_mutation_id: randomUUID(),
      patch: { data: { resident_name: referral.name, community: referral.community, current_symptoms: "Synthetic conversation completed; no real client data." } },
    } });
    expect(restoredIdentity.status()).toBe(200);
    await page.reload();
    await expect(page.getByRole("button", { name: "Open assessment", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open assessment", exact: true }).click();
    await openAssessmentChart(page);
    const review = page.getByRole("region", { name: "Assessment chart review", exact: true });
    await expect(review).toContainText("Synthetic conversation completed");
    await expect(review.getByRole("button", { name: "Return to questions" })).toHaveCount(width < 640 ? 1 : 0);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sign assessment", exact: true }).click();
    const decision = page.getByRole("region", { name: "Admission decision", exact: true });
    await expect(decision).toBeVisible();
    await decision.getByRole("radio", { name: "Accept", exact: true }).check();
    await decision.getByLabel("Reason", { exact: true }).fill("Synthetic end-to-end example, not a clinical decision.");
    await decision.getByRole("button", { name: "Finish assessment", exact: true }).click();
    await decision.getByRole("combobox", { name: "Decision", exact: true }).selectOption("accepted");
    page.once("dialog", (dialog) => dialog.accept());
    await decision.getByRole("button", { name: "Record final decision", exact: true }).click();
    await decision.getByLabel("Admission date", { exact: true }).fill("2026-10-01");
    let mailRequests = 0;
    page.on("request", (request) => { if (request.url().endsWith("/meet-client-email")) mailRequests++; });
    await decision.getByRole("button", { name: "Prepare Meet the Client", exact: true }).click();
    await expect(page.getByRole("article", { name: "Meet the Client chart", exact: true })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Example only. No email will be sent.");
    await expect(page.getByRole("navigation", { name: "Assessment chart views" })).toHaveCount(0);
    await expect(page.getByLabel("Authorized recipients", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Email summary|Back to outcome|Refresh/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('footer[aria-label="Handoff actions"]').getByRole("button", { name: "Done", exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`example-handoff-${width}.png`), fullPage: true });

    const summary = await (await page.request.get(`/api/referrals/${referralId}/admission-summary`)).json();
    expect(summary.email.example_only).toBe(true);
    expect(summary.email.ready).toBe(false);
    expect(summary.email.can_send).toBe(false);
    const attemptedSend = await page.request.post(`/api/referrals/${referralId}/meet-client-email`, { data: {
      confirmed: true, if_match: summary.referral.version,
      recipients: ["example@example.invalid"], client_mutation_id: randomUUID(),
    } });
    expect(attemptedSend.status()).toBe(403);
    expect(await attemptedSend.text()).toContain("example only");
    const actions = page.locator('footer[aria-label="Handoff actions"]');
    await actions.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page).not.toHaveURL(/screen=packet/);
    expect(mailRequests).toBe(0);
    const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.signed_at).toBeTruthy();
    expect(saved.meet_client_sent_at).toBeFalsy();
    const workflow = await (await page.request.get(`/api/referrals/${referralId}/workflow`)).json();
    expect(workflow.decision.outcome).toBe("accepted");
    expect(workflow.referral.admissionDate).toBe("2026-10-01");
  });
}

test("future delivery cannot be abandoned through the handoff controls while its result is pending", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "Annette Everhart", tags: [] }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await signOperationalAssessment(page.request, assessment);
  const current = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  await recordOperationalAcceptance(page.request, current);
  await page.route(`**/api/referrals/${referral.id}/admission-summary`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.email = { ...payload.email, example_only: false, configured: true, eligible: true, can_send: true, ready: true, blockers: [], allowed_recipient_domains: ["example.invalid"] };
    await route.fulfill({ response, json: payload });
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/referrals/${referral.id}/meet-client-email`, async (route) => {
    await gate;
    await route.fulfill({ json: { recipient_count: 1, attachment_count: 0, delivery_id: "synthetic-ui-response" } });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "03 Decision", exact: true }).click();
  await page.getByRole("button", { name: "Prepare Meet the Client", exact: true }).click();
  await page.getByLabel("Authorized recipients", { exact: true }).fill("example@example.invalid");
  await page.getByRole("checkbox", { name: /I verified that each recipient/ }).check();
  try {
    await page.getByRole("button", { name: "Email summary + packet", exact: true }).click();
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Edit decision", exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Edit decision", exact: true })).toBeEnabled();
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.meet_client_sent_at).toBeFalsy();
});
