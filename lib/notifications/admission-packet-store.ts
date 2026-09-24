import "server-only";

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { getPipelineDatabaseMode, getPipelineSql } from "@/lib/database/pipeline-database";
import type { DeliveryAudit } from "@/lib/pipeline/meet-client-delivery-audit";
import type { OutlookDraftState } from "./outlook-draft-contract";
import type { CommunicationStatus } from "./communication-contract";
import { decodeKeysetCursor, encodeKeysetCursor, isAfterDescendingCursor } from "@/lib/pipeline/keyset-cursor";

export type PacketFile = {
  id: string; name: string; contentType: string; byteSize: number;
  archived?: boolean;
  source: { kind: "generated"; content: string; encoding?: "base64" } | { kind: "blob"; container: string; key: string; etag: string };
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
  communication?: {
    status: CommunicationStatus; ownerId: string; assessorId: string; assessorName: string;
    clientName: string; community: string; admissionDate: string;
    from: string; to: string[]; cc: string[]; replyTo: string;
    html: string; preparedBy: string; requestKey: string;
    audit: DeliveryAudit; submittedAt?: string; note?: string;
    originals: PacketFile[];
    archiveObjects: Array<{ container: string; key: string }>;
  };
  outlook?: {
    // Shared handoff envelope; absent transport preserves existing Outlook drafts.
    transport?: "assessor_email";
    acceptedAt?: string;
    ownerId: string; mailboxId?: string; mailbox: string; status: OutlookDraftState; audit: DeliveryAudit;
    referralVersion: number; packetRevision: string; messageId?: string; webLink?: string;
    note?: string;
    toRecipients?: string[];
    ccRecipients?: string[];
    deliveryMode?: "attachments";
    html?: string;
    attachmentHashes?: Record<string, string>;
    attachmentsReady?: boolean;
    operation?: { id: string; expiresAt: number };
  };
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
    const rows = await sql<{ record: AdmissionPacket }[]>`select record from pipeline.admission_packet_links where referral_id = ${referralId} and record->'communication' is null and coalesce(record->'outlook'->>'deliveryMode', '') <> 'attachments' order by created_at desc limit 50`;
    records = rows.map((row) => row.record);
  } else {
    const directory = dirname(localPath("00000000-0000-4000-8000-000000000000"));
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    records = [];
    for (const name of names.filter((name) => validPacketId(name.replace(/\.json$/, "")) && name.endsWith(".json"))) {
      const record = JSON.parse(await readFile(join(directory, name), "utf8")) as AdmissionPacket;
      if (record.referralId === referralId) records.push(record);
    }
    records = records.filter((packet) => !packet.communication && packet.outlook?.deliveryMode !== "attachments");
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    records = records.slice(0, 50);
  }
  return records.map(({ id, createdAt, expiresAt, revokedAt, files, recipients }) => ({ id, created_at: createdAt, expires_at: expiresAt,
    revoked: Boolean(revokedAt), file_count: files.length, recipient_count: recipients.length }));
}

export async function manageAdmissionPacketLink(id: string, referralId: number, action: "renew" | "revoke", actor: { id: string; name: string }) {
  return withAdmissionPacket(id, (packet) => {
    if (!packet || packet.referralId !== referralId) throw new PacketAccessError("Packet not found.", 404);
    if (packet.communication || packet.outlook?.deliveryMode === "attachments") throw new PacketAccessError("This handoff uses email attachments, not a download link.", 409);
    if (action === "renew" && packet.outlook && packet.outlook.status !== "sent") throw new PacketAccessError("Prepare a new handoff to share this packet again.", 409);
    const now = new Date();
    if (action === "revoke") packet.revokedAt = now.toISOString();
    else { delete packet.revokedAt; packet.expiresAt = new Date(now.getTime() + 30 * 86400_000).toISOString(); }
    for (const recipient of packet.recipients) { recipient.sessions = []; delete recipient.challenge; }
    packet.events.push({ action: `packet_access_${action === "renew" ? "renewed" : "revoked"}`, at: now.toISOString(), actorId: actor.id, actorName: actor.name });
    return { ok: true };
  });
}

