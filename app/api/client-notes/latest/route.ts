import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { latestClientNotes } from "@/lib/pipeline/client-notes-store";
import { canAccessReferral } from "@/lib/pipeline/referral-access";
import { getReferral } from "@/lib/pipeline/referral-store";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" };
const maxReferrals = 300;

// The latest client note per referral, for the Home board and Workspaces. Only referrals this person can open.
export async function GET(request: Request) {
  return withApiLogging(request, "/api/client-notes/latest", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const raw = new URL(request.url).searchParams.get("referral_ids") ?? "";
    const ids = [...new Set(raw.split(",").filter(Boolean))];
    if (ids.length > maxReferrals || ids.some((id) => !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)))) return jsonError("referral_ids must be up to 300 referral numbers.");
    const allowed: number[] = [];
    // Bound database concurrency while preserving the canonical per-referral access check.
    for (let offset = 0; offset < ids.length; offset += 8) {
      const referrals = await Promise.all(ids.slice(offset, offset + 8).map((id) => getReferral(Number(id))));
      for (const referral of referrals) if (referral && canAccessReferral(auth.user, referral)) allowed.push(referral.id);
    }
    return Response.json({ notes: await latestClientNotes(allowed) }, { headers });
  });
}
