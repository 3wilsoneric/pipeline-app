import { expect, test } from "@playwright/test";

import {
  actorApiContext,
  requireOperationalBaseURL,
} from "../support/pipeline-actors";
import {
  asPacketFields,
  asPacketStatus,
  asUploadReservation,
  createOperationalReferral,
  expectApiStatus,
} from "../support/operational-api";

test.describe("operational referral lifecycle scaffold", () => {
  test.skip(
    process.env.PIPELINE_OPERATIONAL_E2E !== "true",
    "Run with npm run test:e2e:operational after workflow checkpoints are ready to certify.",
  );

  test("connects referral creation, packet reservation, extraction status, and review data", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const coordinator = await actorApiContext("assessmentCoordinator", url);

    try {
      await expectApiStatus(coordinator.get("/api/auth/me"), 200);

      const created = await createOperationalReferral(coordinator, "assessmentCoordinator");
      expect(created.id).toBeGreaterThan(0);
      expect(created.version).toBe(1);

      const createUploadResponse = await coordinator.post("/api/uploads/create-url", {
        data: {
          referral_id: String(created.id),
          submitting_facility: "LA County",
          source_type: "email",
          files: [
            {
              file_id: "packet_pdf",
              filename: "operator-packet.pdf",
              content_type: "application/pdf",
              size: 1024,
            },
          ],
        },
      });
      expect(createUploadResponse.status()).toBe(200);
      const upload = asUploadReservation(await createUploadResponse.json());
      expect(upload.packet_id).toMatch(/^pkt_/);
      expect(upload.uploads).toHaveLength(1);

      const completeResponse = await coordinator.post("/api/uploads/complete", {
        data: {
          packet_id: upload.packet_id,
          uploaded_file_ids: ["packet_pdf"],
        },
      });
      expect(completeResponse.status()).toBe(200);

      const statusResponse = await coordinator.get(`/api/packets/${upload.packet_id}/status`);
      expect(statusResponse.status()).toBe(200);
      const status = asPacketStatus(await statusResponse.json());
      expect(["ready_for_review", "reviewed"]).toContain(status.status);
      expect(status.counts.fields_total).toBeGreaterThan(0);

      const fieldsResponse = await coordinator.get(`/api/packets/${upload.packet_id}/fields`);
      expect(fieldsResponse.status()).toBe(200);
      const fields = asPacketFields(await fieldsResponse.json());
      expect(fields.fields.length).toBeGreaterThan(0);
      expect(fields.fields.every((field) => typeof field.field_key === "string")).toBe(true);

      await expectApiStatus(coordinator.get(`/api/referrals/${created.id}`), 200);
      await expectApiStatus(coordinator.get(`/api/referrals/${created.id}/progress`), 200);
      await expectApiStatus(coordinator.get(`/api/referrals/${created.id}/activity`), 200);
    } finally {
      await coordinator.dispose();
    }
  });
});
