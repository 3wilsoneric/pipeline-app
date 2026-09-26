import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { createOperationalReferral } from "../support/operational-api";
import { actorApiContext, actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";

test.describe("acceptance save recovery", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Uses isolated operational stores.");
  test.setTimeout(60_000);

  test("shows a committed acceptance when its workflow refresh fails", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const admin = await actorApiContext("admin", url);
    const assessor = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "admin", url);
    try {
      await assessor.get("/api/auth/me");
      const referral = await createOperationalReferral(assessor, "assessorA", {
        name: `Synthetic Acceptance Recovery ${randomUUID().slice(0, 8)}`,
      });
      let decisionWrites = 0;
      let decisionStatus = 0;
      let failedWorkflowReads = 0;
      let decisionCommitted = false;

      await page.route(`**/api/referrals/${referral.id}/workflow`, (route) => {
        if (!decisionCommitted || route.request().method() !== "GET") return route.continue();
        failedWorkflowReads += 1;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic workflow refresh unavailable" }),
        });
      });
      await page.route(`**/api/referrals/${referral.id}/decision`, async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        decisionWrites += 1;
        const response = await route.fetch();
        decisionStatus = response.status();
        decisionCommitted = response.ok();
        await route.fulfill({ response });
      });

      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
      const decision = page.getByRole("region", { name: "Admission decision", exact: true });
      await decision.getByRole("radio", { name: "Accept", exact: true }).check();
      await decision.getByRole("button", { name: "Record decision", exact: true }).click();
      await page.getByRole("alertdialog", { name: "Accept this referral?" })
        .getByRole("button", { name: "Record acceptance", exact: true }).click();

      await expect.poll(() => decisionWrites).toBe(1);
      await expect.poll(() => failedWorkflowReads).toBeGreaterThanOrEqual(1);
      expect(decisionStatus).toBe(200);
      const readback = await admin.get(`/api/referrals/${referral.id}/decision`);
      const readbackBody = await readback.text();
      expect(readback.status(), readbackBody).toBe(200);
      expect(JSON.parse(readbackBody).decision).toMatchObject({ outcome: "accepted" });

      const savedDecision = decision.locator('section[data-outcome="accepted"]');
      await expect(savedDecision.getByText("Decision recorded", { exact: true })).toBeVisible();
      await expect(decision.getByRole("button", { name: "Record decision", exact: true })).toHaveCount(0);
      await expect(decision.getByRole("button", { name: /Retry (?:decision|saving)/i })).toHaveCount(0);
      await expect(decision.getByText(/Not saved|could not be saved/i)).toHaveCount(0);
      expect(decisionWrites).toBe(1);
    } finally {
      await context.close();
      await admin.dispose();
      await assessor.dispose();
    }
  });

  test("reads back acceptance when its successful response is lost", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const admin = await actorApiContext("admin", url);
    const assessor = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "admin", url);
    try {
      await assessor.get("/api/auth/me");
      const referral = await createOperationalReferral(assessor, "assessorA", {
        name: `Synthetic Lost Acceptance Response ${randomUUID().slice(0, 8)}`,
      });
      let decisionWrites = 0;
      let decisionStatus = 0;
      let responseDropped = false;
      let reconciliationReads = 0;

      await page.route(`**/api/referrals/${referral.id}/workflow`, (route) => {
        if (responseDropped && route.request().method() === "GET") reconciliationReads += 1;
        return route.continue();
      });
      await page.route(`**/api/referrals/${referral.id}/decision`, async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        decisionWrites += 1;
        const response = await route.fetch();
        decisionStatus = response.status();
        responseDropped = response.ok();
        await route.abort("failed");
      });

      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
      const decision = page.getByRole("region", { name: "Admission decision", exact: true });
      await decision.getByRole("radio", { name: "Accept", exact: true }).check();
      await decision.getByRole("button", { name: "Record decision", exact: true }).click();
      await page.getByRole("alertdialog", { name: "Accept this referral?" })
        .getByRole("button", { name: "Record acceptance", exact: true }).click();

      await expect.poll(() => decisionWrites).toBe(1);
      await expect.poll(() => reconciliationReads).toBeGreaterThanOrEqual(1);
      expect(decisionStatus).toBe(200);
      expect(responseDropped).toBe(true);
      const readback = await admin.get(`/api/referrals/${referral.id}/decision`);
      const readbackBody = await readback.text();
      expect(readback.status(), readbackBody).toBe(200);
      expect(JSON.parse(readbackBody).decision).toMatchObject({ outcome: "accepted" });

      const savedDecision = decision.locator('section[data-outcome="accepted"]');
      await expect(savedDecision.getByText("Decision recorded", { exact: true })).toBeVisible();
      await expect(decision.getByRole("button", { name: "Record decision", exact: true })).toHaveCount(0);
      await expect(decision.getByRole("button", { name: /Retry (?:decision|saving)/i })).toHaveCount(0);
      await expect(decision.getByText(/Not saved|could not be saved/i)).toHaveCount(0);
      expect(decisionWrites).toBe(1);
    } finally {
      await context.close();
      await admin.dispose();
      await assessor.dispose();
    }
  });

  test("keeps confirmed acceptance when workflow refresh returns an older snapshot", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const admin = await actorApiContext("admin", url);
    const assessor = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "admin", url);
    try {
      await assessor.get("/api/auth/me");
      const referral = await createOperationalReferral(assessor, "assessorA", {
        name: `Synthetic Stale Acceptance Refresh ${randomUUID().slice(0, 8)}`,
      });
      let staleWorkflow = "";
      let decisionWrites = 0;
      let decisionStatus = 0;
      let decisionCommitted = false;
      let staleReads = 0;

      await page.route(`**/api/referrals/${referral.id}/workflow`, async (route) => {
        if (decisionCommitted) {
          staleReads += 1;
          await route.fulfill({ status: 200, contentType: "application/json", body: staleWorkflow });
          return;
        }
        const response = await route.fetch();
        if (response.ok() && !staleWorkflow) staleWorkflow = await response.text();
        await route.fulfill({ response });
      });
      await page.route(`**/api/referrals/${referral.id}/decision`, async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        decisionWrites += 1;
        const response = await route.fetch();
        decisionStatus = response.status();
        decisionCommitted = response.ok();
        await route.fulfill({ response });
      });

      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
      const decision = page.getByRole("region", { name: "Admission decision", exact: true });
      await decision.getByRole("radio", { name: "Accept", exact: true }).check();
      expect(staleWorkflow).not.toBe("");
      expect(JSON.parse(staleWorkflow).decision).toBeNull();
      await decision.getByRole("button", { name: "Record decision", exact: true }).click();
      await page.getByRole("alertdialog", { name: "Accept this referral?" })
        .getByRole("button", { name: "Record acceptance", exact: true }).click();

      await expect.poll(() => decisionWrites).toBe(1);
      await expect.poll(() => staleReads).toBeGreaterThanOrEqual(1);
      expect(decisionStatus).toBe(200);
      const readback = await admin.get(`/api/referrals/${referral.id}/decision`);
      const readbackBody = await readback.text();
      expect(readback.status(), readbackBody).toBe(200);
      expect(JSON.parse(readbackBody).decision).toMatchObject({ outcome: "accepted" });

      const savedDecision = decision.locator('section[data-outcome="accepted"]');
      await expect(savedDecision.getByText("Decision recorded", { exact: true })).toBeVisible();
      await expect(decision.getByRole("button", { name: "Record decision", exact: true })).toHaveCount(0);
      await expect(decision.getByText(/Not saved|could not be saved/i)).toHaveCount(0);
      expect(decisionWrites).toBe(1);
    } finally {
      await context.close();
      await admin.dispose();
      await assessor.dispose();
    }
  });
});
