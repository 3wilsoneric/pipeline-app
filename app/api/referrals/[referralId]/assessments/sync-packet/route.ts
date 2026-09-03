import { createHash } from "node:crypto";

import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { assessmentAssigneeForReferral, canWorkAssessment } from "@/lib/assessment/assessment-access";
import {
  assessmentClientIdentityErrorResponse,
  resolveAssessmentClientIdentity,
} from "@/lib/assessment/assessment-client-identity";
import { isPacketAssessmentEvidenceField } from "@/lib/assessment/assessment-field-ownership";
import { buildAssessmentSeedFromReferral } from "@/lib/assessment/assessment-seed";
import {
  getAssessment,
  importAssessmentExtraction,
  requireAssessmentStore,
} from "@/lib/assessment/assessment-store";
import { assessmentToolFieldForExtractionKey } from "@/lib/assessment/assessment-tool-schema";
import { jsonError, readJsonBody, type ExtractedField } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";
import { requireReferralStore } from "@/lib/pipeline/referral-store";

export const runtime = "nodejs";

type SyncPacketRequest = {
  assessment_id?: unknown;
  if_match?: unknown;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/assessments/sync-packet", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const assessmentStore = requireAssessmentStore();
    if (!assessmentStore.ok) return assessmentStore.response;
    const referralStore = requireReferralStore();
    if (!referralStore.ok) return referralStore.response;

    const { referralId: rawReferralId } = await context.params;
    const referralId = Number.parseInt(rawReferralId, 10);
    if (!Number.isInteger(referralId) || referralId < 1) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    const referral = access.referral;
    const assessmentAssignee = assessmentAssigneeForReferral(auth.user, referral);
    if (!assessmentAssignee) return jsonError("Assign this referral before syncing packet evidence.", 422);
    if (!canWorkAssessment(auth.user, referral.ownerId)) {
      return jsonError("Only the assigned assessor or a supervisor can sync packet evidence.", 403);
    }

    const body = await readJsonBody<SyncPacketRequest>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!isSafeId(body.value.assessment_id) || !isPositiveInteger(body.value.if_match)) {
      return jsonError("assessment_id and if_match are required.");
    }
    const assessment = await getAssessment(body.value.assessment_id);
    if (!assessment || assessment.referral_id !== referralId) return jsonError("Assessment not found.", 404);
    if (assessment.signed_at) {
      return Response.json({ assessment, synced: false }, { headers: privateHeaders() });
    }

    const fields = (referral.packetFields ?? []).filter((field) => {
      if (field.review_status === "rejected") return false;
      const assessmentField = assessmentToolFieldForExtractionKey(field.field_key);
      return Boolean(assessmentField && isPacketAssessmentEvidenceField(assessmentField));
    });
    if (fields.length === 0) {
      return Response.json({ assessment, synced: false }, { headers: privateHeaders() });
    }

    const seed = buildAssessmentSeedFromReferral(referral, assessmentAssignee.name);
    const mutationId = packetSyncMutationId(assessment.assessment_id, referral.packetId, fields);
    try {
      const identity = await resolveAssessmentClientIdentity(request, referralId);
      const result = await importAssessmentExtraction({
        referralId,
        assignedAssessor: assessmentAssignee,
        canonicalClientId: identity.canonicalClientId,
        residentKey: identity.residentKey,
        assessmentId: assessment.assessment_id,
        expectedVersion: body.value.if_match,
        fields,
        context: {
          source_file: referral.documentName || undefined,
          extraction_date: new Date().toISOString(),
          match_confidence: averageConfidence(fields),
        },
        defaults: seed.data,
        actor: pipelineAuditActor(auth.user),
        mutationId,
      });
      if (!result) return jsonError("Assessment not found.", 404);
      if (!result.ok && "conflict" in result) {
        return Response.json({
          error: "This assessment changed in another session. Review the latest record before syncing again.",
          ...result,
        }, { status: 409 });
      }
      if (!result.ok) return Response.json({ error: "Packet evidence sync is blocked.", ...result }, { status: 422 });
      return Response.json({ ...result, synced: true }, { headers: privateHeaders() });
    } catch (error) {
      const identityResponse = assessmentClientIdentityErrorResponse(error);
      if (identityResponse) return identityResponse;
      return jsonError(error instanceof Error ? error.message : "Could not sync packet evidence.", 400);
    }
  });
}

function packetSyncMutationId(
  assessmentId: string,
  packetId: string | undefined,
  fields: ExtractedField[],
) {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      packet_id: packetId ?? null,
      fields: fields.map((field) => ({
        key: field.field_key,
        version: field.version,
        value: field.final_value ?? field.proposed_value,
        status: field.review_status,
      })),
    }))
    .digest("hex")
    .slice(0, 24);
  return `packet-sync:${assessmentId}:${digest}`.slice(0, 128);
}

function averageConfidence(fields: Array<{ confidence: number }>) {
  if (fields.length === 0) return undefined;
  return fields.reduce((total, field) => total + field.confidence, 0) / fields.length;
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9_.:-]+$/.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
