import "server-only";

import { findAssignableWorkspaceAssessorByName } from "@/lib/pipeline/workspace-members";

export type KnownPipelineUser = {
  id: string;
  name: string;
};

/**
 * Resolves an entered owner name only when it identifies one active assessor.
 * Historical audit actors and inactive staff must never become new assignees.
 */
export async function resolveKnownPipelineUser(name: string): Promise<KnownPipelineUser | null> {
  const normalized = name.trim();
  if (!normalized) return null;
  const assessor = await findAssignableWorkspaceAssessorByName(normalized);
  return assessor ? { id: assessor.principal_id, name: assessor.display_name } : null;
}
