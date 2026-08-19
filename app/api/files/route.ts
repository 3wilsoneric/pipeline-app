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
    const result = await listReferralFiles(scopeReferralListOptions(auth.user, {
      query,
      limit,
      cursor,
    }));

    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  });
}
