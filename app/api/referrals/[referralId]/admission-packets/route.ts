import { requirePipelineUser, type PipelineUser } from "@/lib/auth/pipeline-auth";
import { pipelineAccountableActor } from "@/lib/auth/assessor-session-policy";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { getPipelineDemoEnvironment } from "@/lib/demo/demo-environment";
import { readJsonBody } from "@/lib/extraction/contracts";
import { packetPrivateHeaders } from "@/lib/notifications/admission-packet-files";
import { listAdmissionPacketLinks, manageAdmissionPacketLink, PacketAccessError } from "@/lib/notifications/admission-packet-store";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";
type Context = { params: Promise<{ referralId: string }> };
const json = (body: object, status = 200) => Response.json(body, { status, headers: packetPrivateHeaders });

async function handle(request: Request, context: Context, mutate: boolean) {
  return withApiLogging(request, "/api/referrals/[referralId]/admission-packets", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const { referralId: value } = await context.params;
    const referralId = Number(value);
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(referralId)) return json({ error: "Invalid workspace." }, 400);
    const access = await requireReferralAccess(auth.user, referralId);
    if (!access.ok) return access.response;
    if (getPipelineDemoEnvironment().writable) return mutate ? json({ error: "Demo — not live. Recipient access cannot be changed." }, 403) : json({ packets: [] });
    try {
      if (!mutate) return json({ packets: await listAdmissionPacketLinks(referralId) });
      return await updateAccess(request, referralId, auth.user);
    } catch (error) { return accessErrorResponse(error); }
  });
}
export const GET = (request: Request, context: Context) => handle(request, context, false);
export const POST = (request: Request, context: Context) => handle(request, context, true);

async function updateAccess(request: Request, referralId: number, user: PipelineUser) {
  const originFailure = requireSameOriginMutation(request);
  if (originFailure) return originFailure;
  const body = await readJsonBody(request, 2048);
  if (!body.ok) return json({ error: body.message }, body.status);
  if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) return json({ error: "Choose a packet and action." }, 400);
  const { packet_id, action } = body.value as Record<string, unknown>;
  if (typeof packet_id !== "string" || (action !== "renew" && action !== "revoke")) return json({ error: "Choose a packet and action." }, 400);
  return json(await manageAdmissionPacketLink(packet_id, referralId, action, pipelineAccountableActor(user)));
}

function accessErrorResponse(error: unknown) {
  return json({ error: error instanceof PacketAccessError ? error.message : "Packet access settings could not be loaded. Try again." }, error instanceof PacketAccessError ? error.status : 503);
}
