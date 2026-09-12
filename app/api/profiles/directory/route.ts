import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  ClinicalDataError,
  clinicalDataErrorResponse,
  getClinicalClients,
  getClinicalRoster,
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

type DirectoryCursor = { phase: "clinical" | "current"; cursor: string } | { phase: "pipeline"; offset: number };

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("scope") === "current") return currentCensusResponse(request);
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
      const [clinical, pipeline] = await Promise.all([
        getClinicalClients(request, {
          query, community, limit,
          cursor: cursor?.phase === "clinical" ? cursor.cursor : undefined,
        }),
        listPipelineClientWorkspaces(auth.user, {
          query, community, limit: 1, excludeConfirmed: true,
        }),
      ]);
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
        active_referral_count: summaries.get(client.canonical_client_id)?.activeReferralCount ?? 0,
        historical_workspace_count: summaries.get(client.canonical_client_id)?.historicalWorkspaceCount ?? 0,
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

function currentCensusResponse(request: Request) {
  return withApiLogging(request, "/api/profiles/directory", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer", "viewer"]);
    if (!auth.ok) return auth.response;
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const community = url.searchParams.get("community")?.trim() ?? "";
    const cursor = decodeCursor(url.searchParams.get("cursor"), "current");
    if (currentSearchTooLong(query, community)) return jsonError("Search and community must be 128 characters or fewer.");
    if (cursor && cursor.phase !== "current") return jsonError("cursor is invalid for the current census.");
    if (url.searchParams.get("cursor") && !cursor) return jsonError("cursor is invalid for the current census.");
    const limit = boundedInteger(url.searchParams.get("limit"), 200, 1, 200);
    try {
      return Response.json(await currentCensusPage(request, auth.user, query, community, limit, cursor?.cursor), { headers: privateHeaders() });
    } catch (error) {
      return clinicalDataErrorResponse(error);
    }
  });
}

function currentSearchTooLong(query: string, community: string) {
  return query.length > 128 || community.length > 128;
}

async function currentCensusPage(
  request: Request,
  user: Parameters<typeof listPipelineClientWorkspaces>[0],
  query: string,
  community: string,
  limit: number,
  cursor?: string,
): Promise<ClientWorkspaceDirectoryResponse> {
  const roster = await getClinicalRoster(request, { query, community, limit, cursor });
  const summaries = await getClinicalClientWorkspaceSummaries(user, roster.residents.flatMap((resident) =>
    resident.canonical_client_id ? [{ canonicalClientId: resident.canonical_client_id, residentNumbers: resident.resident_number ? [resident.resident_number] : [] }] : [],
  )).catch(() => new Map());
  return {
    total: roster.total,
    limit: roster.limit,
    query: roster.query,
    community: roster.community,
    data_as_of: roster.data_as_of,
    freshness: roster.freshness,
    clients: roster.residents.map((resident) => {
      const summary = summaries.get(resident.canonical_client_id ?? "");
      return {
        canonical_client_id: resident.canonical_client_id ?? "",
        profile_key: `resident:${resident.resident_key}`,
        display_name: resident.display_name,
        gender: null,
        resident_numbers: resident.resident_number ? [resident.resident_number] : [],
        current_resident: true,
        community_names: [resident.community_name],
        current_community: resident.community_name,
        unit: resident.unit,
        admit_date: resident.admit_date,
        care_level: resident.care_level,
        episode_count: 1,
        workspace_origin: "alamo_platform" as const,
        pipeline_client_id: null,
        referral_count: summary?.referralCount ?? 0,
        active_referral_count: summary?.activeReferralCount ?? 0,
        historical_workspace_count: summary?.historicalWorkspaceCount ?? 0,
        document_count: summary?.documentCount ?? 0,
      };
    }),
    next_cursor: roster.next_cursor ? encodeCursor({ phase: "current", cursor: roster.next_cursor }) : null,
    clinical_warning: roster.freshness.warning,
  };
}

function encodeCursor(cursor: DirectoryCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | null, phase: "clinical" | "current" = "clinical"): DirectoryCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<DirectoryCursor>;
    if (parsed.phase === phase && typeof parsed.cursor === "string" && parsed.cursor.length <= 2_000) {
      return { phase: parsed.phase, cursor: parsed.cursor };
    }
    if (phase === "clinical" && parsed.phase === "pipeline" && Number.isSafeInteger(parsed.offset) && Number(parsed.offset) >= 0) {
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
