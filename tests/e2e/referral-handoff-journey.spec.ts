import { expect, test, webkit } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { completeOperationalAssessment, createOperationalAssessment, createOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "./support/operational-api";

for (const width of [1440, 834, 390]) {
  test(`saved intake reaches a clearly unsent handoff and finishes at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const name = `Example Jamie ${randomUUID().replace(/[^a-z]/g, "")}`;
    await page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
    await expect(page.locator('[data-guide-target="packet-workspace"]')).toHaveAttribute("data-performance-ready", "packet");
    const stages = page.getByRole("navigation", { name: "Workspace stages" });
    const stagePicker = stages.getByRole("combobox", { name: "Workspace view", exact: true });
    const expectStage = async (label: string) => {
      if (width < 640) await expect(stagePicker.locator("option:checked")).toHaveText(label);
      else await expect(stages.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    };
    const openStage = async (label: string) => {
      if (width < 640) await stagePicker.selectOption({ label });
      else await stages.getByRole("button", { name: label, exact: true }).click();
    };
    if (width < 640) await expect(stagePicker.locator(":scope > option")).toHaveText(["Intake"]);
    else await expect(stages.getByRole("button")).toHaveText(["Intake"]);
    const intake = page.getByTestId("intake-client-folder");
    await intake.locator('[data-workspace-field="name"] input').fill(name);
    await intake.locator('[data-workspace-field="email"] input').fill("example@example.invalid");
    await page.getByLabel("Requested community", { exact: true }).selectOption("San Pablo");
    await expect(intake.locator('[data-workspace-field="name"] input')).toHaveValue(name);
    await expect(intake.locator('[data-workspace-field="email"] input')).toHaveValue("example@example.invalid");
    await page.getByRole("button", { name: "Create referral", exact: true }).click();
    await expect(page).toHaveURL(/referralId=\d+/);
    const referralId = new URL(page.url()).searchParams.get("referralId")!;
    const referral = (await (await page.request.get(`/api/referrals/${referralId}`)).json()).referral;
    expect(referral.name).toContain("Example");
    expect(referral.community).toBe("San Pablo");
    expect(referral.email).toBe("example@example.invalid");
    if (width < 640) await expect(stagePicker.locator(":scope > option")).toHaveText(["Chart", "Assessment", "Decision", "Finish & send"]);
    else await expect(stages.getByRole("button")).toHaveText(["Chart", "Assessment", "Decision", "Finish & send"]);
    await expectStage("Chart");
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toContainText("San Pablo");
    await expect(page.getByRole("article", { name: "Referral chart", exact: true }).getByTestId("client-identity-title")).not.toHaveText(/Not documented/);
    expect((await (await page.request.get(`/api/referrals/${referralId}/assessments`)).json()).assessments).toHaveLength(0);

    // Referral details are an editor in this same file, not an Intake stage left behind.
    await page.getByRole("button", { name: "Edit referral details", exact: true }).click();
    await expectStage("Chart");
    await intake.locator('[data-workspace-field="email"] input').fill("updated@example.invalid");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByTestId("profile-workspace")).toContainText("updated@example.invalid");
    await page.reload();
    await expect(page.getByTestId("profile-workspace")).toContainText("updated@example.invalid");
    await page.goto(`/?view=referrals&screen=packet&referralId=${referralId}`);
    await expect(page.getByTestId("profile-workspace")).toContainText("updated@example.invalid");
    await expectStage("Chart");
    await page.screenshot({ path: info.outputPath(`living-chart-${width}.png`) });

    await openStage("Assessment");
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
    await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open assessment", exact: true })).toHaveCount(0);
    if (width >= 640) {
      await page.goto(`/?view=referrals&screen=packet&referralId=${referralId}&workspaceStage=assessment&assessmentSection=provenance_qc`);
      await page.getByRole("button", { name: "Review & sign", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
      await page.getByRole("dialog", { name: "Questionnaire sections", exact: true }).getByRole("button", { name: /^Review & sign/ }).click();
    }
    const review = page.getByRole("region", { name: "Assessment chart review", exact: true });
    await expect(review).toContainText("Synthetic conversation completed");
    await expectStage("Assessment");
    await expect(page).toHaveURL(/assessmentMode=review/);
    const reviewUrl = page.url();
    await page.reload();
    await expect(review.getByRole("heading", { name: "Review & sign", exact: true })).toBeVisible();
    await expectStage("Assessment");
    await page.screenshot({ path: info.outputPath(`assessment-review-${width}.png`), animations: "disabled" });
    await review.getByRole("button", { name: "Back to questions", exact: true }).click();
    await expect(page).not.toHaveURL(/assessmentMode=/);
    expect(new URL(page.url()).searchParams.get("assessmentSection")).toBe(new URL(reviewUrl).searchParams.get("assessmentSection"));
    await page.goto(reviewUrl);
    // A native select does not navigate when its current option is reselected.
    if (width < 640) await openStage("Chart");
    await openStage("Assessment");
    await expect(page).not.toHaveURL(/assessmentMode=/);
    await page.goto(reviewUrl);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sign & continue to decision", exact: true }).click();
    await expectStage("Decision");
    const decision = page.getByRole("region", { name: "Admission decision", exact: true });
    await expect(decision).toBeVisible();
    await page.screenshot({ path: info.outputPath(`decision-after-signing-${width}.png`) });
    await decision.getByRole("radio", { name: "Accept", exact: true }).check();
    await decision.getByLabel("Reason (optional)", { exact: true }).fill("Synthetic end-to-end example, not a clinical decision.");
    page.once("dialog", (dialog) => dialog.accept());
    await decision.getByRole("button", { name: "Record decision", exact: true }).click();
    await expect(decision.getByLabel("Admission date", { exact: true })).toBeVisible();
    await openStage("Chart");
    await expect(page.getByTestId("profile-workspace")).toContainText("Synthetic end-to-end example, not a clinical decision.");
    await page.getByRole("button", { name: "Continue to decision", exact: true }).click();
    await decision.getByLabel("Admission date", { exact: true }).fill("2026-10-01");
    let mailRequests = 0;
    page.on("request", (request) => { if (request.url().endsWith("/meet-client-email")) mailRequests++; });
    await decision.getByRole("button", { name: "Continue to finish & send", exact: true }).click();
    await expectStage("Finish & send");
    await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toBeVisible();
    await expect(page.frameLocator('iframe[title="Meet the Client email preview"]').getByRole("heading", { name: "Meet the Client", exact: true })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Example only. No email will be sent.");
    await expect(page.getByRole("navigation", { name: "Assessment chart views" })).toHaveCount(0);
    await expect(page.getByLabel("Authorized recipients", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Send email & packet|Back to outcome/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("status", { name: "Email delivery status", exact: true })).toHaveText("Preview");
    await expect(page.locator('footer[aria-label="Handoff actions"]').getByRole("button", { name: "Close workspace", exact: true })).toBeInViewport();
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
    await actions.getByRole("button", { name: "Close workspace", exact: true }).click();
    await expect(page).not.toHaveURL(/screen=packet/);
    expect(mailRequests).toBe(0);
    const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(saved.signed_at).toBeTruthy();
    expect(saved.meet_client_sent_at).toBeFalsy();
    const workflow = await (await page.request.get(`/api/referrals/${referralId}/workflow`)).json();
    expect(workflow.decision.outcome).toBe("accepted");
    expect(workflow.review).toBeNull();
    expect(workflow.referral.admissionDate).toBe("2026-10-01");
  });
}

test("future delivery cannot be abandoned through the handoff controls while its result is pending", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "", tags: [] });
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
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Decision", exact: true }).click();
  await page.getByRole("button", { name: "Continue to finish & send", exact: true }).click();
  await page.getByLabel("Authorized recipients", { exact: true }).fill("example@example.invalid");
  await page.getByRole("checkbox", { name: /I verified that each recipient/ }).check();
  try {
    await page.getByRole("button", { name: "Send email & packet", exact: true }).click();
    await expect(page.getByRole("button", { name: "Close workspace", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Back to decision", exact: true })).toBeDisabled();
    await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Chart$/ }).click();
    await expect(page).toHaveURL(/workspaceView=email/);
    const beforeNavigation = page.url();
    await page.getByRole("navigation", { name: "Primary navigation", exact: true }).getByRole("button", { name: "Open calendar", exact: true }).click();
    await expect(page).toHaveURL(beforeNavigation);
    await expect(page.getByRole("button", { name: "Close workspace", exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole("button", { name: "Close workspace", exact: true })).toBeEnabled();
  await expect(page.getByRole("status", { name: "Email delivery status", exact: true })).toHaveText("Sent");
  await expect(page.getByRole("button", { name: "Send email & packet", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to decision", exact: true })).toBeEnabled();
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.meet_client_sent_at).toBeFalsy();
  await expect(page.getByRole("navigation", { name: "Primary navigation", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Primary navigation", exact: true }).getByRole("button", { name: "Open calendar", exact: true }).click();
  await expect(page).toHaveURL(/screen=calendar/);
});

test("a failed signature or decision stays in place; retry advances only after saving", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Recovery", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  let sends = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
  const stages = page.getByRole("navigation", { name: "Workspace stages" });
  const signRoute = `**/api/assessments/${assessment.assessment_id}/sign`;
  await page.route(signRoute, (route) => route.fulfill({ status: 503, json: { error: "Synthetic signature unavailable. Retry signing." } }));
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Sign & continue to decision", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic signature unavailable" })).toBeVisible();
  await expect(stages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
  expect((await read()).signed_at).toBeNull();
  expect((await read()).current_location).toBe("Synthetic referral source");
  await page.unroute(signRoute);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Sign & continue to decision", exact: true }).click();
  await expect(stages.getByRole("button", { name: /Decision$/ })).toHaveAttribute("aria-current", "page");
  const decision = page.getByRole("region", { name: "Admission decision", exact: true });
  await decision.getByRole("radio", { name: "Under review", exact: true }).check();
  await decision.getByRole("button", { name: "Save under review", exact: true }).click();
  await expect(decision.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  await decision.getByRole("radio", { name: "Accept", exact: true }).check();
  await decision.getByLabel("Reason (optional)").fill("Synthetic retained decision note");
  const decisionRoute = `**/api/referrals/${referral.id}/decision`;
  await page.route(decisionRoute, (route) => route.fulfill({ status: 503, json: { error: "Synthetic decision unavailable" } }));
  page.once("dialog", (dialog) => dialog.accept());
  await decision.getByRole("button", { name: "Record decision", exact: true }).click();
  await expect(decision.getByRole("alert")).toContainText("Synthetic decision unavailable");
  await expect(decision.getByLabel("Reason (optional)")).toHaveValue("Synthetic retained decision note");
  await expect(decision.getByRole("button", { name: "Continue to finish & send" })).toHaveCount(0);
  await page.unroute(decisionRoute);
  page.once("dialog", (dialog) => dialog.accept());
  await decision.getByRole("button", { name: "Record decision", exact: true }).click();
  await decision.getByLabel("Admission date", { exact: true }).fill("2026-10-12");
  await expect(decision.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
  const saveRoute = `**/api/referrals/${referral.id}`;
  await page.route(saveRoute, (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 503, json: { error: "Synthetic date save unavailable" } }) : route.continue());
  await decision.getByRole("button", { name: "Continue to finish & send" }).click();
  await expect(decision.getByRole("alert")).toContainText("Synthetic date save unavailable");
  await expect(stages.getByRole("button", { name: /Decision$/ })).toHaveAttribute("aria-current", "page");
  await expect(decision.getByLabel("Admission date", { exact: true })).toHaveValue("2026-10-12");
  await page.unroute(saveRoute);
  await decision.getByRole("button", { name: "Continue to finish & send" }).click();
  await expect(stages.getByRole("button", { name: /Finish & send$/ })).toHaveAttribute("aria-current", "page");
  expect((await read()).meet_client_sent_at).toBeFalsy();
  expect(sends).toBe(0);
});

test("practice signing stays in the practice chart and never creates a decision", async ({ page }) => {
  let writes = 0;
  page.on("request", (request) => { if (request.method() !== "GET" && /\/(sign|decision|meet-client-email)$/.test(request.url())) writes++; });
  await page.goto("/?view=referrals&screen=packet&trainingAssessment=interview&demo=1&workspaceStage=chart");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Sign assessment", exact: true }).click();
  await expect(page.locator('footer[aria-label="Assessment actions"]')).toContainText("Signed");
  await expect(page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Chart$/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Continue to decision", exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
});

test("iPad WebKit keeps signing and finishing in the same folder", async ({ baseURL }, info) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Tablet", owner: "", tags: [] });
    await createOperationalAssessment(page.request, referral.id);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
    await expect(page.getByRole("heading", { name: "Review & sign", exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sign & continue to decision", exact: true }).tap();
    const stages = page.getByRole("navigation", { name: "Workspace stages" });
    await expect(stages.getByRole("button", { name: /Decision$/ })).toHaveAttribute("aria-current", "page");
    await stages.getByRole("button", { name: /Finish & send$/ }).tap();
    await expect(stages.getByRole("button", { name: /Finish & send$/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("note")).toContainText("No email will be sent");
    const preview = page.frameLocator('iframe[title="Meet the Client email preview"]');
    await expect(preview.locator("li").first()).toHaveCSS("font-size", "17px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await preview.locator("body").evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("ipad-finish-webkit.png"), animations: "disabled" });
  } finally { await browser.close(); }
});
