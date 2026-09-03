import { expect, test } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assessmentToolFieldDefinitions,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
} from "../../lib/assessment/assessment-tool-schema";
import { assessmentInterviewQuestions } from "../../lib/assessment/assessment-interview-schema";
import type { PipelineAssessmentRecord } from "../../lib/assessment/assessment-records";

const clinicalFixture = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/fixtures/alamo-pipeline-clinical.sanitized.json"), "utf8"),
) as {
  roster: Record<string, unknown>;
  resident: Record<string, unknown>;
  clients: Record<string, unknown>;
  client: Record<string, unknown>;
};

const unifiedProfileFixture = {
  ...clinicalFixture.client,
  resident: clinicalFixture.resident.resident,
  history: {
    status: "unavailable",
    source: null,
    data_as_of: null,
    imported_at: null,
    warning: "No legacy placement history fixture is loaded.",
    episode_count: 0,
    current_episode_count: 0,
    discharged_episode_count: 0,
    first_admit_date: null,
    latest_admit_date: null,
    quality_flags: [],
    episodes: [],
  },
  pipeline: {
    permissions: {
      can_create_identity_candidate: true,
      can_review_identity: true,
    },
    connection: {
      status: "unlinked",
      confirmed_link: null,
      candidates: [],
      suggestions: [],
      message: "No reviewed Pipeline identity link exists. Suggestions never join records automatically.",
    },
    referrals: [],
    assessments: [],
    requirements: [],
    documents: [],
    summary: {
      referral_count: 0,
      active_referral_count: 0,
      assessment_count: 0,
      latest_assessment_status: null,
      latest_assessment_completion_pct: null,
      open_requirement_count: 0,
      blocker_count: 0,
      document_count: 0,
      actions_needed: ["Create and review a resident link"],
    },
  },
};

