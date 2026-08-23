import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { requirePipelineUser, type PipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import {
  patchReferral,
  requireReferralStore,
  DuplicateReferralPacketError,
  softDeleteReferral,
  type ReferralConflict,
  type ReferralPatch,
} from "@/lib/pipeline/referral-store";
import { validateReferralPatch } from "@/lib/pipeline/referral-validation";
import { getReferralPatchSections, isReferralSection } from "@/lib/pipeline/referral-sections";
import type { Referral, ReferralSectionVersions } from "@/lib/pipeline/referral-types";
import { withApiLogging } from "@/lib/observability/api-logging";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";
import {
  assignedOwnerForPatch,
  isAssessorUser,
  requireReferralAccess,
} from "@/lib/pipeline/referral-access";
import { resolveKnownPipelineUser } from "@/lib/pipeline/known-users";
import { isUnassignedOwner } from "@/lib/pipeline/referral-ownership";
import { getActiveWorkspaceMember, touchWorkspaceMember, type WorkspaceMember } from "@/lib/pipeline/workspace-members";

export const runtime = "nodejs";

type PatchReferralBody = {
  if_match?: number;
  if_match_sections?: Partial<ReferralSectionVersions>;
  patch?: ReferralPatch;
  assignee_id?: string;
  handoff_reason?: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const { referralId } = await context.params;
    const id = Number.parseInt(referralId, 10);
    if (!Number.isInteger(id) || id < 1) return jsonError("referralId is invalid.");

    const access = await requireReferralAccess(auth.user, id);
    if (!access.ok) return access.response;

    return Response.json({ referral: access.referral }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const store = requireReferralStore();
    if (!store.ok) return store.response;
    const { referralId } = await context.params;
    const id = Number.parseInt(referralId, 10);
    if (!Number.isInteger(id) || id < 1) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, id);
    if (!access.ok) return access.response;
    const body = await readJsonBody<{ if_match?: number }>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    const expectedVersion = body.value?.if_match;
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      return jsonError("if_match must be a positive version number.");
    }
    const result = await softDeleteReferral(id, { id: auth.user.id, name: auth.user.name }, expectedVersion);
    if (!result) return jsonError("Referral not found.", 404);
    if (!result.ok) {
      return Response.json({
        error: "This referral changed in another session. Reload it before moving it to trash.",
        conflict: true,
        referral: result.referral,
      }, { status: 409 });
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]", async () => {
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

    const { referralId } = await context.params;
    const id = Number.parseInt(referralId, 10);
    if (!Number.isInteger(id) || id < 1) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, id);
    if (!access.ok) return access.response;

    const body = await readJsonBody<PatchReferralBody>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) {
      return jsonError("The request body must be an object.");
    }
    if (!Number.isInteger(body.value.if_match) || Number(body.value.if_match) < 1) {
      return jsonError("if_match must be a positive version number.");
    }
    const patchResult = validateReferralPatch(body.value.patch);
    if (!patchResult.ok) return jsonError(patchResult.message, patchResult.status);
    const ownerResult = await resolveOwnerPatch({
      user: auth.user,
      current: access.referral,
      requestedPatch: patchResult.value,
      assigneeId: body.value.assignee_id,
      handoffReason: body.value.handoff_reason,
    });
    if (!ownerResult.ok) return ownerResult.response;
    const sectionVersions = validateSectionVersions(
      body.value.if_match_sections,
      getReferralPatchSections(ownerResult.patch),
    );
    if (!sectionVersions.ok) return jsonError(sectionVersions.message);

    return applyReferralPatch({
      id,
      patch: ownerResult.patch,
      expectedVersion: body.value.if_match,
      expectedSectionVersions: sectionVersions.value,
      user: auth.user,
      ownerChanged: ownerResult.ownerChanged,
      handoffReason: ownerResult.handoffReason,
    });
  });
}

type OwnerPatchInput = {
  user: PipelineUser;
  current: Referral;
  requestedPatch: ReferralPatch;
  assigneeId?: string;
  handoffReason?: string;
};

async function resolveOwnerPatch(input: OwnerPatchInput): Promise<
  | { ok: true; patch: ReferralPatch; ownerChanged: boolean; handoffReason: string }
  | { ok: false; response: Response }
