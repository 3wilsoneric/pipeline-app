import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

import type { OfflineAssessmentMutation, OfflineSyncResult } from "@/lib/offline/offline-assessment-store";
import type { Referral } from "@/lib/pipeline/referral-types";
import { assessmentInterviewSections } from "@/lib/assessment/assessment-interview-schema";
import {
  actorApiContext,
  actorPage,
  operationalMutationId,
  operationalActorHeaders,
  pipelineActors,
  requireOperationalBaseURL,
  syntheticReferralInput,
} from "../support/pipeline-actors";

test.describe("workflow interaction and durable feedback", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use the isolated operational configuration.");
  test.setTimeout(60_000);

  test("refreshes existing Home immediately and keeps assignments beyond the preview unseen", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const assessor = await actorApiContext("assessorA", url);
    const other = await actorApiContext("assessorB", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      await assessor.get("/api/auth/me");
      await page.goto("/");
      const panel = page.getByRole("region", { name: "Since your last visit" });
      await expect(panel).toBeVisible();
      await expect(panel).not.toContainText("could not be checked");
      const referrals: Referral[] = [];
      for (let index = 0; index < 8; index += 1) referrals.push(await createReferral(coordinator, uniqueName(), pipelineActors.assessorA.id));
      const refreshed = page.waitForResponse((response) => response.url().endsWith("/api/operations/home") && response.ok());
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const snapshot = await (await refreshed).json();
      const ids = new Set(referrals.map((referral) => referral.id));
      expect(snapshot.continuity.new_assignments.filter((item: { workspace: { referral_id: number } }) => ids.has(item.workspace.referral_id))).toHaveLength(8);
      await expect(panel.getByRole("button", { name: /Show \d+ more assignments/ })).toBeVisible();
      await expect(page.getByRole("region", { name: "Current work" }).getByRole("button", { name: "Open current work" })).toContainText("more");
      let acknowledged: { acknowledgeAssignmentIds?: string[]; acknowledgeAssignmentsThrough?: string } | undefined;
      await page.route("**/api/me/work-continuity", async (route) => {
        const body = route.request().postDataJSON();
        if (body?.acknowledgeAssignmentIds) acknowledged = body;
        await route.continue();
      });
      await panel.getByRole("button", { name: "Mark shown seen" }).click();
      await expect.poll(() => acknowledged?.acknowledgeAssignmentIds?.length).toBe(6);
      expect(acknowledged?.acknowledgeAssignmentsThrough).toBeUndefined();
      await expect(panel.getByRole("button", { name: "Mark shown seen" })).toBeEnabled();
      const after = await (await assessor.get("/api/operations/home")).json();
      const expectedRemaining = snapshot.continuity.new_assignments.filter((item: { event_id: string }) => !acknowledged!.acknowledgeAssignmentIds!.includes(item.event_id));
      expect(after.continuity.new_assignments.map((item: { event_id: string }) => item.event_id)).toEqual(expectedRemaining.map((item: { event_id: string }) => item.event_id));
      const otherHome = await (await other.get("/api/operations/home")).json();
      expect(otherHome.current_work.items.some((item: { referral_id: number }) => ids.has(item.referral_id))).toBe(false);
      expect(otherHome.continuity.new_assignments.some((item: { workspace: { referral_id: number } }) => ids.has(item.workspace.referral_id))).toBe(false);
    } finally {
      await context.close();
      await coordinator.dispose();
      await assessor.dispose();
      await other.dispose();
    }
  });

  test("does not restore acknowledged assignments from a delayed Home response or remount", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorB", url);
    const { page, context } = await actorPage(browser, "assessorB", url);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let releaseReturn!: () => void;
    const returnGate = new Promise<void>((resolve) => { releaseReturn = resolve; });
    try {
      await createReferral(api, uniqueName(), pipelineActors.assessorB.id);
      await page.goto("/");
      const panel = page.getByRole("region", { name: "Since your last visit" });
      await expect(panel.getByRole("button", { name: "Mark shown seen" })).toBeVisible();
      let held = false;
      let delivered = false;
      let holdReturn = false;
      let returnPending = false;
      await page.route("**/api/operations/home", async (route) => {
        const response = await route.fetch();
        if (holdReturn) {
          returnPending = true;
          await returnGate;
        }
        held = true;
        await gate;
        await route.fulfill({ response });
        delivered = true;
      });
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => held).toBe(true);
      await panel.getByRole("button", { name: "Mark shown seen" }).click();
      await expect(panel).toContainText("No referrals were assigned");
      release();
      await expect.poll(() => delivered).toBe(true);
      await expect(panel.getByRole("button", { name: "Mark shown seen" })).toHaveCount(0);
      await expect(panel).toContainText("No referrals were assigned");
      await page.getByRole("button", { name: "Open calendar", exact: true }).click();
      holdReturn = true;
      await page.getByRole("button", { name: "Pipeline home", exact: true }).click();
      await expect.poll(() => returnPending).toBe(true);
      await expect(panel.getByRole("button", { name: "Mark shown seen" })).toHaveCount(0);
      releaseReturn();
      await expect(panel).toContainText("No referrals were assigned");
    } finally {
      release();
      releaseReturn();
      await context.close();
      await api.dispose();
    }
  });

  test("confirms creation without claiming that a selected packet is already stored", async ({ browser, baseURL }, testInfo) => {
    const url = requireOperationalBaseURL(baseURL);
    const { page, context } = await actorPage(browser, "assessorA", url);
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve; });
    try {
      await page.goto("/?view=referrals&screen=packet");
      await page.getByRole("textbox", { name: "NAME", exact: true }).fill(uniqueName());
      await page.getByRole("combobox", { name: "Community:" }).selectOption("San Pablo");
      await page.getByRole("combobox", { name: "County:" }).selectOption("Contra Costa County");
      await expect(page.getByTestId("document-checklist-panel")).not.toHaveAttribute("open");
      await page.getByTestId("document-checklist-toggle").click();
      const packetBytes = syntheticPdf();
      await page.getByTestId("initial-packet-input").setInputFiles({
        name: "synthetic-intake.pdf", mimeType: "application/pdf", buffer: packetBytes,
      });
      await expect(page.getByRole("region", { name: "Document checklist" })).toContainText("Packet selected");
      let uploading = false;
      await page.route("**/api/uploads/local", async (route) => {
        uploading = true;
        await uploadGate;
        await route.continue();
      });
      await page.getByRole("button", { name: "Create referral", exact: true }).click();
      await expect.poll(() => uploading).toBe(true);
      const id = new URL(page.url()).searchParams.get("referralId");
      expect(id).not.toBeNull();
      await expect(page.getByTestId("workspace-save-status")).toContainText("Workspace created");
      await expect(page.getByTestId("workspace-save-status")).toContainText("Uploading");
      await expect(page.getByRole("region", { name: "Document checklist" })).toContainText("Packet selected");
      await expect(page.getByRole("button", { name: "Create referral", exact: true })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("creation-upload-pending.png") });
      releaseUpload();
      await expect(page.getByTestId("workspace-save-status")).toContainText("Packet uploaded");
      await expect(page.getByRole("region", { name: "Document checklist" })).toContainText("Packet added");
      expect(new URL(page.url()).searchParams.get("referralId")).toBe(id);
      const storedPacket = await page.request.get(`/api/referrals/${id}/packet`);
      expect(storedPacket.status()).toBe(200);
      expect(await storedPacket.body()).toEqual(packetBytes);
    } finally {
      releaseUpload();
      await context.close();
    }
  });

  test("keeps the second client's editor isolated while the first client's save completes", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      const first = await createReferral(api, uniqueName(), pipelineActors.assessorA.id);
      const second = await createReferral(api, uniqueName(), pipelineActors.assessorA.id);
      await page.goto(workspacePath(first.id));
      await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(first.name);
      let held = false;
      let delivered = false;
      await page.route(`**/api/referrals/${first.id}`, async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        const response = await route.fetch();
        held = true;
        await gate;
        await route.fulfill({ response });
        delivered = true;
      });
      const revisedName = uniqueName();
      await page.getByRole("textbox", { name: "NAME", exact: true }).fill(revisedName);
      await expect.poll(() => held).toBe(true);
      await page.evaluate((path) => {
        window.history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, workspacePath(second.id));
      await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(second.name);
      release();
      await expect.poll(() => delivered).toBe(true);
      await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(second.name);
      expect(new URL(page.url()).searchParams.get("referralId")).toBe(String(second.id));
      expect((await (await api.get(`/api/referrals/${first.id}`)).json()).referral.name).toBe(revisedName);
      expect((await (await api.get(`/api/referrals/${second.id}`)).json()).referral.name).toBe(second.name);
      await page.getByRole("textbox", { name: "Client phone:", exact: true }).fill("555-0123");
      await expect.poll(async () => (await (await api.get(`/api/referrals/${second.id}`)).json()).referral.phone).toBe("555-0123");
      expect((await (await api.get(`/api/referrals/${first.id}`)).json()).referral.phone).toBe(first.phone);
    } finally {
      release();
      await context.close();
      await api.dispose();
    }
  });

  test("uses Pacific Time from a different browser timezone and exposes assessment saves on a narrow screen", async ({ browser, baseURL }, testInfo) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const context = await browser.newContext({ baseURL: url, timezoneId: "America/New_York", extraHTTPHeaders: operationalActorHeaders("assessorA", url) });
    const page = await context.newPage();
    try {
      const referral = await createReferral(api, uniqueName(), pipelineActors.assessorA.id);
      const updated = await api.patch(`/api/referrals/${referral.id}`, { data: {
        if_match: referral.version, if_match_sections: referral.sectionVersions,
        patch: { phone: "555-0101", email: "synthetic@example.invalid" },
      } });
      expect(updated.status()).toBe(200);
      const created = await api.post(`/api/referrals/${referral.id}/assessments`, { data: {
        client_mutation_id: operationalMutationId("interaction-assessment"), data: { current_location: "Synthetic placement" },
      } });
      expect(created.status()).toBe(201);
      const assessmentId = (await created.json()).assessment.assessment_id;
      await page.goto(`${workspacePath(referral.id)}&workspaceStage=assessment`);
      const scheduling = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
      await expect(scheduling).toBeVisible();
      await scheduling.getByRole("combobox", { name: "Assessment method" }).selectOption("zoom");
      await scheduling.getByRole("textbox", { name: "Zoom meeting link" }).fill("https://zoom.us/j/123456789");
      await scheduling.getByLabel("Assessment date and time").fill("2027-03-14T02:30");
      await scheduling.getByRole("button", { name: "Schedule assessment", exact: true }).click();
      await expect(scheduling.getByRole("alert")).toContainText("valid assessment date and time in Pacific Time");
      expect((await (await api.get(`/api/assessments/${assessmentId}`)).json()).assessment.scheduled_start_at).toBeFalsy();
      await scheduling.getByLabel("Assessment date and time").fill("2026-09-18T10:30");
      await scheduling.getByRole("button", { name: "Schedule assessment", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Begin assessment", exact: true })).toBeVisible();
      const scheduled = (await (await api.get(`/api/assessments/${assessmentId}`)).json()).assessment;
      expect(scheduled.scheduled_start_at).toBe("2026-09-18T17:30:00.000Z");
      expect(scheduled.scheduled_method).toBe("zoom");
      await page.getByRole("dialog", { name: "Begin assessment", exact: true }).getByRole("button", { name: "Begin assessment", exact: true }).click();
      const guided = page.locator('[data-guided-assessment="true"]');
      await expect(guided).toBeVisible();
      const visited: string[] = [];
      for (let index = 0; index < 60; index += 1) {
        const section = (await guided.getAttribute("data-screen-section"))!;
        if (!visited.includes(section)) visited.push(section);
        if (section === "physical_health") break;
        await guided.getByRole("button", { name: "Next", exact: true }).click();
      }
      await expect(guided).toHaveAttribute("data-screen-section", "physical_health");
      const title = await guided.getByRole("heading", { level: 1 }).innerText();
      const screenCount = Number(await guided.getAttribute("data-visible-screens"));
      const latest = (await (await api.get(`/api/assessments/${assessmentId}`)).json()).assessment;
      const changed = await api.patch(`/api/assessments/${assessmentId}`, { data: {
        section: "substance_use", if_match_section: latest.section_versions.substance_use,
        client_mutation_id: operationalMutationId("interaction-conditional"), patch: { data: { substance_abuse_history: "yes" } },
      } });
      expect(changed.status()).toBe(200);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(async () => Number(await guided.getAttribute("data-visible-screens"))).toBeGreaterThan(screenCount);
      await expect(guided).toHaveAttribute("data-screen-section", "physical_health");
      await expect(guided.getByRole("heading", { level: 1 })).toHaveText(title);
      await page.setViewportSize({ width: 390, height: 844 });
      const status = page.locator('[data-guide-target="assessment-save-status"]:visible');
      await expect(status).toBeVisible();
      for (let index = 0; index < 60; index += 1) {
        const section = (await guided.getAttribute("data-screen-section"))!;
        if (!visited.includes(section)) visited.push(section);
        const done = guided.getByRole("button", { name: "Done", exact: true });
        if (await done.count()) { await done.click(); break; }
        await guided.getByRole("button", { name: "Next", exact: true }).click();
      }
      expect(visited).toEqual(assessmentInterviewSections.map((section) => section.key));
      await expect(page.locator('[data-assessment-view="chart"]')).toBeVisible();
      await expect(status).toBeVisible();
      const sectionSelect = page.getByRole("combobox", { name: "Assessment section", exact: true });
      for (const section of [...assessmentInterviewSections].reverse()) {
        await sectionSelect.selectOption(section.key);
        await expect(page.getByRole("dialog", { name: "Assessment interview", exact: true }).getByRole("heading", { name: section.label, exact: true })).toBeVisible();
      }
      const allAssessments = (await (await api.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
      expect(allAssessments).toHaveLength(1);
      expect(allAssessments[0].assessment_id).toBe(assessmentId);
      for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator('[data-guide-target="assessment-save-status"]')).toHaveCount(1);
        await expect(status).toBeVisible();
        const close = page.getByRole("button", { name: "Close assessment", exact: true });
        await expect(close).toBeVisible();
        const bounds = await close.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: testInfo.outputPath("assessment-narrow-save-state.png") });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    } finally {
      await context.close();
      await api.dispose();
    }
  });

  for (const result of ["acknowledged", "conflict", "concurrent_initialization"] as const) {
    test(`preserves a newer encrypted queued edit when an older revision is ${result}`, async ({ page }) => {
      await page.goto("/api/health/live");
      const source = ts.transpileModule(readFileSync("lib/offline/offline-assessment-store.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      const outcome = await page.evaluate(async ({ source, result }) => {
        const exports: Record<string, unknown> = {};
        // Schema formatting is outside this test; the real queue/crypto/IDB code runs unchanged.
        new Function("exports", "require", source)(exports, (name: string) => {
          if (name === "@/lib/assessment/assessment-interview-schema" || name === "@/lib/assessment/assessment-tool-schema") return {};
          throw new Error(`Unexpected offline dependency: ${name}`);
        });
        const store = exports as unknown as {
          initializeOfflineAssessmentStore(id: string): Promise<string>;
          queueOfflineAssessmentMutation(id: string, mutation: OfflineAssessmentMutation): Promise<void>;
          flushOfflineAssessmentMutations(id: string, sender: (mutation: OfflineAssessmentMutation) => Promise<void>): Promise<OfflineSyncResult>;
          clearPipelineOfflineData(): Promise<void>;
        };
        await store.clearPipelineOfflineData();
        const principal = "synthetic-offline-assessor";
        const mutation: OfflineAssessmentMutation = { dedupeKey: "assessment:history", url: "/synthetic", method: "PATCH", body: "older", createdAt: new Date().toISOString() };
        if (result === "concurrent_initialization") {
          const generateKey = window.crypto.subtle.generateKey.bind(window.crypto.subtle);
          let generated = 0;
          let release!: () => void;
          const gate = new Promise<void>((resolve) => { release = resolve; });
          Object.defineProperty(window.crypto.subtle, "generateKey", { configurable: true, value: async (algorithm: AlgorithmIdentifier, extractable: boolean, usages: KeyUsage[]) => {
            const key = await generateKey(algorithm, extractable, usages);
            generated += 1;
            if (generated === 2) release();
            await gate;
            return key;
          } });
          try {
            await Promise.all([
              store.queueOfflineAssessmentMutation(principal, mutation),
              store.queueOfflineAssessmentMutation(principal, { ...mutation, dedupeKey: "assessment:function", body: "newer" }),
            ]);
            const bodies: string[] = [];
            const flushed = await store.flushOfflineAssessmentMutations(principal, async (sent) => { bodies.push(sent.body); });
            return { first: flushed, second: flushed, nextBody: bodies.sort().join(",") };
          } finally {
            Reflect.deleteProperty(window.crypto.subtle, "generateKey");
            await store.clearPipelineOfflineData();
          }
        }
        await store.initializeOfflineAssessmentStore(principal);
        const now = Date.now;
        Date.now = () => 1_800_000_000_000;
        try {
          await store.queueOfflineAssessmentMutation(principal, mutation);
          const first = await store.flushOfflineAssessmentMutations(principal, async (sent) => {
            if (sent.body !== "older") throw new Error("Wrong revision sent");
            await store.queueOfflineAssessmentMutation(principal, { ...mutation, body: "newer" });
            if (result === "conflict") throw Object.assign(new Error("Synthetic conflict"), { status: 409 });
          });
          let nextBody = "";
          const second = await store.flushOfflineAssessmentMutations(principal, async (sent) => { nextBody = sent.body; });
          return { first, second, nextBody };
        } finally {
          Date.now = now;
          await store.clearPipelineOfflineData();
        }
      }, { source, result });
      if (result === "concurrent_initialization") {
        expect(outcome.first).toEqual({ completed: 2, conflicts: 0, remaining: 0 });
        expect(outcome.nextBody).toBe("newer,older");
        return;
      }
      expect(outcome.first.remaining).toBe(1);
      expect(outcome.first.completed).toBe(result === "acknowledged" ? 1 : 0);
      expect(outcome.first.conflicts).toBe(result === "conflict" ? 1 : 0);
      expect(outcome.nextBody).toBe("newer");
      expect(outcome.second).toEqual({ completed: 1, conflicts: 0, remaining: 0 });
    });
  }
});

async function createReferral(api: APIRequestContext, name: string, assigneeId: string): Promise<Referral> {
  const created = await api.post("/api/referrals", { data: {
    client_mutation_id: operationalMutationId("interaction-referral"), assignee_id: assigneeId,
    referral: { ...syntheticReferralInput("assessorA"), name, documentName: `${name}.pdf` },
  } });
  expect(created.status()).toBe(201);
  return (await created.json()).referral;
}

function workspacePath(id: number) { return `/?view=referrals&screen=packet&referralId=${id}`; }
function uniqueName() {
  const token = Array.from(randomUUID(), (character) => String.fromCharCode(97 + character.charCodeAt(0) % 26)).join("");
  return `Workflow ${token[0].toUpperCase()}${token.slice(1)}`;
}

function syntheticPdf() {
  const content = `BT /F1 12 Tf 50 700 Td (Synthetic packet ${randomUUID()}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
