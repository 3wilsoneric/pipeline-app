import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Browser,
  type TestInfo,
} from "@playwright/test";

import {
  operationalHeadersForActor,
  operationalLoadActors,
  requireOperationalBaseURL,
  syntheticPipelineActor,
  type PipelineActor,
} from "../support/pipeline-actors";
import {
  asReferralPayload,
  asRecord,
  createOperationalAssessment,
  createOperationalReferral,
  markOperationalPacketReviewed,
  scheduleOperationalAssessment,
  startOperationalAssessment,
  transitionOperationalReferral,
} from "../support/operational-api";
import {
  createProductDemoScenario,
  productDemoCaseInput,
  productDemoCommunities,
  productDemoStages,
  type ProductDemoActor,
  type ProductDemoCase,
} from "../support/product-demo-scenario";

test.describe("high-assurance 10x traffic scaffold", () => {
  test.skip(
    process.env.PIPELINE_HIGH_ASSURANCE_E2E !== "true",
    "Run with PIPELINE_HIGH_ASSURANCE_E2E=true after workflow endpoints are stable.",
  );

  test("keeps core read endpoints bounded for a 10x synthetic account cohort", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const actors = operationalLoadActors(100);
    const month = new Date().toISOString().slice(0, 7);
    const routes = [
      "/api/referrals?limit=50&active=true",
      "/api/referrals/directory?limit=50&workspace=all",
      "/api/referrals/facets",
      "/api/operations/overview",
      `/api/operations/dashboard?month=${month}`,
      "/api/operations/my-queue",
      "/api/operations/referral-worklist",
      "/api/search?scope=local&q=San%20Pablo",
      "/api/calendar/events?start=2026-08-01&end=2026-08-31",
      "/api/files?limit=50",
    ];

    const readMissions = actors.flatMap((actor, index) => (
      routes.map((routePath) => ({ actor, index, routePath }))
    ));
    const responses = await runWithConcurrency(readMissions, 50, async ({ actor, index, routePath }) => {
      const context = await request.newContext({
        baseURL: url,
        extraHTTPHeaders: operationalHeadersForActor(actor, url),
      });
      try {
        const response = await context.get(routePath);
        const body = await response.body();
        return {
          actor: index,
          routePath,
          status: response.status(),
          headers: response.headers(),
          bytes: body.byteLength,
        };
      } finally {
        await context.dispose();
      }
    });

    const failures = responses.filter((response) => response.status >= 500 || response.status === 0);
    expect(failures).toEqual([]);
    for (const response of responses) {
      expect(response.status, response.routePath).toBeLessThan(400);
      expect(response.headers["x-request-id"], response.routePath).toMatch(/^[0-9a-f-]{36}$/i);
      expect(response.headers["cache-control"], response.routePath).toContain("no-store");
      expect(response.bytes, response.routePath).toBeLessThan(750_000);
    }
  });

  test("rehearses a 100-user product day from intake through active assessment work", async ({ baseURL, browser }, testInfo) => {
    const url = requireOperationalBaseURL(baseURL);
    const scenario = createProductDemoScenario();
    const contexts = await Promise.all(scenario.actors.map(({ actor }) => (
      request.newContext({
        baseURL: url,
        extraHTTPHeaders: operationalHeadersForActor(actor, url),
      })
    )));
    const contextByActor = new Map(scenario.actors.map(({ actor }, index) => {
      const context = contexts[index];
      if (!context) throw new Error(`Missing product demo context at index ${index}.`);
      return [actor.id, context] as const;
    }));

    try {
      const registrations = await runWithConcurrency(scenario.actors, 40, async ({ actor }) => {
        const context = requiredContext(contextByActor, actor.id);
        const response = await context.get("/api/members");
        return { actorId: actor.id, status: response.status() };
      });
      expect(registrations.every(({ status }) => status === 200)).toBe(true);

      const admin = requiredContext(contextByActor, scenario.operationsLeads[0]?.id);
      const dashboardBaseline = await readDashboardSnapshot(admin, scenario.months[0]);
      const viewer = requiredContext(contextByActor, scenario.executiveViewers[0]?.id);
      const viewerCreateAttempt = await viewer.post("/api/referrals", {
        data: {
          client_mutation_id: `${scenario.version}-viewer-mutation-denial`,
          referral: productDemoCaseInput(requiredCase(scenario.cases, 0)),
        },
      });
      expect(viewerCreateAttempt.status()).toBe(403);

      const created = await runWithConcurrency(scenario.cases, 20, async (item) => {
        const context = requiredContext(contextByActor, item.creator.id);
        const referral = await createOperationalReferral(
          context,
          item.creator,
          productDemoCaseInput(item),
          {
            assigneeId: item.assessor.id,
            mutationId: `${scenario.version}-referral-${String(item.sequence).padStart(3, "0")}`,
          },
        );
        return { item, referral };
      });
      expect(new Set(created.map(({ referral }) => referral.id)).size).toBe(scenario.cases.length);

      const progressed = await runWithConcurrency(created, 20, async ({ item, referral }) => ({
        item,
        referral: await progressProductDemoReferral(
          requiredContext(contextByActor, item.creator.id),
          referral,
          item.targetStage,
        ),
      }));

      const assessmentCases = progressed.filter(({ item }) => item.openAssessment);
      const assessments = await runWithConcurrency(assessmentCases, 8, async ({ item, referral }) => {
        const context = requiredContext(contextByActor, item.assessor.id);
        const createdAssessment = await createOperationalAssessment(context, referral.id);
        const scheduledAssessment = await scheduleOperationalAssessment(context, createdAssessment);
        const assessment = item.startAssessment
          ? await startOperationalAssessment(context, scheduledAssessment)
          : scheduledAssessment;
        return { item, referral, assessment };
      });
      expect(assessments).toHaveLength(scenario.cases.filter(({ openAssessment }) => openAssessment).length);

      const reportMissions = scenario.actors.flatMap((actorEntry, actorIndex) => (
        productDemoReportRoutes(actorEntry, scenario.months).map((routePath) => ({ actorEntry, actorIndex, routePath }))
      ));
      const reportResponses = await runWithConcurrency(reportMissions, 40, async ({ actorEntry, actorIndex, routePath }) => {
        const context = requiredContext(contextByActor, actorEntry.actor.id);
        const startedAt = performance.now();
        const response = await context.get(routePath);
        const body = await response.body();
        return {
          actor: actorIndex,
          persona: actorEntry.persona,
          routePath,
          status: response.status(),
          requestId: response.headers()["x-request-id"],
          cacheControl: response.headers()["cache-control"],
          bytes: body.byteLength,
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        };
      });

      const failures = reportResponses.filter((response) => response.status >= 500 || response.status === 0);
      expect(failures).toEqual([]);
      for (const response of reportResponses) {
        expect(response.status, response.routePath).toBeLessThan(400);
        expect(response.requestId, response.routePath).toMatch(/^[0-9a-f-]{36}$/i);
        expect(response.cacheControl, response.routePath).toContain("no-store");
        expect(response.bytes, response.routePath).toBeLessThan(750_000);
      }

      const reconciliation = await reconcileProductDemo(admin, scenario.cases, scenario.months, dashboardBaseline);
      const queueTotals = await runWithConcurrency(scenario.assessors, 20, async (actor) => {
        const response = await requiredContext(contextByActor, actor.id).get("/api/operations/my-queue");
        expect(response.status()).toBe(200);
        return Number(asRecord(await response.json()).total ?? 0);
      });
      expect(queueTotals.every((total) => total >= 1)).toBe(true);

      const durations = reportResponses.map(({ durationMs }) => durationMs).sort((left, right) => left - right);
      const p95Ms = percentile(durations, 0.95);
      expect(p95Ms).toBeLessThan(5_000);
      const uiEvidence = await verifyProductDemoSurfaces(
        browser,
        url,
        requiredActor(scenario.operationsLeads, 0),
        testInfo,
        reconciliation.active_total,
      );
      await testInfo.attach("100-user-product-demo-summary", {
        body: Buffer.from(JSON.stringify({
          scenario: scenario.version,
          non_phi: scenario.nonPhi,
          users: countBy(scenario.actors, ({ persona }) => persona),
          referrals: scenario.cases.length,
          communities: countBy(scenario.cases, ({ community }) => community),
          months: countBy(scenario.cases, ({ month: caseMonth }) => caseMonth),
          stages: countBy(scenario.cases, ({ targetStage }) => targetStage),
          priorities: countBy(scenario.cases, ({ priority }) => priority),
          assessments_opened: assessments.length,
          assessments_started: assessments.filter(({ item }) => item.startAssessment).length,
          report_requests: reportResponses.length,
          report_p95_ms: p95Ms,
          report_max_ms: durations.at(-1) ?? 0,
          viewer_mutation_status: viewerCreateAttempt.status(),
          ui_surfaces: uiEvidence,
          reconciliation,
        }, null, 2)),
        contentType: "application/json",
      });
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  });

  test("deduplicates retried referral creates under retry pressure", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = syntheticPipelineActor("assessment_coordinator", 901);
    const contexts = await Promise.all(Array.from({ length: 12 }, () => (
      request.newContext({
        baseURL: url,
        extraHTTPHeaders: operationalHeadersForActor(coordinator, url),
      })
    )));
    const mutationId = `capacity-retry-${Date.now()}`;
    const referral = {
      name: "Capacity Retry Referral",
      date: new Date().toISOString().slice(0, 10),
      stage: "New",
      community: "San Pablo",
      source: "Operational certification",
      priority: "standard",
      tags: ["operational-certification", "retry-pressure"],
      documentName: "retry-packet.pdf",
      documentStatus: "Uploaded",
      owner: coordinator.name,
      note: "Synthetic retried create. Contains no PHI.",
      createdAt: new Date().toISOString(),
      dob: "1970-01-01",
      phone: "",
      email: "",
      payer: "",
      requirements: [],
    };

    try {
      const responses = await Promise.all(contexts.map((context) => (
        context.post("/api/referrals", {
          data: {
            client_mutation_id: mutationId,
            referral,
          },
        })
      )));
      expect(responses.every((response) => response.status() === 201)).toBe(true);

      const ids = new Set<number>();
      for (const response of responses) {
        ids.add(asReferralPayload(await response.json()).referral.id);
      }
      expect(ids.size).toBe(1);
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  });

  test("keeps assigned-assessor queues isolated under generated accounts", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const assessorA = syntheticPipelineActor("reviewer", 801);
    const assessorB = syntheticPipelineActor("reviewer", 802);
    const assessorAContext = await request.newContext({
      baseURL: url,
      extraHTTPHeaders: operationalHeadersForActor(assessorA, url),
    });
    const assessorBContext = await request.newContext({
      baseURL: url,
      extraHTTPHeaders: operationalHeadersForActor(assessorB, url),
    });

    try {
      const created = await createOperationalReferral(assessorAContext, assessorA);
      const ownRead = await assessorAContext.get(`/api/referrals/${created.id}`);
      expect(ownRead.status()).toBe(200);

      const otherRead = await assessorBContext.get(`/api/referrals/${created.id}`);
      expect(otherRead.status()).toBe(404);
    } finally {
      await Promise.all([
        assessorAContext.dispose(),
        assessorBContext.dispose(),
      ]);
    }
  });
});

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) break;
      results[index] = await worker(item, index);
    }
  }));
  return results;
}

