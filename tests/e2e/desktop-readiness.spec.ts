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
    expect(cacheAudit.names).toEqual(["pipeline-static-v1"]);
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
      await expect(page.getByText("Client and referral data is never stored for offline use.")).toBeVisible();
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
      "pipeline-static-v1",
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
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect.poll(async () => {
      const response = await page.request.get("/api/me/referral-drafts/new");
      return (await response.json()) as { draft?: unknown; version?: number };
    }).toMatchObject({ draft: null, version: 0 });
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
