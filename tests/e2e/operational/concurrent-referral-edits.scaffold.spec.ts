import { expect, test } from "@playwright/test";

import {
  createOperationalReferral,
  readOperationalReferral,
} from "../support/operational-api";
import {
  actorApiContext,
  requireOperationalBaseURL,
} from "../support/pipeline-actors";

test.describe("operational concurrent referral editing scaffold", () => {
  test.skip(
    process.env.PIPELINE_OPERATIONAL_E2E !== "true",
    "Run with npm run test:e2e:operational after the final canvas conflict UX is ready.",
  );

  test("merges disjoint section saves and rejects same-section stale writes", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const admin = await actorApiContext("admin", url);
    const coordinator = await actorApiContext("assessmentCoordinator", url);

    try {
      const created = await createOperationalReferral(coordinator, "assessmentCoordinator");

      const [identitySave, intakeSave] = await Promise.all([
        admin.patch(`/api/referrals/${created.id}`, {
          data: {
            if_match: created.version,
            if_match_sections: { identity: created.sectionVersions.identity },
            patch: { phone: "555-0101" },
          },
        }),
        coordinator.patch(`/api/referrals/${created.id}`, {
          data: {
            if_match: created.version,
            if_match_sections: { intake: created.sectionVersions.intake },
            patch: { note: "Coordinator added intake context during certification." },
          },
        }),
      ]);

      expect(identitySave.status()).toBe(200);
      expect(intakeSave.status()).toBe(200);

      const latest = await readOperationalReferral(admin, created.id);
      const [firstSameSection, secondSameSection] = await Promise.all([
        admin.patch(`/api/referrals/${created.id}`, {
          data: {
            if_match: latest.version,
            if_match_sections: { identity: latest.sectionVersions.identity },
            patch: { phone: "555-0201" },
          },
        }),
        coordinator.patch(`/api/referrals/${created.id}`, {
          data: {
            if_match: latest.version,
            if_match_sections: { identity: latest.sectionVersions.identity },
            patch: { phone: "555-0202" },
          },
        }),
      ]);

      const statuses = [firstSameSection.status(), secondSameSection.status()].sort();
      expect(statuses).toEqual([200, 409]);

      const conflictResponse = firstSameSection.status() === 409 ? firstSameSection : secondSameSection;
      const conflict = await conflictResponse.json();
      expect(conflict.conflict).toBe(true);
      expect(conflict.conflicting_sections ?? []).toContain("identity");
    } finally {
      await Promise.all([
        admin.dispose(),
        coordinator.dispose(),
      ]);
    }
  });
});
