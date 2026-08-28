import { expect, test } from "@playwright/test";

import {
  actorApiContext,
  operationalMutationId,
  pipelineActors,
  requireOperationalBaseURL,
} from "../support/pipeline-actors";
import {
  asPacketStatus,
  asRecord,
  asUploadReservation,
  completeOperationalAssessment,
  createOperationalAssessment,
  createOperationalReferral,
  markOperationalPacketReviewed,
  mutateOperationalEhrHandoff,
  readOperationalReferral,
  recordOperationalAcceptance,
  resolveOperationalMoveInRequirements,
  scheduleOperationalAssessment,
  signOperationalAssessment,
  startOperationalAssessment,
  submitOperationalRecommendation,
  transitionOperationalReferral,
} from "../support/operational-api";

test.describe("role-separated referral golden thread", () => {
  test.skip(
    process.env.PIPELINE_OPERATIONAL_E2E !== "true",
    "Run with npm run test:e2e:operational after workflow checkpoints are ready to certify.",
  );

  test("carries one governed referral from intake packet through EHR recovery", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const assessor = await actorApiContext("assessorA", url);
    const otherAssessor = await actorApiContext("assessorB", url);
    const supervisor = await actorApiContext("admin", url);
    const viewer = await actorApiContext("viewer", url);

    try {
      const registrations = await Promise.all([
        coordinator.get("/api/members"),
        assessor.get("/api/members"),
        otherAssessor.get("/api/members"),
        supervisor.get("/api/members"),
        viewer.get("/api/members"),
      ]);
      expect(registrations.every((response) => response.status() === 200)).toBe(true);

      let referral = await createOperationalReferral(
        coordinator,
        pipelineActors.assessmentCoordinator,
        {
          name: "Synthetic Golden Thread",
          date: new Date().toISOString().slice(0, 10),
          community: "San Pablo",
          county: "Los Angeles",
          source: "LA County secure referral email",
          priority: "urgent",
          tags: ["golden-thread", "product-assurance"],
          documentName: "synthetic-golden-thread.pdf",
          documentStatus: "Uploaded",
          currentMedications: "Lithium 300 mg twice daily; Risperidone 2 mg nightly",
          phone: "555-0100",
          email: "synthetic@example.invalid",
          payer: "Synthetic county coverage",
          note: "Synthetic role-separated product assurance record. Contains no PHI.",
        },
        {
          assigneeId: pipelineActors.assessorA.id,
          mutationId: operationalMutationId("golden-thread-referral"),
        },
      );
      expect(referral.version).toBe(1);

      const reservationResponse = await coordinator.post("/api/uploads/create-url", {
        data: {
          referral_id: String(referral.id),
          submitting_facility: "LA County",
          source_type: "email",
          files: [{
            file_id: "golden_thread_packet",
            filename: "synthetic-golden-thread.pdf",
            content_type: "application/pdf",
            size: 2_048,
          }],
        },
      });
      const reservationText = await reservationResponse.text();
      expect(reservationResponse.status(), reservationText.slice(0, 1_000)).toBe(200);
      const reservation = asUploadReservation(JSON.parse(reservationText));

      const completeUpload = await coordinator.post("/api/uploads/complete", {
        data: {
          packet_id: reservation.packet_id,
          uploaded_file_ids: ["golden_thread_packet"],
        },
      });
      const completeUploadText = await completeUpload.text();
      expect(completeUpload.status(), completeUploadText.slice(0, 1_000)).toBe(200);
      const packetStatusResponse = await coordinator.get(`/api/packets/${reservation.packet_id}/status`);
      expect(packetStatusResponse.status()).toBe(200);
      expect(["ready_for_review", "reviewed"]).toContain(
        asPacketStatus(await packetStatusResponse.json()).status,
      );

      referral = await transitionOperationalReferral(coordinator, referral, "Packet Needed");
      referral = await transitionOperationalReferral(coordinator, referral, "Packet Review");
      referral = await markOperationalPacketReviewed(coordinator, referral, reservation.packet_id);
      referral = await transitionOperationalReferral(coordinator, referral, "Assessment");

      const hiddenFromOtherAssessor = await otherAssessor.get(`/api/referrals/${referral.id}`);
      expect(hiddenFromOtherAssessor.status()).toBe(404);

      let assessment = await createOperationalAssessment(assessor, referral.id);
      const seededAssessmentResponse = await assessor.get(`/api/assessments/${assessment.assessment_id}`);
      expect(seededAssessmentResponse.status()).toBe(200);
      const seededAssessment = asRecord(asRecord(await seededAssessmentResponse.json()).assessment);
      expect(seededAssessment.medications_at_intake).toEqual([
        "Lithium 300 mg twice daily",
        "Risperidone 2 mg nightly",
      ]);

      assessment = await scheduleOperationalAssessment(assessor, assessment);
      assessment = await startOperationalAssessment(assessor, assessment);

      const unauthorizedDecision = await assessor.put(`/api/referrals/${referral.id}/decision`, {
        data: {
          if_match: referral.version,
          if_match_section: referral.sectionVersions.decision,
          outcome: "accepted",
        },
      });
      expect(unauthorizedDecision.status()).toBe(403);

      assessment = await completeOperationalAssessment(assessor, assessment);
      assessment = await signOperationalAssessment(assessor, assessment);
      referral = await readOperationalReferral(assessor, referral.id);
      referral = await submitOperationalRecommendation(assessor, referral, assessment);
      referral = await recordOperationalAcceptance(supervisor, referral);

      const blockedMoveIn = await supervisor.post(`/api/referrals/${referral.id}/transition`, {
        data: {
          if_match: referral.version,
          if_match_section: referral.sectionVersions.workflow,
          target_stage: "Accepted / Admitted",
        },
      });
      expect(blockedMoveIn.status()).toBe(422);
      expect(await resolveOperationalMoveInRequirements(supervisor, referral.id)).toBeGreaterThan(0);
      referral = await readOperationalReferral(supervisor, referral.id);
      referral = await transitionOperationalReferral(supervisor, referral, "Accepted / Admitted");

      const queued = await mutateOperationalEhrHandoff(supervisor, referral, "queue");
      expect(queued.response.status()).toBe(200);
      expect(queued.body.ehr_handoff).toEqual(expect.objectContaining({ status: "queued" }));
      referral = queued.referral;

      const staleWrite = await supervisor.post(`/api/referrals/${referral.id}/ehr-handoff`, {
        data: { if_match: 1, if_match_section: 1, action: "mark_sent" },
      });
      expect(staleWrite.status()).toBe(409);

      const missingFailureReason = await mutateOperationalEhrHandoff(supervisor, referral, "mark_failed");
      expect(missingFailureReason.response.status()).toBe(422);
      const failed = await mutateOperationalEhrHandoff(
        supervisor,
        referral,
        "mark_failed",
        "Synthetic downstream EHR rejection.",
      );
      expect(failed.response.status()).toBe(200);
      expect(failed.body.ehr_handoff).toEqual(expect.objectContaining({ status: "failed" }));
      referral = failed.referral;

      const supervisorQueue = await supervisor.get("/api/operations/supervisor-queue");
      expect(supervisorQueue.status()).toBe(200);
      expect(asRecord(await supervisorQueue.json()).items).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "ehr_handoff_failed", referral_id: referral.id }),
      ]));

      const retried = await mutateOperationalEhrHandoff(supervisor, referral, "retry");
      expect(retried.response.status()).toBe(200);
      referral = retried.referral;
      const sent = await mutateOperationalEhrHandoff(supervisor, referral, "mark_sent");
      expect(sent.response.status()).toBe(200);
      expect(sent.body.ehr_handoff).toEqual(expect.objectContaining({ status: "sent" }));

      const viewerRead = await viewer.get(`/api/referrals/${referral.id}`);
      expect(viewerRead.status()).toBe(200);
      const viewerMutation = await viewer.patch(`/api/referrals/${referral.id}`, {
        data: { if_match: sent.referral.version, patch: { note: "Viewer must not save." } },
      });
      expect(viewerMutation.status()).toBe(403);

      const finalReferral = asRecord(asRecord(await viewerRead.json()).referral);
      expect(finalReferral.stage).toBe("Accepted / Admitted");
      expect(asRecord(finalReferral.ehrHandoff).status).toBe("sent");
      expect(asRecord(finalReferral.admissionDecision).outcome).toBe("accepted");

      const activityResponse = await supervisor.get(`/api/referrals/${referral.id}/activity`);
      expect(activityResponse.status()).toBe(200);
      const activity = asRecord(await activityResponse.json());
      const metadata = asRecord(activity.metadata);
      expect(asRecord(metadata.timing).decision_recorded).toBe(true);
      expect(asRecord(metadata.assessment).status).toBe("complete");
      expect(Array.isArray(activity.events)).toBe(true);
    } finally {
      await Promise.all([
        coordinator.dispose(),
        assessor.dispose(),
        otherAssessor.dispose(),
        supervisor.dispose(),
        viewer.dispose(),
      ]);
    }
  });
});
