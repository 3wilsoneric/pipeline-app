import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";

test("two tabs on one assessment keep disjoint answers and expose same-answer conflicts", async ({ page }) => {
  test.setTimeout(60_000);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Synthetic shared tabs ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`;
  const other = await page.context().newPage();
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;

  try {
    await page.goto(url);
    await other.goto(url);
    const placementsA = page.locator("#assessment-prior_placements");
    const placementsB = other.locator("#assessment-prior_placements");
    const holdsB = other.getByRole("textbox", { name: "Hospitalization history", exact: true });
    await expect(placementsA).toBeEditable();
    await expect(placementsB).toBeEditable();

    await placementsA.fill("First tab's placement history");
    await placementsA.blur();
    await expect.poll(async () => (await read()).prior_placements).toBe("First tab's placement history");
    await holdsB.fill("Second tab's separate history");
    await holdsB.blur();
    await expect.poll(read).toMatchObject({
      prior_placements: "First tab's placement history",
      hospitalization_history: "Second tab's separate history",
    });

    await placementsA.fill("First tab's later answer");
    await placementsB.fill("Second tab's competing answer");
    await placementsA.blur();
    await expect.poll(async () => (await read()).prior_placements).toBe("First tab's later answer");
    await placementsB.blur();
    await expect(other.getByRole("button", { name: "Keep mine", exact: true })).toBeVisible();
    expect((await read()).prior_placements).toBe("First tab's later answer");
    await expect(holdsB).toBeEditable();

    await other.waitForTimeout(1200);
    await other.reload();
    await expect(other.getByRole("button", { name: "Keep mine", exact: true })).toBeVisible();
    await other.getByRole("button", { name: "Keep mine", exact: true }).click();
    await expect.poll(read).toMatchObject({
      prior_placements: "Second tab's competing answer",
      hospitalization_history: "Second tab's separate history",
    });
    await page.reload();
    await expect(page.locator("#assessment-prior_placements")).toHaveValue("Second tab's competing answer");
    const records = (await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
    expect(records).toHaveLength(1);
  } finally {
    await other.close();
  }
});

test("a second tab saving cannot erase the first tab's unsaved recovery", async ({ page }) => {
  test.setTimeout(60_000);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Synthetic shared recovery ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`;
  const other = await page.context().newPage();
  try {
    await page.goto(url);
    await other.goto(url);
    const answer = "Unsaved first-tab answer that must survive closing";
    await page.route(`**/api/assessments/${assessment.assessment_id}`, (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "Synthetic first-tab save outage" } }) : route.continue());
    await page.locator("#assessment-prior_placements").fill(answer);
    // The encrypted working-set snapshot is debounced by 250 ms.
    await page.waitForTimeout(800);

    const holds = other.getByRole("textbox", { name: "Hospitalization history", exact: true });
    await holds.fill("Second tab's saved answer");
    await holds.blur();
    const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    await expect.poll(async () => (await read()).hospitalization_history).toBe("Second tab's saved answer");
    expect((await read()).prior_placements).toBeNull();
    await other.waitForTimeout(800);

    await page.close({ runBeforeUnload: false });
    const reopened = await other.context().newPage();
    try {
      await reopened.goto(url);
      await expect(reopened.locator("#assessment-prior_placements")).toHaveValue(answer);
      await expect(reopened.getByRole("textbox", { name: "Hospitalization history", exact: true })).toHaveValue("Second tab's saved answer");
    } finally {
      await reopened.close();
    }
  } finally {
    await other.close();
  }
});

