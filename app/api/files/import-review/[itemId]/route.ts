import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAuditActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { withApiLogging } from "@/lib/observability/api-logging";
import { reviewClientFileImportItem } from "@/lib/pipeline/client-file-import-store";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ itemId: string }> },
) {
  return withApiLogging(request, "/api/files/import-review/[itemId]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const { itemId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(itemId)) return error("Import item not found.", 404);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = body?.action;
    const ifMatch = body?.if_match;
    if (action !== "confirm" && action !== "create_client" && action !== "reject") {
      return error("action must be confirm, create_client, or reject.");
    }
    if (!Number.isInteger(ifMatch) || Number(ifMatch) < 1) return error("if_match must be a positive integer.");
    const target = typeof body?.target_client_id === "string" ? body.target_client_id.trim() : undefined;
    if (action === "confirm" && (!target || target.length > 256)) return error("target_client_id is required.");
    const referralId = body?.referral_id === undefined ? undefined : Number(body.referral_id);
    if (referralId !== undefined && (!Number.isSafeInteger(referralId) || referralId < 1)) return error("referral_id is invalid.");
    const result = await reviewClientFileImportItem(itemId, {
      action,
      if_match: Number(ifMatch),
      target_client_id: target,
      referral_id: referralId,
    }, { ...auth.user, ...pipelineAuditActor(auth.user) });
    if (result.status === "ok") return Response.json({ item: result.item }, { headers: privateHeaders() });
    if (result.status === "conflict") return Response.json({ error: "This item changed in another session.", item: result.item }, { status: 409, headers: privateHeaders() });
    if (result.status === "not_found") return error("Import item not found.", 404);
    if (result.status === "unavailable") return error("Import review is not configured.", 503);
    if (result.status === "invalid_referral") return error("The referral does not belong to that client.", 409);
    return error("The selected client does not exist.", 409);
  });
}

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}
