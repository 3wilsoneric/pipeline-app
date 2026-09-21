import { expect, test } from "@playwright/test";
import {
  createOperationalReferral,
  readOperationalReferral,
  recordOperationalAcceptance,
} from "./support/operational-api";

test("Home retains owned acceptance and admission until the handoff email is confirmed", async ({ request }) => {
  let referral = await createOperationalReferral(request, "assessmentCoordinator", {
    owner: "Unassigned", name: "Synthetic Board Acceptance",
  });
  referral = await recordOperationalAcceptance(request, referral);
  const requirements = await request.get(`/api/referrals/${referral.id}/work-items`);
  expect(requirements.status()).toBe(200);
  const { work_items: workItems } = await requirements.json();
  for (const item of workItems) {
    if (["received", "reviewed", "waived", "not_applicable"].includes(item.status)) continue;
    const update = await request.patch(`/api/referrals/${referral.id}/work-items/${item.id}`, {
      data: { if_match: item.version, patch: {
        status: "waived", waiverReason: "Synthetic Home lifecycle test. Contains no PHI.",
      } },
    });
    expect(update.status(), await update.text()).toBe(200);
  }
  const accepted = await request.get("/api/operations/home");
  expect(accepted.status()).toBe(200);
  const { workflow } = await accepted.json();
  expect(workflow.active_items).toEqual(expect.arrayContaining([expect.objectContaining({ referral_id: referral.id })]));
  expect(workflow.board_items).toEqual(expect.arrayContaining([expect.objectContaining({
    referral_id: referral.id, workflow_status: "approved_for_placement", flow_state: "complete", outcome_state: "accepted",
  })]));
  expect(workflow.board_items.filter((item: { referral_id: number }) => item.referral_id === referral.id)).toHaveLength(1);

  referral = await readOperationalReferral(request, referral.id);
  const transition = await request.post(`/api/referrals/${referral.id}/transition`, { data: {
    if_match: referral.version, if_match_section: referral.sectionVersions.workflow,
    target_stage: "Accepted / Admitted", actual_admission_date: "2026-09-21",
  } });
  expect(transition.status(), await transition.text()).toBe(200);
  const admitted = await request.get("/api/operations/home");
  expect(admitted.status()).toBe(200);
  expect((await admitted.json()).workflow.board_items).toEqual(expect.arrayContaining([expect.objectContaining({
    referral_id: referral.id, workflow_status: "admitted", flow_state: "complete",
    board: expect.objectContaining({ stage: "decision", detail: "Email not sent", location: { view: "email" } }),
  })]));
});
