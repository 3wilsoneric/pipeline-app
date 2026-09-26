import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("direct packet link replays a committed create after its response is lost and the page reloads", async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E === "true", "This recovery path uses tab storage.");
  const name = `Direct link ${randomUUID().slice(0, 8)}`;
  const mutationIds: string[] = [];
  let committedId: number | undefined;
  let replay: { id: number; idempotent: boolean } | undefined;

  await page.route("**/api/referrals", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as { client_mutation_id: string };
    mutationIds.push(body.client_mutation_id);
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    const payload = await response.json() as { referral: { id: number }; idempotent_replay: boolean };
    if (mutationIds.length === 1) {
      committedId = payload.referral.id;
      await route.abort("failed");
      return;
    }
    replay = { id: payload.referral.id, idempotent: payload.idempotent_replay };
    await route.fulfill({ response });
  });

  await page.goto("/?view=referrals&screen=packet");
  await expect.poll(() => new URL(page.url()).searchParams.get("draftId")).toMatch(/^[0-9a-f-]{36}$/i);
  const draftId = new URL(page.url()).searchParams.get("draftId");
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
  await expect.poll(() => page.evaluate((id) => Boolean(window.sessionStorage.getItem(`pipeline-referral-draft:new-${id}`)), draftId)).toBe(true);
  await page.getByRole("button", { name: "Create referral", exact: true }).click();
  await expect.poll(() => committedId).toBeGreaterThan(0);
  await expect(page.getByRole("alert").filter({ hasText: "Pipeline could not be reached." })).toBeVisible();

  await page.reload();
  expect(new URL(page.url()).searchParams.get("draftId")).toBe(draftId);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(name);
  await page.getByRole("button", { name: "Create referral", exact: true }).click();

  await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe(String(committedId));
  expect(mutationIds).toHaveLength(2);
  expect(mutationIds[1]).toBe(mutationIds[0]);
  expect(replay).toEqual({ id: committedId, idempotent: true });
  const stored = await page.request.get(`/api/referrals/${committedId}`);
  expect(stored.ok()).toBe(true);
  expect((await stored.json() as { referral: { id: number } }).referral.id).toBe(committedId);
});

test("direct packet link carries a generic pending intake into its durable draft ID", async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E === "true", "This recovery path uses tab storage.");
  const originalId = randomUUID();
  const name = `Legacy intake ${randomUUID().slice(0, 8)}`;
  await page.goto(`/?view=referrals&screen=packet&draftId=${originalId}`);
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
  await expect.poll(() => page.evaluate((id) => Boolean(window.sessionStorage.getItem(`pipeline-referral-draft:new-${id}`)), originalId)).toBe(true);
  await page.evaluate((id) => {
    const key = `pipeline-referral-draft:new-${id}`;
    window.sessionStorage.setItem("pipeline-referral-draft:new", window.sessionStorage.getItem(key)!);
    window.sessionStorage.removeItem(key);
  }, originalId);

  await page.goto("/?view=referrals&screen=packet");
  await expect.poll(() => new URL(page.url()).searchParams.get("draftId")).toMatch(/^[0-9a-f-]{36}$/i);
  const durableId = new URL(page.url()).searchParams.get("draftId");
  expect(durableId).not.toBe(originalId);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(name);
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("pipeline-referral-draft:new"))).toBeNull();
  await page.reload();
  expect(new URL(page.url()).searchParams.get("draftId")).toBe(durableId);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(name);
});

test("direct packet link carries a generic server recovery draft into its durable draft ID", async ({ page }) => {
  test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Server recovery requires desktop workspace state.");
  const sourceId = randomUUID();
  const name = `Legacy server ${randomUUID().slice(0, 8)}`;
  await page.goto(`/?view=referrals&screen=packet&draftId=${sourceId}`);
  await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "NAME", exact: true }).blur();
  const sourcePath = `/api/me/referral-drafts/new-${sourceId}`;
  await expect.poll(async () => (await (await page.request.get(sourcePath)).json()).draft?.fields.name.value).toBe(name);
  const source = await (await page.request.get(sourcePath)).json() as { draft: unknown };
  const legacyPath = "/api/me/referral-drafts/new";
  const previous = await (await page.request.get(legacyPath)).json() as { version: number };
  if (previous.version > 0) {
    expect((await page.request.delete(legacyPath, { data: { if_match: previous.version } })).ok()).toBe(true);
  }
  expect((await page.request.put(legacyPath, { data: { if_match: 0, draft: source.draft } })).ok()).toBe(true);

  const copyTargets: string[] = [];
  await page.route("**/api/me/referral-drafts/new-*", async (route) => {
    const target = new URL(route.request().url()).pathname;
    if (route.request().method() !== "PUT" || target === sourcePath) return route.continue();
    copyTargets.push(target);
    if (copyTargets.length !== 1) return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });

  await page.goto("/?view=referrals&screen=packet");
  await expect(page.getByRole("alert").filter({ hasText: "Could not prepare your saved intake." })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("draftId")).toBeNull();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("draftId")).toMatch(/^[0-9a-f-]{36}$/i);
  const durableId = new URL(page.url()).searchParams.get("draftId");
  expect(durableId).not.toBe(sourceId);
  expect(copyTargets).toEqual([`/api/me/referral-drafts/new-${durableId}`, `/api/me/referral-drafts/new-${durableId}`]);
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(name);
  await expect.poll(async () => (await (await page.request.get(`/api/me/referral-drafts/new-${durableId}`)).json()).draft?.fields.name.value).toBe(name);
  await expect.poll(async () => (await (await page.request.get(legacyPath)).json()).version).toBe(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(name);
});
