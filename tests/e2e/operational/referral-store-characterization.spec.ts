import { expect, request, test, type APIRequestContext } from "@playwright/test";

import {
  actorApiContext,
  pipelineActors,
  requireOperationalBaseURL,
  syntheticReferralInput,
} from "../support/pipeline-actors";

test.describe("referral store characterization", () => {
  test.skip(
    process.env.PIPELINE_REFERRAL_CHARACTERIZATION !== "true",
    "Run through npm run characterize:referral-store so local and PostgreSQL use isolated stores.",
  );

  test("replays one create exactly once with one attributed audit event", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const mutationId = "characterization-create-replay";
    const referral = fixedReferral("Synthetic Replay");

    try {
      const first = await coordinator.post("/api/referrals", {
        data: { client_mutation_id: mutationId, referral },
      });
      const replay = await coordinator.post("/api/referrals", {
        data: {
          client_mutation_id: mutationId,
          referral: { ...referral, name: "Synthetic Replacement" },
        },
      });
      expect(first.status()).toBe(201);
      expect(replay.status()).toBe(201);

      const firstBody = record(await first.json());
      const replayBody = record(await replay.json());
      const firstReferral = record(firstBody.referral);
      const replayReferral = record(replayBody.referral);
      expect(firstBody.idempotent_replay).toBe(false);
      expect(replayBody.idempotent_replay).toBe(true);
      expect(replayReferral.id).toBe(firstReferral.id);
      expect(replayReferral.name).toBe(firstReferral.name);
      expect(replayReferral.version).toBe(firstReferral.version);
      expect(replayReferral.sectionVersions).toEqual(firstReferral.sectionVersions);

      const events = await referralEvents(coordinator, number(firstReferral.id));
      const creates = events.filter((event) => event.action === "referral_created");
      expect(creates).toHaveLength(1);
      expect(creates[0]).toMatchObject({
        actor_id: pipelineActors.assessmentCoordinator.id,
        actor_name: pipelineActors.assessmentCoordinator.name,
        from_version: null,
        to_version: 1,
      });
      expect(await queryReferralCount(coordinator, "Synthetic Replacement")).toBe(0);
    } finally {
      await coordinator.dispose();
    }
  });

  test("accepts disjoint section writes and gives one same-section writer the only durable effect", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const admin = await actorApiContext("admin", url);
    const coordinator = await actorApiContext("assessmentCoordinator", url);

    try {
      const created = await createReferral(coordinator, "characterization-section-create", "Simone Section");
      const identityVersion = sectionVersion(created, "identity");
      const intakeVersion = sectionVersion(created, "intake");
      const [identity, intake] = await Promise.all([
        admin.patch(`/api/referrals/${number(created.id)}`, {
          data: {
            if_match: number(created.version),
            if_match_sections: { identity: identityVersion },
            patch: { phone: "555-0101" },
          },
        }),
        coordinator.patch(`/api/referrals/${number(created.id)}`, {
          data: {
            if_match: number(created.version),
            if_match_sections: { intake: intakeVersion },
            patch: { note: "Synthetic characterized intake context." },
          },
        }),
      ]);
      expect([identity.status(), intake.status()].sort()).toEqual([200, 200]);

      const afterDisjoint = await readReferral(admin, number(created.id));
      expect(afterDisjoint.phone).toBe("555-0101");
      expect(afterDisjoint.note).toBe("Synthetic characterized intake context.");
      const auditBeforeRace = await referralEvents(admin, number(created.id));

      const sameSectionVersion = sectionVersion(afterDisjoint, "identity");
      const [left, right] = await Promise.all([
        admin.patch(`/api/referrals/${number(created.id)}`, {
          data: {
            if_match: number(afterDisjoint.version),
            if_match_sections: { identity: sameSectionVersion },
            patch: { phone: "555-0201" },
          },
        }),
        coordinator.patch(`/api/referrals/${number(created.id)}`, {
          data: {
            if_match: number(afterDisjoint.version),
            if_match_sections: { identity: sameSectionVersion },
            patch: { phone: "555-0202" },
          },
        }),
      ]);
      expect([left.status(), right.status()].sort()).toEqual([200, 409]);
      const conflict = record(await (left.status() === 409 ? left : right).json());
      expect(conflict.conflict).toBe(true);
      expect(conflict.conflicting_sections).toEqual(["identity"]);

      const finalReferral = await readReferral(admin, number(created.id));
      expect(["555-0201", "555-0202"]).toContain(finalReferral.phone);
      const auditAfterRace = await referralEvents(admin, number(created.id));
      expect(auditAfterRace).toHaveLength(auditBeforeRace.length + 1);
      const phoneEvents = auditAfterRace.filter((event) => array(event.changed_fields).includes("phone"));
      expect(phoneEvents).toHaveLength(2);
      expect(phoneEvents.map((event) => event.actor_id).sort()).toEqual([
        pipelineActors.admin.id,
        finalReferral.phone === "555-0201"
          ? pipelineActors.admin.id
          : pipelineActors.assessmentCoordinator.id,
      ].sort());
    } finally {
      await Promise.all([admin.dispose(), coordinator.dispose()]);
    }
  });

  test("denied mutations leave referral state and audit history unchanged", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const admin = await actorApiContext("admin", url);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const assessorA = await actorApiContext("assessorA", url);
    const assessorB = await actorApiContext("assessorB", url);
    const viewer = await actorApiContext("viewer", url);
    const anonymous = await request.newContext({ baseURL: url });

    try {
      expect((await assessorA.get("/api/members")).status()).toBe(200);
      const created = await createReferral(
        coordinator,
        "characterization-authorization-create",
        "Avery Authorization",
        pipelineActors.assessorA.id,
      );
      const id = number(created.id);
      const before = await readReferral(coordinator, id);
      const eventsBefore = await referralEvents(coordinator, id);
      const mutation = {
        if_match: number(before.version),
        if_match_sections: { identity: sectionVersion(before, "identity") },
        patch: { phone: "555-9999" },
      };

      const [unassignedAssessor, readOnlyViewer, unauthenticated, crossOrigin] = await Promise.all([
        assessorB.patch(`/api/referrals/${id}`, { data: mutation }),
        viewer.patch(`/api/referrals/${id}`, { data: mutation }),
        anonymous.patch(`/api/referrals/${id}`, { data: mutation }),
        admin.patch(`/api/referrals/${id}`, {
          headers: { Origin: "https://untrusted.example.invalid" },
          data: mutation,
        }),
      ]);
      expect(unassignedAssessor.status()).toBe(404);
      expect(readOnlyViewer.status()).toBe(403);
      expect(unauthenticated.status()).toBe(401);
      expect(crossOrigin.status()).toBe(403);

      const deniedCreateName = "Synthetic Authorization Denied Create";
      const deniedCreate = {
        client_mutation_id: "characterization-authorization-denied-create",
        referral: fixedReferral(deniedCreateName),
      };
      const [viewerCreate, anonymousCreate, crossOriginCreate] = await Promise.all([
        viewer.post("/api/referrals", { data: deniedCreate }),
        anonymous.post("/api/referrals", { data: deniedCreate }),
        coordinator.post("/api/referrals", {
          headers: { Origin: "https://untrusted.example.invalid" },
          data: deniedCreate,
        }),
      ]);
      expect(viewerCreate.status()).toBe(403);
      expect(anonymousCreate.status()).toBe(401);
      expect(crossOriginCreate.status()).toBe(403);

      expect(await readReferral(coordinator, id)).toEqual(before);
      expect(await referralEvents(coordinator, id)).toEqual(eventsBefore);
      expect(await queryReferralCount(coordinator, deniedCreateName)).toBe(0);
    } finally {
      await Promise.all([
        admin.dispose(),
        coordinator.dispose(),
        assessorA.dispose(),
        assessorB.dispose(),
        viewer.dispose(),
        anonymous.dispose(),
      ]);
    }
  });

  test("reassigns the referral and its open assessment as one attributed handoff", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const assessorA = await actorApiContext("assessorA", url);
    const assessorB = await actorApiContext("assessorB", url);

    try {
      expect((await assessorA.get("/api/members")).status()).toBe(200);
      expect((await assessorB.get("/api/members")).status()).toBe(200);
      const created = await createReferral(
        coordinator,
        "characterization-reassignment-create",
        "Riley Reassignment",
        pipelineActors.assessorA.id,
      );
      const id = number(created.id);
      expect(created).toMatchObject({
        owner: pipelineActors.assessorA.name,
        ownerId: pipelineActors.assessorA.id,
      });

      const assessmentCreate = await assessorA.post(`/api/referrals/${id}/assessments`, {
        data: {
          client_mutation_id: "characterization-reassignment-assessment",
          data: { current_location: "Synthetic reassignment characterization." },
        },
      });
      const assessmentCreateText = await assessmentCreate.text();
      expect(assessmentCreate.status(), assessmentCreateText).toBe(201);
      const assessmentBefore = record(record(JSON.parse(assessmentCreateText)).assessment);
      expect(assessmentBefore).toMatchObject({
        assessor_id: pipelineActors.assessorA.id,
        assessor: pipelineActors.assessorA.name,
      });

      const reassignment = await coordinator.patch(`/api/referrals/${id}`, {
        data: {
          if_match: number(created.version),
          if_match_sections: {
            intake: sectionVersion(created, "intake"),
            workflow: sectionVersion(created, "workflow"),
          },
          patch: { owner: pipelineActors.assessorB.name },
          assignee_id: pipelineActors.assessorB.id,
          handoff_reason: "Synthetic reassignment characterization.",
        },
      });
      const reassignmentText = await reassignment.text();
      expect(reassignment.status(), reassignmentText).toBe(200);
      const referralAfter = record(record(JSON.parse(reassignmentText)).referral);
      expect(referralAfter).toMatchObject({
        owner: pipelineActors.assessorB.name,
        ownerId: pipelineActors.assessorB.id,
      });
      expect(array(referralAfter.owners)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: pipelineActors.assessmentCoordinator.id,
          responsibilities: expect.arrayContaining(["creator", "assigning_supervisor"]),
        }),
        expect.objectContaining({
          id: pipelineActors.assessorB.id,
          responsibilities: expect.arrayContaining(["assignee"]),
        }),
      ]));
      expect(array(referralAfter.owners).some((owner) => record(owner).id === pipelineActors.assessorA.id)).toBe(false);

      const assessmentsResponse = await coordinator.get(`/api/referrals/${id}/assessments`);
      expect(assessmentsResponse.status()).toBe(200);
      const assessments = array(record(await assessmentsResponse.json()).assessments).map(record);
      expect(assessments).toHaveLength(1);
      expect(assessments[0]).toMatchObject({
        assessment_id: assessmentBefore.assessment_id,
        assessor_id: pipelineActors.assessorB.id,
        assessor: pipelineActors.assessorB.name,
        version: number(assessmentBefore.version) + 1,
      });
      expect(array(assessments[0].audit_events).map(record)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: "assessment_assigned",
          actor_id: pipelineActors.assessmentCoordinator.id,
          actor_name: pipelineActors.assessmentCoordinator.name,
        }),
      ]));

      const referralAudit = await referralEvents(coordinator, id);
      expect(referralAudit).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action: "referral_reassigned",
          actor_id: pipelineActors.assessmentCoordinator.id,
          actor_name: pipelineActors.assessmentCoordinator.name,
          reason: "Synthetic reassignment characterization.",
        }),
      ]));
      expect((await assessorA.get(`/api/referrals/${id}`)).status()).toBe(404);
      expect((await assessorB.get(`/api/referrals/${id}`)).status()).toBe(200);
    } finally {
      await Promise.all([coordinator.dispose(), assessorA.dispose(), assessorB.dispose()]);
    }
  });

  test("preserves filtered lists, facets, client ordering, and cursor pagination", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const assessorA = await actorApiContext("assessorA", url);
    const assessorB = await actorApiContext("assessorB", url);
    const marker = "Synthetic parity catalog";

    try {
      expect((await assessorA.get("/api/members")).status()).toBe(200);
      expect((await assessorB.get("/api/members")).status()).toBe(200);
      await createReferral(
        coordinator,
        "characterization-query-alpha",
        "Alden Filters",
        pipelineActors.assessorA.id,
        {
          source: marker,
          county: "Alameda County",
          community: "San Pablo",
          priority: "urgent",
          tags: ["parity-batch", "parity-urgent"],
        },
      );
      await createReferral(
        coordinator,
        "characterization-query-bravo",
        "Brennan Filters",
        pipelineActors.assessorB.id,
        {
          source: marker,
          county: "Contra Costa County",
          community: "Turlock",
          priority: "high",
          tags: ["parity-batch"],
        },
      );
      await createReferral(
        coordinator,
        "characterization-query-charlie",
        "Carmen Filters",
        undefined,
        {
          source: marker,
          county: "Alameda County",
          community: "Santa Clarita",
          priority: "standard",
          tags: ["parity-batch"],
        },
      );

      const firstPageResponse = await coordinator.get(
        `/api/referrals?q=${encodeURIComponent(marker)}&sort=client_asc&limit=2&projection=summary`,
      );
      expect(firstPageResponse.status()).toBe(200);
      const firstPage = record(await firstPageResponse.json());
      expect(number(firstPage.total)).toBe(3);
      expect(array(firstPage.referrals).map((item) => record(item).name)).toEqual([
        "Alden Filters",
        "Brennan Filters",
      ]);
      expect(typeof firstPage.next_cursor).toBe("string");

      const secondPageResponse = await coordinator.get(
        `/api/referrals?q=${encodeURIComponent(marker)}&sort=client_asc&limit=2&projection=summary&cursor=${encodeURIComponent(String(firstPage.next_cursor))}`,
      );
      expect(secondPageResponse.status()).toBe(200);
      const secondPage = record(await secondPageResponse.json());
      expect(number(secondPage.total)).toBe(3);
      expect(array(secondPage.referrals).map((item) => record(item).name)).toEqual(["Carmen Filters"]);
      expect(secondPage.next_cursor).toBeUndefined();

      const filteredResponse = await coordinator.get(
        `/api/referrals?q=${encodeURIComponent(marker)}&county=Alameda%20County&owner=Assessor%20A&priority=urgent&tag=parity-urgent&projection=summary`,
      );
      expect(filteredResponse.status()).toBe(200);
      const filtered = record(await filteredResponse.json());
      expect(number(filtered.total)).toBe(1);
      expect(array(filtered.referrals).map((item) => record(item).name)).toEqual(["Alden Filters"]);

      const facetsResponse = await coordinator.get(`/api/referrals/facets?q=${encodeURIComponent(marker)}`);
      expect(facetsResponse.status()).toBe(200);
      const facets = record(record(await facetsResponse.json()).facets);
      expect(array(facets.communities).map(record)).toEqual([
        { value: "San Pablo", count: 1 },
        { value: "Santa Clarita", count: 1 },
        { value: "Turlock", count: 1 },
      ]);
      expect(array(facets.counties).map(record)).toEqual([
        { value: "Alameda County", count: 2 },
        { value: "Contra Costa County", count: 1 },
      ]);
      expect(array(facets.owners).map(record)).toEqual([
        { value: "Admissions Coordinator", count: 1 },
        { value: "Assessor A", count: 1 },
        { value: "Assessor B", count: 1 },
      ]);
      expect(array(facets.priorities).map(record)).toEqual([
        { value: "high", count: 1 },
        { value: "standard", count: 1 },
        { value: "urgent", count: 1 },
      ]);
      expect(array(facets.stages).map(record)).toEqual([{ value: "New", count: 3 }]);
      expect(array(facets.tags).map(record)).toEqual([
        { value: "parity-batch", count: 3 },
        { value: "parity-urgent", count: 1 },
      ]);
      expect(array(facets.months).map(record)).toEqual([{ value: "2026-09", count: 3 }]);
    } finally {
      await Promise.all([coordinator.dispose(), assessorA.dispose(), assessorB.dispose()]);
    }
  });

  test("rejects invalid creates and duplicate packets without side effects", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const packetHash = "a".repeat(64);

    try {
      const invalidName = "Synthetic Invalid Initial State";
      const invalid = await coordinator.post("/api/referrals", {
        data: {
          client_mutation_id: "characterization-invalid-create",
          referral: fixedReferral(invalidName, { stage: "Accepted" }),
        },
      });
      expect(invalid.status()).toBe(400);
      expect(await queryReferralCount(coordinator, invalidName)).toBe(0);

      const first = await createReferral(
        coordinator,
        "characterization-packet-original",
        "Synthetic Packet Original",
        undefined,
        { documentHash: packetHash },
      );
      const eventsBefore = await referralEvents(coordinator, number(first.id));
      const duplicate = await coordinator.post("/api/referrals", {
        data: {
          client_mutation_id: "characterization-packet-duplicate",
          referral: fixedReferral("Synthetic Packet Duplicate", { documentHash: packetHash }),
        },
      });
      expect(duplicate.status()).toBe(409);
      expect(record(await duplicate.json())).toMatchObject({
        duplicate: true,
        referral_id: number(first.id),
      });
      expect(await queryReferralCount(coordinator, "Synthetic Packet Duplicate")).toBe(0);
      expect(await referralEvents(coordinator, number(first.id))).toEqual(eventsBefore);
    } finally {
      await coordinator.dispose();
    }
  });

  test("moves one referral to recoverable trash and restores it exactly once", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const assessorA = await actorApiContext("assessorA", url);
    const assessorB = await actorApiContext("assessorB", url);
    const viewer = await actorApiContext("viewer", url);

    try {
      expect((await assessorA.get("/api/members")).status()).toBe(200);
      const created = await createReferral(
        coordinator,
        "characterization-trash-create",
        "Tessa Trash",
        pipelineActors.assessorA.id,
      );
      const id = number(created.id);
      const eventsBeforeDenials = await referralEvents(coordinator, id);
      const [unassignedDelete, viewerDelete, crossOriginDelete] = await Promise.all([
        assessorB.delete(`/api/referrals/${id}`, { data: { if_match: number(created.version) } }),
        viewer.delete(`/api/referrals/${id}`, { data: { if_match: number(created.version) } }),
        coordinator.delete(`/api/referrals/${id}`, {
          headers: { Origin: "https://untrusted.example.invalid" },
          data: { if_match: number(created.version) },
        }),
      ]);
      expect(unassignedDelete.status()).toBe(403);
      expect(viewerDelete.status()).toBe(403);
      expect(crossOriginDelete.status()).toBe(403);
      expect(await readReferral(coordinator, id)).toEqual(created);
      expect(await referralEvents(coordinator, id)).toEqual(eventsBeforeDenials);

      const staleDelete = await coordinator.delete(`/api/referrals/${id}`, {
        data: { if_match: number(created.version) + 1 },
      });
      expect(staleDelete.status()).toBe(409);
      expect((await referralEvents(coordinator, id)).filter((event) => event.action === "referral_moved_to_trash")).toHaveLength(0);

      const deleted = await coordinator.delete(`/api/referrals/${id}`, {
        data: { if_match: number(created.version) },
      });
      expect(deleted.status()).toBe(200);
      const deletedReferral = record(record(await deleted.json()).referral);
      expect(number(deletedReferral.version)).toBe(number(created.version) + 1);
      expect(Date.parse(String(deletedReferral.deleteAfter)) - Date.parse(String(deletedReferral.deletedAt))).toBe(30 * 24 * 60 * 60 * 1_000);
      expect((await coordinator.get(`/api/referrals/${id}`)).status()).toBe(404);

      const [unassignedRestore, viewerRestore, crossOriginRestore] = await Promise.all([
        assessorB.post(`/api/trash/referrals/${id}/restore`, {
          data: { if_match: number(deletedReferral.version) },
        }),
        viewer.post(`/api/trash/referrals/${id}/restore`, {
          data: { if_match: number(deletedReferral.version) },
        }),
        coordinator.post(`/api/trash/referrals/${id}/restore`, {
          headers: { Origin: "https://untrusted.example.invalid" },
          data: { if_match: number(deletedReferral.version) },
        }),
      ]);
      expect(unassignedRestore.status()).toBe(404);
      expect(viewerRestore.status()).toBe(403);
      expect(crossOriginRestore.status()).toBe(403);

      const staleRestore = await coordinator.post(`/api/trash/referrals/${id}/restore`, {
        data: { if_match: number(deletedReferral.version) + 1 },
      });
      expect(staleRestore.status()).toBe(409);
      const restored = await coordinator.post(`/api/trash/referrals/${id}/restore`, {
        data: { if_match: number(deletedReferral.version) },
      });
      expect(restored.status()).toBe(200);
      const restoredReferral = record(record(await restored.json()).referral);
      expect(number(restoredReferral.version)).toBe(number(deletedReferral.version) + 1);
      expect(restoredReferral.deletedAt).toBeUndefined();
      expect(restoredReferral.deleteAfter).toBeUndefined();

      const events = await referralEvents(coordinator, id);
      expect(events.filter((event) => event.action === "referral_moved_to_trash")).toHaveLength(1);
      expect(events.filter((event) => event.action === "referral_restored")).toHaveLength(1);
    } finally {
      await Promise.all([coordinator.dispose(), assessorA.dispose(), assessorB.dispose(), viewer.dispose()]);
    }
  });
});

