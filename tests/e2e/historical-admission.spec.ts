import { expect, test } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { createOperationalReferral } from "./support/operational-api";
import { unifiedProfileFixture } from "./support/pipeline-clinical-fixtures";

test.use({ serviceWorkers: "block" });

for (const width of [1440, 390]) {
  test(`prior admission can be confirmed without intake, survives retry and reopen at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const created = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Prior Admission ${width}`, owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
    let referral = { ...(await (await page.request.get(`/api/referrals/${created.id}`)).json()).referral, workspaceOrigin: "allo", workspaceStatus: "historical", admissionDate: "", community: "San Pablo" };
    await page.route(`**/api/referrals/${created.id}`, route => route.fulfill({ json: { referral } }));
    await page.route(`**/api/referrals/${created.id}/canvas`, route => route.fulfill({ json: { referral } }));
    await page.route("**/api/profiles/**", route => route.fulfill({ json: unifiedProfileFixture }));
    const commands: Record<string, unknown>[] = [];
    await page.route(`**/api/referrals/${created.id}/historical-admission`, async route => {
      if (route.request().method() === "GET") return route.fulfill({ json: { suggestion: null, available: false } });
      const command = route.request().postDataJSON(); commands.push(command);
      if (commands.length === 1) return route.fulfill({ status: 503, json: { error: "Synthetic save unavailable. Your entry is retained." } });
      referral = { ...referral, admissionDate: command.admissionDate, community: command.community, version: referral.version + 1 };
      await route.fulfill({ json: { ok: true, referral } });
    });
    const unexpectedWrites: string[] = [];
    page.on("request", request => {
      if (request.method() !== "GET" && /\/api\/(assessments|referrals$|meet-client|resident-links)/.test(new URL(request.url()).pathname)) unexpectedWrites.push(request.url());
    });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const url = `/?view=referrals&screen=packet&referralId=${created.id}&workspaceStage=chart`;
    await page.goto(url);
    const panel = page.getByRole("region", { name: "Prior admission", exact: true });
    await panel.getByRole("button", { name: "Record prior admission", exact: true }).click();
    await expect(panel.getByText("No verified roster match.", { exact: false })).toBeVisible();
    await panel.getByLabel("Admission date", { exact: true }).fill("2025-02-03");
    await panel.getByLabel("Admission community", { exact: true }).selectOption("Turlock");
    await expect(panel.getByRole("button", { name: "Confirm prior admission", exact: true })).toBeDisabled();
    await panel.getByRole("checkbox").check();
    await page.screenshot({ path: info.outputPath(`prior-admission-${width}.png`), fullPage: false });
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => (await (window as unknown as { axe: { run: (selector: string) => Promise<AxeResults> } }).axe.run('[aria-label="Prior admission"]')).violations);
    expect(violations).toEqual([]);
    await panel.getByRole("button", { name: "Confirm prior admission", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Synthetic save unavailable");
    await expect(panel.getByLabel("Admission date", { exact: true })).toHaveValue("2025-02-03");
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await panel.getByRole("button", { name: "Record prior admission", exact: true }).click();
    await expect(panel.getByLabel("Admission date", { exact: true })).toHaveValue("2025-02-03");
    await expect(panel.getByLabel("Admission community", { exact: true })).toHaveValue("Turlock");
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "Confirm prior admission", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("Prior admission recorded");
    expect(commands).toHaveLength(2); expect(commands[1]).toEqual(commands[0]);
    expect(referral.workspaceStatus).toBe("historical");
    await page.reload();
    await expect(panel).toContainText("Admitted"); await expect(panel).toContainText("Turlock");
    await panel.getByRole("button", { name: "Correct prior admission" }).click();
    await expect(panel.getByLabel("Admission date", { exact: true })).toHaveValue("2025-02-03");
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    expect(commands).toHaveLength(2); expect(unexpectedWrites).toEqual([]); expect(errors).toEqual([]);
  });
}