async function verifyProductDemoSurfaces(
  browser: Browser,
  baseURL: string,
  actor: PipelineActor,
  testInfo: TestInfo,
  expectedActiveTotal: number,
) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: {
      ...operationalHeadersForActor(actor, baseURL),
      Accept: "text/html,application/xhtml+xml,application/json",
    },
  });
  const page = await context.newPage();
  const surfaces = [
    { name: "home", path: "/", mainLabel: undefined },
    { name: "referrals", path: "/?view=referrals", mainLabel: "Referral workspaces" },
    { name: "operations", path: "/?screen=operations", mainLabel: "Operations overview" },
  ] as const;
  const evidence: Array<{ name: string; status: number; horizontally_bounded: boolean }> = [];

  try {
    for (const surface of surfaces) {
      const response = await page.goto(surface.path, { waitUntil: "domcontentloaded" });
      expect(response, `${surface.name} should return a document response`).not.toBeNull();
      expect(response?.status(), surface.name).toBeLessThan(400);
      const main = surface.mainLabel
        ? page.getByRole("main", { name: surface.mainLabel })
        : page.locator("main").first();
      await expect(main, surface.name).toBeVisible({ timeout: 15_000 });
      if (surface.name === "home") {
        await expect(page.getByLabel("Loading home")).toHaveCount(0, { timeout: 15_000 });
      } else if (surface.name === "referrals") {
        await expect(page.getByRole("button", {
          name: "Open Synthetic Referral 001 referral workspace",
        })).toBeVisible({ timeout: 15_000 });
      } else {
        await expect(page.getByRole("region", { name: "Operations summary" })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(`${expectedActiveTotal} active referrals`, { exact: true })).toBeVisible();
      }
      await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
      const horizontallyBounded = await page.evaluate(() => (
        document.documentElement.scrollWidth <= window.innerWidth + 1
      ));
      expect(horizontallyBounded, `${surface.name} should not overflow the viewport`).toBe(true);
      evidence.push({
        name: surface.name,
        status: response?.status() ?? 0,
        horizontally_bounded: horizontallyBounded,
      });
    }
    await testInfo.attach("100-user-product-demo-operations", {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });
    return evidence;
  } finally {
    await context.close();
  }
}

