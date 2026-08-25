import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { isUnassignedOwner } from "@/lib/pipeline/referral-ownership";
import type { Referral } from "@/lib/pipeline/referral-types";

export function isAssessmentSupervisor(user: PipelineUser) {
  return user.roles.includes("admin") || user.roles.includes("assessment_coordinator");
}

export function canWorkAssessment(user: PipelineUser, assignedAssessorId: string | null | undefined) {
  return isAssessmentSupervisor(user) || assignedAssessorId === user.id;
}

export function assessmentAssigneeForReferral(user: PipelineUser, referral: Referral) {
  if (referral.ownerId?.trim() && !isUnassignedOwner(referral.owner)) {
    return { id: referral.ownerId, name: referral.owner };
  }
  return isAssessmentSupervisor(user)
    ? { id: user.id, name: user.name }
    : null;
}
