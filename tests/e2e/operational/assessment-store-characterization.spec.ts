import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  actorApiContext,
  operationalMutationId,
  pipelineActors,
  requireOperationalBaseURL,
} from "../support/pipeline-actors";
import {
  asRecord,
  completeOperationalAssessment,
  createOperationalReferral,
  signOperationalAssessment,
  startOperationalAssessment,
} from "../support/operational-api";

test.describe("assessment store characterization", () => {
  test.skip(
    process.env.PIPELINE_ASSESSMENT_CHARACTERIZATION !== "true",
    "Run through the assessment-store characterization harness.",
  );

  test("replays assessment creation without a second record or audit event", async ({ baseURL }) => {
    const actors = await assessmentActors(baseURL);
    try {
      const referral = await createAssessmentReferral(actors.coordinator);
      const mutationId = "assessment-characterization-create";
      const request = {
        client_mutation_id: mutationId,
        data: { current_location: "Synthetic assessment location" },
      };
      const first = await actors.assessor.post(`/api/referrals/${referral.id}/assessments`, { data: request });
      const firstBody = await responseRecord(first, 201);
      const replay = await actors.assessor.post(`/api/referrals/${referral.id}/assessments`, { data: request });
      const replayBody = await responseRecord(replay, 201);
      const firstAssessment = asRecord(firstBody.assessment);
      const replayAssessment = asRecord(replayBody.assessment);

      expect(replayAssessment.assessment_id).toBe(firstAssessment.assessment_id);
      expect(replayAssessment.version).toBe(firstAssessment.version);
      const listed = await listAssessments(actors.assessor, referral.id);
      expect(listed).toHaveLength(1);
      expect(auditActions(listed[0])).toEqual(["assessment_created"]);
      expect(asRecord(listed[0].created_by)).toMatchObject({
        id: pipelineActors.assessorA.id,
        name: pipelineActors.assessorA.name,
      });

      const savedReferral = await readReferral(actors.assessor, referral.id);
      expect(savedReferral.workflowStatus).toBe("ready_to_schedule");
    } finally {
      await actors.dispose();
    }
  });

  test("accepts disjoint section saves, rejects stale same-section saves, and replays an acknowledged patch", async ({ baseURL }) => {
    const actors = await assessmentActors(baseURL);
    try {
      const referral = await createAssessmentReferral(actors.coordinator);
      const assessment = await createAssessment(actors.assessor, referral.id, "assessment-characterization-sections");
      const sectionVersions = numberRecord(assessment.section_versions);
      const identityRequest = {
        section: "identity",
        if_match_section: sectionVersions.identity,
        client_mutation_id: "assessment-characterization-identity-patch",
        patch: { data: { current_location: "Synthetic updated location" } },
      };
      const identitySave = await actors.assessor.patch(`/api/assessments/${assessment.assessment_id}`, { data: identityRequest });
      const identitySaved = asRecord((await responseRecord(identitySave, 200)).assessment);
      const identityReplay = await actors.assessor.patch(`/api/assessments/${assessment.assessment_id}`, { data: identityRequest });
      const identityReplayed = asRecord((await responseRecord(identityReplay, 200)).assessment);
      expect(identityReplayed.version).toBe(identitySaved.version);

      const staleSameSection = await actors.assessor.patch(`/api/assessments/${assessment.assessment_id}`, {
        data: {
          section: "identity",
          if_match_section: sectionVersions.identity,
          client_mutation_id: "assessment-characterization-stale-identity",
          patch: { data: { current_location: "This stale value must not persist" } },
        },
      });
      expect(staleSameSection.status()).toBe(409);

      const disjointSave = await actors.assessor.patch(`/api/assessments/${assessment.assessment_id}`, {
        data: {
          section: "diagnosis_clinical",
          if_match_section: sectionVersions.diagnosis_clinical,
          client_mutation_id: "assessment-characterization-diagnosis-patch",
          patch: { data: { primary_diagnosis: "Synthetic characterized diagnosis" } },
        },
      });
      await responseRecord(disjointSave, 200);

      const latest = await readAssessment(actors.assessor, String(assessment.assessment_id));
      expect(latest.current_location).toBe("Synthetic updated location");
      expect(latest.primary_diagnosis).toBe("Synthetic characterized diagnosis");
      expect(auditActions(latest).filter((action) => action === "assessment_updated")).toHaveLength(2);
      expect(latestProvenance(latest, "current_location")).toMatchObject({
        source_field_key: "manual.current_location",
        review_status: "edited",
      });
      expect(latestProvenance(latest, "primary_diagnosis")).toMatchObject({
        source_field_key: "manual.primary_diagnosis",
        review_status: "edited",
      });
    } finally {
      await actors.dispose();
    }
  });

  test("approved staff can edit shared work while outsiders cannot change data or audit history", async ({ baseURL }) => {
    const actors = await assessmentActors(baseURL);
    try {
      const referral = await createAssessmentReferral(actors.coordinator);
      const assessment = await createAssessment(actors.assessor, referral.id, "assessment-characterization-denial");
      const before = await readAssessment(actors.assessor, String(assessment.assessment_id));

      let latest = before;
      for (const [actor, note] of [[actors.viewer, "Approved teammate edit"], [actors.otherAssessor, "Shared assessor edit"]] as const) {
        expect((await actor.get(`/api/assessments/${assessment.assessment_id}`)).status()).toBe(200);
        const saved = await actor.patch(`/api/assessments/${assessment.assessment_id}`, {
          data: { if_match: latest.version, patch: { data: { assessment_notes: note } } },
        });
        latest = asRecord((await responseRecord(saved, 200)).assessment);
        expect(latest.assessment_notes).toBe(note);
      }
      expect(latest.version).toBe(Number(before.version) + 2);
      expect(auditActions(latest).filter((action) => action === "assessment_updated")).toHaveLength(2);

      expect((await actors.outsider.get(`/api/assessments/${assessment.assessment_id}`)).status()).toBe(403);
      const denied = await actors.outsider.patch(`/api/assessments/${assessment.assessment_id}`, {
        data: { if_match: latest.version, patch: { data: { assessment_notes: "Outsider must not save" } } },
      });
      expect(denied.status()).toBe(403);
      const after = await readAssessment(actors.assessor, String(assessment.assessment_id));
      expect(after.version).toBe(latest.version);
      expect(after.assessment_notes).toBe(latest.assessment_notes);
      expect(after.audit_events).toEqual(latest.audit_events);
      expect((await readReferral(actors.assessor, referral.id)).workflowStatus).toBe("ready_to_schedule");
    } finally {
      await actors.dispose();
    }
  });

  test("retains imported field evidence through review and replays the import exactly once", async ({ baseURL }) => {
    const actors = await assessmentActors(baseURL);
    try {
      const referral = await createAssessmentReferral(actors.coordinator);
      const assessment = await createAssessment(actors.assessor, referral.id, "assessment-characterization-import-base");
      const importRequest = {
        assessment_id: assessment.assessment_id,
        if_match: assessment.version,
        client_mutation_id: "assessment-characterization-import",
        fields: [{
          field_key: "assessment.current_symptoms",
          proposed_value: "Synthetic imported symptoms",
          confidence: 0.87,
          source_page_no: 4,
          evidence_url: "synthetic/evidence/page-4",
        }],
        context: {
          source_file: "synthetic-assessment-packet.pdf",
          extraction_date: "2026-09-08T18:00:00.000Z",
          match_confidence: 0.91,
        },
      };
      const importedResponse = await actors.assessor.post(`/api/referrals/${referral.id}/assessments/import`, { data: importRequest });
      const imported = asRecord((await responseRecord(importedResponse, 200)).assessment);
      const replayResponse = await actors.assessor.post(`/api/referrals/${referral.id}/assessments/import`, { data: importRequest });
      const replay = asRecord((await responseRecord(replayResponse, 200)).assessment);
      expect(replay.version).toBe(imported.version);
      expect(imported.status).toBe("needs_review");
      expect(latestProvenance(imported, "current_symptoms")).toMatchObject({
        source_field_key: "assessment.current_symptoms",
        source_file: "synthetic-assessment-packet.pdf",
        source_page_no: 4,
        confidence: 0.87,
        evidence_url: "synthetic/evidence/page-4",
        review_status: "pending",
      });

      const reviewResponse = await actors.assessor.patch(`/api/assessments/${assessment.assessment_id}`, {
        data: {
          section: "diagnosis_clinical",
          if_match_section: numberRecord(imported.section_versions).diagnosis_clinical,
          client_mutation_id: "assessment-characterization-import-review",
          patch: { review_extraction: [{ field: "current_symptoms", action: "accept" }] },
        },
      });
      const reviewed = asRecord((await responseRecord(reviewResponse, 200)).assessment);
      expect(reviewed.current_symptoms).toBe("Synthetic imported symptoms");
      expect(reviewed.status).toBe("draft");
      expect(latestProvenance(reviewed, "current_symptoms")).toMatchObject({ review_status: "accepted" });
      expect(auditActions(reviewed).filter((action) => action === "assessment_imported")).toHaveLength(1);
      expect(auditActions(reviewed).filter((action) => action === "extraction_confirmed")).toHaveLength(1);
    } finally {
      await actors.dispose();
    }
  });

  test("saves overlapping appointments with an alert while stale schedule writes remain blocked", async ({ baseURL }) => {
    const actors = await assessmentActors(baseURL);
    try {
      const firstReferral = await createAssessmentReferral(actors.coordinator);
      const secondReferral = await createAssessmentReferral(actors.coordinator);
      const firstAssessment = await createAssessment(actors.assessor, firstReferral.id, "assessment-characterization-schedule-a");
      const secondAssessment = await createAssessment(actors.assessor, secondReferral.id, "assessment-characterization-schedule-b");
      const startsAt = futureTimestamp(21);

      const firstSchedule = await scheduleAssessment(
        actors.assessor,
        firstAssessment,
        startsAt,
        "assessment-characterization-schedule-first",
      );
      await responseRecord(firstSchedule, 200);
      const overlap = await scheduleAssessment(
        actors.assessor,
        secondAssessment,
        startsAt,
        "assessment-characterization-schedule-overlap",
      );
      const overlapBody = await responseRecord(overlap, 200);
      expect(overlapBody.warnings).toContain("This assessor has another assessment during that time. The appointment was saved with an overlap alert.");
      const saved = asRecord(overlapBody.assessment);
      expect(saved.schedule_status).toBe("scheduled");
      expect(saved.scheduled_start_at).toBe(startsAt);

      const override = await scheduleAssessment(
        actors.coordinator,
        secondAssessment,
        startsAt,
        "assessment-characterization-schedule-override",
        true,
      );
      await responseRecord(override, 409);
      const latest = await readAssessment(actors.assessor, String(secondAssessment.assessment_id));
      expect(latest.version).toBe(saved.version);
      expect(latest.scheduled_start_at).toBe(startsAt);
      expect(latest.audit_events).toEqual(saved.audit_events);
    } finally {
      await actors.dispose();
    }
  });

  test("keeps signed content editable until sending and synchronizes workflow stages", async ({ baseURL }) => {
    const actors = await assessmentActors(baseURL);
    try {
      const referral = await createAssessmentReferral(actors.coordinator);
      let assessment = await createAssessment(actors.assessor, referral.id, "assessment-characterization-lifecycle");
      const scheduled = await scheduleAssessment(
        actors.assessor,
        assessment,
        futureTimestamp(35),
        "assessment-characterization-lifecycle-schedule",
      );
      assessment = asRecord((await responseRecord(scheduled, 200)).assessment);
      expect((await readReferral(actors.assessor, referral.id)).workflowStatus).toBe("assessment_scheduled");

      assessment = asRecord(await readAssessmentPayload(
        actors.assessor,
        await startOperationalAssessment(actors.assessor, assessmentRecord(assessment)),
      ));
      expect((await readReferral(actors.assessor, referral.id)).workflowStatus).toBe("assessment_in_progress");

      const unsignedAddendum = await actors.coordinator.post(`/api/assessments/${assessment.assessment_id}/addenda`, {
        data: { if_match: assessment.version, note: "Must not persist", reason_code: "not_signed" },
      });
      expect(unsignedAddendum.status()).toBe(422);

      assessment = asRecord(await readAssessmentPayload(
        actors.assessor,
        await completeOperationalAssessment(actors.assessor, assessmentRecord(assessment)),
      ));
      expect((await readReferral(actors.assessor, referral.id)).workflowStatus).toBe("assessment_ready_to_sign");
      assessment = asRecord(await readAssessmentPayload(
        actors.assessor,
        await signOperationalAssessment(actors.assessor, assessmentRecord(assessment)),
      ));
      const signedSnapshot = {
        version: Number(assessment.version),
        signed_at: assessment.signed_at,
        signed_by: assessment.signed_by,
        current_symptoms: assessment.current_symptoms,
        field_provenance: assessment.field_provenance,
      };
      expect((await readReferral(actors.assessor, referral.id)).workflowStatus).toBe("assessment_signed");

      const signedEdit = await actors.assessor.patch(`/api/assessments/${assessment.assessment_id}`, {
        data: {
          if_match: assessment.version,
          client_mutation_id: operationalMutationId("signed-edit"),
          patch: { data: { current_symptoms: "This pre-send edit must persist" } },
        },
      });
      expect(signedEdit.status()).toBe(200);
      assessment = asRecord((await signedEdit.json()).assessment);

      const addendum = await actors.assessor.post(`/api/assessments/${assessment.assessment_id}/addenda`, {
        data: {
          if_match: assessment.version,
          note: "Synthetic post-signature clarification.",
          reason_code: "clinical_clarification",
        },
      });
      await responseRecord(addendum, 422);
      const staleAddendum = await actors.assessor.post(`/api/assessments/${assessment.assessment_id}/addenda`, {
        data: {
          if_match: signedSnapshot.version,
          note: "This stale addendum must not persist.",
          reason_code: "stale",
        },
      });
      expect(staleAddendum.status()).toBe(409);

      const latest = await readAssessment(actors.assessor, String(assessment.assessment_id));
      expect(latest.version).toBe(signedSnapshot.version + 1);
      expect(latest.signed_at).toBe(signedSnapshot.signed_at);
      expect(latest.signed_by).toEqual(signedSnapshot.signed_by);
      expect(latest.current_symptoms).toBe("This pre-send edit must persist");
      expect(latestProvenance(latest, "current_symptoms")).toMatchObject({ review_status: "edited" });
      expect(Array.isArray(latest.addenda) ? latest.addenda : []).toHaveLength(0);
      expect(auditActions(latest).filter((action) => action === "assessment_signed")).toHaveLength(1);
      expect(auditActions(latest).filter((action) => action === "assessment_addendum_added")).toHaveLength(0);
    } finally {
      await actors.dispose();
    }
  });
});

