import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AxeResults } from "axe-core";
import { applyPipelineWorkspaceLocation, type PipelineWorkspaceView } from "../../lib/pipeline/work-continuity";

async function createReferral(page: Page) {
  const response = await page.request.post("/api/referrals", { data: {
    client_mutation_id: randomUUID(), assignee_id: "provisional:allo:annette",
    referral: { name: `Synthetic clarity ${randomUUID().slice(0, 8)}`, date: "2026-09-17", stage: "New",
      community: "San Pablo", county: "Contra Costa County", dob: "1980-04-12", phone: "", email: "", payer: "",
      source: "Synthetic UI test", priority: "standard", tags: [], documentName: "",
      documentStatus: "Missing", owner: "Annette Everhart", note: "", createdAt: new Date().toISOString(), requirements: [] },
  } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).referral as { id: number };
}

function workspaceUrl(id: number, view: PipelineWorkspaceView) {
  const params = new URLSearchParams({ view: "referrals", screen: "packet", referralId: String(id) });
  applyPipelineWorkspaceLocation(params, { view });
  return `/?${params}`;
}

function event(action: string, fields: string[] = []) {
  return { event_id: randomUUID(), action, actor_id: "synthetic-user", actor_name: "Example Assessor",
    changed_fields: fields, changes: [], reason: null, from_version: 1, to_version: 2, created_at: "2026-09-17T15:00:00Z" };
}

for (const width of [1440, 390]) {
  test(`activity highlights milestones and keeps masked audit detail at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const referral = await createReferral(page);
    const events = [event("assessment_signed"), event("assessment_updated", ["interview"]), {
      ...event("referral_updated", ["workflowStatus"]),
      changes: [{ field: "workflowStatus", label: "Workflow status", before: "intake_documents_needed", after: "ready_to_schedule", masked: false, values_available: true }],
    }, event("referral_created"), {
      ...event("referral_updated", ["ssn", "county"]),
      changes: [
        { field: "ssn", label: "Social Security number", before: "NEVER_RENDER_BEFORE", after: "NEVER_RENDER_AFTER", masked: true, values_available: true },
        { field: "county", label: "County", before: "Contra Costa County", after: "Alameda County", masked: false, values_available: true },
      ],
    }];
    await page.route(`**/api/referrals/${referral.id}/activity`, (route) => route.fulfill({ json: { events, metadata: null } }));
    await page.goto(workspaceUrl(referral.id, "activity"));
    const activity = page.getByRole("region", { name: "Referral ownership and activity" });
    await expect(activity.locator('[data-activity-event="assessment_signed"]:visible')).toHaveCount(1);
    await expect(activity.locator('[data-activity-event="assessment_updated"]:visible')).toHaveCount(0);
    await expect(activity.locator('[data-activity-event="referral_updated"]:visible')).toHaveCount(1);
    await expect(activity.getByText("Ownership and timing", { exact: true })).toHaveCount(0);
    await expect(activity.getByText("Contributors", { exact: true })).toHaveCount(0);
    await expect(activity.locator('[data-activity-event="referral_updated"]').getByText("Referral created", { exact: true }).first()).toBeVisible();
    await expect(activity.getByText("ready_to_schedule", { exact: true })).not.toBeVisible();
    await expect(activity.getByText("Assessment signed", { exact: true }).first()).toHaveCSS("font-size", "15px");
    await expect(page.getByRole("button", { name: "Admission workflow", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 640) await expect(page.getByLabel("Workspace view", { exact: true })).toHaveValue("activity");
    else await expect(page.getByRole("button", { name: "Workspace activity", exact: true })).toHaveAttribute("aria-current", "page");
    await page.screenshot({ path: testInfo.outputPath(`activity-${width}.png`), animations: "disabled" });
    const disclosure = activity.locator("summary").filter({ hasText: "Detailed history" });
    await disclosure.focus();
    await page.keyboard.press("Enter");
    const history = activity.getByRole("list", { name: "Detailed activity history" });
    await expect(history).toBeVisible();
    await expect(history.locator("[data-activity-event]")).toHaveCount(5);
    await expect(history).toContainText("Value changed (masked)");
    await expect(history).toContainText("Contra Costa County");
    await expect(history).toContainText("Alameda County");
    await expect(activity).not.toContainText("NEVER_RENDER");
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[aria-label="Referral ownership and activity"]', { runOnly: ["color-contrast", "list", "listitem"] })).violations;
    });
    expect(violations).toEqual([]);
    await page.reload();
    await expect(activity.getByRole("list", { name: "Detailed activity history" })).not.toBeVisible();
  });

  test(`one decision keeps admission date and email preview without supervisor review at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    const referral = await createReferral(page);
    const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
    expect(created.status()).toBe(201);
    const { assessment } = await created.json();
    const signed = await page.request.post(`/api/assessments/${assessment.assessment_id}/sign`, { data: { if_match: assessment.version, client_mutation_id: randomUUID() } });
    expect(signed.status()).toBe(200);
    await page.goto(workspaceUrl(referral.id, "intake"));
    if (width < 640) await page.getByLabel("Workspace view", { exact: true }).selectOption({ label: "Decision" });
    else await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Decision$/ }).click();
    const decision = page.getByRole("region", { name: "Admission decision", exact: true });
    await expect(decision).toBeVisible();
    await expect(page.getByRole("button", { name: "Admission workflow", exact: true })).toHaveCount(0);
    await expect(decision.getByText("From referral to handoff", { exact: true })).toHaveCount(0);
    await expect(decision.getByRole("heading", { name: "Admission requirements", exact: true })).not.toBeVisible();
    await decision.getByRole("radio", { name: "Accept", exact: true }).check();
    await expect(decision).not.toContainText(/Supervisor decision|Assessment outcome|Open assessment/);
    await expect(decision.getByRole("radio")).toHaveCount(3);
    await decision.getByLabel("Reason (optional)", { exact: true }).fill("Synthetic placement decision.");
    await page.screenshot({ path: testInfo.outputPath(`decision-${width}.png`), animations: "disabled" });
    await decision.getByRole("button", { name: "Record decision", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /^Record (acceptance|denial)$/, exact: true }).click();
    const admitDate = decision.getByLabel("Admission date (optional)", { exact: true });
    await expect(admitDate).toBeVisible();
    await admitDate.fill("2026-10-01");
    await decision.getByRole("button", { name: "Review email & packet", exact: true }).click();
    await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toBeVisible();
    const saved = await (await page.request.get(`/api/referrals/${referral.id}`)).json();
    expect(saved.referral.admissionDate).toBe("2026-10-01");
    expect(saved.referral.admissionDecision.outcome).toBe("accepted");
    const workflow = await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json();
    expect(workflow.review).toBeNull();
    expect(workflow.reviews).toEqual([]);
    await expect(page.getByRole("status").filter({ hasText: "Not production yet" })).toHaveText("Not production yet — no email will be sent.");
    await expect(page.getByRole("navigation", { name: "Assessment chart views" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send email & packet" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to decision", exact: true }).click();
    await expect(decision.getByLabel("Admission date (optional)", { exact: true })).toHaveValue("2026-10-01");
    await decision.locator("summary").filter({ hasText: /^Admission details$/ }).click();
    await expect(decision.getByRole("heading", { name: "Admission requirements", exact: true })).toBeVisible();
    await page.reload();
    await expect(decision.getByLabel("Admission date (optional)", { exact: true })).toHaveValue("2026-10-01");
    await expect(decision.getByRole("heading", { name: "Admission requirements", exact: true })).not.toBeVisible();
    await decision.locator("summary").filter({ hasText: /^Admission details$/ }).click();
    await decision.getByRole("combobox", { name: "Workflow stage", exact: true }).selectOption("Assessment");
    await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.stage).toBe("Assessment");
    await decision.getByRole("combobox", { name: "Workflow stage", exact: true }).selectOption("New");
    await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.stage).toBe("New");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width < 640) await expect(page.getByLabel("Workspace view", { exact: true })).toHaveValue("workflow");
    else await expect(page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Decision$/ })).toHaveAttribute("aria-current", "page");
  });
}

