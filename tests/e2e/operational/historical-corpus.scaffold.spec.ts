import { expect, request, test, type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  operationalHeadersForActor,
  requireOperationalBaseURL,
  type PipelineActor,
} from "../support/pipeline-actors";
import {
  asAssessmentPayload,
  asReferralPayload,
  asRecord,
  asUploadReservation,
  createOperationalAssessment,
  markOperationalPacketReviewed,
  mutateOperationalEhrHandoff,
  readOperationalReferral,
  resolveOperationalMoveInRequirements,
  signOperationalAssessment,
  startOperationalAssessment,
  transitionOperationalReferral,
  type OperationalReferral,
} from "../support/operational-api";

type HistoricalRole = "admin" | "assessment_coordinator" | "reviewer" | "viewer";
type HistoricalActor = PipelineActor & { role: HistoricalRole };

type HistoricalMaterial = {
  material_id: string;
  source_file_name: string;
  source_content_type: string;
  source_byte_size: number;
  source_sha256: string | null;
  document_category: string;
  disposition: "upload" | "unsupported_type" | "over_limit" | "below_local_minimum" | "invalid_descriptor" | "missing_source";
  expected_api_status: number | null;
  expected_rejection_stage: "reservation" | "local_upload";
  object_relpath: string | null;
};

type HistoricalCase = {
  sequence: number;
  case_id: string;
  display_name: string;
  community: string;
  assigned_actor_id: string;
  assigned_owner_name: string;
  behavior: string;
  primary_material_id: string | null;
  profile_candidate: Record<string, unknown> | null;
  timeline: Record<string, string>;
  materials: HistoricalMaterial[];
};

type HistoricalPlan = {
  version: number;
  kind: string;
  simulation_id: string;
  supervisor: { actor_id: string };
  actors: Array<{
    actor_id: string;
    display_name: string;
    email: string;
    role: HistoricalRole;
  }>;
  cases: HistoricalCase[];
};

type TruthCase = {
  case_id: string;
  assessment_data: Record<string, unknown>;
  recommendation: { outcome: string; reason_code?: string; reason_note?: string };
  supervisor_decision: { outcome: string; reason_code?: string; reason_note?: string };
};

type CreatedCase = {
  item: HistoricalCase;
  referralInput: Record<string, unknown>;
  referral: OperationalReferral;
  mutationId: string;
};

type HistoricalChaosPlan = {
  policy_version: string;
  simulation_id: string;
  phase: "files" | "full";
  seed?: string;
  concurrency: { identities: number; referrals: number; files: number; workflow: number; reads: number; browsers: number };
  read_repetitions: number;
  cohorts: {
    all_case_ids: string[];
    stale_write_case_ids: string[];
    decision_race_case_ids: string[];
    handoff_recovery_case_ids: string[];
  };
  invariants: string[];
};

type ChaosExtremeVirtualUser = {
  virtual_user_id: string;
  principal: { id: string; email: string; display_name: string };
  role: HistoricalRole;
  device: { id: string; viewport: { width: number; height: number }; tab_count: number };
  network: { id: string; disconnect_every: number; duplicate_every: number; timeout_every: number };
  clock: { timezone: string; skew_ms: number };
};

type ChaosExtremeStep = {
  step: number;
  tick: number;
  tab: number;
  action: string;
  target_case_id?: string;
  expected_access: "owner" | "not_found" | "read_only" | "read_write";
  inject_disconnect: boolean;
  inject_duplicate: boolean;
  inject_timeout: boolean;
};

type HistoricalChaosExtremePlan = HistoricalChaosPlan & {
  virtual_user_count: number;
  unique_principal_count: number;
  control_principals: { supervisor_virtual_user_id: string; recovery_virtual_user_id: string };
  virtual_users: ChaosExtremeVirtualUser[];
  case_assignments: Array<{ case_id: string; source_owner_actor_id: string; virtual_user_id: string }>;
  scripts: Array<{ virtual_user_id: string; assigned_case_count: number; steps: ChaosExtremeStep[] }>;
};

type ChaosEvidence = {
  duplicate_replays: number;
  read_while_write_requests: number;
  stale_assessment_conflicts: number;
  supervisor_decision_conflicts: number;
  ehr_failure_recoveries: number;
  virtual_machine_requests: number;
  virtual_machine_expected_rejections: number;
  virtual_machine_disconnects: number;
  virtual_machine_timeouts: number;
  virtual_machine_duplicates: number;
  backpressure_retries: number;
};

