import { requireSameOriginMutation } from "@/lib/auth/request-security";
import { readJsonBody } from "@/lib/extraction/contracts";
import { withApiLogging } from "@/lib/observability/api-logging";
import { closePacketSession, packetCookieName, packetSessionToken, readVerifiedPacket, requestPacketCode, verifyPacketCode } from "@/lib/notifications/admission-packet-access";
import { getPipelineDemoEnvironment } from "@/lib/demo/demo-environment";
import { packetPrivateHeaders } from "@/lib/notifications/admission-packet-files";
import { PacketAccessError } from "@/lib/notifications/admission-packet-store";
import { sendPacketVerificationCode } from "@/lib/notifications/microsoft-graph-mail";
import { toPipelinePath } from "@/lib/pipeline/base-path";

export const runtime = "nodejs";
type Context = { params: Promise<{ packetId: string }> };
const json = (body: object, status = 200, headers = {}) => Response.json(body, { status, headers: { ...packetPrivateHeaders, ...headers } });
const errorResponse = (error: unknown) => json({ error: error instanceof PacketAccessError ? error.message : "Packet access is temporarily unavailable. Your files have not changed. Please try again." }, error instanceof PacketAccessError ? error.status : 503);

export async function GET(request: Request, context: Context) {
  return withApiLogging(request, "/api/admission-packets/[packetId]", async () => {
    try {
      const { packetId } = await context.params;
      const { packet, sessionExpiresAt } = await readVerifiedPacket(packetId, packetSessionToken(request, packetId));
      return json({ created_at: packet.createdAt, expires_at: packet.expiresAt, session_expires_at: sessionExpiresAt, message: packet.message,
        files: packet.files.map(({ id, name, contentType, byteSize }) => ({ id, name, contentType, byteSize })) });
    } catch (error) { return errorResponse(error); }
  });
}

export async function POST(request: Request, context: Context) {
  return withApiLogging(request, "/api/admission-packets/[packetId]", async () => {
    const failure = requireSameOriginMutation(request);
    if (failure) return failure;
    // Public mutations require an explicit matching Origin; no CSRF fallback.
    if (!request.headers.get("origin")) return json({ error: "Open this packet in your browser and try again." }, 403);
    if (getPipelineDemoEnvironment().writable) return json({ error: "Demo — not live. No verification email will be sent." }, 403);
    const body = await readJsonBody(request, 2048);
    if (!body.ok) return json({ error: body.message }, body.status);
    try {
      const { packetId } = await context.params;
      return await packetMutation(request, packetId, body.value);
    } catch (error) { return errorResponse(error); }
  });
}

async function packetMutation(request: Request, packetId: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return json({ error: "Enter your email address." }, 400);
  const { action, email, code } = value as Record<string, unknown>;
  if (action === "close") {
    await closePacketSession(packetId, packetSessionToken(request, packetId));
    return json({ ok: true }, 200, { "Set-Cookie": `${packetCookieName(packetId)}=; Path=${toPipelinePath(`/api/admission-packets/${packetId}`)}; HttpOnly; SameSite=Strict; Max-Age=0` });
  }
  if (!validEmail(email)) return json({ error: "Enter your email address." }, 400);
  if (action === "request_code") return emailPacketCode(packetId, email);
  if (action !== "verify" || typeof code !== "string" || code.length > 16) return json({ error: "Enter the code from your email." }, 400);
  const session = await verifyPacketCode(packetId, email, code.trim());
  const secure = secureCookieFlag(request);
  return json({ ok: true }, 200, { "Set-Cookie": `${packetCookieName(packetId)}=${session.token}; Path=${toPipelinePath(`/api/admission-packets/${packetId}`)}; HttpOnly; SameSite=Strict; Max-Age=${session.expiresIn}${secure}` });
}

function validEmail(email: unknown): email is string {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function secureCookieFlag(request: Request) {
  return new URL(request.url).protocol === "https:" || (process.env.NODE_ENV === "production" && process.env.PIPELINE_AUTH_MODE !== "mock") ? "; Secure" : "";
}
async function emailPacketCode(packetId: string, email: string) {
  const challenge = await requestPacketCode(packetId, email);
  if (challenge) await sendPacketVerificationCode(challenge.email, challenge.code);
  // Unknown packets, recipients and throttled requests share this response.
  return json({ message: "If this email received the packet, a code is on its way. Check your inbox and junk folder. Wait one minute before requesting another." });
}
