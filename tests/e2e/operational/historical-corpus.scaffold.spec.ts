import { expect, request, test, type APIRequestContext, type Browser, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
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

type HistoricalActor = PipelineActor & { role: "admin" | "reviewer" };

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
    role: "admin" | "reviewer";
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

type ChaosEvidence = {
  duplicate_replays: number;
  read_while_write_requests: number;
  stale_assessment_conflicts: number;
  supervisor_decision_conflicts: number;
  ehr_failure_recoveries: number;
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
    const plan = JSON.parse(await readFile(manifestPath, "utf8")) as HistoricalPlan;
    const phase = process.env.PIPELINE_HISTORICAL_SIMULATION_PHASE === "full" ? "full" : "files";
    const mode = process.env.PIPELINE_HISTORICAL_SIMULATION_MODE ?? "busy_day";
    const chaosPlan = await loadHistoricalChaosContext(mode, plan, phase);
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
    };
    const startedAt = performance.now();

    try {
      const registrations = await runWithConcurrency(actors, Math.min(20, actors.length), async (actor) => {
        const response = await requiredContext(contexts, actor.id).get("/api/members");
        return response.status();
      });
      expect(registrations.every((status) => status === 200)).toBe(true);

      const created = await runWithConcurrency(plan.cases, concurrency.referrals, async (item) => {
        const mutationId = `${plan.simulation_id}:${item.case_id}:create`;
        const referralInput = historicalReferralInput(plan.simulation_id, item);
        const response = await supervisor.post("/api/referrals", {
          data: {
            client_mutation_id: mutationId,
            referral: referralInput,
            assignee_id: item.assigned_actor_id,
          },
        });
        const bodyText = await response.text();
        expect(response.status(), bodyText.slice(0, 1_000)).toBe(201);
        return { item, referralInput, mutationId, referral: asReferralPayload(JSON.parse(bodyText)).referral };
      });
      expect(new Set(created.map(({ referral }) => referral.id)).size).toBe(plan.cases.length);

      const duplicateCases = chaosPlan ? created : created.filter(({ item }) => item.behavior === "duplicate_retry");
      const duplicateIds = await runWithConcurrency(duplicateCases, concurrency.referrals, async (createdCase) => {
        const response = await supervisor.post("/api/referrals", {
          data: {
            client_mutation_id: createdCase.mutationId,
            referral: createdCase.referralInput,
            assignee_id: createdCase.item.assigned_actor_id,
          },
        });
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
            await expectRejectedDescriptor(owner, corpusRoot, createdCase.referral.id, createdCase.item.community, material);
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

      const surfaceEvidence = await exerciseAllSurfaces(browser, url, plan, progressed, testInfo);
      const listResponse = await supervisor.get(`/api/referrals?limit=200&tag=${encodeURIComponent(plan.simulation_id)}&projection=summary`);
      expect(listResponse.status()).toBe(200);
      const list = asRecord(await listResponse.json());
      expect(Number(list.total)).toBe(plan.cases.length);
      const activityChecks = await runWithConcurrency(progressed, concurrency.reads, async ({ referral }) => {
        const response = await supervisor.get(`/api/referrals/${referral.id}/activity`);
        return response.status();
      });
      expect(activityChecks.every((status) => status === 200)).toBe(true);

      await testInfo.attach("historical-simulation-summary", {
        body: Buffer.from(JSON.stringify({
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
          ...(chaosPlan ? {
            chaos_certification: {
              policy_version: chaosPlan.policy_version,
              invariant_count: chaosPlan.invariants.length,
              evidence: chaosEvidence,
              contains_names_or_source_paths: false,
            },
          } : {}),
        }, null, 2)),
        contentType: "application/json",
      });
      if (process.env.PIPELINE_HISTORICAL_INSPECT === "true") {
        await holdOpenForGodModeInspection(browser, url, plan);
      }
    } finally {
      await Promise.all([...contexts.values()].map((context) => context.dispose()));
    }
  });
});

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
}) {
  const fileId = input.material.material_id;
  const reservationResponse = await input.context.post("/api/uploads/create-url", {
    data: uploadReservationData(input.referralId, input.community, input.material, input.extract),
  });
  const reservationText = await reservationResponse.text();
  expect(reservationResponse.status(), reservationText.slice(0, 1_000)).toBe(200);
  const reservation = asUploadReservation(JSON.parse(reservationText));
  const objectPath = requiredObjectPath(input.corpusRoot, input.material);
  const bytes = await readFile(objectPath);
  const localResponse = await input.context.post("/api/uploads/local", {
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
  });
  const localText = await localResponse.text();
  expect(localResponse.status(), localText.slice(0, 1_000)).toBe(200);
  const completion = await input.context.post("/api/uploads/complete", {
    data: { packet_id: reservation.packet_id, uploaded_file_ids: [fileId] },
  });
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
) {
  const response = await context.post("/api/uploads/create-url", {
    data: uploadReservationData(referralId, community, material, false),
  });
  if (material.expected_rejection_stage === "reservation") {
    expect(response.status()).toBe(material.expected_api_status);
    return;
  }
  const responseText = await response.text();
  expect(response.status(), responseText.slice(0, 1_000)).toBe(200);
  const reservation = asUploadReservation(JSON.parse(responseText));
  const localResponse = await context.post("/api/uploads/local", {
    multipart: {
      packet_id: reservation.packet_id,
      file_id: material.material_id,
      file: {
        name: material.source_file_name,
        mimeType: material.source_content_type,
        buffer: await readFile(requiredObjectPath(corpusRoot, material)),
      },
    },
  });
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
) {
  const caseByActor = new Map<string, typeof cases>();
  for (const item of cases) {
    const assigned = caseByActor.get(item.item.assigned_actor_id) ?? [];
    assigned.push(item);
    caseByActor.set(item.item.assigned_actor_id, assigned);
  }
  const actors = plan.actors.map(simulationActor);
  const actorEvidence = await runWithConcurrency(actors, Math.min(6, actors.length), async (actor) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: {
        ...operationalHeadersForActor(actor, baseURL),
        Accept: "text/html,application/xhtml+xml,application/json",
      },
    });
    const page = await context.newPage();
    let surfaceCount = 0;
    let godModeProfiles = false;
    try {
      for (const route of ["/", "/?view=referrals", "/?screen=calendar"]) {
        const response = await page.goto(route, { waitUntil: "domcontentloaded" });
        expect(response?.status(), route).toBeLessThan(400);
        await expect(page.locator("main").first()).toBeVisible({ timeout: 20_000 });
        surfaceCount += 1;
      }
      await page.getByRole("button", { name: "Open guided tutorials" }).click();
      await expect(page.getByRole("dialog", { name: "Guided tutorial library" })).toBeVisible();
      await page.getByRole("button", { name: "Close guided tutorials" }).click();
      surfaceCount += 1;
      if (actor.role === "admin") {
        for (const route of ["/?screen=profiles", "/?screen=operations"]) {
          const response = await page.goto(route, { waitUntil: "domcontentloaded" });
          expect(response?.status(), route).toBeLessThan(400);
          await expect(page.locator("main").first()).toBeVisible({ timeout: 20_000 });
          surfaceCount += 1;
        }
        godModeProfiles = await verifyGodModeProfiles(page, plan, cases);
        surfaceCount += 2;
      }
      for (const createdCase of caseByActor.get(actor.id) ?? []) {
        const base = `/?view=referrals&screen=packet&referralId=${createdCase.referral.id}`;
        const response = await page.goto(base, { waitUntil: "domcontentloaded" });
        expect(response?.status()).toBeLessThan(400);
        await expect(page.getByTestId("packet-workspace")).toBeVisible({ timeout: 20_000 });
        await page.getByRole("button", { name: "Workspace files" }).click();
        await expect(page.getByText("Files", { exact: true }).first()).toBeVisible();
        await page.getByRole("button", { name: "Workspace activity" }).click();
        await expect(page.getByText("Activity", { exact: true }).first()).toBeVisible();
        for (const stage of ["assessment", "chart"]) {
          await page.goto(`${base}&workspaceStage=${stage}`, { waitUntil: "domcontentloaded" });
          await expect(page.getByTestId("packet-workspace")).toBeVisible({ timeout: 20_000 });
        }
        await expect(page.getByText("Application error", { exact: false })).toHaveCount(0);
        surfaceCount += 5;
      }
      return {
        role: actor.role,
        cases: caseByActor.get(actor.id)?.length ?? 0,
        surfaces: surfaceCount,
        god_mode_profiles: godModeProfiles,
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
  await page.getByLabel("Search clients").fill(targetCase.item.display_name);
  await expect(page.getByRole("button", {
    name: new RegExp(`^Open profile for ${escapeRegularExpression(targetCase.item.display_name)}`),
  })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", {
    name: new RegExp(`^Open profile for ${escapeRegularExpression(targetCase.item.display_name)}`),
  }).click();
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
  return {
    id: actor.actor_id,
    email: actor.email,
    name: actor.display_name,
    role: actor.role,
    roleClaim: actor.role === "admin" ? "Pipeline.Admin" : "Pipeline.Reviewer",
    expectedRoles: actor.role === "admin"
      ? ["admin", "assessment_coordinator", "reviewer", "viewer"]
      : ["reviewer", "viewer"],
  };
}

async function loadTruthCases(filePath: string) {
  const value = JSON.parse(await readFile(filePath, "utf8")) as { cases?: TruthCase[] };
  return new Map((value.cases ?? []).map((item) => [item.case_id, item]));
}

async function loadHistoricalChaosContext(mode: string, plan: HistoricalPlan, phase: "files" | "full") {
  return mode === "chaos"
    ? loadChaosPlan(requiredEnvironmentPath("PIPELINE_HISTORICAL_CHAOS_PLAN"), plan, phase)
    : null;
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

function addMinutes(timestamp: string, minutes: number) {
  return new Date(Date.parse(timestamp) + minutes * 60 * 1_000).toISOString();
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
