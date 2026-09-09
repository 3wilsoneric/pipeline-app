import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

import {
  actorApiContext,
  pipelineActors,
  requireOperationalBaseURL,
} from "../support/pipeline-actors";
import {
  asRecord,
  asReferralPayload,
  completeOperationalAssessment,
  createOperationalAssessment,
  createOperationalReferral,
  markOperationalPacketReviewed,
  readOperationalReferral,
  resolveOperationalDecisionRequirements,
  resolveOperationalMoveInRequirements,
  scheduleOperationalAssessment,
  signOperationalAssessment,
  startOperationalAssessment,
  transitionOperationalReferral,
  type OperationalAssessment,
  type OperationalReferral,
} from "../support/operational-api";

test.describe("workflow store characterization", () => {
  test.skip(
    process.env.PIPELINE_WORKFLOW_CHARACTERIZATION !== "true",
    "Run through the workflow-store characterization harness.",
  );

  test("enforces stage order, optimistic conflicts, and transition replay", async ({ baseURL }) => {
    const actors = await workflowActors(baseURL);
    try {
      const referral = await createWorkflowReferral(actors.coordinator);
      const before = await readReferralRecord(actors.coordinator, referral.id);
      const skipped = await actors.coordinator.post(`/api/referrals/${referral.id}/transition`, {
        data: transitionRequest(referral, "Assessment", "workflow-characterization-skip"),
      });
      await responseRecord(skipped, 422);
      expect(await readReferralRecord(actors.coordinator, referral.id)).toMatchObject({
        version: before.version,
        stage: "New",
      });

      const request = transitionRequest(referral, "Packet Needed", "workflow-characterization-transition-replay");
      const first = await actors.coordinator.post(`/api/referrals/${referral.id}/transition`, { data: request });
      const firstReferral = asReferralPayload(await responseRecord(first, 200)).referral;
      const replay = await actors.coordinator.post(`/api/referrals/${referral.id}/transition`, { data: request });
      const replayReferral = asReferralPayload(await responseRecord(replay, 200)).referral;
      expect(replayReferral).toEqual(firstReferral);

      const stale = await actors.coordinator.post(`/api/referrals/${referral.id}/transition`, {
        data: transitionRequest(referral, "Declined", "workflow-characterization-stale-transition"),
      });
      await responseRecord(stale, 409);
      const after = await readReferralRecord(actors.coordinator, referral.id);
      expect(after).toMatchObject({ version: firstReferral.version, stage: "Packet Needed" });
      expect((await activityActions(actors.supervisor, referral.id)).filter((action) => action === "referral_stage_changed")).toHaveLength(1);
    } finally {
      await actors.dispose();
    }
  });

  test("requires a signed assigned assessment and replays one recommendation", async ({ baseURL }) => {
    const actors = await workflowActors(baseURL);
    try {
      let referral = await createWorkflowReferral(actors.coordinator);
      referral = await advanceToAssessment(actors.coordinator, referral);
      let assessment = await createOperationalAssessment(actors.assessor, referral.id);
      const unsignedRequest = recommendationRequest(
        referral,
        assessment,
        "workflow-characterization-unsigned-recommendation",
      );
      const unsigned = await actors.assessor.put(`/api/referrals/${referral.id}/recommendation`, { data: unsignedRequest });
      await responseRecord(unsigned, 422);

      const viewer = await actors.viewer.put(`/api/referrals/${referral.id}/recommendation`, { data: unsignedRequest });
      expect(viewer.status()).toBe(403);
      const wrongAssessor = await actors.otherAssessor.put(`/api/referrals/${referral.id}/recommendation`, { data: unsignedRequest });
      expect(wrongAssessor.status()).toBe(404);

      assessment = await finishAssessment(actors.assessor, assessment);
      referral = await readOperationalReferral(actors.assessor, referral.id);
      const request = recommendationRequest(
        referral,
        assessment,
        "workflow-characterization-recommendation-replay",
      );
      const first = await actors.assessor.put(`/api/referrals/${referral.id}/recommendation`, { data: request });
      const firstBody = await responseRecord(first, 200);
      const firstReferral = asReferralPayload(firstBody).referral;
      const firstRecommendation = asRecord(firstBody.recommendation);
      const replay = await actors.assessor.put(`/api/referrals/${referral.id}/recommendation`, { data: request });
      const replayBody = await responseRecord(replay, 200);
      expect(asRecord(replayBody.recommendation)).toMatchObject({
        recommendationId: firstRecommendation.recommendationId,
        version: firstRecommendation.version,
      });
      expect(asReferralPayload(replayBody).referral).toEqual(firstReferral);

      const saved = await decisionSnapshot(actors.supervisor, referral.id);
      expect(asRecord(saved.recommendation)).toMatchObject({
        recommendationId: firstRecommendation.recommendationId,
        outcome: "accept",
        recommendedBy: pipelineActors.assessorA.id,
      });
    } finally {
      await actors.dispose();
    }
  });

  test("allows exactly one supervisor decision for a stale concurrent pair", async ({ baseURL }) => {
    const actors = await workflowActors(baseURL);
    try {
      const ready = await decisionReadyReferral(actors);
      const unauthorized = await actors.assessor.put(`/api/referrals/${ready.referral.id}/decision`, {
        data: decisionRequest(ready.referral, "accepted", "workflow-characterization-assessor-decision"),
      });
      expect(unauthorized.status()).toBe(403);

      const accepted = decisionRequest(
        ready.referral,
        "accepted",
        "workflow-characterization-accepted-race",
      );
      const declined = decisionRequest(
        ready.referral,
        "declined",
        "workflow-characterization-declined-race",
      );
      const [left, right] = await Promise.all([
        actors.supervisor.put(`/api/referrals/${ready.referral.id}/decision`, { data: accepted }),
        actors.supervisorPeer.put(`/api/referrals/${ready.referral.id}/decision`, { data: declined }),
      ]);
      expect([left.status(), right.status()].sort()).toEqual([200, 409]);
      const winnerRequest = left.status() === 200 ? accepted : declined;
      const winnerBody = await responseRecord(left.status() === 200 ? left : right, 200);
      await responseRecord(left.status() === 409 ? left : right, 409);
      const winnerDecision = asRecord(winnerBody.decision);

      const replay = await actors.supervisor.put(`/api/referrals/${ready.referral.id}/decision`, { data: winnerRequest });
      const replayBody = await responseRecord(replay, 200);
      expect(asRecord(replayBody.decision)).toMatchObject({
        decisionId: winnerDecision.decisionId,
        outcome: winnerDecision.outcome,
        version: winnerDecision.version,
      });
      const saved = await decisionSnapshot(actors.supervisor, ready.referral.id);
      expect(asRecord(saved.decision)).toMatchObject({
        decisionId: winnerDecision.decisionId,
        version: 1,
      });
    } finally {
      await actors.dispose();
    }
  });

  test("validates work-item evidence and makes a replay audit-neutral", async ({ baseURL }) => {
    const actors = await workflowActors(baseURL);
    try {
      const referral = await createWorkflowReferral(actors.coordinator);
      const workItem = await findWorkItem(actors.coordinator, referral.id, "medication_list");
      const invalid = await actors.coordinator.patch(`/api/referrals/${referral.id}/work-items/${workItem.id}`, {
        data: {
          if_match: workItem.version,
          client_mutation_id: "workflow-characterization-invalid-waiver",
          patch: { status: "waived" },
        },
      });
      await responseRecord(invalid, 422);

      const request = {
        if_match: workItem.version,
        client_mutation_id: "workflow-characterization-work-item-replay",
        patch: {
          status: "requested",
          requestedFrom: "Synthetic county liaison",
          followUpAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
        },
      };
      const first = await actors.coordinator.patch(`/api/referrals/${referral.id}/work-items/${workItem.id}`, { data: request });
      const firstBody = await responseRecord(first, 200);
      const firstWorkItem = asRecord(firstBody.work_item);
      const firstReferral = asReferralPayload(firstBody).referral;
      const activityAfterFirst = await activityActions(actors.supervisor, referral.id);

      const replay = await actors.coordinator.patch(`/api/referrals/${referral.id}/work-items/${workItem.id}`, { data: request });
      const replayBody = await responseRecord(replay, 200);
      expect(asRecord(replayBody.work_item)).toMatchObject({
        id: firstWorkItem.id,
        status: "requested",
        version: firstWorkItem.version,
      });
      expect(asReferralPayload(replayBody).referral).toEqual(firstReferral);
      expect(await activityActions(actors.supervisor, referral.id)).toEqual(activityAfterFirst);

      const stale = await actors.coordinator.patch(`/api/referrals/${referral.id}/work-items/${workItem.id}`, {
        data: {
          if_match: workItem.version,
          client_mutation_id: "workflow-characterization-stale-work-item",
          patch: { status: "reviewed" },
        },
      });
      await responseRecord(stale, 409);
    } finally {
      await actors.dispose();
    }
  });

  test("runs an at-most-once EHR handoff through failure, retry, and sent", async ({ baseURL }) => {
    const actors = await workflowActors(baseURL);
    try {
      let referral = await admittedReferral(actors);
      const queueRequest = ehrRequest(referral, "queue", "workflow-characterization-ehr-queue");
      const queued = await actors.supervisor.post(`/api/referrals/${referral.id}/ehr-handoff`, { data: queueRequest });
      const queuedBody = await responseRecord(queued, 200);
      referral = asReferralPayload(queuedBody).referral;
      const queuedRecord = asRecord(queuedBody.ehr_handoff);
      expect(queuedRecord.status).toBe("queued");

      const replay = await actors.supervisor.post(`/api/referrals/${referral.id}/ehr-handoff`, { data: queueRequest });
      const replayBody = await responseRecord(replay, 200);
      expect(asRecord(replayBody.ehr_handoff)).toMatchObject({
        status: "queued",
        version: queuedRecord.version,
      });
      expect(asReferralPayload(replayBody).referral).toEqual(referral);

      const missingReason = await actors.supervisor.post(`/api/referrals/${referral.id}/ehr-handoff`, {
        data: ehrRequest(referral, "mark_failed", "workflow-characterization-ehr-missing-reason"),
      });
      await responseRecord(missingReason, 422);
      referral = await ehrMutation(
        actors.supervisor,
        referral,
        "mark_failed",
        "workflow-characterization-ehr-failed",
        "Synthetic downstream rejection.",
      );
      referral = await ehrMutation(
        actors.supervisor,
        referral,
        "retry",
        "workflow-characterization-ehr-retry",
      );
      referral = await ehrMutation(
        actors.supervisor,
        referral,
        "mark_sent",
        "workflow-characterization-ehr-sent",
      );

      const terminalVersion = referral.version;
      const secondQueue = await actors.supervisor.post(`/api/referrals/${referral.id}/ehr-handoff`, {
        data: ehrRequest(referral, "queue", "workflow-characterization-ehr-second-queue"),
      });
      await responseRecord(secondQueue, 422);
      const saved = await readReferralRecord(actors.supervisor, referral.id);
      expect(asRecord(saved.ehrHandoff)).toMatchObject({ status: "sent", version: 4 });
      expect(saved.version).toBe(terminalVersion);
      const actions = await activityActions(actors.supervisor, referral.id);
      for (const action of ["ehr_handoff_queued", "ehr_handoff_failed", "ehr_handoff_retried", "ehr_handoff_sent"]) {
        expect(actions.filter((candidate) => candidate === action), action).toHaveLength(1);
      }
    } finally {
      await actors.dispose();
    }
  });

  test("denied role and resource mutations leave workflow and audit unchanged", async ({ baseURL }) => {
    const actors = await workflowActors(baseURL);
    try {
      const referral = await createWorkflowReferral(actors.coordinator);
      const before = await readReferralRecord(actors.coordinator, referral.id);
      const activityBefore = await activityActions(actors.supervisor, referral.id);

      const viewerRead = await actors.viewer.get(`/api/referrals/${referral.id}`);
      expect(viewerRead.status()).toBe(200);
      const viewerWrite = await actors.viewer.post(`/api/referrals/${referral.id}/transition`, {
        data: transitionRequest(referral, "Packet Needed", "workflow-characterization-viewer-denied"),
      });
      expect(viewerWrite.status()).toBe(403);
      const wrongResourceRead = await actors.otherAssessor.get(`/api/referrals/${referral.id}`);
      expect(wrongResourceRead.status()).toBe(404);
      const wrongResourceWrite = await actors.otherAssessor.post(`/api/referrals/${referral.id}/transition`, {
        data: transitionRequest(referral, "Packet Needed", "workflow-characterization-other-assessor-denied"),
      });
      expect(wrongResourceWrite.status()).toBe(404);

      expect(await readReferralRecord(actors.coordinator, referral.id)).toMatchObject({
        version: before.version,
        stage: before.stage,
      });
      expect(await activityActions(actors.supervisor, referral.id)).toEqual(activityBefore);
    } finally {
      await actors.dispose();
    }
  });
});