test("different unsaved answers in two tabs both survive closing the browser pages", async ({ page }) => {
  test.setTimeout(60_000);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Synthetic dual recovery ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`;
  const other = await page.context().newPage();
  try {
    await page.goto(url);
    await other.goto(url);
    await page.route(`**/api/assessments/${assessment.assessment_id}`, (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "Synthetic first-tab save outage" } }) : route.continue());
    await other.route(`**/api/assessments/${assessment.assessment_id}`, (route) => route.request().method() === "PATCH"
      ? route.fulfill({ status: 503, json: { error: "Synthetic second-tab save outage" } }) : route.continue());
    await page.locator("#assessment-prior_placements").fill("First tab's unsaved placement");
    await page.waitForTimeout(800);
    await other.getByRole("textbox", { name: "Hospitalization history", exact: true }).fill("Second tab's unsaved hold history");
    await other.waitForTimeout(800);
    await page.close({ runBeforeUnload: false });
    await other.close({ runBeforeUnload: false });
    const unsaved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(unsaved.prior_placements).toBeNull();
    expect(unsaved.hospitalization_history).toBeNull();

    const reopened = await page.context().newPage();
    try {
      await reopened.goto(url);
      await expect(reopened.locator("#assessment-prior_placements")).toHaveValue("First tab's unsaved placement");
      await expect(reopened.getByRole("textbox", { name: "Hospitalization history", exact: true })).toHaveValue("Second tab's unsaved hold history");
    } finally {
      await reopened.close();
    }
  } finally {
    if (!other.isClosed()) await other.close();
  }
});

test("clearing an unsaved answer in its own tab does not restore the old text", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Synthetic clear recovery ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  await createOperationalAssessment(page.request, referral.id);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`;
  await page.goto(url);
  const answer = page.locator("#assessment-prior_placements");
  await answer.fill("Temporary unsaved answer");
  await page.waitForTimeout(800);
  await answer.fill("");
  await page.waitForTimeout(800);
  await page.reload();
  await expect(answer).toHaveValue("");
});

test("two unsaved answers to the same question remain recoverable", async ({ page }) => {
  test.setTimeout(60_000);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Synthetic competing recovery ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`;
  const other = await page.context().newPage();
  try {
    await page.goto(url);
    await other.goto(url);
    for (const tab of [page, other]) {
      await tab.route(`**/api/assessments/${assessment.assessment_id}`, (route) => route.request().method() === "PATCH"
        ? route.fulfill({ status: 503, json: { error: "Synthetic save outage" } }) : route.continue());
    }
    await page.locator("#assessment-prior_placements").fill("First account of placement history");
    await page.waitForTimeout(800);
    await other.locator("#assessment-prior_placements").fill("Second account of placement history");
    await other.waitForTimeout(800);
    await page.close({ runBeforeUnload: false });
    await other.close({ runBeforeUnload: false });

    const reopened = await page.context().newPage();
    try {
      await reopened.goto(url);
      await expect(reopened.locator("#assessment-prior_placements")).toHaveValue("Second account of placement history");
      await expect(reopened.getByText("First account of placement history")).toBeVisible();
      await reopened.getByRole("button", { name: "Keep mine", exact: true }).click();
      await expect.poll(async () => (await (await reopened.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.prior_placements)
        .toBe("Second account of placement history");
      await reopened.reload();
      await expect(reopened.locator("#assessment-prior_placements")).toHaveValue("Second account of placement history");
      await expect(reopened.getByText("First account of placement history")).not.toBeVisible();
    } finally {
      await reopened.close();
    }
  } finally {
    if (!other.isClosed()) await other.close();
  }
});

test("simultaneous edits in separate tabs preserve both recovery fields", async ({ page }) => {
  test.setTimeout(60_000);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Synthetic simultaneous recovery ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`;
  const other = await page.context().newPage();
  try {
    await Promise.all([page.goto(url), other.goto(url)]);
    for (const tab of [page, other]) {
      await tab.route(`**/api/assessments/${assessment.assessment_id}`, (route) => route.request().method() === "PATCH"
        ? route.fulfill({ status: 503, json: { error: "Synthetic save outage" } }) : route.continue());
    }
    await Promise.all([
      page.locator("#assessment-prior_placements").fill("Parallel placement answer"),
      other.getByRole("textbox", { name: "Hospitalization history", exact: true }).fill("Parallel hold answer"),
    ]);
    await page.waitForTimeout(1000);
    await page.close({ runBeforeUnload: false });
    await other.close({ runBeforeUnload: false });
    const reopened = await page.context().newPage();
    try {
      await reopened.goto(url);
      await expect(reopened.locator("#assessment-prior_placements")).toHaveValue("Parallel placement answer");
      await expect(reopened.getByRole("textbox", { name: "Hospitalization history", exact: true })).toHaveValue("Parallel hold answer");
    } finally {
      await reopened.close();
    }
  } finally {
    if (!other.isClosed()) await other.close();
  }
});

