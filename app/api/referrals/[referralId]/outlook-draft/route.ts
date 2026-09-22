import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { isMeetClientLive } from "@/lib/notifications/microsoft-graph-mail";
import { readJsonBody } from "@/lib/extraction/contracts";
import { packetPrivateHeaders } from "@/lib/notifications/admission-packet-files";
import { PacketAccessError } from "@/lib/notifications/admission-packet-store";
import { checkOutlookHandoff, discardOutlookHandoff, workspaceOutlookState } from "@/lib/notifications/outlook-handoff";
import { connectedOutlookMailbox, getOutlookClientId, OutlookMailError } from "@/lib/notifications/outlook-mail";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess, requireMutableReferralAccess } from "@/lib/pipeline/referral-access";

export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ referralId: string }> };
const json = (body: object, status = 200) => Response.json(body, { status, headers: packetPrivateHeaders });
export async function GET(request: Request, context: Context) {
  return withApiLogging(request, "/api/referrals/[referralId]/outlook-draft", async () => {
    const access = await authorize(request, context);
    if (!access.ok) return access.response;
    const connection = { outlook_client_id: getOutlookClientId(), account_email: access.user.email };
    if (!isMeetClientLive()) return json({ draft: null, occupied: false, demo: true, ...connection });
    try { return json({ ...await workspaceOutlookState(access.referralId, access.user.delegation ? "" : access.user.id), ...connection }); }
    catch (error) { return failure(error); }
  });
}
export async function POST(request: Request, context: Context) {
  return withApiLogging(request, "/api/referrals/[referralId]/outlook-draft", async () => {
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const access = await authorize(request, context);
    if (!access.ok) return access.response;
    if (!isMeetClientLive()) return json({ error: "Not production yet — no email will be sent and no Outlook draft will be created or changed." }, 403);
    const body = await readJsonBody(request, 2048);
    if (!body.ok) return json({ error: body.message }, body.status);
    try {
      const mutable = await requireMutableReferralAccess(access.user, access.referralId);
      if (!mutable.ok) return mutable.response;
      const mailbox = await connectedOutlookMailbox(request, access.user);
      return await handleAction(body.value, access.referralId, mailbox, request.url);
    } catch (error) { return failure(error); }
  });
}
async function authorize(request: Request, context: Context) {
  const auth = await requirePipelineUser(request);
  if (!auth.ok) return auth;
  const { referralId: value } = await context.params;
  const referralId = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(referralId)) return { ok: false as const, response: json({ error: "Invalid workspace." }, 400) };
  const access = await requireReferralAccess(auth.user, referralId);
  if (!access.ok) return access;
  return { ok: true as const, referralId, user: auth.user };
}
function failure(error: unknown) {
  if (error instanceof PacketAccessError || error instanceof OutlookMailError) return json({ error: error.message }, error.status === 401 ? 428 : error.status);
  return json({ error: "Outlook could not confirm the draft. Try checking its status again." }, 503);
}

async function handleAction(value: unknown, referralId: number, mailbox: Awaited<ReturnType<typeof connectedOutlookMailbox>>, requestUrl: string) {
      const input = value as { action?: string; packet_id?: string; confirmed?: boolean } | null;
      if (input?.action === "connect") return json({ connected: true, mailbox: mailbox.email });
      if (!input || typeof input.packet_id !== "string") return json({ error: "Choose the existing Outlook draft." }, 400);
      if (input.action === "check") return json({ draft: await checkOutlookHandoff(input.packet_id, referralId, mailbox, requestUrl) });
      if (input.action !== "discard" || input.confirmed !== true) return json({ error: "Confirm removal of this Outlook draft." }, 400);
      return json({ draft: await discardOutlookHandoff(input.packet_id, referralId, mailbox, requestUrl) });
}