const clientDirectoryFixture = {
  ...clinicalFixture.clients,
  clients: ((clinicalFixture.clients as { clients: Array<Record<string, unknown>> }).clients ?? []).map((client) => ({
    ...client,
    workspace_origin: "alamo_platform",
    pipeline_client_id: null,
    referral_count: 0,
    document_count: 0,
  })),
};

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
  test.beforeEach(async ({ page }) => {
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
    const [pipelinePosition, searchPosition] = await Promise.all([
      page.locator('[data-pipeline-home="true"]').boundingBox(),
      page.getByRole("button", { name: "Open search" }).boundingBox(),
    ]);
    expect(pipelinePosition?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(searchPosition?.x ?? 0);
    await expect(page.getByText("Referral workspaces", { exact: true }).last()).toBeVisible();
    await expect(page.getByLabel("Select referral packet")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Current work", exact: true })).toBeVisible();
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
      page.getByRole("button", { name: "Open search" }),
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

    await page.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByRole("button", { name: "Close search" })).toHaveCSS(
      "background-color",
      "rgb(255, 243, 220)",
    );
    await expect(page.getByLabel("Search or ask")).toBeVisible();
    await expect(page.getByText("Referral workspaces", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Welcome( back)?, / })).toHaveCount(0);
    await page.getByRole("button", { name: "Close search" }).click();
    await expect(page.getByLabel("Search or ask")).toHaveCount(0);
    await expect(page.getByText("Referral workspaces", { exact: true }).last()).toBeVisible();
    await page.getByRole("button", { name: "Open search" }).click();
    await page.getByRole("button", { name: "Open referrals" }).click();
    await expect(page.getByLabel("Search or ask")).toHaveCount(0);
    await expect(page.getByText("Referral workspaces", { exact: true }).last()).toBeVisible();
  });

  test("filters and sorts the complete workspace directory", async ({ page }) => {
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

    const creationMonth = page.getByLabel("Filter by workspace month");
    await expect(creationMonth).toContainText("August 2026 (4)");
    await expect(creationMonth).toContainText("November 2025 (7)");
    await creationMonth.selectOption("2025-11");
    await expect.poll(() => requestedMonth).toBe("2025-11");
    await expect(creationMonth).toHaveValue("2025-11");

    await page.getByLabel("Filter workspaces by community").selectOption("San Pablo");
    await expect.poll(() => requestedCommunity).toBe("San Pablo");
    await page.getByLabel("Sort workspaces").selectOption("owner_asc");
    await expect.poll(() => requestedSort).toBe("owner_asc");
    await expect(page.getByLabel("Sort workspaces")).toHaveValue("owner_asc");
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
    const savePacket = page.getByRole("button", { name: /^(Create workspace|Save workspace)$/ });
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
    await expect(page.getByRole("region", { name: "Search and ask" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Ready to schedule" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Data completion" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent" })).toBeVisible();

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

  test("requires an initial document and recalls the saved referral chart", async ({ page }) => {
    const clientName = `Referral chart ${randomUUID().slice(0, 8)}`;
    await page.getByRole("button", { name: "Create new referral" }).click();

    await expect(page.getByRole("region", { name: "Intake", exact: true })).toBeVisible();
    const documentChecklist = page.getByRole("region", { name: "Document checklist" });
    await expect(documentChecklist).toBeVisible();
    const documentPanel = page.getByTestId("document-checklist-panel");
    const documentToggle = page.getByTestId("document-checklist-toggle");
    await expect(documentPanel).not.toHaveAttribute("open", "");
    await expect(page.getByRole("region", { name: "Initial referral packet" })).toBeHidden();
    await expect(page.getByRole("region", { name: "Identity chart section" })).toBeVisible();
    await documentToggle.click();
    await expect(documentPanel).toHaveAttribute("open", "");
    await expect(documentChecklist.getByRole("button", { name: /drop document or browse$/ })).toHaveCount(8);
    await expect(page.getByRole("complementary", { name: "Chart completion" })).toBeVisible();
    const documentChecklistBox = await documentChecklist.boundingBox();
    const identityBox = await page.getByRole("region", { name: "Identity chart section" }).boundingBox();
    expect(documentChecklistBox).not.toBeNull();
    expect(identityBox).not.toBeNull();
    expect((documentChecklistBox?.y ?? 0) + (documentChecklistBox?.height ?? 0)).toBeLessThanOrEqual(identityBox?.y ?? 0);
    await expect(page.getByText("Upload a face sheet or referral packet to create the referral.", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(clientName);
    await page.getByRole("textbox", { name: "DOB", exact: true }).fill("06/12/1984");
    await page.getByRole("combobox", { name: "Community:" }).selectOption("San Pablo");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Contra Costa County");
    await page.getByRole("textbox", { name: "Referent:", exact: true }).fill("San Pablo intake team");
    await page.getByRole("combobox", { name: "Owner (@name):" }).selectOption({ label: "Playwright QA" });
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true }).fill("Referral chart created from the initial document.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByText("Upload the initial face sheet or referral packet before creating this referral.", { exact: true })).toBeVisible();
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "required-face-sheet.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(`required-face-sheet-${randomUUID()}`),
    });
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();

    await expect(page.getByRole("button", { name: "Save workspace", exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
    const referralId = new URL(page.url()).searchParams.get("referralId");
    expect(referralId).not.toBeNull();

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
    await page.getByTestId("document-checklist-toggle").click();
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(payload.referral.name);
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true })).toHaveValue("Referral chart created from the initial document.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Signed Medication List: drop document or browse" })).toBeVisible();
  });

  test("starts a clean intake every time New referral is explicitly opened", async ({ page }) => {
    const existingName = `Existing ${randomUUID().slice(0, 8)}`;
    const createdResponse = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `new-intake-reset-${randomUUID()}`,
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
          owner: "Playwright QA",
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
    const savePacket = page.getByRole("button", { name: /^(Create workspace|Save workspace)$/ });
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

    await page.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByLabel("Search or ask")).toBeVisible();
    await page.getByRole("button", { name: "Open client profiles" }).click();
    await expect(page.getByLabel("Search or ask")).toHaveCount(0);
    await expect(page.getByRole("main", { name: "Client profiles" })).toBeVisible();
  });

  test("shows assigned referrals and scheduled assessments as distinct calendar events", async ({ page }) => {
    let schedulePayload: Record<string, unknown> | null = null;
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
    await page.route("**/api/calendar/events?*", async (route) => {
      const requestUrl = new URL(route.request().url());
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
          scope: "team",
          viewer: { id: "playwright-user", name: "Playwright QA" },
          timezone: "America/Los_Angeles",
          generated_at: new Date().toISOString(),
        }),
      });
    });

    await page.getByRole("button", { name: "Open calendar", exact: true }).click();
    await expect(page.getByText("Team schedule", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Supervisor team week" })).toBeVisible();
    await expect(page.getByText("1 assignment/follow-up", { exact: true })).toBeVisible();
    await expect(page.locator('button[title^="Scheduled Client - Assessment scheduled"]')).toHaveClass(/bg-\[#eef1ff\]/);

    await page.getByRole("combobox", { name: "Filter calendar by assessor" }).selectOption({ label: "Playwright QA" });
    await expect(page.getByRole("region", { name: "Timed assessment week" })).toBeVisible();
    await expect(page.getByText("Assigned Client", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Scheduled Client", { exact: true }).first()).toBeVisible();
    await expect(page.locator('button[title^="Assigned Client - Referral assigned"]')).toHaveClass(/bg-\[#e8f5f1\]/);
    await expect(page.locator('button[title^="Scheduled Client - Assessment scheduled"]')).toHaveClass(/bg-\[#eef1ff\]/);
    await expect(page.getByRole("combobox", { name: "Filter calendar by event type" })).toContainText("Referral assignments");
    await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Open search" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create new referral" })).toBeVisible();

    await page.getByRole("button", { name: "Schedule assessment", exact: true }).click();
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
    await expect(page.locator("button:visible").filter({ hasText: "Assigned Client" }).first()).toContainText("Referral assigned");
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
          referral: {
            name: `Calendar Conflict ${suffix} ${randomUUID().slice(0, 6)}`,
            date: "2031-02-01",
            stage: "New",
            community: "San Pablo",
            source: "Calendar conflict test",
            priority: "standard",
            tags: ["calendar-conflict-test"],
            documentName: "",
            documentStatus: "Missing",
            owner: "Playwright QA",
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
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Playwright\./ })).toBeVisible();
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
          owner: "Playwright QA",
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
    await page.getByRole("button", { name: "Current work", exact: true }).click();

    const workflow = page.getByRole("region", { name: "Referral workflow tracker" });
    await expect(workflow).toBeVisible();
    await expect(workflow.getByRole("button", { name: `Open ${createdPayload.referral.name} referral workspace` })).toBeVisible();
    const rowsBefore = await workflow.getByRole("button").count();
    expect(rowsBefore).toBeGreaterThan(0);

    await page.route(/\/api\/referrals\/directory\?/, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Referral refresh unavailable." }) });
    });
    await page.getByRole("button", { name: "Refresh referral workflow" }).click();
    await expect(page.getByText("Referral refresh unavailable.", { exact: true })).toBeVisible();
    await expect.poll(() => workflow.getByRole("button").count()).toBe(rowsBefore);
  });

  test("browses all uploaded files without duplicate month navigation", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^All files/ })).toBeVisible();
    await expect(page.getByLabel("Filter by workspace month")).toBeVisible();
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
    await expect(page.getByRole("dialog", { name: "Profile menu" })).toHaveCount(0);
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
            owner: "Playwright QA",
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
            owner: "Playwright QA",
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
      await page.getByRole("textbox", { name: "NAME", exact: true }).fill(localName);
      await secondPage.getByRole("textbox", { name: "NAME", exact: true }).fill(remoteName);
      await secondPage.getByRole("button", { name: /^(Create workspace|Save workspace)$/ }).click();
      await expect.poll(async () => {
        const response = await page.request.get(`/api/referrals/${base.id}`);
        return ((await response.json()) as { referral: { name: string } }).referral.name;
      }).toBe(remoteName);

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
          owner: "Playwright QA",
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
    await page.getByRole("button", { name: "Done", exact: true }).click();
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
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await expect.poll(async () => {
      const response = await page.request.get(`/api/referrals/${created.referral.id}`);
      return ((await response.json()) as { referral: { note?: string } }).referral.note;
    }, { timeout: 8_000 }).toContain("## Additional context\nRecovered synthetic summary draft.");
    await expect(page.getByText(/Autosaved/).first()).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Summary: Additional context", exact: true })).toHaveValue("Recovered synthetic summary draft.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
  });

  test("protects worker endpoints and rejects malformed callbacks before touching storage", async ({ page }) => {
    expect((await page.request.get("/api/internal/extraction/queue")).status()).toBe(401);
    const malformed = await page.request.post("/api/internal/extraction/report", {
      headers: { Authorization: "Bearer playwright-worker-secret" },
      data: { status: "succeeded" },
    });
    expect(malformed.status()).toBe(400);
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
    await page.getByRole("combobox", { name: "Owner (@name):" }).selectOption({ label: "Playwright QA" });
    await page.getByRole("textbox", { name: "Referral received:" }).fill("2026-08-09");
    await page.getByRole("textbox", { name: "Admission date:" }).fill("2026-08-20");
    await page.getByRole("textbox", { name: "Referent:" }).fill("Synthetic County Access");
    await page.getByRole("textbox", { name: "Responsible Person:" }).fill("Synthetic Responsible Person");
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true }).fill("Referral summary for packet review.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("textbox", { name: "Tags", exact: true }).fill("Urgent Review, county-intake");
    await page.getByRole("button", { name: "yes", exact: true }).click();

    await page.getByTestId("document-checklist-toggle").click();
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "face-sheet.pdf",
      mimeType: "application/pdf",
      buffer: packetBytes,
    });
    await page.getByLabel("Initial document type").selectOption("face_sheet");

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
    await page.getByRole("button", { name: /^(Create workspace|Save workspace)$/ }).click();
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
      owner: "Playwright QA",
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

    const pipelineClientId = referralList.referrals[0]?.clientId;
    expect(pipelineClientId).toBeTruthy();
    const clientIdentityTitle = referralPayload.referral.name;
    await page.goto(`/?screen=profile&clientId=${encodeURIComponent(`pipeline:${pipelineClientId}`)}`);
    await expect(page.getByRole("heading", { name: clientIdentityTitle, exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic gender · San Pablo · Referral profile", { exact: true })).toBeVisible();
    const referralHistory = page.getByRole("region", { name: "1 referral in referral history" });
    await expect(referralHistory).toBeVisible();
    await expect(referralHistory.getByText("Synthetic County Access", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Referral documents", exact: true })).toBeVisible();
    await expect(page.getByText("face-sheet.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("synthetic-medication-list.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("synthetic-provider-form.pdf", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Assessments", exact: true })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("No referral history", { exact: true })).toHaveCount(0);

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
    await expect(page.getByRole("textbox", { name: "DOB", exact: true })).toHaveValue("1951-08-15");
    await expect(page.getByRole("textbox", { name: "SSN", exact: true })).toHaveValue("000-00-0000");
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true })).toHaveValue("Referral summary for packet review.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
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
    await page.getByRole("button", { name: /^(Create workspace|Save workspace)$/ }).click();

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
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "first-copy.pdf",
      mimeType: "application/pdf",
      buffer: packetBytes,
    });
    await page.getByRole("button", { name: /^(Create workspace|Save workspace)$/ }).click();
    await page.getByTestId("document-checklist-toggle").click();
    await expect(page.getByRole("region", { name: "Initial referral packet" })
      .getByRole("button", { name: /first-copy\.pdf Uploaded/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Extraction review" })).toBeVisible();

    await page.goto("/?view=referrals&screen=packet");
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(secondClient);
    await page.getByRole("combobox", { name: "Community:" }).selectOption("Turlock");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Stanislaus County");
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "renamed-copy.pdf",
      mimeType: "application/pdf",
      buffer: packetBytes,
    });
    await page.getByRole("button", { name: /^(Create workspace|Save workspace)$/ }).click();
    await expect(page.getByText("This exact packet is already attached to a referral. Open the existing referral instead.", { exact: true })).toBeVisible();

    const duplicateResponse = await page.request.get(`/api/referrals?q=${encodeURIComponent(secondClient)}`);
    const duplicateList = await duplicateResponse.json() as { total: number };
    expect(duplicateList.total).toBe(0);
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
    await expect(page.getByText("Save the referral before starting the assessment", { exact: true })).toBeVisible();

    await expect(page.getByRole("button", { name: "03 Decision" })).toHaveCount(0);
  });

  test("schedules, completes, signs, and recalls an assessment", async ({ page }) => {
    const clientName = `Assessment ${uniqueAlphabeticNameToken()}`;
    await page.getByRole("button", { name: "Create new referral" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(clientName);
    await page.getByRole("textbox", { name: "DOB", exact: true }).fill("06/12/1984");
    await page.getByRole("combobox", { name: "Community:" }).selectOption("San Pablo");
    await page.getByRole("combobox", { name: "County:" }).selectOption("Contra Costa County");
    await page.getByRole("textbox", { name: "Referent:", exact: true }).fill("San Pablo intake team");
    await page.getByRole("combobox", { name: "Owner (@name):" }).selectOption({ label: "Playwright QA" });
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "assessment-referral.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(`assessment-referral-${randomUUID()}`),
    });
    await page.getByRole("button", { name: /^(Create workspace|Save workspace)$/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
    const referralId = new URL(page.url()).searchParams.get("referralId");
    expect(referralId).toBeTruthy();
    await page.getByTestId("document-checklist-toggle").click();
    await expect(page.getByRole("region", { name: "Initial referral packet" })
      .getByRole("button", { name: /assessment-referral\.pdf Uploaded/ })).toBeVisible();
    const packetReview = page.getByRole("region", { name: "Extraction review" });
    await expect(packetReview).toBeVisible();
    await page.getByRole("button", { name: "02 Assessment" }).click();
    await expect(page.getByRole("button", { name: "Schedule assessment" })).toBeVisible();
    await page.getByRole("button", { name: "01 Intake" }).click();
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
    await expect(assessmentInterview.getByText("Playwright QA", { exact: true })).toBeVisible();
    const scheduleDialog = page.getByRole("dialog", { name: "Schedule assessment" });
    await scheduleDialog.getByLabel("Assessment date and time").fill("2026-08-26T09:00");
    await scheduleDialog.getByLabel("Assessment location or link").fill("San Pablo interview room");
    await scheduleDialog.getByRole("button", { name: "Schedule assessment", exact: true }).click();
    const beginDialog = page.getByRole("dialog", { name: "Begin assessment" });
    await expect(beginDialog).toBeVisible();
    await beginDialog.getByRole("button", { name: "Begin assessment", exact: true }).click();
    await assessmentInterview.getByRole("button", { name: /^History/ }).click();
    await assessmentInterview.getByLabel("Prior placements", { exact: true }).fill("Client reports one prior placement; dates and discharge reason are not yet verified.");
    await assessmentInterview.getByText("Answer format", { exact: true }).first().click();
    await expect(assessmentInterview.getByText("Use this order", { exact: true }).first()).toBeVisible();
    await expect(assessmentInterview.getByText("Include", { exact: true }).first()).toBeVisible();
    await expect(assessmentInterview.getByText("Example format", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Function/ }).click();
    const languageBarrier = page.getByRole("group", { name: "Language barrier", exact: true });
    await languageBarrier.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(page.getByLabel(/Language support needed/)).toBeVisible();
    await page.getByLabel(/Language support needed/).fill("Interpreter requested");
    await languageBarrier.getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByLabel(/Language support needed/)).toHaveCount(0);
    await languageBarrier.getByRole("button", { name: "Unable to assess", exact: true }).click();
    const unableReason = page.getByLabel("Why could this not be assessed? *", { exact: true });
    await expect(unableReason).toBeVisible();
    await expect(page.getByText("An explanation is required before this assessment can be signed.", { exact: true })).toBeVisible();
    await unableReason.fill("The client could not participate and no collateral source was available.");
    await expect(page.getByText("An explanation is required before this assessment can be signed.", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^Client & referral/ }).click();
    await page.getByLabel(/Resident number/).fill(`EM-${randomUUID().slice(0, 8)}`);
    await page.getByLabel(/Date of birth/).fill("1984-06-12");
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({ timeout: 8_000 });

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
    await expect(page.getByText("Assessment signed", { exact: true })).toBeVisible();

    const history = await page.request.get(`/api/referrals/${referralId}/assessments`);
    expect(history.ok()).toBeTruthy();
    const historyPayload = await history.json() as { assessments: Array<{ assessment_id: string; status: string; primary_diagnosis: string; medications_at_intake: string[]; unable_to_assess_reasons: Record<string, string>; version: number; assessor_id: string | null; assessor: string | null; completed_at: string | null; signed_at: string | null; signed_by: { id: string; name: string } | null }> };
    expect(historyPayload.assessments[0]).toMatchObject({
      status: "complete",
      primary_diagnosis: "Schizoaffective disorder",
    });
    expect(historyPayload.assessments[0].version).toBeGreaterThanOrEqual(4);
    expect(historyPayload.assessments[0].assessor_id).toBeTruthy();
    expect(historyPayload.assessments[0].assessor).toBe("Playwright QA");
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
      expect.objectContaining({ assessor_name: "Playwright QA", completed_assessments: expect.any(Number) }),
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

    await page.getByRole("button", { name: "Close assessment", exact: true }).click();
    await page.getByRole("button", { name: "Workspace activity" }).click();
    const activityPanel = page.getByRole("region", { name: "Referral ownership and activity" });
    await expect(activityPanel).toBeVisible();
    await expect(activityPanel.getByText("Ownership and timing", { exact: true })).toBeVisible();
    await expect(activityPanel.getByText("Playwright QA", { exact: true }).first()).toBeVisible();
    await expect(activityPanel.getByText("Assessment time", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "03 Decision" })).toHaveCount(0);
  });

  test("versions the EHR handoff and records failure recovery explicitly", async ({ page }) => {
    const membersResponse = await page.request.get("/api/members");
    const membersPayload = await membersResponse.json() as {
      members: Array<{ principal_id: string; display_name: string }>;
      current_principal_id: string;
    };
    const currentMember = membersPayload.members.find(
      (member) => member.principal_id === membersPayload.current_principal_id,
    );
    expect(currentMember).toBeTruthy();

    const now = new Date().toISOString();
    const create = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `ehr-handoff-${randomUUID()}`,
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
          owner: currentMember!.display_name,
          assignee_id: currentMember!.principal_id,
          note: "",
          createdAt: now,
          dob: "1980-01-01",
          phone: "",
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

    const communityReviewResponse = await page.request.get(`/api/referrals/${referral.id}`);
    referral = (await communityReviewResponse.json()).referral as WorkflowReferral;
    expect(referral.stage).toBe("Assessment");
    const recommendationResponse = await page.request.put(`/api/referrals/${referral.id}/recommendation`, {
      data: {
        if_match: referral.version,
        if_match_section: referral.sectionVersions.decision,
        assessment_id: signedAssessmentPayload.assessment.assessment_id,
        outcome: "accept",
        reason_code: "clinical_fit",
        reason_note: "Synthetic acceptance recommendation for the EHR handoff journey.",
      },
    });
    const recommendationPayload = await recommendationResponse.json();
    expect(recommendationResponse.ok(), JSON.stringify(recommendationPayload)).toBeTruthy();
    referral = recommendationPayload.referral as WorkflowReferral;
    const decisionResponse = await page.request.put(`/api/referrals/${referral.id}/decision`, {
      data: {
        if_match: referral.version,
        if_match_section: referral.sectionVersions.decision,
        outcome: "accepted",
        reason_code: "",
        reason_note: "",
      },
    });
    const decisionPayload = await decisionResponse.json();
    expect(decisionResponse.ok(), JSON.stringify(decisionPayload)).toBeTruthy();
    referral = decisionPayload.referral;

    const blockedAcceptance = await page.request.post(`/api/referrals/${referral.id}/transition`, {
      data: {
        if_match: referral.version,
        if_match_section: referral.sectionVersions.workflow,
        target_stage: "Accepted / Admitted",
      },
    });
    expect(blockedAcceptance.status()).toBe(422);
    const blockedAcceptancePayload = await blockedAcceptance.json() as { blockers?: Array<{ code: string }> };
    expect(blockedAcceptancePayload.blockers?.some((blocker) => blocker.code.startsWith("requirement:"))).toBeTruthy();

    const blockingWorkItemsResponse = await page.request.get(`/api/referrals/${referral.id}/work-items`);
    const blockingWorkItems = (await blockingWorkItemsResponse.json()) as {
      work_items: Array<{ id: string; version: number; requiredFor: string; blocker: boolean; status: string }>;
    };
    for (const item of blockingWorkItems.work_items.filter((candidate) => (
      candidate.requiredFor === "move_in"
      && candidate.blocker
      && !["received", "reviewed", "waived"].includes(candidate.status)
    ))) {
      const waiver = await page.request.patch(`/api/referrals/${referral.id}/work-items/${item.id}`, {
        data: {
          if_match: item.version,
          patch: {
            status: "waived",
            waiverReason: "Synthetic release-journey exception approved for validation.",
          },
        },
      });
      const waiverPayload = await waiver.json();
      expect(waiver.ok(), JSON.stringify(waiverPayload)).toBeTruthy();
    }
    const readyReferralResponse = await page.request.get(`/api/referrals/${referral.id}`);
    referral = (await readyReferralResponse.json()).referral as WorkflowReferral;
    await transition("Accepted / Admitted");

    const mutate = async (action: string, failureReason = "") => {
      const response = await page.request.post(`/api/referrals/${referral.id}/ehr-handoff`, {
        data: {
          if_match: referral.version,
          if_match_section: referral.sectionVersions.decision,
          action,
          failure_reason: failureReason,
        },
      });
      const payload = await response.json();
      if (response.ok()) referral = payload.referral;
      return { response, payload };
    };

    const queued = await mutate("queue");
    expect(queued.response.ok()).toBeTruthy();
    expect(queued.payload.ehr_handoff.status).toBe("queued");
    const stale = await page.request.post(`/api/referrals/${referral.id}/ehr-handoff`, {
      data: { if_match: 1, if_match_section: 1, action: "mark_sent" },
    });
    expect(stale.status()).toBe(409);
    const missingReason = await mutate("mark_failed");
    expect(missingReason.response.status()).toBe(422);
    const failed = await mutate("mark_failed", "Synthetic downstream rejection");
    expect(failed.response.ok()).toBeTruthy();
    expect(failed.payload.ehr_handoff.status).toBe("failed");
    const supervisorQueue = await page.request.get("/api/operations/supervisor-queue");
    expect(supervisorQueue.ok()).toBeTruthy();
    await expect(supervisorQueue.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "ehr_handoff_failed", referral_id: referral.id }),
      ]),
    });
    const retried = await mutate("retry");
    expect(retried.response.ok()).toBeTruthy();
    expect(retried.payload.ehr_handoff.status).toBe("queued");
    const sent = await mutate("mark_sent");
    expect(sent.response.ok()).toBeTruthy();
    expect(sent.payload.ehr_handoff.status).toBe("sent");
  });

  test("requires a documented reason and closes a declined referral", async ({ page }) => {
    const membersResponse = await page.request.get("/api/members");
    const membersPayload = await membersResponse.json() as {
      members: Array<{ principal_id: string; display_name: string }>;
      current_principal_id: string;
    };
    const currentMember = membersPayload.members.find(
      (member) => member.principal_id === membersPayload.current_principal_id,
    );
    expect(currentMember).toBeTruthy();

    const now = new Date().toISOString();
    const create = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `decline-journey-${randomUUID()}`,
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
          owner: currentMember!.display_name,
          assignee_id: currentMember!.principal_id,
          note: "",
          createdAt: now,
          dob: "1980-01-01",
          phone: "",
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
      decidedBy: currentMember!.principal_id,
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

test.describe("Pipeline home", () => {
  test("keeps the home surface calm and search-focused", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("/_next/webpack-hmr")) {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Playwright\./ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Team metrics" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Ready to schedule" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Data completion" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent" })).toBeVisible();
    await expect(page.getByLabel("Search or ask")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pipeline home" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Alamo Platform" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Alamo Platform" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Analytics" })).toHaveCount(0);
    await expect(page.getByText("Workspaces", { exact: true })).toBeVisible();
    await expect(page.getByText("Calendar", { exact: true })).toBeVisible();
    await expect(page.getByText("Clients", { exact: true })).toBeVisible();
    await expect(page.getByText("Reports", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Create new referral" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open search" })).toBeVisible();
    await expect(page.getByText("New referral", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Search", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Referral workspaces", { exact: true })).toHaveCount(0);
    const signedInProfile = page.getByRole("button", { name: "Open profile menu for Playwright QA" });
    await signedInProfile.click();
    await expect(page.getByRole("dialog", { name: "Profile menu" }).getByText("Playwright QA", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pipeline operations Queue, ownership, and record gaps" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open reports" })).toBeVisible();
    const referralsLink = page.getByRole("button", { name: "Open referrals" });
    await expect(referralsLink).toBeVisible();
    await referralsLink.hover();
    await expect(page.getByText("Workspaces", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByLabel("Search or ask")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Playwright\./ })).toHaveCount(0);
    await page.getByLabel("Search or ask").click();
    await expect(page.getByText("5 suggested searches", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show my assigned workspaces." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show unassigned workspaces." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Which assessments are ready to schedule?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show scheduled assessments." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show uploaded documents." })).toBeVisible();
    await page.getByRole("button", { name: "Show my assigned workspaces." }).click();
    await expect(
      page.getByText("Results", { exact: true }).or(
        page.getByText("No records match that search.", { exact: true }),
      ),
    ).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("keeps every suggested search aligned with its backend filter", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const modes = ["my_work", "unassigned", "ready_to_schedule", "scheduled_assessments", "files"] as const;
    for (const mode of modes) {
      const response = await page.request.get(`/api/search?mode=${mode}&q=${encodeURIComponent(mode)}`);
      expect(response.ok()).toBeTruthy();
      const payload = await response.json() as {
        interpreted_query: string;
        referrals: Array<{ id: number; owner: string; workflowStatus?: string }>;
        files: Array<{ id: string }>;
        counts: { referrals: number; files: number; total: number };
      };
      expect(payload.interpreted_query).toBe(mode);
      expect(payload.counts.total).toBe(payload.counts.referrals + payload.counts.files);

      if (mode === "files") {
        expect(payload.referrals).toEqual([]);
        expect(payload.counts.files).toBeGreaterThanOrEqual(payload.files.length);
        continue;
      }

      if (mode === "my_work") {
        expect(payload.referrals.every((referral) => referral.owner === "Playwright QA")).toBeTruthy();
      } else if (mode === "unassigned") {
        expect(payload.referrals.every((referral) => !referral.owner || referral.owner === "Unassigned")).toBeTruthy();
      } else {
        const expectedStatus = mode === "ready_to_schedule" ? "ready_to_schedule" : "assessment_scheduled";
        expect(payload.referrals.every((referral) => referral.workflowStatus === expectedStatus)).toBeTruthy();
      }
      expect(payload.counts.referrals).toBeGreaterThanOrEqual(payload.referrals.length);
    }
  });

  test("opens a file result as the file instead of its workspace", async ({ page }) => {
    const fileName = "Historical packet.pdf";
    await page.route("**/api/search**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: "Historical packet",
          interpreted_query: "Historical packet",
          referrals: [],
          files: [{
            id: "search-file-1",
            name: fileName,
            category: "Referral packet",
            referralId: 1,
            clientId: "historical-client-1",
            canonicalClientId: "pipeline:historical-client-1",
            referralName: "Historical Client",
            community: "San Pablo",
            uploadedAt: "2026-08-10T12:00:00.000Z",
            status: "Reviewed",
            previewStatus: "ready",
            previewUrl: "/api/files/search-file-1/preview",
            downloadUrl: "/api/files/search-file-1/download",
          }],
          clients: [],
          clinical_warning: null,
          counts: { referrals: 0, files: 1, clients: 0, total: 1 },
        }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Open search" }).click();
    await page.getByLabel("Search or ask").fill("Historical packet");
    const fileResult = page.getByRole("link", { name: `Open file ${fileName}` });
    await expect(fileResult).toHaveAttribute("href", "/api/files/search-file-1/download");
    await expect(fileResult).toHaveAttribute("target", "_blank");
  });

  test("shows local search results before governed client search completes", async ({ page }) => {
    await page.route("**/api/search**", async (route) => {
      const scope = new URL(route.request().url()).searchParams.get("scope");
      if (scope === "clinical") {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            query: "Maldonado",
            interpreted_query: "maldonado",
            referrals: [],
            files: [],
            clients: [],
            destinations: [],
            sources: { local: false, clinical: true, clinical_available: true },
            counts: { referrals: 0, files: 0, clients: 0, destinations: 0, total: 0 },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: "Maldonado",
          interpreted_query: "maldonado",
          referrals: [{
            id: 91,
            name: "Krishna Maldonado",
            community: "San Pablo",
            stage: "Packet Review",
          }],
          files: [],
          clients: [],
          destinations: [],
          sources: { local: true, clinical: false, clinical_available: false },
          counts: { referrals: 1, files: 0, clients: 0, destinations: 0, total: 1 },
        }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Open search" }).click();
    await page.getByLabel("Search or ask").fill("Maldonado");
    await expect(page.getByRole("button", { name: "Open workspace for Krishna Maldonado" })).toBeVisible();
    await expect(page.getByText("1 result · checking clients", { exact: true })).toBeVisible();
    await expect(page.getByText("1 result", { exact: true })).toBeVisible({ timeout: 4_000 });
  });

  test("opens a canonical client from search and restores it from Recents", async ({ page }) => {
    const client = (clinicalFixture.clients as {
      clients: Array<{
        canonical_client_id: string;
        display_name: string;
        current_community: string | null;
        unit: string | null;
      }>;
    }).clients[0];

    await page.addInitScript(() => {
      window.sessionStorage.setItem("pipeline.recent-destinations.v1", JSON.stringify([{
        id: "profile:missing-key",
        kind: "profile",
        screen: "profile",
        title: "Broken recent",
        detail: "Missing destination",
        visitedAt: new Date().toISOString(),
      }]));
    });

    await page.route("**/api/search**", async (route) => {
      const scope = new URL(route.request().url()).searchParams.get("scope");
      const clients = scope === "clinical" ? [client] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: "Avery",
          interpreted_query: "Avery",
          referrals: [],
          files: [],
          clients,
          destinations: [],
          clinical_warning: null,
          sources: {
            local: scope === "local",
            clinical: scope === "clinical",
            clinical_available: true,
          },
          counts: { referrals: 0, files: 0, clients: clients.length, destinations: 0, total: clients.length },
        }),
      });
    });
    await page.route("**/api/profiles/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(unifiedProfileFixture) });
    });

    await page.goto("/?view=referrals");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Open search" }).click();
    await page.getByLabel("Search or ask").fill("Avery");
    await page.getByLabel("Search or ask").press("Enter");

    const clientResult = page.getByRole("button", { name: /Avery Example/ });
    await expect(clientResult).toBeVisible();
    await clientResult.click();
    await expect(page.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\?screen=profile&clientId=/);
    expect(new URL(page.url()).searchParams.has("view")).toBeFalsy();

    await page.getByRole("button", { name: "Pipeline home" }).click();
    const recent = page.getByRole("region", { name: "Recent" });
    await expect(recent.getByText("Broken recent", { exact: true })).toHaveCount(0);
    await expect(recent.getByRole("button", { name: /Avery Example/ })).toBeVisible();
    await recent.getByRole("button", { name: /Avery Example/ }).click();
    await expect(page.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
  });

  test("searches site destinations and the enhanced client directory while typing", async ({ page }) => {
    const directory = clientDirectoryFixture as unknown as {
      clients: Array<{
        canonical_client_id: string;
        display_name: string;
      }>;
      [key: string]: unknown;
    };
    const client = directory.clients[0];

    await page.route("**/api/profiles/directory**", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q")?.trim().toLowerCase() ?? "";
      const clients = query && !client.display_name.toLowerCase().includes(query) ? [] : [client];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...directory, clients, total: clients.length, next_cursor: null }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Open search" }).click();
    const globalSearch = page.getByLabel("Search or ask");
    await globalSearch.fill("profles");
    const profilesResult = page.getByRole("button", { name: "Open Clients from search" });
    await expect(profilesResult).toBeVisible();
    await profilesResult.click();

    await expect(page.getByRole("main", { name: "Client profiles" })).toBeVisible();
    const clientSearch = page.getByLabel("Search clients");
    await clientSearch.fill("Avery");
    await expect(page.getByRole("button", { name: `Open profile for ${client.display_name}` })).toBeVisible();
    await clientSearch.fill("No matching client");
    await expect(page.getByText("No clients match that search.", { exact: true })).toBeVisible();
  });

  test("returns to the same operational home workspace", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Playwright\./ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Ready to schedule" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Data completion" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent" })).toBeVisible();
    const welcomePipelinePosition = await page.locator('[data-pipeline-home="true"]').boundingBox();

    await page.getByRole("button", { name: "Open referrals" }).click();
    await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Alamo Platform" })).toHaveCount(0);
    await expect.poll(async () => {
      const workspacePipelinePosition = await page.locator('[data-pipeline-home="true"]').boundingBox();
      return workspacePipelinePosition?.x ?? Number.POSITIVE_INFINITY;
    }).toBeLessThan(welcomePipelinePosition?.x ?? 0);
    await page.getByRole("button", { name: "Pipeline home" }).click();

    await expect(page.getByRole("heading", { name: /Welcome( back)?, / })).toHaveCount(0);
    await expect(page.getByTitle("Pipeline home")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Search and ask" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Ready to schedule" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Data completion" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent" })).toBeVisible();

    const queueResponse = await page.request.get("/api/operations/my-queue");
    expect(queueResponse.ok()).toBeTruthy();
    const queue = await queueResponse.json() as {
      owner: { name: string };
      total: number;
      items: Array<{ referral_id: number; next_action: string; urgency: string }>;
    };
    expect(queue.owner.name).toBe("Playwright QA");
    expect(queue.total).toBeGreaterThanOrEqual(queue.items.length);
    if (queue.items.length > 0) {
      expect(queue.items[0]).toMatchObject({
        referral_id: expect.any(Number),
        next_action: expect.any(String),
        urgency: expect.stringMatching(/^(overdue|blocked|due_soon|stale|normal)$/),
      });
    } else {
      expect(queue.items).toEqual([]);
    }

    await page.evaluate(() => window.sessionStorage.clear());
    await page.reload();
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Playwright\./ })).toBeVisible();
  });

  test("opens the Alamo enhanced client directory and governed profile", async ({ page }) => {
    const profile = structuredClone(unifiedProfileFixture) as typeof unifiedProfileFixture & {
      client: { enrichment: Record<string, unknown> };
    };
    profile.client.enrichment.prior_placements = '["Sanitized hospital","Sanitized residential program"]';
    const thumbnail = createCanvas(320, 200);
    const thumbnailContext = thumbnail.getContext("2d");
    thumbnailContext.fillStyle = "#f2f8f6";
    thumbnailContext.fillRect(0, 0, 320, 200);
    thumbnailContext.fillStyle = "#0f8b73";
    thumbnailContext.fillRect(28, 24, 264, 10);
    thumbnailContext.fillStyle = "#d9dfdb";
    thumbnailContext.fillRect(28, 58, 210, 7);
    thumbnailContext.fillRect(28, 80, 244, 7);
    thumbnailContext.fillRect(28, 102, 188, 7);

    await page.route("**/api/clinical/clients**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clinicalFixture.clients) });
    });
    await page.context().route("**/source-documents/**/preview", async (route) => {
      await route.fulfill({ status: 200, contentType: "image/png", body: thumbnail.toBuffer("image/png") });
    });
    await page.route("**/api/profiles/**", async (route) => {
      if (route.request().url().includes("/api/profiles/directory")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clientDirectoryFixture) });
        return;
      }
      if (route.request().url().includes("/source-documents/")) {
        await route.fulfill({ status: 200, contentType: "image/png", body: thumbnail.toBuffer("image/png") });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profile) });
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Open client profiles" }).click();
    await expect(page.getByRole("main", { name: "Client profiles" })).toBeVisible();
    await expect.poll(async () => (await page.getByTestId("profiles-workspace").boundingBox())?.width ?? 0).toBeLessThanOrEqual(1240);
    await expect.poll(async () => (await page.getByTestId("profiles-workspace").boundingBox())?.width ?? 0).toBeGreaterThan(1000);
    const activeProfiles = page.getByRole("button", { name: "Open client profiles" });
    await expect(activeProfiles).toHaveAttribute("aria-pressed", "true");
    await expect(activeProfiles).toHaveAttribute("data-active", "true");
    await expect(activeProfiles).toHaveClass(/bg-\[#eef1ff\]/);
    await expect(activeProfiles).toHaveCSS("background-color", "rgb(238, 241, 255)");
    await expect(activeProfiles).toHaveCSS("border-color", "rgb(75, 104, 173)");
    await expect(page.getByText("1 client", { exact: true })).toBeVisible();
    await expect(page.getByText("Avery Example", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Avery Example/ }).click();
    await expect(page.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
    await expect.poll(async () => (await page.getByTestId("profile-workspace").boundingBox())?.width ?? 0).toBeGreaterThan(1200);
    await expect(page.getByText("Current resident", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Client information", { exact: true })).toBeVisible();
    await expect(page.getByText("Personal details", { exact: true })).toBeVisible();
    await expect(page.getByText("Admission and placement", { exact: true })).toBeVisible();
    await expect(page.getByText("Clinical overview", { exact: true })).toBeVisible();
    await expect(page.getByText("Legal and support", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Referral history", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Assessments", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Source documents", exact: true })).toBeVisible();
    await expect(
      page.getByRole("article").getByText("Sanitized referral packet.pdf", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "First-page thumbnail for Sanitized referral packet.pdf" })).toBeVisible();
    const sourceDocumentLink = page.getByRole("link", { name: "Open Sanitized referral packet.pdf" });
    await expect(sourceDocumentLink).toHaveAttribute("href", /\/source-documents\/doc-sanitized-100\/preview$/);
    const sourceDocumentWindow = page.waitForEvent("popup");
    await sourceDocumentLink.click();
    await expect((await sourceDocumentWindow).locator("body")).toBeVisible();
    await expect(page.getByText("Stay history", { exact: true })).toBeVisible();
    await expect(page.getByText("Canonical client id", { exact: true })).toHaveCount(0);
    await expect(page.getByText("client-sanitized-100", { exact: true })).toHaveCount(0);
    await expect(page.getByText("141 governed fields", { exact: true })).toHaveCount(0);
    await expect(page.getByText("No referral history has been connected to this client.", { exact: false })).toBeVisible();
    await expect(page.getByText("active_or_unknown", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Connect a referral" })).toBeVisible();
    await expect(page.getByText("Open referral packet", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pipeline home" })).toBeVisible();
    await expect(page.getByText("Admission and placement", { exact: true })).toBeVisible();
    await expect(page.getByText("Sanitized hospital · Sanitized residential program", { exact: true })).toBeVisible();
    await expect(page.getByText('["Sanitized hospital","Sanitized residential program"]', { exact: true })).toHaveCount(0);
  });

  test("recovers a client profile after a temporary server failure", async ({ page }) => {
    let serviceAvailable = false;

    await page.route("**/api/clinical/clients**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clinicalFixture.clients) });
    });
    await page.route("**/api/profiles/**", async (route) => {
      if (route.request().url().includes("/api/profiles/directory")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clientDirectoryFixture) });
        return;
      }
      if (!serviceAvailable) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(unifiedProfileFixture) });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Open client profiles" }).click();
    await page.getByRole("button", { name: /Avery Example/ }).click();

    const alert = page.getByRole("alert").filter({ hasText: "This client profile could not be loaded." });
    await expect(alert).toContainText("This client profile could not be loaded.");
    await expect(alert).toContainText("Referral information is temporarily unavailable.");
    await expect(alert).not.toContainText("Internal server error");
    serviceAvailable = true;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
  });

  test("keeps the governed client profile available when Pipeline work storage is unavailable", async ({ page }) => {
    const profile = structuredClone(unifiedProfileFixture);
    profile.pipeline.permissions = {
      can_create_identity_candidate: false,
      can_review_identity: false,
    };
    profile.pipeline.connection = {
      status: "unavailable",
      confirmed_link: null,
      candidates: [],
      suggestions: [],
      message: "Referral information is not configured in this environment. The client record remains available.",
    };

    await page.route("**/api/profiles/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profile) });
    });
    const canonicalClientId = (clinicalFixture.client.client as { canonical_client_id: string }).canonical_client_id;
    await page.goto(`/?screen=profile&clientId=${encodeURIComponent(canonicalClientId)}`);

    await expect(page.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
    const unavailableNotice = page.getByRole("status").filter({ hasText: "Referral history unavailable" });
    await expect(unavailableNotice).toBeVisible();
    await expect(unavailableNotice).toContainText("Referral information cannot be loaded right now.");
    await expect(page.getByRole("button", { name: "Connect a referral" })).toHaveCount(0);
  });

  test("stacks client community, admission-date, and profile-data filters", async ({ page }) => {
    const directory = clientDirectoryFixture as {
      clients: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const baseClient = directory.clients[0];
    const clients = [
      {
        ...baseClient,
        canonical_client_id: "client-recent-san-pablo",
        resident_numbers: ["R-201"],
        display_name: "Riley Perez",
        community_names: ["A & A Health Services San Pablo"],
        current_community: "A & A Health Services San Pablo",
        current_resident: true,
        unit: "10A",
        admit_date: "2026-07-08",
      },
      {
        ...baseClient,
        canonical_client_id: "client-older-san-pablo",
        resident_numbers: ["R-202"],
        display_name: "Oscar Martin",
        community_names: ["A & A Health Services San Pablo"],
        current_community: "A & A Health Services San Pablo",
        current_resident: true,
        unit: "10B",
        admit_date: "2025-01-08",
      },
      {
        ...baseClient,
        canonical_client_id: "client-recent-turlock",
        resident_numbers: ["R-203"],
        display_name: "Taylor Chen",
        community_names: ["AHS Turlock OP LLC"],
        current_community: "AHS Turlock OP LLC",
        current_resident: true,
        unit: null,
        admit_date: "2026-06-08",
      },
    ];

    await page.route("**/api/profiles/directory**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...directory,
          clients,
          total: clients.length,
          next_cursor: null,
          data_as_of: "2026-08-07",
        }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Open client profiles" }).click();
    await expect(page.getByText("Riley Perez", { exact: true })).toBeVisible();

    await page.getByLabel("Filter profiles by admission date").selectOption("last_6_months");
    await expect(page.getByText("Riley Perez", { exact: true })).toBeVisible();
    await expect(page.getByText("Taylor Chen", { exact: true })).toBeVisible();
    await expect(page.getByText("Oscar Martin", { exact: true })).toHaveCount(0);

    await page.getByLabel("Filter profiles by community").selectOption("A & A Health Services San Pablo");
    await expect(page.getByText("1 matching", { exact: true })).toBeVisible();
    await expect(page.getByText("Riley Perez", { exact: true })).toBeVisible();
    await expect(page.getByText("Taylor Chen", { exact: true })).toHaveCount(0);

    await page.getByLabel("Filter profiles by profile data").selectOption("complete");
    await expect(page.getByText("Riley Perez", { exact: true })).toBeVisible();

    await page.getByLabel("Filter profiles by admission date").selectOption("any");
    await expect(page.getByText("Oscar Martin", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText("Taylor Chen", { exact: true })).toBeVisible();
  });

  test("keeps the governed directory status while Pipeline workspace pages finish loading", async ({ page }) => {
    const directory = clientDirectoryFixture as unknown as {
      clients: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const clinicalClient = directory.clients[0];
    const pipelineClient = {
      ...clinicalClient,
      canonical_client_id: "pipeline:workspace-pagination-check",
      display_name: "Morgan Lee",
      workspace_origin: "pipeline",
      pipeline_client_id: "workspace-pagination-check",
      referral_count: 1,
      document_count: 1,
    };

    await page.route("**/api/profiles/directory**", async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(cursor ? {
          ...directory,
          clients: [pipelineClient],
          total: 1,
          next_cursor: null,
          freshness: {
            status: "unknown",
            age_hours: null,
            max_age_hours: 24,
            warning: "The Alamo client directory is unavailable; Pipeline-only client workspaces remain available.",
          },
        } : {
          ...directory,
          clients: [clinicalClient],
          total: 2,
          next_cursor: "pipeline-page",
        }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Open client profiles" }).click();
    await expect(page.getByText("Morgan Lee", { exact: true })).toBeVisible();
    await expect(page.getByText("The Alamo client directory is unavailable", { exact: false })).toHaveCount(0);
    await expect(page.getByText("2 clients", { exact: true })).toBeVisible();
  });

  test("requires explicit human review before joining a referral to an admitted resident", async ({ page }) => {
    const linkId = "7d95fd3a-09c3-42a8-9412-dd58c71562cc";
    const resident = (clinicalFixture.resident as { resident: { resident_key: string; resident_number: string | null; community_id: string } }).resident;
    const referral = {
      id: 101,
      version: 1,
      clientId: "local-client-000101",
      name: "Avery Example",
      date: "2026-08-08",
      stage: "Accepted / Admitted",
      community: "San Pablo",
      source: "County referral",
      priority: "standard",
      tags: ["county"],
      documentName: "avery-referral.pdf",
      documentStatus: "Reviewed",
      owner: "Playwright QA",
      note: "",
      createdAt: "2026-08-08T12:00:00.000Z",
      updatedAt: "2026-08-08T12:00:00.000Z",
      dob: "1984-06-12",
      phone: "",
      email: "",
      payer: "",
      requirements: [],
    };
    const candidate = {
      link_id: linkId,
      person_id: "5bf423f8-4c3c-46ec-809b-61fc1f040620",
      pipeline_client_id: referral.clientId,
      referral_id: referral.id,
      resident_key: resident.resident_key,
      resident_number: resident.resident_number,
      community_id: resident.community_id,
      status: "candidate",
      match_method: "manual",
      match_confidence: null,
      version: 1,
      created_by: { id: "playwright", name: "Playwright QA" },
      reviewed_by: null,
      review_note: null,
      created_at: "2026-08-09T12:00:00.000Z",
      reviewed_at: null,
      updated_at: "2026-08-09T12:00:00.000Z",
      audit_events: [],
    };
    let connectionStatus: "unlinked" | "candidate" | "confirmed" = "unlinked";

    await page.route("**/api/clinical/clients**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clinicalFixture.clients) });
    });
    await page.route("**/api/profiles/**", async (route) => {
      if (route.request().url().includes("/api/profiles/directory")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clientDirectoryFixture) });
        return;
      }
      const profile = structuredClone(unifiedProfileFixture);
      const connection: {
        status: string;
        confirmed_link: typeof candidate | null;
        candidates: Array<typeof candidate>;
        suggestions: Array<{
          referral_id: number;
          pipeline_client_id: string;
          client_name: string;
          community: string;
          stage: string;
          received_at: string;
          confidence: number;
          match_method: string;
          reasons: string[];
        }>;
        message: string;
      } = connectionStatus === "unlinked"
        ? {
            ...unifiedProfileFixture.pipeline.connection,
            suggestions: [{
              referral_id: referral.id,
              pipeline_client_id: referral.clientId,
              client_name: referral.name,
              community: referral.community,
              stage: referral.stage,
              received_at: referral.date,
              confidence: 1,
              match_method: "exact_name_dob",
              reasons: ["Name and date of birth match exactly", "Community matches the current census"],
            }],
          }
        : connectionStatus === "candidate"
          ? {
              status: "candidate",
              confirmed_link: null,
              candidates: [candidate],
              suggestions: [],
              message: "A possible Pipeline identity match needs human review before records can be joined.",
            }
          : {
              status: "confirmed",
              confirmed_link: { ...candidate, status: "confirmed", version: 2 },
              candidates: [],
              suggestions: [],
              message: "Pipeline records are joined through a reviewed resident link.",
            };
      (profile.pipeline as unknown as { connection: typeof connection }).connection = connection;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profile) });
    });
    await page.route("**/api/referrals?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ referrals: [referral], total: 1, revision: 1, generated_at: new Date().toISOString() }),
      });
    });
    await page.route("**/api/resident-links", async (route) => {
      expect(route.request().method()).toBe("POST");
      const body = route.request().postDataJSON() as { referral_id: number; resident_key: string; match_method: string };
      expect(body).toMatchObject({
        referral_id: referral.id,
        resident_key: resident.resident_key,
        match_method: "manual",
        match_confidence: 1,
      });
      connectionStatus = "candidate";
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, link: candidate, revision: 1 }) });
    });
    await page.route("**/api/resident-links/**", async (route) => {
      const body = route.request().postDataJSON() as { action: string; if_match: number };
      expect(body).toEqual({ action: "confirm", if_match: 1 });
      connectionStatus = "confirmed";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, link: { ...candidate, status: "confirmed", version: 2 }, revision: 2 }) });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Open client profiles" }).click();
    await page.getByRole("button", { name: /Avery Example/ }).click();
    await page.getByRole("button", { name: "Connect a referral" }).click();
    await expect(page.getByText("Suggested matches", { exact: true })).toBeVisible();
    await expect(page.getByText("Name and date of birth match exactly", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /Avery Example.*San Pablo.*Name and date of birth match exactly/ }).click();
    await page.getByRole("button", { name: "Send match for review" }).click();
    await expect(page.getByText("Referral match to review", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/version 1/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("button", { name: "Confirm connection" }).click();
    await expect(page.getByText("Referral history available", { exact: true }).first()).toBeVisible();
  });

  test("opens the report runner from primary navigation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Open reports" }).click();
    await expect(page.getByRole("main", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Report library" })).toBeVisible();
    await expect(page.getByRole("button", { name: "View Workspaces report" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "Report results" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByText("Work queue", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Data gaps", { exact: true })).toHaveCount(0);
  });
});
