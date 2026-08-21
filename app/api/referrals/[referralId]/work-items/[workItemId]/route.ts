import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import type { RequirementStatus } from "@/lib/pipeline/referral-types";
import { patchReferralWorkItem } from "@/lib/pipeline/workflow-store";
import { withApiLogging } from "@/lib/observability/api-logging";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";

const statuses: RequirementStatus[] = ["needed", "requested", "received", "reviewed", "waived", "expired"];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ referralId: string; workItemId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/work-items/[workItemId]", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const readiness = requireReferralStore();
    if (!readiness.ok) return readiness.response;
    const { referralId: rawReferralId, workItemId } = await context.params;
    const referralId = Number.parseInt(rawReferralId, 10);
    if (!Number.isInteger(referralId) || referralId < 1) return jsonError("referralId is invalid.");
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    if (!isSafeId(workItemId)) return jsonError("workItemId is invalid.");

    const body = await readJsonBody(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!isRecord(body.value)) return jsonError("The request body must be an object.");
    if (!Number.isInteger(body.value.if_match) || Number(body.value.if_match) < 1) return jsonError("if_match must be a positive version number.");
    if (!isRecord(body.value.patch)) return jsonError("patch must be an object.");
    const patch = validatePatch(body.value.patch);
    if (!patch.ok) return jsonError(patch.error);

    const result = await patchReferralWorkItem(
      referralId,
      workItemId,
      patch.value,
      Number(body.value.if_match),
      { id: auth.user.id, name: auth.user.name },
    );
    if (!result) return jsonError("Work item not found.", 404);
    if (!result.ok && "conflict" in result) {
      recordPipelineMetric("pipeline.referral.save_conflicts", 1, "count", {
        operation: "work_item",
        result: "conflict",
      });
      return Response.json({ error: "This work item changed in another session. Review the latest value before saving.", ...result }, { status: 409 });
    }
    if (!result.ok) return Response.json({ error: result.blockers[0]?.label ?? "This work item cannot be saved.", ...result }, { status: 422 });
    return Response.json({ ok: true, work_item: result.record, referral: result.referral }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  });
}

function validatePatch(value: Record<string, unknown>) {
  const allowed = new Set(["status", "owner", "dueAt", "nextStep", "blocker", "evidenceDocumentId", "evidenceDocumentName", "waiverReason"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return { ok: false as const, error: "The work item patch contains an unsupported field." };
  if (value.status !== undefined && (typeof value.status !== "string" || !statuses.includes(value.status as RequirementStatus))) return { ok: false as const, error: "status is invalid." };
  if (value.blocker !== undefined && typeof value.blocker !== "boolean") return { ok: false as const, error: "blocker must be true or false." };
  if (value.evidenceDocumentId !== undefined && (typeof value.evidenceDocumentId !== "string" || !isSafeId(value.evidenceDocumentId))) {
    return { ok: false as const, error: "evidenceDocumentId is invalid." };
  }
  for (const [field, maximum] of [["owner", 200], ["dueAt", 80], ["nextStep", 500], ["evidenceDocumentName", 2_000], ["waiverReason", 2_000]] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || value[field].length > maximum)) return { ok: false as const, error: `${field} is invalid.` };
  }
  if (typeof value.dueAt === "string" && (!value.dueAt.trim() || !Number.isFinite(Date.parse(value.dueAt)))) {
    return { ok: false as const, error: "dueAt must be a valid date." };
  }
  return { ok: true as const, value };
}

function isSafeId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
