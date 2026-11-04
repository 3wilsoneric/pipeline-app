import { randomUUID } from "node:crypto";
import { chromium, expect, test, webkit } from "@playwright/test";
import { actorApiContext, operationalActorHeaders, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";
import { createOperationalAssessment, createOperationalReferral, readOperationalReferral, recordOperationalAcceptance } from "../support/operational-api";

test.describe("mobile workspace scope", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Isolated operational stores required.");

  for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]] as const) {
    test(`${engineName}: personal defaults with supervisor team toggles`, async ({ baseURL }, info) => {
      test.setTimeout(120_000);
      const url = requireOperationalBaseURL(baseURL);
      const owner = await actorApiContext("assessorA", url);
      const otherOwner = await actorApiContext("assessorB", url);
      const browser = await engine.launch();
      try {
        const stamp = randomUUID().replace(/[^a-f]/g, "").slice(0, 8).replace(/^./, (letter) => letter.toUpperCase());
        const names = { mine: `Mobile Own ${stamp}`, other: `Mobile Other ${stamp}`, handoff: `Mobile Handoff ${stamp}` };
        const mine = await createOperationalReferral(owner, "assessorA", { name: names.mine, documentName: "" });
        const other = await createOperationalReferral(otherOwner, "assessorB", { name: names.other, documentName: "" });
        const handoff = await createOperationalReferral(otherOwner, "assessorB", { name: names.handoff, documentName: "" });
        expect(mine.name).toBe(names.mine);
        expect(other.name).toBe(names.other);
        expect(handoff.name).toBe(names.handoff);
        await createOperationalAssessment(otherOwner, handoff.id);
        await recordOperationalAcceptance(otherOwner, await readOperationalReferral(otherOwner, handoff.id));
        // A team list may already contain enough newer records to require scrolling.
        for (let index = 0; index < 8; index++) {
          await createOperationalReferral(otherOwner, "assessorB", { name: `Mobile Queue ${String.fromCharCode(65 + index)} ${stamp}`, documentName: "" });
        }

        for (const actor of ["admin", "assessmentCoordinator", "assessorA"] as const) {
          const team = actor !== "assessorA";
          const context = await browser.newContext({ baseURL: url, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, extraHTTPHeaders: operationalActorHeaders(actor, url) });
          try {
            const page = await context.newPage();
            const me = await (await context.request.get("/api/auth/me")).json();
            expect(me.user.roles).toEqual(pipelineActors[actor].expectedRoles);
            const personal = await (await context.request.get("/api/referrals/directory?scope=mine")).json();
            expect(personal.referrals.some((row: { id: number }) => row.id === mine.id)).toBe(!team);
            expect(personal.referrals.some((row: { id: number }) => row.id === other.id)).toBe(false);

            const all = await (await context.request.get(`/api/referrals/directory?scope=team&workspace=all&q=${encodeURIComponent(names.other)}`)).json();
            expect(all.referrals.map((row: { id: number }) => row.id)).toContain(other.id);
            await page.goto("/?view=referrals");
            const search = page.getByRole("searchbox", { name: "Search my workspaces" });
            await expect(search).toBeVisible();
            await search.fill(names.other);
            await expect(page.getByText("No workspaces match this search", { exact: true })).toBeVisible();
            await expect(page.getByRole("button", { name: `Open ${names.other} referral workspace`, exact: true })).toHaveCount(0);
            const scope = page.getByRole("group", { name: "Workspace scope" });
            if (team) {
              await expect(scope.getByRole("button", { name: "Mine", exact: true })).toHaveAttribute("aria-pressed", "true");
              const allButton = scope.getByRole("button", { name: "All", exact: true });
              expect((await allButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
              await allButton.focus();
              await allButton.press("Enter");
              await expect(allButton).toBeFocused();
              await expect(allButton).toHaveAttribute("aria-pressed", "true");
              await expect(page.getByRole("searchbox", { name: "Search all workspaces" })).toHaveValue(names.other);
              await expect(page.getByRole("button", { name: `Open ${names.other} referral workspace`, exact: true })).toBeVisible();
              expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
              await page.screenshot({ path: info.outputPath(`${engineName}-${actor}-directory.png`), animations: "disabled" });
              await scope.getByRole("button", { name: "Mine", exact: true }).tap();
              await expect(search).toHaveValue(names.other);
              await expect(page.getByText("No workspaces match this search", { exact: true })).toBeVisible();
            } else {
              await expect(scope).toHaveCount(0);
              await search.fill(names.mine);
              await expect(page.getByRole("button", { name: `Open ${names.mine} referral workspace`, exact: true })).toBeVisible();
            }
            await page.goto("/");
            await page.getByRole("button", { name: "Open in progress folder", exact: true }).tap();
            const folder = page.getByRole("dialog", { name: "In progress folder", exact: true });
            if (team) {
              await expect(folder.getByRole("button", { name: "Mine", exact: true })).toHaveAttribute("aria-pressed", "true");
              for (const id of [mine.id, other.id]) await expect(folder.locator(`[data-client-file="${id}"]`)).toHaveCount(0);
              await folder.getByRole("button", { name: "All", exact: true }).tap();
              await expect(folder.locator(`[data-client-file="${other.id}"]`)).toBeVisible();
            } else {
              await expect(folder.getByRole("group", { name: "Folder scope" })).toHaveCount(0);
              await expect(folder.locator(`[data-client-file="${other.id}"]`)).toHaveCount(0);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await expect(folder.locator("[data-expanded-folder]")).toHaveCSS("opacity", "1");
            await folder.locator(`[data-client-file="${mine.id}"]`).scrollIntoViewIfNeeded();
            await expect(folder.locator(`[data-client-file="${mine.id}"]`)).toBeInViewport();
            await page.screenshot({ path: info.outputPath(`${engineName}-${actor}-folder.png`), animations: "disabled" });
            await folder.getByRole("button", { name: "Close in progress folder", exact: true }).tap();
            await expect(folder).toHaveCount(0);
            await page.getByRole("button", { name: "Open clients in handoff folder", exact: true }).tap();
            const handoffFolder = page.getByRole("dialog", { name: "Clients in handoff folder", exact: true });
            if (team) {
              await expect(handoffFolder.getByRole("button", { name: "Mine", exact: true })).toHaveAttribute("aria-pressed", "true");
              await expect(handoffFolder.locator(`[data-client-file="${handoff.id}"]`)).toHaveCount(0);
              await handoffFolder.getByRole("button", { name: "All", exact: true }).tap();
              await expect(handoffFolder.locator(`[data-client-file="${handoff.id}"]`)).toBeVisible();
              await handoffFolder.getByRole("button", { name: `Open ${names.handoff}`, exact: true }).tap();
              await expect(page).toHaveURL(new RegExp(`referralId=${handoff.id}(?:&|$)`));
              await expect(page.getByRole("heading", { name: names.handoff, exact: true }).first()).toBeVisible();
              await page.goto("/");
              await expect(page.getByRole("region", { name: "Recent workspaces" }).locator(`[data-client-file="${handoff.id}"]`)).toBeVisible();
            } else await expect(handoffFolder.locator(`[data-client-file="${handoff.id}"]`)).toHaveCount(0);
          } finally { await context.close(); }
        }
      } finally {
        await browser.close();
        await owner.dispose();
        await otherOwner.dispose();
      }
    });
  }
});