> {
  await touchWorkspaceMember(input.user);
  const assignment = assignedOwnerForPatch(input.user, input.current, input.requestedPatch.owner);
  if (!assignment.ok) return assignment;
  const selectedOwnerResult = await resolveSelectedOwner(input.user, input.assigneeId);
  if (!selectedOwnerResult.ok) return selectedOwnerResult;
  const selectedOwner = selectedOwnerResult.member;
  const knownOwner = input.requestedPatch.owner !== undefined && !assignment.ownerId && !selectedOwner
    ? await resolveKnownPipelineUser(assignment.owner)
    : null;
  if (input.requestedPatch.owner !== undefined && !selectedOwner && !assignment.ownerId && !knownOwner && !isUnassignedOwner(assignment.owner)) {
    return { ok: false, response: jsonError("Choose an active Pipeline member as owner.", 422) };
  }
  const assignedOwner = input.requestedPatch.owner === undefined
    ? {}
    : { owner: assignment.owner, ownerId: assignment.ownerId };
  const patch: ReferralPatch = {
    ...input.requestedPatch,
    ...assignedOwner,
    ...(selectedOwner ? { owner: selectedOwner.display_name, ownerId: selectedOwner.principal_id } : {}),
    ...(knownOwner ? { owner: knownOwner.name, ownerId: knownOwner.id } : {}),
  };
  const ownerChanged = patch.owner !== undefined
    && (patch.ownerId ?? "") !== (input.current.ownerId ?? "");
  const handoffReason = typeof input.handoffReason === "string" ? input.handoffReason.trim() : "";
  const handoffFailure = validateHandoff(input.current, ownerChanged, handoffReason);
  if (handoffFailure) return { ok: false, response: handoffFailure };
  return { ok: true, patch, ownerChanged, handoffReason };
}

function validateHandoff(current: Referral, ownerChanged: boolean, handoffReason: string): Response | null {
  if (ownerChanged && !isUnassignedOwner(current.owner) && handoffReason.length < 3) {
    return jsonError("Record a brief handoff reason when reassigning an active referral.", 422);
  }
  return handoffReason.length > 500 ? jsonError("handoff_reason is too long.") : null;
}

async function resolveSelectedOwner(
  user: PipelineUser,
  assigneeId: string | undefined,
): Promise<{ ok: true; member: WorkspaceMember | null } | { ok: false; response: Response }> {
  const member = typeof assigneeId === "string" ? await getActiveWorkspaceMember(assigneeId) : null;
  if (assigneeId !== undefined && !member) {
    return { ok: false, response: jsonError("Choose an active Pipeline member as owner.", 422) };
  }
  if (member && isAssessorUser(user) && member.principal_id !== user.id) {
    return { ok: false, response: jsonError("Assessors cannot reassign referrals.", 403) };
  }
  return { ok: true, member };
}

type ApplyReferralPatchInput = {
  id: number;
  patch: ReferralPatch;
  expectedVersion?: number;
  expectedSectionVersions?: Partial<ReferralSectionVersions>;
  user: PipelineUser;
  ownerChanged: boolean;
  handoffReason: string;
};

async function applyReferralPatch(input: ApplyReferralPatchInput): Promise<Response> {
  let result;
  try {
    result = await patchReferral(
      input.id,
      input.patch,
      input.expectedVersion,
      { id: input.user.id, name: input.user.name },
      input.expectedSectionVersions,
      input.ownerChanged ? { auditAction: "referral_reassigned", auditReason: input.handoffReason } : undefined,
    );
  } catch (error) {
    if (error instanceof DuplicateReferralPacketError) return duplicatePacketResponse(error);
    throw error;
  }
  if (!result) return jsonError("Referral not found.", 404);
  if (!result.ok && "blocked" in result && result.blocked) {
    return Response.json({
      error: "This workflow move is blocked by required work.",
      blocked: true,
      blockers: result.blockers,
      referral: result.referral,
    }, { status: 422 });
  }
  if (!result.ok && "conflict" in result) return referralConflictResponse(result);
  if (!result.ok) return jsonError("The referral could not be saved.", 409);
  return Response.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

function duplicatePacketResponse(error: DuplicateReferralPacketError): Response {
  recordPipelineMetric("pipeline.referral.save_conflicts", 1, "count", {
    operation: "patch",
    result: "duplicate_packet",
  });
  return Response.json({
    error: "This exact packet is already attached to a referral. Open the existing referral instead.",
    duplicate: true,
    referral_id: error.referralId,
  }, { status: 409 });
}

function referralConflictResponse(result: ReferralConflict): Response {
  recordPipelineMetric("pipeline.referral.save_conflicts", 1, "count", {
    operation: "patch",
    result: "conflict",
  });
  return Response.json({
    error: "This referral changed in another session. Review the latest record before saving again.",
    conflict: true,
    conflicting_sections: "conflictingSections" in result ? result.conflictingSections ?? [] : [],
    referral: result.referral,
  }, { status: 409 });
}

function validateSectionVersions(
  value: unknown,
  touchedSections: ReturnType<typeof getReferralPatchSections>,
): { ok: true; value?: Partial<ReferralSectionVersions> } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "if_match_sections must be an object." };
  }

  const versions: Partial<ReferralSectionVersions> = {};
  for (const [section, version] of Object.entries(value)) {
    if (!isReferralSection(section)) return { ok: false, message: `Unknown referral section: ${section}.` };
    if (!Number.isInteger(version) || Number(version) < 1) {
      return { ok: false, message: `if_match_sections.${section} must be a positive version number.` };
    }
    versions[section] = Number(version);
  }
  const missing = touchedSections.filter((section) => versions[section] === undefined);
  if (missing.length > 0) {
    return { ok: false, message: `if_match_sections is missing: ${missing.join(", ")}.` };
  }
  return { ok: true, value: versions };
}