async function assessmentActors(baseURL: string | undefined) {
  const url = requireOperationalBaseURL(baseURL);
  const coordinator = await actorApiContext("assessmentCoordinator", url);
  const assessor = await actorApiContext("assessorA", url);
  const otherAssessor = await actorApiContext("assessorB", url);
  const viewer = await actorApiContext("viewer", url);
  const outsider = await actorApiContext("outsider", url);
  const registrations = await Promise.all([
    coordinator.get("/api/members"),
    assessor.get("/api/members"),
    otherAssessor.get("/api/members"),
    viewer.get("/api/members"),
  ]);
  expect(registrations.every((response) => response.status() === 200)).toBe(true);
  return {
    coordinator,
    assessor,
    otherAssessor,
    viewer,
    outsider,
    dispose: () => Promise.all([
      coordinator.dispose(),
      assessor.dispose(),
      otherAssessor.dispose(),
      viewer.dispose(),
      outsider.dispose(),
    ]),
  };
}

async function createAssessmentReferral(coordinator: APIRequestContext) {
  const suffix = operationalMutationId("person").replaceAll("-", "").slice(-10);
  return createOperationalReferral(
    coordinator,
    pipelineActors.assessmentCoordinator,
    {
      name: `Avery${suffix} Rivera${suffix}`,
      county: "Los Angeles",
      currentMedications: "Synthetic medication list",
      phone: "555-0100",
    },
    { assigneeId: pipelineActors.assessorA.id, mutationId: operationalMutationId("assessment-referral") },
  );
}

