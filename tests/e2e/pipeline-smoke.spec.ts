import { expect, test } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import {
  assessmentToolFieldDefinitions,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
} from "../../lib/assessment/assessment-tool-schema";
import { assessmentInterviewQuestions, assessmentInterviewSections } from "../../lib/assessment/assessment-interview-schema";
import type { PipelineAssessmentRecord } from "../../lib/assessment/assessment-records";
import type { PacketFieldsResponse, ReviewFieldResponse } from "../../lib/extraction/contracts";
import type { Referral } from "../../lib/pipeline/referral-types";
import type { PipelineResidentLink } from "../../lib/pipeline/resident-link-records";
import {
  clinicalFixture,
  clientDirectoryFixture,
  unifiedProfileFixture,
} from "./support/pipeline-clinical-fixtures";

type PacketFieldReviewResult = ReviewFieldResponse & {
  packet_fields?: PacketFieldsResponse;
  referral?: Referral;
  projection_status?: "synchronized" | "not_linked";
};

const testAssessor = {
  id: "provisional:allo:annette",
  name: "Annette Everhart",
} as const;

const clinicalMockPort = Number(process.env.PIPELINE_E2E_CLINICAL_PORT ?? "3299");
let clinicalMockServer: Server;
let governedResidentDob = "1984-06-12";
let governedResidentNumber = "SYN-R-100";

const assessmentServerOwnedFields = new Set<AssessmentToolFieldKey>([
  "assessor",
  "unable_to_assess_reasons",
  "source_file",
  "match_confidence",
  "extraction_date",
]);
const assessmentYesNoFields = new Set(
  assessmentInterviewQuestions.filter((question) => question.control === "yes_no").map((question) => question.field),
);

function completedAssessmentPatch(current: Partial<AssessmentToolData>) {
  const patch: Partial<AssessmentToolData> = {};
  for (const definition of assessmentToolFieldDefinitions) {
    if (!definition.required_for_completion || assessmentServerOwnedFields.has(definition.key)) continue;
    if (hasAssessmentTestValue(current[definition.key])) continue;
    patch[definition.key] = assessmentTestValue(definition.key, definition.value_type) as never;
  }
  return patch;
}

function assessmentTestValue(field: AssessmentToolFieldKey, valueType: string) {
  if (field === "diagnosis_categories") return ["schizophrenia"];
  if (field === "dress_assistance_level" || field === "bathing_assistance_level") return "independent";
  if (field === "conservatorship_type") return "non_conserved";
  if (field === "ambulatory" || field === "linear_conversation" || field === "medication_adherence") return "yes";
  if (valueType === "date") return "2026-08-25";
  if (valueType === "integer") return field.endsWith("_rating") ? 3 : 0;
  if (valueType === "string_list") return ["Recorded"];
  if (assessmentYesNoFields.has(field)) return "no";
  return field === "resident_name" ? "Assessment Test Client" : "Recorded in test interview";
}

function hasAssessmentTestValue(value: AssessmentToolData[AssessmentToolFieldKey] | undefined) {
  if (Array.isArray(value)) return value.some((item) => item.trim().length > 0);
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null && value !== undefined;
}

