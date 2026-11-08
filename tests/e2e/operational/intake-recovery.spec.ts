import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { actorPage, pipelineActors } from "../support/pipeline-actors";
import { canvasDraftStorageKey } from "../../../components/pipeline/referral-canvas-save-state";

const sessionDrafts = process.env.NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED === "false";

for (const reload of [false, true]) {
  test(`intake keeps its exact create command after a lost response${reload ? " and reload" : ""}`, async ({ browser, baseURL }) => {
    test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
    const session = await actorPage(browser, "assessorA", baseURL!);
    let committedId: number | undefined, loseResponses = true;
    const commands: string[] = [];
    try {
      const page = session.page;
      await page.route("**/api/referrals", async route => {
        if (route.request().method() !== "POST") { await route.continue(); return; }
        commands.push(route.request().postData()!);
        const response = await route.fetch();
        if (response.ok()) committedId = (await response.json()).referral.id;
        if (loseResponses) await route.abort("failed");
        else await route.fulfill({ response });
      });
      const draftId = randomUUID();
      await page.goto(`/?view=referrals&screen=packet&draftId=${draftId}`);
      await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
      const name = syntheticPersonName().replace(/\b[a-z]/g, letter => letter.toUpperCase());
      await page.getByRole("textbox", { name: "NAME", exact: true }).fill(name);
      await page.getByRole("combobox", { name: "Requested community" }).selectOption("San Pablo");
      await page.getByRole("combobox", { name: "Client county" }).selectOption("Contra Costa County");
      const create = page.getByRole("button", { name: "Create referral", exact: true });
      await create.click();
      await expect.poll(() => committedId).toBeTruthy();
      await expect(page.getByText("Pipeline could not be reached.", { exact: true })).toBeVisible();
      await page.getByRole("combobox", { name: "Referral facility / source", exact: true }).fill("Edit after submission");
      if (reload) {
        await expect(page.getByTestId("workspace-save-status")).toContainText("Saved on this device");
        await page.reload();
        await expect(page.getByRole("combobox", { name: "Referral facility / source", exact: true })).toHaveValue("Edit after submission");
      }
      loseResponses = false;
      await create.click();
      await expect.poll(() => new URL(page.url()).searchParams.get("referralId")).toBe(String(committedId));
      expect(commands.length).toBeGreaterThanOrEqual(2);
      expect(new Set(commands).size).toBe(1);
      await expect.poll(async () => (await (await page.request.get(`/api/referrals/${committedId}`)).json()).referral).toMatchObject({ name, source: "Edit after submission", version: 2 });
    } finally { await session.context.close(); }
  });
}

