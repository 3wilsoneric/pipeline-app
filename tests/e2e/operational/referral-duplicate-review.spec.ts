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

  test("requires an exact reviewed candidate set and serializes simultaneous creates", async ({ baseURL }) => {
    const coordinator = await actorApiContext("assessmentCoordinator", requireOperationalBaseURL(baseURL));
    const name = `Review ${uniqueAlphabeticToken()}`;
    const referral = syntheticReferralInput("assessmentCoordinator", {
      name,
      county: "Contra Costa County",
      community: "San Pablo",
    });

    try {
      const firstResponse = await coordinator.post("/api/referrals", {
        data: { client_mutation_id: operationalMutationId("duplicate-first"), referral },
      });
      expect(firstResponse.status()).toBe(201);
      const first = (await firstResponse.json() as { referral: { id: number; name: string } }).referral;

      const secondMutationId = operationalMutationId("duplicate-second");
      const secondResponse = await coordinator.post("/api/referrals", {
        data: { client_mutation_id: secondMutationId, referral },
      });
      expect(secondResponse.status()).toBe(409);
      const review = await secondResponse.json() as {
        suspected_duplicate: boolean;
        duplicate_kind: string;
        can_confirm_distinct_person: boolean;
        confirmation_referral_ids: number[];
        candidates: Array<{ referral_id: number; name: string; county: string }>;
      };
      expect(review).toMatchObject({
        suspected_duplicate: true,
        duplicate_kind: "name_and_county",
        can_confirm_distinct_person: true,
        confirmation_referral_ids: [first.id],
      });
      expect(review.candidates).toEqual([
        expect.objectContaining({
          referral_id: first.id,
          name: first.name,
          county: "Contra Costa County",
        }),
      ]);

      const extraIdResponse = await coordinator.post("/api/referrals", {
        data: {
          client_mutation_id: secondMutationId,
          referral,
          duplicate_confirmation: { referral_ids: [first.id, first.id + 1_000_000] },
        },
      });
      expect(extraIdResponse.status()).toBe(409);
      expect(await extraIdResponse.json()).toMatchObject({
        suspected_duplicate: true,
        confirmation_referral_ids: [first.id],
      });

      const confirmedResponse = await coordinator.post("/api/referrals", {
        data: {
          client_mutation_id: secondMutationId,
          referral,
          duplicate_confirmation: { referral_ids: review.confirmation_referral_ids },
        },
      });
      expect(confirmedResponse.status()).toBe(201);
      const confirmed = (await confirmedResponse.json() as { referral: { id: number } }).referral;
      expect(confirmed.id).not.toBe(first.id);

      const activityResponse = await coordinator.get(`/api/referrals/${confirmed.id}/activity`);
      expect(activityResponse.status()).toBe(200);
      const activity = await activityResponse.json() as { events: Array<{ action: string; reason: string | null }> };
      expect(activity.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: "referral_created",
          reason: `Confirmed as a different person after reviewing referral ${first.id}.`,
        }),
      ]));

      const staleConfirmation = await coordinator.post("/api/referrals", {
        data: {
          client_mutation_id: operationalMutationId("duplicate-stale-confirmation"),
          referral,
          duplicate_confirmation: { referral_ids: [first.id] },
        },
      });
      expect(staleConfirmation.status()).toBe(409);
      expect(await staleConfirmation.json()).toMatchObject({
        suspected_duplicate: true,
        confirmation_referral_ids: [first.id, confirmed.id].sort((left, right) => left - right),
      });

      const raceName = `Collision ${uniqueAlphabeticToken()}`;
      const raceReferral = syntheticReferralInput("assessmentCoordinator", {
        name: raceName,
        county: "Contra Costa County",
        community: "San Pablo",
      });
      const [left, right] = await Promise.all([
        coordinator.post("/api/referrals", {
          data: { client_mutation_id: operationalMutationId("duplicate-race-left"), referral: raceReferral },
        }),
        coordinator.post("/api/referrals", {
          data: { client_mutation_id: operationalMutationId("duplicate-race-right"), referral: raceReferral },
        }),
      ]);
      expect([left.status(), right.status()].sort()).toEqual([201, 409]);

      const raceList = await coordinator.get(`/api/referrals?q=${encodeURIComponent(raceName)}&limit=10`);
      expect(raceList.status()).toBe(200);
      expect((await raceList.json() as { total: number }).total).toBe(1);
    } finally {
      await coordinator.dispose();
    }
  });

  test("does not disclose or accept confirmation of an inaccessible match", async ({ baseURL }) => {
    const operationalBaseURL = requireOperationalBaseURL(baseURL);
    const assessorA = await actorApiContext("assessorA", operationalBaseURL);
    const assessorB = await actorApiContext("assessorB", operationalBaseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", operationalBaseURL);
    const name = `Private ${uniqueAlphabeticToken()}`;
    const referral = syntheticReferralInput("assessorA", {
      name,
      county: "Alameda County",
      community: "San Pablo",
    });

    try {
      const firstResponse = await assessorA.post("/api/referrals", {
        data: { client_mutation_id: operationalMutationId("private-duplicate-first"), referral },
      });
      expect(firstResponse.status()).toBe(201);
      const first = (await firstResponse.json() as { referral: { id: number } }).referral;

      const hiddenMatchResponse = await assessorB.post("/api/referrals", {
        data: { client_mutation_id: operationalMutationId("private-duplicate-second"), referral },
      });
      expect(hiddenMatchResponse.status()).toBe(409);
      const hiddenMatch = await hiddenMatchResponse.json() as Record<string, unknown>;
      expect(hiddenMatch).toMatchObject({
        suspected_duplicate: true,
        can_confirm_distinct_person: false,
        candidates: [],
      });
      expect(hiddenMatch).not.toHaveProperty("confirmation_referral_ids");

      const guessedConfirmationResponse = await assessorB.post("/api/referrals", {
        data: {
          client_mutation_id: operationalMutationId("private-duplicate-guessed"),
          referral,
          duplicate_confirmation: { referral_ids: [first.id] },
        },
      });
      expect(guessedConfirmationResponse.status()).toBe(409);
      expect(await guessedConfirmationResponse.json()).toMatchObject({
        suspected_duplicate: true,
        can_confirm_distinct_person: false,
        candidates: [],
      });

      const supervisorList = await coordinator.get(`/api/referrals?q=${encodeURIComponent(name)}&limit=10`);
      expect(supervisorList.status()).toBe(200);
      expect((await supervisorList.json() as { total: number }).total).toBe(1);
    } finally {
      await Promise.all([assessorA.dispose(), assessorB.dispose(), coordinator.dispose()]);
    }
  });
});

function uniqueAlphabeticToken() {
  const token = randomUUID()
    .replaceAll("-", "")
    .slice(0, 10)
    .replace(/[0-9]/g, (digit) => String.fromCharCode("g".charCodeAt(0) + Number(digit)));
  return `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
}
