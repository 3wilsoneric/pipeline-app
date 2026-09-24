import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { requireReferralAccess, canViewTeamReferralBoard } from "@/lib/pipeline/referral-access";
import { requireReferralStore } from "@/lib/pipeline/referral-store";
import { listCommunicationPackets, PacketAccessError, validPacketId, withAdmissionPacket } from "@/lib/notifications/admission-packet-store";
import { communicationAttachment, communicationView } from "@/lib/notifications/direct-handoff";
import { packetPrivateHeaders } from "@/lib/notifications/admission-packet-files";
import { withApiLogging } from "@/lib/observability/api-logging";

export const runtime = "nodejs";
const json = (body: object, status = 200) => Response.json(body, { status, headers: packetPrivateHeaders });

export async function GET(request: Request) {
  return withApiLogging(request, "/api/communications", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;
    const params = new URL(request.url).searchParams;
    const rawReferral = params.get("referral_id");
    const referralId = rawReferral ? Number(rawReferral) : undefined;
    if (rawReferral && (!/^[1-9]\d*$/.test(rawReferral) || !Number.isSafeInteger(referralId))) return json({ error: "Invalid workspace." }, 400);
    if (referralId) {
      const access = await requireReferralAccess(auth.user, referralId);
      if (!access.ok) return access.response;
    }
    const packetId = params.get("packet_id");
    try {
      if (packetId) {
        if (!referralId || !validPacketId(packetId)) return json({ error: "Choose a handoff." }, 400);
        const packet = await withAdmissionPacket(packetId, value => {
          if (!value?.communication || value.referralId !== referralId) throw new PacketAccessError("Handoff not found.", 404);
          return structuredClone(value);
        });
        const fileId = params.get("file_id");
        if (!fileId) return json({ communication: communicationView(packet, true) });
        const file = packet.files.find(value => value.id === fileId);
        if (!file || packet.communication?.status === "preparing" || (file.source.kind === "blob" && !file.archived)) throw new PacketAccessError("Saved attachment not found.", 404);
        const attachment = await communicationAttachment(file, referralId);
        const disposition = `attachment; filename="${file.name.replace(/[^\x20-\x7e]|["\\/]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`;
        const headers = { ...packetPrivateHeaders, "Content-Type": file.contentType, "Content-Disposition": disposition, "Content-Security-Policy": "sandbox; default-src 'none'" };
        if (attachment.contentBytes) return new Response(new Uint8Array(attachment.contentBytes), { headers });
        const response = await fetch(attachment.sourceUrl!, { headers: attachment.sourceHeaders, cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]) });
        if (!response.ok || !response.body) throw new PacketAccessError("The saved attachment is unavailable. The current workspace file has not been substituted.", 503);
        return new Response(response.body, { headers });
      }
      const team = params.get("scope") === "team";
      if (team && !canViewTeamReferralBoard(auth.user)) return json({ error: "Team history is not available with your access." }, 403);
      const page = await listCommunicationPackets({ referralId, ownerId: referralId || team ? undefined : auth.user.id, cursor: params.get("cursor") ?? undefined, query: params.get("q")?.slice(0, 200) });
      const items = [];
      for (const packet of page.items) {
        const access = await requireReferralAccess(auth.user, packet.referralId);
        if (access.ok) items.push(communicationView(packet));
      }
      return json({ items, next_cursor: page.nextCursor, can_view_team: canViewTeamReferralBoard(auth.user) });
    } catch (error) {
      if (error instanceof PacketAccessError) return json({ error: error.message }, error.status);
      return json({ error: "Email history could not be loaded. Try again." }, 503);
    }
  });
}
