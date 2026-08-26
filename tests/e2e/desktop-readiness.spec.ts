import { expect, test } from "@playwright/test";

const desktopEnabled = process.env.PIPELINE_DESKTOP_E2E === "true";

test.describe("desktop feature disabled", () => {
  test.skip(desktopEnabled, "Runs only in the normal web configuration.");

  test("does not advertise or register desktop support", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    const registrations = await page.evaluate(async () => (
      "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0
    ));
    expect(registrations).toBe(0);
  });
});

test.describe("desktop feature enabled", () => {
  test.skip(!desktopEnabled, "Run with npm run test:e2e:desktop.");

  test("is installable without caching protected data", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/desktop-manifest.webmanifest");

    const manifest = await page.request.get("/desktop-manifest.webmanifest");
    expect(manifest.ok()).toBeTruthy();
    expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
    expect(await manifest.json()).toMatchObject({
      name: "Pipeline",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.request.get("/api/auth/me");

    const cacheAudit = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls = (await Promise.all(names.map(async (name) => {
        const cache = await caches.open(name);
        return (await cache.keys()).map((request) => request.url);
      }))).flat();
      return { names, urls };
    });
    expect(cacheAudit.names).toEqual(["pipeline-static-v2"]);
    expect(cacheAudit.urls.some((url) => new URL(url).pathname.startsWith("/api/"))).toBeFalsy();
    expect(cacheAudit.urls.every((url) => {
      const path = new URL(url).pathname;
      return path === "/offline.html" || path.startsWith("/pwa/") || path.startsWith("/_next/static/");
    })).toBeTruthy();
  });

  test("falls back to a generic PHI-free offline screen", async ({ context, page }) => {
    await page.goto("/");
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBeTruthy();

    await context.setOffline(true);
    try {
      await page.goto("/referrals", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "A connection is required." })).toBeVisible();
      await expect(page.getByText("An assessment already open can keep working offline", { exact: false })).toBeVisible();
      await expect(page.locator("script")).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });

  test("replaces old Pipeline caches and honors the desktop kill switch", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.evaluate(async () => {
      const oldPipeline = await caches.open("pipeline-static-v0");
      await oldPipeline.put("/old-pipeline-asset", new Response("old"));
      const unrelated = await caches.open("unrelated-application-cache");
      await unrelated.put("/unrelated-asset", new Response("keep"));
      const registration = await navigator.serviceWorker.ready;
      registration.active?.postMessage({ type: "PIPELINE_PRUNE_DESKTOP_CACHES" });
    });

    await expect.poll(async () => page.evaluate(async () => (await caches.keys()).sort())).toEqual([
      "pipeline-static-v2",
      "unrelated-application-cache",
    ]);

    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const worker = registration?.active ?? registration?.waiting ?? registration?.installing;
      worker?.postMessage({ type: "PIPELINE_DISABLE_DESKTOP_CACHE" });
    });
    await expect.poll(async () => page.evaluate(async () => ({
      pipelineCaches: (await caches.keys()).filter((name) => name.startsWith("pipeline-static-")),
      registration: Boolean(await navigator.serviceWorker.getRegistration("/")),
      unrelated: (await caches.keys()).includes("unrelated-application-cache"),
    }))).toEqual({ pipelineCaches: [], registration: false, unrelated: true });
  });

  test("stores recents and versioned recovery drafts per signed-in user", async ({ page }) => {
    await page.goto("/");
    const cleanup = await page.evaluate(async () => {
      const current = await fetch("/api/me/referral-drafts/new", { cache: "no-store" });
      const payload = await current.json() as { version?: number };
      const version = Number(payload.version ?? 0);
      if (version === 0) return { status: 200, deleted: false };
      const response = await fetch("/api/me/referral-drafts/new", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_match: version }),
      });
      return { status: response.status, deleted: response.ok };
    });
    expect(cleanup.status).toBe(200);

    await page.getByRole("button", { name: "Open referrals" }).click();
    await expect.poll(async () => {
      const response = await page.request.get("/api/me/recents");
      const payload = await response.json() as { recents?: Array<{ id?: string }> };
      return payload.recents?.some((item) => item.id === "page:referrals") ?? false;
    }).toBeTruthy();

    const browserState = await page.evaluate(() => ({
      recents: window.sessionStorage.getItem("pipeline.recent-destinations.v1"),
      draft: window.sessionStorage.getItem("pipeline-referral-draft:new"),
    }));
    expect(browserState).toEqual({ recents: null, draft: null });

    const draft = referralDraft("Desktop recovery value");
    const first = await page.evaluate(async (value) => {
      const response = await fetch("/api/me/referral-drafts/new", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_match: 0, draft: value }),
      });
      return { status: response.status, payload: await response.json() };
    }, draft);
    expect(first.status).toBe(200);
    expect(first.payload.version).toBe(1);

    const conflict = await page.evaluate(async (value) => {
      const response = await fetch("/api/me/referral-drafts/new", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_match: 0, draft: value }),
      });
      return { status: response.status, payload: await response.json() };
    }, referralDraft("Stale replacement"));
    expect(conflict.status).toBe(409);
    expect(conflict.payload).toMatchObject({ conflict: true, version: 1 });

    const recovered = await page.request.get("/api/me/referral-drafts/new");
    expect(await recovered.json()).toMatchObject({
      version: 1,
      draft: { fields: { summary: { value: "Desktop recovery value" } } },
    });

    const staleDelete = await page.evaluate(async () => {
      const response = await fetch("/api/me/referral-drafts/new", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_match: 0 }),
      });
      return { status: response.status, payload: await response.json() };
    });
    expect(staleDelete.status).toBe(409);
    expect(staleDelete.payload).toMatchObject({ conflict: true, version: 1 });

    const deleted = await page.evaluate(async () => {
      const response = await fetch("/api/me/referral-drafts/new", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_match: 1 }),
      });
      return { status: response.status, payload: await response.json() };
    });
    expect(deleted).toMatchObject({ status: 200, payload: { deleted: true } });

    await page.getByRole("button", { name: "Create new referral" }).click();
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill("Desktop draft cleanup check");
    await expect.poll(async () => {
      const response = await page.request.get("/api/me/referral-drafts/new");
      const payload = await response.json() as { draft?: unknown };
      return Boolean(payload.draft);
    }).toBeTruthy();
    await page.getByTestId("initial-packet-input").setInputFiles({
      name: "desktop-recovery-face-sheet.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(`desktop-recovery-face-sheet-${Date.now()}`),
    });
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect.poll(async () => {
      const response = await page.request.get("/api/me/referral-drafts/new");
      return (await response.json()) as { draft?: unknown; version?: number };
    }).toMatchObject({ draft: null, version: 0 });
  });

  test("encrypts offline assessment edits and syncs them after reconnecting", async ({ context, page }) => {
    await page.goto("/");
    const membersResponse = await page.request.get("/api/members");
    const members = await membersResponse.json() as {
      members: Array<{ principal_id: string; display_name: string }>;
      current_principal_id: string;
    };
    const current = members.members.find((member) => member.principal_id === members.current_principal_id);
    expect(current).toBeTruthy();

    const token = Date.now().toString(36);
    const createdResponse = await page.request.post("/api/referrals", {
      data: {
        client_mutation_id: `offline-referral-${token}`,
        referral: {
          name: `Offline assessment ${token}`,
          date: "2026-08-25",
          stage: "New",
          community: "San Pablo",
          source: "Offline browser verification",
          priority: "standard",
          tags: [],
          documentName: `offline-${token}.pdf`,
          documentStatus: "Reviewed",
          packetStatus: "reviewed",
          owner: current!.display_name,
          assignee_id: current!.principal_id,
          note: "",
          createdAt: new Date().toISOString(),
          dob: "1980-01-01",
          phone: "",
          email: "",
          payer: "",
          requirements: [],
        },
      },
    });
    const createdPayload = await createdResponse.json();
    expect(createdResponse.status(), JSON.stringify(createdPayload)).toBe(201);
    const referralId = Number(createdPayload.referral.id);
    let referral = createdPayload.referral as {
      id: number;
      version: number;
      sectionVersions: { workflow: number };
    };
    for (const target_stage of ["Packet Needed", "Packet Review", "Assessment"]) {
      const transitionResponse = await page.request.post(`/api/referrals/${referralId}/transition`, {
        data: {
          if_match: referral.version,
          if_match_section: referral.sectionVersions.workflow,
          target_stage,
        },
      });
      const transitionPayload = await transitionResponse.json();
      expect(transitionResponse.ok(), JSON.stringify(transitionPayload)).toBeTruthy();
      referral = transitionPayload.referral;
    }
    const assessmentResponse = await page.request.post(`/api/referrals/${referralId}/assessments`, {
      data: {
        client_mutation_id: `offline-assessment-${token}`,
        data: {
          resident_name: `Offline assessment ${token}`,
          date_of_birth: "1980-01-01",
          community: "San Pablo",
          assessment_date: "2026-08-25",
          referral_received_date: "2026-08-25",
          referrer_name: "Offline browser verification",
        },
      },
    });
    const assessmentPayload = await assessmentResponse.json();
    expect(assessmentResponse.status(), JSON.stringify(assessmentPayload)).toBe(201);

    await page.goto(`/?view=referrals&screen=packet&referralId=${referralId}`);
    await page.getByRole("button", { name: "02 Assessment" }).click();
    const assessmentDialog = page.getByRole("dialog", { name: "Assessment interview" });
    const openAssessment = page.getByRole("button", { name: "Open assessment", exact: true });
    await expect(assessmentDialog.or(openAssessment)).toBeVisible();
    if (await openAssessment.isVisible()) await openAssessment.click();
    await expect(assessmentDialog).toBeVisible();
    const setupDialog = page.getByRole("dialog", { name: "Prepare interview" });
    await expect(setupDialog).toBeVisible();
    const begin = page.getByRole("button", { name: "Begin interview", exact: true });
    await begin.click();
    await expect(setupDialog).toBeHidden();
    const location = page.getByRole("textbox", { name: "Current location *", exact: true });
    await expect(location).toBeVisible();

    const offlineValue = `Offline location ${token}`;
    await context.setOffline(true);
    try {
      await location.fill(offlineValue);
      await expect(page.getByText("Offline · 1 queued", { exact: true })).toBeVisible({ timeout: 10_000 });
      const encrypted = await page.evaluate(async (plaintext) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("pipeline-offline-v1");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const records = await new Promise<unknown[]>((resolve, reject) => {
          const request = database.transaction("mutations").objectStore("mutations").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        database.close();
        const serialized = JSON.stringify(records);
        return { count: records.length, containsPlaintext: serialized.includes(plaintext) };
      }, offlineValue);
      expect(encrypted.count).toBeGreaterThan(0);
      expect(encrypted.containsPlaintext).toBeFalsy();
    } finally {
      await context.setOffline(false);
    }

    await expect(page.getByText("Offline changes synced", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => {
      const response = await page.request.get(`/api/assessments/${assessmentPayload.assessment.assessment_id}`);
      const payload = await response.json() as { assessment?: { current_location?: string } };
      return payload.assessment?.current_location ?? "";
    }).toBe(offlineValue);
  });
});

function referralDraft(summary: string) {
  const fields = Object.fromEntries([
    "name", "gender", "age", "dob", "ssn", "owner", "referralReceived",
    "admissionDate", "county", "referent", "responsiblePerson", "summary", "interview",
  ].map((key) => [key, { value: key === "summary" ? summary : "" }]));
  return {
    schema: 1,
    savedAt: new Date().toISOString(),
    dirtyKeys: ["summary"],
    fields,
    conserved: "",
    tagsInput: "",
    documents: {},
  };
}