for (const scenario of ["disjoint-first", "disjoint-second", "collision", "community-collision"] as const) {
  const collision = scenario.endsWith("collision");
  test(`two tabs sharing an intake ${collision ? `expose same-field conflicts (${scenario})` : `merge disjoint edits (${scenario})`}`, async ({ browser, baseURL }) => {
    test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
    const session = await actorPage(browser, "assessorA", baseURL!);
    try {
      const page = session.page, other = await session.context.newPage(), draftId = randomUUID(), name = syntheticPersonName().replace(/\b[a-z]/g, letter => letter.toUpperCase());
      await page.goto("/");
      if (sessionDrafts) {
        await other.goto("/");
        for (const tab of [page, other]) await tab.evaluate(({ key, draft }) => sessionStorage.setItem(key, JSON.stringify(draft)), {
          key: canvasDraftStorageKey(`new-${draftId}`, pipelineActors.assessorA.id), draft: referralDraft(name),
        });
      } else {
        const response = await page.request.put(`/api/me/referral-drafts/new-${draftId}`, { data: { if_match: 0, draft: referralDraft(name) } });
        expect(response.status(), await response.text()).toBe(200);
      }
      const url = `/?view=referrals&screen=packet&draftId=${draftId}`;
      await Promise.all([page.goto(url), other.goto(url)]);
      for (const tab of [page, other]) {
        await expect(tab.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
        await expect(tab.getByRole("textbox", { name: "NAME", exact: true })).toHaveValue(name);
      }
      await page.getByRole("combobox", { name: "Referral facility / source", exact: true }).fill("First session");
      if (scenario === "community-collision") {
        await page.getByRole("combobox", { name: "Requested community", exact: true }).selectOption("Turlock");
        await other.getByRole("combobox", { name: "Requested community", exact: true }).selectOption("Santa Clarita");
      } else if (collision) await other.getByRole("combobox", { name: "Referral facility / source", exact: true }).fill("Second session");
      else await other.getByRole("combobox", { name: "Client county", exact: true }).selectOption("Marin County");
      // Exercise both winning orders, including creation's default referral source.
      const winner = scenario === "disjoint-second" ? other : page;
      const follower = scenario === "disjoint-second" ? page : other;
      await winner.getByRole("button", { name: "Create referral", exact: true }).click();
      await expect.poll(() => new URL(winner.url()).searchParams.get("referralId")).not.toBeNull();
      const id = new URL(winner.url()).searchParams.get("referralId");
      const winningReferral = (await (await page.request.get(`/api/referrals/${id}`)).json()).referral;
      await follower.getByRole("button", { name: "Create referral", exact: true }).click();
      if (collision) {
        await expect(other.getByText("This draft was saved in another session. Review the conflicting fields before saving.", { exact: true })).toBeVisible();
        expect((await (await page.request.get(`/api/referrals/${id}`)).json()).referral).toMatchObject({ source: "First session", version: 1 });
        if (scenario === "community-collision") await expect(other.getByRole("combobox", { name: "Requested community", exact: true })).toHaveValue("Santa Clarita");
        else await expect(other.getByRole("combobox", { name: "Referral facility / source", exact: true })).toHaveValue("Second session");
        await other.getByRole("button", { name: scenario === "community-collision" ? "Use latest" : "Keep mine", exact: true }).click();
        await expect.poll(async () => (await (await page.request.get(`/api/referrals/${id}`)).json()).referral).toMatchObject(
          scenario === "community-collision" ? { community: "Turlock", source: "First session", version: 1 }
            : { source: "Second session", version: 2 },
        );
        await expect.poll(() => new URL(other.url()).searchParams.get("referralId")).toBe(id);
        await other.reload();
        await expect(other.getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
        await expect(other.getByRole("button", { name: "Edit Referral source", exact: true })).toHaveText(scenario === "community-collision" ? "First session" : "Second session");
      } else {
        await expect.poll(() => new URL(follower.url()).searchParams.get("referralId")).toBe(id);
        const merged = (await (await page.request.get(`/api/referrals/${id}`)).json()).referral;
        expect(merged).toMatchObject({ name, source: "First session", county: "Marin County", version: 2 });
        for (const [field, evidence] of Object.entries(winningReferral.fieldSources ?? {})) {
          if (field !== (scenario === "disjoint-second" ? "referent" : "county")) expect(merged.fieldSources?.[field]).toEqual(evidence);
        }
      }
    } finally { await session.context.close(); }
  });
}

function referralDraft(name: string) {
  const fields = Object.fromEntries([
    "name", "gender", "age", "dob", "ssn", "owner", "referralReceived", "admissionDate", "community", "county", "referent", "responsiblePerson", "currentMedications", "summary", "interview", "phone", "email", "referrerName",
  ].map(key => [key, { value: key === "name" ? name : key === "community" ? "San Pablo" : "" }]));
  return { schema: 1, savedAt: new Date().toISOString(), dirtyKeys: ["name", "community"], fields, conserved: "", tagsInput: "", documents: {} };
}

function syntheticPersonName() { return `Synthetic ${randomUUID().replace(/[0-9-]/g, "")}`; }
