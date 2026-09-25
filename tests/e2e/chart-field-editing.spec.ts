import { chromium, expect, test, webkit } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral, createOperationalAssessment, startOperationalAssessment } from "./support/operational-api";
import { openAssessmentChart } from "./support/assessment-navigation";
import { unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";

for (const [browserName, browserType] of [["chromium", chromium], ["webkit", webkit]] as const) {
  for (const width of [1440, 834, 390]) {
    test(`${browserName}: chart pencils open the exact intake field and retain edits at ${width}px`, async ({ baseURL }, info) => {
      const browser = await browserType.launch();
      try {
        const page = await browser.newPage({ baseURL, viewport: { width, height: 900 }, hasTouch: width < 1000 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
          name: `Example Pencil ${randomUUID()}`, phone: "555-0101", email: "before@example.invalid", conserved: "no", owner: "Annette Everhart",
        }, { assigneeId: "provisional:allo:annette" });
        const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`;
        await page.goto(url);
        const chart = page.getByRole("article", { name: "Referral chart", exact: true });
        for (const field of ["Client", "Date of birth", "Gender", "Community", "Medications on record", "Conserved status"]) {
          const edit = chart.getByRole("button", { name: `Edit ${field}`, exact: true });
          await expect(edit.locator("svg")).toBeVisible();
          // The pencil stays visible without repeating the editor hint on every field.
          await expect(edit).not.toContainText("Edit in intake");
          await expect(edit).toHaveAttribute("title", `Edit in intake: ${field}`);
          await expect(edit).toHaveAttribute("aria-description", "Opens this field in intake");
          expect((await edit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        for (const field of ["Resident number", "Unit", "Admission date", "Length of stay", "Allergies"]) {
          await expect(chart.locator(`[data-chart-field="${field}"]`)).toHaveCount(0);
        }
        const identityBounds = await chart.locator('[aria-label="Referral identity"]').evaluate((grid) => {
          const fields = Array.from(grid.children).map((element) => element.getBoundingClientRect());
          return { top: fields.map((rect) => rect.top), ssnWidth: fields[3].width, width: grid.getBoundingClientRect().width };
        });
        if (width >= 1024) expect(new Set(identityBounds.top).size).toBe(1);
        else {
          expect(identityBounds.top[1]).toBe(identityBounds.top[2]);
          expect(identityBounds.ssnWidth).toBeCloseTo(identityBounds.width, 0);
        }
        await chart.getByRole("button", { name: "Edit Date of birth", exact: true }).click();
        const dobInput = page.locator('[data-workspace-field="dob"] input');
        await expect(dobInput).toBeFocused();
        await expect(dobInput).toBeInViewport();
        await dobInput.fill("1981-07-09");
        await page.getByRole("button", { name: "Done", exact: true }).click();
        await expect(chart.locator('[data-chart-field="Date of birth"]')).toContainText("Jul 9, 1981");
        // Done returns to the chart position the edit started from.
        await expect(chart.getByRole("button", { name: "Edit Date of birth", exact: true })).toBeFocused();
        await expect(chart.getByRole("button", { name: "Edit Date of birth", exact: true })).toBeInViewport();

        await chart.getByRole("button", { name: "Edit Conserved status", exact: true }).click();
        await expect(page.locator("#packet-conserved")).toBeFocused();
        await page.locator("#packet-conserved").selectOption("yes");
        await page.getByRole("button", { name: "Done", exact: true }).click();
        await expect(chart.locator('[data-chart-field="Conserved status"]')).toContainText(/yes/i);

        await page.getByRole("button", { name: "Edit Email", exact: true }).first().click();
        const email = page.locator('[data-workspace-field="email"] input');
        await expect(email).toBeFocused();
        await email.fill("after@example.invalid");
        await page.getByRole("button", { name: "Done", exact: true }).click();
        await expect(chart).toBeVisible();
        await page.reload();
        await expect(chart).toBeVisible();
        const saved = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
        expect(saved.dob).toBe("1981-07-09");
        expect(saved.conserved).toBe("yes");
        expect(saved.email).toBe("after@example.invalid");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`chart-edit-${width}.png`) });
      } finally { await browser.close(); }
    });
  }
}

test("an assessment chart pencil resumes its exact answer and saves it back to the chart", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const started = await startOperationalAssessment(page.request, assessment);
  // The retired numeric field shares a label with the current question. It
  // must not receive a pencil that opens that different question.
  const legacy = await page.request.patch(`/api/assessments/${assessment.assessment_id}`, { data: {
    if_match: started.version, client_mutation_id: randomUUID(), patch: { data: { longest_sobriety_months: 12, substance_abuse_history: "yes", resident_number: "SYN-INTERNAL-71" } },
  } });
  expect(legacy.status(), await legacy.text()).toBe(200);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  const answer = page.locator("#assessment-prior_placements");
  await answer.fill("Synthetic prior placement");
  await openAssessmentChart(page);
  const record = page.getByRole("article", { name: "Assessment record", exact: true });
  await expect(record).not.toContainText("Resident number");
  await expect(record).not.toContainText("SYN-INTERNAL-71");
  await expect(record.locator('[data-chart-fact="Longest sobriety in the last five years"]')).toContainText("12");
  await expect(record.getByRole("button", { name: "Edit Longest sobriety in the last five years", exact: true })).toHaveCount(0);
  const edit = record.getByRole("button", { name: "Edit Prior placements", exact: true });
  await expect(edit.locator("svg")).toBeVisible();
  await edit.click();
  await expect(answer).toBeFocused();
  await answer.fill("Synthetic corrected placement");
  await openAssessmentChart(page);
  await expect(record).toContainText("Synthetic corrected placement");
  await page.reload();
  await expect(record).toContainText("Synthetic corrected placement");
  const saved = await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json();
  expect(saved.assessment.resident_number).toBe("SYN-INTERNAL-71");
});

test("referral chart edits its own intake while the standalone client chart stays read-only", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const fixture = structuredClone(unifiedProfileFixture);
  const profile = { ...fixture, resident: { ...(fixture.resident as Record<string, unknown>), resident_number: "SYN-INTERNAL-72" }, pipeline: { ...fixture.pipeline, referrals: [(await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral] } };
  await page.route("**/api/profiles/**", (route) => route.fulfill({ json: profile }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  const chart = page.getByRole("article", { name: "Referral chart", exact: true });
  await expect(chart).toBeVisible();
  await expect(chart.getByRole("button", { name: "Edit Client", exact: true })).toBeVisible();
  await expect(chart.locator('[data-chart-field="Resident number"]')).toHaveCount(0);
  // The same canonical intake values are shown once, by the chart above.
  await expect(page.getByRole("button", { name: "Edit Name", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-chart-fact="Date of birth"]')).toHaveCount(0);
  await page.goto(`/?screen=profile&clientId=pipeline:${referral.clientId}`);
  await expect(page.getByRole("article", { name: "Client medical chart", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Client medical chart", exact: true })).not.toContainText("Resident number");
  await expect(page.getByRole("article", { name: "Client medical chart", exact: true })).not.toContainText("SYN-INTERNAL-72");
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
});

test("practice chart omits the internal resident number at phone and desktop widths", async ({ page }, info) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?view=referrals&screen=packet&trainingAssessment=prepare&demo=1&workspaceStage=chart");
    const record = page.getByRole("article", { name: "Assessment record", exact: true });
    await expect(record).toBeVisible();
    await expect(record).not.toContainText("Resident number");
    await expect(record).not.toContainText("TRAINING-001");
    await expect(record).toContainText("Resident name");
    await page.screenshot({ path: info.outputPath(`practice-chart-${width}.png`) });
  }
});

test("an account without workspace edit permission has no field edit affordances", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: {
    user: { id: "synthetic-reader", name: "Synthetic reader", email: "reader@example.invalid", roles: [] },
  } }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
});

test("Done leaves intake while a field save is slow and keeps the edit", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Example Slow Save ${randomUUID()}`, email: "before@example.invalid", owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  let releaseSave = () => {};
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  let heldSave = false;
  await page.route(`**/api/referrals/${referral.id}`, async (route) => {
    if (route.request().method() === "PATCH" && !heldSave) {
      heldSave = true;
      await saveGate;
    }
    await route.continue();
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
    const chart = page.getByRole("article", { name: "Referral chart", exact: true });
    await chart.getByRole("button", { name: "Edit Email", exact: true }).click();
    await page.locator('[data-workspace-field="email"] input').fill("after@example.invalid");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(() => heldSave).toBe(true);
    await expect(chart).toBeVisible();
    await expect(page.getByTestId("workspace-save-status")).toContainText(/Saving|Saved on this device/);
  } finally {
    releaseSave();
  }
  const chart = page.getByRole("article", { name: "Referral chart", exact: true });
  await expect(chart.locator('[data-chart-field="Email"]')).toContainText("after@example.invalid");
  await page.reload();
  await expect(chart.locator('[data-chart-field="Email"]')).toContainText("after@example.invalid");
});

test("a failed intake field save remains visible and retryable after Done", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Example Retry Save ${randomUUID()}`, email: "before@example.invalid", owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  let failOnce = true;
  await page.route(`**/api/referrals/${referral.id}`, async (route) => {
    if (route.request().method() === "PATCH" && failOnce) {
      failOnce = false;
      await route.fulfill({ status: 500, json: { error: "Synthetic save failure" } });
    } else await route.continue();
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  const chart = page.getByRole("article", { name: "Referral chart", exact: true });
  await chart.getByRole("button", { name: "Edit Email", exact: true }).click();
  await page.locator('[data-workspace-field="email"] input').fill("after@example.invalid");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(chart).toBeVisible();
  await expect(page.getByTestId("workspace-save-status")).toContainText("Not saved to Pipeline");
  await page.getByRole("button", { name: "Retry saving" }).click();
  await expect(chart.locator('[data-chart-field="Email"]')).toContainText("after@example.invalid");
  await page.reload();
  await expect(chart.locator('[data-chart-field="Email"]')).toContainText("after@example.invalid");
});

test("a chart visit that changes nothing writes nothing, and signing stays in assessment review", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Example Untouched ${randomUUID()}`, phone: "555-0101", owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  const before = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  const chart = page.getByRole("article", { name: "Referral chart", exact: true });
  await expect(chart).toBeVisible();

  // Unanswered items read as a neutral way in, not as a warning on the chart.
  const unanswered = page.getByRole("button", { name: "Review unanswered assessment items", exact: true });
  await expect(unanswered).toBeVisible();
  await expect(page.getByText(/^Assessment answers: \d+ of \d+ recorded\./)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sign/ })).toHaveCount(0);

  // Opening the intake editor and leaving without a change stores nothing.
  await chart.getByRole("button", { name: "Edit Phone", exact: true }).click();
  await expect(page.locator('[data-workspace-field="phone"] input')).toBeFocused();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(chart.getByRole("button", { name: "Edit Phone", exact: true })).toBeFocused();

  await unanswered.click();
  await expect(page.getByRole("heading", { name: "Review assessment", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sign/ })).toBeVisible();
  const after = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
  expect(after).toEqual(before);
});
