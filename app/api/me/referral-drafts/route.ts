import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";
import {
  getUserWorkspaceStateReadiness,
  listUserWorkspaceState,
} from "@/lib/pipeline/user-workspace-state-store";
import {
  isNewReferralDraftKey,
  parsePipelineReferralDraft,
  type PipelineReferralDraft,
  type PipelineReferralDraftSummary,
} from "@/lib/pipeline/user-workspace-state-types";
import { referralCanvasFieldKeys } from "@/lib/pipeline/referral-types";

export const runtime = "nodejs";
const noStoreHeaders = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  return withApiLogging(request, "/api/me/referral-drafts", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const readiness = getUserWorkspaceStateReadiness();
    if (!readiness.ready) {
      return Response.json(
        { error: readiness.enabled ? readiness.message : "Not found." },
        { status: readiness.enabled ? 503 : 404, headers: noStoreHeaders },
      );
    }

    const records = await listUserWorkspaceState<PipelineReferralDraft>(auth.user.id, "referral_draft", 50);
    const drafts = records.flatMap((record) => {
      if (!isNewReferralDraftKey(record.state_key)) return [];
      const draft = parsePipelineReferralDraft(record.payload);
      if (!draft || !hasRecoverableWork(draft)) return [];
      return [toSummary(record.state_key, record.version, record.expires_at, draft)];
    });
    recordPipelineMetric("pipeline.intake.recovery_drafts", drafts.length, "count", {
      operation: "list_recovery_drafts",
      result: drafts.length > 0 ? "recoverable" : "clear",
    });
    return Response.json({ drafts }, { headers: noStoreHeaders });
  });
}

function hasRecoverableWork(draft: PipelineReferralDraft) {
  return draft.dirtyKeys.length > 0
    || Boolean(draft.initialPacketName?.trim())
    || referralCanvasFieldKeys.some((key) => draft.fields[key].value.trim().length > 0);
}

function toSummary(
  draftKey: `new-${string}`,
  version: number,
  expiresAt: string,
  draft: PipelineReferralDraft,
): PipelineReferralDraftSummary {
  const completedFields = referralCanvasFieldKeys.filter((key) => draft.fields[key].value.trim().length > 0).length;
  return {
    draft_key: draftKey,
    version,
    saved_at: draft.savedAt,
    expires_at: expiresAt,
    client_name: draft.fields.name.value.trim(),
    community: draft.fields.community.value.trim(),
    ...(draft.initialPacketName?.trim() ? { packet_name: draft.initialPacketName.trim() } : {}),
    completed_fields: completedFields,
    total_fields: referralCanvasFieldKeys.length,
  };
}
