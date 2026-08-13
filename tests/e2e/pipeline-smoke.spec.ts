import { expect, test } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const clinicalFixture = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/fixtures/alamo-pipeline-clinical.sanitized.json"), "utf8"),
) as {
  roster: Record<string, unknown>;
  resident: Record<string, unknown>;
};

const unifiedProfileFixture = {
  ...clinicalFixture.resident,
  pipeline: {
    permissions: {
      can_create_identity_candidate: true,
      can_review_identity: true,
    },
    connection: {
      status: "unlinked",
      confirmed_link: null,
      candidates: [],
      message: "No reviewed Pipeline identity link exists. This profile will not be matched by name.",
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
    await expect(page.getByText("Referral packets", { exact: true }).last()).toBeVisible();
    await expect.poll(() => errors).toEqual([]);
  });

  test("keeps the opening surface focused on finding or creating a packet", async ({
    page,
  }) => {
    await expect(page.getByRole("link", { name: "Pipeline" })).toBeVisible();
    await expect(page.getByTitle("Home")).toBeVisible();
    await expect(page.getByText("Referral packets", { exact: true }).last()).toBeVisible();
    await expect(page.getByLabel("Select referral packet")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Referral workflow", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "All packets", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create new packet" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Referral workflow tracker" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Action categories" })).toHaveCount(0);
    await page.getByRole("button", { name: "Needs action", exact: true }).click();
    const workQueues = page.getByRole("navigation", { name: "Action categories" });
    await expect(workQueues).toBeVisible();
    for (const queueName of ["All action", "Unassigned", "Packet review", "Assessment due", "Decision needed", "Missing documents", "Blocked"]) {
      await expect(workQueues.getByRole("button", { name: queueName, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "Referral action worklist" })).toBeVisible();
    const activeReferrals = page.getByRole("link", { name: "Open referrals" });
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
      page.getByRole("link", { name: "Create new packet" }),
    ]) {
      await expect(navItem).toHaveCSS("width", "168px");
      await expect(navItem).toHaveCSS("height", "54px");
    }
    await expect(page.getByRole("tab", { name: "Kanban board" })).toHaveCount(0);

    await workQueues.getByRole("button", { name: "Decision needed", exact: true }).click();
    await expect(page.getByText("No referrals need a decision", { exact: true })).toBeVisible();
    await expect(page.getByText("This view is derived from current referral, assessment, decision, document, and requirement data.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "All packets", exact: true }).click();

    await page.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByRole("button", { name: "Close search" })).toHaveCSS(
      "background-color",
      "rgb(255, 243, 220)",
    );
    await expect(page.getByLabel("Search or ask")).toBeVisible();
    await expect(page.getByText("Referral packets", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Welcome( back)?, / })).toHaveCount(0);
    await page.getByRole("button", { name: "Close search" }).click();
    await expect(page.getByLabel("Search or ask")).toHaveCount(0);
    await expect(page.getByText("Referral packets", { exact: true }).last()).toBeVisible();
    await page.getByRole("button", { name: "Open search" }).click();
    await page.getByRole("link", { name: "Open referrals" }).click();
    await expect(page.getByLabel("Search or ask")).toHaveCount(0);
    await expect(page.getByText("Referral packets", { exact: true }).last()).toBeVisible();
  });

  test("opens a new packet and returns through the Pipeline header", async ({ page }) => {
    await page.getByRole("link", { name: "Create new packet" }).click();
    await expect(page.getByText("Referral packet", { exact: true }).last()).toBeVisible();
    await expect.poll(async () => (await page.getByTestId("packet-workspace").boundingBox())?.width ?? 0).toBeGreaterThan(1200);
    const activePacket = page.getByRole("link", { name: "Create new packet" });
    await expect(activePacket).toHaveAttribute("aria-current", "page");
    await expect(activePacket).toHaveCSS("background-color", "rgb(255, 240, 237)");
    await expect(activePacket).toHaveCSS("border-color", "rgb(200, 91, 77)");
    await expect(activePacket).toHaveCSS("justify-content", "center");
    await expect(activePacket).toHaveCSS("height", "54px");
    await expect(activePacket).toHaveCSS("gap", "10px");
    await expect(activePacket.locator("svg")).toBeVisible();
    const steps = page.getByRole("navigation", { name: "Referral packet steps" });
    const savePacket = page.getByRole("button", { name: /^(Create referral|Save chart)$/ });
    const [stepsBox, saveBox] = await Promise.all([steps.boundingBox(), savePacket.boundingBox()]);
    expect(stepsBox).not.toBeNull();
    expect(saveBox).not.toBeNull();
    expect(Math.abs((stepsBox?.y ?? 0) - (saveBox?.y ?? 0))).toBeLessThan(1);
    await expect(page.getByRole("link", { name: "Pipeline" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect.poll(async () => (await page.getByRole("link", { name: "Open referrals" }).boundingBox())?.width ?? 0).toBeGreaterThan(100);
    await page.getByRole("link", { name: "Pipeline" }).click();
    await expect(page.getByRole("heading", { name: /Welcome( back)?, / })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Search and ask" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "My queue" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Recent" })).toBeVisible();
    await expect(page.getByText("Your next referral actions", { exact: true })).toBeVisible();
    await expect(page.getByText("Resume where you left off", { exact: true })).toBeVisible();

    const queueResponse = await page.request.get("/api/operations/my-queue");
    expect(queueResponse.ok()).toBeTruthy();
    const queue = await queueResponse.json() as {
      owner: { name: string };
      total: number;
      items: Array<{ referral_id: number; next_action: string; urgency: string }>;
    };
    expect(queue.owner.name).toBe("Playwright QA");
    expect(queue.total).toBe(0);
    expect(queue.items).toEqual([]);
  });

  test("creates and recalls a chart entered without an imported packet", async ({ page }) => {
    const clientName = `Manual chart ${randomUUID().slice(0, 8)}`;
    await page.getByRole("link", { name: "Create new packet" }).click();

    await expect(page.getByRole("region", { name: "Chart", exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Chart completion and documents" })).toBeVisible();
    await expect(page.getByText("You can create and complete the chart without importing a file.", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(clientName);
    await page.getByRole("combobox", { name: "County:" }).selectOption("San Pablo");
    await page.getByRole("textbox", { name: "Owner (@name):" }).fill("Playwright QA");
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true }).fill("Manual referral chart created without extraction.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Create referral", exact: true }).click();

    await expect(page.getByRole("button", { name: "Save chart", exact: true })).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).not.toBeNull();
    const referralId = new URL(page.url()).searchParams.get("referralId");
    expect(referralId).not.toBeNull();

    const response = await page.request.get(`/api/referrals?q=${encodeURIComponent(clientName)}`);
    expect(response.ok()).toBeTruthy();
    const payload = await response.json() as {
      referrals: Array<{ id: number; documentStatus: string; tags?: string[]; note: string }>;
    };
    expect(payload.referrals).toHaveLength(1);
    expect(payload.referrals[0]).toMatchObject({
      id: Number(referralId),
      documentStatus: "Missing",
      note: "## Reason for referral\nManual referral chart created without extraction.",
    });
    expect(payload.referrals[0].tags).toEqual(expect.arrayContaining(["manual-entry", "needs-documents"]));

    await page.reload();
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(clientName);
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true })).toHaveValue("Manual referral chart created without extraction.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: /Signed Medication List: missing/i })).toBeVisible();
  });

  test("keeps work surfaces anchored while navigating and compacts referral facets on mobile", async ({ page }) => {
    const header = page.locator("header");
    await expect(header).toHaveCSS("height", "82px");

    const referralMain = page.getByRole("main", { name: "Referral packets" });
    const referralMainBox = await referralMain.boundingBox();
    expect(referralMainBox?.y).toBe(82);

    await page.getByRole("button", { name: "Open client profiles" }).click();
    const profilesMain = page.getByRole("main", { name: "Client profiles" });
    await expect(profilesMain).toBeVisible();
    expect((await profilesMain.boundingBox())?.y).toBe(82);

    await page.getByRole("link", { name: "Create new packet" }).click();
    const packetSteps = page.getByRole("navigation", { name: "Referral packet steps" });
    const savePacket = page.getByRole("button", { name: /^(Create referral|Save chart)$/ });
    const firstPacketPage = page.getByRole("region", { name: "Chart", exact: true });
    const [stepsBox, saveBox, firstPageBox] = await Promise.all([
      packetSteps.boundingBox(),
      savePacket.boundingBox(),
      firstPacketPage.boundingBox(),
    ]);
    expect(Math.abs((stepsBox?.y ?? 0) - (saveBox?.y ?? 0))).toBeLessThan(1);

    await page.getByRole("button", { name: "2 Required files" }).click();
    const secondPageBox = await page.getByRole("region", { name: "Required files" }).boundingBox();
    expect(Math.abs((firstPageBox?.y ?? 0) - (secondPageBox?.y ?? 0))).toBeLessThan(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?view=referrals");
    await page.waitForLoadState("networkidle");
    const mobileAside = page.getByRole("complementary");
    const mobileWorkflow = page.getByRole("region", { name: "Referral workflow tracker" });
    await expect(mobileWorkflow).toBeVisible();
    expect((await mobileAside.boundingBox())?.height ?? 999).toBeLessThan(60);
    expect((await mobileWorkflow.boundingBox())?.y ?? 999).toBeLessThan(330);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("deduplicates startup identity and retries a transient referral read", async ({ page }) => {
    let identityRequests = 0;
    await page.route("**/api/auth/me", async (route) => {
      identityRequests += 1;
      await route.continue();
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /Welcome( back)?, Playwright QA\./ })).toBeVisible();
    expect(identityRequests).toBe(1);

    let referralRequests = 0;
    await page.route(/\/api\/referrals\?/, async (route) => {
      referralRequests += 1;
      if (referralRequests === 1) {
        await route.fulfill({ status: 503, contentType: "text/plain", body: "gateway unavailable" });
        return;
      }
      await route.continue();
    });

    await page.getByRole("link", { name: "Open referrals" }).click();
    await expect(page.getByRole("region", { name: "Referral workflow tracker" })).toBeVisible();
    await expect.poll(() => referralRequests).toBeGreaterThanOrEqual(2);
    await expect(page.getByText("Pipeline returned an unreadable response.", { exact: true })).toHaveCount(0);
  });

  test("keeps the last successful referral snapshot when refresh fails", async ({ page }) => {
    const name = `Refresh recovery ${randomUUID().slice(0, 8)}`;
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
    await page.goto("/?view=referrals");

    const workflow = page.getByRole("region", { name: "Referral workflow tracker" });
    await expect(workflow).toBeVisible();
    await expect(workflow.getByRole("button", { name: `Open ${name} referral packet` })).toBeVisible();
    const rowsBefore = await workflow.getByRole("button").count();
    expect(rowsBefore).toBeGreaterThan(0);

    await page.route(/\/api\/referrals\?/, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Referral refresh unavailable." }) });
    });
    await page.getByRole("button", { name: "Refresh referral workflow" }).click();
    await expect(page.getByText("Referral refresh unavailable.", { exact: true })).toBeVisible();
    await expect.poll(() => workflow.getByRole("button").count()).toBe(rowsBefore);
  });

  test("browses all uploaded files and fixed creation months", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^All files/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "June 2026", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "July 2026", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "August 2026", exact: true })).toBeVisible();

    await page.getByRole("button", { name: /^All files/ }).click();
    await expect(page.getByRole("heading", { name: "All files", exact: true })).toBeVisible();
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
    await expect(worklistResponse.json()).resolves.toMatchObject({
      total: expect.any(Number),
      counts: {
        all_actionable: expect.any(Number),
        unassigned: expect.any(Number),
        packet_review: expect.any(Number),
        assessment_due: expect.any(Number),
        decision_needed: expect.any(Number),
        missing_documents: expect.any(Number),
        blocked: expect.any(Number),
      },
      items: expect.any(Array),
    });
    expect((await page.request.get("/api/referrals?cursor=-1")).status()).toBe(400);
    expect((await page.request.get("/api/files?limit=500")).status()).toBe(400);
  });

  test("pages without duplicates and rejects a competing stale save", async ({ page }) => {
    const group = `Cursor ${randomUUID().slice(0, 8)}`;
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
    const name = `Collaboration ${randomUUID().slice(0, 8)}`;
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
            patch: { name: `${name} A` },
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
      expect(merged.referral).toMatchObject({ name: `${name} A`, note: "Updated in the second session" });

      const sameSectionBase = merged.referral;
      const firstIdentity = await page.request.patch(`/api/referrals/${base.id}`, {
        data: {
          if_match: sameSectionBase.version,
          if_match_sections: sameSectionBase.sectionVersions,
          patch: { name: `${name} Current` },
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
      await page.getByText(`${name} Current`, { exact: true }).first().click();
      await secondPage.getByText(`${name} Current`, { exact: true }).first().click();
      const localName = `${name} Local draft`;
      const remoteName = `${name} Remote saved`;
      await page.getByRole("textbox", { name: "NAME", exact: true }).fill(localName);
      await secondPage.getByRole("textbox", { name: "NAME", exact: true }).fill(remoteName);
      await secondPage.getByRole("button", { name: /^(Create referral|Save chart)$/ }).click();
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
    const name = `Recovery ${randomUUID().slice(0, 8)}`;
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
    const created = await createdResponse.json() as { referral: { id: number } };

    await page.goto("/?view=referrals");
    await page.getByText(name, { exact: true }).first().click();
    await expect(page.getByText("Saved record loaded", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Summary: Additional context", exact: true })).toHaveValue("Legacy free-text summary.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Edit interview", exact: true }).click();
    const interview = page.getByRole("textbox", { name: "Interview: Additional notes", exact: true });
    await interview.fill("Recovered synthetic interview draft.");
    await expect.poll(async () => page.evaluate((referralId) => (
      window.sessionStorage.getItem(`pipeline-referral-draft:${referralId}`)?.includes("Recovered synthetic interview draft.") ?? false
    ), created.referral.id)).toBeTruthy();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Recovered draft" })).toBeVisible();
    await page.getByRole("button", { name: "Edit interview", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Interview: Additional notes", exact: true })).toHaveValue("Recovered synthetic interview draft.");
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await expect.poll(async () => {
      const response = await page.request.get(`/api/referrals/${created.referral.id}`);
      return ((await response.json()) as { referral: { interview?: string } }).referral.interview;
    }, { timeout: 8_000 }).toBe("## Additional notes\nRecovered synthetic interview draft.");
    await expect(page.getByText(/Autosaved/).first()).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Edit interview", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Interview: Additional notes", exact: true })).toHaveValue("Recovered synthetic interview draft.");
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
    expect((await page.request.get(`/api/files/${documentId}?limit=24`)).status()).toBe(503);
    expect((await page.request.get(`/api/files/${documentId}/preview?page=1`)).status()).toBe(503);
  });

  test("keeps the chart editable with consolidated document references", async ({
    page,
  }) => {
    const clientName = `Workflow ${randomUUID().slice(0, 8)}`;
    const packetBytes = Buffer.from(`packet-${randomUUID()}`);
    await page.getByRole("link", { name: "Create new packet" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(clientName);
    await page.getByRole("textbox", { name: "GENDER", exact: true }).fill("Synthetic gender");
    await page.getByRole("textbox", { name: "AGE", exact: true }).fill("74");
    await page.getByRole("textbox", { name: "DOB", exact: true }).fill("1951-08-14");
    await page.getByRole("textbox", { name: "SSN", exact: true }).fill("000-00-0000");
    await page.getByRole("combobox", { name: "County:" }).selectOption("San Pablo");
    await page.getByRole("textbox", { name: "Owner (@name):" }).fill("Playwright QA");
    await page.getByRole("textbox", { name: "Referral received:" }).fill("2026-08-09");
    await page.getByRole("textbox", { name: "Admission date:" }).fill("2026-08-20");
    await page.getByRole("textbox", { name: "Referent:" }).fill("Synthetic County Access");
    await page.getByRole("textbox", { name: "Responsible Person:" }).fill("Synthetic Responsible Person");
    await page.getByRole("button", { name: "Edit summary", exact: true }).click();
    await page.getByRole("textbox", { name: "Summary: Reason for referral", exact: true }).fill("Referral summary for packet review.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Edit interview", exact: true }).click();
    await page.getByRole("textbox", { name: "Interview: Additional notes", exact: true }).fill("Synthetic interview notes.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("textbox", { name: "Tags", exact: true }).fill("Urgent Review, county-intake");
    await page.getByRole("button", { name: "yes", exact: true }).click();

    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "face-sheet.pdf",
      mimeType: "application/pdf",
      buffer: packetBytes,
    });

    await page.getByRole("button", { name: "2 Required files" }).click();
    const medicationButton = page.getByRole("region", { name: "Required files" })
      .getByRole("button", { name: "Drop document or browse" })
      .first();
    await medicationButton.locator("xpath=..").locator('input[type="file"]').setInputFiles({
      name: "synthetic-medication-list.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("synthetic-medication-list"),
    });
    await page.getByRole("button", { name: "3 Other files" }).click();
    const providerButton = page.getByRole("region", { name: "Other files" })
      .getByRole("button", { name: "Drop document or browse" })
      .first();
    await providerButton.locator("xpath=..").locator('input[type="file"]').setInputFiles({
      name: "synthetic-provider-form.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("synthetic-provider-form"),
    });
    await page.getByRole("button", { name: "1 Chart" }).click();

    await expect(page.getByText("face-sheet.pdf", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^(Create referral|Save chart)$/ }).click();
    await expect(page.getByText("Packet uploaded and ready for review", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open client profile", exact: true })).toHaveCount(0);
    const extractionReview = page.getByRole("region", { name: "Extraction review" });
    await expect(extractionReview).toBeVisible();
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

    await extractionReview.getByRole("button", { name: "Confirm 2 high-confidence values" }).click();
    await expect(extractionReview.getByText("Confirm 2 high-confidence values?", { exact: true })).toBeVisible();
    await extractionReview.getByRole("button", { name: "Confirm values", exact: true }).click();
    await expect(extractionReview.getByText("Extraction review complete", { exact: true })).toBeVisible();
    await extractionReview.getByRole("button", { name: "Continue to assessment", exact: true }).click();
    await expect(page.getByRole("region", { name: "Assessment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start assessment", exact: true })).toBeVisible();

    const referralResponse = await page.request.get(`/api/referrals?q=${encodeURIComponent(clientName)}`);
    expect(referralResponse.ok()).toBeTruthy();
    const referralList = await referralResponse.json() as {
      referrals: Array<{
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
      }>;
    };
    expect(referralList.referrals[0]).toMatchObject({
      documentName: "face-sheet.pdf",
      documentStatus: "Reviewed",
      packetStatus: "reviewed",
      stage: "Assessment",
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
      interview: "## Additional notes\nSynthetic interview notes.",
      conserved: "yes",
      tags: ["urgent-review", "county-intake"],
    });
    expect(referralList.referrals[0]?.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "medication_list", evidenceDocumentName: "synthetic-medication-list.pdf" }),
      expect.objectContaining({ type: "provider_form", evidenceDocumentName: "synthetic-provider-form.pdf" }),
    ]));
    expect(referralList.referrals[0]?.documentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(referralList.referrals[0]?.packetId).toMatch(/^pkt_/);
    expect(referralList.referrals[0]?.packetFields?.find((field) => field.field_key === "demographics.date_of_birth")).toMatchObject({
      final_value: "1951-08-15",
      review_status: "edited",
    });

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
    await expect(page.getByRole("region", { name: "Referral workflow tracker" })).toBeVisible();
    const tagFilter = page.getByRole("button", { name: "Filter by tag urgent-review, 1 packet" });
    if (!await tagFilter.isVisible()) {
      await page.getByRole("button", { name: /^Show \d+ more$/ }).click();
    }
    await expect(tagFilter).toBeVisible();
    await tagFilter.click();
    await expect(page.getByText(clientName, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("#urgent-review · #county-intake", { exact: true })).toBeVisible();
    const taggedReferralsResponse = await page.request.get("/api/referrals?tag=urgent-review&limit=25");
    expect(taggedReferralsResponse.status()).toBe(200);
    const taggedReferrals = await taggedReferralsResponse.json() as { referrals: Array<{ tags?: string[] }> };
    expect(taggedReferrals.referrals.every((referral) => referral.tags?.includes("urgent-review"))).toBeTruthy();
    const communityFilter = page.getByRole("button", { name: /^Filter by community San Pablo, \d+ packets?$/ });
    await expect(communityFilter).toBeVisible();
    await communityFilter.click();
    await expect(page.getByText(clientName, { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Needs action", exact: true }).click();
    await page.getByRole("navigation", { name: "Action categories" })
      .getByRole("button", { name: "Assessment due", exact: true })
      .click();
    await expect(page.getByText(clientName, { exact: true }).first()).toBeVisible();
    await page.getByText(clientName, { exact: true }).first().click();
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(clientName);
    await expect(page.getByRole("textbox", { name: "GENDER", exact: true })).toHaveValue("Synthetic gender");
    await expect(page.getByRole("textbox", { name: "AGE", exact: true })).toHaveValue("74");
    await expect(page.getByRole("textbox", { name: "DOB", exact: true })).toHaveValue("1951-08-15");
    await expect(page.getByRole("textbox", { name: "SSN", exact: true })).toHaveValue("000-00-0000");
    await page.getByRole("button", { name: "Edit interview", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Interview: Additional notes", exact: true })).toHaveValue("Synthetic interview notes.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "yes", exact: true })).toHaveClass(/bg-\[#111111\]/);

    const legacyProfileResponse = await page.request.get(`/api/clients?q=${encodeURIComponent(clientName)}`);
    expect(legacyProfileResponse.status()).toBe(404);
  });

  test("ingests a new packet from the file alone and exposes OCR values for review", async ({ page }) => {
    test.setTimeout(120_000);
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
      "Resident Name: Example, Rowan",
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

    await page.getByRole("link", { name: "Create new packet" }).click();
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "rowan-example-face-sheet.png",
      mimeType: "image/png",
      buffer: canvas.toBuffer("image/png"),
    });
    await page.getByRole("button", { name: /^(Create referral|Save chart)$/ }).click();

    await expect(page.getByText("Packet uploaded and ready for review", { exact: true })).toBeVisible({ timeout: 120_000 });
    const extractionReview = page.getByRole("region", { name: "Extraction review" });
    await expect(extractionReview).toBeVisible();
    await expect(extractionReview.getByText("Rowan Example", { exact: true })).toBeVisible();
    await expect(extractionReview.getByText("1980-01-15", { exact: true })).toBeVisible();
    await expect(extractionReview.getByText("North County Behavioral Health", { exact: true })).toBeVisible();
    await expect(extractionReview.getByText("Schizoaffective disorder", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Rowan Example");
    await expect(page.getByRole("textbox", { name: "DOB", exact: true })).toHaveValue("1980-01-15");

    const referrals = await page.request.get(`/api/referrals?q=${encodeURIComponent("Rowan Example")}`);
    const payload = await referrals.json() as {
      referrals: Array<{ id: number; packetFields?: Array<{ field_key: string; source_page_no?: number }> }>;
    };
    expect(payload.referrals).toHaveLength(1);
    expect(payload.referrals[0].packetFields).toHaveLength(13);
    expect(payload.referrals[0].packetFields?.every((field) => field.source_page_no === 1)).toBeTruthy();

    const packet = await page.request.get(`/api/referrals/${payload.referrals[0].id}/packet`);
    expect(packet.ok()).toBeTruthy();
    expect(packet.headers()["content-type"]).toContain("image/png");
  });

  test("blocks an exact duplicate packet from creating another referral", async ({ page }) => {
    const packetBytes = Buffer.from(`duplicate-packet-${randomUUID()}`);
    const firstClient = `First ${randomUUID().slice(0, 8)}`;
    const secondClient = `Second ${randomUUID().slice(0, 8)}`;

    await page.getByRole("link", { name: "Create new packet" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(firstClient);
    await page.getByRole("combobox", { name: "County:" }).selectOption("San Pablo");
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "first-copy.pdf",
      mimeType: "application/pdf",
      buffer: packetBytes,
    });
    await page.getByRole("button", { name: /^(Create referral|Save chart)$/ }).click();
    await expect(page.getByRole("region", { name: "Initial referral packet" })
      .getByRole("button", { name: /first-copy\.pdf Uploaded/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Extraction review" })).toBeVisible();

    await page.goto("/?view=referrals&screen=packet");
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(secondClient);
    await page.getByRole("combobox", { name: "County:" }).selectOption("Turlock");
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "renamed-copy.pdf",
      mimeType: "application/pdf",
      buffer: packetBytes,
    });
    await page.getByRole("button", { name: /^(Create referral|Save chart)$/ }).click();
    await expect(page.getByText("This exact packet is already attached to a referral. Open the existing referral instead.", { exact: true })).toBeVisible();

    const duplicateResponse = await page.request.get(`/api/referrals?q=${encodeURIComponent(secondClient)}`);
    const duplicateList = await duplicateResponse.json() as { total: number };
    expect(duplicateList.total).toBe(0);
  });

  test("switches packet steps without stacking the sections", async ({ page }) => {
    await page.getByRole("link", { name: "Create new packet" }).click();
    await expect(page.getByRole("button", { name: "1 Chart" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "2 Required files" }).click();
    await expect(page.getByRole("button", { name: "2 Required files" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Chart", exact: true })).toHaveCount(0);
    await expect(page.getByText("Signed Medication List", { exact: true })).toBeVisible();
    await expect(page.getByText("TB Test-Results", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Drop document or browse" }).first()).toBeVisible();

    await page.getByRole("button", { name: "3 Other files" }).click();
    await expect(page.getByRole("button", { name: "3 Other files" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Required files", exact: true })).toHaveCount(0);
    await expect(page.getByText("Provider Form", { exact: true })).toBeVisible();
    await expect(page.getByText("Face Sheet", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "4 Assessment" }).click();
    await expect(page.getByText("Save the referral before starting the assessment", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "5 Review" }).click();
    await expect(page.getByText("What has been collected for this referral.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Unnamed client", exact: true })).toBeVisible();
    await expect(page.getByText("Not entered", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /Client name Not entered/ }).click();
    await expect(page.getByRole("button", { name: "1 Chart" })).toHaveAttribute("aria-current", "page");
  });

  test("creates, imports, reviews, completes, and recalls an assessment", async ({ page }) => {
    const clientName = `Assessment ${randomUUID().slice(0, 8)}`;
    await page.getByRole("link", { name: "Create new packet" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(clientName);
    await page.getByRole("combobox", { name: "County:" }).selectOption("San Pablo");
    await page.getByRole("textbox", { name: "Owner (@name):" }).fill("Playwright QA");
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "assessment-referral.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(`assessment-referral-${randomUUID()}`),
    });
    await page.getByRole("button", { name: /^(Create referral|Save chart)$/ }).click();
    await expect(page.getByRole("region", { name: "Initial referral packet" })
      .getByRole("button", { name: /assessment-referral\.pdf Uploaded/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Extraction review" })).toBeVisible();

    await page.getByRole("button", { name: "4 Assessment" }).click();
    await page.getByRole("button", { name: "Start assessment" }).click();
    await expect(page.getByRole("region", { name: "Assessment workspace" })).toBeVisible();
    await page.getByLabel(/Resident number/).fill(`EM-${randomUUID().slice(0, 8)}`);
    await page.getByLabel(/Date of birth/).fill("1984-06-12");
    await page.getByRole("button", { name: /^Save$/ }).click();
    await expect(page.getByText("Assessment saved", { exact: true })).toBeVisible();

    await page.getByLabel("Upload assessment file").setInputFiles({
      name: "assessment.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("primary_diagnosis,medication_adherence\nSchizoaffective disorder,Consistent with support\n"),
    });
    await expect(page.getByText("Extracted values are ready for review", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm 2 values" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm 2 values" }).click();
    await expect(page.getByText("Imported values confirmed", { exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(page.getByText("Assessment completed", { exact: true })).toBeVisible();
    await expect(page.getByText("complete", { exact: true }).first()).toBeVisible();

    const referrals = await page.request.get(`/api/referrals?q=${encodeURIComponent(clientName)}`);
    const referralPayload = await referrals.json() as { referrals: Array<{ id: number; version: number }> };
    const history = await page.request.get(`/api/referrals/${referralPayload.referrals[0].id}/assessments`);
    expect(history.ok()).toBeTruthy();
    const historyPayload = await history.json() as { assessments: Array<{ status: string; primary_diagnosis: string; medications_at_intake: string[]; version: number }> };
    expect(historyPayload.assessments[0]).toMatchObject({
      status: "complete",
      primary_diagnosis: "Schizoaffective disorder",
    });
    expect(historyPayload.assessments[0].version).toBeGreaterThanOrEqual(4);

    const workItems = await page.request.get(`/api/referrals/${referralPayload.referrals[0].id}/work-items`);
    expect(workItems.ok()).toBeTruthy();
    const workItemPayload = await workItems.json() as { work_items: Array<{ type: string; status: string; version: number }> };
    expect(workItemPayload.work_items).toHaveLength(8);
    expect(workItemPayload.work_items.find((item) => item.type === "tb_test")).toMatchObject({ status: "needed", version: 1 });

    await page.getByRole("button", { name: "5 Review" }).click();
    const requirementsEditor = page.getByRole("region", { name: "Follow-up requirements" });
    await expect(requirementsEditor).toBeVisible();
    await requirementsEditor.getByRole("button", { name: /TB test result/ }).click();
    await requirementsEditor.getByRole("combobox", { name: "Status" }).selectOption("requested");
    await requirementsEditor.getByRole("textbox", { name: "Owner" }).fill("Playwright QA");
    await requirementsEditor.getByRole("textbox", { name: "Next action" }).fill("Confirm the scheduled TB test result.");
    await requirementsEditor.getByLabel("Due").fill("2026-08-20");
    await requirementsEditor.getByRole("textbox", { name: "Evidence" }).fill("synthetic-tb-result.pdf");
    await requirementsEditor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(requirementsEditor.getByText("TB test result updated.", { exact: true })).toBeVisible();

    const updatedWorkItems = await page.request.get(`/api/referrals/${referralPayload.referrals[0].id}/work-items`);
    const updatedWorkItemPayload = await updatedWorkItems.json() as { work_items: Array<{ type: string; status: string; owner: string; nextStep: string; evidenceDocumentName?: string; version: number }> };
    expect(updatedWorkItemPayload.work_items.find((item) => item.type === "tb_test")).toMatchObject({
      status: "requested",
      owner: "Playwright QA",
      nextStep: "Confirm the scheduled TB test result.",
      evidenceDocumentName: "synthetic-tb-result.pdf",
      version: 2,
    });

    const decision = page.getByRole("region", { name: "Admission decision" });
    await decision.getByRole("button", { name: "Yes" }).click();
    await decision.getByRole("button", { name: "Save decision" }).click();
    await expect(decision.getByText("Decision saved", { exact: true })).toBeVisible();

    const savedDecision = await page.request.get(`/api/referrals/${referralPayload.referrals[0].id}/decision`);
    expect(savedDecision.ok()).toBeTruthy();
    await expect(savedDecision.json()).resolves.toMatchObject({ decision: { outcome: "accepted", decidedByName: "Playwright QA" } });

    const latestReferralResponse = await page.request.get(`/api/referrals/${referralPayload.referrals[0].id}`);
    const latestReferral = await latestReferralResponse.json() as {
      referral: { version: number; sectionVersions: { identity: number; workflow: number } };
    };
    const unrelatedIdentityEdit = await page.request.patch(`/api/referrals/${referralPayload.referrals[0].id}`, {
      data: {
        if_match: latestReferral.referral.version,
        if_match_sections: { identity: latestReferral.referral.sectionVersions.identity },
        patch: { phone: "555-0109" },
      },
    });
    expect(unrelatedIdentityEdit.ok()).toBeTruthy();
    const firstMove = await page.request.post(`/api/referrals/${referralPayload.referrals[0].id}/transition`, {
      data: {
        if_match: latestReferral.referral.version,
        if_match_section: latestReferral.referral.sectionVersions.workflow,
        target_stage: "Packet Needed",
      },
    });
    expect(firstMove.ok()).toBeTruthy();
    const firstMovePayload = await firstMove.json() as {
      referral: { version: number; sectionVersions: { workflow: number } };
    };
    const staleMove = await page.request.post(`/api/referrals/${referralPayload.referrals[0].id}/transition`, {
      data: {
        if_match: latestReferral.referral.version,
        if_match_section: latestReferral.referral.sectionVersions.workflow,
        target_stage: "Packet Review",
      },
    });
    expect(staleMove.status()).toBe(409);
    const nextMove = await page.request.post(`/api/referrals/${referralPayload.referrals[0].id}/transition`, {
      data: {
        if_match: firstMovePayload.referral.version,
        if_match_section: firstMovePayload.referral.sectionVersions.workflow,
        target_stage: "Packet Review",
      },
    });
    expect(nextMove.ok()).toBeTruthy();
    const nextMovePayload = await nextMove.json() as {
      referral: { version: number; sectionVersions: { workflow: number } };
    };
    const blockedMove = await page.request.post(`/api/referrals/${referralPayload.referrals[0].id}/transition`, {
      data: {
        if_match: nextMovePayload.referral.version,
        if_match_section: nextMovePayload.referral.sectionVersions.workflow,
        target_stage: "Assessment",
      },
    });
    expect(blockedMove.status()).toBe(422);
    await expect(blockedMove.json()).resolves.toMatchObject({
      blockers: [{ code: "packet_review_required" }],
    });
  });

  test("versions the EHR handoff and records failure recovery explicitly", async ({ page }) => {
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
        },
      },
    });
    const assessmentPayload = await assessmentCreate.json();
    expect(assessmentCreate.status(), JSON.stringify(assessmentPayload)).toBe(201);
    const completedAssessment = await page.request.patch(`/api/assessments/${assessmentPayload.assessment.assessment_id}`, {
      data: {
        if_match: assessmentPayload.assessment.version,
        patch: { status: "complete" },
      },
    });
    const completedAssessmentPayload = await completedAssessment.json();
    expect(completedAssessment.ok(), JSON.stringify(completedAssessmentPayload)).toBeTruthy();

    await transition("Community Review");
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

    await expect(page.getByRole("heading", { name: "Welcome, Playwright QA." })).toBeVisible();
    await expect(page.getByLabel("Search or ask")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Pipeline" })).toHaveCount(0);
    await expect(page.getByText("Referrals", { exact: true })).toBeVisible();
    await expect(page.getByText("New packet", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Create new packet" }).hover();
    await expect(page.getByText("New packet", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open search" }).hover();
    await expect(page.getByText("New packet", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Create new packet" }).hover();
    await expect(page.getByText("New packet", { exact: true })).toBeVisible();
    await expect(page.getByText("Referral packets", { exact: true })).toHaveCount(0);
    const signedInProfile = page.getByRole("button", { name: "Open profile menu for Playwright QA" });
    await signedInProfile.click();
    await expect(page.getByRole("dialog", { name: "Profile menu" }).getByText("Playwright QA", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Operations Queue, ownership, and data gaps" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open operations" })).toHaveCount(0);
    const referralsLink = page.getByRole("link", { name: "Open referrals" });
    await expect(referralsLink).toBeVisible();
    await referralsLink.hover();
    await expect(page.getByText("Referrals", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Open search" }).click();
    await expect(page.getByLabel("Search or ask")).toBeVisible();
    await page.getByLabel("Search or ask").click();
    await expect(page.getByText("6 suggested searches", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show all active referrals." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Which active referrals are unassigned?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Which packets need document review?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Which referrals are in assessment?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Which referrals are waiting for an admission decision?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show uploaded referral and assessment files." })).toBeVisible();
    await page.getByRole("button", { name: "Show all active referrals." }).click();
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

    const worklistResponse = await page.request.get("/api/operations/referral-worklist");
    expect(worklistResponse.ok()).toBeTruthy();
    const worklist = await worklistResponse.json() as {
      items: Array<{
        referral_id: number;
        categories: string[];
      }>;
    };
    const bucketByMode = {
      active: "all_actionable",
      unassigned: "unassigned",
      packet_review: "packet_review",
      assessment: "assessment_due",
      decision: "decision_needed",
    } as const;
    const modes = ["active", "unassigned", "packet_review", "assessment", "decision", "files"] as const;
    for (const mode of modes) {
      const response = await page.request.get(`/api/search?mode=${mode}&q=${encodeURIComponent(mode)}`);
      expect(response.ok()).toBeTruthy();
      const payload = await response.json() as {
        interpreted_query: string;
        referrals: Array<{ id: number }>;
        files: Array<{ id: string }>;
        counts: { referrals: number; files: number; total: number };
      };
      expect(payload.interpreted_query).toBe(mode);
      expect(payload.counts.total).toBe(payload.counts.referrals + payload.counts.files);

      if (mode === "files") {
        expect(payload.referrals).toEqual([]);
        expect(payload.counts.files).toBe(payload.files.length);
        continue;
      }

      const bucket = bucketByMode[mode];
      const expectedIds = worklist.items
        .filter((item) => bucket === "all_actionable" || item.categories.includes(bucket))
        .map((item) => item.referral_id);
      expect(payload.referrals.map((referral) => referral.id)).toEqual(expectedIds);
      expect(payload.counts.referrals).toBe(expectedIds.length);
    }
  });

  test("opens an admitted client from search and restores it from Recents", async ({ page }) => {
    const resident = (clinicalFixture.roster as {
      residents: Array<{
        resident_key: string;
        display_name: string;
        community_name: string;
        unit: string | null;
      }>;
    }).residents[0];

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
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: "Avery",
          interpreted_query: "Avery",
          referrals: [],
          files: [],
          residents: [resident],
          clinical_warning: null,
          counts: { referrals: 0, files: 0, residents: 1, total: 1 },
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

    const residentResult = page.getByRole("button", { name: /Avery Example/ });
    await expect(residentResult).toBeVisible();
    await residentResult.click();
    await expect(page.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\?screen=profile&clientId=/);
    expect(new URL(page.url()).searchParams.has("view")).toBeFalsy();

    await page.getByRole("link", { name: "Pipeline" }).click();
    const recent = page.getByRole("region", { name: "Recent" });
    await expect(recent.getByText("Broken recent", { exact: true })).toHaveCount(0);
    await expect(recent.getByRole("button", { name: /Avery Example/ })).toBeVisible();
    await expect(recent.getByText("Profile", { exact: true })).toBeVisible();
    await recent.getByRole("button", { name: /Avery Example/ }).click();
    await expect(page.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
  });

  test("searches site destinations and the admitted roster while typing", async ({ page }) => {
    const roster = clinicalFixture.roster as {
      residents: Array<{
        resident_key: string;
        display_name: string;
        community_name: string;
        unit: string | null;
      }>;
      [key: string]: unknown;
    };
    const resident = roster.residents[0];

    await page.route("**/api/clinical/roster**", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q")?.trim().toLowerCase() ?? "";
      const residents = query && !resident.display_name.toLowerCase().includes(query) ? [] : [resident];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...roster, residents, total: residents.length, next_cursor: null }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Open search" }).click();
    const globalSearch = page.getByLabel("Search or ask");
    await globalSearch.fill("profles");
    const profilesResult = page.getByRole("button", { name: "Open Client profiles from search" });
    await expect(profilesResult).toBeVisible();
    await profilesResult.click();

    await expect(page.getByRole("main", { name: "Client profiles" })).toBeVisible();
    const rosterSearch = page.getByLabel("Search admitted clients");
    await rosterSearch.fill("Avery");
    await expect(page.getByRole("button", { name: `Open profile for ${resident.display_name}` })).toBeVisible();
    await rosterSearch.fill("No matching resident");
    await expect(page.getByText("No admitted clients match that search.", { exact: true })).toBeVisible();
  });

  test("shows the welcome once, then returns to the home workspace", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Welcome, Playwright QA." })).toBeVisible();

    await page.getByRole("link", { name: "Open referrals" }).click();
    await expect(page.getByRole("heading", { name: "Referral packets", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Pipeline" }).click();

    await expect(page.getByRole("heading", { name: /Welcome( back)?, / })).toHaveCount(0);
    await expect(page.getByTitle("Home")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Search and ask" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "My queue" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Welcome back, Playwright QA." })).toBeVisible();
  });

  test("opens the Alamo admitted-client roster and governed profile", async ({ page }) => {
    await page.route("**/api/clinical/roster**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clinicalFixture.roster) });
    });
    await page.route("**/api/profiles/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(unifiedProfileFixture) });
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Open client profiles" }).click();
    await expect(page.getByRole("main", { name: "Client profiles" })).toBeVisible();
    await expect.poll(async () => (await page.getByTestId("profiles-workspace").boundingBox())?.width ?? 0).toBeLessThan(1100);
    await expect.poll(async () => (await page.getByTestId("profiles-workspace").boundingBox())?.width ?? 0).toBeGreaterThan(800);
    const activeProfiles = page.getByRole("button", { name: "Open client profiles" });
    await expect(activeProfiles).toHaveAttribute("aria-pressed", "true");
    await expect(activeProfiles).toHaveAttribute("data-active", "true");
    await expect(activeProfiles).toHaveClass(/bg-\[#eef1ff\]/);
    await expect(activeProfiles).toHaveCSS("background-color", "rgb(238, 241, 255)");
    await expect(activeProfiles).toHaveCSS("border-color", "rgb(75, 104, 173)");
    await expect(page.getByText("1 of 1 admitted clients", { exact: true })).toBeVisible();
    await expect(page.getByText("Avery Example", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Avery Example/ }).click();
    await expect(page.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
    await expect.poll(async () => (await page.getByTestId("profile-workspace").boundingBox())?.width ?? 0).toBeGreaterThan(1200);
    await expect(page.getByText("Data completeness", { exact: true })).toBeVisible();
    await expect(page.getByText("Identity and residence", { exact: true })).toBeVisible();
    await expect(page.getByText("Clinical snapshot", { exact: true })).toBeVisible();
    await expect(page.getByText("Pipeline work", { exact: true })).toBeVisible();
    await expect(page.getByText("Assessments", { exact: true })).toBeVisible();
    await expect(page.getByText("Pipeline identity not connected", { exact: true })).toBeVisible();
    await expect(page.getByText("Pipeline not connected", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose Pipeline referral" })).toBeVisible();
    await expect(page.getByText("Open referral packet", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Pipeline" })).toBeVisible();
  });

  test("recovers a client profile after a temporary server failure", async ({ page }) => {
    let serviceAvailable = false;

    await page.route("**/api/clinical/roster**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clinicalFixture.roster) });
    });
    await page.route("**/api/profiles/**", async (route) => {
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
    await expect(alert).toContainText("Pipeline's operational profile data is temporarily unavailable.");
    await expect(alert).not.toContainText("Internal server error");
    serviceAvailable = true;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Avery Example", exact: true })).toBeVisible();
  });

  test("stacks admitted-client community, admission-date, and profile-data filters", async ({ page }) => {
    const roster = clinicalFixture.roster as {
      residents: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const baseResident = roster.residents[0];
    const residents = [
      {
        ...baseResident,
        resident_id: "R-201",
        resident_key: "337:R-201",
        display_name: "Recent San Pablo",
        community_id: "337",
        community_name: "A & A Health Services San Pablo",
        unit: "10A",
        admit_date: "2026-07-08",
      },
      {
        ...baseResident,
        resident_id: "R-202",
        resident_key: "337:R-202",
        display_name: "Older San Pablo",
        community_id: "337",
        community_name: "A & A Health Services San Pablo",
        unit: "10B",
        admit_date: "2025-01-08",
      },
      {
        ...baseResident,
        resident_id: "R-203",
        resident_key: "280:R-203",
        display_name: "Recent Turlock",
        community_id: "280",
        community_name: "AHS Turlock OP LLC",
        unit: null,
        admit_date: "2026-06-08",
      },
    ];

    await page.route("**/api/clinical/roster**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...roster,
          residents,
          total: residents.length,
          next_cursor: null,
          data_as_of: "2026-08-07",
        }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Open client profiles" }).click();
    await expect(page.getByText("Recent San Pablo", { exact: true })).toBeVisible();

    const addFilter = page.getByRole("button", { name: "Add profile filter" });
    await addFilter.click();
    await page.getByRole("menuitem", { name: /Admission date/ }).click();
    await expect(page.getByLabel("Filter profiles by admission date")).toHaveValue("last_6_months");
    await expect(page.getByText("Recent San Pablo", { exact: true })).toBeVisible();
    await expect(page.getByText("Recent Turlock", { exact: true })).toBeVisible();
    await expect(page.getByText("Older San Pablo", { exact: true })).toHaveCount(0);

    await addFilter.click();
    await page.getByRole("menuitem", { name: /Community/ }).click();
    await page.getByLabel("Filter profiles by community").selectOption("337");
    await expect(page.getByText("1 of 1 matching", { exact: true })).toBeVisible();
    await expect(page.getByText("Recent San Pablo", { exact: true })).toBeVisible();
    await expect(page.getByText("Recent Turlock", { exact: true })).toHaveCount(0);

    await addFilter.click();
    await page.getByRole("menuitem", { name: /Profile data/ }).click();
    await page.getByLabel("Filter profiles by profile data").selectOption("complete");
    await expect(page.getByText("Recent San Pablo", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Remove admitted filter" }).click();
    await expect(page.getByText("Older San Pablo", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page.getByText("Recent Turlock", { exact: true })).toBeVisible();
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

    await page.route("**/api/clinical/roster**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(clinicalFixture.roster) });
    });
    await page.route("**/api/profiles/**", async (route) => {
      const profile = structuredClone(unifiedProfileFixture);
      const connection: {
        status: string;
        confirmed_link: typeof candidate | null;
        candidates: Array<typeof candidate>;
        message: string;
      } = connectionStatus === "unlinked"
        ? unifiedProfileFixture.pipeline.connection
        : connectionStatus === "candidate"
          ? {
              status: "candidate",
              confirmed_link: null,
              candidates: [candidate],
              message: "A possible Pipeline identity match needs human review before operational records can be joined.",
            }
          : {
              status: "confirmed",
              confirmed_link: { ...candidate, status: "confirmed", version: 2 },
              candidates: [],
              message: "Pipeline operational records are joined through a reviewed resident link.",
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
      expect(body).toMatchObject({ referral_id: referral.id, resident_key: resident.resident_key, match_method: "manual" });
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
    await page.getByRole("button", { name: "Choose Pipeline referral" }).click();
    await page.getByPlaceholder("Find the exact referral").fill("Avery");
    await page.getByRole("button", { name: /Avery Example.*#101/ }).click();
    await page.getByRole("button", { name: "Send match for review" }).click();
    await expect(page.getByText("Identity review needed", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("button", { name: "Confirm connection" }).click();
    await expect(page.getByText("Pipeline connected", { exact: true }).first()).toBeVisible();
  });

  test("opens the lightweight operations overview from the profile menu", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Open profile menu for Playwright QA" }).click();
    await page.getByRole("link", { name: "Operations Queue, ownership, and data gaps" }).click();
    await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Operations summary" })).toBeVisible();
    await expect(page.getByText("Active referrals", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Work queue", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Data gaps", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: /^Referral has no owner \(\d+\)$/ })).toBeAttached();
    await expect(page.getByRole("option", { name: /^Requirement has no owner \(\d+\)$/ })).toBeAttached();
    await expect(page.getByText("Referral flow", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Data health", { exact: true })).toHaveCount(0);
  });
});
