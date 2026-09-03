import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import {
  createReferral,
  DuplicateReferralPacketError,
  listReferrals,
  requireReferralStore,
  type ReferralCreateInput,
} from "@/lib/pipeline/referral-store";
import { validateReferralCreateInput } from "@/lib/pipeline/referral-validation";
import { parseReferralListQuery } from "@/lib/pipeline/referral-query";
import { getReferralProgress } from "@/lib/pipeline/referral-progress";
import { getReferralWorkflowContexts } from "@/lib/pipeline/workflow-store";
import { withApiLogging } from "@/lib/observability/api-logging";
import { assignedOwnerForCreate, isAssessorUser, scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { resolveKnownPipelineUser } from "@/lib/pipeline/known-users";
import { isUnassignedOwner } from "@/lib/pipeline/referral-ownership";
import { getActiveWorkspaceMember, touchWorkspaceMember } from "@/lib/pipeline/workspace-members";
import { createDefaultAdmissionRequirements, isRequirementComplete } from "@/lib/pipeline/workflow-records";
import type { Referral } from "@/lib/pipeline/referral-types";
import { applyReviewedClinicalIdentity } from "@/lib/pipeline/referral-clinical-identity";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";

export const runtime = "nodejs";

type CreateReferralBody = {
  referral?: ReferralCreateInput;
  client_mutation_id?: string;
  assignee_id?: string;
};

type ReferralListProjection = "full" | "summary";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/referrals", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const url = new URL(request.url);
    const projection = parseReferralListProjection(url.searchParams);
    if (!projection.ok) return jsonError(projection.message);
    const query = parseReferralListQuery(url.searchParams);
    if (!query.ok) return jsonError(query.message);
    const requestedOptions = query.value.queue === "my_work"
      ? { ...query.value, queue: undefined, activeOnly: true }
      : query.value;
    const options = scopeReferralListOptions(auth.user, requestedOptions);
    const result = await listReferrals(options);
    if (projection.value === "summary") {
      return Response.json({
        ...result,
        referrals: result.referrals.map(toReferralListSummary),
        projection: "summary",
      }, {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      });
    }

    const referrals = await applyReviewedClinicalIdentity(request, auth.user.id, result.referrals);
    const contexts = await getReferralWorkflowContexts(referrals);
    const progress = Object.fromEntries(referrals.map((referral) => [
      referral.id,
      getReferralProgress(referral, contexts.get(referral.id)),
    ]));

    return Response.json({ ...result, referrals, progress }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/referrals", async () => {
    const auth = await requirePipelineUser(request, [
      "admin",
      "assessment_coordinator",
      "reviewer",
    ]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const body = await readJsonBody<CreateReferralBody>(request);
    if (!body.ok) return jsonError(body.message, body.status);

    if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
      return jsonError("The request body must be an object.");
    }

    const referralResult = validateReferralCreateInput(body.value.referral);
    if (!referralResult.ok) return jsonError(referralResult.message, referralResult.status);
    await touchWorkspaceMember(auth.user);
    const assignment = assignedOwnerForCreate(auth.user, referralResult.value.owner);
    const selectedOwner = typeof body.value.assignee_id === "string"
      ? await getActiveWorkspaceMember(body.value.assignee_id)
      : null;
    if (body.value.assignee_id !== undefined && !selectedOwner) {
      return jsonError("Choose an active Pipeline member as owner.", 422);
    }
    if (selectedOwner && isAssessorUser(auth.user) && selectedOwner.principal_id !== auth.user.id) {
      return jsonError("Assessors can assign new referrals only to themselves.", 403);
    }
    const knownOwner = selectedOwner || assignment.ownerId ? null : await resolveKnownPipelineUser(assignment.owner);
    if (!selectedOwner && !assignment.ownerId && !knownOwner && !isUnassignedOwner(assignment.owner)) {
      return jsonError("Choose an active Pipeline member as owner.", 422);
    }
    const assignedReferral = {
      ...referralResult.value,
      ...assignment,
      ...(selectedOwner ? { owner: selectedOwner.display_name, ownerId: selectedOwner.principal_id } : {}),
      ...(knownOwner ? { owner: knownOwner.name, ownerId: knownOwner.id } : {}),
    };
    const defaultRequirements = createDefaultAdmissionRequirements(
      assignedReferral.requirements ?? [],
      {},
      assignedReferral.createdAt,
      assignedReferral.owner,
      assignedReferral.ownerId,
      {
        date_of_birth: assignedReferral.dob,
        community: assignedReferral.community,
        referral_source: assignedReferral.source,
      },
    );
    const defaultTypes = new Set(defaultRequirements.map((requirement) => requirement.type));
    const referral = {
      ...assignedReferral,
      requirements: [
        ...defaultRequirements,
        ...(assignedReferral.requirements ?? []).filter((requirement) => !defaultTypes.has(requirement.type)),
      ],
    };

    if (
      body.value.client_mutation_id !== undefined &&
      (typeof body.value.client_mutation_id !== "string" || !isSafeMutationId(body.value.client_mutation_id))
    ) {
      return jsonError("client_mutation_id is invalid.");
    }

    try {
      const result = await createReferral(
        referral,
        body.value.client_mutation_id,
        pipelineAuditActor(auth.user),
      );

      recordWorkspaceMaterialization(result.referral, result.idempotentReplay);

      return Response.json({
        referral: result.referral,
        revision: result.revision,
        idempotent_replay: result.idempotentReplay,
      }, {
        status: 201,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      });
    } catch (error) {
      if (error instanceof DuplicateReferralPacketError) {
        return Response.json(
          {
            error: "This exact packet is already attached to a referral. Open the existing referral instead.",
            duplicate: true,
            referral_id: error.referralId,
          },
          { status: 409 },
        );
      }
      return jsonError(
        error instanceof Error ? error.message : "Could not create referral.",
        507,
      );
    }
  });
}

