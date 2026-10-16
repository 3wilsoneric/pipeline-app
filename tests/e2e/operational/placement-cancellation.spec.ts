import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createOperationalReferral, recordOperationalAcceptance } from "../support/operational-api";
import { actorApiContext, requireOperationalBaseURL } from "../support/pipeline-actors";

test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Uses isolated operational stores.");

test("placement cancellation persists and leaves active work on the configured store", async ({ baseURL }) => {
  const api = await actorApiContext("assessorA", requireOperationalBaseURL(baseURL));
  try {
    const created = await createOperationalReferral(api, "assessorA", { name: `Synthetic cancellation ${randomUUID()}` });
    const accepted = await recordOperationalAcceptance(api, created);
    const original = (await (await api.get(`/api/referrals/${accepted.id}`)).json()).referral;
    const response = await api.put(`/api/referrals/${accepted.id}/placement-cancellation`, { data: {
      if_match: accepted.version,
      if_match_section: accepted.sectionVersions.workflow,
      client_mutation_id: randomUUID(),
      reason: "County placed the client elsewhere.",
    } });
    expect(response.status(), await response.text()).toBe(200);
    const saved = (await response.json()).referral;
    expect(saved.admissionDecision).toEqual(original.admissionDecision);
    expect(saved.workflowStatus).toBe("closed");
    expect(saved.placementCancellation.reason).toBe("County placed the client elsewhere.");

    const active = (await (await api.get("/api/referrals?queue=my_work&projection=summary")).json()).referrals;
    expect(active.some((item: { id: number }) => item.id === saved.id)).toBe(false);
    const all = (await (await api.get(`/api/referrals?q=${encodeURIComponent(saved.name)}&projection=summary`)).json()).referrals;
    expect(all.some((item: { id: number }) => item.id === saved.id)).toBe(true);

    const transition = await api.post(`/api/referrals/${saved.id}/transition`, { data: {
      if_match: saved.version,
      if_match_section: saved.sectionVersions.workflow,
      target_stage: "Accepted / Admitted",
      actual_admission_date: "2026-10-16",
      client_mutation_id: randomUUID(),
    } });
    expect(transition.status()).toBe(422);
    const genericStageChange = await api.patch(`/api/referrals/${saved.id}`, { data: {
      if_match: saved.version,
      if_match_sections: { workflow: saved.sectionVersions.workflow },
      client_mutation_id: randomUUID(),
      patch: { stage: "Assessment" },
    } });
    expect(genericStageChange.status()).toBe(422);
    expect((await genericStageChange.json()).blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: "placement_cancelled" })]));
    const summary = (await (await api.get(`/api/referrals/${saved.id}/admission-summary`)).json());
    expect(summary.email.can_send).toBe(false);
  } finally {
    await api.dispose();
  }
});

test("only accountable owners and Sandeep can cancel a placement", async ({ baseURL }) => {
  const url = requireOperationalBaseURL(baseURL);
  const owner = await actorApiContext("assessorA", url);
  const other = await actorApiContext("assessorB", url);
  const sandeep = await actorApiContext("sandeep", url);
  try {
    const created = await createOperationalReferral(owner, "assessorA", { name: `Synthetic team cancellation ${randomUUID()}` });
    const accepted = await recordOperationalAcceptance(owner, created);
    const path = `/api/referrals/${accepted.id}`;
    const body = {
      if_match: accepted.version,
      if_match_section: accepted.sectionVersions.workflow,
      client_mutation_id: randomUUID(),
      reason: "Placement moved to another community.",
    };

    expect((await (await owner.get(`${path}/workflow`)).json()).capabilities.can_cancel_placement).toBe(true);
    expect((await (await other.get(`${path}/workflow`)).json()).capabilities.can_cancel_placement).toBe(false);
    expect((await (await sandeep.get(`${path}/workflow`)).json()).capabilities.can_cancel_placement).toBe(true);
    const unauthorized = await other.put(`${path}/placement-cancellation`, { data: body });
    expect(unauthorized.status(), await unauthorized.text()).toBe(403);
    const saved = await sandeep.put(`${path}/placement-cancellation`, { data: body });
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await saved.json()).referral.placementCancellation).toMatchObject({
      reason: body.reason,
      cancelledBy: "b72c34f0-0ee8-4ab4-8359-81c8f7b0d3b2",
    });
  } finally {
    await Promise.all([owner.dispose(), other.dispose(), sandeep.dispose()]);
  }
});
