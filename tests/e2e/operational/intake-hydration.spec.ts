import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actorPage, operationalActorHeaders, pipelineActors } from "../support/pipeline-actors";
import { createOperationalReferral } from "../support/operational-api";
import { referralCanvasFieldKeys } from "../../../lib/pipeline/referral-types";
import { canvasDraftStorageKey } from "../../../components/pipeline/referral-canvas-save-state";

const sessionDrafts = process.env.NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED === "false";
test.beforeEach(() => test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage."));

for (const failure of [false, true]) {
  test(`saved intake remains noneditable until its canonical load ${failure ? "recovers from a failed request" : "finishes"}`, async ({ browser, baseURL }) => {
    const session = await actorPage(browser, "assessorA", baseURL!);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    try {
      const { page } = session;
      const saved = await createOperationalReferral(page.request, "assessorA", { phone: "5105550141", source: "Original synthetic source" });
      let requested = false, fail = failure;
      await page.route(`**/api/referrals/${saved.id}/canvas`, async route => {
        requested = true;
        await gate;
        if (fail) await route.fulfill({ status: 503, json: { error: "Synthetic canonical load failure" } });
        else await route.fulfill({ response: await route.fetch() });
      });
      await page.goto(`/?view=referrals&screen=packet&referralId=${saved.id}&workspaceStage=intake`);
      await expect.poll(() => requested).toBe(true);
      const workspace = page.getByTestId("packet-workspace");
      await expect(workspace).toHaveAttribute("aria-busy", "true");
      expect(await workspace.evaluate(element => element.hasAttribute("inert"))).toBe(true);
      await page.keyboard.press("Tab");
      expect(await workspace.evaluate(element => element.contains(document.activeElement))).toBe(false);
      release();
      if (failure) {
        await expect(page.getByText("Could not load the saved referral record.", { exact: true })).toBeVisible();
        expect(await workspace.locator('input:enabled:visible, textarea:enabled:visible, select:enabled:visible').count()).toBe(0);
        expect((await (await page.request.get(`/api/referrals/${saved.id}`)).json()).referral).toMatchObject(saved);
        fail = false;
        await page.getByRole("button", { name: "Retry loading", exact: true }).click();
      }
      await expect(workspace).toHaveAttribute("aria-busy", "false");
      await page.getByRole("button", { name: "Edit Referral source", exact: true }).click();
      const source = page.getByRole("combobox", { name: "Referral facility / source", exact: true });
      await expect(source).toHaveValue("Original synthetic source");
      await source.fill("Edit after canonical hydration");
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await expect.poll(async () => (await (await page.request.get(`/api/referrals/${saved.id}`)).json()).referral)
        .toMatchObject({ phone: "5105550141", source: "Edit after canonical hydration", version: saved.version + 1 });
      const events = (await (await page.request.get(`/api/referrals/${saved.id}/activity`)).json()).events;
      expect(events.filter((event: { changed_fields: string[] }) => event.changed_fields.includes("source"))).toHaveLength(1);
    } finally { release(); await session.context.close(); }
  });
}

test("a stale canonical response cannot replace the next workspace", async ({ browser, baseURL }) => {
  const session = await actorPage(browser, "assessorA", baseURL!);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const { page } = session;
    const first = await createOperationalReferral(page.request, "assessorA", { source: "First synthetic source" });
    const second = await createOperationalReferral(page.request, "assessorA", { source: "Second synthetic source" });
    let requested = false, released = false;
    await page.route(`**/api/referrals/${first.id}/canvas`, async route => {
      const response = await route.fetch(); requested = true;
      await gate;
      await route.fulfill({ response }).catch(() => undefined); released = true;
    });
    await page.goto(`/?view=referrals&screen=packet&referralId=${first.id}&workspaceStage=intake`);
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "true");
    // History navigation uses the mounted app's route listener, not a new browser document.
    await page.evaluate(id => { history.pushState(null, "", `/?view=referrals&screen=packet&referralId=${id}&workspaceStage=intake`); window.dispatchEvent(new PopStateEvent("popstate")); }, second.id);
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: "Edit Referral source", exact: true }).click();
    const source = page.getByRole("combobox", { name: "Referral facility / source", exact: true });
    await expect(source).toHaveValue("Second synthetic source");
    release();
    await expect.poll(() => released).toBe(true);
    await expect(source).toHaveValue("Second synthetic source");
    await source.fill("Second workspace edit");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(async () => (await (await page.request.get(`/api/referrals/${second.id}`)).json()).referral.source).toBe("Second workspace edit");
    expect((await (await page.request.get(`/api/referrals/${first.id}`)).json()).referral).toMatchObject({ source: "First synthetic source", version: first.version });
  } finally { release(); await session.context.close(); }
});

