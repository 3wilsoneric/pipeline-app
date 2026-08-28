import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";

import { assessmentInterviewQuestions } from "../../../lib/assessment/assessment-interview-schema";
import {
  assessmentToolFieldDefinitions,
  type AssessmentToolFieldKey,
} from "../../../lib/assessment/assessment-tool-schema";
import {
  operationalMutationId,
  syntheticReferralInput,
  type PipelineActor,
  type PipelineActorKey,
} from "./pipeline-actors";

export type OperationalReferral = {
  id: number;
  version: number;
  sectionVersions: Record<string, number>;
};

export type OperationalAssessment = {
  assessment_id: string;
  version: number;
};

export async function createOperationalReferral(
  context: APIRequestContext,
  actorKey: PipelineActorKey | PipelineActor = "assessmentCoordinator",
  overrides: Record<string, unknown> = {},
  options: { assigneeId?: string; mutationId?: string } = {},
) {
  const response = await context.post("/api/referrals", {
    data: {
      client_mutation_id: options.mutationId ?? operationalMutationId("referral"),
      referral: syntheticReferralInput(actorKey, overrides),
      ...(options.assigneeId ? { assignee_id: options.assigneeId } : {}),
    },
  });
  const bodyText = await response.text();
  expect(response.status(), bodyText.slice(0, 1_000)).toBe(201);
  return asReferralPayload(JSON.parse(bodyText)).referral;
}

export async function transitionOperationalReferral(
  context: APIRequestContext,
  referral: OperationalReferral,
  targetStage: string,
) {
  const response = await context.post(`/api/referrals/${referral.id}/transition`, {
    data: {
      if_match: referral.version,
      if_match_section: referral.sectionVersions.workflow,
      target_stage: targetStage,
    },
  });
  const bodyText = await response.text();
  expect(response.status(), bodyText.slice(0, 1_000)).toBe(200);
  return asReferralPayload(JSON.parse(bodyText)).referral;
}

export async function markOperationalPacketReviewed(
  context: APIRequestContext,
  referral: OperationalReferral,
  packetId?: string,
) {
  const response = await context.patch(`/api/referrals/${referral.id}`, {
    data: {
      if_match: referral.version,
      if_match_sections: { documents: referral.sectionVersions.documents },
      patch: {
        ...(packetId ? { packetId } : {}),
        packetStatus: "reviewed",
        documentStatus: "Reviewed",
        packetReadiness: { ready: true, blockers: [] },
        packetCompleteness: { required_total: 1, required_ready: 1, missing_items: [] },
      },
    },
  });
  const bodyText = await response.text();
  expect(response.status(), bodyText.slice(0, 1_000)).toBe(200);
  return asReferralPayload(JSON.parse(bodyText)).referral;
}

export async function createOperationalAssessment(
  context: APIRequestContext,
  referralId: number,
) {
  const response = await context.post(`/api/referrals/${referralId}/assessments`, {
    data: {
      client_mutation_id: operationalMutationId("assessment"),
      data: {
        current_location: "Synthetic referral source",
      },
    },
  });
  const bodyText = await response.text();
  expect(response.status(), bodyText.slice(0, 1_000)).toBe(201);
  return asAssessmentPayload(JSON.parse(bodyText));
}

export async function scheduleOperationalAssessment(
  context: APIRequestContext,
  assessment: OperationalAssessment,
) {
  const response = await context.post(`/api/assessments/${assessment.assessment_id}/schedule`, {
    data: {
      if_match: assessment.version,
      client_mutation_id: operationalMutationId("schedule"),
      schedule: {
        status: "scheduled",
        start_at: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
        duration_minutes: 60,
        method: "zoom",
        location: "Synthetic Zoom room",
      },
    },
  });
  const bodyText = await response.text();
  expect(response.status(), bodyText.slice(0, 1_000)).toBe(200);
  return asAssessmentPayload(JSON.parse(bodyText));
}

export async function startOperationalAssessment(
  context: APIRequestContext,
  assessment: OperationalAssessment,
) {
  const response = await context.post(`/api/assessments/${assessment.assessment_id}/start`, {
    data: {
      if_match: assessment.version,
      client_mutation_id: operationalMutationId("start"),
    },
  });
  const bodyText = await response.text();
  expect(response.status(), bodyText.slice(0, 1_000)).toBe(200);
  return asAssessmentPayload(JSON.parse(bodyText));
}

