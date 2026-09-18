import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { canEditWorkspace, isUnassignedOwner } from "@/lib/pipeline/referral-ownership";
import type { Referral } from "@/lib/pipeline/referral-types";

export function canWorkAssessment(user: PipelineUser, assignedAssessorId: string | null | undefined) {
  void assignedAssessorId;
  return canEditWorkspace(user);
}

export function assessmentAssigneeForReferral(user: PipelineUser, referral: Referral) {
  if (referral.ownerId?.trim() && !isUnassignedOwner(referral.owner)) {
    return { id: referral.ownerId, name: referral.owner };
  }
  return canEditWorkspace(user)
    ? { id: user.id, name: user.name }
    : null;
}