type WorkflowActors = Awaited<ReturnType<typeof workflowActors>>;

async function workflowActors(baseURL: string | undefined) {
  const url = requireOperationalBaseURL(baseURL);
  const [coordinator, assessor, otherAssessor, supervisor, supervisorPeer, viewer] = await Promise.all([
    actorApiContext("assessmentCoordinator", url),
    actorApiContext("assessorA", url),
    actorApiContext("assessorB", url),
    actorApiContext("admin", url),
    actorApiContext("admin", url),
    actorApiContext("viewer", url),
  ]);
  await Promise.all([
    coordinator.get("/api/members"),
    assessor.get("/api/members"),
    otherAssessor.get("/api/members"),
    supervisor.get("/api/members"),
    viewer.get("/api/members"),
  ]);
  return {
    coordinator,
    assessor,
    otherAssessor,
    supervisor,
    supervisorPeer,
    viewer,
    async dispose() {
      await Promise.all([
        coordinator.dispose(),
        assessor.dispose(),
        otherAssessor.dispose(),
        supervisor.dispose(),
        supervisorPeer.dispose(),
        viewer.dispose(),
      ]);
    },
  };
}

async function createWorkflowReferral(context: APIRequestContext) {
  return createOperationalReferral(
    context,
    pipelineActors.assessmentCoordinator,
    { tags: ["workflow-characterization"], county: "Los Angeles" },
    { assigneeId: pipelineActors.assessorA.id },
  );
}