async function progressProductDemoReferral(
  context: Parameters<typeof transitionOperationalReferral>[0],
  initial: Parameters<typeof transitionOperationalReferral>[1],
  targetStage: ProductDemoCase["targetStage"],
) {
  let referral = initial;
  if (targetStage === "New") return referral;
  referral = await transitionOperationalReferral(context, referral, "Packet Needed");
  if (targetStage === "Packet Needed") return referral;
  referral = await transitionOperationalReferral(context, referral, "Packet Review");
  if (targetStage === "Packet Review") return referral;
  referral = await markOperationalPacketReviewed(context, referral);
  return transitionOperationalReferral(context, referral, "Assessment");
}

function productDemoReportRoutes(actor: ProductDemoActor, months: string[]) {
  const currentMonth = months[0];
  const firstMonth = months.at(-1);
  if (!currentMonth || !firstMonth) throw new Error("The product demo needs a reporting period.");
  const calendarRange = `start=${firstMonth}-01&end=${currentMonth}-28`;
  if (actor.persona === "operations_lead") {
    return [
      "/api/operations/overview",
      `/api/operations/dashboard?month=${currentMonth}`,
      "/api/operations/supervisor-queue",
      "/api/operations/referral-worklist",
      "/api/referrals/facets",
    ];
  }
  if (actor.persona === "intake_coordinator") {
    return [
      `/api/operations/dashboard?month=${currentMonth}`,
      "/api/operations/referral-worklist",
      "/api/referrals?limit=100&active=true&projection=summary",
      `/api/calendar/events?${calendarRange}`,
    ];
  }
  if (actor.persona === "assessor") {
    return [
      "/api/operations/my-queue",
      "/api/referrals?limit=25&active=true&projection=summary",
      `/api/calendar/events?${calendarRange}`,
    ];
  }
  return [
    "/api/operations/overview",
    "/api/referrals?limit=100&active=true&projection=summary",
    `/api/calendar/events?${calendarRange}`,
  ];
}