export async function completeOperationalAssessment(
  context: APIRequestContext,
  assessment: OperationalAssessment,
) {
  const response = await context.patch(`/api/assessments/${assessment.assessment_id}`, {
    data: {
      if_match: assessment.version,
      client_mutation_id: operationalMutationId("complete-assessment"),
      patch: { data: completedAssessmentData() },
    },
  });
  const bodyText = await response.text();
  expect(response.status(), bodyText.slice(0, 1_000)).toBe(200);
  return asAssessmentPayload(JSON.parse(bodyText));
}

export async function signOperationalAssessment(
  context: APIRequestContext,
  assessment: OperationalAssessment,
) {
  const response = await context.post(`/api/assessments/${assessment.assessment_id}/sign`, {
    data: {
      if_match: assessment.version,
      client_mutation_id: operationalMutationId("sign-assessment"),
    },
  });
  const bodyText = await response.text();
  expect(response.status(), bodyText.slice(0, 1_000)).toBe(200);
  return asAssessmentPayload(JSON.parse(bodyText));
}

export async function submitOperationalRecommendation(
  context: APIRequestContext,
  referral: OperationalReferral,
  assessment: OperationalAssessment,
) {
  const response = await context.put(`/api/referrals/${referral.id}/recommendation`, {
    data: {
      if_match: referral.version,
      if_match_section: referral.sectionVersions.decision,
      assessment_id: assessment.assessment_id,
      outcome: "accept",
      reason_code: "clinical_fit",
      reason_note: "Synthetic product-assurance recommendation. Contains no PHI.",
    },
  });
  const bodyText = await response.text();
  expect(response.status(), bodyText.slice(0, 1_000)).toBe(200);
  return asReferralPayload(JSON.parse(bodyText)).referral;
}

export async function recordOperationalAcceptance(
  context: APIRequestContext,
  referral: OperationalReferral,
) {
  const response = await context.put(`/api/referrals/${referral.id}/decision`, {
    data: {
      if_match: referral.version,
      if_match_section: referral.sectionVersions.decision,
      outcome: "accepted",
      reason_code: "",
      reason_note: "",
    },
  });
  const bodyText = await response.text();
  expect(response.status(), bodyText.slice(0, 1_000)).toBe(200);
  return asReferralPayload(JSON.parse(bodyText)).referral;
}

export async function resolveOperationalMoveInRequirements(
  context: APIRequestContext,
  referralId: number,
) {
  const response = await context.get(`/api/referrals/${referralId}/work-items`);
  const bodyText = await response.text();
  expect(response.status(), bodyText.slice(0, 1_000)).toBe(200);
  const body = asRecord(JSON.parse(bodyText));
  const workItems = Array.isArray(body.work_items) ? body.work_items.map(asRecord) : [];
  const unresolved = workItems.filter((item) => (
    item.requiredFor === "move_in"
    && item.blocker === true
    && !["received", "reviewed", "waived", "not_applicable"].includes(String(item.status))
  ));

  for (const item of unresolved) {
    const workItemId = String(item.id ?? "");
    const version = Number(item.version);
    const update = await context.patch(`/api/referrals/${referralId}/work-items/${workItemId}`, {
      data: {
        if_match: version,
        patch: {
          status: "waived",
          waiverReason: "Synthetic product-assurance move-in exception. Contains no PHI.",
        },
      },
    });
    const updateText = await update.text();
    expect(update.status(), updateText.slice(0, 1_000)).toBe(200);
  }
  return unresolved.length;
}

export async function mutateOperationalEhrHandoff(
  context: APIRequestContext,
  referral: OperationalReferral,
  action: "queue" | "mark_sent" | "mark_failed" | "retry",
  failureReason = "",
) {
  const response = await context.post(`/api/referrals/${referral.id}/ehr-handoff`, {
    data: {
      if_match: referral.version,
      if_match_section: referral.sectionVersions.decision,
      action,
      failure_reason: failureReason,
    },
  });
  const bodyText = await response.text();
  const body = JSON.parse(bodyText) as unknown;
  return {
    response,
    body: asRecord(body),
    referral: response.ok() ? asReferralPayload(body).referral : referral,
  };
}

