import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  ClinicalDataError,
  getClinicalClients,
} from "@/lib/clinical/clinical-data";
import { withApiLogging } from "@/lib/observability/api-logging";
import type {
  ClientWorkspaceDirectoryItem,
  ClientWorkspaceDirectoryResponse,
} from "@/lib/pipeline/client-workspace-contracts";
import {
  getClinicalClientWorkspaceSummaries,
  listPipelineClientWorkspaces,
} from "@/lib/pipeline/client-workspace-store";

export const runtime = "nodejs";

type DirectoryCursor = { phase: "clinical"; cursor: string } | { phase: "pipeline"; offset: number };

export async function GET(request: Request) {
  return withApiLogging(request, "/api/profiles/directory", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer", "viewer"]);
    if (!auth.ok) return auth.response;
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const community = url.searchParams.get("community")?.trim() ?? "";
    const limit = boundedInteger(url.searchParams.get("limit"), 200, 1, 200);
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    if (query.length > 200) return jsonError("q must be 200 characters or fewer.");
    if (community.length > 128) return jsonError("community must be 128 characters or fewer.");
    if (url.searchParams.get("cursor") && !cursor) return jsonError("cursor is invalid.");

    if (cursor?.phase === "pipeline") {
      return Response.json(
        await pipelinePage(request, auth.user, query, community, limit, cursor.offset, true),
        { headers: privateHeaders() },
      );
    }

    try {
      const clinical = await getClinicalClients(request, {
        query,
        community,
        limit,
        cursor: cursor?.phase === "clinical" ? cursor.cursor : undefined,
      });
      const pipeline = await listPipelineClientWorkspaces(auth.user, {
        query,
        community,
        limit: 1,
        excludeConfirmed: true,
      });
      const summaries = await getClinicalClientWorkspaceSummaries(
        auth.user,
        clinical.clients.map((client) => ({
          canonicalClientId: client.canonical_client_id,
          residentNumbers: client.resident_numbers,
        })),
      ).catch(() => new Map());
      const clients: ClientWorkspaceDirectoryItem[] = clinical.clients.map((client) => ({
        ...client,
        workspace_origin: "alamo_platform",
        pipeline_client_id: null,
        referral_count: summaries.get(client.canonical_client_id)?.referralCount ?? 0,
        document_count: summaries.get(client.canonical_client_id)?.documentCount ?? 0,
      }));
      const nextCursor = clinical.next_cursor
        ? encodeCursor({ phase: "clinical", cursor: clinical.next_cursor })
        : pipeline.total > 0
          ? encodeCursor({ phase: "pipeline", offset: 0 })
          : null;
      const payload: ClientWorkspaceDirectoryResponse = {
        clients,
        total: clinical.total + pipeline.total,
        limit,
        next_cursor: nextCursor,
        query,
        community: community || null,
        data_as_of: clinical.data_as_of,
        freshness: clinical.freshness,
        clinical_warning: clinical.freshness.warning,
      };
      return Response.json(payload, { headers: privateHeaders() });
    } catch (error) {
      if (!(error instanceof ClinicalDataError)) throw error;
      return Response.json(
        await pipelinePage(request, auth.user, query, community, limit, 0, false),
        { headers: privateHeaders() },
      );
    }
  });
}

async function pipelinePage(
  request: Request,
  user: Parameters<typeof listPipelineClientWorkspaces>[0],
  query: string,
  community: string,
  limit: number,
  offset: number,
  excludeConfirmed: boolean,
): Promise<ClientWorkspaceDirectoryResponse> {
  const pipeline = await listPipelineClientWorkspaces(user, {
    query,
    community,
    limit,
    offset,
    excludeConfirmed,
  });
  const nextOffset = offset + pipeline.clients.length;
  let dataAsOf = new Date().toISOString().slice(0, 10);
  let clinicalTotal = 0;
  let freshness: ClientWorkspaceDirectoryResponse["freshness"] = {
    status: "unknown",
    age_hours: null,
    max_age_hours: 24,
    warning: "The Alamo client directory is unavailable; Pipeline-only client workspaces remain available.",
  };
  try {
    const metadata = await getClinicalClients(request, { query, community, limit: 1 });
    dataAsOf = metadata.data_as_of;
    freshness = metadata.freshness;
    clinicalTotal = excludeConfirmed ? metadata.total : 0;
  } catch {
    // Pipeline-only profiles remain usable while governed clinical data is down.
  }
  return {
    clients: pipeline.clients,
    total: clinicalTotal + pipeline.total,
    limit,
    next_cursor: nextOffset < pipeline.total
      ? encodeCursor({ phase: "pipeline", offset: nextOffset })
      : null,
    query,
    community: community || null,
    data_as_of: dataAsOf,
    freshness,
    clinical_warning: freshness.warning,
  };
}

function encodeCursor(cursor: DirectoryCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | null): DirectoryCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<DirectoryCursor>;
    if (parsed.phase === "clinical" && typeof parsed.cursor === "string" && parsed.cursor.length <= 2_000) {
      return { phase: "clinical", cursor: parsed.cursor };
    }
    if (parsed.phase === "pipeline" && Number.isSafeInteger(parsed.offset) && Number(parsed.offset) >= 0) {
      return { phase: "pipeline", offset: Number(parsed.offset) };
    }
  } catch {
    return null;
  }
  return null;
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function jsonError(error: string) {
  return Response.json({ error }, { status: 400, headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