test.describe("private historical multi-user simulation", () => {
  test.skip(
    process.env.PIPELINE_HISTORICAL_SIMULATION !== "true",
    "Run only through scripts/run-historical-simulation.mjs against a materialized private corpus.",
  );

  test("replays the selected real-file cohort through isolated Pipeline workflows", async ({ baseURL, browser }, testInfo) => {
    test.setTimeout(6 * 60 * 60 * 1_000);
    const url = requireOperationalBaseURL(baseURL);
    const manifestPath = requiredEnvironmentPath("PIPELINE_HISTORICAL_SIMULATION_MANIFEST");
    const corpusRoot = path.dirname(manifestPath);
    const sourcePlan = JSON.parse(await readFile(manifestPath, "utf8")) as HistoricalPlan;
    const phase = process.env.PIPELINE_HISTORICAL_SIMULATION_PHASE === "full" ? "full" : "files";
    const mode = process.env.PIPELINE_HISTORICAL_SIMULATION_MODE ?? "busy_day";
    const { chaosPlan, extremePlan, plan } = await resolveHistoricalPlans(mode, sourcePlan, phase);
    const truthByCase = phase === "full"
      ? await loadTruthCases(requiredEnvironmentPath("PIPELINE_HISTORICAL_TRUTH_PACKS"))
      : new Map<string, TruthCase>();
    const actors = plan.actors.map(simulationActor);
    const contextEntries = await Promise.all(actors.map(async (actor) => [
      actor.id,
      await request.newContext({
        baseURL: url,
        extraHTTPHeaders: operationalHeadersForActor(actor, url),
      }),
    ] as const));
    const contexts = new Map(contextEntries);
    const supervisor = requiredContext(contexts, plan.supervisor.actor_id);
    const concurrency = chaosPlan?.concurrency ?? concurrencyForMode(mode);
    const chaosEvidence: ChaosEvidence = {
      duplicate_replays: 0,
      read_while_write_requests: 0,
      stale_assessment_conflicts: 0,
      supervisor_decision_conflicts: 0,
      ehr_failure_recoveries: 0,
      virtual_machine_requests: 0,
      virtual_machine_expected_rejections: 0,
      virtual_machine_disconnects: 0,
      virtual_machine_timeouts: 0,
      virtual_machine_duplicates: 0,
      backpressure_retries: 0,
    };
    const startedAt = performance.now();

    try {
      const registrations = await runWithConcurrency(actors, identityConcurrency(chaosPlan, actors.length), async (actor) => {
        const response = await requiredContext(contexts, actor.id).get("/api/members");
        return response.status();
      });
      expect(registrations.every((status) => status === 200)).toBe(true);

      const created = await runWithConcurrency(plan.cases, concurrency.referrals, async (item) => {
        const mutationId = `${plan.simulation_id}:${item.case_id}:create`;
        const referralInput = historicalReferralInput(plan.simulation_id, item);
        const response = await withBackpressureRetry(() => supervisor.post("/api/referrals", {
          data: {
            client_mutation_id: mutationId,
            referral: referralInput,
            assignee_id: item.assigned_actor_id,
          },
        }), `${item.case_id}:create`, chaosEvidence);
        const bodyText = await response.text();
        expect(response.status(), bodyText.slice(0, 1_000)).toBe(201);
        return { item, referralInput, mutationId, referral: asReferralPayload(JSON.parse(bodyText)).referral };
      });
      expect(new Set(created.map(({ referral }) => referral.id)).size).toBe(plan.cases.length);

      const duplicateCases = chaosPlan ? created : created.filter(({ item }) => item.behavior === "duplicate_retry");
      const duplicateIds = await runWithConcurrency(duplicateCases, concurrency.referrals, async (createdCase) => {
        const response = await withBackpressureRetry(() => supervisor.post("/api/referrals", {
          data: {
            client_mutation_id: createdCase.mutationId,
            referral: createdCase.referralInput,
            assignee_id: createdCase.item.assigned_actor_id,
          },
        }), `${createdCase.item.case_id}:duplicate`, chaosEvidence);
        expect(response.status()).toBe(201);
        return asReferralPayload(await response.json()).referral.id;
      });
      expect(duplicateIds).toEqual(duplicateCases.map(({ referral }) => referral.id));
      chaosEvidence.duplicate_replays = duplicateIds.length;

      const uploaded = await runWithConcurrency(created, concurrency.files, async (createdCase) => {
        const owner = requiredContext(contexts, createdCase.item.assigned_actor_id);
        const primary = createdCase.item.materials.find((material) => material.material_id === createdCase.item.primary_material_id);
        const ordered = [
          ...(primary ? [primary] : []),
          ...createdCase.item.materials.filter((material) => material !== primary),
        ];
        const evidence = {
          uploaded: 0,
          uploadedBytes: 0,
          rejected: 0,
          missing: 0,
          primaryPacketId: "",
          documentIds: [] as string[],
        };
        for (const material of ordered) {
          if (material.disposition === "missing_source") {
            evidence.missing += 1;
            continue;
          }
          if (material.disposition !== "upload") {
            await expectRejectedDescriptor(owner, corpusRoot, createdCase.referral.id, createdCase.item.community, material, chaosEvidence);
            evidence.rejected += 1;
            continue;
          }
          const uploadedFile = await uploadMaterial({
            context: owner,
            corpusRoot,
            referralId: createdCase.referral.id,
            community: createdCase.item.community,
            material,
            extract: material === primary,
            retryEvidence: chaosEvidence,
          });
          evidence.uploaded += 1;
          evidence.uploadedBytes += material.source_byte_size;
          evidence.documentIds.push(...uploadedFile.documentIds);
          if (material === primary) evidence.primaryPacketId = uploadedFile.packetId;
        }
        return { ...createdCase, evidence };
      });

      const progressed = await runWithConcurrency(uploaded, concurrency.workflow, async (createdCase) => {
        const owner = requiredContext(contexts, createdCase.item.assigned_actor_id);
        let referral = await transitionOperationalReferral(owner, createdCase.referral, "Packet Needed");
        referral = await transitionOperationalReferral(owner, referral, "Packet Review");
        referral = await markOperationalPacketReviewed(owner, referral, createdCase.evidence.primaryPacketId || undefined);
        referral = await transitionOperationalReferral(owner, referral, "Assessment");
        return { ...createdCase, referral };
      });

      const reviewerActors = actors.filter((actor) => actor.role === "reviewer");
      const isolationStatuses = await runWithConcurrency(progressed, concurrency.reads, async (createdCase) => {
        const unrelated = reviewerActors.find((actor) => actor.id !== createdCase.item.assigned_actor_id);
        if (!unrelated) return 404;
        const response = await requiredContext(contexts, unrelated.id).get(`/api/referrals/${createdCase.referral.id}`);
        return response.status();
      });
      expect(isolationStatuses.every((status) => status === 404)).toBe(true);

      chaosEvidence.read_while_write_requests = await runChaosReadBurst(
        chaosPlan,
        progressed,
        contexts,
        concurrency.reads,
      );

      if (extremePlan) {
        const extremeEvidence = await runExtremeVirtualMachineStorm(extremePlan, progressed, contexts, url, concurrency.reads);
        Object.assign(chaosEvidence, extremeEvidence);
      }

      const lifecycle = phase === "full"
        ? await runFullLifecycle(
          progressed,
          contexts,
          supervisor,
          truthByCase,
          conflictFreeScheduleTimes(progressed.map(({ item }) => item)),
          concurrency.workflow,
          chaosPlan,
          chaosEvidence,
        )
        : [];

      assertChaosEvidence(chaosPlan, phase, plan.cases.length, lifecycle.length, chaosEvidence);

      const surfaceEvidence = await exerciseAllSurfaces(
        browser,
        url,
        plan,
        progressed,
        testInfo,
        surfaceConcurrency(chaosPlan),
        extremePlan,
      );
      const listResponse = await supervisor.get(`/api/referrals?limit=200&tag=${encodeURIComponent(plan.simulation_id)}&projection=summary`);
      expect(listResponse.status()).toBe(200);
      const list = asRecord(await listResponse.json());
      expect(Number(list.total)).toBe(plan.cases.length);
      const activityChecks = await runWithConcurrency(progressed, concurrency.reads, async ({ referral }) => {
        const response = await supervisor.get(`/api/referrals/${referral.id}/activity`);
        return response.status();
      });
      expect(activityChecks.every((status) => status === 200)).toBe(true);

      await persistSimulationSummary(testInfo, {
        simulation_id: plan.simulation_id,
        phase,
        mode,
        case_count: progressed.length,
        actor_count: actors.length,
        uploaded_material_count: uploaded.reduce((sum, item) => sum + item.evidence.uploaded, 0),
        uploaded_material_bytes: uploaded.reduce((sum, item) => sum + item.evidence.uploadedBytes, 0),
        expected_rejection_count: uploaded.reduce((sum, item) => sum + item.evidence.rejected, 0),
        missing_source_count: uploaded.reduce((sum, item) => sum + item.evidence.missing, 0),
        completed_lifecycle_count: lifecycle.length,
        surface_checks: surfaceEvidence,
        duration_ms: Math.round(performance.now() - startedAt),
        contains_names_or_source_paths: false,
        ...chaosCertificationSummary(chaosPlan, extremePlan, actors.length, chaosEvidence),
      });
      if (process.env.PIPELINE_HISTORICAL_INSPECT === "true") {
        await holdOpenForGodModeInspection(browser, url, plan);
      }
    } finally {
      await Promise.all([...contexts.values()].map((context) => context.dispose()));
    }
  });
});

async function persistSimulationSummary(testInfo: TestInfo, summary: Record<string, unknown>) {
  const body = `${JSON.stringify(summary, null, 2)}\n`;
  await writeFile(
    path.join(requiredEnvironmentPath("PIPELINE_HISTORICAL_RUN_ROOT"), "certification-summary.json"),
    body,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  await testInfo.attach("historical-simulation-summary", {
    body: Buffer.from(body),
    contentType: "application/json",
  });
}

async function holdOpenForGodModeInspection(browser: Browser, baseURL: string, plan: HistoricalPlan) {
  const administratorRecord = plan.actors.find((actor) => actor.actor_id === plan.supervisor.actor_id);
  if (!administratorRecord) throw new Error("Historical simulation supervisor is missing from the actor roster.");
  const administrator = simulationActor(administratorRecord);
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: {
      ...operationalHeadersForActor(administrator, baseURL),
      Accept: "text/html,application/xhtml+xml,application/json",
    },
  });
  const page = await context.newPage();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Open profile menu for / }).click();
  await page.getByRole("button", { name: /God mode/ }).click();
  await expect(page.getByRole("dialog", { name: "God mode" })).toBeVisible();
  await page.pause();
  await context.close();
}

