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

  test("approved staff share mutation access while outsiders cannot read or change records", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const viewer = await actorApiContext("viewer", url);
    const outsider = await actorApiContext("outsider", url);
    const reviewer = await actorApiContext("assessorA", url);
    try {
      const created = await viewer.post("/api/referrals", { data: {
        client_mutation_id: operationalMutationId("viewer-create"), referral: syntheticReferralInput("viewer", { owner: "Unassigned" }),
      } });
      expect(created.status()).toBe(201);
      const original = (await created.json()).referral;
      const updated = await reviewer.patch('/api/referrals/' + original.id, { data: {
        if_match: original.version, if_match_sections: original.sectionVersions, patch: { phone: "555-0123" },
      } });
      expect(updated.status()).toBe(200);
      const current = (await updated.json()).referral;
      const before = await (await viewer.get('/api/referrals/' + original.id + '/activity')).json();
      const denied = await Promise.all([
        outsider.get('/api/referrals/' + original.id),
        outsider.put('/api/referrals/' + original.id + '/decision', { data: { if_match: current.version, if_match_section: current.sectionVersions.decision, outcome: "accepted" } }),
        outsider.delete('/api/referrals/' + original.id, { data: { if_match: current.version } }),
        outsider.post('/api/referrals/' + original.id + '/assessment-review', { data: { action: "request_changes" } }),
      ]);
      expect(denied.map(response => response.status())).toEqual([403, 403, 403, 403]);
      expect(await (await viewer.get('/api/referrals/' + original.id + '/activity')).json()).toEqual(before);
      expect((await (await viewer.get('/api/referrals/' + original.id)).json()).referral).toEqual(current);
      const decided = await reviewer.put('/api/referrals/' + original.id + '/decision', { data: {
        if_match: current.version, if_match_section: current.sectionVersions.decision, outcome: "accepted", reason_code: "test", reason_note: "Synthetic shared staff decision.",
      } });
      expect(decided.status()).toBe(200);
      expect((await decided.json()).decision.outcome).toBe("accepted");
      const staleDelete = await viewer.delete('/api/referrals/' + original.id, { data: { if_match: original.version } });
      expect(staleDelete.status()).toBe(409);
    } finally { await Promise.all([viewer.dispose(), outsider.dispose(), reviewer.dispose()]); }
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
      expect(viewerQueue.status()).toBe(200);

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

  test("shares team appointments across approved staff while Mine filters only the scheduling queue", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const keys = ["admin", "assessmentCoordinator", "assessorA", "assessorB", "viewer"] as const;
    const contexts = await Promise.all(keys.map(key => actorApiContext(key, url)));
    const coordinator = contexts[1];
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const path = '/api/calendar/events?from=' + from + '&to=' + to;
    try {
      for (const context of contexts) expect((await context.get("/api/members")).status()).toBe(200);
      const referrals: OperationalReferral[] = [];
      for (const key of ["assessorA", "assessorB"] as const) {
        referrals.push(await createOperationalReferral(coordinator, key, { date: today, phone: "555-0100" }, { assigneeId: pipelineActors[key].id }));
      }
      for (const context of contexts) {
        expect((await context.get("/api/members")).status()).toBe(200);
        const result = await context.get(path);
        expect(result.status()).toBe(200);
        const body = await result.json();
        expect(body.scope).toBe("team");
        for (const referral of referrals) {
          expect(body.events).toEqual(expect.arrayContaining([expect.objectContaining({ referralId: referral.id, kind: "referral_assigned" })]));
          const queue = await context.get(path + '&queue_q=' + encodeURIComponent(referral.name!));
          expect(queue.status()).toBe(200);
          expect((await queue.json()).unscheduled).toEqual(expect.arrayContaining([expect.objectContaining({ referralId: referral.id })]));
        }
        expect(body.assessors).toEqual(expect.arrayContaining([
          { id: pipelineActors.assessorA.id, name: pipelineActors.assessorA.name },
          { id: pipelineActors.assessorB.id, name: pipelineActors.assessorB.name },
        ]));
      }
      for (const [index, key] of [[2, "assessorA"], [3, "assessorB"]] as const) {
        const other = key === "assessorA" ? "assessorB" : "assessorA";
        const mine = await contexts[index].get(path + '&queue_mine=true');
        expect(mine.status()).toBe(200);
        const mineBody = await mine.json();
        expect(mineBody.scope).toBe("team");
        expect(mineBody.unscheduled.length).toBeGreaterThan(0);
        expect(mineBody.unscheduled.every((item: { ownerId: string }) => item.ownerId === pipelineActors[key].id)).toBe(true);
        const filtered = await contexts[index].get(path + '&queue_owner=id:' + pipelineActors[other].id);
        expect(filtered.status()).toBe(200);
        const otherBody = await filtered.json();
        expect(otherBody.unscheduled.length).toBeGreaterThan(0);
        expect(otherBody.unscheduled.every((item: { ownerId: string }) => item.ownerId === pipelineActors[other].id)).toBe(true);
        expect(mineBody.events).toEqual(otherBody.events);
      }
      for (const [context, referral] of [[contexts[2], referrals[0]], [contexts[3], referrals[1]]] as const) {
        await scheduleOperationalAssessment(context, await createOperationalAssessment(context, referral.id));
      }
      for (const context of contexts) {
        const result = await context.get(path);
        expect(result.status()).toBe(200);
        const body = await result.json();
        const appointments = body.events.filter((event: { kind: string; referralId: number }) => event.kind === "assessment" && referrals.some(referral => referral.id === event.referralId));
        expect(appointments.map((event: { referralId: number }) => event.referralId).sort()).toEqual(referrals.map(referral => referral.id).sort());
      }
    } finally { await Promise.all(contexts.map(context => context.dispose())); }
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
        scope: "personal",
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
      expect(await assessorCalendar.json()).toEqual(expect.objectContaining({ scope: "team" }));
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
