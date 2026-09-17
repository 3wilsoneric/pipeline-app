import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  listReferralFiles,
  requireReferralStore,
} from "@/lib/pipeline/referral-store";
import { isKeysetCursor } from "@/lib/pipeline/keyset-cursor";
import { requireReferralAccess, scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { invalidQuerySelections, isOptionalReferralWorkspaceScope, readQuerySelections, readReferralWorkspaceScope } from "@/lib/pipeline/referral-query";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/files", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const url = new URL(request.url);
    const scopedReferral = await scopedReferralId(url.searchParams, auth.user);
    if (scopedReferral instanceof Response) return scopedReferral;
    const referralId = scopedReferral;
    const scope = readReferralWorkspaceScope(url.searchParams);
    if (!isOptionalReferralWorkspaceScope(scope)) return jsonError("scope must be mine or team.");
    const query = bounded(url.searchParams.get("q"), 200);
    const cursor = url.searchParams.get("cursor")?.trim() || undefined;
    const rawLimit = url.searchParams.get("limit")?.trim();
    const limit = rawLimit ? Number(rawLimit) : 100;
    if (query === false) return jsonError("q must be 200 characters or fewer.");
    if (cursor && !isKeysetCursor(cursor)) return jsonError("cursor is invalid.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return jsonError("limit must be a whole number between 1 and 200.");
    const identityStatus = url.searchParams.get("identity_status")?.trim() || undefined;
    if (identityStatus && !["linked", "candidate", "unmatched"].includes(identityStatus)) return jsonError("identity_status is invalid.");
    const sourceSystem = url.searchParams.get("source_system")?.trim() || undefined;
    if (sourceSystem && !["pipeline", "alamo_platform", "allo", "import"].includes(sourceSystem)) return jsonError("source_system is invalid.");
    const uploadedRange = validateUploadedRange(url.searchParams);
    if (!uploadedRange.ok) return jsonError(uploadedRange.message);
    const communities = readQuerySelections(url.searchParams, "community");
    if (invalidQuerySelections(communities, 128)) return jsonError("community allows up to 50 selections, 128 characters each.");
    const owners = readQuerySelections(url.searchParams, "owner");
    if (invalidQuerySelections(owners, 128)) return jsonError("owner allows up to 50 selections, 128 characters each.");
    const category = bounded(url.searchParams.get("category"), 80);
    if (category === false) return jsonError("category must be 80 characters or fewer.");
    const result = await listReferralFiles(scopeReferralListOptions(auth.user, {
      scope: scope as "mine" | "team" | undefined,
      query,
      limit,
      cursor,
      communities,
      owners,
      category: category || undefined,
      identityStatus: identityStatus as "linked" | "candidate" | "unmatched" | undefined,
      sourceSystem: sourceSystem as "pipeline" | "alamo_platform" | "allo" | "import" | undefined,
      referralId,
      uploadedAfter: uploadedRange.uploadedAfter,
      uploadedBefore: uploadedRange.uploadedBefore,
    }));

    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  });
}

async function scopedReferralId(params: URLSearchParams, user: Parameters<typeof requireReferralAccess>[0]): Promise<number | undefined | Response> {
  const raw = params.get("referral_id")?.trim();
  if (!raw) return undefined;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) return jsonError("referral_id must be a positive whole number.");
  const access = await requireReferralAccess(user, id);
  return access.ok ? id : access.response;
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

function validateUploadedRange(params: URLSearchParams) {
  const uploadedAfter = validatedDate(params.get("uploaded_after"));
  if (uploadedAfter === false) return { ok: false as const, message: "uploaded_after must be YYYY-MM-DD." };
  const uploadedBefore = validatedDate(params.get("uploaded_before"));
  if (uploadedBefore === false) return { ok: false as const, message: "uploaded_before must be YYYY-MM-DD." };
  if (uploadedAfter && uploadedBefore && uploadedAfter > uploadedBefore) {
    return { ok: false as const, message: "uploaded_after must be on or before uploaded_before." };
  }
  return { ok: true as const, uploadedAfter: uploadedAfter || undefined, uploadedBefore: uploadedBefore || undefined };
}
