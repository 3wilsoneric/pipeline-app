import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

test("a checklist save does not freeze or erase a draft decision", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Example Nonblocking Decision ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  let releaseSave = () => {};
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  let heldSave = false;
  await page.route(`**/api/referrals/${referral.id}/work-items/*`, async (route) => {
    if (route.request().method() === "PATCH" && !heldSave) {
      heldSave = true;
      await saveGate;
    }
    await route.continue();
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
    const panel = page.getByRole("region", { name: "Admission decision", exact: true });
    await panel.getByText("Admission paperwork & EHR handoff").click();
    const requirement = panel.locator('select[aria-label$=" status"]').first();
    await expect(requirement).toBeVisible();
    const current = await requirement.inputValue();
    await requirement.selectOption(current === "received" ? "needed" : "received");
    await expect.poll(() => heldSave).toBe(true);
    const accept = panel.getByRole("radio", { name: "Accept", exact: true });
    await expect(accept).toBeEnabled();
    await accept.check();
    const reason = panel.getByLabel("Reason (optional)", { exact: true });
    await reason.fill("Synthetic decision draft while paperwork saves.");
    await expect(panel.getByRole("button", { name: "Record decision", exact: true })).toBeDisabled();
    releaseSave();
    await expect(requirement).not.toBeDisabled();
    await expect(accept).toBeChecked();
    await expect(panel.locator("textarea").first()).toHaveValue("Synthetic decision draft while paperwork saves.");
    await expect(panel.getByRole("button", { name: "Record decision", exact: true })).toBeEnabled();
  } finally {
    releaseSave();
  }
});
