import { chromium, expect, test, webkit } from "@playwright/test";
import {
  activeOperationalAssessor, completeOperationalAssessment, createOperationalAssessment, createOperationalReferral,
  recordOperationalAcceptance, signOperationalAssessment,
} from "./support/operational-api";
import { confirmRecipients, openRecipients } from "./support/handoff-review";

test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Recipient drafts need the isolated workspace-state store.");

for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]] as const) {
  test(`${name} phone handoff keeps editing and finishing above the keyboard`, async ({ baseURL }, info) => {
    const browser = await engine.launch();
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      const owner = await activeOperationalAssessor(page.request);
      const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Alexandra Montgomery-Richardson", owner: owner.display_name, tags: [] }, { assigneeId: owner.principal_id });
      const assessment = await createOperationalAssessment(page.request, referral.id);
      await signOperationalAssessment(page.request, await completeOperationalAssessment(page.request, assessment));
      const current = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral;
      await recordOperationalAcceptance(page.request, current);
      let sends = 0;
      page.on("request", request => { if (request.url().includes("/meet-client-email")) sends++; });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
      await openRecipients(page);
      await page.getByRole("combobox", { name: /^To/ }).fill("Synthetic reviewer <reviewer@example.invalid>");
      await page.getByRole("combobox", { name: /^To/ }).press("Enter");
      const previewDialog = await confirmRecipients(page);
      await previewDialog.getByRole("button", { name: "Edit message", exact: true }).tap();
      const dialog = page.getByRole("dialog", { name: "Edit Meet the Client", exact: true });
      const subject = dialog.getByRole("textbox", { name: "Subject", exact: true });
      const message = dialog.getByRole("textbox", { name: "Edit Meet the client", exact: true });

      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await subject.fill(`Synthetic mobile handoff ${width}`);
        expect((await subject.boundingBox())!.height).toBeGreaterThanOrEqual(48);
        // iOS keyboards shrink/pan the visual viewport independently of 100dvh.
        await page.evaluate(() => {
          Object.defineProperties(window.visualViewport!, {
            height: { configurable: true, value: 430 }, offsetTop: { configurable: true, value: 12 },
          });
          window.visualViewport!.dispatchEvent(new Event("resize"));
        });
        await expect(dialog).toHaveCSS("height", "430px");
        const frame = (await dialog.boundingBox())!;
        expect(frame.y).toBe(12);
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.x + frame.width).toBeLessThanOrEqual(width);
        for (const action of ["Close email editor", "Done"]) {
          const button = dialog.getByRole("button", { name: action, exact: true });
          const box = (await button.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.y).toBeGreaterThanOrEqual(12);
          expect(box.y + box.height).toBeLessThanOrEqual(442);
        }
        await message.fill("Synthetic handoff note.\nSecond paragraph retained while the keyboard opens and closes.");
        await message.blur();
        await dialog.getByRole("button", { name: "Preview email", exact: true }).tap();
        await dialog.getByRole("button", { name: "Back to editing", exact: true }).tap();
        await expect(subject).toHaveValue(`Synthetic mobile handoff ${width}`);
        await expect(message).toHaveValue(/Second paragraph retained/);
        await expect(message).toBeFocused();
        const writing = (await message.boundingBox())!;
        const finish = (await dialog.getByRole("button", { name: "Done", exact: true }).boundingBox())!;
        expect(writing.y).toBeLessThan(finish.y);
        expect(writing.y + writing.height).toBeGreaterThan(frame.y + 160);
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`handoff-keyboard-${name}-${width}.png`) });
        await page.evaluate(() => {
          Reflect.deleteProperty(window.visualViewport!, "height");
          Reflect.deleteProperty(window.visualViewport!, "offsetTop");
          window.visualViewport!.dispatchEvent(new Event("resize"));
        });
        await expect(dialog).toHaveCSS("height", "844px");
      }
      await dialog.getByRole("button", { name: "Close email editor", exact: true }).tap();
      await expect(dialog).not.toBeVisible();
      expect(sends).toBe(0);
    } finally { await context.close(); await browser.close(); }
  });
}