test("leaving the assessment from two tabs keeps both unsaved answers", async ({ page }) => {
  test.setTimeout(60_000);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Synthetic exit recovery ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`;
  const other = await page.context().newPage();
  try {
    await page.goto(url);
    await other.goto(url);
    for (const tab of [page, other]) {
      await tab.route(`**/api/assessments/${assessment.assessment_id}`, (route) => route.request().method() === "PATCH"
        ? route.fulfill({ status: 503, json: { error: "Synthetic save outage" } }) : route.continue());
    }
    await page.locator("#assessment-prior_placements").fill("First tab's exit draft");
    await page.waitForTimeout(800);
    await other.getByRole("textbox", { name: "Hospitalization history", exact: true }).fill("Second tab's exit draft");
    await other.waitForTimeout(800);
    for (const tab of [page, other]) {
      await tab.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Chart", exact: true }).click();
      await expect(tab.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Chart", exact: true })).toHaveAttribute("aria-current", "page");
    }
    const whileOwned = await page.context().newPage();
    try {
      await whileOwned.goto(url);
      await expect(whileOwned.locator("#assessment-prior_placements")).toHaveValue("");
      await expect(whileOwned.getByRole("textbox", { name: "Hospitalization history", exact: true })).toHaveValue("");
    } finally {
      await whileOwned.close();
    }
    await page.close({ runBeforeUnload: false });
    await other.close({ runBeforeUnload: false });
    const reopened = await page.context().newPage();
    try {
      await reopened.goto(url);
      await expect(reopened.locator("#assessment-prior_placements")).toHaveValue("First tab's exit draft");
      await expect(reopened.getByRole("textbox", { name: "Hospitalization history", exact: true })).toHaveValue("Second tab's exit draft");
    } finally {
      await reopened.close();
    }
  } finally {
    await other.close();
  }
});

test("three competing tab drafts remain available for selection", async ({ page }) => {
  test.setTimeout(60_000);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Synthetic three-tab recovery ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`;
  const tabs = [page, await page.context().newPage(), await page.context().newPage()];
  try {
    for (const tab of tabs) {
      await tab.goto(url);
      await tab.route(`**/api/assessments/${assessment.assessment_id}`, (route) => route.request().method() === "PATCH"
        ? route.fulfill({ status: 503, json: { error: "Synthetic save outage" } }) : route.continue());
    }
    for (const [index, tab] of tabs.entries()) {
      await tab.locator("#assessment-prior_placements").fill(["First draft", "Second draft", "Third draft"][index]);
      if (index === 0) await tab.getByRole("textbox", { name: "Hospitalization history", exact: true }).fill("First tab's separate history");
      await tab.waitForTimeout(800);
    }
    await Promise.all(tabs.map((tab) => tab.close({ runBeforeUnload: false })));
    const reopened = await page.context().newPage();
    try {
      await reopened.goto(url);
      await expect(reopened.locator("#assessment-prior_placements")).toHaveValue("Third draft");
      await expect(reopened.getByText("First draft")).toBeVisible();
      await expect(reopened.getByText("Second draft")).toBeVisible();
      await expect(reopened.getByRole("textbox", { name: "Hospitalization history", exact: true })).toHaveValue("First tab's separate history");
      await reopened.getByRole("button", { name: "Use answer: Second draft" }).click();
      await expect.poll(async () => (await (await reopened.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.prior_placements)
        .toBe("Second draft");
      await reopened.reload();
      await expect(reopened.locator("#assessment-prior_placements")).toHaveValue("Second draft");
      await expect(reopened.getByText("First draft")).not.toBeVisible();
      await expect(reopened.getByRole("textbox", { name: "Hospitalization history", exact: true })).toHaveValue("First tab's separate history");
    } finally {
      await reopened.close();
    }
  } finally {
    for (const tab of tabs) if (!tab.isClosed()) await tab.close();
  }
});
