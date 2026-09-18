import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createOperationalReferral } from "./support/operational-api";

test("signed answers remain editable and saved; Add note appears only after the packet is sent", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Finalsend ${randomUUID().replaceAll(/[^a-z]/g, "")}`, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing",
  }, { assigneeId: "provisional:allo:annette" });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, {
    data: { client_mutation_id: randomUUID(), data: {} },
  });
  expect(created.status()).toBe(201);
  const { assessment } = await created.json();
  const signed = await page.request.post(`/api/assessments/${assessment.assessment_id}/sign`, {
    data: { if_match: assessment.version, client_mutation_id: randomUUID() },
  });
  expect(signed.status()).toBe(200);
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`;
  await page.goto(url);
  const surface = page.getByRole("dialog", { name: "Assessment interview", exact: true });
  await expect(surface.getByRole("button", { name: "Add note", exact: true })).toHaveCount(0);
  const field = surface.getByRole("textbox", { name: "Current symptoms", exact: false });
  await expect(field).toBeEditable();
  await field.fill("Synthetic correction after signing, before sending");
  await expect.poll(async () => (await read()).current_symptoms).toBeNull();
  await field.blur();
  await expect.poll(async () => (await read()).current_symptoms).toBe("Synthetic correction after signing, before sending");
  await page.reload();
  await surface.getByRole("button", { name: "Edit Current symptoms", exact: true }).click();
  await expect(field).toHaveValue("Synthetic correction after signing, before sending");
  const saved = await read();
  expect(saved.audit_events).toEqual(expect.arrayContaining([expect.objectContaining({
    action: "assessment_updated", changed_fields: expect.arrayContaining(["current_symptoms"]),
  })]));

  // Presentation fixture only: the real local + PostgreSQL delivery/write boundary
  // is exercised by assessment-final-send-fixtures.test.mjs without sending mail.
  await page.route(`**/api/referrals/${referral.id}/assessments*`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.assessments = body.assessments.map((item: { assessment_id: string }) => item.assessment_id === saved.assessment_id
      ? { ...saved, meet_client_sent_at: "2026-09-17T20:00:00.000Z", meet_client_sent_version: saved.version }
      : item);
    await route.fulfill({ response, json: body });
  });
  await page.goto(url);
  await expect(surface.getByRole("button", { name: "Edit Current symptoms", exact: true })).toHaveCount(0);
  await expect(surface.getByRole("textbox", { name: "Secondary diagnosis", exact: true })).not.toBeEditable();
  await surface.locator('summary[aria-label="Assessment details"]').click();
  await surface.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(surface.getByRole("textbox", { name: "Note", exact: true })).toBeEditable();
  await expect(surface.getByRole("button", { name: "Addendum", exact: true })).toHaveCount(0);
});
