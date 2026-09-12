import { expect, test } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";

import {
  clinicalFixture,
  clientDirectoryFixture,
  unifiedProfileFixture,
} from "./support/pipeline-clinical-fixtures";

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

    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Playwright\./ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Workflow summary" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Since your last visit" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Ready to schedule" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Data completion" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Recent" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open search" })).toBeVisible();
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
    await expect(page.getByRole("button", { name: "Focus search" })).toHaveCount(0);
    await expect(page.getByText("New referral", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Search", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Referral workspaces", { exact: true })).toHaveCount(0);
    const signedInProfile = page.getByRole("button", { name: "Open profile menu for Playwright QA" });
    await signedInProfile.click();
    await expect(page.getByRole("dialog", { name: "Profile settings" }).getByText("Playwright QA", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pipeline operations Queue, ownership, and record gaps" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open reports" })).toBeVisible();
    const referralsLink = page.getByRole("button", { name: "Open referrals" });
    await expect(referralsLink).toBeVisible();
    await referralsLink.hover();
    await expect(page.getByText("Workspaces", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByLabel("Search or ask")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Playwright\./ })).toHaveCount(0);
    const expandedSearch = page.getByRole("region", { name: "Search Pipeline" });
    expect((await expandedSearch.boundingBox())?.width ?? 0).toBeGreaterThan(900);
    await expect(page.getByText("5 suggested searches", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show my assigned workspaces." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show unassigned workspaces." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Which assessments are ready to schedule?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show scheduled assessments." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show uploaded documents." })).toBeVisible();
    await page.getByText("Upcoming assessments", { exact: true }).click();
    await expect(page.getByText("5 suggested searches", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Open search" }).click();
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

  test("opens a canonical client from search without adding a Home recents panel", async ({ page }) => {
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
    await page.keyboard.press("/");
    await page.getByLabel("Search or ask").fill("Avery");
    await page.getByLabel("Search or ask").press("Enter");

    const clientResult = page.getByRole("button", { name: /Avery Example/ });
    await expect(clientResult).toBeVisible();
    await clientResult.click();
    await expect(page.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\?screen=profile&clientId=/);
    expect(new URL(page.url()).searchParams.has("view")).toBeFalsy();

    await page.getByRole("button", { name: "Pipeline home" }).click();
    await expect(page.getByRole("region", { name: "Recent" })).toHaveCount(0);
    await expect(page.getByText("Broken recent", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Upcoming assessments" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Playwright\./ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Since your last visit" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Ready to schedule" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Data completion" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Recent" })).toHaveCount(0);
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
    await expect(page.getByRole("region", { name: "Current work" })).toBeVisible();
  });

  test("opens the Alamo enhanced client directory and governed profile", async ({ page }) => {
    const profile = structuredClone(unifiedProfileFixture) as typeof unifiedProfileFixture & {
      client: { enrichment: Record<string, unknown> };
    };
    profile.client.enrichment.prior_placements = '["Sanitized hospital","Sanitized residential program"]';
    profile.client.enrichment.active_medications_json = '["Sanitized medication 10 mg daily"]';
    profile.client.enrichment.active_allergies_json = '["Sanitized allergy"]';
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
    const medicalChart = page.getByRole("article", { name: "Client medical chart" });
    await expect(medicalChart).toBeVisible();
    await expect(medicalChart.getByRole("heading", { name: "Client chart", exact: true })).toBeVisible();
    await expect(medicalChart.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
    await expect(medicalChart.getByText("Clinical priorities", { exact: true })).toBeVisible();
    await expect(medicalChart.getByText("Sanitized diagnosis", { exact: true })).toBeVisible();
    await expect(medicalChart.getByText("Allergies", { exact: true })).toBeVisible();
    await expect(medicalChart.getByText("Sanitized allergy", { exact: true })).toBeVisible();
    await expect(medicalChart.getByText("Medications on record", { exact: true })).toBeVisible();
    await expect(medicalChart.getByText("Sanitized medication 10 mg daily", { exact: true })).toBeVisible();
    await expect(medicalChart.getByText("209 days", { exact: true })).toBeVisible();
    await expect(page.getByText("Client information", { exact: true })).toBeVisible();
    await expect(page.getByText("Admission and placement", { exact: true })).toBeVisible();
    await expect(page.getByText("Clinical overview", { exact: true })).toBeVisible();
    await expect(page.getByText("Legal and support", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Record quality", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Referral history", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Assessments", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Client files", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Clinical source files", exact: true })).toBeVisible();
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
    await expect(page.getByText("No referral history has been connected to this client.", { exact: false })).toHaveCount(0);
    await expect(page.getByText("active_or_unknown", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Connect a referral" })).toHaveCount(0);
    await expect(page.getByText("Open referral packet", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pipeline home" })).toBeVisible();
    await expect(page.getByText("Admission and placement", { exact: true })).toBeVisible();
    await expect(page.getByText("Sanitized hospital · Sanitized residential program", { exact: true })).toBeVisible();
    await expect(page.getByText('["Sanitized hospital","Sanitized residential program"]', { exact: true })).toHaveCount(0);
    const sectionOrder = await page.locator("main section h2").allTextContents();
    expect(sectionOrder.indexOf("Client information")).toBeLessThan(sectionOrder.indexOf("Client files"));
    expect(sectionOrder.indexOf("Client files")).toBeLessThan(sectionOrder.indexOf("Record quality"));

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(medicalChart).toBeVisible();
    await expect(medicalChart.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
    const profileMain = page.getByRole("main", { name: "Client profile for Avery Example" });
    await profileMain.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect
      .poll(async () => profileMain.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeLessThanOrEqual(1);
    await expect(page.getByRole("heading", { name: "Record quality", exact: true })).toBeInViewport();
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
    await expect(page.getByRole("heading", { name: "Referral history", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Client files", exact: true })).toBeVisible();
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
      const profileResident = profile.resident as Record<string, unknown> | null;
      if (profileResident) {
        profileResident.date_of_birth = referral.dob;
        profileResident.resident_number = "SYN-R-100";
      }
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
            status: "unlinked",
            confirmed_link: null,
            candidates: [],
            suggestions: [{
              referral_id: referral.id,
              pipeline_client_id: referral.clientId,
              client_name: referral.name,
              community: referral.community,
              stage: referral.stage,
              received_at: referral.date,
              confidence: 0.95,
              match_method: "exact_name_dob",
              reasons: ["Name and date of birth match exactly", "Community matches the current census"],
            }],
            message: "A possible referral match is available for review.",
          }
        : connectionStatus === "candidate" ? {
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
    await page.route(`**/api/referrals/${referral.id}`, async (route) => {
      expect(route.request().method()).toBe("GET");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ referral }),
      });
    });
    await page.route("**/api/resident-links**", async (route) => {
      const url = new URL(route.request().url());
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (url.pathname === "/api/resident-links") {
        expect(route.request().method()).toBe("POST");
        expect(body).toMatchObject({
          pipeline_client_id: referral.clientId,
          referral_id: referral.id,
          resident_key: resident.resident_key,
          community_id: resident.community_id,
          match_method: "manual",
          match_confidence: 0.95,
        });
        expect(body.client_mutation_id).toEqual(expect.any(String));
        connectionStatus = "candidate";
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, link: candidate, revision: 1 }) });
        return;
      }
      expect(body).toEqual({ action: "confirm", if_match: 1 });
      connectionStatus = "confirmed";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, link: { ...candidate, status: "confirmed", version: 2 }, revision: 2 }) });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Open client profiles" }).click();
    await page.getByRole("button", { name: /Avery Example/ }).click();
    await expect(page.getByRole("heading", { name: "Identity connection", exact: true })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Create review candidate" }).click();
    await expect(page.getByRole("heading", { name: "Identity review", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Referral history", exact: true })).toHaveCount(0);
    await expect(page.getByText(/version 1/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Review" }).click();
    const evidence = page.getByLabel("Identity evidence comparison");
    await expect(evidence).toBeVisible();
    await expect(evidence.getByText("Referral record", { exact: true })).toBeVisible();
    await expect(evidence.getByText("Governed resident record", { exact: true })).toBeVisible();
    await expect(evidence.getByText("Workspace #101", { exact: true })).toBeVisible();
    await expect(evidence.getByText("Date of birth matches", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Confirm connection" }).click();
    await expect(page.getByRole("heading", { name: "Identity review", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Referral history", exact: true })).toHaveCount(0);
  });

  test("opens the report runner from primary navigation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Open reports" }).click();
    await expect(page.getByRole("main", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reports", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("combobox", { name: "Report", exact: true })).toHaveValue("assessment_completion");
    await expect(page.getByRole("region", { name: "Report results" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByText("Work queue", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Data gaps", { exact: true })).toHaveCount(0);
  });
});
