import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { isMeetClientLive } from "@/lib/notifications/microsoft-graph-mail";
import { readJsonBody } from "@/lib/extraction/contracts";
import { packetPrivateHeaders } from "@/lib/notifications/admission-packet-files";
import { PacketAccessError } from "@/lib/notifications/admission-packet-store";
import { checkOutlookHandoff, discardOutlookHandoff, workspaceOutlookState } from "@/lib/notifications/outlook-handoff";
import { connectedOutlookMailbox, OutlookMailError } from "@/lib/notifications/outlook-mail";
import { withApiLogging } from "@/lib/observability/api-logging";
import { requireReferralAccess, requireMutableReferralAccess } from "@/lib/pipeline/referral-access";
import { confirmAssessorEmailDraft, discardAssessorEmailDraft } from "@/lib/notifications/assessor-email-draft";

export const runtime = "nodejs";
type Context = { params: Promise<{ referralId: string }> };
const json = (body: object, status = 200) => Response.json(body, { status, headers: packetPrivateHeaders });
export async function GET(request: Request, context: Context) {
  return withApiLogging(request, "/api/referrals/[referralId]/outlook-draft", async () => {
    const access = await authorize(request, context);
    if (!access.ok) return access.response;
    if (!isMeetClientLive()) return json({ draft: null, occupied: false, demo: true });
    try { return json(await workspaceOutlookState(access.referralId, access.user.delegation ? "" : access.user.id, !access.user.delegation && access.user.roles.includes("admin"))); }
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
      const input = body.value as { action?: unknown; packet_id?: unknown; confirmed?: unknown } | null;
      if (input?.action === "confirm_forward" || input?.action === "discard_email") {
        return await handleEmailDraftAction(input, access);
      }
      const mailbox = await connectedOutlookMailbox(request, access.user);
      return await handleAction(body.value, access.referralId, mailbox, request.url);
    } catch (error) { return failure(error); }
  });
}
async function handleEmailDraftAction(input: { action?: unknown; packet_id?: unknown; confirmed?: unknown }, access: Extract<Awaited<ReturnType<typeof authorize>>, { ok: true }>) {
        const mutable = await requireMutableReferralAccess(access.user, access.referralId);
        if (!mutable.ok) return mutable.response;
        if (typeof input.packet_id !== "string" || input.confirmed !== true) return json({ error: "Confirm the action for this emailed draft." }, 400);
        const draft = input.action === "confirm_forward"
          ? await confirmAssessorEmailDraft(input.packet_id, access.referralId, access.user)
          : await discardAssessorEmailDraft(input.packet_id, access.referralId, access.user);
        return json({ draft });
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
  return json({ error: "The draft status could not be saved. Refresh its status before trying again." }, 503);
}

async function handleAction(value: unknown, referralId: number, mailbox: Awaited<ReturnType<typeof connectedOutlookMailbox>>, requestUrl: string) {
      const input = value as { action?: string; packet_id?: string; confirmed?: boolean } | null;
      if (input?.action === "connect") return json({ connected: true, mailbox: mailbox.email });
      if (!input || typeof input.packet_id !== "string") return json({ error: "Choose the existing Outlook draft." }, 400);
      if (input.action === "check") return json({ draft: await checkOutlookHandoff(input.packet_id, referralId, mailbox, requestUrl) });
      if (input.action !== "discard" || input.confirmed !== true) return json({ error: "Confirm removal of this Outlook draft." }, 400);
      return json({ draft: await discardOutlookHandoff(input.packet_id, referralId, mailbox, requestUrl) });
}
