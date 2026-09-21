import "server-only";

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { getPipelineDatabaseMode, getPipelineSql } from "@/lib/database/pipeline-database";

export type PacketFile = {
  id: string; name: string; contentType: string; byteSize: number;
  source: { kind: "generated"; content: string } | { kind: "blob"; container: string; key: string; etag: string };
};
export type PacketRecipient = {
  email: string;
  challenge?: { hash: string; expiresAt: number; attempts: number };
  requestedAt: number[];
  sessions: { hash: string; expiresAt: number }[];
};
export type AdmissionPacket = {
  schema: 1; id: string; referralId: number; assessmentId: string; assessmentVersion: number;
  createdAt: string; expiresAt: string; revokedAt?: string;
  files: PacketFile[]; recipients: PacketRecipient[];
  message: { subject: string; body: string };
  events: { action: string; at: string; recipient?: string; file?: string; actorId?: string; actorName?: string }[];
};
export class PacketAccessError extends Error {
  constructor(message: string, public status = 403) { super(message); }
}
export const validPacketId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

// Production locks a packet row across replicas. The explicit fixture adapter is
// single-process only; production must never fall back to a local access database.
const localQueues = new Map<string, Promise<unknown>>();
function localPath(id: string) {
  const root = process.env.PIPELINE_PACKET_LINK_STORE_PATH;
  if (!root || process.env.PIPELINE_AUTH_MODE !== "mock") throw new PacketAccessError("Packet storage is unavailable. Please try again shortly.", 503);
  return join(resolve(root), `${id}.json`);
}
export async function createAdmissionPacket(packet: AdmissionPacket) {
  if (!validPacketId(packet.id)) throw new Error("Invalid packet identifier.");
  if (getPipelineDatabaseMode() === "postgres") {
    const sql = getPipelineSql();
    await sql`insert into pipeline.admission_packet_links (packet_id, referral_id, record)
      values (${packet.id}::uuid, ${packet.referralId}, ${sql.json(packet)})`;
    return;
  }
  const path = localPath(packet.id);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(packet), { flag: "wx", mode: 0o600 });
}

export async function withAdmissionPacket<T>(id: string, operation: (packet: AdmissionPacket | null) => T): Promise<T> {
  if (!validPacketId(id)) return operation(null);
  if (getPipelineDatabaseMode() === "postgres") {
    const sql = getPipelineSql();
    const result = await sql.begin(async (tx) => {
      const [row] = await tx<{ record: AdmissionPacket }[]>`select record from pipeline.admission_packet_links where packet_id = ${id}::uuid for update`;
      const packet = row?.record ?? null;
      const previousEvents = packet?.events.length ?? 0;
      const value = operation(packet);
      if (packet) {
        for (const event of packet.events.slice(previousEvents)) await tx`insert into pipeline.audit_events
          (entity_type, entity_id, action, actor_id, actor_name, changed_fields, metadata)
          values ('referral', ${String(packet.referralId)}, ${event.action}, ${event.actorId ?? 'packet-recipient'}, ${event.actorName ?? 'Packet recipient'}, ${[] as string[]},
          ${tx.json({ packet_id: packet.id, ...event })})`;
        // The canonical audit table owns production history, not this working row.
        packet.events = [];
        await tx`update pipeline.admission_packet_links set record = ${tx.json(packet)}, updated_at = now() where packet_id = ${id}::uuid`;
      }
      return { value };
    });
    return (result as { value: T }).value;
  }
  const previous = localQueues.get(id) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    const path = localPath(id);
    let packet: AdmissionPacket | null = null;
    try { packet = JSON.parse(await readFile(path, "utf8")) as AdmissionPacket; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const result = operation(packet);
    if (packet) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(packet), { mode: 0o600 });
      await rename(temporary, path);
    }
    return result;
  });
  localQueues.set(id, pending);
  try { return await pending; } finally { if (localQueues.get(id) === pending) localQueues.delete(id); }
}

export async function listAdmissionPacketLinks(referralId: number) {
  let records: AdmissionPacket[];
  if (getPipelineDatabaseMode() === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<{ record: AdmissionPacket }[]>`select record from pipeline.admission_packet_links where referral_id = ${referralId} order by created_at desc limit 50`;
    records = rows.map((row) => row.record);
  } else {
    const directory = dirname(localPath("00000000-0000-4000-8000-000000000000"));
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    records = [];
    for (const name of names.filter((name) => validPacketId(name.replace(/\.json$/, "")) && name.endsWith(".json"))) {
      const record = JSON.parse(await readFile(join(directory, name), "utf8")) as AdmissionPacket;
      if (record.referralId === referralId) records.push(record);
    }
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    records = records.slice(0, 50);
  }
  return records.map(({ id, createdAt, expiresAt, revokedAt, files, recipients }) => ({ id, created_at: createdAt, expires_at: expiresAt,
    revoked: Boolean(revokedAt), file_count: files.length, recipient_count: recipients.length }));
}

export async function manageAdmissionPacketLink(id: string, referralId: number, action: "renew" | "revoke", actor: { id: string; name: string }) {
  return withAdmissionPacket(id, (packet) => {
    if (!packet || packet.referralId !== referralId) throw new PacketAccessError("Packet not found.", 404);
    const now = new Date();
    if (action === "revoke") packet.revokedAt = now.toISOString();
    else { delete packet.revokedAt; packet.expiresAt = new Date(now.getTime() + 30 * 86400_000).toISOString(); }
    for (const recipient of packet.recipients) { recipient.sessions = []; delete recipient.challenge; }
    packet.events.push({ action: `packet_access_${action === "renew" ? "renewed" : "revoked"}`, at: now.toISOString(), actorId: actor.id, actorName: actor.name });
    return { ok: true };
  });
}
