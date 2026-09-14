import { expect, request, test } from "@playwright/test";

import {
  actorApiContext,
  actorPage,
  operationalMutationId,
  pipelineActors,
  requireOperationalBaseURL,
  syntheticReferralInput,
  workerApiContext,
} from "../support/pipeline-actors";
import {
  createOperationalAssessment,
  createOperationalReferral,
  scheduleOperationalAssessment,
  type OperationalReferral,
} from "../support/operational-api";

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

  test("enforces supervisor-only report reads and CSV exports", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    for (const actorKey of ["admin", "assessmentCoordinator", "assessorA", "viewer", "outsider"] as const) {
      const context = await actorApiContext(actorKey, url);
      try {
        const filters = { report_id: "active_referrals", month: "2026-09" };
        const read = await context.get(`/api/operations/reports?${new URLSearchParams(filters)}`);
        const exported = await context.post("/api/operations/reports", { data: filters });
        const expected = actorKey === "admin" || actorKey === "assessmentCoordinator" ? 200 : 403;
        expect(read.status(), `${actorKey} report read`).toBe(expected);
        expect(exported.status(), `${actorKey} report export`).toBe(expected);
      } finally {
        await context.dispose();
      }
    }
    const anonymous = await request.newContext({ baseURL: url });
    try {
      expect((await anonymous.get("/api/operations/reports")).status()).toBe(401);
      expect((await anonymous.post("/api/operations/reports", { data: {} })).status()).toBe(401);
    } finally {
      await anonymous.dispose();
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

      const supervisorOnlyReview = {
        action: "request_changes",
        if_match: 1,
        if_match_section: 1,
        if_match_review: 1,
        review_id: "00000000-0000-4000-8000-000000000001",
        reason_note: "Synthetic authorization boundary check.",
      };
      for (const context of [viewer, outsider, reviewer, coordinator]) {
        const response = await context.post("/api/referrals/1/assessment-review", {
          data: supervisorOnlyReview,
        });
        expect(response.status()).toBe(403);
      }

      for (const context of [viewer, outsider, reviewer]) {
        const response = await context.delete("/api/referrals/1", {
          data: { if_match: 1 },
        });
        expect(response.status()).toBe(403);
      }

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

  test("limits personal calendar events, queues and roster to the signed-in account", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const actorKeys = ["admin", "assessmentCoordinator", "assessorA", "assessorB", "viewer"] as const;
    const contexts = await Promise.all(actorKeys.map((key) => actorApiContext(key, url)));
    const [admin, coordinator, assessorA, assessorB, viewer] = contexts;
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    const calendarPath = `/api/calendar/events?from=${from}&to=${to}`;

    try {
      for (const context of contexts) expect((await context.get("/api/members")).status()).toBe(200);
      const referrals: OperationalReferral[] = [];
      for (const [key, name] of [["assessorA", "Taylor Rivera"], ["assessorB", "Morgan Bennett"]] as const) {
        referrals.push(await createOperationalReferral(coordinator, key, {
          name, date: today, community: "San Pablo", phone: "555-0100",
        }, { assigneeId: pipelineActors[key].id }));
      }
      const [referralA, referralB] = referrals;
      for (const [context, own, other, actor, otherActor] of [
        [assessorA, referralA, referralB, pipelineActors.assessorA, pipelineActors.assessorB],
        [assessorB, referralB, referralA, pipelineActors.assessorB, pipelineActors.assessorA],
      ] as const) {
        const response = await context.get(calendarPath);
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.scope).toBe("personal");
        expect(body.events).toEqual(expect.arrayContaining([
          expect.objectContaining({ referralId: own.id, kind: "referral_assigned" }),
        ]));
        expect(body.events.every((event: { referralId: number }) => event.referralId !== other.id)).toBe(true);
        expect(body.unscheduled).toEqual(expect.arrayContaining([expect.objectContaining({ referralId: own.id })]));
        expect(body.unscheduled.every((item: { referralId: number }) => item.referralId !== other.id)).toBe(true);
        expect(body.assessors).toEqual([{ id: actor.id, name: actor.name }]);

        const filtered = await context.get(`${calendarPath}&queue_owner=id:${otherActor.id}&queue_mine=false`);
        expect(filtered.status()).toBe(200);
        const filteredBody = await filtered.json();
        expect(filteredBody.scope).toBe("personal");
        expect(filteredBody.unscheduled).toEqual([]);
        expect(filteredBody.unscheduledTotal).toBe(0);
        expect(filteredBody.unscheduledHasMore).toBe(false);
        expect(filteredBody.events).toEqual(body.events);
      }
      const viewerResponse = await viewer.get(`${calendarPath}&queue_mine=false&queue_limit=1`);
      expect(viewerResponse.status()).toBe(200);
      expect(await viewerResponse.json()).toEqual(expect.objectContaining({
        scope: "personal", events: [], unscheduled: [], unscheduledTotal: 0,
        unscheduledHasMore: false, assessors: [],
      }));
      for (const context of [admin, coordinator]) {
        const response = await context.get(calendarPath);
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.scope).toBe("team");
        for (const referral of referrals) {
          expect(body.events).toEqual(expect.arrayContaining([expect.objectContaining({ referralId: referral.id })]));
          expect(body.unscheduled).toEqual(expect.arrayContaining([expect.objectContaining({ referralId: referral.id })]));
        }
        expect(body.assessors).toEqual(expect.arrayContaining([
          { id: pipelineActors.assessorA.id, name: pipelineActors.assessorA.name },
          { id: pipelineActors.assessorB.id, name: pipelineActors.assessorB.name },
        ]));
      }
      for (const [context, referral] of [[assessorA, referralA], [assessorB, referralB]] as const) {
        await scheduleOperationalAssessment(context, await createOperationalAssessment(context, referral.id));
      }
      for (const [context, visibleIds, scope] of [
        [assessorA, [referralA.id], "personal"],
        [assessorB, [referralB.id], "personal"],
        [viewer, [], "personal"],
        [admin, referrals.map((referral) => referral.id), "team"],
        [coordinator, referrals.map((referral) => referral.id), "team"],
      ] as const) {
        const response = await context.get(calendarPath);
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.scope).toBe(scope);
        const fixtureAppointments = body.events.filter((event: { kind: string; referralId: number }) =>
          event.kind === "assessment" && referrals.some((referral) => referral.id === event.referralId));
        expect(fixtureAppointments.map((event: { referralId: number }) => event.referralId).sort()).toEqual([...visibleIds].sort());
      }
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  });

  test("scopes home and calendars while reserving reports for supervisors", async ({ baseURL }) => {
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
      expect(assessorReports.status()).toBe(403);

      const assessorExport = await assessor.post("/api/operations/reports", {
        data: { report_id: "workspace_inventory", month: "2026-09", community: "", owner: "" },
      });
      expect(assessorExport.status()).toBe(403);

      const coordinatorReport = await coordinator.get("/api/operations/reports?report_id=workspace_inventory&month=2026-09");
      expect(coordinatorReport.status()).toBe(200);

      const coordinatorExceptions = await coordinator.get("/api/operations/reports?report_id=supervisor_exceptions&month=2026-09");
      expect(coordinatorExceptions.status()).toBe(200);
    } finally {
      await Promise.all([assessor.dispose(), coordinator.dispose()]);
    }
  });

  test("hides reports and rejects the direct report route for assessors", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const assessor = await actorPage(browser, "assessorA", url);
    const coordinator = await actorPage(browser, "assessmentCoordinator", url);
    let assessorReportRequests = 0;
    assessor.page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/operations/reports") assessorReportRequests += 1;
    });

    try {
      await assessor.page.goto("/");
      await expect(assessor.page.getByRole("button", { name: "Open reports" })).toHaveCount(0);

      await assessor.page.goto("/?screen=operations");
      await expect.poll(() => new URL(assessor.page.url()).searchParams.get("screen")).toBeNull();
      await expect(assessor.page.getByRole("main", { name: "Reports" })).toHaveCount(0);
      expect(assessorReportRequests).toBe(0);

      await coordinator.page.goto("/");
      await expect(coordinator.page.getByRole("button", { name: "Open reports" })).toBeVisible();
    } finally {
      await Promise.all([assessor.context.close(), coordinator.context.close()]);
    }
  });
});
