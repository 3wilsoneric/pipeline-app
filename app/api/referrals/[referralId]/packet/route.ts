import { requirePipelineUser } from "@/lib/auth/pipeline-auth";
import { withApiLogging } from "@/lib/observability/api-logging";
import { readLocalReferralPacket } from "@/lib/pipeline/local-document-store";
import { getReferral, requireReferralStore } from "@/lib/pipeline/referral-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ referralId: string }> }) {
  return withApiLogging(request, "/api/referrals/[referralId]/packet", async () => {
    const auth = await requirePipelineUser(request);
    if (!auth.ok) return auth.response;
    const store = requireReferralStore();
    if (!store.ok) return store.response;

    const { referralId: rawId } = await context.params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Packet not found." }, { status: 404 });
    const referral = await getReferral(id);
    if (!referral?.documentHash) return Response.json({ error: "Packet not found." }, { status: 404 });
    const packet = await readLocalReferralPacket(referral.documentHash);
    if (!packet) return Response.json({ error: "Packet not found." }, { status: 404 });

    return new Response(packet.bytes, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `inline; filename="${contentDispositionName(packet.filename)}"`,
        "Content-Length": String(packet.size),
        "Content-Type": packet.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

function contentDispositionName(value: string) {
  return value.replace(/[\r\n"\\]/g, "-").slice(0, 180) || "referral-packet.pdf";
}
