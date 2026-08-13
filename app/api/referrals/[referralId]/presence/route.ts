import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { jsonError, readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import {
  heartbeatEditingPresence,
  listEditingPresence,
  releaseEditingPresence,
} from "@/lib/pipeline/editing-presence";
import { getReferralChangeMetadata, requireReferralStore } from "@/lib/pipeline/referral-store";
import { isReferralSection } from "@/lib/pipeline/referral-sections";

export const runtime = "nodejs";

type PresenceBody = {
  lease_id?: string;
  section?: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/presence", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const parsed = await parseReferralId(context);
    if (!parsed.ok) return parsed.response;
    if (!await getReferralChangeMetadata(parsed.id)) return jsonError("Referral not found.", 404);

    const presence = await listEditingPresence(parsed.id);
    return Response.json({
      presence: presence.map((item) => ({ ...item, is_me: item.actor_id === auth.user.id })),
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/presence", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const parsed = await parseReferralId(context);
    if (!parsed.ok) return parsed.response;
    const body = await readJsonBody<PresenceBody>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!validLeaseId(body.value?.lease_id)) return jsonError("lease_id must be a UUID.");
    if (!body.value?.section || !isReferralSection(body.value.section)) return jsonError("section is invalid.");
    if (!await getReferralChangeMetadata(parsed.id)) return jsonError("Referral not found.", 404);

    const presence = await heartbeatEditingPresence({
      leaseId: body.value.lease_id,
      referralId: parsed.id,
      section: body.value.section,
      actor: { id: auth.user.id, name: auth.user.name },
    });
    if (!presence) return jsonError("This editing lease belongs to another session.", 409);
    return Response.json({ presence }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ referralId: string }> },
) {
  return withApiLogging(request, "/api/referrals/[referralId]/presence", async () => {
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const parsed = await parseReferralId(context);
    if (!parsed.ok) return parsed.response;
    const body = await readJsonBody<PresenceBody>(request);
    if (!body.ok) return jsonError(body.message, body.status);
    if (!validLeaseId(body.value?.lease_id)) return jsonError("lease_id must be a UUID.");

    const released = await releaseEditingPresence(body.value.lease_id, parsed.id, auth.user.id);
    return Response.json({ released }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  });
}

async function parseReferralId(context: { params: Promise<{ referralId: string }> }) {
  const store = requireReferralStore();
  if (!store.ok) return { ok: false as const, response: store.response };
  const { referralId } = await context.params;
  const id = Number.parseInt(referralId, 10);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false as const, response: jsonError("referralId is invalid.") };
  return { ok: true as const, id };
}

function validLeaseId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