async function advanceToAssessment(context: APIRequestContext, initial: OperationalReferral) {
  let referral = await transitionOperationalReferral(context, initial, "Packet Needed");
  referral = await transitionOperationalReferral(context, referral, "Packet Review");
  referral = await markOperationalPacketReviewed(context, referral);
  return transitionOperationalReferral(context, referral, "Assessment");
}

async function finishAssessment(context: APIRequestContext, initial: OperationalAssessment) {
  let assessment = await scheduleOperationalAssessment(context, initial);
  assessment = await startOperationalAssessment(context, assessment);
  assessment = await completeOperationalAssessment(context, assessment);
  return signOperationalAssessment(context, assessment);
}

async function decisionReadyReferral(actors: WorkflowActors) {
  let referral = await createWorkflowReferral(actors.coordinator);
  referral = await advanceToAssessment(actors.coordinator, referral);
  let assessment = await createOperationalAssessment(actors.assessor, referral.id);
  assessment = await finishAssessment(actors.assessor, assessment);
  referral = await readOperationalReferral(actors.assessor, referral.id);
  const recommendation = await actors.assessor.put(`/api/referrals/${referral.id}/recommendation`, {
    data: recommendationRequest(referral, assessment, "workflow-characterization-decision-recommendation"),
  });
  referral = asReferralPayload(await responseRecord(recommendation, 200)).referral;
  await resolveOperationalDecisionRequirements(actors.supervisor, referral.id);
  referral = await readOperationalReferral(actors.supervisor, referral.id);
  return { referral, assessment };
}