test("unsigned Workflow links keep the decision and questionnaire reachable", async ({ page }) => {
  const referral = await createReferral(page);
  await page.goto(workspaceUrl(referral.id, "workflow"));
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: /Assessment$/ }).click();
  await page.getByRole("button", { name: "Assessment prep", exact: true }).click();
  await expect(page.locator("[data-assessment-view]")).toBeVisible();
  await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toHaveCount(0);
});

test("activity error has a working retry and an honest empty state", async ({ page }) => {
  const referral = await createReferral(page);
  let failing = true;
  await page.route(`**/api/referrals/${referral.id}/activity`, (route) => route.fulfill(failing ? { status: 503, json: { error: "Unavailable" } } : { json: { events: [], metadata: null } }));
  await page.goto(workspaceUrl(referral.id, "activity"));
  const activity = page.getByRole("region", { name: "Referral ownership and activity" });
  await expect(activity.getByRole("alert")).toHaveText("Activity could not be loaded.");
  failing = false;
  await activity.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(activity.getByText("No activity yet.", { exact: true })).toBeVisible();
  await expect(activity.locator("details")).toHaveCount(0);
});

test("the simplified activity timeline retains file restoration and refreshes its result", async ({ page }) => {
  const referral = await createReferral(page);
  const documentId = randomUUID();
  const deletionId = randomUUID();
  let restored = false;
  await page.route(`**/api/referrals/${referral.id}/activity`, route => route.fulfill({ json: {
    events: restored ? [event("document_restored")] : [{ ...event("document_deleted"), undo: { document_id: documentId, deletion_id: deletionId, until: "2030-01-01T00:00:00Z" } }], metadata: null,
  } }));
  await page.route(`**/api/files/${documentId}`, async route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ confirmed: true, deletion_id: deletionId });
    restored = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(workspaceUrl(referral.id, "activity"));
  const activity = page.getByRole("region", { name: "Referral ownership and activity" });
  await activity.locator("summary").filter({ hasText: "Detailed history" }).click();
  await expect(activity.getByRole("button", { name: "Restore file", exact: true })).toHaveCount(1);
  await activity.getByRole("button", { name: "Restore file", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Restore this deleted file?", exact: true }).getByRole("button", { name: "Restore file", exact: true }).click();
  await expect(activity.locator('[data-activity-event="document_restored"]:visible')).toHaveCount(2);
  await expect(activity.getByRole("button", { name: "Restore file", exact: true })).toHaveCount(0);
});

for (const outcome of ["Deny", "Under review"] as const) {
  test(`${outcome} is saved without a supervisor review when the assessor is done`, async ({ page }) => {
    const referral = await createReferral(page);
    const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: {} } });
    expect(created.status()).toBe(201);
    const { assessment } = await created.json();
    const signed = await page.request.post(`/api/assessments/${assessment.assessment_id}/sign`, { data: { if_match: assessment.version, client_mutation_id: randomUUID() } });
    expect(signed.status()).toBe(200);
    await page.goto(workspaceUrl(referral.id, "workflow"));
    const panel = page.getByRole("region", { name: "Admission decision", exact: true });
    await panel.getByRole("radio", { name: outcome, exact: true }).check();
    await panel.getByLabel(outcome === "Deny" ? "Reason (optional)" : "What needs review?", { exact: true }).fill("Synthetic placement rationale.");
    if (outcome === "Deny") {
      await panel.getByRole("button", { name: "Record decision", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: /^Record (acceptance|denial)$/, exact: true }).click();
    } else await panel.getByRole("button", { name: "Save under review", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(panel.getByLabel("Admission date (optional)", { exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page).not.toHaveURL(/screen=packet/);
    await expect(page.getByRole("dialog", { name: "Current work", exact: true })).toHaveCount(0);
    const saved = await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json();
    expect(saved.review).toBeNull();
    expect(saved.reviews).toEqual([]);
    if (outcome === "Deny") expect(saved.decision.outcome).toBe("declined");
    else {
      expect(saved.decision).toBeNull();
      expect(saved.recommendation.outcome).toBe("needs_more_information");
      expect(saved.referral.workflowStatus).toBe("decision_pending");
      await page.goto(workspaceUrl(referral.id, "workflow"));
      await expect(panel.getByRole("radio", { name: "Under review", exact: true })).toBeChecked();
      await expect(panel.getByRole("textbox", { name: "What needs review?", exact: true })).toHaveValue("Synthetic placement rationale.");
      await panel.getByRole("radio", { name: "Accept", exact: true }).check();
      await expect(panel.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
      await panel.getByRole("button", { name: "Record decision", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: /^Record (acceptance|denial)$/, exact: true }).click();
      await expect(panel.getByRole("heading", { name: "Decision recorded", exact: true })).toBeVisible();
      const accepted = await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json();
      expect(accepted.decision.outcome).toBe("accepted");
      expect(accepted.review).toBeNull();
    }
  });
}
