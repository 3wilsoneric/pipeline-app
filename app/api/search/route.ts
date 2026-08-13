import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import {
  ClinicalDataError,
  getClinicalDataReadiness,
  getClinicalRoster,
  toClinicalResidentSearchResult,
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

export async function GET(request: Request) {
  return withApiLogging(request, "/api/search", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const rawQuery = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    const mode = new URL(request.url).searchParams.get("mode") ?? "";

    if (rawQuery.length > 200) {
      return Response.json(
        { error: "Search must be 200 characters or fewer." },
        { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    if (questionModes.has(mode)) {
      const bucket = questionWorklistBucket(mode);
      const [referralResult, fileResult] = await Promise.all([
        bucket
          ? getReferralWorklistReferrals(bucket, 200)
          : Promise.resolve({ referrals: [], total: 0 }),
        mode === "files" ? listReferralFiles({ limit: 200 }) : Promise.resolve({ files: [], total: 0 }),
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
          residents: [],
          destinations: [],
          counts: {
            referrals: referralTotal,
            files: fileResult.total,
            residents: 0,
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
        residents: [],
        destinations: [],
        counts: { referrals: 0, files: 0, residents: 0, destinations: 0, total: 0 },
      });
    }

    const [referrals, files, clinical] = await Promise.all([
      listReferrals({ query, limit: 12 }),
      listReferralFiles({ query, limit: 12 }),
      searchClinical(query, request),
    ]);
    const destinations = searchSiteDestinations(query);

    return Response.json(
      {
        query: rawQuery,
        interpreted_query: query,
        referrals: referrals.referrals,
        files: files.files,
        residents: clinical.residents,
        destinations,
        clinical_warning: clinical.warning,
        counts: {
          referrals: referrals.total,
          files: files.total,
          residents: clinical.total,
          destinations: destinations.length,
          total: referrals.total + files.total + clinical.total + destinations.length,
        },
        generated_at: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  });
}

async function searchClinical(query: string, request: Request) {
  if (!getClinicalDataReadiness().connected) {
    return { residents: [], total: 0, warning: null };
  }

  try {
    const result = await getClinicalRoster(request, { query, limit: 12 });
    return {
      residents: result.residents.map(toClinicalResidentSearchResult),
      total: result.total,
      warning: result.total > 0 ? result.freshness.warning : null,
    };
  } catch (error) {
    return {
      residents: [],
      total: 0,
      warning:
        error instanceof ClinicalDataError
          ? "Clinical roster search is unavailable right now."
          : "Clinical roster search is unavailable right now.",
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