async function admittedReferral(actors: WorkflowActors) {
  const ready = await decisionReadyReferral(actors);
  let referral = ready.referral;
  const decision = await actors.supervisor.put(`/api/referrals/${referral.id}/decision`, {
    data: decisionRequest(referral, "accepted", "workflow-characterization-ehr-decision"),
  });
  referral = asReferralPayload(await responseRecord(decision, 200)).referral;
  await resolveOperationalMoveInRequirements(actors.supervisor, referral.id);
  referral = await readOperationalReferral(actors.supervisor, referral.id);
  return transitionOperationalReferral(actors.supervisor, referral, "Accepted / Admitted");
}

function transitionRequest(
  referral: OperationalReferral,
  targetStage: string,
  mutationId: string,
) {
  return {
    if_match: referral.version,
    if_match_section: referral.sectionVersions.workflow,
    target_stage: targetStage,
    client_mutation_id: mutationId,
  };
}

function recommendationRequest(
  referral: OperationalReferral,
  assessment: OperationalAssessment,
  mutationId: string,
) {
  return {
    if_match: referral.version,
    if_match_section: referral.sectionVersions.decision,
    assessment_id: assessment.assessment_id,
    outcome: "accept",
    reason_code: "clinical_fit",
    reason_note: "Synthetic workflow characterization recommendation. Contains no PHI.",
    client_mutation_id: mutationId,
  };
}