async function runFullLifecycle(
  cases: Array<CreatedCase & { evidence: { primaryPacketId: string }; referral: OperationalReferral }>,
  contexts: Map<string, APIRequestContext>,
  supervisor: APIRequestContext,
  truthByCase: Map<string, TruthCase>,
  scheduleTimes: Map<string, string>,
  concurrency: number,
  chaosPlan: HistoricalChaosPlan | null,
  chaosEvidence: ChaosEvidence,
) {
  const staleWriteCases = new Set(chaosPlan?.cohorts.stale_write_case_ids ?? []);
  const decisionRaceCases = new Set(chaosPlan?.cohorts.decision_race_case_ids ?? []);
  const handoffRecoveryCases = new Set(chaosPlan?.cohorts.handoff_recovery_case_ids ?? []);
  return runWithConcurrency(cases, concurrency, async (createdCase) => {
    const truth = truthByCase.get(createdCase.item.case_id);
    if (!truth) throw new Error(`Missing verified truth pack for ${createdCase.item.case_id}.`);
    const owner = requiredContext(contexts, createdCase.item.assigned_actor_id);
    let assessment = await createOperationalAssessment(owner, createdCase.referral.id);
    const scheduledAt = scheduleTimes.get(createdCase.item.case_id);
    if (!scheduledAt) throw new Error(`Missing conflict-free schedule time for ${createdCase.item.case_id}.`);
    assessment = await scheduleHistoricalAssessment(owner, assessment, scheduledAt);
    if (createdCase.item.behavior === "reschedule_once") {
      assessment = await scheduleHistoricalAssessment(
        owner,
        assessment,
        addMinutes(scheduledAt, 15),
        "rescheduled",
      );
    }
    assessment = await startOperationalAssessment(owner, assessment);
    assessment = await exerciseChaosAssessmentConflict(
      staleWriteCases.has(createdCase.item.case_id),
      owner,
      assessment,
      createdCase.item.case_id,
      truth,
      chaosEvidence,
    );
    if (["interrupted_resume", "save_reopen"].includes(createdCase.item.behavior)) {
      const firstVerifiedField = Object.entries(truth.assessment_data)[0];
      if (!firstVerifiedField) throw new Error(`Verified assessment data is empty for ${createdCase.item.case_id}.`);
      const partialSave = await owner.patch(`/api/assessments/${assessment.assessment_id}`, {
        data: {
          if_match: assessment.version,
          client_mutation_id: `${createdCase.item.case_id}:interrupted-save`,
          patch: { data: { [firstVerifiedField[0]]: firstVerifiedField[1] } },
        },
      });
      const partialText = await partialSave.text();
      expect(partialSave.status(), partialText.slice(0, 1_000)).toBe(200);
      assessment = asAssessmentPayload(JSON.parse(partialText));
      const reopen = await owner.get(`/api/assessments/${assessment.assessment_id}`);
      expect(reopen.status()).toBe(200);
    }
    if (createdCase.item.behavior === "concurrent_reads") {
      const reads = await Promise.all([
        owner.get(`/api/assessments/${assessment.assessment_id}`),
        owner.get(`/api/referrals/${createdCase.referral.id}`),
      ]);
      expect(reads.every((response) => response.status() === 200)).toBe(true);
    }
    const completed = await owner.patch(`/api/assessments/${assessment.assessment_id}`, {
      data: {
        if_match: assessment.version,
        client_mutation_id: `${createdCase.item.case_id}:verified-assessment`,
        patch: { data: truth.assessment_data },
      },
    });
    const completedText = await completed.text();
    expect(completed.status(), completedText.slice(0, 1_000)).toBe(200);
    assessment = asAssessmentPayload(JSON.parse(completedText));
    assessment = await signOperationalAssessment(owner, assessment);

    let referral = await readOperationalReferral(owner, createdCase.referral.id);
    const recommendation = await owner.put(`/api/referrals/${referral.id}/recommendation`, {
      data: {
        if_match: referral.version,
        if_match_section: referral.sectionVersions.decision,
        assessment_id: assessment.assessment_id,
        ...truth.recommendation,
      },
    });
    const recommendationText = await recommendation.text();
    expect(recommendation.status(), recommendationText.slice(0, 1_000)).toBe(200);
    referral = asReferralPayload(JSON.parse(recommendationText)).referral;
    const decisionData = {
      if_match: referral.version,
      if_match_section: referral.sectionVersions.decision,
      ...truth.supervisor_decision,
    };
    referral = await recordChaosAwareDecision(
      decisionRaceCases.has(createdCase.item.case_id),
      supervisor,
      referral,
      decisionData,
      createdCase.item.case_id,
      chaosEvidence,
    );
    await resolveOperationalMoveInRequirements(supervisor, referral.id);
    referral = await readOperationalReferral(supervisor, referral.id);
    referral = await transitionOperationalReferral(supervisor, referral, "Accepted / Admitted");
    const sent = await exerciseChaosAwareHandoff(
      handoffRecoveryCases.has(createdCase.item.case_id),
      supervisor,
      referral,
      chaosEvidence,
    );
    expect(sent.response.status()).toBe(200);
    return { referral: sent.referral, assessment };
  });
}

async function scheduleHistoricalAssessment(
  context: APIRequestContext,
  assessment: { assessment_id: string; version: number },
  startAt: string,
  status: "scheduled" | "rescheduled" = "scheduled",
) {
  const response = await context.post(`/api/assessments/${assessment.assessment_id}/schedule`, {
    data: {
      if_match: assessment.version,
      client_mutation_id: `${assessment.assessment_id}:${status}`,
      schedule: {
        status,
        start_at: startAt,
        duration_minutes: 15,
        method: "record_review",
        location: "Historical simulation",
      },
    },
  });
  const text = await response.text();
  expect(response.status(), text.slice(0, 1_000)).toBe(200);
  return asAssessmentPayload(JSON.parse(text));
}

async function exerciseChaosAssessmentConflict(
  enabled: boolean,
  owner: APIRequestContext,
  assessment: { assessment_id: string; version: number },
  caseId: string,
  truth: TruthCase,
  evidence: ChaosEvidence,
) {
  if (!enabled) return assessment;
  const firstVerifiedField = Object.entries(truth.assessment_data)[0];
  if (!firstVerifiedField) throw new Error(`Verified assessment data is empty for ${caseId}.`);
  const race = (suffix: string) => owner.patch(`/api/assessments/${assessment.assessment_id}`, {
    data: {
      if_match: assessment.version,
      client_mutation_id: `${caseId}:stale-race:${suffix}`,
      patch: { data: { [firstVerifiedField[0]]: firstVerifiedField[1] } },
    },
  });
  const [left, right] = await Promise.all([race("left"), race("right")]);
  expect([left.status(), right.status()].sort()).toEqual([200, 409]);
  const winner = left.status() === 200 ? left : right;
  evidence.stale_assessment_conflicts += 1;
  return asAssessmentPayload(JSON.parse(await winner.text()));
}

