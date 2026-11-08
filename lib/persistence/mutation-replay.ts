import "server-only";

import { createHash } from "node:crypto";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";

// Supplied only by server code after authentication and request validation.
// Keep client commands separate from changing seeds, timestamps and defaults.
export type MutationReplayRequest = {
  principal: readonly string[];
  command: unknown;
};

export function mutationReplayRequest(user: PipelineUser, command: unknown): MutationReplayRequest {
  return { principal: [user.delegation?.initiatedBy.id ?? user.id, user.id], command };
}

export function mutationRequestFingerprint(
  operation: string,
  target: string,
  actor: { id: string },
  command: unknown,
  request?: MutationReplayRequest,
) {
  return createHash("sha256").update(JSON.stringify(canonicalValue({
    version: 1,
    operation,
    target,
    principal: request?.principal ?? [actor.id, actor.id],
    command: request ? request.command : command,
  }))).digest("hex");
}

export class MutationReplayConflictError extends Error {
  constructor() {
    super("This retry cannot be matched to its original request. Reload and reconcile the saved record before trying again.");
    this.name = "MutationReplayConflictError";
  }
}

export function assertMutationReplayFingerprint(stored: unknown, expected: string) {
  // Legacy entries lack the original command. Do not infer it from mutable
  // records or treat an old key as new: either can disclose or duplicate data.
  if (stored !== expected) throw new MutationReplayConflictError();
}

// A persisted key must resolve to its original, still-available entity. Missing
// or legacy entries must never fall through to a second creation.
export function resolveMutationReplay<T, Id extends string | number>(
  entityId: Id | undefined,
  storedFingerprint: unknown,
  expectedFingerprint: string,
  resolveEntity: (id: Id) => T | null | undefined,
): T | null {
  if (entityId === undefined) return null;
  assertMutationReplayFingerprint(storedFingerprint, expectedFingerprint);
  const entity = resolveEntity(entityId);
  if (!entity) throw new MutationReplayConflictError();
  return entity;
}

// Route-specific fallback handlers must let the shared API boundary preserve
// the typed 409 response rather than convert it to their generic 400/507.
export function rethrowMutationReplayConflict(error: unknown): void {
  if (error instanceof MutationReplayConflictError) throw error;
}

export function mutationReplayErrorResponse(error: unknown) {
  return error instanceof MutationReplayConflictError
    ? Response.json({ error: error.message, code: "mutation_replay_conflict" }, { status: 409 })
    : null;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}