function decisionRequest(
  referral: OperationalReferral,
  outcome: "accepted" | "declined",
  mutationId: string,
) {
  return {
    if_match: referral.version,
    if_match_section: referral.sectionVersions.decision,
    outcome,
    reason_code: outcome === "declined" ? "not_a_fit" : "",
    reason_note: outcome === "declined" ? "Synthetic characterized decline reason." : "",
    client_mutation_id: mutationId,
  };
}

function ehrRequest(
  referral: OperationalReferral,
  action: "queue" | "mark_sent" | "mark_failed" | "retry",
  mutationId: string,
  failureReason = "",
) {
  return {
    if_match: referral.version,
    if_match_section: referral.sectionVersions.decision,
    action,
    failure_reason: failureReason,
    client_mutation_id: mutationId,
  };
}

async function ehrMutation(
  context: APIRequestContext,
  referral: OperationalReferral,
  action: "queue" | "mark_sent" | "mark_failed" | "retry",
  mutationId: string,
  failureReason = "",
) {
  const response = await context.post(`/api/referrals/${referral.id}/ehr-handoff`, {
    data: ehrRequest(referral, action, mutationId, failureReason),
  });
  const body = await responseRecord(response, 200);
  expect(asRecord(body.ehr_handoff).status).toBe({
    queue: "queued",
    retry: "queued",
    mark_failed: "failed",
    mark_sent: "sent",
  }[action]);
  return asReferralPayload(body).referral;
}

async function readReferralRecord(context: APIRequestContext, referralId: number) {
  const response = await context.get(`/api/referrals/${referralId}`);
  return asRecord((await responseRecord(response, 200)).referral);
}

async function decisionSnapshot(context: APIRequestContext, referralId: number) {
  const response = await context.get(`/api/referrals/${referralId}/decision`);
  return responseRecord(response, 200);
}

async function findWorkItem(context: APIRequestContext, referralId: number, type: string) {
  const response = await context.get(`/api/referrals/${referralId}/work-items`);
  const body = await responseRecord(response, 200);
  const items = Array.isArray(body.work_items) ? body.work_items.map(asRecord) : [];
  const item = items.find((candidate) => candidate.type === type);
  if (!item) throw new Error(`Expected ${type} work item.`);
  return { id: String(item.id), version: Number(item.version) };
}

async function activityActions(context: APIRequestContext, referralId: number) {
  const response = await context.get(`/api/referrals/${referralId}/activity`);
  const body = await responseRecord(response, 200);
  return (Array.isArray(body.events) ? body.events.map(asRecord) : []).map((event) => String(event.action));
}

async function responseRecord(response: APIResponse, expectedStatus: number) {
  const text = await response.text();
  expect(response.status(), text.slice(0, 1_000)).toBe(expectedStatus);
  return asRecord(JSON.parse(text));
}
