import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { isKeysetCursor } from "@/lib/pipeline/keyset-cursor";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import {
  listWorkspaceActivity,
  WorkspaceActivityAccessError,
} from "@/lib/pipeline/workspace-activity";
import {
  workspaceActivityScopes,
  type WorkspaceActivityScope,
} from "@/lib/pipeline/workspace-activity-types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/operations/activity", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;
    const parsed = parseActivityQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return jsonError(parsed.message);
    try {
      const result = await listWorkspaceActivity(auth.user, parsed.value);
      return Response.json(result, {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    } catch (error) {
      if (error instanceof WorkspaceActivityAccessError) return jsonError(error.message, 403);
      throw error;
    }
  });
}

function parseActivityQuery(searchParams: URLSearchParams):
  | { ok: true; value: { scope: WorkspaceActivityScope; limit: number; cursor?: string; since?: string } }
  | { ok: false; message: string } {
  const scope = optionalQueryValue(searchParams, "scope") ?? "attention";
  if (!workspaceActivityScopes.includes(scope as WorkspaceActivityScope)) {
    return { ok: false, message: "scope is invalid." };
  }
  const parsedLimit = parseActivityLimit(optionalQueryValue(searchParams, "limit"));
  if (!parsedLimit.ok) return parsedLimit;
  const cursor = optionalQueryValue(searchParams, "cursor");
  if (cursor && !isKeysetCursor(cursor)) return { ok: false, message: "cursor is invalid." };
  const since = optionalQueryValue(searchParams, "since");
  if (since && !Number.isFinite(Date.parse(since))) return { ok: false, message: "since must be a valid timestamp." };
  return {
    ok: true,
    value: { scope: scope as WorkspaceActivityScope, limit: parsedLimit.value, cursor, since },
  };
}

function optionalQueryValue(searchParams: URLSearchParams, name: string) {
  const value = searchParams.get(name)?.trim();
  return value ? value : undefined;
}

function parseActivityLimit(value?: string):
  | { ok: true; value: number }
  | { ok: false; message: string } {
  if (!value) return { ok: true, value: 40 };
  const limit = Number(value);
  if (!Number.isInteger(limit)) return { ok: false, message: "limit must be a whole number between 1 and 100." };
  if (limit < 1 || limit > 100) return { ok: false, message: "limit must be a whole number between 1 and 100." };
  return { ok: true, value: limit };
}
