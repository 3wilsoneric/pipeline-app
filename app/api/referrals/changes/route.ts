import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { getReferralStoreRevision, requireReferralStore } from "@/lib/pipeline/referral-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/referrals/changes", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const rawAfter = new URL(request.url).searchParams.get("after")?.trim() ?? "0";
    if (!/^\d{1,15}$/.test(rawAfter)) return jsonError("after must be a nonnegative whole number.");
    const after = Number(rawAfter);
    if (!Number.isSafeInteger(after) || after < 0) return jsonError("after is outside the supported range.");

    const sequence = await getReferralStoreRevision();
    return Response.json({ changed: sequence > after, sequence }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
