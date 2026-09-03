import { expect, request, test } from "@playwright/test";

import {
  actorApiContext,
  operationalMutationId,
  pipelineActors,
  requireOperationalBaseURL,
  syntheticReferralInput,
  workerApiContext,
} from "../support/pipeline-actors";

test.describe("operational account and role boundaries", () => {
  test.skip(
    process.env.PIPELINE_OPERATIONAL_E2E !== "true",
    "Run with npm run test:e2e:operational while the final workflow is being solidified.",
  );

  test("mimics the expected Pipeline roles from synthetic account principals", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const actorKeys = ["admin", "assessmentCoordinator", "assessorA", "viewer"] as const;
    const contexts = await Promise.all(actorKeys.map((actorKey) => actorApiContext(actorKey, url)));

    try {
      for (const [index, context] of contexts.entries()) {
        const actor = pipelineActors[actorKeys[index]];
        const response = await context.get("/api/auth/me");
        expect(response.status(), `${actor.name} should authenticate`).toBe(200);
        const body = await response.json();
        expect(body.user.email).toBe(actor.email);
        expect(body.user.roles).toEqual(expect.arrayContaining(actor.expectedRoles));
      }
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  });

  test("blocks viewer, outsider, and reviewer access at mutation decision seams", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const viewer = await actorApiContext("viewer", url);
    const outsider = await actorApiContext("outsider", url);
    const reviewer = await actorApiContext("assessorA", url);
    const coordinator = await actorApiContext("assessmentCoordinator", url);

    try {
      const viewerCreate = await viewer.post("/api/referrals", {
        data: {
          client_mutation_id: operationalMutationId("viewer-create"),
          referral: syntheticReferralInput("viewer"),
        },
      });
      expect(viewerCreate.status()).toBe(403);

      const outsiderRead = await outsider.get("/api/referrals?limit=1");
      expect(outsiderRead.status()).toBe(403);

      const reviewerDecision = await reviewer.put("/api/referrals/1/decision", {
        data: {
          if_match: 1,
          if_match_section: 1,
          outcome: "accepted",
          reason_code: "test",
        },
      });
      expect(reviewerDecision.status()).toBe(403);

      const coordinatorCreateValidation = await coordinator.post("/api/referrals", {
        data: { client_mutation_id: operationalMutationId("coordinator-validation"), referral: {} },
      });
      expect([401, 403]).not.toContain(coordinatorCreateValidation.status());
      expect(coordinatorCreateValidation.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await Promise.all([
        viewer.dispose(),
        outsider.dispose(),
        reviewer.dispose(),
        coordinator.dispose(),
      ]);
    }
  });

  test("keeps supervisor and internal-worker surfaces on separate auth boundaries", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const admin = await actorApiContext("admin", url);
    const viewer = await actorApiContext("viewer", url);
    const anonymous = await request.newContext({ baseURL: url });
    const worker = await workerApiContext(url);

    try {
      const adminQueue = await admin.get("/api/operations/supervisor-queue");
      expect(adminQueue.status()).toBe(200);

      const viewerQueue = await viewer.get("/api/operations/supervisor-queue");
      expect(viewerQueue.status()).toBe(403);

      const anonymousWorker = await anonymous.get("/api/internal/extraction/queue");
      expect(anonymousWorker.status()).toBe(401);

      const workerQueue = await worker.get("/api/internal/extraction/queue");
      expect([200, 503]).toContain(workerQueue.status());
      const workerQueueBody = await workerQueue.json();
      expect(workerQueueBody).toEqual(expect.objectContaining({
        generated_at: expect.any(String),
        queues: expect.any(Array),
      }));
      if (workerQueue.status() === 503) {
        expect(workerQueueBody.reason).toMatch(/^(database_unavailable|queue_query_failed)$/);
      }
    } finally {
      await Promise.all([
        admin.dispose(),
        viewer.dispose(),
        anonymous.dispose(),
        worker.dispose(),
      ]);
    }
  });

  test("scopes home briefings, calendars, and reports to the signed-in role", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const assessor = await actorApiContext("assessorA", url);
    const coordinator = await actorApiContext("assessmentCoordinator", url);

    try {
      const [assessorHome, coordinatorHome] = await Promise.all([
        assessor.get("/api/operations/home"),
        coordinator.get("/api/operations/home"),
      ]);
      expect(assessorHome.status()).toBe(200);
      expect(coordinatorHome.status()).toBe(200);
      expect(await assessorHome.json()).toEqual(expect.objectContaining({
        scope: "personal",
        workflow: expect.objectContaining({
          ready_to_schedule: expect.objectContaining({ items: expect.any(Array) }),
          data_completion: expect.objectContaining({ items: expect.any(Array) }),
        }),
      }));
      expect(await coordinatorHome.json()).toEqual(expect.objectContaining({
        scope: "team",
        workflow: expect.objectContaining({
          ready_to_schedule: expect.objectContaining({ items: expect.any(Array) }),
          data_completion: expect.objectContaining({ items: expect.any(Array) }),
        }),
      }));

      const [assessorCalendar, coordinatorCalendar] = await Promise.all([
        assessor.get("/api/calendar/events?from=2026-09-01&to=2026-09-30"),
        coordinator.get("/api/calendar/events?from=2026-09-01&to=2026-09-30"),
      ]);
      expect(assessorCalendar.status()).toBe(200);
      expect(coordinatorCalendar.status()).toBe(200);
      expect(await assessorCalendar.json()).toEqual(expect.objectContaining({ scope: "personal" }));
      expect(await coordinatorCalendar.json()).toEqual(expect.objectContaining({ scope: "team" }));

      const assessorReports = await assessor.get("/api/operations/reports?report_id=active_referrals&month=2026-09");
      expect(assessorReports.status()).toBe(200);
      const assessorReportBody = await assessorReports.json();
      expect(assessorReportBody.catalog).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "supervisor_exceptions" }),
      ]));

      const assessorExceptions = await assessor.get("/api/operations/reports?report_id=supervisor_exceptions&month=2026-09");
      expect(assessorExceptions.status()).toBe(403);

      const coordinatorExceptions = await coordinator.get("/api/operations/reports?report_id=supervisor_exceptions&month=2026-09");
      expect(coordinatorExceptions.status()).toBe(200);
    } finally {
      await Promise.all([assessor.dispose(), coordinator.dispose()]);
    }
  });
});