async function recordChaosAwareDecision(
  raceEnabled: boolean,
  supervisor: APIRequestContext,
  referral: OperationalReferral,
  decisionData: Record<string, unknown>,
  caseId: string,
  evidence: ChaosEvidence,
) {
  if (raceEnabled) {
    const [left, right] = await Promise.all([
      supervisor.put(`/api/referrals/${referral.id}/decision`, { data: { ...decisionData, client_mutation_id: `${caseId}:decision:left` } }),
      supervisor.put(`/api/referrals/${referral.id}/decision`, { data: { ...decisionData, client_mutation_id: `${caseId}:decision:right` } }),
    ]);
    expect([left.status(), right.status()].sort()).toEqual([200, 409]);
    const winner = left.status() === 200 ? left : right;
    evidence.supervisor_decision_conflicts += 1;
    return asReferralPayload(JSON.parse(await winner.text())).referral;
  }
  const decision = await supervisor.put(`/api/referrals/${referral.id}/decision`, { data: decisionData });
  const decisionText = await decision.text();
  expect(decision.status(), decisionText.slice(0, 1_000)).toBe(200);
  return asReferralPayload(JSON.parse(decisionText)).referral;
}

async function exerciseChaosAwareHandoff(
  recoveryEnabled: boolean,
  supervisor: APIRequestContext,
  referral: OperationalReferral,
  evidence: ChaosEvidence,
) {
  const queued = await mutateOperationalEhrHandoff(supervisor, referral, "queue");
  expect(queued.response.status()).toBe(200);
  let current = queued.referral;
  if (recoveryEnabled) {
    const stale = await supervisor.post(`/api/referrals/${referral.id}/ehr-handoff`, {
      data: {
        if_match: referral.version,
        if_match_section: referral.sectionVersions.decision,
        action: "mark_sent",
      },
    });
    expect(stale.status()).toBe(409);
    const failed = await mutateOperationalEhrHandoff(
      supervisor,
      current,
      "mark_failed",
      "Synthetic chaos-lab downstream rejection. Contains no PHI.",
    );
    expect(failed.response.status()).toBe(200);
    const retried = await mutateOperationalEhrHandoff(supervisor, failed.referral, "retry");
    expect(retried.response.status()).toBe(200);
    current = retried.referral;
    evidence.ehr_failure_recoveries += 1;
  }
  const sent = await mutateOperationalEhrHandoff(supervisor, current, "mark_sent");
  expect(sent.response.status()).toBe(200);
  return sent;
}

async function uploadMaterial(input: {
  context: APIRequestContext;
  corpusRoot: string;
  referralId: number;
  community: string;
  material: HistoricalMaterial;
  extract: boolean;
  retryEvidence: ChaosEvidence;
}) {
  const fileId = input.material.material_id;
  const reservationResponse = await withBackpressureRetry(() => input.context.post("/api/uploads/create-url", {
    data: uploadReservationData(input.referralId, input.community, input.material, input.extract),
  }), `${fileId}:reserve`, input.retryEvidence);
  const reservationText = await reservationResponse.text();
  expect(reservationResponse.status(), reservationText.slice(0, 1_000)).toBe(200);
  const reservation = asUploadReservation(JSON.parse(reservationText));
  const objectPath = requiredObjectPath(input.corpusRoot, input.material);
  const bytes = await readFile(objectPath);
  const localResponse = await withBackpressureRetry(() => input.context.post("/api/uploads/local", {
    multipart: {
      packet_id: reservation.packet_id,
      file_id: fileId,
      file: {
        name: input.material.source_file_name,
        mimeType: input.material.source_content_type,
        buffer: bytes,
      },
    },
    timeout: 120_000,
  }), `${fileId}:upload`, input.retryEvidence);
  const localText = await localResponse.text();
  expect(localResponse.status(), localText.slice(0, 1_000)).toBe(200);
  const completion = await withBackpressureRetry(() => input.context.post("/api/uploads/complete", {
    data: { packet_id: reservation.packet_id, uploaded_file_ids: [fileId] },
  }), `${fileId}:complete`, input.retryEvidence);
  const completionText = await completion.text();
  expect(completion.status(), completionText.slice(0, 1_000)).toBe(200);
  const body = asRecord(JSON.parse(completionText));
  const documents = Array.isArray(body.documents) ? body.documents.map(asRecord) : [];
  return {
    packetId: reservation.packet_id,
    documentIds: documents.map((document) => String(document.document_id ?? "")).filter(Boolean),
  };
}

async function expectRejectedDescriptor(
  context: APIRequestContext,
  corpusRoot: string,
  referralId: number,
  community: string,
  material: HistoricalMaterial,
  retryEvidence: ChaosEvidence,
) {
  const response = await withBackpressureRetry(() => context.post("/api/uploads/create-url", {
    data: uploadReservationData(referralId, community, material, false),
  }), `${material.material_id}:reject-reserve`, retryEvidence);
  if (material.expected_rejection_stage === "reservation") {
    expect(response.status()).toBe(material.expected_api_status);
    return;
  }
  const responseText = await response.text();
  expect(response.status(), responseText.slice(0, 1_000)).toBe(200);
  const reservation = asUploadReservation(JSON.parse(responseText));
  const rejectedBytes = await readFile(requiredObjectPath(corpusRoot, material));
  const localResponse = await withBackpressureRetry(() => context.post("/api/uploads/local", {
    multipart: {
      packet_id: reservation.packet_id,
      file_id: material.material_id,
      file: {
        name: material.source_file_name,
        mimeType: material.source_content_type,
        buffer: rejectedBytes,
      },
    },
  }), `${material.material_id}:reject-upload`, retryEvidence);
  expect(localResponse.status()).toBe(material.expected_api_status);
}

function uploadReservationData(referralId: number, community: string, material: HistoricalMaterial, extract: boolean) {
  return {
    referral_id: String(referralId),
    submitting_facility: community,
    source_type: "manual",
    processing_intent: extract ? "extract_referral" : "preview_only",
    files: [{
      file_id: material.material_id,
      filename: material.source_file_name,
      content_type: material.source_content_type,
      size: material.source_byte_size,
      ...(material.source_sha256 ? { sha256: material.source_sha256 } : {}),
      category: material.document_category,
    }],
  };
}

