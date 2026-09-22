import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { isMeetClientLive } from "@/lib/notifications/microsoft-graph-mail";
import { PacketAccessError } from "@/lib/notifications/admission-packet-store";
import { connectedOutlookMailbox, getOutlookClientId, OutlookMailError } from "@/lib/notifications/outlook-mail";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
const json = (body: object, status = 200) => Response.json(body, { status, headers });

export async function GET(request: Request) {
  return withApiLogging(request, "/api/me/outlook", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    return json({ outlook_client_id: getOutlookClientId(), account_email: auth.user.email, account_id: auth.user.id,
      demo: !isMeetClientLive(), can_connect: !auth.user.delegation && auth.user.roles.some(role => ["admin", "assessment_coordinator", "reviewer"].includes(role)) });
  });
}

export async function POST(request: Request) {
  return withApiLogging(request, "/api/me/outlook", async () => {
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) return originFailure;
    const auth = await requirePipelineUser(request, ["admin", "assessment_coordinator", "reviewer"]);
    if (!auth.ok) return auth.response;
    if (!isMeetClientLive()) return json({ error: "Not production yet — Outlook connection is not enabled." }, 403);
    try {
      const mailbox = await connectedOutlookMailbox(request, auth.user);
      return json({ mailbox: mailbox.email });
    } catch (error) {
      if (error instanceof PacketAccessError || error instanceof OutlookMailError) return json({ error: error.message }, error.status === 401 ? 428 : error.status);
      return json({ error: "Outlook could not verify your connection. Try again." }, 503);
    }
  });
}