function fixedReferral(name: string, overrides: Record<string, unknown> = {}) {
  return syntheticReferralInput("assessmentCoordinator", {
    name,
    date: "2026-09-06",
    county: "Contra Costa County",
    createdAt: "2026-09-06T12:00:00.000Z",
    note: "Synthetic referral-store characterization. Contains no PHI.",
    ...overrides,
  });
}

async function createReferral(
  context: APIRequestContext,
  mutationId: string,
  name: string,
  assigneeId?: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await context.post("/api/referrals", {
    data: {
      client_mutation_id: mutationId,
      referral: fixedReferral(name, overrides),
      ...(assigneeId ? { assignee_id: assigneeId } : {}),
    },
  });
  const bodyText = await response.text();
  expect(response.status(), bodyText).toBe(201);
  return record(record(JSON.parse(bodyText)).referral);
}

async function readReferral(context: APIRequestContext, id: number) {
  const response = await context.get(`/api/referrals/${id}`);
  expect(response.status()).toBe(200);
  return record(record(await response.json()).referral);
}

async function referralEvents(context: APIRequestContext, id: number) {
  const response = await context.get(`/api/referrals/${id}/activity`);
  expect(response.status()).toBe(200);
  return array(record(await response.json()).events).map(record);
}

async function queryReferralCount(context: APIRequestContext, query: string) {
  const response = await context.get(`/api/referrals?q=${encodeURIComponent(query)}&limit=10&projection=summary`);
  expect(response.status()).toBe(200);
  return number(record(await response.json()).total);
}

function sectionVersion(referral: Record<string, unknown>, section: string) {
  return number(record(referral.sectionVersions)[section]);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected an array.");
  return value;
}

function number(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Expected a number.");
  return parsed;
}
