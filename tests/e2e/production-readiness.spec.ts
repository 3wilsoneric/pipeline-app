import { expect, test } from "@playwright/test";

test.describe("production response boundaries", () => {
  test("applies browser security headers without framework disclosure", async ({ page }) => {
    const response = await page.goto("/");
    expect(response).not.toBeNull();
    const headers = response!.headers();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["permissions-policy"]).toContain("microphone=()");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("marks authenticated API responses as private and non-cacheable", async ({ request }) => {
    const response = await request.get("/api/auth/me");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["cache-control"]).toContain("private");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers().pragma).toBe("no-cache");
    expect(response.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("rejects cross-origin session mutations and never caches the denial", async ({ request }) => {
    const response = await request.delete("/api/auth/session", {
      headers: { Origin: "https://cross-site.example.invalid" },
    });
    expect(response.status()).toBe(403);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toEqual({
      error: "This write must come from the Pipeline application origin.",
    });
  });
});