async function exerciseAllSurfaces(
  browser: Browser,
  baseURL: string,
  plan: HistoricalPlan,
  cases: Array<CreatedCase & { referral: OperationalReferral }>,
  testInfo: TestInfo,
  concurrency: number,
  extremePlan: HistoricalChaosExtremePlan | null,
) {
  const caseByActor = new Map<string, typeof cases>();
  for (const item of cases) {
    const assigned = caseByActor.get(item.item.assigned_actor_id) ?? [];
    assigned.push(item);
    caseByActor.set(item.item.assigned_actor_id, assigned);
  }
  const actors = plan.actors.map(simulationActor);
  const virtualUsersByPrincipal = new Map((extremePlan?.virtual_users ?? []).map((user) => [user.principal.id, user]));
  const actorEvidence = await runWithConcurrency(actors, Math.min(concurrency, actors.length), async (actor) => {
    const virtualUser = virtualUsersByPrincipal.get(actor.id);
    const context = await createSurfaceContext(browser, baseURL, actor, virtualUser);
    const page = await context.newPage();
    const backgroundPages = await openBackgroundPages(context, virtualUser);
    let surfaceCount = 0;
    let guideLatencyMs = 0;
    try {
      for (const route of ["/", "/?view=referrals", "/?screen=calendar"]) {
        const response = await page.goto(route, { waitUntil: "domcontentloaded" });
        expect(response?.status(), route).toBeLessThan(400);
        await expect(page.locator("main").first()).toBeVisible({ timeout: 20_000 });
        surfaceCount += 1;
      }
      const guideStartedAt = Date.now();
      await page.locator('[data-pipeline-ready="guided-coach"]').waitFor({ state: "attached", timeout: 20_000 });
      await page.getByRole("button", { name: "Open guided tutorials" }).click();
      await expect(page.getByRole("dialog", { name: "Guided tutorial library" })).toBeVisible({ timeout: 20_000 });
      guideLatencyMs = Date.now() - guideStartedAt;
      await page.getByRole("button", { name: "Close guided tutorials" }).click();
      surfaceCount += 1;
      const adminEvidence = await exerciseAdminSurfaces(page, actor, plan, cases);
      surfaceCount += adminEvidence.surfaces;
      for (const createdCase of caseByActor.get(actor.id) ?? []) {
        const base = `/?view=referrals&screen=packet&referralId=${createdCase.referral.id}`;
        const response = await page.goto(base, { waitUntil: "domcontentloaded" });
        expect(response?.status()).toBeLessThan(400);
        await expect(page.getByTestId("packet-workspace")).toBeVisible({ timeout: 20_000 });
        await page.getByRole("button", { name: "Workspace files" }).click();
        await expect(page.getByRole("region", { name: "Files", exact: true })).toBeVisible({ timeout: 20_000 });
        await page.getByRole("button", { name: "Workspace activity" }).click();
        await expect(page.getByRole("region", { name: "Activity", exact: true })).toBeVisible({ timeout: 20_000 });
        for (const stage of ["assessment", "chart"]) {
          await page.goto(`${base}&workspaceStage=${stage}`, { waitUntil: "domcontentloaded" });
          await expect(page.getByTestId("packet-workspace")).toBeVisible({ timeout: 20_000 });
        }
        await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
        surfaceCount += 5;
      }
      surfaceCount += await exerciseOfflineRecovery(context, backgroundPages[0], virtualUser);
      surfaceCount += backgroundPages.length;
      return {
        role: actor.role,
        cases: caseByActor.get(actor.id)?.length ?? 0,
        surfaces: surfaceCount,
        tabs: backgroundPages.length + 1,
        guide_latency_ms: guideLatencyMs,
        network_recovery: isOfflineFlap(virtualUser),
        god_mode_profiles: adminEvidence.godModeProfiles,
      };
    } finally {
      await context.close();
    }
  });
  await testInfo.attach("historical-surface-coverage", {
    body: Buffer.from(JSON.stringify(actorEvidence, null, 2)),
    contentType: "application/json",
  });
  return actorEvidence;
}

async function createSurfaceContext(
  browser: Browser,
  baseURL: string,
  actor: HistoricalActor,
  virtualUser: ChaosExtremeVirtualUser | undefined,
) {
  return browser.newContext({
    baseURL,
    viewport: virtualUser?.device.viewport ?? { width: 1440, height: 900 },
    ...(virtualUser ? { timezoneId: virtualUser.clock.timezone } : {}),
    extraHTTPHeaders: {
      ...operationalHeadersForActor(actor, baseURL),
      Accept: "text/html,application/xhtml+xml,application/json",
    },
  });
}

async function openBackgroundPages(context: BrowserContext, virtualUser: ChaosExtremeVirtualUser | undefined) {
  const routes = ["/", "/?view=referrals", "/?screen=calendar"];
  const tabCount = virtualUser?.device.tab_count ?? 1;
  return Promise.all(Array.from({ length: Math.max(0, tabCount - 1) }, async (_value, index) => {
    const page = await context.newPage();
    await page.goto(routes[index % routes.length] ?? "/", { waitUntil: "domcontentloaded" });
    return page;
  }));
}

async function exerciseAdminSurfaces(
  page: Page,
  actor: HistoricalActor,
  plan: HistoricalPlan,
  cases: Array<CreatedCase & { referral: OperationalReferral }>,
) {
  if (actor.role !== "admin") return { surfaces: 0, godModeProfiles: false };
  for (const route of ["/?screen=profiles", "/?screen=operations"]) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.locator("main").first()).toBeVisible({ timeout: 20_000 });
  }
  if (actor.id !== plan.supervisor.actor_id) return { surfaces: 2, godModeProfiles: false };
  return { surfaces: 4, godModeProfiles: await verifyGodModeProfiles(page, plan, cases) };
}

async function exerciseOfflineRecovery(
  context: BrowserContext,
  page: Page | undefined,
  virtualUser: ChaosExtremeVirtualUser | undefined,
) {
  if (!isOfflineFlap(virtualUser) || !page) return 0;
  await context.setOffline(true);
  try {
    await expect(page.reload({ waitUntil: "domcontentloaded", timeout: 3_000 })).rejects.toThrow();
  } finally {
    await context.setOffline(false);
  }
  const recovered = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(recovered?.status()).toBeLessThan(400);
  return 1;
}

function isOfflineFlap(virtualUser: ChaosExtremeVirtualUser | undefined) {
  return virtualUser?.network.id === "offline_flap";
}

async function verifyGodModeProfiles(
  page: Page,
  plan: HistoricalPlan,
  cases: Array<CreatedCase & { referral: OperationalReferral }>,
) {
  const target = plan.actors.find((actor) => actor.role === "reviewer" && cases.some((item) => (
    item.item.assigned_actor_id === actor.actor_id
  )));
  if (!target) throw new Error("Historical simulation has no assigned reviewer for God Mode inspection.");
  const targetCase = cases.find((item) => item.item.assigned_actor_id === target.actor_id);
  if (!targetCase) throw new Error("Historical simulation has no target profile for God Mode inspection.");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Open profile menu for / }).click();
  await page.getByRole("button", { name: /God mode/ }).click();
  const picker = page.getByRole("dialog", { name: "God mode" });
  await expect(picker).toBeVisible();
  for (const reviewer of plan.actors.filter((actor) => actor.role === "reviewer")) {
    await expect(picker.getByText(reviewer.display_name, { exact: true })).toBeVisible();
  }
  await picker.getByRole("button").filter({ hasText: target.display_name }).click();
  await expect(page.getByRole("button", { name: `Exit God mode for ${target.display_name}` })).toBeVisible({ timeout: 20_000 });

  const effectiveIdentity = await page.request.get("/api/auth/me");
  expect(effectiveIdentity.status()).toBe(200);
  expect(asRecord(asRecord(await effectiveIdentity.json()).user).id).toBe(target.actor_id);
  await page.goto("/?screen=profiles", { waitUntil: "domcontentloaded" });
  const targetClientId = targetCase.referral.clientId;
  const targetName = targetCase.referral.name;
  if (!targetClientId || !targetName) {
    throw new Error("God Mode target referral must have a stable Pipeline client ID and normalized display name.");
  }
  await page.getByLabel("Search clients").fill(targetClientId);
  const targetProfile = page.getByRole("button", {
    name: new RegExp(`^Open profile for ${escapeRegularExpression(targetName)}`),
  });
  await expect(targetProfile).toHaveCount(1, { timeout: 20_000 });
  await targetProfile.click();
  await expect(page.getByTestId("profile-workspace")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: `Exit God mode for ${target.display_name}` }).click();
  await expect(page.getByRole("button", { name: /^Open profile menu for / })).toBeVisible({ timeout: 20_000 });
  return true;
}