test("an unavailable draft service and unavailable device storage produce an explicit recovery error", async ({ browser, baseURL }) => {
  const session = await actorPage(browser, "assessorA", baseURL!);
  try {
    await session.context.addInitScript(() => {
      indexedDB.open = () => { throw new DOMException("Synthetic unavailable storage", "InvalidStateError"); };
      const originalGet = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key: string) {
        if (key.startsWith("pipeline-referral-draft")) throw new DOMException("Synthetic unavailable draft", "SecurityError");
        return originalGet.call(this, key);
      };
    });
    await session.page.route("**/api/me/referral-drafts/**", route => route.fulfill({ status: 503, json: { error: "Synthetic unavailable drafts" } }));
    await session.page.goto(`/?view=referrals&screen=packet&draftId=${randomUUID()}`);
    await expect(session.page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
    await expect(session.page.getByText("Could not check for a recovery draft.", { exact: true })).toBeVisible();
    await expect(session.page.getByRole("textbox", { name: "NAME", exact: true })).toBeEditable();
  } finally { await session.context.close(); }
});

test("switching approved accounts does not display or erase the previous account's unfinished intake", async ({ browser, baseURL }) => {
  const session = await actorPage(browser, "assessorA", baseURL!);
  try {
    const { page, context } = session;
    const draftId = randomUUID(), name = "Synthetic Private Draft";
    await page.goto(`/?view=referrals&screen=packet&draftId=${draftId}`);
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
    await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
    await page.getByRole("combobox", { name: "Referral facility / source", exact: true }).fill("Private pending source");
    await page.getByRole("textbox", { name: "NAME", exact: true }).focus();
    if (sessionDrafts) {
      await expect.poll(() => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? "null")?.fields.name.value, canvasDraftStorageKey(`new-${draftId}`, pipelineActors.assessorA.id))).toBe(name);
    } else {
      await expect.poll(async () => (await (await page.request.get(`/api/me/referral-drafts/new-${draftId}`)).json()).draft?.fields.name.value).toBe(name);
    }
    await context.setExtraHTTPHeaders(operationalActorHeaders("assessorB", baseURL!));
    await page.reload();
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
    await expect(page.getByRole("button", { name: "Open profile menu for Assessor B", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Referral facility / source", exact: true })).toHaveValue("");
    await context.setExtraHTTPHeaders(operationalActorHeaders("assessorA", baseURL!));
    await page.reload();
    await expect(page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(name);
    await expect(page.getByRole("combobox", { name: "Referral facility / source", exact: true })).toHaveValue("Private pending source");
  } finally { await session.context.close(); }
});

for (const directLink of [false, true]) {
  test(`an unbound legacy tab draft is preserved without assigning it to the current account${directLink ? " on a legacy direct link" : ""}`, async ({ browser, baseURL }) => {
    const session = await actorPage(browser, "assessorA", baseURL!);
    try {
      const id = randomUUID(), name = "Synthetic Unbound Legacy";
      const key = canvasDraftStorageKey(directLink ? undefined : `new-${id}`);
      const bytes = JSON.stringify(draftFixture(name));
      await session.page.goto("/");
      await session.page.evaluate(({ key, bytes }) => sessionStorage.setItem(key, bytes), { key, bytes });
      await session.page.goto(`/?view=referrals&screen=packet${directLink ? "" : `&draftId=${id}`}`);
      // Authenticated desktop recovery does not consume a legacy tab copy when
      // a keyed server/device draft is the canonical owner. Direct migration must refuse it in either mode.
      if (sessionDrafts || directLink) {
        await expect(session.page.getByText(directLink ? "Could not prepare your saved intake. Try again." : "Could not check for a recovery draft.", { exact: true })).toBeVisible();
      }
      await expect(session.page.getByText(name, { exact: true })).toHaveCount(0);
      if (!directLink) await expect(session.page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("");
      expect(await session.page.evaluate(key => sessionStorage.getItem(key), key)).toBe(bytes);
    } finally { await session.context.close(); }
  });
}

test("a readable account-bound draft remains usable while unavailable device recovery is reported", async ({ browser, baseURL }) => {
  const session = await actorPage(browser, "assessorA", baseURL!);
  try {
    const id = randomUUID(), draft = draftFixture("Synthetic Available Copy");
    await session.page.goto("/");
    if (sessionDrafts) {
      await session.page.evaluate(({ key, draft }) => sessionStorage.setItem(key, JSON.stringify(draft)), {
        key: canvasDraftStorageKey(`new-${id}`, pipelineActors.assessorA.id), draft,
      });
    } else {
      expect((await session.page.request.put(`/api/me/referral-drafts/new-${id}`, { data: { if_match: 0, draft } })).status()).toBe(200);
    }
    await session.context.addInitScript(() => { indexedDB.open = () => { throw new DOMException("Synthetic storage failure", "InvalidStateError"); }; });
    await session.page.goto(`/?view=referrals&screen=packet&draftId=${id}`);
    await expect(session.page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Synthetic Available Copy");
    await expect(session.page.getByText("Could not check for a recovery draft.", { exact: true })).toBeVisible();
    await expect(session.page.getByRole("textbox", { name: "NAME", exact: true })).toBeEditable();
  } finally { await session.context.close(); }
});

test("a confirmed account's default draft migrates to its own URL and survives reload", async ({ browser, baseURL }) => {
  const session = await actorPage(browser, "assessorA", baseURL!);
  try {
    const draft = draftFixture("Synthetic Migrating Draft");
    await session.page.goto("/");
    const previousKey = canvasDraftStorageKey(undefined, pipelineActors.assessorA.id);
    await session.page.evaluate(({ key, draft }) => sessionStorage.setItem(key, JSON.stringify(draft)), { key: previousKey, draft });
    await session.page.goto("/?view=referrals&screen=packet");
    await expect(session.page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Synthetic Migrating Draft");
    await expect.poll(() => new URL(session.page.url()).searchParams.get("draftId")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await session.page.evaluate(key => sessionStorage.getItem(key), previousKey)).toBeNull();
    await session.page.reload();
    await expect(session.page.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue("Synthetic Migrating Draft");
  } finally { await session.context.close(); }
});

test("an offline saved-referral edit reconnects with one version and one audit change", async ({ browser, baseURL }) => {
  const session = await actorPage(browser, "assessorA", baseURL!);
  try {
    const { page, context } = session;
    const saved = await createOperationalReferral(page.request, "assessorA", { source: "Before network loss" });
    await page.goto(`/?view=referrals&screen=packet&referralId=${saved.id}&workspaceStage=intake`);
    await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: "Edit Referral source", exact: true }).click();
    await context.setOffline(true);
    await page.getByRole("combobox", { name: "Referral facility / source", exact: true }).fill("Edit during network loss");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const saving = page.getByRole("region", { name: "Saving", exact: true });
    await expect(saving.getByRole("alert", { name: "Not saved to Pipeline", exact: true })).toBeVisible();
    await expect(saving.getByRole("listitem", { name: "Pipeline could not be reached.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry saving", exact: true })).toHaveCount(1);
    expect((await (await page.request.get(`/api/referrals/${saved.id}`)).json()).referral).toMatchObject({ source: "Before network loss", version: saved.version });
    await context.setOffline(false);
    await expect.poll(async () => (await (await page.request.get(`/api/referrals/${saved.id}`)).json()).referral, { timeout: 15_000 })
      .toMatchObject({ source: "Edit during network loss", version: saved.version + 1 });
    await page.reload();
    await expect(page.getByRole("button", { name: "Edit Referral source", exact: true })).toHaveText("Edit during network loss");
    const events = (await (await page.request.get(`/api/referrals/${saved.id}/activity`)).json()).events;
    expect(events.filter((event: { changed_fields: string[] }) => event.changed_fields.includes("source"))).toHaveLength(1);
  } finally { await session.context.setOffline(false); await session.context.close(); }
});

function draftFixture(name: string) {
  return { schema: 1, savedAt: new Date().toISOString(), dirtyKeys: ["name"],
    fields: Object.fromEntries(referralCanvasFieldKeys.map(key => [key, { value: key === "name" ? name : "" }])),
    conserved: "", tagsInput: "", documents: {},
  };
}
