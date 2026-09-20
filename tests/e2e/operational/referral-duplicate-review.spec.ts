import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  actorApiContext,
  operationalMutationId,
  requireOperationalBaseURL,
  syntheticReferralInput,
} from "../support/pipeline-actors";

test.describe("referral suspected-duplicate review", () => {
  test.skip(
    process.env.PIPELINE_OPERATIONAL_E2E !== "true",
    "Run with the operational Playwright configuration and an isolated store.",
  );

  test("warns on matching names without merging identities and deduplicates retries", async ({ baseURL }) => {
    const coordinator = await actorApiContext("assessmentCoordinator", requireOperationalBaseURL(baseURL));
    const name = `Review ${uniqueAlphabeticToken()}`;
    const referral = syntheticReferralInput("assessmentCoordinator", { name, county: "Contra Costa County", community: "San Pablo" });
    const warning = "A matching client name and county exists. This referral was saved separately; no client records were merged.";
    try {
      const firstResponse = await coordinator.post("/api/referrals", { data: { client_mutation_id: operationalMutationId("first"), referral } });
      expect(firstResponse.status()).toBe(201);
      const first = (await firstResponse.json()).referral;
      const mutation = operationalMutationId("second");
      const secondResponse = await coordinator.post("/api/referrals", { data: { client_mutation_id: mutation, referral } });
      expect(secondResponse.status()).toBe(201);
      const second = await secondResponse.json();
      expect(second.warnings).toContain(warning);
      expect(second.idempotent_replay).toBe(false);
      expect(second.referral.id).not.toBe(first.id);
      expect(second.referral.clientId).not.toBe(first.clientId);
      const retry = await coordinator.post("/api/referrals", { data: { client_mutation_id: mutation, referral } });
      expect(retry.status()).toBe(201);
      expect(await retry.json()).toMatchObject({ idempotent_replay: true, referral: { id: second.referral.id, clientId: second.referral.clientId } });
      const activityResponse = await coordinator.get(`/api/referrals/${second.referral.id}/activity`);
      expect(activityResponse.status()).toBe(200);
      const activity = await activityResponse.json();
      const creates = activity.events.filter((event: { action: string }) => event.action === "referral_created");
      expect(creates).toHaveLength(1);
      expect(creates[0].reason).toBe(warning);
      const invalid = await coordinator.post("/api/referrals", { data: {
        client_mutation_id: operationalMutationId("invalid"), referral, duplicate_confirmation: { referral_ids: [first.id, first.id] },
      } });
      expect(invalid.status()).toBe(400);
      const list = await coordinator.get(`/api/referrals?q=${encodeURIComponent(name)}&limit=10`);
      expect(list.status()).toBe(200);
      expect((await list.json()).total).toBe(2);
      const raceReferral = { ...referral, name: `Collision ${uniqueAlphabeticToken()}` };
      const raceMutation = operationalMutationId("race-retry");
      const repeated = await Promise.all([0, 1].map(() => coordinator.post("/api/referrals", { data: { client_mutation_id: raceMutation, referral: raceReferral } })));
      expect(repeated.map(response => response.status())).toEqual([201, 201]);
      const replayed = await Promise.all(repeated.map(response => response.json()));
      expect(replayed[0].referral.id).toBe(replayed[1].referral.id);
      expect(replayed.map(body => body.idempotent_replay).sort()).toEqual([false, true]);
      const distinct = await Promise.all([0, 1].map(() => coordinator.post("/api/referrals", { data: { client_mutation_id: operationalMutationId("race-distinct"), referral: raceReferral } })));
      expect(distinct.map(response => response.status())).toEqual([201, 201]);
      const people = await Promise.all(distinct.map(response => response.json()));
      expect(people[0].referral.clientId).not.toBe(people[1].referral.clientId);
      expect(people.every(body => body.warnings.includes(warning))).toBe(true);
      const raceList = await coordinator.get(`/api/referrals?q=${encodeURIComponent(raceReferral.name)}&limit=10`);
      expect(raceList.status()).toBe(200);
      expect((await raceList.json()).total).toBe(3);
    } finally { await coordinator.dispose(); }
  });

  test("shares duplicate warnings with staff but does not disclose matches to outsiders", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const assessorA = await actorApiContext("assessorA", url);
    const assessorB = await actorApiContext("assessorB", url);
    const outsider = await actorApiContext("outsider", url);
    const name = `Private ${uniqueAlphabeticToken()}`;
    const referral = syntheticReferralInput("assessorA", { name, county: "Alameda County", community: "San Pablo" });
    try {
      const firstResponse = await assessorA.post("/api/referrals", { data: { client_mutation_id: operationalMutationId("first"), referral } });
      expect(firstResponse.status()).toBe(201);
      const first = (await firstResponse.json()).referral;
      const secondResponse = await assessorB.post("/api/referrals", { data: { client_mutation_id: operationalMutationId("second"), referral } });
      expect(secondResponse.status()).toBe(201);
      const second = await secondResponse.json();
      expect(second.warnings).toEqual([expect.stringContaining("no client records were merged")]);
      expect(second.referral.clientId).not.toBe(first.clientId);
      expect((await assessorB.get(`/api/referrals/${first.id}`)).status()).toBe(200);
      const denied = await outsider.post("/api/referrals", { data: {
        client_mutation_id: operationalMutationId("guessed"), referral, duplicate_confirmation: { referral_ids: [first.id] },
      } });
      expect(denied.status()).toBe(403);
      const body = await denied.json();
      expect(body).not.toHaveProperty("candidates");
      expect(body).not.toHaveProperty("confirmation_referral_ids");
      expect(JSON.stringify(body)).not.toContain(name);
      expect((await outsider.get(`/api/referrals?q=${encodeURIComponent(name)}`)).status()).toBe(403);
      const list = await assessorA.get(`/api/referrals?q=${encodeURIComponent(name)}&limit=10`);
      expect(list.status()).toBe(200);
      expect((await list.json()).total).toBe(2);
    } finally { await Promise.all([assessorA.dispose(), assessorB.dispose(), outsider.dispose()]); }
  });
});

function uniqueAlphabeticToken() {
  const token = randomUUID()
    .replaceAll("-", "")
    .slice(0, 10)
    .replace(/[0-9]/g, (digit) => String.fromCharCode("g".charCodeAt(0) + Number(digit)));
  return `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
}