function historicalReferralInput(simulationId: string, item: HistoricalCase) {
  const profile = item.profile_candidate ?? {};
  const primary = item.materials.find((material) => material.material_id === item.primary_material_id);
  return {
    name: item.display_name,
    date: item.timeline.referral_received_at.slice(0, 10),
    stage: "New",
    community: item.community,
    source: "ALLO historical simulation",
    priority: "standard",
    tags: [simulationId, "historical-private-simulation"],
    documentName: primary?.source_file_name ?? "No uploadable primary material",
    documentStatus: primary ? "Uploaded" : "Missing",
    owner: item.assigned_owner_name,
    note: "Isolated historical workflow simulation. Review source materials for clinical truth.",
    createdAt: item.timeline.referral_received_at,
    dob: typeof profile.date_of_birth === "string" ? profile.date_of_birth : "",
    phone: "",
    email: "",
    payer: "",
    requirements: [],
  };
}

function simulationActor(actor: HistoricalPlan["actors"][number]): HistoricalActor {
  const claims: Record<HistoricalRole, { roleClaim: string; expectedRoles: string[] }> = {
    admin: {
      roleClaim: "Pipeline.Admin",
      expectedRoles: ["admin", "assessment_coordinator", "reviewer", "viewer"],
    },
    assessment_coordinator: {
      roleClaim: "Pipeline.AssessmentCoordinator",
      expectedRoles: ["assessment_coordinator", "reviewer", "viewer"],
    },
    reviewer: {
      roleClaim: "Pipeline.Reviewer",
      expectedRoles: ["reviewer", "viewer"],
    },
    viewer: {
      roleClaim: "Pipeline.Viewer",
      expectedRoles: ["viewer"],
    },
  };
  return {
    id: actor.actor_id,
    email: actor.email,
    name: actor.display_name,
    role: actor.role,
    ...claims[actor.role],
  };
}

async function loadTruthCases(filePath: string) {
  const value = JSON.parse(await readFile(filePath, "utf8")) as { cases?: TruthCase[] };
  return new Map((value.cases ?? []).map((item) => [item.case_id, item]));
}

async function loadHistoricalChaosContext(mode: string, plan: HistoricalPlan, phase: "files" | "full") {
  if (mode === "chaos") {
    return loadChaosPlan(requiredEnvironmentPath("PIPELINE_HISTORICAL_CHAOS_PLAN"), plan, phase);
  }
  if (mode === "chaos_extreme") {
    return loadChaosExtremePlan(requiredEnvironmentPath("PIPELINE_HISTORICAL_CHAOS_EXTREME_PLAN"), plan, phase);
  }
  return null;
}

async function resolveHistoricalPlans(mode: string, sourcePlan: HistoricalPlan, phase: "files" | "full") {
  const chaosPlan = await loadHistoricalChaosContext(mode, sourcePlan, phase);
  const extremePlan = isChaosExtremePlan(chaosPlan) ? chaosPlan : null;
  return {
    chaosPlan,
    extremePlan,
    plan: extremePlan ? materializeExtremeRuntimePlan(sourcePlan, extremePlan) : sourcePlan,
  };
}

function identityConcurrency(plan: HistoricalChaosPlan | HistoricalChaosExtremePlan | null, actorCount: number) {
  return Math.min(plan?.concurrency.identities ?? 20, actorCount);
}

function surfaceConcurrency(plan: HistoricalChaosPlan | HistoricalChaosExtremePlan | null) {
  return plan?.concurrency.browsers ?? 6;
}

function chaosCertificationSummary(
  plan: HistoricalChaosPlan | HistoricalChaosExtremePlan | null,
  extremePlan: HistoricalChaosExtremePlan | null,
  actorCount: number,
  evidence: ChaosEvidence,
) {
  if (!plan) return {};
  return {
    chaos_certification: {
      policy_version: plan.policy_version,
      invariant_count: plan.invariants.length,
      evidence,
      virtual_user_count: extremePlan?.virtual_user_count ?? actorCount,
      contains_names_or_source_paths: false,
    },
  };
}

async function runChaosReadBurst(
  chaosPlan: HistoricalChaosPlan | null,
  cases: Array<CreatedCase & { referral: OperationalReferral }>,
  contexts: Map<string, APIRequestContext>,
  concurrency: number,
) {
  if (!chaosPlan) return 0;
  const readBurst = cases.flatMap((createdCase) => Array.from(
    { length: chaosPlan.read_repetitions },
    (_value, repetition) => ({ createdCase, repetition }),
  ));
  const statuses = await runWithConcurrency(readBurst, concurrency, async ({ createdCase, repetition }) => {
    const owner = requiredContext(contexts, createdCase.item.assigned_actor_id);
    const routes = [
      `/api/referrals/${createdCase.referral.id}`,
      `/api/referrals/${createdCase.referral.id}/activity`,
      `/api/referrals/${createdCase.referral.id}/work-items`,
    ];
    return (await owner.get(routes[repetition % routes.length] ?? routes[0])).status();
  });
  expect(statuses.every((status) => status === 200)).toBe(true);
  return statuses.length;
}

async function runExtremeVirtualMachineStorm(
  plan: HistoricalChaosExtremePlan,
  cases: Array<CreatedCase & { referral: OperationalReferral }>,
  contexts: Map<string, APIRequestContext>,
  baseURL: string,
  concurrency: number,
) {
  const users = new Map(plan.virtual_users.map((user) => [user.virtual_user_id, user]));
  const casesById = new Map(cases.map((item) => [item.item.case_id, item]));
  const { replaySelector, ticks } = buildExtremeSchedule(plan);
  const evidence: Pick<ChaosEvidence,
    | "virtual_machine_requests"
    | "virtual_machine_expected_rejections"
    | "virtual_machine_disconnects"
    | "virtual_machine_timeouts"
    | "virtual_machine_duplicates"> = {
    virtual_machine_requests: 0,
    virtual_machine_expected_rejections: 0,
    virtual_machine_disconnects: 0,
    virtual_machine_timeouts: 0,
    virtual_machine_duplicates: 0,
  };

  for (const tick of [...ticks.keys()].sort((left, right) => left - right)) {
    const scheduled = ticks.get(tick) ?? [];
    const results = await runWithConcurrency(scheduled, concurrency, (scheduledStep) => executeScheduledExtremeStep({
      plan,
      tick,
      scheduledStep,
      users,
      casesById,
      contexts,
      baseURL,
      evidence,
    }));
    expect(results.every(Boolean), `Chaos Extreme virtual tick ${tick}`).toBe(true);
  }
  assertExtremeEvidence(evidence, replaySelector, plan.scripts.length * 80);
  return evidence;
}

function buildExtremeSchedule(plan: HistoricalChaosExtremePlan) {
  const replaySelector = process.env.PIPELINE_HISTORICAL_CHAOS_EXTREME_REPLAY ?? "";
  const ticks = new Map<number, Array<{ virtualUserId: string; step: ChaosExtremeStep }>>();
  for (const script of plan.scripts) {
    for (const step of script.steps) {
      if (replaySelector && `${script.virtual_user_id}:${step.step}` !== replaySelector) continue;
      const scheduled = ticks.get(step.tick) ?? [];
      scheduled.push({ virtualUserId: script.virtual_user_id, step });
      ticks.set(step.tick, scheduled);
    }
  }
  return { replaySelector, ticks };
}

