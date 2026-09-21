import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { recipientListsAvailable, readCommunityRecipientLists, saveCommunityRecipientList } from "@/lib/pipeline/community-recipient-list-store";
import { parseRecipientListCommand } from "@/lib/pipeline/community-recipient-lists";
import { canManageCommunityContactLists } from "@/lib/pipeline/report-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiLogging(request, "/api/community-recipient-lists", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    if (!recipientListsAvailable()) return jsonError("Community contact lists are not configured yet.", 503);
    return Response.json({ lists: await readCommunityRecipientLists(), canManage: canManageCommunityContactLists(auth.user) }, { headers: { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" } });
  });
}

export async function PUT(request: Request) {
  return withApiLogging(request, "/api/community-recipient-lists", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator"]);
    if (!auth.ok) return auth.response;
    if (!canManageCommunityContactLists(auth.user)) return jsonError("Only designated supervisors can manage community contact lists.", 403);
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    if (!recipientListsAvailable()) return jsonError("Community contact lists are not configured yet.", 503);
    const body = await readJsonBody(request, 64_000);
    if (!body.ok) return jsonError(body.message, body.status);
    const command = parseRecipientListCommand(body.value);
    if (!command) return jsonError("Use a valid list version and unique email addresses in To and Cc (up to 100 total).");
    const result = await saveCommunityRecipientList({ ...command, actorId: auth.user.id });
    return result.ok ? Response.json({ list: result.list }, { headers: { "Cache-Control": "private, no-store" } }) : jsonError(result.error, result.status);
  });
}
