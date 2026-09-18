import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";

for (const signed of [false, true]) {
  test(`decision saves without review; retries and conflicts remain safe (${signed ? "signed" : "unsigned"})`, async ({ request }) => {
    const referral = await createOperationalReferral(request, "assessmentCoordinator", {
      name: `Synthetic decision ${randomUUID().replace(/[^a-z]/g, "")}`,
      owner: "Unassigned", documentStatus: "Missing", documentName: "",
    });
    const assessment = await createOperationalAssessment(request, referral.id);
    if (signed) {
      const response = await request.post(`/api/assessments/${assessment.assessment_id}/sign`, { data: {
        if_match: assessment.version, client_mutation_id: randomUUID(),
      } });
      expect(response.status(), await response.text()).toBe(200);
    }
    const snapshot = async () => (await (await request.get(`/api/referrals/${referral.id}/workflow`)).json());
    let workflow = await snapshot();
    const body = {
      if_match: workflow.referral.version, if_match_section: workflow.referral.sectionVersions.decision,
      assessment_id: assessment.assessment_id, outcome: "needs_more_information",
      reason_note: "Synthetic follow-up remains open.", client_mutation_id: randomUUID(),
    };
    const first = await request.put(`/api/referrals/${referral.id}/recommendation`, { data: body });
    expect(first.status(), await first.text()).toBe(200);
    const firstBody = await first.json();
    const replay = await request.put(`/api/referrals/${referral.id}/recommendation`, { data: body });
    expect(replay.status()).toBe(200);
    expect((await replay.json()).recommendation).toEqual(firstBody.recommendation);
    const stale = await request.put(`/api/referrals/${referral.id}/recommendation`, { data: { ...body, client_mutation_id: randomUUID() } });
    expect(stale.status()).toBe(409);
    workflow = await snapshot();
    expect(workflow.review).toBeNull();
    expect(workflow.reviews).toEqual([]);
    expect(workflow.decision).toBeNull();
    const updated = await request.put(`/api/referrals/${referral.id}/recommendation`, { data: {
      ...body, if_match: workflow.referral.version, if_match_section: workflow.referral.sectionVersions.decision,
      reason_note: "Synthetic follow-up clarified.", client_mutation_id: randomUUID(),
    } });
    expect(updated.status(), await updated.text()).toBe(200);
    workflow = await snapshot();
    const decision = {
      if_match: workflow.referral.version, if_match_section: workflow.referral.sectionVersions.decision,
      outcome: "accepted", reason_note: "Synthetic decision, no real client.", client_mutation_id: randomUUID(),
    };
    const accepted = await request.put(`/api/referrals/${referral.id}/decision`, { data: decision });
    expect(accepted.status(), await accepted.text()).toBe(200);
    const decisionEvents = async () => {
      const activity = await (await request.get(`/api/referrals/${referral.id}/activity`)).json();
      return activity.events.filter((event: { action: string }) => event.action === "admission_decision_recorded")
        .map((event: { event_id: string }) => event.event_id).sort();
    };
    const recordedEvents = await decisionEvents();
    expect(recordedEvents.length).toBeGreaterThan(0);
    const decisionReplay = await request.put(`/api/referrals/${referral.id}/decision`, { data: decision });
    expect(decisionReplay.status()).toBe(200);
    expect((await decisionReplay.json()).decision).toEqual((await accepted.json()).decision);
    workflow = await snapshot();
    expect(workflow.decision.outcome).toBe("accepted");
    expect(workflow.review).toBeNull();
    expect(workflow.reviews).toEqual([]);
    const replacement = await request.put(`/api/referrals/${referral.id}/decision`, { data: {
      ...decision, if_match: workflow.referral.version, if_match_section: workflow.referral.sectionVersions.decision,
      outcome: "declined", client_mutation_id: randomUUID(),
    } });
    expect(replacement.status()).toBe(422);
    const saved = (await (await request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
    expect(Boolean(saved.signed_at)).toBe(signed);
    expect(saved.meet_client_sent_at).toBeFalsy();
    const activity = await (await request.get(`/api/referrals/${referral.id}/activity`)).json();
    const actions = activity.events.map((event: { action: string }) => event.action);
    expect(actions).not.toContain("assessment_review_submitted");
    expect(actions).not.toContain("assessment_recommendation_submitted");
    expect(await decisionEvents()).toEqual(recordedEvents);
  });
}
