import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createOperationalReferral, recordOperationalAcceptance } from "./support/operational-api";

for (const width of [1440, 390]) test(`accepted placement can be cancelled without rewriting the decision at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  const created = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Synthetic cancelled placement ${randomUUID()}`,
    owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const accepted = await recordOperationalAcceptance(page.request, created);
  const planned = await page.request.patch(`/api/referrals/${accepted.id}`, { data: {
    if_match: accepted.version,
    if_match_sections: { intake: accepted.sectionVersions.intake },
    client_mutation_id: randomUUID(),
    patch: { plannedAdmissionDate: "2026-10-20" },
  } });
  expect(planned.status(), await planned.text()).toBe(200);
  const original = (await planned.json()).referral;

  const forged = await page.request.patch(`/api/referrals/${accepted.id}`, { data: {
    if_match: original.version,
    client_mutation_id: randomUUID(),
    patch: { placementCancellation: { reason: "Forged" } },
  } });
  expect(forged.status()).toBe(400);
  const empty = await page.request.put(`/api/referrals/${accepted.id}/placement-cancellation`, { data: {
    if_match: original.version, if_match_section: original.sectionVersions.workflow,
    client_mutation_id: randomUUID(), reason: "   ",
  } });
  expect(empty.status()).toBe(400);

  const ownerSession = await page.request.post("/api/auth/assessor-session", { data: {
    target_principal_id: "provisional:allo:annette",
    reason: "Synthetic placement cancellation test",
  } });
  expect(ownerSession.status(), await ownerSession.text()).toBe(200);

  await page.goto(`/?view=referrals&screen=packet&referralId=${accepted.id}&workspaceView=email`);
  await expect(page.getByRole("region", { name: "Placement follow-through" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Placement did not happen" })).toHaveCount(0);
  await page.getByRole("button", { name: "More actions" }).click();
  const actions = page.getByRole("dialog", { name: "Placement actions" });
  await expect(actions).toBeVisible();
  await expect(actions).not.toContainText(/ElderMark|manual entry|Mark pending|Record issue/i);
  await page.screenshot({ path: info.outputPath(`placement-actions-${width}.png`), animations: "disabled" });
  const admission = actions.getByRole("region", { name: "Admission follow-through" });
  const cancellationButton = admission.getByRole("button", { name: "Placement did not happen" });
  await expect(cancellationButton).toBeVisible();
  await expect(admission.getByRole("textbox", { name: "Why was placement cancelled?" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm admission" })).toHaveCount(0);
  await cancellationButton.click();
  await admission.getByRole("textbox", { name: "Why was placement cancelled?" }).fill("County placed the client elsewhere.");
  await admission.getByRole("button", { name: "Record placement cancellation" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Cancel this placement?" });
  await expect(confirmation).toContainText("will not email the community");
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(admission.getByText("Placement cancelled · County placed the client elsewhere.")).toHaveCount(0);
  await admission.getByRole("button", { name: "Record placement cancellation" }).click();
  await confirmation.getByRole("button", { name: "Record cancellation" }).click();
  await expect(admission.getByRole("status")).toContainText("Placement cancelled · County placed the client elsewhere.");
  await expect(admission.getByRole("button", { name: "Edit cancellation reason" })).toBeVisible();
  await expect(admission.getByLabel("Planned admission date")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`placement-cancelled-${width}.png`) });

  const workflow = (await (await page.request.get(`/api/referrals/${accepted.id}/workflow`)).json());
  expect(workflow.decision.outcome).toBe("accepted");
  expect(workflow.decision.decisionId).toBe(original.admissionDecision.decisionId);
  expect(workflow.referral.stage).toBe("Community Review");
  expect(workflow.referral.workflowStatus).toBe("closed");
  expect(workflow.referral.plannedAdmissionDate).toBe("2026-10-20");
  expect(workflow.referral.actualAdmissionDate).toBeFalsy();
  expect(workflow.referral.placementCancellation).toMatchObject({ reason: "County placed the client elsewhere." });

  const activeWork = (await (await page.request.get("/api/referrals?queue=my_work&projection=summary")).json()).referrals;
  expect(activeWork.some((item: { id: number }) => item.id === accepted.id)).toBe(false);

  const summary = (await (await page.request.get(`/api/referrals/${accepted.id}/admission-summary`)).json());
  expect(summary.email.can_send).toBe(false);
  expect(summary.email.base_blockers).toContain("Placement was cancelled. The earlier handoff remains available for review.");
  const transition = await page.request.post(`/api/referrals/${accepted.id}/transition`, { data: {
    if_match: workflow.referral.version, if_match_section: workflow.referral.sectionVersions.workflow,
    target_stage: "Accepted / Admitted", actual_admission_date: "2026-10-16", client_mutation_id: randomUUID(),
  } });
  expect(transition.status()).toBe(403);
  const activity = (await (await page.request.get(`/api/referrals/${accepted.id}/activity`)).json()).events;
  expect(activity).toEqual(expect.arrayContaining([expect.objectContaining({ action: "placement_cancelled", reason: "County placed the client elsewhere." })]));

  const changed = await page.request.put(`/api/referrals/${accepted.id}/placement-cancellation`, { data: {
    if_match: workflow.referral.version, if_match_section: workflow.referral.sectionVersions.workflow,
    client_mutation_id: randomUUID(), reason: "County confirmed placement at another community.",
  } });
  expect(changed.status(), await changed.text()).toBe(200);
  const updated = (await changed.json()).referral;
  expect(updated.placementCancellation.cancelledAt).toBe(workflow.referral.placementCancellation.cancelledAt);
  expect(updated.placementCancellation.reason).toBe("County confirmed placement at another community.");
  expect(updated.admissionDecision).toEqual(original.admissionDecision);
  const stale = await page.request.put(`/api/referrals/${accepted.id}/placement-cancellation`, { data: {
    if_match: workflow.referral.version, if_match_section: workflow.referral.sectionVersions.workflow,
    client_mutation_id: randomUUID(), reason: "Stale update",
  } });
  expect(stale.status()).toBe(409);
});