export async function findWorkspaceOutlookDraft(referralId: number): Promise<AdmissionPacket | null> {
  if (getPipelineDatabaseMode() === "postgres") {
    const sql = getPipelineSql();
    const [row] = await sql<{ record: AdmissionPacket }[]>`select record from pipeline.admission_packet_links
      where referral_id = ${referralId} and record->'outlook' is not null
      and record->'outlook'->>'status' <> 'discarded' order by created_at desc limit 1`;
    return row?.record ?? null;
  }
  const directory = dirname(localPath("00000000-0000-4000-8000-000000000000"));
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  const records: AdmissionPacket[] = [];
  for (const name of names.filter((name) => validPacketId(name.replace(/\.json$/, "")) && name.endsWith(".json"))) {
    const packet = JSON.parse(await readFile(join(directory, name), "utf8")) as AdmissionPacket;
    if (packet.referralId === referralId && packet.outlook && packet.outlook.status !== "discarded") records.push(packet);
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

// Paging is bounded even when later record-access checks hide some entries.
export async function listCommunicationPackets(options: { referralId?: number; ownerId?: string; cursor?: string; query?: string }) {
  const cursor = decodeKeysetCursor(options.cursor);
  if (options.cursor && !cursor) throw new PacketAccessError("Invalid history page.", 400);
  const query = options.query?.trim().toLowerCase() ?? "";
  let records: AdmissionPacket[];
  if (getPipelineDatabaseMode() === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<{ record: AdmissionPacket }[]>`
      select record from pipeline.admission_packet_links
      where record->'communication' is not null
      and (${options.referralId ?? null}::bigint is null or referral_id = ${options.referralId ?? null})
      and (${options.ownerId ?? null}::text is null or record->'communication'->>'ownerId' = ${options.ownerId ?? null}
        or record->'communication'->>'assessorId' = ${options.ownerId ?? null})
      and (${cursor?.timestamp ?? null}::text is null or
        (record->>'createdAt', packet_id::text) < (${cursor?.timestamp ?? null}, ${cursor?.key ?? null}))
      and (${query} = '' or position(${query} in lower(concat(record->'communication'->>'clientName', ' ', record->'communication'->>'community', ' ', record->'message'->>'subject'))) > 0)
      order by record->>'createdAt' desc, packet_id::text desc limit 21
    `;
    records = rows.map(row => row.record);
  } else {
    const directory = dirname(localPath("00000000-0000-4000-8000-000000000000"));
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    records = [];
    for (const name of names.filter(name => validPacketId(name.replace(/\.json$/, "")) && name.endsWith(".json"))) {
      const packet: AdmissionPacket = JSON.parse(await readFile(join(directory, name), "utf8"));
      const c = packet.communication;
      if (!c || (options.referralId && packet.referralId !== options.referralId)
        || (options.ownerId && c.ownerId !== options.ownerId && c.assessorId !== options.ownerId)
        || !isAfterDescendingCursor(packet.createdAt, packet.id, cursor)
        || !`${c.clientName} ${c.community} ${packet.message.subject}`.toLowerCase().includes(query)) continue;
      records.push(packet);
    }
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
  const items = records.slice(0, 20);
  const last = items.at(-1);
  return { items, nextCursor: records.length > 20 && last ? encodeKeysetCursor({ timestamp: last.createdAt, key: last.id }) : undefined };
}

export async function findPreparedCommunication(referralId: number, ownerId: string, requestKey: string) {
  if (getPipelineDatabaseMode() === "postgres") {
    const sql = getPipelineSql();
    const [row] = await sql<{ record: AdmissionPacket }[]>`select record from pipeline.admission_packet_links
      where referral_id = ${referralId} and record->'communication'->>'ownerId' = ${ownerId}
      and record->'communication'->>'requestKey' = ${requestKey} and record->'communication'->>'status' = 'ready'
      order by created_at desc limit 1`;
    return row?.record ?? null;
  }
  let cursor: string | undefined;
  do {
    const page = await listCommunicationPackets({ referralId, ownerId, cursor });
    const found = page.items.find(packet => packet.communication?.status === "ready" && packet.communication.requestKey === requestKey);
    if (found) return found;
    cursor = page.nextCursor;
  } while (cursor);
  return null;
}
