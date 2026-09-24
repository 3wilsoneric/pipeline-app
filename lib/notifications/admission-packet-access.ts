import "server-only";

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { PacketAccessError, withAdmissionPacket, type AdmissionPacket } from "./admission-packet-store";
import { getReferral } from "@/lib/pipeline/referral-store";

const codeLifetime = 10 * 60_000;
const sessionLifetime = 60 * 60_000;
const requestWindow = 60 * 60_000;
export const packetCookieName = (id: string) => `pipeline_packet_${id}`;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
function codeHash(id: string, email: string, code: string) {
  const secret = process.env.PIPELINE_ENTRA_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new PacketAccessError("Email verification is temporarily unavailable. Please try again.", 503);
  return createHmac("sha256", secret).update(`packet-code:${id}:${email}:${code}`).digest("hex");
}
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function available(packet: AdmissionPacket | null, now: number): packet is AdmissionPacket {
  return Boolean(packet && !packet.communication && packet.outlook?.deliveryMode !== "attachments" && !packet.revokedAt && Date.parse(packet.expiresAt) > now);
}

export async function requestPacketCode(id: string, inputEmail: string, now = Date.now()) {
  const email = inputEmail.trim().toLowerCase();
  const code = String(randomInt(100_000_000)).padStart(8, "0");
  const hash = codeHash(id, email, code);
  const result = await withAdmissionPacket(id, (packet) => {
    if (!available(packet, now)) return null;
    return { referralId: packet.referralId };
  });
  if (!result || !await getReferral(result.referralId)) return null;
  return withAdmissionPacket(id, (packet) => {
    if (!available(packet, now)) return null;
    const recipient = packet.recipients.find((item) => item.email === email);
    if (!recipient) return null;
    recipient.requestedAt = recipient.requestedAt.filter((at) => now - at < requestWindow);
    if (recipient.requestedAt.length >= 5 || now - (recipient.requestedAt.at(-1) ?? 0) < 60_000) return null;
    recipient.requestedAt.push(now);
    recipient.challenge = { hash, expiresAt: now + codeLifetime, attempts: 0 };
    packet.events.push({ action: "packet_code_requested", at: new Date(now).toISOString(), recipient: email });
    return { email, code };
  });
}

export async function verifyPacketCode(id: string, inputEmail: string, code: string, now = Date.now()) {
  const email = inputEmail.trim().toLowerCase();
  const hash = codeHash(id, email, code);
  const token = randomBytes(32).toString("base64url");
  const ok = await withAdmissionPacket(id, (packet) => {
    if (!available(packet, now)) return false;
    const recipient = packet.recipients.find((item) => item.email === email);
    const challenge = recipient?.challenge;
    if (!recipient || !challenge || challenge.expiresAt <= now || challenge.attempts >= 5) return false;
    challenge.attempts++;
    if (!/^\d{8}$/.test(code) || !sameHash(hash, challenge.hash)) return false;
    delete recipient.challenge;
    recipient.sessions = recipient.sessions.filter((session) => session.expiresAt > now).slice(-4);
    recipient.sessions.push({ hash: tokenHash(token), expiresAt: now + sessionLifetime });
    packet.events.push({ action: "packet_recipient_verified", at: new Date(now).toISOString(), recipient: email });
    return true;
  });
  if (!ok) throw new PacketAccessError("That code is invalid or expired. Request a new code and try again.", 401);
  return { token, expiresIn: sessionLifetime / 1000 };
}

export async function readVerifiedPacket(id: string, token: string, fileId?: string, now = Date.now()) {
  const hash = tokenHash(token);
  const result = await withAdmissionPacket(id, (packet) => {
    if (!available(packet, now)) throw new PacketAccessError("This packet is unavailable or its access has expired. Ask the sender to renew access.", 410);
    const recipient = packet.recipients.find((item) => item.sessions.some((session) => session.expiresAt > now && sameHash(session.hash, hash)));
    if (!token || !recipient) throw new PacketAccessError("Verify your email to open this packet.", 401);
    const file = fileId ? packet.files.find((item) => item.id === fileId) : undefined;
    if (fileId && !file) throw new PacketAccessError("File not found in this packet.", 404);
    packet.events.push({ action: file ? "packet_file_requested" : "packet_opened", at: new Date(now).toISOString(), recipient: recipient.email, ...(file ? { file: file.id } : {}) });
    const session = recipient.sessions.find((session) => session.expiresAt > now && sameHash(session.hash, hash))!;
    return structuredClone({ packet, file, sessionExpiresAt: Math.min(session.expiresAt, Date.parse(packet.expiresAt)) });
  });
  if (!await getReferral(result.packet.referralId)) throw new PacketAccessError("This packet has been withdrawn. Contact the sender.", 410);
  return result;
}

export async function closePacketSession(id: string, token: string) {
  const hash = tokenHash(token);
  await withAdmissionPacket(id, (packet) => {
    for (const recipient of packet?.recipients ?? []) recipient.sessions = recipient.sessions.filter((session) => !sameHash(session.hash, hash));
  });
}

export function packetSessionToken(request: Request, id: string) {
  return request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${packetCookieName(id)}=`))?.slice(packetCookieName(id).length + 1) ?? "";
}