async function createAssessment(
  assessor: APIRequestContext,
  referralId: number,
  mutationId: string,
) {
  const response = await assessor.post(`/api/referrals/${referralId}/assessments`, {
    data: { client_mutation_id: mutationId, data: { current_location: "Synthetic referral source" } },
  });
  return asRecord((await responseRecord(response, 201)).assessment);
}

async function scheduleAssessment(
  actor: APIRequestContext,
  assessment: Record<string, unknown>,
  startsAt: string,
  mutationId: string,
  allowConflict = false,
) {
  return actor.post(`/api/assessments/${assessment.assessment_id}/schedule`, {
    data: {
      if_match: assessment.version,
      client_mutation_id: mutationId,
      ...(allowConflict ? { allow_conflict: true } : {}),
      schedule: {
        status: "scheduled",
        start_at: startsAt,
        duration_minutes: 60,
        method: "zoom",
        location: "Synthetic Zoom room",
      },
    },
  });
}

async function readAssessment(context: APIRequestContext, assessmentId: string) {
  const response = await context.get(`/api/assessments/${assessmentId}`);
  return asRecord((await responseRecord(response, 200)).assessment);
}

async function readAssessmentPayload(
  context: APIRequestContext,
  assessment: { assessment_id: string },
) {
  return readAssessment(context, assessment.assessment_id);
}

