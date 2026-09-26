import { expect, test } from "@playwright/test";

import { actorApiContext, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";
import { createOperationalReferral } from "../support/operational-api";

// Client notes (docs/design/DECISIONS.md, "Notes"): attached to the referral for anyone who opens it, saved
// per heading with its own version, never changing the referral itself.
test.describe("client notes", () => {
  test.skip(
    process.env.PIPELINE_OPERATIONAL_E2E !== "true",
    "Run with the operational Playwright configuration and an isolated store.",
  );

  test("are attached to the client, save per heading, guard versions, and never change the referral", async ({ baseURL }) => {
    const base = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", base);
    const assessor = await actorApiContext("assessorA", base);
    const outsider = await actorApiContext("outsider", base);
    try {
      for (const context of [assessor, coordinator]) expect((await context.get("/api/members")).status()).toBe(200);
      const referral = await createOperationalReferral(coordinator, "assessmentCoordinator", {}, { assigneeId: pipelineActors.assessorA.id });
      const notes = `/api/referrals/${referral.id}/notes`;
      const heading = (key: string) => `${notes}/${encodeURIComponent(key)}`;
      const referralVersion = async () => (await (await coordinator.get(`/api/referrals/${referral.id}`)).json()).referral.version as number;

      const before = await referralVersion();
      const first = await assessor.put(heading("before"), { data: { body: "Called county liaison.\nFace sheet coming Mon. ", if_match: 0 } });
      expect(first.status(), await first.text()).toBe(200);
      expect((await first.json()).block).toMatchObject({ block_key: "before", body: "Called county liaison.\nFace sheet coming Mon. ", version: 1, updated_by_name: "Assessor A" });
      expect((await assessor.put(heading("topic:medication"), { data: { body: "Says meds changed last week", if_match: 0 } })).status()).toBe(200);
      // Notes never change the referral's version, so they can't make a referral or assessment save conflict.
      expect(await referralVersion()).toBe(before);

      // Attached to the client: another person who opens the referral sees the same notes and can add to them.
      const read = await coordinator.get(notes);
      expect(read.status()).toBe(200);
      expect(((await read.json()).blocks as { block_key: string }[]).map((item) => item.block_key).sort()).toEqual(["before", "topic:medication"]);
      expect((await coordinator.put(heading("collateral"), { data: { body: "Sister: best reached evenings", if_match: 0 } })).status()).toBe(200);
      // Someone who can't open the referral can neither read nor write.
      expect([403, 404]).toContain((await outsider.get(notes)).status());
      expect([403, 404]).toContain((await outsider.put(heading("before"), { data: { body: "No access", if_match: 1 } })).status());

      // A stale version gets the current text back instead of overwriting it.
      const stale = await coordinator.put(heading("before"), { data: { body: "Older screen", if_match: 0 } });
      expect(stale.status()).toBe(409);
      expect((await stale.json()).block).toMatchObject({ body: "Called county liaison.\nFace sheet coming Mon. ", version: 1 });
      expect((await assessor.put(heading("before"), { data: { body: "Called county liaison twice.", if_match: 1 } })).status()).toBe(200);

      for (const data of [
        { body: "x".repeat(20_001), if_match: 2 },
        { body: "bell\u0007", if_match: 2 },
        { body: 42, if_match: 2 },
        { body: "ok", if_match: -1 },
        { body: "ok" },
      ]) expect((await assessor.put(heading("before"), { data })).status(), JSON.stringify(data).slice(0, 60)).toBe(400);
      expect((await assessor.put(heading("not-a-heading"), { data: { body: "ok", if_match: 0 } })).status()).toBe(400);

      // The Home board's latest note: the first line of the most recently edited heading, only where readable.
      const latest = await coordinator.get(`/api/client-notes/latest?referral_ids=${referral.id}`);
      expect(latest.status()).toBe(200);
      expect((await latest.json()).notes).toEqual([expect.objectContaining({ referral_id: referral.id, text: "Called county liaison twice." })]);
      expect((await (await outsider.get(`/api/client-notes/latest?referral_ids=${referral.id}`)).json()).notes ?? []).toEqual([]);
      expect((await coordinator.get("/api/client-notes/latest?referral_ids=abc")).status()).toBe(400);

      // Notes are not referral activity.
      const activity = await (await coordinator.get(`/api/referrals/${referral.id}/activity`)).json();
      expect(JSON.stringify(activity)).not.toContain("Called county liaison");
    } finally {
      await Promise.all([coordinator.dispose(), assessor.dispose(), outsider.dispose()]);
    }
  });
});
