import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { jsonError } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { getReferralProgress } from "@/lib/pipeline/referral-progress";
import { parseReferralListQuery } from "@/lib/pipeline/referral-query";
import {
  listReferralFacets,
  listReferralFiles,
  listReferrals,
  requireReferralStore,
} from "@/lib/pipeline/referral-store";
import { getReferralWorkflowContexts } from "@/lib/pipeline/workflow-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/referrals/directory", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const url = new URL(request.url);
    const query = parseReferralListQuery(url.searchParams);
    if (!query.ok) return jsonError(query.message);
    const requestedOptions = query.value.queue === "my_work"
      ? { ...query.value, queue: undefined, activeOnly: true }
      : query.value;
    const options = scopeReferralListOptions(auth.user, requestedOptions);
    const facetAccess = scopeReferralListOptions(auth.user, {
      workspaceStatus: query.value.workspaceStatus,
    });

    const [result, facets, files] = await Promise.all([
      listReferrals(options),
      listReferralFacets(query.value.query, facetAccess),
      listReferralFiles(scopeReferralListOptions(auth.user, { limit: 1, identityStatus: "linked" })),
    ]);
    const contexts = await getReferralWorkflowContexts(result.referrals);
    const progress = Object.fromEntries(result.referrals.map((referral) => [
      referral.id,
      getReferralProgress(referral, contexts.get(referral.id)),
    ]));

    return Response.json({
      ...result,
      progress,
      facets,
      file_total: files.total,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}