async function listAssessments(context: APIRequestContext, referralId: number) {
  const response = await context.get(`/api/referrals/${referralId}/assessments`);
  const body = await responseRecord(response, 200);
  return (Array.isArray(body.assessments) ? body.assessments : []).map(asRecord);
}

async function readReferral(context: APIRequestContext, referralId: number) {
  const response = await context.get(`/api/referrals/${referralId}`);
  return asRecord((await responseRecord(response, 200)).referral);
}

async function responseRecord(response: { status(): number; text(): Promise<string> }, expectedStatus: number) {
  const text = await response.text();
  expect(response.status(), text.slice(0, 1_000)).toBe(expectedStatus);
  return asRecord(JSON.parse(text));
}

function assessmentRecord(value: Record<string, unknown>) {
  return { assessment_id: String(value.assessment_id), version: Number(value.version) };
}

function numberRecord(value: unknown) {
  const record = asRecord(value);
  return Object.fromEntries(Object.entries(record).map(([key, raw]) => [key, Number(raw)]));
}

function latestProvenance(assessment: Record<string, unknown>, field: string) {
  const provenance = asRecord(assessment.field_provenance);
  const entries = Array.isArray(provenance[field]) ? provenance[field] : [];
  return asRecord(entries.at(-1));
}

function auditActions(assessment: Record<string, unknown>) {
  const events = Array.isArray(assessment.audit_events) ? assessment.audit_events.map(asRecord) : [];
  return events.map((event) => String(event.action));
}

function futureTimestamp(days: number) {
  const value = new Date(Date.now() + days * 24 * 60 * 60 * 1_000);
  value.setUTCHours(17, 0, 0, 0);
  return value.toISOString();
}