async function executeScheduledExtremeStep(input: {
  plan: HistoricalChaosExtremePlan;
  tick: number;
  scheduledStep: { virtualUserId: string; step: ChaosExtremeStep };
  users: Map<string, ChaosExtremeVirtualUser>;
  casesById: Map<string, CreatedCase & { referral: OperationalReferral }>;
  contexts: Map<string, APIRequestContext>;
  baseURL: string;
  evidence: Pick<ChaosEvidence,
    | "virtual_machine_requests"
    | "virtual_machine_expected_rejections"
    | "virtual_machine_disconnects"
    | "virtual_machine_timeouts"
    | "virtual_machine_duplicates">;
}) {
  const { virtualUserId, step } = input.scheduledStep;
  const user = input.users.get(virtualUserId);
  const createdCase = step.target_case_id ? input.casesById.get(step.target_case_id) : undefined;
  if (!user || !createdCase) throw replayError(input.plan, input.tick, virtualUserId, step, "virtual_user_or_case_missing");
  const actor = extremeVirtualActor(user);
  const { context, disposable } = await extremeRequestContext(input.contexts, input.baseURL, actor, step);
  if (disposable) input.evidence.virtual_machine_disconnects += 1;
  try {
    const expectedStatus = expectedExtremeStatus(user.role, step);
    await executeAndVerifyExtremeStep(input, context, user, createdCase, expectedStatus, "expected");
    if ([403, 404].includes(expectedStatus)) input.evidence.virtual_machine_expected_rejections += 1;
    await executeExtremeRetry(input, context, user, createdCase, expectedStatus, "timeout");
    await executeExtremeRetry(input, context, user, createdCase, expectedStatus, "duplicate");
    return true;
  } finally {
    await disposable?.dispose();
  }
}

async function extremeRequestContext(
  contexts: Map<string, APIRequestContext>,
  baseURL: string,
  actor: PipelineActor,
  step: ChaosExtremeStep,
) {
  if (!step.inject_disconnect) return { context: requiredContext(contexts, actor.id), disposable: null };
  const context = await request.newContext({ baseURL, extraHTTPHeaders: operationalHeadersForActor(actor, baseURL) });
  return { context, disposable: context };
}

async function executeExtremeRetry(
  input: Parameters<typeof executeScheduledExtremeStep>[0],
  context: APIRequestContext,
  user: ChaosExtremeVirtualUser,
  createdCase: CreatedCase & { referral: OperationalReferral },
  expectedStatus: number,
  kind: "timeout" | "duplicate",
) {
  const enabled = kind === "timeout" ? input.scheduledStep.step.inject_timeout : input.scheduledStep.step.inject_duplicate;
  if (!enabled) return;
  if (kind === "timeout") input.evidence.virtual_machine_timeouts += 1;
  else input.evidence.virtual_machine_duplicates += 1;
  await executeAndVerifyExtremeStep(input, context, user, createdCase, expectedStatus, `${kind}_retry`);
}

async function executeAndVerifyExtremeStep(
  input: Parameters<typeof executeScheduledExtremeStep>[0],
  context: APIRequestContext,
  user: ChaosExtremeVirtualUser,
  createdCase: CreatedCase & { referral: OperationalReferral },
  expectedStatus: number,
  attempt: string,
) {
  const { virtualUserId, step } = input.scheduledStep;
  const response = await executeExtremeStep(context, user, step, createdCase, input.plan.simulation_id);
  input.evidence.virtual_machine_requests += 1;
  if (response.status() !== expectedStatus) {
    throw replayError(input.plan, input.tick, virtualUserId, step, `${attempt}_expected_${expectedStatus}_received_${response.status()}`);
  }
}

function assertExtremeEvidence(
  evidence: Pick<ChaosEvidence,
    | "virtual_machine_requests"
    | "virtual_machine_expected_rejections"
    | "virtual_machine_disconnects"
    | "virtual_machine_timeouts"
    | "virtual_machine_duplicates">,
  replaySelector: string,
  minimumRequests: number,
) {
  expect(evidence.virtual_machine_requests).toBeGreaterThanOrEqual(replaySelector ? 1 : minimumRequests);
  if (replaySelector) return;
  expect(evidence.virtual_machine_expected_rejections).toBeGreaterThan(0);
  expect(evidence.virtual_machine_disconnects).toBeGreaterThan(0);
  expect(evidence.virtual_machine_timeouts).toBeGreaterThan(0);
  expect(evidence.virtual_machine_duplicates).toBeGreaterThan(0);
}

async function executeExtremeStep(
  context: APIRequestContext,
  user: ChaosExtremeVirtualUser,
  step: ChaosExtremeStep,
  createdCase: CreatedCase & { referral: OperationalReferral },
  simulationId: string,
) {
  const referralId = createdCase.referral.id;
  if (step.action === "list_referrals" || step.action === "open_home" || step.action === "background_poll") {
    return context.get(`/api/referrals?limit=25&tag=${encodeURIComponent(simulationId)}&projection=summary`);
  }
  if (step.action === "read_activity") {
    return context.get(`/api/referrals/${referralId}/activity`);
  }
  if (step.action === "read_work_items") {
    return context.get(`/api/referrals/${referralId}/work-items`);
  }
  if (step.action === "cross_role_mutation_probe" && ["reviewer", "viewer"].includes(user.role)) {
    return context.patch(`/api/referrals/${referralId}`, {
      data: {
        if_match: createdCase.referral.version,
        client_mutation_id: `${simulationId}:${user.virtual_user_id}:${step.step}:forbidden`,
        patch: { note: "Synthetic access-boundary probe. Contains no PHI." },
      },
    });
  }
  return context.get(`/api/referrals/${referralId}`);
}

function expectedExtremeStatus(role: HistoricalRole, step: ChaosExtremeStep) {
  if (step.action === "cross_role_mutation_probe") {
    if (role === "viewer") return 403;
    if (role === "reviewer") return 404;
  }
  return step.expected_access === "not_found" ? 404 : 200;
}

function extremeVirtualActor(user: ChaosExtremeVirtualUser): PipelineActor {
  const roleClaims: Record<HistoricalRole, string> = {
    admin: "Pipeline.Admin",
    assessment_coordinator: "Pipeline.AssessmentCoordinator",
    reviewer: "Pipeline.Reviewer",
    viewer: "Pipeline.Viewer",
  };
  const expectedRoles: Record<HistoricalRole, string[]> = {
    admin: ["admin", "assessment_coordinator", "reviewer", "viewer"],
    assessment_coordinator: ["assessment_coordinator", "reviewer", "viewer"],
    reviewer: ["reviewer", "viewer"],
    viewer: ["viewer"],
  };
  return {
    id: user.principal.id,
    email: user.principal.email,
    name: user.principal.display_name,
    roleClaim: roleClaims[user.role],
    expectedRoles: expectedRoles[user.role],
  };
}

function replayError(
  plan: HistoricalChaosExtremePlan,
  tick: number,
  virtualUserId: string,
  step: ChaosExtremeStep,
  failure: string,
) {
  return new Error(JSON.stringify({
    error: "chaos_extreme_replay_capsule",
    policy_version: plan.policy_version,
    simulation_id: plan.simulation_id,
    seed: plan.seed ?? "",
    tick,
    virtual_user_id: virtualUserId,
    step: step.step,
    action: step.action,
    replay_selector: `${virtualUserId}:${step.step}`,
    target_case_id: step.target_case_id,
    failure,
    contains_names_or_source_paths: false,
  }));
}