async function reconcileProductDemo(
  admin: APIRequestContext,
  cases: ProductDemoCase[],
  months: string[],
  dashboardBaseline: DashboardSnapshot,
) {
  const listResponse = await admin.get("/api/referrals?limit=200&tag=product-demo&projection=summary");
  expect(listResponse.status()).toBe(200);
  const list = asRecord(await listResponse.json());
  const referrals = Array.isArray(list.referrals) ? list.referrals.map(asRecord) : [];
  expect(Number(list.total)).toBe(cases.length);
  expect(referrals).toHaveLength(cases.length);

  const actualCommunityCounts = countBy(referrals, (referral) => String(referral.community));
  const expectedCommunityCounts = countBy(cases, ({ community }) => community);
  for (const community of productDemoCommunities) {
    expect(actualCommunityCounts[community] ?? 0, community).toBe(expectedCommunityCounts[community] ?? 0);
  }

  const actualStageCounts = countBy(referrals, (referral) => String(referral.stage));
  const expectedStageCounts = countBy(cases, ({ targetStage }) => targetStage);
  for (const stage of productDemoStages) {
    expect(actualStageCounts[stage] ?? 0, stage).toBe(expectedStageCounts[stage] ?? 0);
  }

  for (const month of months) {
    const response = await admin.get(`/api/referrals?limit=200&tag=product-demo&month=${month}&projection=summary`);
    expect(response.status(), month).toBe(200);
    const body = asRecord(await response.json());
    expect(Number(body.total), month).toBe(cases.filter((item) => item.month === month).length);
  }

  const dashboard = await readDashboardSnapshot(admin, months[0]);
  expect(dashboard.active - dashboardBaseline.active).toBe(cases.length);
  for (const stage of productDemoStages) {
    const delta = (dashboard.stages[stage] ?? 0) - (dashboardBaseline.stages[stage] ?? 0);
    expect(delta, stage).toBe(expectedStageCounts[stage] ?? 0);
  }

  return {
    referral_total: Number(list.total),
    active_total: dashboard.active,
    active_baseline: dashboardBaseline.active,
    active_delta: dashboard.active - dashboardBaseline.active,
    community_counts: actualCommunityCounts,
    stage_counts: actualStageCounts,
    month_counts: countBy(cases, ({ month }) => month),
  };
}

