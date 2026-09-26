import { expect, test } from "@playwright/test";

import { actorApiContext, operationalMutationId, requireOperationalBaseURL, syntheticReferralInput } from "../support/pipeline-actors";

// Quick notes (docs/design/DECISIONS.md, "Quick note") are each person's private reminders per referral:
// a list of entries, dated by the server and tagged with the step the person was on.
test.describe("referral quick notes", () => {
  test.skip(
    process.env.PIPELINE_OPERATIONAL_E2E !== "true",
    "Run with the operational Playwright configuration and an isolated store.",
  );

  test("stay private to their author, date entries on the server, validate plain text, and clear when emptied", async ({ baseURL }) => {
    const base = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", base);
    const colleague = await actorApiContext("admin", base);
    const outsider = await actorApiContext("outsider", base);
    try {
      const created = await coordinator.post("/api/referrals", { data: { client_mutation_id: operationalMutationId("quick-note"), referral: syntheticReferralInput("assessmentCoordinator") } });
      expect(created.status()).toBe(201);
      const referralId = (await created.json()).referral.id as number;
      const path = `/api/referrals/${referralId}/quick-note`;
      type Entry = { id: string; text: string; step: string | null; at: string };
      const listed = async (context: typeof coordinator) => {
        const response = await context.get("/api/me/quick-notes");
        expect(response.status()).toBe(200);
        return ((await response.json()).notes as { referralId: number; entries: Entry[] }[]).filter((note) => note.referralId === referralId);
      };

      const first = await coordinator.put(path, { data: { entries: [{ id: "a1", text: "  Waiting on TB result.\nCall Fri.  ", step: "assessment", at: "1999-01-01T00:00:00.000Z" }] } });
      expect(first.status()).toBe(200);
      const firstEntry = (await first.json()).note.entries[0] as Entry;
      // The server trims the text and sets the date; a date sent by the client is ignored.
      expect(firstEntry).toMatchObject({ id: "a1", text: "Waiting on TB result.\nCall Fri.", step: "assessment" });
      expect(Date.parse(firstEntry.at)).toBeGreaterThan(Date.parse("2020-01-01"));

      // A second entry keeps the first entry's date; the newest comes first.
      const second = await coordinator.put(path, { data: { entries: [{ id: "a1", text: "Waiting on TB result.\nCall Fri.", step: "assessment" }, { id: "b2", text: "Decision due Mon", step: "decision" }] } });
      expect(second.status()).toBe(200);
      const [newest, older] = (await listed(coordinator))[0].entries;
      expect(newest).toMatchObject({ id: "b2", step: "decision" });
      expect(older).toMatchObject({ id: "a1", at: firstEntry.at });

      // Another person with access to the same referral neither sees nor overwrites it.
      expect(await listed(colleague)).toEqual([]);
      expect((await colleague.put(path, { data: { entries: [{ id: "c3", text: "Colleague's own reminder", step: null }] } })).status()).toBe(200);
      expect((await listed(coordinator))[0].entries.map((entry) => entry.id)).toEqual(["b2", "a1"]);
      expect((await listed(colleague))[0].entries).toEqual([expect.objectContaining({ text: "Colleague's own reminder", step: null })]);

      // A note is not a referral edit.
      const activity = await (await coordinator.get(`/api/referrals/${referralId}/activity`)).json();
      expect(JSON.stringify(activity)).not.toContain("Waiting on TB result");

      const bad = [
        { entries: [{ id: "x", text: "x".repeat(2_001), step: null }] },
        { entries: [{ id: "x", text: "bell\u0007", step: null }] },
        { entries: [{ id: "x", text: 42, step: null }] },
        { entries: [{ id: "x", text: "ok", step: "billing" }] },
        { entries: [{ id: "bad id!", text: "ok", step: null }] },
        { entries: [{ id: "x", text: "one", step: null }, { id: "x", text: "two", step: null }] },
        { entries: Array.from({ length: 31 }, (_, index) => ({ id: `e${index}`, text: "ok", step: null })) },
        { entries: Array.from({ length: 7 }, (_, index) => ({ id: `e${index}`, text: "x".repeat(2_000), step: null })) },
        { text: "The old single-text shape" },
      ];
      for (const data of bad) expect((await coordinator.put(path, { data })).status(), JSON.stringify(data).slice(0, 80)).toBe(400);
      // Someone without access to the referral is refused (not a Pipeline user: 403; no access to this referral: 404).
      expect([403, 404]).toContain((await outsider.put(path, { data: { entries: [{ id: "o", text: "No access", step: null }] } })).status());

      // Emptied entries drop out; no entries left clears the note.
      expect((await coordinator.put(path, { data: { entries: [{ id: "b2", text: "   ", step: "decision" }] } })).status()).toBe(200);
      expect(await listed(coordinator)).toEqual([]);
      expect((await listed(colleague))[0].entries).toEqual([expect.objectContaining({ text: "Colleague's own reminder" })]);
    } finally {
      await Promise.all([coordinator.dispose(), colleague.dispose(), outsider.dispose()]);
    }
  });
});
