import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  ClinicalDataError,
  getClinicalDataReadiness,
  getClinicalClients,
} from "@/lib/clinical/clinical-data";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  listReferralFiles,
  listReferrals,
  requireReferralStore,
} from "@/lib/pipeline/referral-store";
import { getReferralWorklistReferrals } from "@/lib/pipeline/operations-snapshot";
import type { ReferralWorklistBucket } from "@/lib/pipeline/operations-types";
import { searchSiteDestinations } from "@/lib/pipeline/site-search";
import { scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { listPipelineClientWorkspaces } from "@/lib/pipeline/client-workspace-store";

export const runtime = "nodejs";

const ignoredWords = new Set([
  "a",
  "all",
  "are",
  "at",
  "client",
  "clients",
  "document",
  "documents",
  "find",
  "file",
  "files",
  "for",
  "give",
  "in",
  "is",
  "list",
  "me",
  "of",
  "on",
  "packet",
  "packets",
  "please",
  "referral",
  "referrals",
  "search",
  "show",
  "the",
  "upload",
  "uploads",
  "uploaded",
  "what",
  "who",
  "with",
]);

const questionModes = new Set([
  "active",
  "unassigned",
  "packet_review",
  "open",
  "documents",
  "assessment",
  "decision",
  "files",
]);

const searchScopes = new Set(["all", "local", "clinical"]);

export async function GET(request: Request) {
  return withApiLogging(request, "/api/search", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const searchParams = new URL(request.url).searchParams;
    const rawQuery = searchParams.get("q")?.trim() ?? "";
    const mode = searchParams.get("mode") ?? "";
    const scope = searchParams.get("scope") ?? "all";

    if (rawQuery.length > 200) {
      return Response.json(
        { error: "Search must be 200 characters or fewer." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    if (!searchScopes.has(scope)) {
      return Response.json(
        { error: "Search scope is invalid." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    if (questionModes.has(mode)) {
      const bucket = questionWorklistBucket(mode);
      const [referralResult, fileResult] = await Promise.all([
        bucket
          ? getReferralWorklistReferrals(bucket, 200, auth.user)
          : Promise.resolve({ referrals: [], total: 0 }),
        mode === "files"
          ? listReferralFiles(scopeReferralListOptions(auth.user, { limit: 200, identityStatus: "linked" }))
          : Promise.resolve({ files: [], total: 0 }),
      ]);
      const referrals = referralResult.referrals;
      const referralTotal = referralResult.total;
      const files = fileResult.files;

      return Response.json(
        {
          query: rawQuery,
          interpreted_query: mode,
          referrals,
          files,
          clients: [],
          destinations: [],
          counts: {
            referrals: referralTotal,
            files: fileResult.total,
            clients: 0,
            destinations: 0,
            total: referralTotal + fileResult.total,
          },
          generated_at: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    const query = normalizeSearchQuery(rawQuery);
    if (!query) {
      return Response.json({
        query: rawQuery,
        interpreted_query: "",
        referrals: [],
        files: [],
        clients: [],
        destinations: [],
        counts: { referrals: 0, files: 0, clients: 0, destinations: 0, total: 0 },
      });
    }

    const includeLocal = scope !== "clinical";
    const includeClinical = scope !== "local";
    const [local, clinical] = await Promise.all([
      includeLocal
        ? searchLocal(query, auth.user)
        : Promise.resolve(emptyLocalSearch()),
      includeClinical
        ? searchClinical(query, request)
        : Promise.resolve(emptyClinicalSearch()),
    ]);

    // The progressive browser search intentionally excludes confirmed Pipeline
    // identities from its local phase so one person never appears twice. Any
    // request that attempted governed search falls back to Pipeline workspaces
    // when the governed directory is disconnected or temporarily unavailable.
    const fallbackClients = includeClinical && !clinical.available
      ? await listPipelineClientWorkspaces(auth.user, { query, limit: 12, excludeConfirmed: false })
      : null;
    const clients = [
      ...clinical.clients,
      ...(fallbackClients?.clients ?? local.clients),
    ].slice(0, 12);

    return Response.json(
      {
        query: rawQuery,
        interpreted_query: query,
        referrals: local.referrals,
        files: local.files,
        clients,
        destinations: local.destinations,
        clinical_warning: clinical.warning,
        sources: {
          local: includeLocal,
          clinical: includeClinical,
          clinical_available: clinical.available,
        },
        counts: {
          referrals: local.counts.referrals,
          files: local.counts.files,
          clients: clinical.total + (fallbackClients?.total ?? local.counts.clients),
          destinations: local.destinations.length,
          total: local.counts.referrals
            + local.counts.files
            + clinical.total
            + (fallbackClients?.total ?? local.counts.clients)
            + local.destinations.length,
        },
        generated_at: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  });
}

async function searchLocal(query: string, user: Parameters<typeof scopeReferralListOptions>[0]) {
  const [referrals, files, pipelineClients] = await Promise.all([
    listReferrals(scopeReferralListOptions(user, { query, limit: 12, workspaceStatus: "all" })),
    listReferralFiles(scopeReferralListOptions(user, { query, limit: 12, identityStatus: "linked" })),
    listPipelineClientWorkspaces(user, { query, limit: 12, excludeConfirmed: true }),
  ]);
  return {
    referrals: referrals.referrals,
    files: files.files,
    clients: pipelineClients.clients,
    destinations: searchSiteDestinations(query),
    counts: {
      referrals: referrals.total,
      files: files.total,
      clients: pipelineClients.total,
    },
  };
}

function emptyLocalSearch() {
  return {
    referrals: [],
    files: [],
    clients: [],
    destinations: [],
    counts: { referrals: 0, files: 0, clients: 0 },
  };
}

function emptyClinicalSearch() {
  return { clients: [], total: 0, warning: null, available: false };
}

async function searchClinical(query: string, request: Request) {
  if (!getClinicalDataReadiness().connected) {
    return { clients: [], total: 0, warning: null, available: false };
  }

  try {
    const result = await getClinicalClients(request, { query, limit: 12 });
    return {
      clients: result.clients,
      total: result.total,
      warning: result.total > 0 ? result.freshness.warning : null,
      available: true,
    };
  } catch (error) {
    return {
      clients: [],
      total: 0,
      warning:
        error instanceof ClinicalDataError
          ? "Enhanced client search is unavailable right now."
          : "Enhanced client search is unavailable right now.",
      available: false,
    };
  }
}

function questionWorklistBucket(mode: string): ReferralWorklistBucket | null {
  if (mode === "files") return null;
  if (mode === "unassigned") return "unassigned";
  if (mode === "packet_review") return "packet_review";
  if (mode === "assessment") return "assessment_due";
  if (mode === "decision") return "decision_needed";
  if (mode === "documents") return "missing_documents";
  return "all_actionable";
}

function normalizeSearchQuery(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((term) => term && !ignoredWords.has(term))
    .join(" ");
}