function recordWorkspaceMaterialization(referral: Referral, idempotentReplay: boolean) {
  recordPipelineMetric("pipeline.intake.workspace_materialization", 1, "count", {
    result: idempotentReplay ? "replayed" : "created",
    assignment: isUnassignedOwner(referral.owner) ? "unassigned" : "assigned",
    packet: referral.documentName ? "present" : "missing",
  });
}

function isSafeMutationId(value: string) {
  return value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9_.:-]+$/.test(value);
}

function parseReferralListProjection(searchParams: URLSearchParams):
  | { ok: true; value: ReferralListProjection }
  | { ok: false; message: string } {
  const raw = searchParams.get("projection")?.trim() || "full";
  if (raw === "full" || raw === "summary") return { ok: true, value: raw };
  return { ok: false, message: "projection is invalid." };
}

function toReferralListSummary(referral: Referral) {
  const requirements = referral.requirements ?? [];
  return {
    id: referral.id,
    version: referral.version,
    clientId: referral.clientId,
    workspaceStatus: referral.workspaceStatus,
    name: referral.name,
    date: referral.date,
    stage: referral.stage,
    workflowStatus: referral.workflowStatus,
    community: referral.community,
    county: referral.county,
    source: referral.source,
    priority: referral.priority,
    tags: referral.tags ?? [],
    documentName: referral.documentName,
    documentStatus: referral.documentStatus,
    ownerId: referral.ownerId,
    owner: referral.owner,
    createdAt: referral.createdAt,
    updatedAt: referral.updatedAt,
    dob: referral.dob,
    gender: referral.gender,
    payer: referral.payer,
    packetId: referral.packetId,
    packetStatus: referral.packetStatus,
    packetReadiness: referral.packetReadiness
      ? {
          ready: referral.packetReadiness.ready,
          blocker_count: referral.packetReadiness.blockers.length,
        }
      : undefined,
    sourceMaterialCount: referral.sourceMaterialCount,
    admissionDate: referral.admissionDate,
    responsiblePerson: referral.responsiblePerson,
    requirementCount: requirements.length,
    openRequirementCount: requirements.filter((requirement) => !isRequirementComplete(requirement.status)).length,
    hasAssessment: Boolean(referral.assessment),
    hasDecision: Boolean(referral.admissionDecision),
    ehrHandoffStatus: referral.ehrHandoff?.status,
  };
}
