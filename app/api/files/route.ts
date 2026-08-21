import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  listReferralFiles,
  requireReferralStore,
} from "@/lib/pipeline/referral-store";
import { isKeysetCursor } from "@/lib/pipeline/keyset-cursor";
import { scopeReferralListOptions } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/files", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const cursor = url.searchParams.get("cursor")?.trim() || undefined;
    const rawLimit = url.searchParams.get("limit")?.trim();
    const limit = rawLimit ? Number(rawLimit) : 100;
    if (query.length > 200) return jsonError("q must be 200 characters or fewer.");
    if (cursor && !isKeysetCursor(cursor)) return jsonError("cursor is invalid.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return jsonError("limit must be a whole number between 1 and 200.");
    const identityStatus = url.searchParams.get("identity_status")?.trim() || undefined;
    if (identityStatus && !["linked", "candidate", "unmatched"].includes(identityStatus)) return jsonError("identity_status is invalid.");
    const sourceSystem = url.searchParams.get("source_system")?.trim() || undefined;
    if (sourceSystem && !["pipeline", "alamo_platform", "allo", "import"].includes(sourceSystem)) return jsonError("source_system is invalid.");
    const uploadedAfter = validatedDate(url.searchParams.get("uploaded_after"));
    if (uploadedAfter === false) return jsonError("uploaded_after must be YYYY-MM-DD.");
    const uploadedBefore = validatedDate(url.searchParams.get("uploaded_before"));
    if (uploadedBefore === false) return jsonError("uploaded_before must be YYYY-MM-DD.");
    if (uploadedAfter && uploadedBefore && uploadedAfter > uploadedBefore) {
      return jsonError("uploaded_after must be on or before uploaded_before.");
    }
    const community = bounded(url.searchParams.get("community"), 128);
    if (community === false) return jsonError("community must be 128 characters or fewer.");
    const category = bounded(url.searchParams.get("category"), 80);
    if (category === false) return jsonError("category must be 80 characters or fewer.");
    const result = await listReferralFiles(scopeReferralListOptions(auth.user, {
      query,
      limit,
      cursor,
      community: community || undefined,
      category: category || undefined,
      identityStatus: identityStatus as "linked" | "candidate" | "unmatched" | undefined,
      sourceSystem: sourceSystem as "pipeline" | "alamo_platform" | "allo" | "import" | undefined,
      uploadedAfter: uploadedAfter || undefined,
      uploadedBefore: uploadedBefore || undefined,
    }));

    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  });
}

function bounded(value: string | null, maximum: number) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return "";
  return normalized.length <= maximum ? normalized : false as const;
}

function validatedDate(value: string | null) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) && Number.isFinite(Date.parse(`${normalized}T00:00:00Z`))
    ? normalized
    : false as const;
}