function assertChaosEvidence(
  chaosPlan: HistoricalChaosPlan | null,
  phase: "files" | "full",
  caseCount: number,
  lifecycleCount: number,
  evidence: ChaosEvidence,
) {
  if (!chaosPlan) return;
  expect(evidence.duplicate_replays).toBe(chaosPlan.cohorts.all_case_ids.length);
  expect(evidence.read_while_write_requests).toBe(caseCount * chaosPlan.read_repetitions);
  if (phase !== "full") return;
  expect(evidence.stale_assessment_conflicts).toBe(chaosPlan.cohorts.stale_write_case_ids.length);
  expect(evidence.supervisor_decision_conflicts).toBe(chaosPlan.cohorts.decision_race_case_ids.length);
  expect(evidence.ehr_failure_recoveries).toBe(chaosPlan.cohorts.handoff_recovery_case_ids.length);
  expect(lifecycleCount).toBe(caseCount);
}

async function loadChaosPlan(filePath: string, historicalPlan: HistoricalPlan, phase: "files" | "full") {
  const value = JSON.parse(await readFile(filePath, "utf8")) as HistoricalChaosPlan;
  if (value.policy_version !== "pipeline-chaos-lab-v1"
    || value.simulation_id !== historicalPlan.simulation_id
    || value.phase !== phase
    || !Array.isArray(value.cohorts?.all_case_ids)
    || value.cohorts.all_case_ids.length !== historicalPlan.cases.length
    || !Array.isArray(value.invariants)) {
    throw new Error("Historical chaos plan does not match the selected corpus and phase.");
  }
  return value;
}

async function loadChaosExtremePlan(filePath: string, historicalPlan: HistoricalPlan, phase: "files" | "full") {
  const value = JSON.parse(await readFile(filePath, "utf8")) as HistoricalChaosExtremePlan;
  if (value.policy_version !== "pipeline-chaos-extreme-v2"
    || value.simulation_id !== historicalPlan.simulation_id
    || value.phase !== phase
    || value.virtual_user_count !== 100
    || value.unique_principal_count !== 100
    || value.virtual_users.length !== 100
    || value.scripts.length !== 100
    || value.case_assignments.length !== historicalPlan.cases.length
    || !Array.isArray(value.invariants)) {
    throw new Error("Historical Chaos Extreme plan does not match the selected corpus and phase.");
  }
  return value;
}

function isChaosExtremePlan(plan: HistoricalChaosPlan | HistoricalChaosExtremePlan | null): plan is HistoricalChaosExtremePlan {
  return plan?.policy_version === "pipeline-chaos-extreme-v2";
}

function materializeExtremeRuntimePlan(
  source: HistoricalPlan,
  extreme: HistoricalChaosExtremePlan,
): HistoricalPlan {
  const users = new Map(extreme.virtual_users.map((user) => [user.virtual_user_id, user]));
  const assignments = new Map(extreme.case_assignments.map((item) => [item.case_id, item.virtual_user_id]));
  const supervisor = users.get(extreme.control_principals.supervisor_virtual_user_id);
  if (!supervisor || supervisor.role !== "admin") {
    throw new Error("Historical Chaos Extreme supervisor is missing or is not an administrator.");
  }
  return {
    ...source,
    supervisor: { actor_id: supervisor.principal.id },
    actors: extreme.virtual_users.map((user) => ({
      actor_id: user.principal.id,
      display_name: user.principal.display_name,
      email: user.principal.email,
      role: user.role,
    })),
    cases: source.cases.map((item) => {
      const virtualUserId = assignments.get(item.case_id);
      const user = virtualUserId ? users.get(virtualUserId) : undefined;
      if (!user || !["assessment_coordinator", "reviewer"].includes(user.role)) {
        throw new Error(`Historical Chaos Extreme has no mutation-capable assignee for ${item.case_id}.`);
      }
      return {
        ...item,
        assigned_actor_id: user.principal.id,
        assigned_owner_name: user.principal.display_name,
      };
    }),
  };
}

function requiredObjectPath(corpusRoot: string, material: HistoricalMaterial) {
  if (!material.object_relpath) throw new Error(`Missing object path for ${material.material_id}.`);
  const objectPath = path.resolve(corpusRoot, material.object_relpath);
  const relative = path.relative(corpusRoot, objectPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Object path escapes the corpus root for ${material.material_id}.`);
  }
  return objectPath;
}

function requiredEnvironmentPath(name: string) {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path.`);
  return value;
}

function requiredContext(contexts: Map<string, APIRequestContext>, actorId: string) {
  const context = contexts.get(actorId);
  if (!context) throw new Error(`Missing simulation actor context for ${actorId}.`);
  return context;
}

function concurrencyForMode(mode: string) {
  if (mode === "historical_replay") return { referrals: 2, files: 2, workflow: 2, reads: 8 };
  if (mode === "interrupted") return { referrals: 6, files: 3, workflow: 4, reads: 12 };
  if (mode === "chaos") return { referrals: 20, files: 8, workflow: 12, reads: 40 };
  if (mode === "soak") return { referrals: 4, files: 2, workflow: 3, reads: 10 };
  return { referrals: 20, files: 6, workflow: 10, reads: 30 };
}

function conflictFreeScheduleTimes(cases: HistoricalCase[]) {
  const slots = new Map<string, number>();
  const schedule = new Map<string, string>();
  const ordered = [...cases].sort((left, right) => (
    left.timeline.assessment_scheduled_at.localeCompare(right.timeline.assessment_scheduled_at)
    || left.sequence - right.sequence
  ));
  for (const item of ordered) {
    const date = item.timeline.assessment_scheduled_at.slice(0, 10);
    const key = `${item.assigned_actor_id}:${date}`;
    const slot = slots.get(key) ?? 0;
    slots.set(key, slot + 1);
    schedule.set(item.case_id, new Date(Date.parse(`${date}T00:00:00.000Z`) + slot * 30 * 60 * 1_000).toISOString());
  }
  return schedule;
}

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

async function withBackpressureRetry(
  operation: () => Promise<APIResponse>,
  deterministicKey: string,
  evidence: ChaosEvidence,
) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const response = await operation();
    if (response.status() !== 429) return response;
    evidence.backpressure_retries += 1;
    if (attempt === 31) return response;
    const retryAfter = Number.parseFloat(response.headers()["retry-after"] ?? "1");
    const baseDelay = Number.isFinite(retryAfter) ? Math.max(50, Math.min(2_000, retryAfter * 1_000)) : 1_000;
    const progressiveDelay = Math.min(2_000, attempt * 100);
    await new Promise((resolve) => setTimeout(
      resolve,
      baseDelay + progressiveDelay + deterministicJitter(deterministicKey, attempt) * 10,
    ));
  }
  throw new Error("Backpressure retry loop exited without a response.");
}

function deterministicJitter(value: string, attempt: number) {
  let total = attempt * 17;
  for (const character of value) total = (total * 31 + character.charCodeAt(0)) % 101;
  return total;
}

function addMinutes(timestamp: string, minutes: number) {
  return new Date(Date.parse(timestamp) + minutes * 60 * 1_000).toISOString();
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