export async function readOperationalReferral(
  context: APIRequestContext,
  referralId: number,
) {
  const response = await context.get(`/api/referrals/${referralId}`);
  expect(response.status()).toBe(200);
  return asReferralPayload(await response.json()).referral;
}

export async function expectApiStatus(
  responsePromise: Promise<APIResponse>,
  expectedStatus: number,
) {
  const response = await responsePromise;
  expect(response.status()).toBe(expectedStatus);
}

export function asReferralPayload(value: unknown): { referral: OperationalReferral } {
  const body = asRecord(value);
  const referral = asRecord(body.referral);
  const id = Number(referral.id);
  const version = Number(referral.version);
  const sectionVersions = asNumberRecord(referral.sectionVersions);
  if (!Number.isInteger(id) || !Number.isInteger(version)) {
    throw new Error("Referral response did not include an id and version.");
  }
  return {
    referral: {
      id,
      version,
      sectionVersions,
    },
  };
}

export function asAssessmentPayload(value: unknown): OperationalAssessment {
  const body = asRecord(value);
  const assessment = asRecord(body.assessment);
  const assessmentId = String(assessment.assessment_id ?? "");
  const version = Number(assessment.version);
  if (!assessmentId || !Number.isInteger(version)) {
    throw new Error("Assessment response did not include an assessment id and version.");
  }
  return { assessment_id: assessmentId, version };
}

export function asUploadReservation(value: unknown) {
  const body = asRecord(value);
  const packetId = String(body.packet_id ?? "");
  const uploads = Array.isArray(body.uploads) ? body.uploads.map(asRecord) : [];
  if (!packetId || uploads.length === 0) {
    throw new Error("Upload reservation response did not include packet upload targets.");
  }
  return { packet_id: packetId, uploads };
}

export function asPacketStatus(value: unknown) {
  const body = asRecord(value);
  const counts = asRecord(body.counts);
  return {
    status: String(body.status ?? ""),
    counts: {
      fields_total: Number(counts.fields_total ?? 0),
    },
  };
}

export function asPacketFields(value: unknown) {
  const body = asRecord(value);
  const fields = Array.isArray(body.fields) ? body.fields.map(asRecord) : [];
  return { fields };
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object response.");
  }
  return value as Record<string, unknown>;
}

function asNumberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).map(([key, raw]) => {
      const number = Number(raw);
      if (!Number.isInteger(number)) throw new Error(`Expected numeric section version for ${key}.`);
      return [key, number];
    }),
  );
}

const assessmentServerOwnedFields = new Set<AssessmentToolFieldKey>([
  "assessor",
  "unable_to_assess_reasons",
  "source_file",
  "match_confidence",
  "extraction_date",
]);

const assessmentYesNoFields = new Set(
  assessmentInterviewQuestions
    .filter((question) => question.control === "yes_no")
    .map((question) => question.field),
);

function completedAssessmentData() {
  const data: Partial<Record<AssessmentToolFieldKey, unknown>> = {};
  for (const definition of assessmentToolFieldDefinitions) {
    if (!definition.required_for_completion || assessmentServerOwnedFields.has(definition.key)) continue;
    data[definition.key] = assessmentTestValue(definition.key, definition.value_type);
  }
  return data;
}

function assessmentTestValue(field: AssessmentToolFieldKey, valueType: string) {
  if (field === "diagnosis_categories") return ["schizophrenia"];
  if (field === "dress_assistance_level" || field === "bathing_assistance_level") return "independent";
  if (field === "conservatorship_type") return "non_conserved";
  if (field === "ambulatory" || field === "linear_conversation" || field === "medication_adherence") return "yes";
  if (valueType === "date") return new Date().toISOString().slice(0, 10);
  if (valueType === "integer") return field.endsWith("_rating") ? 3 : 0;
  if (valueType === "string_list") return ["Synthetic recorded value"];
  if (assessmentYesNoFields.has(field)) return "no";
  return field === "resident_name" ? "Synthetic Golden Thread" : "Synthetic recorded value";
}