type DashboardSnapshot = {
  active: number;
  stages: Record<string, number>;
};

async function readDashboardSnapshot(admin: APIRequestContext, month: string): Promise<DashboardSnapshot> {
  const response = await admin.get(`/api/operations/dashboard?month=${month}`);
  expect(response.status()).toBe(200);
  const dashboard = asRecord(await response.json());
  const snapshot = asRecord(dashboard.snapshot);
  const metrics = asRecord(snapshot.metrics);
  const funnel = Array.isArray(snapshot.funnel) ? snapshot.funnel.map(asRecord) : [];
  return {
    active: Number(metrics.active ?? 0),
    stages: Object.fromEntries(funnel.map((item) => [String(item.stage), Number(item.count ?? 0)])),
  };
}

function requiredContext<T>(contexts: Map<string, T>, actorId: string | undefined): T {
  if (!actorId) throw new Error("A product demo actor id is required.");
  const context = contexts.get(actorId);
  if (!context) throw new Error(`Missing product demo context for ${actorId}.`);
  return context;
}

function requiredActor<T>(items: T[], index: number): T {
  const item = items[index];
  if (!item) throw new Error(`Missing product demo actor at index ${index}.`);
  return item;
}

function requiredCase(items: ProductDemoCase[], index: number): ProductDemoCase {
  const item = items[index];
  if (!item) throw new Error(`Missing product demo case at index ${index}.`);
  return item;
}

function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function percentile(sortedValues: number[], percentileValue: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * percentileValue) - 1);
  return sortedValues[index] ?? 0;
}
