import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { readPacketReferralId } from "@/lib/extraction/packet-referral";
import { isAssignedToUser, normalizedOwnerAliases } from "@/lib/pipeline/referral-ownership";
import { getReferral, getReferralByPacketId, type ReferralFileListOptions, type ReferralListOptions } from "@/lib/pipeline/referral-store";
import type { Referral } from "@/lib/pipeline/referral-types";

export function isAssessorUser(user: PipelineUser) {
  return user.roles.includes("reviewer")
    && !user.roles.includes("assessment_coordinator")
    && !user.roles.includes("admin");
}

export function canAccessReferral(user: PipelineUser, referral: Referral) {
  return !isAssessorUser(user) || isAssignedToUser(referral, user);
}

export function scopeReferralListOptions<T extends ReferralListOptions | ReferralFileListOptions>(
  user: PipelineUser,
  options: T,
): T {
  if (!isAssessorUser(user)) return options;
  return {
    ...options,
    assignedOwnerId: user.id,
    assignedOwnerNames: normalizedOwnerAliases(user),
  };
}

export async function requireReferralAccess(user: PipelineUser, referralId: number) {
  const referral = await getReferral(referralId);
  if (!referral || !canAccessReferral(user, referral)) {
    return {
      ok: false as const,
      response: Response.json({ error: "Referral not found." }, { status: 404 }),
    };
  }
  return { ok: true as const, referral };
}

export async function requirePacketAccess(user: PipelineUser, packetId: string) {
  const reservedReferralId = await readPacketReferralId(packetId);
  const referral = reservedReferralId
    ? await getReferral(reservedReferralId)
    : await getReferralByPacketId(packetId);
  if (!referral || !canAccessReferral(user, referral)) {
    return {
      ok: false as const,
      response: Response.json({ error: "Packet not found." }, { status: 404 }),
    };
  }
  return { ok: true as const, referral };
}

export function assignedOwnerForCreate(user: PipelineUser, owner: string) {
  if (isAssessorUser(user)) return { owner: user.name, ownerId: user.id };
  return normalizedOwnerAliases(user).includes(owner.trim().toLowerCase())
    ? { owner, ownerId: user.id }
    : { owner, ownerId: undefined };
}

export function assignedOwnerForPatch(
  user: PipelineUser,
  current: Referral,
  requestedOwner: string | undefined,
) {
  if (requestedOwner === undefined) {
    return { ok: true as const, owner: current.owner, ownerId: current.ownerId };
  }
  if (isAssessorUser(user) && !normalizedOwnerAliases(user).includes(requestedOwner.trim().toLowerCase())) {
    return {
      ok: false as const,
      response: Response.json({ error: "Assessors cannot reassign referrals." }, { status: 403 }),
    };
  }
  if (normalizedOwnerAliases(user).includes(requestedOwner.trim().toLowerCase())) {
    return { ok: true as const, owner: requestedOwner, ownerId: user.id };
  }
  if (requestedOwner.trim().toLowerCase() === current.owner.trim().toLowerCase()) {
    return { ok: true as const, owner: requestedOwner, ownerId: current.ownerId };
  }
  return { ok: true as const, owner: requestedOwner, ownerId: undefined };
}
