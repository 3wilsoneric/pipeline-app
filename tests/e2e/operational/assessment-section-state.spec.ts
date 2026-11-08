import { randomUUID } from "node:crypto";
import { expect, test, type APIResponse } from "@playwright/test";
import { assessmentToolSections, pickAssessmentToolData } from "../../../lib/assessment/assessment-tool-schema";
import { actorApiContext } from "../support/pipeline-actors";
import { createOperationalAssessment, createOperationalReferral } from "../support/operational-api";

async function body(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

test("all 4,096 recovery section subsets persist through the API with account isolation and CAS", async ({ baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
  test.setTimeout(300_000);
  const a = await actorApiContext("assessmentCoordinator", baseURL!), b = await actorApiContext("assessorB", baseURL!);
  const outsider = await actorApiContext("outsider", baseURL!);
  try {
    const referral = await createOperationalReferral(a), assessment = await createOperationalAssessment(a, referral.id);
    const original = (await body(await a.get(`/api/assessments/${assessment.assessment_id}`))).assessment;
    const data = pickAssessmentToolData(original);
    const draft = { schema: 1, assessmentId: assessment.assessment_id, referralId: referral.id, savedAt: new Date().toISOString(),
      baseVersion: original.version, sectionVersions: original.section_versions, data, baseData: data };
    const url = `/api/me/assessment-drafts/${assessment.assessment_id}`;
    expect(assessmentToolSections).toHaveLength(12);
    let version = 0;
    for (let mask = 0; mask < 2 ** assessmentToolSections.length; mask++) {
      const dirtySections = assessmentToolSections.filter((_, index) => mask & (1 << index));
      const saved = await body(await a.put(url, { data: { if_match: version, draft: { ...draft, dirtySections } } }));
      expect(saved.version).toBe(++version);
      expect(saved.draft.dirtySections, `subset ${mask}`).toEqual(dirtySections);
      expect((await body(await a.get(url))).draft).toEqual(saved.draft);
    }
    const latest = await body(await a.get(url));
    expect(latest.draft.dirtySections).toEqual(assessmentToolSections);
    expect(await body(await b.get(url))).toEqual({ draft: null, version: 0 });
    expect((await outsider.get(url)).status()).toBe(403);
    const command = { if_match: version, draft: { ...draft, dirtySections: assessmentToolSections } };
    const races = await Promise.all([a.put(url, { data: command }), a.put(url, { data: command })]);
    expect(races.map(result => result.status()).sort()).toEqual([200, 409]);
    const current = await body(await a.get(url));
    expect(current.version).toBe(version + 1);
    await body(await a.delete(url, { data: { if_match: version } }), 409);
    for (const dirtySections of [["unknown"], [...assessmentToolSections, "identity"], ["identity", "identity"]]) {
      await body(await a.put(url, { data: { if_match: current.version, draft: { ...draft, dirtySections } } }), 400);
    }
    await body(await a.put(url, { data: { ...command, draft: { ...command.draft, assessmentId: "different" } } }), 400);
    await body(await a.put(url, { data: { ...command, draft: { ...command.draft, data: { resident_name: "X".repeat(270_000) } } } }), 413);
    expect(await body(await a.get(url))).toEqual(current);
    const peer = await body(await b.put(url, { data: { if_match: 0, draft: { ...draft, dirtySections: [], data: { ...data, assessment_notes: "Other account's synthetic draft" } } } }));
    expect(peer.version).toBe(1);
    expect(await body(await a.get(url))).toEqual(current);
    expect((await body(await a.get(`/api/assessments/${assessment.assessment_id}`))).assessment).toEqual(original);
    expect(await body(await a.delete(url, { data: { if_match: current.version } }))).toEqual({ deleted: true });
    expect(await body(await a.get(url))).toEqual({ draft: null, version: 0 });
    expect(await body(await b.get(url))).toEqual(peer);
  } finally { await a.dispose(); await b.dispose(); await outsider.dispose(); }
});

test("all twelve presence sections support renewal, change, release, ownership and real lease expiry", async ({ baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Use isolated operational storage.");
  test.setTimeout(70_000);
  const a = await actorApiContext("assessmentCoordinator", baseURL!), b = await actorApiContext("assessorB", baseURL!);
  try {
    const referral = await createOperationalReferral(a), other = await createOperationalReferral(a);
    const url = `/api/referrals/${referral.id}/presence`;
    const leases = await Promise.all(assessmentToolSections.map(async section => {
      const command = { lease_id: randomUUID(), section: `assessment:${section}` };
      const saved = (await body(await a.post(url, { data: command }))).presence;
      expect(saved).toMatchObject({ ...command, actor_id: "admissions-coordinator", referral_id: referral.id });
      return saved;
    }));
    expect((await body(await a.get(url))).presence).toHaveLength(12);
    for (const lease of leases) {
      const command = { lease_id: lease.lease_id, section: lease.section };
      await body(await b.post(url, { data: command }), 409);
      await body(await a.post(`/api/referrals/${other.id}/presence`, { data: command }), 409);
      expect(await body(await b.delete(url, { data: command }))).toEqual({ released: false });
      const renewed = (await body(await a.post(url, { data: { ...command, section: "assessment:physical_health" } }))).presence;
      expect(renewed.section).toBe("assessment:physical_health");
      expect(Date.parse(renewed.expires_at)).toBeGreaterThan(Date.parse(lease.expires_at));
      expect(await body(await a.delete(url, { data: command }))).toEqual({ released: true });
      expect(await body(await a.delete(url, { data: command }))).toEqual({ released: false });
    }
    await body(await a.post(url, { data: { lease_id: randomUUID(), section: "assessment:unknown" } }), 400);
    expect((await body(await a.get(url))).presence).toEqual([]);
    const lease = (await body(await a.post(url, { data: { lease_id: randomUUID(), section: "assessment:physical_health" } }))).presence;
    expect(Date.parse(lease.expires_at) - Date.parse(lease.heartbeat_at)).toBe(45_000);
    // Use the real lease clock, with no fake timers or backdated database rows.
    await expect.poll(() => Date.now() >= Date.parse(lease.expires_at) + 100, { timeout: 50_000, intervals: [1000] }).toBe(true);
    expect((await body(await a.get(url))).presence).toEqual([]);
    expect(await body(await a.delete(url, { data: { lease_id: lease.lease_id } }))).toEqual({ released: false });
  } finally { await a.dispose(); await b.dispose(); }
});
