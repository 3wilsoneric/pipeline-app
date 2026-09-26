import { expect, test } from "@playwright/test";

import { actorApiContext, operationalMutationId, requireOperationalBaseURL, syntheticReferralInput } from "../support/pipeline-actors";

// Quick notes (docs/design/DECISIONS.md, "Quick note") are each person's private reminder per referral.
test.describe("referral quick notes", () => {
  test.skip(
    process.env.PIPELINE_OPERATIONAL_E2E !== "true",
    "Run with the operational Playwright configuration and an isolated store.",
  );

  test("stay private to their author, validate plain text, and clear when emptied", async ({ baseURL }) => {
    const base = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", base);
    const colleague = await actorApiContext("admin", base);
    const outsider = await actorApiContext("outsider", base);
    try {
      const created = await coordinator.post("/api/referrals", { data: { client_mutation_id: operationalMutationId("quick-note"), referral: syntheticReferralInput("assessmentCoordinator") } });
      expect(created.status()).toBe(201);
      const referralId = (await created.json()).referral.id as number;
      const path = `/api/referrals/${referralId}/quick-note`;
      const listed = async (context: typeof coordinator) => {
        const response = await context.get("/api/me/quick-notes");
        expect(response.status()).toBe(200);
        return ((await response.json()).notes as { referralId: number; text: string }[]).filter((note) => note.referralId === referralId);
      };

      const saved = await coordinator.put(path, { data: { text: "  Waiting on TB result.\nCall Fri.  " } });
      expect(saved.status()).toBe(200);
      expect((await saved.json()).note).toMatchObject({ referralId, text: "Waiting on TB result.\nCall Fri." });
      expect(await listed(coordinator)).toEqual([expect.objectContaining({ text: "Waiting on TB result.\nCall Fri." })]);

      // Another person with access to the same referral neither sees nor overwrites it.
      expect(await listed(colleague)).toEqual([]);
      expect((await colleague.put(path, { data: { text: "Colleague's own reminder" } })).status()).toBe(200);
      expect(await listed(coordinator)).toEqual([expect.objectContaining({ text: "Waiting on TB result.\nCall Fri." })]);
      expect(await listed(colleague)).toEqual([expect.objectContaining({ text: "Colleague's own reminder" })]);

      // A note is not a referral edit.
      const activity = await (await coordinator.get(`/api/referrals/${referralId}/activity`)).json();
      expect(JSON.stringify(activity)).not.toContain("Waiting on TB result");

      expect((await coordinator.put(path, { data: { text: "x".repeat(501) } })).status()).toBe(400);
      expect((await coordinator.put(path, { data: { text: "bell\u0007" } })).status()).toBe(400);
      expect((await coordinator.put(path, { data: { text: 42 } })).status()).toBe(400);
      // Someone without access to the referral is refused (not a Pipeline user: 403; no access to this referral: 404).
      expect([403, 404]).toContain((await outsider.put(path, { data: { text: "No access" } })).status());

      expect((await coordinator.put(path, { data: { text: "   " } })).status()).toBe(200);
      expect(await listed(coordinator)).toEqual([]);
      expect(await listed(colleague)).toEqual([expect.objectContaining({ text: "Colleague's own reminder" })]);
    } finally {
      await Promise.all([coordinator.dispose(), colleague.dispose(), outsider.dispose()]);
    }
  });
});
