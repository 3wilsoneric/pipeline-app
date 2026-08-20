import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import {
  patchReferral,
  requireReferralStore,
  DuplicateReferralPacketError,
  type ReferralPatch,
} from "@/lib/pipeline/referral-store";
import { validateReferralPatch } from "@/lib/pipeline/referral-validation";
import { getReferralPatchSections, isReferralSection } from "@/lib/pipeline/referral-sections";
import type { ReferralSectionVersions } from "@/lib/pipeline/referral-types";
import { withApiLogging } from "@/lib/observability/api-logging";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";
import {
  assignedOwnerForPatch,
  requireReferralAccess,
} from "@/lib/pipeline/referral-access";
import { resolveKnownPipelineUser } from "@/lib/pipeline/known-users";

export const runtime = "nodejs";

type PatchReferralBody = {
  if_match?: number;
  if_match_sections?: Partial<ReferralSectionVersions>;
  patch?: ReferralPatch;
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
    const assignment = assignedOwnerForPatch(auth.user, access.referral, patchResult.value.owner);
    if (!assignment.ok) return assignment.response;
    const knownOwner = patchResult.value.owner !== undefined && !assignment.ownerId
      ? await resolveKnownPipelineUser(assignment.owner)
      : null;
    const patch = {
      ...patchResult.value,
      ...(patchResult.value.owner === undefined ? {} : assignment),
      ...(knownOwner ? { owner: knownOwner.name, ownerId: knownOwner.id } : {}),
    };
    const sectionVersions = validateSectionVersions(
      body.value.if_match_sections,
      getReferralPatchSections(patch),
    );
    if (!sectionVersions.ok) return jsonError(sectionVersions.message);

    let result;
    try {
      result = await patchReferral(
        id,
        patch,
        body.value.if_match,
        { id: auth.user.id, name: auth.user.name },
        sectionVersions.value,
      );
    } catch (error) {
      if (error instanceof DuplicateReferralPacketError) {
        recordPipelineMetric("pipeline.referral.save_conflicts", 1, "count", {
          operation: "patch",
          result: "duplicate_packet",
        });
        return Response.json(
          {
            error: "This exact packet is already attached to a referral. Open the existing referral instead.",
            duplicate: true,
            referral_id: error.referralId,
          },
          { status: 409 },
        );
      }
      throw error;
    }
    if (!result) return jsonError("Referral not found.", 404);

    if (!result.ok) {
      if ("blocked" in result && result.blocked) {
        return Response.json(
          {
            error: "This workflow move is blocked by required work.",
            blocked: true,
            blockers: result.blockers,
            referral: result.referral,
          },
          { status: 422 },
        );
      }

      recordPipelineMetric("pipeline.referral.save_conflicts", 1, "count", {
        operation: "patch",
        result: "conflict",
      });

      return Response.json(
        {
          error: "This referral changed in another session. Review the latest record before saving again.",
          conflict: true,
          conflicting_sections: "conflictingSections" in result ? result.conflictingSections ?? [] : [],
          referral: result.referral,
        },
        { status: 409 },
      );
    }

    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  });
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