function uniqueAlphabeticNameToken() {
  const token = randomUUID()
    .replaceAll("-", "")
    .slice(0, 10)
    .replace(/[0-9]/g, (digit) => String.fromCharCode("g".charCodeAt(0) + Number(digit)));
  return `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
}

test.describe("Referral home and packet canvas", () => {
  test.beforeAll(async () => {
    clinicalMockServer = createServer((request, response) => {
      if (request.headers.authorization !== "Bearer playwright-clinical-token") {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: "unauthorized" }));
        return;
      }
      if (!request.url?.startsWith("/api/integrations/pipeline/clinical/residents/")) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ code: "not_found" }));
        return;
      }
      const payload = structuredClone(clinicalFixture.resident) as {
        resident: Record<string, unknown>;
      };
      payload.resident.date_of_birth = governedResidentDob;
      payload.resident.resident_number = governedResidentNumber;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    });
    await new Promise<void>((resolve, reject) => {
      clinicalMockServer.once("error", reject);
      clinicalMockServer.listen(clinicalMockPort, "127.0.0.1", resolve);
    });
  });

  test.afterAll(async () => {
    if (!clinicalMockServer) return;
    await new Promise<void>((resolve, reject) => clinicalMockServer.close((error) => error ? reject(error) : resolve()));
  });

  test.beforeEach(async ({ page }) => {
    governedResidentDob = "1984-06-12";
    governedResidentNumber = "SYN-R-100";
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("/_next/webpack-hmr")) {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/?view=referrals");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Referral workspaces", { exact: true }).last()).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("keeps the opening surface focused on finding or creating a packet", async ({
    page,
  }) => {
    await expect(page.getByRole("button", { name: "Pipeline home" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Alamo Platform" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to Alamo Platform" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Platform pages" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Analytics" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Focus search" })).toHaveCount(0);
    await expect(page.getByText("Referral workspaces", { exact: true }).last()).toBeVisible();
    await expect(page.getByLabel("Select referral packet")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Current work", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "All workspaces", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create new referral" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Referral worklist" }).or(
        page.getByText("No workspaces yet", { exact: true }),
      ),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Action categories" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Needs action", exact: true })).toHaveCount(0);
    const activeReferrals = page.getByRole("button", { name: "Open referrals" });
    await expect(activeReferrals).toHaveAttribute("aria-current", "page");
    await expect(activeReferrals).toHaveAttribute("data-active", "true");
    await expect(activeReferrals).toHaveClass(/bg-\[#e7f3ee\]/);
    await expect(activeReferrals).toHaveCSS("background-color", "rgb(231, 243, 238)");
    await expect(activeReferrals).toHaveCSS("border-color", "rgb(15, 139, 115)");
    const inactiveProfiles = page.getByRole("button", { name: "Open client profiles" });
    await expect(inactiveProfiles).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(inactiveProfiles).toHaveCSS("border-color", "rgba(0, 0, 0, 0)");
    for (const navItem of [
      activeReferrals,
      inactiveProfiles,
      page.getByRole("button", { name: "Create new referral" }),
    ]) {
      expect((await navItem.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect((await navItem.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect((await activeReferrals.boundingBox())?.width ?? 0).toBeGreaterThan(100);
    await expect(page.getByRole("tab", { name: "Kanban board" })).toHaveCount(0);

    const workspaceSearch = page.getByLabel("Search all workspaces");
    await expect(workspaceSearch).toBeVisible();
    const searchedDirectory = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith("/api/referrals/directory") && url.searchParams.get("q") === "San Pablo";
    });
    await workspaceSearch.fill("San Pablo");
    const searchRequest = await searchedDirectory;
    expect(new URL(searchRequest.url()).searchParams.get("workspace")).toBe("all");
    await expect(page.getByRole("button", { name: "All workspaces", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear workspace search" }).click();
    await expect(workspaceSearch).toHaveValue("");

    await page.locator('html[data-pipeline-keyboard-shortcuts-ready="true"]').waitFor({ state: "attached" });
    await page.keyboard.press("/");
    await expect(page.getByLabel("Search or ask")).toBeVisible();
    await expect(page.getByLabel("Search or ask")).toBeFocused();
    await expect(page.getByText("Referral workspaces", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Welcome( back)?, / })).toHaveCount(0);
    await page.getByRole("button", { name: "Open referrals" }).click();
    await expect(page.getByLabel("Search or ask")).toHaveCount(0);
    await expect(page.getByText("Referral workspaces", { exact: true }).last()).toBeVisible();
  });

  test("adds gallery and scoped activity views without replacing the workspace workflow", async ({ page }) => {
    let workspacePageSize = "";
    await page.route(/\/api\/referrals(?:\/directory)?\?/, async (route) => {
      workspacePageSize = new URL(route.request().url()).searchParams.get("limit") ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          referrals: [{
            id: 424242,
            name: "Activity Test Client",
            date: "2026-09-04",
            stage: "Assessment",
            workflowStatus: "assessment_in_progress",
            workspaceStatus: "active",
            community: "San Pablo",
            county: "Los Angeles County",
            source: "County referral",
            priority: "high",
            documentName: "activity-test.pdf",
            documentStatus: "Reviewed",
            ownerId: "assessor-1",
            owner: "Alex Assessor",
            note: "",
            requirements: [],
            createdAt: "2026-09-04T14:00:00.000Z",
            updatedAt: "2026-09-04T15:30:00.000Z",
          }],
          total: 1,
          revision: 1,
          progress: {},
          facets: { communities: [], counties: [], stages: [], owners: [], priorities: [], tags: [], months: [] },
          file_total: 1,
        }),
      });
    });
    await page.reload();

    const listToggle = page.getByRole("button", { name: "Show workspaces as a list" });
    const galleryToggle = page.getByRole("button", { name: "Show workspaces as a gallery" });
    await expect(listToggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "Referral worklist" })).toBeVisible();
    await expect(page.locator('[data-testid="workspace-chart-thumbnail"]:visible')).toBeVisible();
    expect(workspacePageSize).toBe("50");

    await galleryToggle.click();
    await expect(galleryToggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "Workspace gallery" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Referral worklist" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("region", { name: "Workspace gallery" })).toBeVisible();
    await expect(galleryToggle).toHaveAttribute("aria-pressed", "true");

    const activityPayload = {
      generated_at: "2026-09-04T16:00:00.000Z",
      scope: "attention",
      can_view_team: true,
      items: [{
        event_id: "activity-regression-1",
        action: "referral_updated",
        actor_id: "coordinator-1",
        actor_name: "Case Coordinator",
        created_at: "2026-09-04T15:30:00.000Z",
        workspace: {
          referral_id: 424242,
          client_name: "Activity Test Client",
          community: "San Pablo",
          owner_id: "assessor-1",
          owner: "Alex Assessor",
          workflow_status: "assessment_in_progress",
          priority: "high",
          workspace_status: "active",
        },
        attention: { level: "attention", label: "High priority" },
      }],
    };
    await page.route("**/api/operations/activity?**", async (route) => {
      const scope = new URL(route.request().url()).searchParams.get("scope") ?? "attention";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...activityPayload, scope }),
      });
    });

    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    const activity = page.getByRole("region", { name: "Workspace activity" });
    await expect(activity).toBeVisible();
    await expect(activity.getByText("Assignments, schedules, stages, and decisions—never clinical field content.")).toBeVisible();
    await expect(activity.getByRole("tab", { name: /Needs attention/ })).toHaveAttribute("aria-selected", "true");
    await expect(activity.getByRole("tab", { name: /Mine/ })).toBeVisible();
    await expect(activity.getByRole("tab", { name: /Team/ })).toBeVisible();

    const mineRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === "/api/operations/activity" && url.searchParams.get("scope") === "mine";
    });
    await activity.getByRole("tab", { name: /Mine/ }).click();
    await mineRequest;
    await expect(activity.getByRole("tab", { name: /Mine/ })).toHaveAttribute("aria-selected", "true");

    await activity.getByRole("button", { name: /Case Coordinator updated Activity Test Client/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe("424242");
  });

  test("keeps team activity out of the assessor workspace view", async ({ page }) => {
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "assessor-1",
            email: "assessor@pipeline.local",
            name: "Alex Assessor",
            roles: ["reviewer"],
            delegation: null,
            assessorSessionRecoveryRequired: false,
          },
        }),
      });
    });
    await page.reload();
    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    const activity = page.getByRole("region", { name: "Workspace activity" });
    await expect(activity.getByRole("tab", { name: /Needs attention/ })).toBeVisible();
    await expect(activity.getByRole("tab", { name: /Mine/ })).toBeVisible();
    await expect(activity.getByRole("tab", { name: /Team/ })).toHaveCount(0);
  });

  test("keeps only useful filters in the complete workspace directory", async ({ page }) => {
    let requestedMonth = "";
    let requestedCommunity = "";
    let requestedSort = "";
    await page.route(/\/api\/referrals(?:\/directory)?\?/, async (route) => {
      const params = new URL(route.request().url()).searchParams;
      requestedMonth = params.get("month") ?? "";
      requestedCommunity = params.get("community") ?? "";
      requestedSort = params.get("sort") ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          referrals: [],
          total: 0,
          revision: 0,
          progress: {},
          facets: {
            communities: [{ value: "San Pablo", count: 5 }],
            counties: [],
            stages: [],
            owners: [],
            priorities: [],
            tags: [],
            months: [
              { value: "2026-08", count: 4 },
              { value: "2025-11", count: 7 },
            ],
          },
          file_total: 0,
        }),
      });
    });
    await page.reload();

    await expect(page.getByLabel("Filter by workspace month")).toHaveCount(0);
    await expect(page.getByLabel("Filter by tag")).toHaveCount(0);
    await expect(page.getByLabel("Sort workspaces")).toHaveCount(0);
    await expect.poll(() => requestedSort).toBe("updated_desc");

    await page.getByRole("button", { name: /November 2025/ }).click();
    await expect.poll(() => requestedMonth).toBe("2025-11");
    await page.getByLabel("Filter workspaces by community").selectOption("San Pablo");
    await expect.poll(() => requestedCommunity).toBe("San Pablo");
  });

  test("opens a new referral and returns through the Pipeline header", async ({ page }) => {
    await page.getByRole("button", { name: "Create new referral" }).click();
    await expect(page.getByTestId("packet-workspace")).toBeVisible();
    await expect.poll(async () => (await page.getByTestId("packet-workspace").boundingBox())?.width ?? 0).toBeGreaterThan(1200);
    const activePacket = page.getByRole("button", { name: "Create new referral" });
    await expect(activePacket).toHaveAttribute("aria-current", "page");
    await expect(activePacket).toHaveCSS("background-color", "rgb(255, 240, 237)");
    await expect(activePacket).toHaveCSS("border-color", "rgb(200, 91, 77)");
    await expect(activePacket).toHaveCSS("justify-content", "center");
    await expect(activePacket).toHaveCSS("height", "50px");
    await expect(activePacket).toHaveCSS("gap", "10px");
    await expect(activePacket.locator("svg")).toBeVisible();
    const steps = page.getByRole("navigation", { name: "Workspace stages" });
    const savePacket = page.getByRole("button", { name: /^Create referral$/ });
    const [stepsBox, saveBox] = await Promise.all([steps.boundingBox(), savePacket.boundingBox()]);
    expect(stepsBox).not.toBeNull();
    expect(saveBox).not.toBeNull();
    expect(Math.abs(
      ((stepsBox?.y ?? 0) + (stepsBox?.height ?? 0) / 2)
      - ((saveBox?.y ?? 0) + (saveBox?.height ?? 0) / 2),
    )).toBeLessThan(1);
    await expect(page.getByRole("button", { name: "Pipeline home" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect.poll(async () => (await page.getByRole("button", { name: "Open referrals" }).boundingBox())?.width ?? 0).toBeGreaterThan(100);
    await page.getByRole("button", { name: "Pipeline home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: /Welcome( back)?, / })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Search Pipeline" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Since your last visit" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent" })).toHaveCount(0);

    const queueResponse = await page.request.get("/api/operations/my-queue");
    expect(queueResponse.ok()).toBeTruthy();
    const queue = await queueResponse.json() as {
      owner: { name: string };
      total: number;
      items: Array<{ referral_id: number; next_action: string; urgency: string }>;
    };
    expect(queue.owner.name).toBe("Playwright QA");
    expect(queue.total).toBe(queue.items.length);
    expect(queue.items.every((item) => Number.isInteger(item.referral_id))).toBeTruthy();
  });

  test("keeps draft creation explicit and fits intake actions across viewport sizes", async ({ page }, testInfo) => {
    const name = `Intake ${uniqueAlphabeticNameToken()}`;
    await page.getByRole("button", { name: "Create new referral" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
    await page.getByRole("textbox", { name: "DOB", exact: true }).fill("06/12/1984");
    await page.getByRole("combobox", { name: "Community:" }).selectOption("San Pablo");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Contra Costa County");
    await page.getByRole("textbox", { name: "Referent:", exact: true }).fill("Synthetic intake team");
    await page.getByRole("combobox", { name: "Owner (@name):" }).selectOption(testAssessor.id);
    await expect(page.getByRole("button", { name: "Create referral", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Schedule assessment", exact: true })).toHaveCount(0);
    await page.waitForTimeout(2_000);
    expect(new URL(page.url()).searchParams.get("referralId")).toBeNull();

    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const action = page.getByRole("button", { name: "Create referral", exact: true });
      await expect(action).toBeVisible();
      const bounds = await action.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const conserved = page.getByRole("group", { name: "Conserved", exact: true });
      const controlBounds = await conserved.boundingBox();
      for (const option of ["yes", "no"]) {
        const optionBounds = await conserved.getByRole("button", { name: option, exact: true }).boundingBox();
        expect(optionBounds).not.toBeNull();
        expect(optionBounds!.x).toBeGreaterThanOrEqual(controlBounds!.x);
        expect(optionBounds!.x + optionBounds!.width).toBeLessThanOrEqual(controlBounds!.x + controlBounds!.width);
      }
      await page.screenshot({ path: testInfo.outputPath(`intake-draft-${width}.png`), fullPage: true });
    }
    await page.getByRole("button", { name: "Create referral", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
    await expect(page.getByTestId("workspace-save-status")).toContainText("Saved");
    await expect(page.getByRole("button", { name: "Create referral", exact: true })).toHaveCount(0);
    await page.getByRole("complementary", { name: "Intake progress" }).getByRole("button", { name: "Schedule assessment", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Schedule assessment", exact: true })).toBeVisible();
  });

  test("retries failed intake autosaves without losing edits made during saving", async ({ page }) => {
    const name = `Autosave ${uniqueAlphabeticNameToken()}`;
    await page.getByRole("button", { name: "Create new referral" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
    await page.getByRole("combobox", { name: "Community:" }).selectOption("San Pablo");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Contra Costa County");
    await page.getByRole("button", { name: "Create referral", exact: true }).click();
    await expect(page.getByTestId("workspace-save-status")).toContainText("Saved");
    const referralId = new URL(page.url()).searchParams.get("referralId");
    let attempts = 0;
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    await page.route(`**/api/referrals/${referralId}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      attempts += 1;
      if (attempts === 1) return route.fulfill({ status: 503, json: { error: "Synthetic save unavailable" } });
      if (attempts === 2) await saveGate;
      await route.continue();
    });
    const editedName = `${uniqueAlphabeticNameToken()} Revised`;
    const latestName = `${uniqueAlphabeticNameToken()} Latest`;
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(editedName);
    await expect(page.getByTestId("workspace-save-status").getByRole("alert")).toContainText("Synthetic save unavailable");
    await page.waitForTimeout(2_000);
    expect(attempts).toBe(1);
    await page.getByRole("button", { name: "Retry saving", exact: true }).click();
    await expect.poll(() => attempts).toBe(2);
    try {
      await expect(page.getByTestId("workspace-save-status")).toContainText("Saving changes");
      await page.getByRole("textbox", { name: "NAME", exact: true }).fill(latestName);
    } finally {
      releaseSave();
    }
    await expect.poll(async () => {
      const response = await page.request.get(`/api/referrals/${referralId}`);
      return ((await response.json()) as { referral: { name: string } }).referral.name;
    }).toBe(latestName);
    await expect(page.getByTestId("workspace-save-status")).toContainText("Saved");
    await expect(page.getByRole("button", { name: "Retry saving", exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(latestName);
  });

  test("creates a durable shell before its initial document and recalls the saved referral chart", async ({ page }) => {
    const clientName = `Referral ${uniqueAlphabeticNameToken()}`;
    await page.getByRole("button", { name: "Create new referral" }).click();

    await expect(page.getByRole("region", { name: "Intake", exact: true })).toBeVisible();
    const documentChecklist = page.getByRole("region", { name: "Document checklist" });
    await expect(documentChecklist).toBeVisible();
    const documentPanel = page.getByTestId("document-checklist-panel");
    const documentToggle = page.getByTestId("document-checklist-toggle");
    await expect(documentPanel).not.toHaveAttribute("open", "");
    await expect(page.getByRole("region", { name: "Initial referral packet" })).toHaveCount(0);
    await expect(documentChecklist.getByRole("button", { name: /drop document or browse$/ })).toHaveCount(0);
    await documentToggle.click();
    await expect(documentPanel).toHaveAttribute("open", "");
    await expect(page.getByRole("region", { name: "Initial referral packet" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Identity chart section" })).toBeVisible();
    await expect(documentChecklist.getByRole("button", { name: /drop document or browse$/ })).toHaveCount(8);
    await expect(page.getByRole("complementary", { name: "Intake progress" })).toBeVisible();
    const documentChecklistBox = await documentChecklist.boundingBox();
    const identityBox = await page.getByRole("region", { name: "Identity chart section" }).boundingBox();
    expect(documentChecklistBox).not.toBeNull();
    expect(identityBox).not.toBeNull();
    expect((documentChecklistBox?.y ?? 0) + (documentChecklistBox?.height ?? 0)).toBeLessThanOrEqual(identityBox?.y ?? 0);
    await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(clientName);
    await page.getByRole("textbox", { name: "DOB", exact: true }).fill("06/12/1984");
    await page.getByRole("combobox", { name: "Community:" }).selectOption("San Pablo");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Contra Costa County");
    await page.getByRole("textbox", { name: "Referent:", exact: true }).fill("San Pablo intake team");
    await page.getByRole("combobox", { name: "Owner (@name):" }).selectOption(testAssessor.id);
    await page.getByRole("button", { name: "Create referral", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
    await expect(page.getByRole("button", { name: "Create referral", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save workspace", exact: true })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Intake progress" }).getByRole("button", { name: "Schedule assessment" })).toBeVisible();
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true }).fill("Referral chart created from the initial document.");
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    const referralId = new URL(page.url()).searchParams.get("referralId");
    expect(referralId).not.toBeNull();
    const shellResponse = await page.request.get(`/api/referrals/${referralId}`);
    expect(shellResponse.ok()).toBeTruthy();
    expect(await shellResponse.json()).toMatchObject({ referral: { documentStatus: "Missing" } });
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "required-face-sheet.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(`required-face-sheet-${randomUUID()}`),
    });
    await expect(page.getByText("Packet uploaded and ready for review", { exact: true })).toBeVisible();

    const response = await page.request.get(`/api/referrals/${referralId}`);
    expect(response.ok()).toBeTruthy();
    const payload = await response.json() as {
      referral: { id: number; name: string; documentStatus: string; tags?: string[]; note: string };
    };
    expect(payload.referral).toMatchObject({
      id: Number(referralId),
      documentStatus: "Uploaded",
      note: "## Reason for referral\nReferral chart created from the initial document.",
    });
    expect(payload.referral.tags).toEqual(expect.arrayContaining(["packet-import", "needs-review"]));

    await page.reload();
    if (await documentPanel.getAttribute("open") === null) await documentToggle.click();
    await expect(documentPanel).toHaveAttribute("open", "");
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(payload.referral.name);
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true })).toHaveValue("Referral chart created from the initial document.");
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(page.getByRole("button", { name: "Signed Medication List: drop document or browse" })).toBeVisible();
  });

  test("starts a clean intake every time New referral is explicitly opened", async ({ page }) => {
    const existingName = `Existing ${randomUUID().slice(0, 8)}`;
    const createdResponse = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `new-intake-reset-${randomUUID()}`,
        assignee_id: testAssessor.id,
        referral: {
          name: existingName,
          date: "2026-08-26",
          stage: "New",
          community: "San Pablo",
          source: "New intake reset test",
          priority: "standard",
          tags: [],
          documentName: "",
          documentStatus: "Missing",
          owner: testAssessor.name,
          note: "",
          createdAt: new Date().toISOString(),
          dob: "",
          phone: "",
          email: "",
          payer: "",
          requirements: [],
        },
      },
    });
    expect(createdResponse.ok()).toBeTruthy();
    const created = await createdResponse.json() as { referral: { id: number; name: string } };

    await page.goto(`/?view=referrals&screen=packet&referralId=${created.referral.id}`);
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(created.referral.name);

    await page.getByRole("button", { name: "Create new referral", exact: true }).click();
    await expect(page).toHaveURL(/screen=packet.*draftId=/);
    expect(new URL(page.url()).searchParams.get("referralId")).toBeNull();
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("");

    await page.getByRole("textbox", { name: "NAME", exact: true }).fill("Abandoned unsaved intake");
    await page.waitForTimeout(500);
    const firstDraftId = new URL(page.url()).searchParams.get("draftId");
    await page.getByRole("button", { name: "Open client profiles", exact: true }).click();
    await page.getByRole("button", { name: "Create new referral", exact: true }).click();
    const secondDraftId = new URL(page.url()).searchParams.get("draftId");
    expect(secondDraftId).toBeTruthy();
    expect(secondDraftId).not.toBe(firstDraftId);
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("");
  });

  test("keeps work surfaces anchored while navigating and compacts referral facets on mobile", async ({ page }) => {
    const header = page.locator("header");
    await expect(header).toHaveCSS("height", "82px");
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    const expectedSurfaceTop = headerBox!.y + headerBox!.height;

    const referralMain = page.getByRole("main", { name: "Referral workspaces" });
    const referralMainBox = await referralMain.boundingBox();
    expect(referralMainBox?.y).toBe(expectedSurfaceTop);

    await page.getByRole("button", { name: "Open client profiles" }).click();
    const profilesMain = page.getByRole("main", { name: "Client profiles" });
    await expect(profilesMain).toBeVisible();
    expect((await profilesMain.boundingBox())?.y).toBe(expectedSurfaceTop);

    await page.getByRole("button", { name: "Create new referral" }).click();
    const packetSteps = page.getByRole("navigation", { name: "Workspace stages" });
    const savePacket = page.getByRole("button", { name: /^Create referral$/ });
    const firstPacketPage = page.getByRole("region", { name: "Intake", exact: true });
    const [stepsBox, saveBox, firstPageBox] = await Promise.all([
      packetSteps.boundingBox(),
      savePacket.boundingBox(),
      firstPacketPage.boundingBox(),
    ]);
    expect(Math.abs(
      ((stepsBox?.y ?? 0) + (stepsBox?.height ?? 0) / 2)
      - ((saveBox?.y ?? 0) + (saveBox?.height ?? 0) / 2),
    )).toBeLessThan(1);

    await page.getByRole("button", { name: "Workspace files" }).click();
    const secondPageBox = await page.getByRole("region", { name: "Files", exact: true }).boundingBox();
    expect(Math.abs((firstPageBox?.y ?? 0) - (secondPageBox?.y ?? 0))).toBeLessThan(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?view=referrals");
    await page.waitForLoadState("networkidle");
    const mobileAside = page.getByRole("complementary");
    const mobileDirectory = page.getByRole("main", { name: "Referral workspaces" });
    await expect(mobileDirectory).toBeVisible();
    expect((await mobileAside.boundingBox())?.height ?? 999).toBeLessThan(110);
    expect((await mobileDirectory.boundingBox())?.y ?? 999).toBeLessThan(330);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("keeps rapid header navigation deterministic", async ({ page }) => {
    const destinations = [
      { name: "Open client profiles", parameter: "screen", value: "profiles", landmark: "Client profiles" },
      { name: "Create new referral", parameter: "screen", value: "packet", landmark: "Workspace stages" },
      { name: "Open referrals", parameter: "view", value: "referrals", landmark: "Referral workspaces" },
    ] as const;

    for (let pass = 0; pass < 3; pass += 1) {
      for (const destination of destinations) {
        await page.getByRole("button", { name: destination.name }).click();
        await expect.poll(() => new URL(page.url()).searchParams.get(destination.parameter)).toBe(destination.value);
        if (destination.value === "profiles") {
          await expect(page.getByRole("main", { name: destination.landmark })).toBeVisible();
        } else if (destination.value === "packet") {
          await expect(page.getByRole("navigation", { name: destination.landmark })).toBeVisible();
        } else {
          await expect(page.getByRole("main", { name: destination.landmark })).toBeVisible();
        }
      }
    }

    await page.keyboard.press("/");
    await expect(page.getByLabel("Search or ask")).toBeVisible();
    await page.getByRole("button", { name: "Open client profiles" }).click();
    await expect(page.getByLabel("Search or ask")).toHaveCount(0);
    await expect(page.getByRole("main", { name: "Client profiles" })).toBeVisible();
  });

  test("keeps assignment history out of the calendar and schedules from the ready queue", async ({ page }) => {
    let schedulePayload: Record<string, unknown> | null = null;
    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return;
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    });
    await page.route("**/api/assessments/calendar-ready/schedule", async (route) => {
      schedulePayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assessment: { assessment_id: "calendar-ready", version: 5 } }),
      });
    });
    await page.route("**/api/assessments/calendar-ready", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          assessment: {
            assessment_id: "calendar-ready",
            referral_id: 303,
            version: 4,
            schedule_status: "unscheduled",
          },
        }),
      });
    });
    await page.route("**/api/calendar/events**", async (route) => {
      const requestUrl = new URL(route.request().url());
      expect(requestUrl.searchParams.get("include_assignments")).toBe("false");
      const from = requestUrl.searchParams.get("from") ?? new Date().toISOString().slice(0, 8) + "01";
      const to = requestUrl.searchParams.get("to") ?? from;
      const eventDate = from;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          from,
          to,
          events: [{
            id: "referral-assigned:302:1",
            referralId: 302,
            clientName: "Assigned Client",
            community: "Turlock",
            ownerId: "playwright-user",
            owner: "Playwright QA",
            date: eventDate,
            createdDate: from,
            receivedDate: from,
            assignedAt: `${eventDate}T15:00:00.000Z`,
            kind: "referral_assigned",
            status: "assigned",
            title: "Referral assigned",
            detail: "Assigned referral",
          }, {
            id: "assessment:calendar-fixture",
            referralId: 301,
            assessmentId: "calendar-fixture",
            clientName: "Scheduled Client",
            community: "San Pablo",
            ownerId: "playwright-user",
            owner: "Playwright QA",
            date: eventDate,
            startsAt: `${eventDate}T16:00:00.000Z`,
            durationMinutes: 60,
            method: "in_person",
            scheduleStatus: "scheduled",
            kind: "assessment",
            status: "draft",
            title: "Assessment scheduled",
            detail: "Scheduled assessment",
          }],
          unscheduled: [{
            referralId: 303,
            assessmentId: "calendar-ready",
            assessmentVersion: 4,
            clientName: "Ready Client",
            community: "Victoria's Place",
            ownerId: "playwright-user",
            owner: "Playwright QA",
            receivedDate: from,
            workflowStatus: "ready_to_schedule",
            nextAction: "schedule",
          }],
          unscheduledTotal: 1,
          unscheduledHasMore: false,
          assessors: [{ id: "playwright-user", name: "Playwright QA" }],
          scope: "team",
          viewer: { id: "playwright-user", name: "Playwright QA" },
          timezone: "America/Los_Angeles",
          generated_at: new Date().toISOString(),
        }),
      });
    });

    await page.goto("/?screen=calendar");
    await expect(page.getByText("Team schedule", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Supervisor team week" })).toBeVisible();
    await expect(page.locator('button[title^="Scheduled Client - Assessment scheduled"]')).toHaveClass(/bg-\[#eef1ff\]/);
    await expect(page.getByText("Assigned Client", { exact: true })).toHaveCount(0);

    await page.getByRole("combobox", { name: "Filter calendar by assessor" }).selectOption({ label: "Playwright QA" });
    await expect(page.getByRole("region", { name: "Timed assessment week" })).toBeVisible();
    await expect(page.getByText("Scheduled Client", { exact: true }).first()).toBeVisible();
    await expect(page.locator('button[title^="Scheduled Client - Assessment scheduled"]')).toHaveClass(/bg-\[#eef1ff\]/);
    await expect(page.getByRole("combobox", { name: "Filter calendar by event type" })).not.toContainText("Referral assignments");
    await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Focus search" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create new referral" })).toBeVisible();

    await page.getByRole("button", { name: /Scheduling queue\s+1/ }).click();
    const queueDialog = page.getByRole("dialog", { name: "Scheduling queue" });
    await expect(queueDialog).toContainText("Ready Client");
    await queueDialog.getByRole("button", { name: "Schedule", exact: true }).click();
    const scheduleDialog = page.getByRole("dialog").filter({ hasText: "Ready Client" });
    await expect(scheduleDialog).toBeVisible();
    await scheduleDialog.getByLabel("Method").selectOption("zoom");
    await scheduleDialog.getByLabel("Zoom link").fill("https://zoom.us/j/calendar-fixture");
    await scheduleDialog.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(scheduleDialog).toHaveCount(0);
    expect(schedulePayload).toMatchObject({
      if_match: 4,
      allow_conflict: false,
      schedule: {
        status: "scheduled",
        duration_minutes: 60,
        method: "zoom",
        location: "https://zoom.us/j/calendar-fixture",
      },
    });

    await page.setViewportSize({ width: 768, height: 1024 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBeTruthy();
    await expect(page.getByRole("button", { name: "agenda", exact: true })).toHaveAttribute("aria-pressed", "true");

    await page.setViewportSize({ width: 430, height: 932 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBeTruthy();
    await expect(page.getByRole("button", { name: "agenda", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Assigned Client", { exact: true })).toHaveCount(0);
    await expect(page.locator("button:visible").filter({ hasText: "Scheduled Client" }).first()).toBeVisible();
  });

  test("rejects overlapping assessor appointments until a supervisor explicitly overrides", async ({ page }) => {
    const conflictStartAt = new Date(
      Date.UTC(2090, 0, 1) + Number.parseInt(randomUUID().slice(0, 8), 16) * 120_000,
    ).toISOString();
    const referralIds: number[] = [];
    for (const suffix of ["A", "B"]) {
      const created = await page.request.post("/api/referrals", {
        data: {
          client_mutation_id: `calendar-conflict-referral-${suffix}-${randomUUID()}`,
          assignee_id: testAssessor.id,
          referral: {
            name: `Calendar Conflict ${suffix} ${randomUUID().slice(0, 6)}`,
            date: "2031-02-01",
            stage: "New",
            community: "San Pablo",
            source: "Calendar conflict test",
            priority: "standard",
            tags: ["calendar-conflict-test"],
            documentName: "calendar-conflict-packet.pdf",
            documentStatus: "Reviewed",
            packetStatus: "reviewed",
            owner: testAssessor.name,
            note: "",
            createdAt: new Date().toISOString(),
            dob: "1990-01-01",
            phone: "5550001212",
            email: "",
            payer: "",
            requirements: [],
          },
        },
      });
      const createdPayload = await created.json() as { referral: { id: number }; error?: string };
      expect(created.status(), JSON.stringify(createdPayload)).toBe(201);
      referralIds.push(createdPayload.referral.id);
    }

    const assessments: Array<{ assessment_id: string; version: number }> = [];
    for (const referralId of referralIds) {
      const created = await page.request.post(`/api/referrals/${referralId}/assessments`, {
        data: { data: {}, client_mutation_id: `calendar-conflict-assessment-${randomUUID()}` },
      });
      const createdPayload = await created.json() as { assessment: { assessment_id: string; version: number }; error?: string };
      expect(created.status(), JSON.stringify(createdPayload)).toBe(201);
      assessments.push(createdPayload.assessment);
    }

    const schedule = {
      status: "scheduled",
      start_at: conflictStartAt,
      duration_minutes: 60,
      method: "zoom",
      location: "https://zoom.us/j/conflict-fixture",
    };
    const first = await page.request.post(`/api/assessments/${assessments[0].assessment_id}/schedule`, {
      data: {
        if_match: assessments[0].version,
        client_mutation_id: `calendar-conflict-first-${randomUUID()}`,
        schedule,
      },
    });
    expect(first.status(), await first.text()).toBe(200);

    const blocked = await page.request.post(`/api/assessments/${assessments[1].assessment_id}/schedule`, {
      data: {
        if_match: assessments[1].version,
        client_mutation_id: `calendar-conflict-blocked-${randomUUID()}`,
        schedule,
      },
    });
    expect(blocked.status()).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({
      code: "assessment_schedule_conflict",
      can_override: true,
      conflicts: [expect.objectContaining({ assessment_id: assessments[0].assessment_id })],
    });

    const overridden = await page.request.post(`/api/assessments/${assessments[1].assessment_id}/schedule`, {
      data: {
        if_match: assessments[1].version,
        client_mutation_id: `calendar-conflict-override-${randomUUID()}`,
        allow_conflict: true,
        schedule,
      },
    });
    expect(overridden.status(), await overridden.text()).toBe(200);
  });

  test("deduplicates startup identity and retries a transient referral read", async ({ page }) => {
    let identityRequests = 0;
    await page.route("**/api/auth/me", async (route) => {
      identityRequests += 1;
      await route.continue();
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();
    expect(identityRequests).toBe(1);

    let referralRequests = 0;
    await page.route(/\/api\/referrals\/directory\?/, async (route) => {
      referralRequests += 1;
      if (referralRequests === 1) {
        await route.fulfill({ status: 503, contentType: "text/plain", body: "gateway unavailable" });
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: "Open referrals" }).click();
    await expect(page.getByRole("main", { name: "Referral workspaces" })).toBeVisible();
    await expect.poll(() => referralRequests).toBeGreaterThanOrEqual(2);
    await expect(page.getByText("Pipeline returned an unreadable response.", { exact: true })).toHaveCount(0);
  });

  test("keeps the last successful referral snapshot when refresh fails", async ({ page }) => {
    const name = `Recovery Qa${randomUUID().slice(0, 8)}`;
    const created = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `refresh-recovery-${randomUUID()}`,
        assignee_id: testAssessor.id,
        referral: {
          name,
          date: "2026-08-10",
          stage: "New",
          community: "San Pablo",
          source: "Refresh recovery test",
          priority: "standard",
          tags: ["refresh-recovery"],
          documentName: "",
          documentStatus: "Missing",
          owner: testAssessor.name,
          note: "",
          createdAt: new Date().toISOString(),
          dob: "",
          phone: "",
          email: "",
          payer: "",
          requirements: [],
        },
      },
    });
    expect(created.status()).toBe(201);
    const createdPayload = await created.json() as { referral: { name: string } };
    await page.goto("/?view=referrals");
    const workspaces = page.getByRole("region", { name: "Referral worklist" });
    const createdWorkspace = workspaces.getByRole("button", { name: `Open ${createdPayload.referral.name} referral workspace` });
    await expect(createdWorkspace).toBeVisible();

    let failedRefreshRequests = 0;
    await page.route(/\/api\/referrals\/changes\?/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ changed: true, sequence: 2 }),
      });
    });
    await page.route(/\/api\/referrals\/directory\?/, async (route) => {
      failedRefreshRequests += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Referral refresh unavailable." }),
      });
    });

    // Let the short-lived successful GET cache expire so this exercises the
    // network failure path rather than returning the cached directory.
    await page.waitForTimeout(3_100);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => failedRefreshRequests).toBeGreaterThanOrEqual(2);
    await expect(page.getByText("Referral refresh unavailable.", { exact: true })).toBeVisible();
    await expect(createdWorkspace).toBeVisible();
  });

  test("browses all uploaded files without duplicate month navigation", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^All files/ })).toBeVisible();
    await expect(page.getByLabel("Filter by workspace month")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "June 2026", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /^All files/ }).click();
    await expect(page.getByLabel("Filter files by category")).toBeVisible();
  });

  test("keeps file-preview controls above the application header", async ({ page }) => {
    const fileName = "Historical assessment.pdf";
    await page.route(/\/api\/files\?/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          files: [{
            id: "historical-file-1",
            name: fileName,
            category: "Assessment",
            referralId: 1,
            clientId: "historical-client-1",
            canonicalClientId: "pipeline:historical-client-1",
            referralName: "Historical Client",
            community: "San Pablo",
            uploadedAt: "2026-08-10T12:00:00.000Z",
            sizeBytes: 2048,
            status: "Reviewed",
            contentType: "application/pdf",
            previewStatus: "ready",
            pageCount: 1,
            previewUrl: "/api/files/historical-file-1/preview",
            downloadUrl: "/api/files/historical-file-1/download",
            sourceSystem: "allo",
            identityStatus: "linked",
          }],
          total: 1,
          next_cursor: null,
        }),
      });
    });
    await page.route(/\/api\/files\/historical-file-1\?/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          file: {
            document_id: "historical-file-1",
            file_name: fileName,
            category: "assessment",
            content_type: "application/pdf",
            byte_size: 2048,
            processing_status: "ready",
            preview_status: "ready",
            malware_scan_status: "clean",
            page_count: 1,
            uploaded_at: "2026-08-10T12:00:00.000Z",
            updated_at: "2026-08-10T12:00:00.000Z",
            pages: [],
            pagination: {
              after_page: 0,
              limit: 24,
              returned: 0,
              has_more: false,
              first_page: null,
              last_page: null,
            },
          },
        }),
      });
    });

    await page.goto("/?view=referrals");
    await page.getByRole("button", { name: /^All files/ }).click();
    await page.getByRole("button", { name: new RegExp(fileName) }).click();

    const preview = page.getByRole("dialog", { name: `Preview ${fileName}` });
    await expect(preview).toBeVisible();
    await preview.getByRole("button", { name: "Close preview" }).click();
    await expect(preview).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Profile settings" })).toHaveCount(0);
  });

  test("opens imported history as a read-only workspace with source files intact", async ({ page }) => {
    const historicalReferral: Referral = {
      id: 919191,
      version: 4,
      clientId: "historical-client-919191",
      workspaceOrigin: "allo",
      workspaceStatus: "historical",
      sourceWorkspaceId: "allo-history-919191",
      sourceWorkspaceName: "Historical source workspace",
      sourceProjectName: "June 2024 admissions",
      sourceMaterialCount: 1,
      name: "Morgan Historical",
      date: "2024-06-10",
      stage: "Accepted / Admitted",
      workflowStatus: "accepted",
      community: "San Pablo",
      source: "Allo workspace import",
      priority: "standard",
      tags: ["allo-import", "historical"],
      documentName: "Historical face sheet.pdf",
      documentStatus: "Reviewed",
      owner: "Source Assessor",
      note: "Imported source history.",
      createdAt: "2024-06-10T12:00:00.000Z",
      updatedAt: "2024-06-10T12:00:00.000Z",
      dob: "1980-01-02",
      gender: "Female",
      phone: "",
      email: "",
      payer: "",
      admissionDate: "2024-06-15",
      requirements: [],
    };
    const historicalProfile = {
      mode: "historical_profile",
      referralId: historicalReferral.id,
      generatedAt: "2026-09-07T12:00:00.000Z",
      readOnly: true,
      assessmentCreated: false,
      sources: [],
      facts: [],
      documents: [{
        documentId: "historical-document-919191",
        name: historicalReferral.documentName,
        category: "face_sheet",
        contentType: "application/pdf",
        sizeBytes: 2048,
        pageCount: 1,
        uploadedAt: "2024-06-10T12:00:00.000Z",
        status: "uploaded",
        previewStatus: "ready",
        sourceSystem: "allo",
      }],
      sections: [],
      unmappedEvidence: [],
      sourceSections: [],
      coverage: {
        sourceCount: 0,
        sourceBlockCount: 0,
        displayedSourceBlockCount: 0,
        factCount: 0,
        documentCount: 1,
        candidateCount: 0,
        passageCount: 0,
        mappedPassageCount: 0,
        unmappedPassageCount: 0,
        displayedMappedCount: 0,
        displayedUnmappedCount: 0,
      },
      message: null,
    };

    await page.route(`**/api/referrals/${historicalReferral.id}/canvas`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ referral: historicalReferral }) });
    });
    await page.route(`**/api/referrals/${historicalReferral.id}/historical-profile`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(historicalProfile) });
    });
    await page.route(`**/api/referrals/${historicalReferral.id}/assessments`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assessments: [], total: 0 }) });
    });
    await page.route(`**/api/referrals/${historicalReferral.id}/changes**`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ changed: false, sequence: 4, presence: [] }) });
    });
    let presenceWrites = 0;
    await page.route(`**/api/referrals/${historicalReferral.id}/presence`, async (route) => {
      presenceWrites += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.goto(`/?view=referrals&screen=packet&referralId=${historicalReferral.id}&workspaceStage=assessment`);
    await expect(page.getByText("Historical · Read-only", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/closed historical workspace/i)).toHaveCount(0);
    await expect(page.getByTestId("workspace-identity-title")).toHaveText("Morgan Historical");
    await expect(page.getByText("Client workspace", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Assessment", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Chart", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save workspace" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Move workspace to trash" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Workspace files" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Workspace activity" })).toBeVisible();
    await expect(page.getByText("Historical face sheet.pdf", { exact: true })).toBeVisible();
    expect(presenceWrites).toBe(0);
  });

  test("filters and counts referrals on the server with bounded queries", async ({ page }) => {
    const filtered = await page.request.get("/api/referrals?community=San%20Pablo&limit=10");
    expect(filtered.ok()).toBeTruthy();
    const filteredPayload = await filtered.json() as { referrals: Array<{ community: string }>; total: number };
    expect(filteredPayload.referrals.every((referral) => referral.community === "San Pablo")).toBeTruthy();
    expect(filteredPayload.total).toBeGreaterThanOrEqual(filteredPayload.referrals.length);

    const facets = await page.request.get("/api/referrals/facets");
    expect(facets.ok()).toBeTruthy();
    await expect(facets.json()).resolves.toMatchObject({
      facets: {
        communities: expect.any(Array),
        stages: expect.any(Array),
        owners: expect.any(Array),
        tags: expect.any(Array),
        months: expect.any(Array),
      },
    });

    expect((await page.request.get("/api/referrals?stage=not-a-stage")).status()).toBe(400);
    expect((await page.request.get("/api/referrals?queue=not-a-queue")).status()).toBe(400);
    expect((await page.request.get("/api/referrals?queue=my_work&limit=10")).ok()).toBeTruthy();
    const worklistResponse = await page.request.get("/api/operations/referral-worklist");
    expect(worklistResponse.ok()).toBeTruthy();
    const worklist = await worklistResponse.json() as {
      total: number;
      counts: Record<string, number>;
      items: Array<Record<string, unknown>>;
    };
    expect(worklist).toMatchObject({
      total: expect.any(Number),
      counts: {
        all_actionable: expect.any(Number),
        unassigned: expect.any(Number),
        packet_review: expect.any(Number),
        assessment_due: expect.any(Number),
        missing_documents: expect.any(Number),
        blocked: expect.any(Number),
      },
      items: expect.any(Array),
    });
    if (worklist.items[0]) {
      expect(worklist.items[0]).toMatchObject({
        next_action: expect.any(String),
        blockers: expect.any(Array),
        missing_data: expect.any(Array),
        owner: expect.any(String),
        last_activity_at: expect.any(String),
        completion_pct: expect.any(Number),
      });
      expect(worklist.items[0].due_at === null || typeof worklist.items[0].due_at === "string").toBeTruthy();
    }
    const firstReferralResponse = await page.request.get("/api/referrals?limit=1");
    expect(firstReferralResponse.ok()).toBeTruthy();
    const firstReferral = await firstReferralResponse.json() as { referrals: Array<{ id: number }> };
    if (firstReferral.referrals[0]) {
      const activityResponse = await page.request.get(`/api/referrals/${firstReferral.referrals[0].id}/activity`);
      expect(activityResponse.ok()).toBeTruthy();
      const activity = await activityResponse.json() as Record<string, unknown>;
      expect(activity).toMatchObject({
        events: expect.any(Array),
        metadata: {
          contributors: expect.any(Array),
          assessment: {
            status: expect.stringMatching(/^(not_started|draft|needs_review|complete)$/),
            completed_count: expect.any(Number),
          },
          timing: {
            total_minutes: expect.any(Number),
            decision_recorded: expect.any(Boolean),
          },
        },
      });
    }
    expect((await page.request.get("/api/referrals?cursor=-1")).status()).toBe(400);
    expect((await page.request.get("/api/files?limit=500")).status()).toBe(400);
  });

  test("pages without duplicates and rejects a competing stale save", async ({ page }) => {
    const group = `Cursor ${uniqueAlphabeticNameToken()}`;
    const created: Array<{ id: number; version: number }> = [];
    for (let index = 0; index < 3; index += 1) {
      const now = new Date(Date.now() + index).toISOString();
      const response = await page.request.post("/api/referrals", {
        data: {
          client_mutation_id: `cursor-${randomUUID()}`,
          assignee_id: testAssessor.id,
          referral: {
            name: `${group} ${index + 1}`,
            date: now.slice(0, 10),
            stage: "New",
            community: "San Pablo",
            source: "Scale test",
            priority: "standard",
            tags: ["cursor-test"],
            documentName: "",
            documentStatus: "Missing",
            owner: testAssessor.name,
            note: "",
            createdAt: now,
            dob: "",
            phone: "",
            email: "",
            payer: "",
            requirements: [],
          },
        },
      });
      expect(response.status()).toBe(201);
      const payload = await response.json() as { referral: { id: number; version: number } };
      created.push(payload.referral);
    }

    const first = await page.request.get(`/api/referrals?q=${encodeURIComponent(group)}&limit=2`);
    const firstPage = await first.json() as { referrals: Array<{ id: number }>; total: number; next_cursor?: string };
    expect(firstPage.total).toBe(3);
    expect(firstPage.referrals).toHaveLength(2);
    expect(firstPage.next_cursor).toBeTruthy();
    const second = await page.request.get(`/api/referrals?q=${encodeURIComponent(group)}&limit=2&cursor=${encodeURIComponent(firstPage.next_cursor!)}`);
    const secondPage = await second.json() as { referrals: Array<{ id: number }>; total: number };
    expect(secondPage.total).toBe(3);
    expect(secondPage.referrals).toHaveLength(1);
    expect(new Set([...firstPage.referrals, ...secondPage.referrals].map((item) => item.id)).size).toBe(3);

    const groupTokens = group.split(" ");
    const unordered = await page.request.get(
      `/api/referrals?q=${encodeURIComponent(`Pablo ${groupTokens[1]} Cursor San`)}&limit=10`,
    );
    const unorderedPayload = await unordered.json() as { referrals: Array<{ id: number }>; total: number };
    expect(unorderedPayload.total).toBe(3);
    expect(new Set(unorderedPayload.referrals.map((item) => item.id))).toEqual(new Set(created.map((item) => item.id)));

    const target = created[0];
    const [left, right] = await Promise.all([
      page.request.patch(`/api/referrals/${target.id}`, { data: { if_match: target.version, patch: { note: "First concurrent edit" } } }),
      page.request.patch(`/api/referrals/${target.id}`, { data: { if_match: target.version, patch: { note: "Second concurrent edit" } } }),
    ]);
    expect([left.status(), right.status()].sort((a, b) => a - b)).toEqual([200, 409]);
  });

  test("coordinates section edits, presence leases, and remote conflicts across two sessions", async ({ browser, page }) => {
    await page.goto("/");
    const origin = new URL(page.url()).origin;
    const secondContext = await browser.newContext({ baseURL: origin });
    const secondPage = await secondContext.newPage();
    const suffix = uniqueAlphabeticNameToken();
    const name = `Collaboration ${suffix}`;
    const firstEditedName = `${suffix} Alpha`;
    const currentName = `${suffix} Current`;
    try {
      const createdResponse = await page.request.post("/api/referrals", {
        data: {
          client_mutation_id: `collaboration-${randomUUID()}`,
          assignee_id: testAssessor.id,
          referral: {
            name,
            date: "2026-08-09",
            stage: "New",
            community: "San Pablo",
            source: "Concurrency test",
            priority: "standard",
            tags: ["collaboration"],
            documentName: "",
            documentStatus: "Missing",
            owner: testAssessor.name,
            note: "Initial note",
            createdAt: new Date().toISOString(),
            dob: "",
            phone: "",
            email: "",
            payer: "",
            requirements: [],
          },
        },
      });
      const created = await createdResponse.json() as {
        referral: { id: number; version: number; sectionVersions: Record<string, number> };
      };
      const base = created.referral;
      const [identityEdit, intakeEdit] = await Promise.all([
        page.request.patch(`/api/referrals/${base.id}`, {
          data: {
            if_match: base.version,
            if_match_sections: base.sectionVersions,
            patch: { name: firstEditedName },
          },
        }),
        secondPage.request.patch(`/api/referrals/${base.id}`, {
          data: {
            if_match: base.version,
            if_match_sections: base.sectionVersions,
            patch: { note: "Updated in the second session" },
          },
        }),
      ]);
      expect(identityEdit.ok()).toBeTruthy();
      expect(intakeEdit.ok()).toBeTruthy();

      const mergedResponse = await page.request.get(`/api/referrals/${base.id}`);
      const merged = await mergedResponse.json() as {
        referral: { version: number; name: string; note: string; sectionVersions: Record<string, number> };
      };
      expect(merged.referral).toMatchObject({ name: firstEditedName, note: "Updated in the second session" });

      const sameSectionBase = merged.referral;
      const firstIdentity = await page.request.patch(`/api/referrals/${base.id}`, {
        data: {
          if_match: sameSectionBase.version,
          if_match_sections: sameSectionBase.sectionVersions,
          patch: { name: currentName },
        },
      });
      expect(firstIdentity.ok()).toBeTruthy();
      const competingIdentity = await secondPage.request.patch(`/api/referrals/${base.id}`, {
        data: {
          if_match: sameSectionBase.version,
          if_match_sections: sameSectionBase.sectionVersions,
          patch: { dob: "1950-01-01" },
        },
      });
      expect(competingIdentity.status()).toBe(409);
      await expect(competingIdentity.json()).resolves.toMatchObject({
        conflict: true,
        conflicting_sections: ["identity"],
      });

      const changes = await page.request.get(`/api/referrals/${base.id}/changes?after=${base.version}`);
      await expect(changes.json()).resolves.toMatchObject({ changed: true, sequence: expect.any(Number) });

      const firstLease = randomUUID();
      const secondLease = randomUUID();
      const presenceUrl = `/api/referrals/${base.id}/presence`;
      expect((await page.request.post(presenceUrl, { data: { lease_id: firstLease, section: "intake" } })).ok()).toBeTruthy();
      expect((await secondPage.request.post(presenceUrl, { data: { lease_id: secondLease, section: "assessment" } })).ok()).toBeTruthy();
      const presence = await page.request.get(presenceUrl);
      const presencePayload = await presence.json() as { presence: Array<{ lease_id: string; expires_at: string; heartbeat_at: string }> };
      expect(presencePayload.presence.map((item) => item.lease_id)).toEqual(expect.arrayContaining([firstLease, secondLease]));
      expect(presencePayload.presence.every((item) => Date.parse(item.expires_at) - Date.parse(item.heartbeat_at) <= 46_000)).toBeTruthy();
      await page.request.delete(presenceUrl, { data: { lease_id: firstLease } });
      await secondPage.request.delete(presenceUrl, { data: { lease_id: secondLease } });

      await Promise.all([
        page.goto("/?view=referrals"),
        secondPage.goto("/?view=referrals"),
      ]);
      await page.getByRole("button", { name: `Open ${currentName} referral workspace` }).click();
      await secondPage.getByRole("button", { name: `Open ${currentName} referral workspace` }).click();
      const localName = `${suffix} Local`;
      const remoteName = `${suffix} Remote`;
      let releaseLocal!: () => void;
      const localSaveGate = new Promise<void>((resolve) => { releaseLocal = resolve; });
      await page.route(`**/api/referrals/${base.id}`, async (route) => {
        if (route.request().method() === "PATCH") await localSaveGate;
        await route.continue();
      });
      await page.getByRole("textbox", { name: "NAME", exact: true }).fill(localName);
      await secondPage.getByRole("textbox", { name: "NAME", exact: true }).fill(remoteName);
      try {
        await expect.poll(async () => {
          const response = await page.request.get(`/api/referrals/${base.id}`);
          return ((await response.json()) as { referral: { name: string } }).referral.name;
        }).toBe(remoteName);
      } finally {
        releaseLocal();
      }

      const remoteChanges = page.getByRole("region", { name: "Remote changes" });
      await expect(remoteChanges).toBeVisible({ timeout: 8_000 });
      await expect(remoteChanges.getByText(localName, { exact: true })).toBeVisible();
      await expect(remoteChanges.getByText(remoteName, { exact: true })).toBeVisible();
      await remoteChanges.getByRole("button", { name: "Use latest" }).click();
      await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(remoteName);
    } finally {
      await secondContext.close();
    }
  });

  test("recovers a tab-scoped draft after refresh and then section-autosaves it", async ({ page }) => {
    const name = `Recovery ${uniqueAlphabeticNameToken()}`;
    const createdResponse = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `recovery-${randomUUID()}`,
        assignee_id: testAssessor.id,
        referral: {
          name,
          date: "2026-08-09",
          stage: "New",
          community: "San Pablo",
          source: "Recovery test",
          priority: "standard",
          tags: ["recovery-test"],
          documentName: "",
          documentStatus: "Missing",
          owner: testAssessor.name,
          note: "Legacy free-text summary.",
          createdAt: new Date().toISOString(),
          dob: "",
          phone: "",
          email: "",
          payer: "",
          requirements: [],
        },
      },
    });
    expect(createdResponse.ok()).toBeTruthy();
    const created = await createdResponse.json() as { referral: { id: number; name: string } };

    await page.goto("/?view=referrals");
    await page.getByRole("button", { name: `Open ${created.referral.name} referral workspace` }).click();
    await expect(page.getByTestId("packet-workspace")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open referrals" })).toHaveAttribute("data-active", "true");
    await expect(page.getByRole("button", { name: "Create new referral" })).not.toHaveAttribute("data-active", "true");
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Summary: Additional context", exact: true })).toHaveValue("Legacy free-text summary.");
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    const summary = page.getByRole("textbox", { name: "Summary: Additional context", exact: true });
    await summary.fill("Recovered synthetic summary draft.");
    await expect.poll(async () => page.evaluate((referralId) => (
      window.sessionStorage.getItem(`pipeline-referral-draft:${referralId}`)?.includes("Recovered synthetic summary draft.") ?? false
    ), created.referral.id)).toBeTruthy();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Recovered draft" })).toBeVisible();
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Summary: Additional context", exact: true })).toHaveValue("Recovered synthetic summary draft.");
    await page.getByRole("button", { name: "Close editor", exact: true }).click();

    await expect.poll(async () => {
      const response = await page.request.get(`/api/referrals/${created.referral.id}`);
      return ((await response.json()) as { referral: { note?: string } }).referral.note;
    }, { timeout: 8_000 }).toContain("## Additional context\nRecovered synthetic summary draft.");
    await expect(page.getByTestId("workspace-save-status")).toContainText("Saved");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Summary: Additional context", exact: true })).toHaveValue("Recovered synthetic summary draft.");
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
  });

  test("protects worker endpoints and rejects malformed callbacks before touching storage", async ({ page }) => {
    expect((await page.request.get("/api/internal/extraction/queue")).status()).toBe(401);
    const malformed = await page.request.post("/api/internal/extraction/report", {
      headers: { Authorization: "Bearer playwright-worker-secret" },
      data: { status: "succeeded" },
    });
    expect(malformed.status()).toBe(400);
  });

  test("blocks conflicting governed identity evidence without creating or confirming a link", async ({ page }) => {
    const createReferral = async (dateOfBirth: string) => {
      const response = await page.request.post("/api/referrals", {
        data: {
          client_mutation_id: randomUUID(),
          assignee_id: testAssessor.id,
          referral: {
            name: `Identity ${uniqueAlphabeticNameToken()}`,
            date: "2026-09-09",
            stage: "New",
            community: "San Pablo",
            county: "Contra Costa County",
            source: "Identity boundary test",
            priority: "standard",
            tags: [],
            documentName: "",
            documentStatus: "Missing",
            owner: testAssessor.name,
            note: "",
            createdAt: new Date().toISOString(),
            dob: dateOfBirth,
            phone: "",
            email: "",
            payer: "",
            requirements: [],
          },
        },
      });
      const payload = await response.json() as { referral?: Referral; error?: string };
      expect(response.status(), JSON.stringify(payload)).toBe(201);
      expect(payload.referral).toBeTruthy();
      return payload.referral!;
    };
    const createCandidate = (referral: Referral) => page.request.post("/api/resident-links", {
      headers: { Authorization: "Bearer playwright-clinical-token" },
      data: {
        client_mutation_id: randomUUID(),
        pipeline_client_id: referral.clientId,
        display_name: referral.name,
        date_of_birth: referral.dob,
        referral_id: referral.id,
        resident_key: "337:R-100",
        resident_number: governedResidentNumber,
        community_id: "337",
        match_method: "manual",
        match_confidence: 0.95,
      },
    });

    const conflictingReferral = await createReferral("1990-01-01");
    const blockedCreate = await createCandidate(conflictingReferral);
    expect(blockedCreate.status()).toBe(409);
    await expect(blockedCreate.json()).resolves.toMatchObject({ code: "resident_date_of_birth_conflict" });
    const afterBlockedCreate = await page.request.get(`/api/resident-links?referral_id=${conflictingReferral.id}`);
    await expect(afterBlockedCreate.json()).resolves.toMatchObject({ total: 0, links: [] });

    const matchingReferral = await createReferral(governedResidentDob);
    const created = await createCandidate(matchingReferral);
    const createdPayload = await created.json() as { link?: PipelineResidentLink; error?: string };
    expect(created.status(), JSON.stringify(createdPayload)).toBe(201);
    expect(createdPayload.link?.status).toBe("candidate");

    governedResidentDob = "1999-12-31";
    const blockedConfirmation = await page.request.patch(`/api/resident-links/${createdPayload.link!.link_id}`, {
      headers: { Authorization: "Bearer playwright-clinical-token" },
      data: { action: "confirm", if_match: createdPayload.link!.version },
    });
    expect(blockedConfirmation.status()).toBe(409);
    await expect(blockedConfirmation.json()).resolves.toMatchObject({ code: "resident_date_of_birth_conflict" });

    const unchanged = await page.request.get(`/api/resident-links/${createdPayload.link!.link_id}`);
    const unchangedPayload = await unchanged.json() as { link: PipelineResidentLink };
    expect(unchangedPayload.link).toMatchObject({ status: "candidate", version: 1 });
    expect(unchangedPayload.link.audit_events.map((event) => event.action)).toEqual(["resident_link_created"]);
  });

  test("fails document metadata and previews closed with bounded pagination", async ({ page }) => {
    const documentId = "10000000-0000-4000-8000-000000000001";
    expect((await page.request.get("/api/files/not-a-document")).status()).toBe(404);
    expect((await page.request.get(`/api/files/${documentId}?limit=0`)).status()).toBe(400);
    expect((await page.request.get(`/api/files/${documentId}?limit=101`)).status()).toBe(400);
    expect((await page.request.get(`/api/files/${documentId}?after_page=50001`)).status()).toBe(400);
    expect((await page.request.get(`/api/files/${documentId}/preview?page=0`)).status()).toBe(400);
    expect((await page.request.get(`/api/files/${documentId}/preview?page=100000`)).status()).toBe(400);
    expect((await page.request.get(`/api/files/${documentId}/preview?variant=thumbnail`)).status()).toBe(400);
    expect((await page.request.get(`/api/files/${documentId}/preview?page=1&variant=full`)).status()).toBe(400);
    expect((await page.request.get(`/api/files/${documentId}?limit=24`)).status()).toBe(503);
    expect((await page.request.get(`/api/files/${documentId}/preview?page=1`)).status()).toBe(503);
  });

  test("keeps the chart editable with consolidated document references", async ({
    page,
  }) => {
    const clientName = `Workflow ${uniqueAlphabeticNameToken()}`;
    const packetBytes = Buffer.from(`packet-${randomUUID()}`);
    await page.getByRole("button", { name: "Create new referral" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(clientName);
    await page.getByRole("textbox", { name: "GENDER", exact: true }).fill("Synthetic gender");
    await page.getByRole("textbox", { name: "AGE", exact: true }).fill("74");
    await page.getByRole("textbox", { name: "DOB", exact: true }).fill("1951-08-14");
    await page.getByRole("textbox", { name: "SSN", exact: true }).fill("000-00-0000");
    await page.getByRole("combobox", { name: "Community:" }).selectOption("San Pablo");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Contra Costa County");
    await page.getByRole("combobox", { name: "Owner (@name):" }).selectOption(testAssessor.id);
    await page.getByRole("textbox", { name: "Referral received:" }).fill("2026-08-09");
    await page.getByRole("textbox", { name: "Admission date:" }).fill("2026-08-20");
    await page.getByRole("textbox", { name: "Referent:" }).fill("Synthetic County Access");
    await page.getByRole("textbox", { name: "Responsible Person:" }).fill("Synthetic Responsible Person");
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true }).fill("Referral summary for packet review.");
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await page.getByRole("textbox", { name: "Tags", exact: true }).fill("Urgent Review, county-intake");
    await page.getByRole("button", { name: "yes", exact: true }).click();

    await page.getByTestId("document-checklist-toggle").click();
    await page.getByLabel("Initial document type").selectOption("face_sheet");
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "face-sheet.pdf",
      mimeType: "application/pdf",
      buffer: packetBytes,
    });

    const documentsRegion = page.getByRole("region", { name: "Document checklist" });
    const medicationButton = documentsRegion.getByRole("button", { name: "Signed Medication List: drop document or browse" });
    await medicationButton.locator("xpath=..").locator('input[type="file"]').setInputFiles({
      name: "synthetic-medication-list.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("synthetic-medication-list"),
    });
    const providerButton = documentsRegion.getByRole("button", { name: "Provider Form: drop document or browse" });
    await providerButton.locator("xpath=..").locator('input[type="file"]').setInputFiles({
      name: "synthetic-provider-form.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("synthetic-provider-form"),
    });

    await expect(page.getByText("face-sheet.pdf", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Create referral$/ }).click();
    await expect(page.getByText("Packet uploaded and ready for review", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open client profile", exact: true })).toHaveCount(0);
    const extractionReview = page.getByRole("region", { name: "Extraction review" });
    await expect(extractionReview).toBeVisible();
    await extractionReview.getByRole("button", { name: "Review fields", exact: true }).click();
    await expect(extractionReview.locator('[aria-label="Packet ingestion progress"]')).toBeVisible();
    await expect(extractionReview.getByText("Original saved", { exact: true })).toBeVisible();
    await expect(extractionReview.getByText(/values found$/)).toBeVisible();
    await expect(extractionReview.getByText(/0 of \d+ confirmed$/)).toBeVisible();
    await expect(extractionReview.getByText("Development data", { exact: true })).toBeVisible();
    await expect(extractionReview.getByText("Robert", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "DOB", exact: true })).toHaveValue("1951-08-14");

    await extractionReview.getByRole("button", { name: "Edit extracted Date of birth" }).click();
    await extractionReview.getByRole("textbox", { name: "Correct Date of birth" }).fill("1951-08-15");
    await extractionReview.getByRole("button", { name: "Save correction" }).click();
    await expect(page.getByText("Correction saved", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "DOB", exact: true })).toHaveValue("1951-08-15");

    const bulkConfirm = extractionReview.getByRole("button", { name: /^Confirm \d+ high-confidence values$/ });
    if (await bulkConfirm.count()) {
      await bulkConfirm.click();
      await extractionReview.getByRole("button", { name: "Confirm values", exact: true }).click();
    } else {
      await extractionReview.getByRole("button", { name: "Confirm", exact: true }).click();
    }
    await expect(extractionReview.getByText("Extraction review complete", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(clientName);
    await page.getByRole("button", { name: "02 Assessment" }).click();
    await expect(page.getByRole("region", { name: "Assessment" })).toBeVisible();
    await page.getByRole("button", { name: "Schedule assessment", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Assessment interview" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Schedule assessment" })).toBeVisible();

    const referralId = new URL(page.url()).searchParams.get("referralId");
    expect(referralId).toBeTruthy();
    const referralResponse = await page.request.get(`/api/referrals/${referralId}`);
    expect(referralResponse.ok()).toBeTruthy();
    const referralPayload = await referralResponse.json() as {
      referral: {
        clientId?: string;
        version: number;
        sectionVersions: Record<string, number>;
        name: string;
        documentHash?: string;
        documentName: string;
        documentStatus: string;
        packetId?: string;
        packetStatus?: string;
        date: string;
        source: string;
        owner: string;
        note: string;
        dob: string;
        gender?: string;
        reportedAge?: string;
        ssn?: string;
        admissionDate?: string;
        responsiblePerson?: string;
        interview?: string;
        conserved?: string;
        tags?: string[];
        fieldSources?: Record<string, string>;
        requirements?: Array<{ type: string; evidenceDocumentName?: string }>;
        packetFields?: Array<{ field_key: string; final_value?: string; review_status: string; version: number }>;
      };
    };
    const referralList = { referrals: [referralPayload.referral] };
    expect(referralList.referrals[0]).toMatchObject({
      documentName: "face-sheet.pdf",
      documentStatus: "Uploaded",
      packetStatus: "ready_for_review",
      stage: "New",
      date: "2026-08-09",
      source: "Synthetic County Access",
      owner: testAssessor.name,
      note: "## Reason for referral\nReferral summary for packet review.",
      dob: "1951-08-15",
      gender: "Synthetic gender",
      reportedAge: "74",
      ssn: "000-00-0000",
      admissionDate: "2026-08-20",
      responsiblePerson: "Synthetic Responsible Person",
      interview: "",
      conserved: "yes",
      tags: ["urgent-review", "county-intake"],
    });
    expect(referralList.referrals[0]?.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "face_sheet", evidenceDocumentName: "face-sheet.pdf" }),
      expect.objectContaining({ type: "medication_list", evidenceDocumentName: "synthetic-medication-list.pdf" }),
      expect.objectContaining({ type: "provider_form", evidenceDocumentName: "synthetic-provider-form.pdf" }),
    ]));
    expect(referralList.referrals[0]?.documentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(referralList.referrals[0]?.packetId).toMatch(/^pkt_/);
    expect(referralList.referrals[0]?.packetFields?.find((field) => field.field_key === "demographics.date_of_birth")).toMatchObject({
      final_value: "1951-08-15",
      review_status: "edited",
    });
    const reviewedDobField = referralList.referrals[0]?.packetFields?.find(
      (field) => field.field_key === "demographics.date_of_birth",
    );
    expect(reviewedDobField).toBeTruthy();
    const fieldsBeforeReplay = await page.request.get(`/api/packets/${referralPayload.referral.packetId}/fields`);
    const fieldsBeforeReplayPayload = await fieldsBeforeReplay.json() as PacketFieldsResponse;
    const dobAuditCountBeforeReplay = fieldsBeforeReplayPayload.audit_events?.filter(
      (event) => event.field_key === "demographics.date_of_birth" && event.action === "edit",
    ).length ?? 0;
    const replay = await page.request.post(
      `/api/packets/${referralPayload.referral.packetId}/fields/demographics.date_of_birth/review`,
      {
        data: {
          if_match: reviewedDobField!.version - 1,
          action: "edit",
          value: "1951-08-15",
        },
      },
    );
    const replayPayload = await replay.json() as PacketFieldReviewResult;
    expect(replay.status(), JSON.stringify(replayPayload)).toBe(200);
    expect(replayPayload).toMatchObject({
      version: reviewedDobField!.version,
      review_status: "edited",
      final_value: "1951-08-15",
      projection_status: "synchronized",
      referral: { id: Number(referralId), version: referralPayload.referral.version },
    });
    const fieldsAfterReplay = await page.request.get(`/api/packets/${referralPayload.referral.packetId}/fields`);
    const fieldsAfterReplayPayload = await fieldsAfterReplay.json() as PacketFieldsResponse;
    expect(fieldsAfterReplayPayload.audit_events?.filter(
      (event) => event.field_key === "demographics.date_of_birth" && event.action === "edit",
    ).length ?? 0).toBe(dobAuditCountBeforeReplay);

    const historyPatch = await page.request.patch(`/api/referrals/${referralId}`, {
      data: {
        if_match: referralPayload.referral.version,
        if_match_sections: referralPayload.referral.sectionVersions,
        patch: {
          county: "Alameda County",
          ssn: "111-11-1111",
        },
      },
    });
    expect(historyPatch.status(), await historyPatch.text()).toBe(200);

    const pipelineClientId = referralList.referrals[0]?.clientId;
    expect(pipelineClientId).toBeTruthy();
    const clientIdentityTitle = referralPayload.referral.name;
    await page.goto(`/?screen=profile&clientId=${encodeURIComponent(`pipeline:${pipelineClientId}`)}`);
    await expect(page.getByRole("heading", { name: clientIdentityTitle, exact: true })).toBeVisible();
    const medicalChart = page.getByRole("article", { name: "Client medical chart" });
    await expect(medicalChart.getByText("Synthetic gender", { exact: true })).toBeVisible();
    await expect(medicalChart.getByText("San Pablo", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Referral history", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Client files", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Referral files", exact: true })).toBeVisible();
    await expect(page.getByText("face-sheet.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("synthetic-medication-list.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("synthetic-provider-form.pdf", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Assessments", exact: true })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect a referral" })).toHaveCount(0);

    const packetId = referralList.referrals[0]?.packetId;
    expect(packetId).toBeTruthy();
    const packetFieldsResponse = await page.request.get(`/api/packets/${packetId}/fields`);
    const packetFields = await packetFieldsResponse.json() as { fields: Array<{ field_key: string; version: number }> };
    const dobField = packetFields.fields.find((field) => field.field_key === "demographics.date_of_birth");
    expect(dobField).toBeTruthy();
    const reviewUrl = `/api/packets/${packetId}/fields/${encodeURIComponent("demographics.date_of_birth")}/review`;
    const [firstReview, competingReview] = await Promise.all([
      page.request.post(reviewUrl, { data: { if_match: dobField!.version, action: "edit", value: "1951-08-16" } }),
      page.request.post(reviewUrl, { data: { if_match: dobField!.version, action: "edit", value: "1951-08-17" } }),
    ]);
    expect([firstReview.status(), competingReview.status()].sort((left, right) => left - right)).toEqual([200, 409]);
    const winningReview = firstReview.ok() ? firstReview : competingReview;
    const winningReviewPayload = await winningReview.json() as PacketFieldReviewResult;
    expect(winningReviewPayload.referral?.packetFields?.find(
      (field) => field.field_key === "demographics.date_of_birth",
    )?.final_value).toBe(winningReviewPayload.final_value);

    await page.goto("/?view=referrals");
    await expect(page.getByRole("region", { name: "Referral worklist" })).toBeVisible();
    await expect(page.getByRole("button", { name: `Open ${clientIdentityTitle} referral workspace` })).toBeVisible();
    const taggedReferralsResponse = await page.request.get("/api/referrals?tag=urgent-review&limit=25");
    expect(taggedReferralsResponse.status()).toBe(200);
    const taggedReferrals = await taggedReferralsResponse.json() as { referrals: Array<{ tags?: string[] }> };
    expect(taggedReferrals.referrals.every((referral) => referral.tags?.includes("urgent-review"))).toBeTruthy();
    const communityFilter = page.getByRole("combobox", { name: "Filter workspaces by community" });
    await expect(communityFilter).toBeVisible();
    await communityFilter.selectOption("San Pablo");
    const workspaceButton = page.getByRole("button", { name: `Open ${clientIdentityTitle} referral workspace` });
    await expect(workspaceButton).toBeVisible();
    await workspaceButton.click();
    await expect(page.getByTestId("workspace-identity-title")).toHaveText(clientIdentityTitle);
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(clientIdentityTitle);
    await expect(page.getByRole("textbox", { name: "GENDER", exact: true })).toHaveValue("Synthetic gender");
    await expect(page.getByRole("textbox", { name: "AGE", exact: true })).toHaveValue("74");
    await expect(page.getByRole("textbox", { name: "DOB", exact: true })).toHaveValue(winningReviewPayload.final_value ?? "");
    await expect(page.getByRole("textbox", { name: "SSN", exact: true })).toHaveValue("111-11-1111");
    const compactHistory = page.getByRole("region", { name: "Workspace change history" });
    await expect(compactHistory).toBeVisible();
    await expect(compactHistory.getByText("Change history", { exact: true })).toBeVisible();
    await compactHistory.getByRole("button", { name: "View change history", exact: true }).click();
    const fullHistory = page.getByRole("region", { name: "Referral ownership and activity" });
    await expect(fullHistory).toBeVisible();
    const workspaceOwners = fullHistory.getByRole("group", { name: "Workspace owners" });
    await expect(workspaceOwners).toContainText("Playwright QA");
    await expect(workspaceOwners).toContainText("Creator");
    await expect(workspaceOwners).toContainText("Assignee");
    const countyChange = fullHistory.getByText("County", { exact: true }).locator("..");
    await expect(countyChange).toContainText("Contra Costa County");
    await expect(countyChange).toContainText("Alameda County");
    const ssnChange = fullHistory.getByText("Social Security number", { exact: true }).locator("..");
    await expect(ssnChange).toContainText("Value changed (masked)");
    await expect(ssnChange).not.toContainText("000-00-0000");
    await expect(ssnChange).not.toContainText("111-11-1111");
    await page.getByRole("button", { name: "01 Intake" }).click();
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true })).toHaveValue("Referral summary for packet review.");
    await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await expect(page.getByRole("button", { name: "yes", exact: true })).toHaveClass(/bg-\[#111111\]/);

    const legacyProfileResponse = await page.request.get(`/api/clients?q=${encodeURIComponent(clientName)}`);
    expect(legacyProfileResponse.status()).toBe(404);
  });

  test("ingests a new packet from the file alone and exposes OCR values for review", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const clientName = ["Rowan Example", "Rowan Retry", "Rowan Recovery"][testInfo.retry] ?? "Rowan Recovery";
    const canvas = createCanvas(1600, 1200);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "black";
    context.font = "bold 48px Arial";
    context.fillText("ADMISSION RECORD", 80, 90);
    context.font = "32px Arial";
    [
      "Referring Facility: North County Behavioral Health",
      `Resident Name: ${clientName.split(" ").reverse().join(", ")}`,
      "Resident #: 81234567",
      "Date of Birth: 01/15/1980 Age: 46",
      "Gender: Female",
      "Admission Date: 08/09/2026",
      "Primary Payer: County Medi-Cal",
      "Responsible Person: Jamie Example",
      "Primary Diagnosis: Schizoaffective disorder",
      "Allergies: NKDA",
      "Legal Status: Voluntary",
    ].forEach((line, index) => context.fillText(line, 80, 180 + index * 75));

    await page.getByRole("button", { name: "Create new referral" }).click();
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "rowan-example-face-sheet.png",
      mimeType: "image/png",
      buffer: canvas.toBuffer("image/png"),
    });
    await page.getByRole("button", { name: /^Create referral$/ }).click();

    await expect(page.getByText("Packet uploaded and ready for review", { exact: true })).toBeVisible({ timeout: 120_000 });
    const extractionReview = page.getByRole("region", { name: "Extraction review" });
    await expect(extractionReview).toBeVisible();
    await extractionReview.getByRole("button", { name: "Review fields", exact: true }).click();
    await expect(extractionReview.getByText(clientName, { exact: true })).toBeVisible();
    await expect(extractionReview.getByText("1980-01-15", { exact: true })).toBeVisible();
    await expect(extractionReview.getByText("North County Behavioral Health", { exact: true })).toBeVisible();
    await expect(extractionReview.getByText("Schizoaffective disorder", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(clientName);
    await expect(page.getByRole("textbox", { name: "DOB", exact: true })).toHaveValue("1980-01-15");

    const referrals = await page.request.get(`/api/referrals?q=${encodeURIComponent(clientName)}`);
    const payload = await referrals.json() as {
      referrals: Array<{
        id: number;
        packetFields?: Array<{ field_key: string; proposed_value?: string | null; source_page_no?: number }>;
      }>;
    };
    expect(payload.referrals).toHaveLength(1);
    expect(payload.referrals[0].packetFields).toHaveLength(13);
    expect(payload.referrals[0].packetFields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field_key: "referral.primary_diagnosis",
        proposed_value: "Schizoaffective disorder",
        source_page_no: 1,
      }),
    ]));
    const extractedFields = payload.referrals[0].packetFields?.filter((field) => field.proposed_value?.trim()) ?? [];
    expect(extractedFields.length).toBeGreaterThan(0);
    expect(extractedFields.every((field) => field.source_page_no === 1)).toBeTruthy();
    expect(payload.referrals[0].packetFields?.every((field) => (
      field.source_page_no === undefined || field.source_page_no === 1
    ))).toBeTruthy();

    const packet = await page.request.get(`/api/referrals/${payload.referrals[0].id}/packet`);
    expect(packet.ok()).toBeTruthy();
    expect(packet.headers()["content-type"]).toContain("image/png");
  });

  test("blocks an exact duplicate packet from creating another referral", async ({ page }) => {
    const packetBytes = Buffer.from(`duplicate-packet-${randomUUID()}`);
    const firstClient = `First ${randomUUID().slice(0, 8)}`;
    const secondClient = `Second ${randomUUID().slice(0, 8)}`;

    await page.getByRole("button", { name: "Create new referral" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(firstClient);
    await page.getByRole("combobox", { name: "Community:" }).selectOption("San Pablo");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Contra Costa County");
    await page.getByTestId("document-checklist-toggle").click();
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "first-copy.pdf",
      mimeType: "application/pdf",
      buffer: packetBytes,
    });
    await page.getByRole("button", { name: /^Create referral$/ }).click();
    await expect(page.getByRole("region", { name: "Document checklist" }).getByText("Packet added", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Extraction review" })).toBeVisible();

    await page.goto("/?view=referrals&screen=packet");
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(secondClient);
    await page.getByRole("combobox", { name: "Community:" }).selectOption("Turlock");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Stanislaus County");
    await page.getByTestId("document-checklist-toggle").click();
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "renamed-copy.pdf",
      mimeType: "application/pdf",
      buffer: packetBytes,
    });
    await page.getByRole("button", { name: /^Create referral$/ }).click();
    await expect(page.getByText("This exact packet is already attached to a referral. Open the existing referral instead.", { exact: true })).toBeVisible();

    const duplicateResponse = await page.request.get(`/api/referrals?q=${encodeURIComponent(secondClient)}`);
    const duplicateList = await duplicateResponse.json() as { total: number };
    expect(duplicateList.total).toBe(0);
  });

  test("reviews a same-name and county match before creating a different person", async ({ page }) => {
    const clientName = `Duplicate ${uniqueAlphabeticNameToken()}`;
    const firstResponse = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `duplicate-review-first-${randomUUID()}`,
        assignee_id: testAssessor.id,
        referral: {
          name: clientName,
          date: "2026-09-07",
          stage: "New",
          community: "San Pablo",
          county: "Contra Costa County",
          source: "Duplicate review test",
          priority: "standard",
          tags: [],
          documentName: "",
          documentStatus: "Missing",
          owner: testAssessor.name,
          note: "",
          createdAt: new Date().toISOString(),
          dob: "",
          phone: "",
          email: "",
          payer: "",
          requirements: [],
        },
      },
    });
    expect(firstResponse.status()).toBe(201);
    const first = (await firstResponse.json() as { referral: { id: number } }).referral;

    await page.getByRole("button", { name: "Create new referral" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(clientName);
    await page.getByRole("combobox", { name: "Community:" }).selectOption("San Pablo");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Contra Costa County");
    await page.getByRole("button", { name: /^Create referral$/ }).click();

    const review = page.getByRole("alertdialog", { name: "Possible duplicate referral" });
    await expect(review).toBeVisible();
    await expect(review.getByText(`Referral #${first.id}`, { exact: false })).toBeVisible();
    await expect(review.getByRole("button", { name: "Open workspace" })).toBeVisible();
    await review.getByRole("checkbox", { name: /I reviewed every possible match/ }).check();
    await review.getByRole("button", { name: "Create different person" }).click();

    await expect(review).toBeHidden();
    await expect.poll(() => Number(new URL(page.url()).searchParams.get("referralId") ?? 0)).toBeGreaterThan(0);
    const createdId = Number(new URL(page.url()).searchParams.get("referralId"));
    expect(createdId).not.toBe(first.id);

    const listResponse = await page.request.get(`/api/referrals?q=${encodeURIComponent(clientName)}&limit=10`);
    expect(listResponse.status()).toBe(200);
    expect((await listResponse.json() as { total: number }).total).toBe(2);
  });

  test("switches packet steps without stacking the sections", async ({ page }) => {
    await page.getByRole("button", { name: "Create new referral" }).click();
    await expect(page.getByRole("button", { name: "01 Intake" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Workspace files" }).click();
    await expect(page.getByRole("button", { name: "Workspace files" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: "Intake", exact: true })).toHaveCount(0);
    await expect(page.getByText("Signed Medication List", { exact: true })).toBeVisible();
    await expect(page.getByText("TB Test-Results", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Drop document or browse" }).first()).toBeVisible();
    await expect(page.getByText("Provider Form", { exact: true })).toBeVisible();
    await expect(page.getByText("Face Sheet", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "02 Assessment" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("workspaceStage")).toBe("assessment");
    await expect(page.getByText("Save the referral before starting the assessment", { exact: true })).toBeVisible();

    await expect(page.getByRole("button", { name: "03 Decision" })).toHaveCount(0);
    await page.getByRole("button", { name: "Pipeline home" }).click();
    await page.getByRole("button", { name: "Create new referral" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("workspaceStage")).toBeNull();
    await expect.poll(() => new URL(page.url()).searchParams.get("workspaceView")).toBeNull();
    await expect(page.getByRole("button", { name: "01 Intake" })).toHaveAttribute("aria-current", "page");
  });

  test("schedules, completes, signs, and recalls an assessment", async ({ page }) => {
    test.setTimeout(60_000);
    const clientName = `Assessment ${uniqueAlphabeticNameToken()}`;
    await page.getByRole("button", { name: "Create new referral" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(clientName);
    await page.getByRole("textbox", { name: "DOB", exact: true }).fill("06/12/1984");
    await page.getByRole("textbox", { name: "Client phone:", exact: true }).fill("5550003434");
    await page.getByRole("combobox", { name: "Community:" }).selectOption("San Pablo");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Contra Costa County");
    await page.getByRole("textbox", { name: "Referent:", exact: true }).fill("San Pablo intake team");
    await page.getByRole("combobox", { name: "Owner (@name):" }).selectOption(testAssessor.id);
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "assessment-referral.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(`assessment-referral-${randomUUID()}`),
    });
    await page.getByRole("button", { name: "Create referral", exact: true }).click();
    await expect(page.getByTestId("workspace-save-status")).toContainText("Packet uploaded");
    await page.getByRole("button", { name: "02 Assessment", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
    const referralId = new URL(page.url()).searchParams.get("referralId");
    expect(referralId).toBeTruthy();
    await expect.poll(() => new URL(page.url()).searchParams.get("workspaceStage")).toBe("assessment");
    await expect(page.getByRole("button", { name: "02 Assessment" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Schedule assessment" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "02 Assessment" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Schedule assessment" })).toBeVisible();
    await page.getByRole("button", { name: "01 Intake" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("workspaceStage")).toBeNull();
    const savedDocumentChecklist = page.getByTestId("document-checklist-panel");
    if ((await savedDocumentChecklist.getAttribute("open")) === null) {
      await page.getByTestId("document-checklist-toggle").click();
    }
    await expect(page.getByRole("region", { name: "Initial referral packet" })
      .getByRole("group", { name: "Upload initial referral document" })).toContainText("assessment-referral.pdf", { timeout: 15_000 });
    const packetReview = page.getByRole("region", { name: "Extraction review" });
    await expect(packetReview).toBeVisible();
    await page.getByRole("button", { name: "02 Assessment", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("workspaceStage")).toBe("assessment");
    await expect(page.getByRole("button", { name: "02 Assessment" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Schedule assessment" })).toBeVisible();
    await page.waitForTimeout(750);
    await expect(page.getByRole("button", { name: "02 Assessment" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "01 Intake" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("workspaceStage")).toBeNull();
    await packetReview.getByRole("button", { name: "Review fields", exact: true }).click();
    const bulkPacketConfirm = packetReview.getByRole("button", { name: /^Confirm \d+ high-confidence values$/ });
    if (await bulkPacketConfirm.count()) {
      await bulkPacketConfirm.click();
      await packetReview.getByRole("button", { name: "Confirm values", exact: true }).click();
    }
    const remainingConfirmations = packetReview.getByRole("button", { name: "Confirm", exact: true });
    await expect(remainingConfirmations.first()).toBeVisible();
    for (let index = 0; index < 5 && await remainingConfirmations.count() > 0; index += 1) {
      await remainingConfirmations.first().click();
    }
    await expect(packetReview.getByText("Extraction review complete", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "02 Assessment" }).click();
    await expect(page.getByRole("button", { name: "02 Assessment" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Schedule assessment" }).click();
    const assessmentInterview = page.getByRole("dialog", { name: "Assessment interview" });
    await expect(assessmentInterview).toBeVisible();
    await expect(assessmentInterview.getByText(testAssessor.name, { exact: true })).toBeVisible();
    const scheduleDialog = page.getByRole("dialog", { name: "Schedule assessment" });
    await scheduleDialog.getByLabel("Assessment date and time").fill("2026-08-26T09:00");
    await scheduleDialog.getByLabel("Assessment address").fill("San Pablo interview room");
    await scheduleDialog.getByRole("button", { name: "Schedule assessment", exact: true }).click();
    const beginDialog = page.getByRole("dialog", { name: "Begin assessment" });
    await expect(beginDialog).toBeVisible();
    await beginDialog.getByRole("button", { name: "Begin assessment", exact: true }).click();
    await expect(assessmentInterview).toHaveAttribute("data-guided-assessment", "true");
    await assessmentInterview.getByRole("button", { name: "Exit guided interview" }).click();
    const assessmentReadiness = assessmentInterview.getByRole("region", { name: "Assessment readiness" });
    await expect(assessmentReadiness).toContainText("required areas remain");
    await expect(assessmentReadiness.getByRole("button", { name: /^Next required:/ })).toBeVisible();
    const assessmentSectionNav = assessmentInterview.getByRole("navigation", { name: "Assessment sections" });
    await expect(assessmentSectionNav.getByRole("button")).toHaveCount(assessmentInterviewSections.length);
    for (const section of assessmentInterviewSections) {
      await expect(assessmentSectionNav.getByRole("button").filter({ hasText: section.label })).toHaveCount(1);
    }
    await assessmentInterview.getByRole("button", { name: /^History/ }).click();
    await assessmentInterview.getByLabel("Prior placements", { exact: true }).fill("Client reports one prior placement; dates and discharge reason are not yet verified.");
    await assessmentInterview.getByText("Language Lab", { exact: true }).first().click();
    await expect(assessmentInterview.getByText("Use this order", { exact: true }).first()).toBeVisible();
    await expect(assessmentInterview.getByText("Include", { exact: true }).first()).toBeVisible();
    await expect(assessmentInterview.getByText("Example format", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Function/ }).click();
    const languageBarrier = page.getByRole("group", { name: "Language barrier", exact: true });
    await languageBarrier.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(page.getByLabel(/^Language support needed/)).toBeVisible();
    await page.getByLabel(/^Language support needed/).fill("Interpreter requested");
    await languageBarrier.getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByLabel(/^Language support needed/)).toHaveCount(0);
    await languageBarrier.getByRole("button", { name: "Unable to assess", exact: true }).click();
    const unableReason = page.getByLabel("Why could this not be assessed? *", { exact: true });
    await expect(unableReason).toBeVisible();
    await expect(page.getByText("An explanation is required before this assessment can be signed.", { exact: true })).toBeVisible();
    await unableReason.fill("The client could not participate and no collateral source was available.");
    await expect(page.getByText("An explanation is required before this assessment can be signed.", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^Client & referral/ }).click();
    await page.getByLabel(/^Resident number/).fill(`EM-${randomUUID().slice(0, 8)}`);
    await page.getByLabel(/^Date of birth/).fill("1984-06-12");
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: "Close assessment", exact: true }).click();
    await expect(page.getByRole("button", { name: "Resume assessment", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resume assessment", exact: true }).click();
    await expect(assessmentInterview).toBeVisible();
    await expect(assessmentInterview).toHaveAttribute("data-guided-assessment", "true");
    await assessmentInterview.getByRole("button", { name: "Exit guided interview" }).click();
    await expect(assessmentReadiness.getByRole("button", { name: /^Next required:/ })).toBeVisible();

    const assessmentsBeforeSignature = await page.request.get(`/api/referrals/${referralId}/assessments`);
    const assessmentsBeforeSignaturePayload = await assessmentsBeforeSignature.json() as { assessments: Array<PipelineAssessmentRecord> };
    const assessmentBeforeSignature = assessmentsBeforeSignaturePayload.assessments[0];
    const completeInterview = await page.request.patch(`/api/assessments/${assessmentBeforeSignature.assessment_id}`, {
      data: {
        if_match: assessmentBeforeSignature.version,
        patch: {
          data: {
            ...completedAssessmentPatch(assessmentBeforeSignature),
            primary_diagnosis: "Schizoaffective disorder",
          },
        },
      },
    });
    expect(completeInterview.status(), await completeInterview.text()).toBe(200);
    await expect(page.getByRole("button", { name: "Sign assessment", exact: true })).toBeEnabled({ timeout: 6_000 });

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sign assessment", exact: true }).click();
    await expect(assessmentInterview.getByText("Assessment signed", { exact: true })).toBeVisible();
    await expect(assessmentReadiness.getByText("Assessment signed and locked", { exact: true })).toBeVisible();
    await assessmentReadiness.getByRole("button", { name: "Continue to recommendation" }).click();
    await expect(page.getByRole("region", { name: "Admission workflow" })).toBeVisible();

    const history = await page.request.get(`/api/referrals/${referralId}/assessments`);
    expect(history.ok()).toBeTruthy();
    const historyPayload = await history.json() as { assessments: Array<{ assessment_id: string; status: string; primary_diagnosis: string; medications_at_intake: string[]; unable_to_assess_reasons: Record<string, string>; version: number; assessor_id: string | null; assessor: string | null; completed_at: string | null; signed_at: string | null; signed_by: { id: string; name: string } | null }> };
    expect(historyPayload.assessments[0]).toMatchObject({
      status: "complete",
      primary_diagnosis: "Schizoaffective disorder",
    });
    expect(historyPayload.assessments[0].version).toBeGreaterThanOrEqual(4);
    expect(historyPayload.assessments[0].assessor_id).toBeTruthy();
    expect(historyPayload.assessments[0].assessor).toBe(testAssessor.name);
    expect(historyPayload.assessments[0].signed_by?.name).toBe("Playwright QA");
    expect(historyPayload.assessments[0].unable_to_assess_reasons.language_barrier).toBe("The client could not participate and no collateral source was available.");
    const reportMonth = historyPayload.assessments[0].signed_at!.slice(0, 7);
    const operations = await page.request.get(`/api/operations/dashboard?month=${reportMonth}`);
    expect(operations.ok()).toBeTruthy();
    const operationsPayload = await operations.json() as {
      snapshot: { assessment_report: { total_completed: number; rows: Array<{ assessor_name: string; completed_assessments: number }> } };
    };
    expect(operationsPayload.snapshot.assessment_report.total_completed).toBeGreaterThan(0);
    expect(operationsPayload.snapshot.assessment_report.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ assessor_name: testAssessor.name, completed_assessments: expect.any(Number) }),
    ]));

    const signedEdit = await page.request.patch(`/api/assessments/${historyPayload.assessments[0].assessment_id}`, {
      data: {
        if_match: historyPayload.assessments[0].version,
        patch: { data: { primary_diagnosis: "Changed after signature" } },
      },
    });
    expect(signedEdit.status()).toBe(400);
    await expect(signedEdit.json()).resolves.toMatchObject({ error: expect.stringContaining("signed") });

    const workItems = await page.request.get(`/api/referrals/${referralId}/work-items`);
    expect(workItems.ok()).toBeTruthy();
    const workItemPayload = await workItems.json() as { work_items: Array<{ type: string; status: string; version: number }> };
    expect(workItemPayload.work_items).toHaveLength(11);
    expect(workItemPayload.work_items.filter((item) => item.type === "profile_field")).toHaveLength(3);
    expect(workItemPayload.work_items.find((item) => item.type === "tb_test")).toMatchObject({ status: "needed", version: 1 });

    await page.getByRole("button", { name: "Workspace activity" }).click();
    const activityPanel = page.getByRole("region", { name: "Referral ownership and activity" });
    await expect(activityPanel).toBeVisible();
    await expect(activityPanel.getByText("Ownership and timing", { exact: true })).toBeVisible();
    await expect(activityPanel.getByText("Playwright QA", { exact: true }).first()).toBeVisible();
    await expect(activityPanel.getByText("Assessment time", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "03 Decision" })).toHaveCount(0);
  });

  test("versions the EHR handoff and records failure recovery explicitly", async ({ page }) => {
    const now = new Date().toISOString();
    const create = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `ehr-handoff-${randomUUID()}`,
        assignee_id: testAssessor.id,
        referral: {
          name: `Synthetic EHR ${randomUUID().slice(0, 8)}`,
          date: now.slice(0, 10),
          stage: "New",
          community: "San Pablo",
          source: "Synthetic EHR journey",
          priority: "standard",
          tags: ["ehr-test"],
          documentName: "synthetic-packet.pdf",
          documentStatus: "Reviewed",
          packetStatus: "reviewed",
          owner: testAssessor.name,
          note: "",
          createdAt: now,
          dob: "1980-01-01",
          phone: "5550005656",
          email: "",
          payer: "",
          requirements: [],
        },
      },
    });
    expect(create.status()).toBe(201);
    type WorkflowReferral = {
      id: number;
      version: number;
      stage: string;
      sectionVersions: { workflow: number; decision: number };
      ehrHandoff?: { status: string };
    };
    let referral = (await create.json()).referral as WorkflowReferral;
    const transition = async (targetStage: string) => {
      const response = await page.request.post(`/api/referrals/${referral.id}/transition`, {
        data: {
          if_match: referral.version,
          if_match_section: referral.sectionVersions.workflow,
          target_stage: targetStage,
        },
      });
      const payload = await response.json();
      expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
      referral = payload.referral;
    };

    await transition("Packet Needed");
    await transition("Packet Review");
    await transition("Assessment");

    const assessmentCreate = await page.request.post(`/api/referrals/${referral.id}/assessments`, {
      data: {
        client_mutation_id: `ehr-assessment-${randomUUID()}`,
        data: {
          resident_number: `EM-${randomUUID().slice(0, 8)}`,
          date_of_birth: "1980-01-01",
          primary_diagnosis: "Schizoaffective disorder",
          adl_needs: "Needs reminders",
          elopement_risk: "Low",
          medication_adherence: "Consistent with support",
        },
      },
    });
    const assessmentPayload = await assessmentCreate.json();
    expect(assessmentCreate.status(), JSON.stringify(assessmentPayload)).toBe(201);
    const scheduledAssessment = await page.request.post(`/api/assessments/${assessmentPayload.assessment.assessment_id}/schedule`, {
      data: {
        if_match: assessmentPayload.assessment.version,
        client_mutation_id: `ehr-schedule-${randomUUID()}`,
        schedule: {
          status: "scheduled",
          start_at: "2026-08-26T16:00:00.000Z",
          duration_minutes: 60,
          method: "in_person",
          location: "San Pablo",
        },
      },
    });
    const scheduledAssessmentPayload = await scheduledAssessment.json();
    expect(scheduledAssessment.ok(), JSON.stringify(scheduledAssessmentPayload)).toBeTruthy();
    const startedAssessment = await page.request.post(`/api/assessments/${assessmentPayload.assessment.assessment_id}/start`, {
      data: {
        if_match: scheduledAssessmentPayload.assessment.version,
        client_mutation_id: `ehr-start-${randomUUID()}`,
      },
    });
    const startedAssessmentPayload = await startedAssessment.json();
    expect(startedAssessment.ok(), JSON.stringify(startedAssessmentPayload)).toBeTruthy();
    const completedAssessment = await page.request.patch(`/api/assessments/${assessmentPayload.assessment.assessment_id}`, {
      data: {
        if_match: startedAssessmentPayload.assessment.version,
        patch: { data: completedAssessmentPatch(startedAssessmentPayload.assessment) },
      },
    });
    const completedAssessmentPayload = await completedAssessment.json();
    expect(completedAssessment.ok(), JSON.stringify(completedAssessmentPayload)).toBeTruthy();
    const signedAssessment = await page.request.post(`/api/assessments/${assessmentPayload.assessment.assessment_id}/sign`, {
      data: {
        if_match: completedAssessmentPayload.assessment.version,
        client_mutation_id: `ehr-sign-${randomUUID()}`,
      },
    });
    const signedAssessmentPayload = await signedAssessment.json();
    expect(signedAssessment.ok(), JSON.stringify(signedAssessmentPayload)).toBeTruthy();

    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
    await page.getByRole("button", { name: "Admission workflow" }).click();
    const workflowPanel = page.getByRole("region", { name: "Admission workflow" });
    await expect(workflowPanel.getByRole("heading", { name: "From referral to handoff" })).toBeVisible();
    await workflowPanel.getByLabel("Reason code (optional)").first().fill("clinical_fit");
    await workflowPanel.getByLabel("Clinical rationale").fill("Synthetic acceptance recommendation for the EHR handoff journey.");
    await workflowPanel.getByRole("button", { name: "Submit for supervisor review", exact: true }).click();
    await expect(workflowPanel.getByText("Recommendation submitted", { exact: true })).toBeVisible();
    const handoffReadiness = workflowPanel.getByRole("region", { name: "Decision and handoff readiness" });
    await expect(handoffReadiness.getByText("Signed", { exact: true })).toBeVisible();
    await expect(handoffReadiness.getByText("Accept", { exact: true })).toBeVisible();
    const decisionReadiness = workflowPanel.getByRole("region", { name: "Supervisor decision readiness" });
    await expect(decisionReadiness.getByText("Accept recommendation recorded", { exact: true })).toBeVisible();
    await expect(decisionReadiness.getByText("1 decision requirement remaining", { exact: true })).toBeVisible();
    const decisionSelect = workflowPanel.getByRole("combobox", { name: "Decision", exact: true });
    await expect(decisionSelect).toHaveValue("");
    await expect(workflowPanel.getByRole("button", { name: "Record final decision", exact: true })).toBeDisabled();
    await decisionSelect.selectOption("accepted");
    await expect(workflowPanel.getByRole("button", { name: "Record final decision", exact: true })).toBeDisabled();
    await workflowPanel.getByLabel("Signed medication list status").selectOption("received");
    await expect(workflowPanel.getByText("Signed medication list updated", { exact: true })).toBeVisible();
    await expect(decisionReadiness.getByText("Decision requirements resolved", { exact: true })).toBeVisible();
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Record the accepted admission decision?");
      await dialog.accept();
    });
    await workflowPanel.getByRole("button", { name: "Record final decision", exact: true }).click();
    await expect(workflowPanel.getByText("Supervisor decision recorded", { exact: true })).toBeVisible();

    for (const label of [
      "Signed admission agreement + LIC forms",
      "LIC 602",
      "TB test result",
      "LIC 601 & LIC 603",
    ]) {
      await workflowPanel.getByLabel(`${label} status`).selectOption("received");
      await expect(workflowPanel.getByText(`${label} updated`, { exact: true })).toBeVisible();
    }
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Mark this referral admitted?");
      await dialog.accept();
    });
    await workflowPanel.getByRole("button", { name: "Mark admitted" }).click();
    await expect(workflowPanel.getByText("Admission recorded", { exact: true })).toBeVisible();
    await workflowPanel.getByRole("button", { name: "Queue EHR handoff" }).click();
    await expect(workflowPanel.getByText("EHR handoff queued", { exact: true })).toBeVisible();
    await workflowPanel.getByRole("button", { name: "Record failed" }).click();
    const handoffFailureDialog = page.getByRole("dialog", { name: "Record EHR handoff failure" });
    await handoffFailureDialog.getByLabel("Failure reason").fill("Synthetic downstream rejection");
    await handoffFailureDialog.getByRole("button", { name: "Record failure" }).click();
    await expect(workflowPanel.getByText("EHR handoff failure recorded", { exact: true })).toBeVisible();
    const supervisorQueue = await page.request.get("/api/operations/supervisor-queue");
    expect(supervisorQueue.ok()).toBeTruthy();
    await expect(supervisorQueue.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "ehr_handoff_failed", referral_id: referral.id }),
      ]),
    });
    await workflowPanel.getByRole("button", { name: "Retry handoff" }).click();
    await expect(workflowPanel.getByText("EHR handoff queued", { exact: true })).toBeVisible();
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Confirm the downstream transfer succeeded");
      await dialog.accept();
    });
    await workflowPanel.getByRole("button", { name: "Record sent" }).click();
    await expect(workflowPanel.getByText("EHR handoff recorded as sent", { exact: true })).toBeVisible();
    await expect(workflowPanel.getByText("Handoff recorded as sent.", { exact: true })).toBeVisible();
    await expect(workflowPanel.getByText(/admitted-client profile appears only after the governed Alamo roster contains the person/i)).toBeVisible();

    const admittedProfile = workflowPanel.getByRole("region", { name: "Admitted client profile" });
    await expect(admittedProfile).toBeVisible();
    await expect(admittedProfile.getByRole("button", { name: "Check Alamo roster" })).toBeVisible();

    const resident = (clinicalFixture.resident as { resident: Record<string, unknown> }).resident;
    const linkId = "7d95fd3a-09c3-42a8-9412-dd58c71562cd";
    const candidate = {
      link_id: linkId,
      person_id: "5bf423f8-4c3c-46ec-809b-61fc1f040621",
      pipeline_client_id: `ehr-client-${referral.id}`,
      referral_id: referral.id,
      resident_key: resident.resident_key,
      resident_number: resident.resident_number,
      community_id: resident.community_id,
      status: "candidate",
      match_method: "manual",
      match_confidence: 0.95,
      version: 1,
      created_by: { id: "playwright", name: "Playwright QA" },
      reviewed_by: null,
      review_note: null,
      created_at: now,
      reviewed_at: null,
      updated_at: now,
      audit_events: [],
    };
    let activationState: "unlinked" | "candidate" | "confirmed" = "unlinked";

    await page.route(`**/api/referrals/${referral.id}/census-reconciliation`, async (route) => {
      expect(route.request().method()).toBe("POST");
      activationState = "candidate";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "candidate_created",
          link: candidate,
          confidence: 0.95,
          method: "exact_name_dob",
          data_as_of: "2026-08-07",
        }),
      });
    });
    await page.route(/\/api\/resident-links\?.*$/, async (route) => {
      const links = activationState === "unlinked"
        ? []
        : [{ ...candidate, status: activationState, version: activationState === "confirmed" ? 2 : 1 }];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          links,
          total: links.length,
          next_cursor: null,
          generated_at: now,
          store: { mode: "postgres", multi_instance_safe: true },
        }),
      });
    });
    await page.route("**/api/clinical/residents/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clinicalFixture.resident) });
    });
    await page.route(`**/api/resident-links/${linkId}`, async (route) => {
      expect(route.request().postDataJSON()).toEqual({ action: "confirm", if_match: 1 });
      activationState = "confirmed";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, link: { ...candidate, status: "confirmed", version: 2 }, revision: 2 }),
      });
    });

    await admittedProfile.getByRole("button", { name: "Check Alamo roster" }).click();
    await expect(admittedProfile.getByText("Review required", { exact: true })).toBeVisible();
    await expect(admittedProfile.getByText("Avery Example", { exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await admittedProfile.getByRole("button", { name: "Confirm identity" }).click();
    await expect(admittedProfile.getByText("Client identity confirmed", { exact: true })).toBeVisible();
    await page.route("**/api/profiles/client-sanitized-100", async (route) => {
      const profile = structuredClone(unifiedProfileFixture);
      (profile.pipeline as unknown as { connection: Record<string, unknown> }).connection = {
        status: "confirmed",
        confirmed_link: { ...candidate, status: "confirmed", version: 2 },
        candidates: [],
        suggestions: [],
        message: "Pipeline records are joined through a reviewed resident link.",
      };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profile) });
    });
    await admittedProfile.getByRole("button", { name: "Open client profile" }).click();
    await expect(page).toHaveURL(/screen=profile.*clientId=client-sanitized-100/);
    await expect(page.getByRole("main", { name: "Client profile for Avery Example" })).toBeVisible();
  });

  test("requires a documented reason and closes a declined referral", async ({ page }) => {
    const now = new Date().toISOString();
    const create = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `decline-journey-${randomUUID()}`,
        assignee_id: testAssessor.id,
        referral: {
          name: `Synthetic Decline ${randomUUID().slice(0, 8)}`,
          date: now.slice(0, 10),
          stage: "New",
          community: "San Pablo",
          source: "Synthetic decline journey",
          priority: "standard",
          tags: ["decline-test"],
          documentName: "synthetic-decline-packet.pdf",
          documentStatus: "Reviewed",
          packetStatus: "reviewed",
          owner: testAssessor.name,
          note: "",
          createdAt: now,
          dob: "1980-01-01",
          phone: "5550007878",
          email: "",
          payer: "",
          requirements: [],
        },
      },
    });
    const createdPayload = await create.json();
    expect(create.status(), JSON.stringify(createdPayload)).toBe(201);
    type DeclineReferral = {
      id: number;
      version: number;
      stage: string;
      sectionVersions: { workflow: number; decision: number };
    };
    let referral = createdPayload.referral as DeclineReferral;
    for (const targetStage of ["Packet Needed", "Packet Review", "Assessment"]) {
      const transition = await page.request.post(`/api/referrals/${referral.id}/transition`, {
        data: {
          if_match: referral.version,
          if_match_section: referral.sectionVersions.workflow,
          target_stage: targetStage,
        },
      });
      const transitionPayload = await transition.json();
      expect(transition.ok(), JSON.stringify(transitionPayload)).toBeTruthy();
      referral = transitionPayload.referral as DeclineReferral;
    }

    const assessmentCreate = await page.request.post(`/api/referrals/${referral.id}/assessments`, {
      data: {
        client_mutation_id: `decline-assessment-${randomUUID()}`,
        data: {
          resident_number: `EM-${randomUUID().slice(0, 8)}`,
          date_of_birth: "1980-01-01",
          primary_diagnosis: "Schizoaffective disorder",
          adl_needs: "Needs reminders",
          elopement_risk: "Low",
          medication_adherence: "Consistent with support",
        },
      },
    });
    const assessmentPayload = await assessmentCreate.json();
    expect(assessmentCreate.status(), JSON.stringify(assessmentPayload)).toBe(201);
    const schedule = await page.request.post(`/api/assessments/${assessmentPayload.assessment.assessment_id}/schedule`, {
      data: {
        if_match: assessmentPayload.assessment.version,
        client_mutation_id: `decline-schedule-${randomUUID()}`,
        schedule: {
          status: "scheduled",
          start_at: "2026-08-26T16:00:00.000Z",
          duration_minutes: 60,
          method: "in_person",
          location: "San Pablo",
        },
      },
    });
    const schedulePayload = await schedule.json();
    expect(schedule.ok(), JSON.stringify(schedulePayload)).toBeTruthy();
    const start = await page.request.post(`/api/assessments/${assessmentPayload.assessment.assessment_id}/start`, {
      data: {
        if_match: schedulePayload.assessment.version,
        client_mutation_id: `decline-start-${randomUUID()}`,
      },
    });
    const startPayload = await start.json();
    expect(start.ok(), JSON.stringify(startPayload)).toBeTruthy();
    const completedAssessment = await page.request.patch(`/api/assessments/${assessmentPayload.assessment.assessment_id}`, {
      data: {
        if_match: startPayload.assessment.version,
        patch: { data: completedAssessmentPatch(startPayload.assessment) },
      },
    });
    const completedAssessmentPayload = await completedAssessment.json();
    expect(completedAssessment.ok(), JSON.stringify(completedAssessmentPayload)).toBeTruthy();
    const sign = await page.request.post(`/api/assessments/${assessmentPayload.assessment.assessment_id}/sign`, {
      data: {
        if_match: completedAssessmentPayload.assessment.version,
        client_mutation_id: `decline-sign-${randomUUID()}`,
      },
    });
    const signPayload = await sign.json();
    expect(sign.ok(), JSON.stringify(signPayload)).toBeTruthy();

    const review = await page.request.get(`/api/referrals/${referral.id}`);
    referral = (await review.json()).referral as DeclineReferral;
    expect(referral.stage).toBe("Assessment");
    const recommendation = await page.request.put(`/api/referrals/${referral.id}/recommendation`, {
      data: {
        if_match: referral.version,
        if_match_section: referral.sectionVersions.decision,
        assessment_id: signPayload.assessment.assessment_id,
        outcome: "decline",
        reason_code: "clinical_fit",
        reason_note: "Needs exceed the community's documented service capability.",
      },
    });
    const recommendationPayload = await recommendation.json();
    expect(recommendation.ok(), JSON.stringify(recommendationPayload)).toBeTruthy();
    referral = recommendationPayload.referral as DeclineReferral;

    const missingReason = await page.request.put(`/api/referrals/${referral.id}/decision`, {
      data: {
        if_match: referral.version,
        if_match_section: referral.sectionVersions.decision,
        outcome: "declined",
        reason_code: "clinical_fit",
        reason_note: "",
      },
    });
    expect(missingReason.status()).toBe(422);
    await expect(missingReason.json()).resolves.toMatchObject({
      blockers: [{ code: "decline_reason_required" }],
    });

    const declined = await page.request.put(`/api/referrals/${referral.id}/decision`, {
      data: {
        if_match: referral.version,
        if_match_section: referral.sectionVersions.decision,
        outcome: "declined",
        reason_code: "clinical_fit",
        reason_note: "Needs exceed the community's documented service capability.",
      },
    });
    const declinedPayload = await declined.json();
    expect(declined.ok(), JSON.stringify(declinedPayload)).toBeTruthy();
    expect(declinedPayload.referral).toMatchObject({ stage: "Declined" });
    expect(declinedPayload.decision).toMatchObject({
      outcome: "declined",
      reasonCode: "clinical_fit",
      decidedBy: "playwright@pipeline.local",
    });

    const savedDecision = await page.request.get(`/api/referrals/${referral.id}/decision`);
    await expect(savedDecision.json()).resolves.toMatchObject({
      decision: {
        outcome: "declined",
        reasonNote: "Needs exceed the community's documented service capability.",
      },
    });
  });

  test("builds the supervisor queue from canonical unresolved conditions", async ({ page }) => {
    const createdAt = new Date(Date.now() - 72 * 60 * 60 * 1_000).toISOString();
    const created = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `supervisor-exception-${randomUUID()}`,
        referral: {
          name: `Synthetic Queue ${randomUUID().slice(0, 8)}`,
          date: createdAt.slice(0, 10),
          stage: "New",
          community: "San Pablo",
          source: "Synthetic queue journey",
          priority: "standard",
          tags: ["supervisor-test"],
          documentName: "",
          documentStatus: "Missing",
          owner: "",
          note: "",
          createdAt,
          dob: "",
          phone: "",
          email: "",
          payer: "",
          requirements: [],
        },
      },
    });
    expect(created.status()).toBe(201);
    const referralId = (await created.json()).referral.id;
    const queue = await page.request.get("/api/operations/supervisor-queue");
    expect(queue.ok()).toBeTruthy();
    const payload = await queue.json() as { items: Array<{ kind: string; referral_id: number }> };
    expect(payload.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "unassigned_referral", referral_id: referralId }),
      expect.objectContaining({ kind: "stale_referral", referral_id: referralId }),
    ]));
  });
});
