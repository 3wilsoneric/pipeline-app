import "server-only";

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { TransactionSql } from "postgres";

import { getPipelineSql } from "@/lib/database/pipeline-database";
import {
  type ContactActor,
  type ContactInput,
  type ContactPatch,
  type ContactRecord,
  type ContactSchedulingReadiness,
  type ReferralContactInput,
  type ReferralContactPatch,
  type ReferralContactRecord,
  type ReferralContactRole,
} from "@/lib/pipeline/contact-types";
import { getReferralStoreReadiness } from "@/lib/pipeline/referral-store";

type ContactMutationResult<T> =
  | { ok: true; record: T; idempotentReplay: boolean }
  | { ok: false; conflict: true; current: T };

type ContactRow = {
  contact_id: string;
  version: number | string;
  first_name: string;
  last_name: string;
  organization: string;
  job_title: string;
  phone: string;
  email: string;
  preferred_contact_method: ContactRecord["preferredContactMethod"];
  best_contact_time: string;
  notes: string;
  active: boolean;
  created_by: string;
  created_by_name: string;
  updated_by: string;
  updated_by_name: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type ReferralContactRow = ContactRow & {
  referral_contact_id: string;
  referral_id: number | string;
  link_contact_id: string;
  link_version: number | string;
  role: ReferralContactRole;
  relationship: string;
  link_notes: string;
  primary_for_scheduling: boolean;
  link_created_by: string;
  link_created_by_name: string;
  link_updated_by: string;
  link_updated_by_name: string;
  link_created_at: Date | string;
  link_updated_at: Date | string;
};

type LocalContactAuditEvent = {
  eventId: string;
  referralId: number;
  action: string;
  actor: ContactActor;
  changedFields: string[];
  fromVersion: number | null;
  toVersion: number | null;
  createdAt: string;
};

type ContactStoreFile = {
  schema: 1;
  revision: number;
  contacts: ContactRecord[];
  links: ReferralContactRecord[];
  mutations: Record<string, string>;
  auditEvents: LocalContactAuditEvent[];
};

const globalContactState = globalThis as typeof globalThis & {
  __pipelineContactState?: {
    initialized: boolean;
    loadPromise?: Promise<void>;
    revision: number;
    contacts: ContactRecord[];
    links: ReferralContactRecord[];
    mutations: Map<string, string>;
    auditEvents: LocalContactAuditEvent[];
    mutationQueue: Promise<void>;
  };
};

type LocalContactState = NonNullable<typeof globalContactState.__pipelineContactState>;

const localState: LocalContactState = globalContactState.__pipelineContactState ??= {
  initialized: false,
  revision: 0,
  contacts: [] as ContactRecord[],
  links: [] as ReferralContactRecord[],
  mutations: new Map<string, string>(),
  auditEvents: [] as LocalContactAuditEvent[],
  mutationQueue: Promise.resolve(),
};

export function getContactStoreReadiness() {
  const referral = getReferralStoreReadiness();
  return {
    enabled: true,
    mode: referral.mode,
    ready: referral.ready,
    multi_instance_safe: referral.multi_instance_safe,
    message: referral.ready ? "Contact directory is ready." : referral.message,
  };
}

export function requireContactStore() {
  const readiness = getContactStoreReadiness();
  return readiness.ready
    ? { ok: true as const, readiness }
    : { ok: false as const, readiness, response: Response.json({ error: readiness.message, readiness }, { status: 503 }) };
}

export async function searchContacts(query: string, limit = 20): Promise<ContactRecord[]> {
  if (getContactStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const normalized = normalizeSearch(query);
    const rows = normalized
      ? await sql<ContactRow[]>`
          select * from pipeline.contacts
          where active and search_text like ${`%${normalized}%`}
          order by case when search_text like ${`${normalized}%`} then 0 else 1 end, updated_at desc, contact_id
          limit ${limit}
        `
      : await sql<ContactRow[]>`
          select * from pipeline.contacts where active
          order by updated_at desc, contact_id limit ${limit}
        `;
    return rows.map(mapContactRow);
  }
  await ensureLocalLoaded();
  const tokens = normalizeSearch(query).split(" ").filter(Boolean);
  return localState.contacts
    .filter((contact) => contact.active && tokens.every((token) => contactSearchText(contact).includes(token)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export async function getContact(contactId: string): Promise<ContactRecord | null> {
  if (getContactStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<ContactRow[]>`select * from pipeline.contacts where contact_id = ${contactId}::uuid`;
    return rows[0] ? mapContactRow(rows[0]) : null;
  }
  await ensureLocalLoaded();
  return localState.contacts.find((item) => item.id === contactId) ?? null;
}

export async function isContactLinkedToReferral(contactId: string, referralId: number): Promise<boolean> {
  if (getContactStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<{ linked: boolean }[]>`
      select exists(
        select 1 from pipeline.referral_contacts
        where referral_id = ${referralId} and contact_id = ${contactId}::uuid
      ) as linked
    `;
    return Boolean(rows[0]?.linked);
  }
  await ensureLocalLoaded();
  return localState.links.some((item) => item.referralId === referralId && item.contactId === contactId);
}

export async function listReferralContacts(referralId: number): Promise<ReferralContactRecord[]> {
  if (getContactStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<ReferralContactRow[]>`${referralContactSelect()}
      where rc.referral_id = ${referralId}
      order by rc.primary_for_scheduling desc, rc.created_at, rc.referral_contact_id
    `;
    return rows.map(mapReferralContactRow);
  }
  await ensureLocalLoaded();
  return localState.links
    .filter((item) => item.referralId === referralId)
    .sort((left, right) => Number(right.primaryForScheduling) - Number(left.primaryForScheduling) || left.createdAt.localeCompare(right.createdAt));
}

export async function getContactSchedulingReadiness(
  referralId: number,
  client: { phone?: string | null; email?: string | null },
): Promise<ContactSchedulingReadiness> {
  const hasReachableClient = Boolean(client.phone?.trim() || client.email?.trim());
  const links = await listReferralContacts(referralId);
  const hasPrimarySchedulingContact = links.some((link) =>
    link.primaryForScheduling && link.contact.active && Boolean(link.contact.phone.trim() || link.contact.email.trim()),
  );
  const ready = hasReachableClient || hasPrimarySchedulingContact;
  return {
    ready,
    hasReachableClient,
    hasPrimarySchedulingContact,
    blockers: ready ? [] : ["Add a client phone/email or a reachable primary scheduling contact before scheduling."],
  };
}

export async function createContact(
  input: ContactInput,
  actor: ContactActor,
  mutationId?: string,
): Promise<{ ok: true; record: ContactRecord; idempotentReplay: boolean }> {
  if (getContactStoreReadiness().mode === "postgres") {
    return getPipelineSql().begin((tx) => createPostgresContact(tx, input, actor, mutationId));
  }
  return runLocalMutation(async () => {
    const replayId = localReplay("contact_create", mutationId);
    const replay = replayId ? localState.contacts.find((item) => item.id === replayId) : null;
    if (replay) return { ok: true, record: replay, idempotentReplay: true };
    const now = new Date().toISOString();
    const record: ContactRecord = {
      id: randomUUID(), version: 1, ...input, active: true,
      createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now,
    };
    localState.contacts.push(record);
    saveLocalReplay("contact_create", mutationId, record.id);
    localState.revision += 1;
    await persistLocal();
    return { ok: true, record, idempotentReplay: false };
  });
}

export async function updateContact(
  contactId: string,
  patch: ContactPatch,
  expectedVersion: number,
  actor: ContactActor,
  mutationId?: string,
): Promise<ContactMutationResult<ContactRecord> | null> {
  if (getContactStoreReadiness().mode === "postgres") {
    return getPipelineSql().begin((tx) => updatePostgresContact(tx, contactId, patch, expectedVersion, actor, mutationId));
  }
  return runLocalMutation(async () => {
    const current = localState.contacts.find((item) => item.id === contactId);
    if (!current) return null;
    if (localReplay("contact_update", mutationId) === contactId) return { ok: true, record: current, idempotentReplay: true };
    if (current.version !== expectedVersion) return { ok: false, conflict: true, current };
    const next = { ...current, ...patch, version: current.version + 1, updatedBy: actor, updatedAt: new Date().toISOString() };
    if (!hasContactIdentity(next)) throw new Error("A contact needs a name or organization.");
    localState.contacts = localState.contacts.map((item) => item.id === contactId ? next : item);
    localState.links = localState.links.map((link) => link.contactId === contactId ? { ...link, contact: next } : link);
    const changedFields = Object.keys(patch);
    for (const referralId of new Set(localState.links.filter((link) => link.contactId === contactId).map((link) => link.referralId))) {
      localState.auditEvents.push(localAudit(referralId, "referral_contact_details_updated", actor, changedFields, current.version, next.version));
    }
    saveLocalReplay("contact_update", mutationId, contactId);
    localState.revision += 1;
    await persistLocal();
    return { ok: true, record: next, idempotentReplay: false };
  });
}

export async function attachReferralContact(
  referralId: number,
  input: ReferralContactInput,
  actor: ContactActor,
  mutationId?: string,
): Promise<{ ok: true; record: ReferralContactRecord; idempotentReplay: boolean } | null> {
  if (getContactStoreReadiness().mode === "postgres") {
    return getPipelineSql().begin((tx) => attachPostgresReferralContact(tx, referralId, input, actor, mutationId));
  }
  return runLocalMutation(async () => {
    const contact = localState.contacts.find((item) => item.id === input.contactId && item.active);
    if (!contact) return null;
    const replayId = localReplay(`contact_attach:${referralId}`, mutationId);
    const replay = replayId ? localState.links.find((item) => item.id === replayId && item.referralId === referralId) : null;
    if (replay) return { ok: true, record: replay, idempotentReplay: true };
    const duplicate = localState.links.find((item) => item.referralId === referralId && item.contactId === input.contactId && item.role === input.role);
    if (duplicate) return { ok: true, record: duplicate, idempotentReplay: true };
    if (input.primaryForScheduling) clearLocalPrimary(referralId, actor);
    const now = new Date().toISOString();
    const record: ReferralContactRecord = {
      id: randomUUID(), referralId, version: 1, ...input, contact,
      createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now,
    };
    localState.links.push(record);
    localState.auditEvents.push(localAudit(referralId, "referral_contact_attached", actor, ["contact", "role", ...(input.primaryForScheduling ? ["primaryForScheduling"] : [])], null, 1));
    saveLocalReplay(`contact_attach:${referralId}`, mutationId, record.id);
    localState.revision += 1;
    await persistLocal();
    return { ok: true, record, idempotentReplay: false };
  });
}

export async function updateReferralContact(
  referralId: number,
  linkId: string,
  patch: ReferralContactPatch,
  expectedVersion: number,
  actor: ContactActor,
  mutationId?: string,
): Promise<ContactMutationResult<ReferralContactRecord> | null> {
  if (getContactStoreReadiness().mode === "postgres") {
    return getPipelineSql().begin((tx) => updatePostgresReferralContact(tx, referralId, linkId, patch, expectedVersion, actor, mutationId));
  }
  return runLocalMutation(async () => {
    const current = localState.links.find((item) => item.id === linkId && item.referralId === referralId);
    if (!current) return null;
    if (localReplay(`contact_link_update:${referralId}`, mutationId) === linkId) return { ok: true, record: current, idempotentReplay: true };
    if (current.version !== expectedVersion) return { ok: false, conflict: true, current };
    if (patch.primaryForScheduling) clearLocalPrimary(referralId, actor, linkId);
    const next = { ...current, ...patch, version: current.version + 1, updatedBy: actor, updatedAt: new Date().toISOString() };
    localState.links = localState.links.map((item) => item.id === linkId ? next : item);
    localState.auditEvents.push(localAudit(referralId, "referral_contact_updated", actor, Object.keys(patch), current.version, next.version));
    saveLocalReplay(`contact_link_update:${referralId}`, mutationId, linkId);
    localState.revision += 1;
    await persistLocal();
    return { ok: true, record: next, idempotentReplay: false };
  });
}

export async function unlinkReferralContact(
  referralId: number,
  linkId: string,
  expectedVersion: number,
  actor: ContactActor,
  mutationId?: string,
): Promise<{ ok: true; idempotentReplay: boolean } | { ok: false; conflict: true; current: ReferralContactRecord } | null> {
  if (getContactStoreReadiness().mode === "postgres") {
    return getPipelineSql().begin((tx) => unlinkPostgresReferralContact(tx, referralId, linkId, expectedVersion, actor, mutationId));
  }
  return runLocalMutation(async () => {
    if (localReplay(`contact_unlink:${referralId}`, mutationId) === linkId) return { ok: true, idempotentReplay: true };
    const current = localState.links.find((item) => item.id === linkId && item.referralId === referralId);
    if (!current) return null;
    if (current.version !== expectedVersion) return { ok: false, conflict: true, current };
    localState.links = localState.links.filter((item) => item.id !== linkId);
    localState.auditEvents.push(localAudit(referralId, "referral_contact_unlinked", actor, ["contact"], current.version, null));
    saveLocalReplay(`contact_unlink:${referralId}`, mutationId, linkId);
    localState.revision += 1;
    await persistLocal();
    return { ok: true, idempotentReplay: false };
  });
}

export async function listLocalContactAuditEvents(referralId: number) {
  await ensureLocalLoaded();
  return localState.auditEvents.filter((item) => item.referralId === referralId);
}

async function createPostgresContact(tx: TransactionSql, input: ContactInput, actor: ContactActor, mutationId?: string): Promise<{ ok: true; record: ContactRecord; idempotentReplay: boolean }> {
  const replayId = await lockPostgresMutation(tx, "contact_create", mutationId);
  if (replayId) {
    const replay = await selectPostgresContact(tx, replayId, false);
    if (replay) return { ok: true, record: replay, idempotentReplay: true };
  }
  const rows = await tx<ContactRow[]>`
    insert into pipeline.contacts (
      first_name, last_name, organization, job_title, phone, email, preferred_contact_method,
      best_contact_time, notes, active, search_text, created_by, created_by_name, updated_by, updated_by_name
    ) values (
      ${input.firstName}, ${input.lastName}, ${input.organization}, ${input.jobTitle}, ${input.phone}, ${input.email},
      ${input.preferredContactMethod}, ${input.bestContactTime}, ${input.notes}, true, ${contactSearchText(input)},
      ${actor.id}, ${actor.name}, ${actor.id}, ${actor.name}
    ) returning *
  `;
  const record = mapContactRow(rows[0]);
  await writeContactAudit(tx, "contact", record.id, "contact_created", actor, [], null, 1);
  await savePostgresMutation(tx, "contact_create", mutationId, "contact", record.id);
  await bumpContactRevision(tx);
  return { ok: true, record, idempotentReplay: false };
}

async function updatePostgresContact(tx: TransactionSql, contactId: string, patch: ContactPatch, expectedVersion: number, actor: ContactActor, mutationId?: string): Promise<ContactMutationResult<ContactRecord> | null> {
  const replayId = await lockPostgresMutation(tx, "contact_update", mutationId);
  const current = await selectPostgresContact(tx, contactId, true);
  if (!current) return null;
  if (replayId === contactId) return { ok: true, record: current, idempotentReplay: true };
  if (current.version !== expectedVersion) return { ok: false, conflict: true, current };
  const next = { ...current, ...patch };
  if (!hasContactIdentity(next)) throw new Error("A contact needs a name or organization.");
  const rows = await tx<ContactRow[]>`
    update pipeline.contacts set
      version = version + 1,
      first_name = ${next.firstName}, last_name = ${next.lastName}, organization = ${next.organization},
      job_title = ${next.jobTitle}, phone = ${next.phone}, email = ${next.email},
      preferred_contact_method = ${next.preferredContactMethod}, best_contact_time = ${next.bestContactTime},
      notes = ${next.notes}, active = ${next.active}, search_text = ${contactSearchText(next)},
      updated_by = ${actor.id}, updated_by_name = ${actor.name}, updated_at = now()
    where contact_id = ${contactId}::uuid returning *
  `;
  const record = mapContactRow(rows[0]);
  const changedFields = Object.keys(patch);
  await writeContactAudit(tx, "contact", contactId, "contact_updated", actor, changedFields, current.version, record.version);
  const referrals = await tx<{ referral_id: number | string }[]>`select distinct referral_id from pipeline.referral_contacts where contact_id = ${contactId}::uuid`;
  for (const row of referrals) await writeContactAudit(tx, "referral", String(row.referral_id), "referral_contact_details_updated", actor, changedFields, current.version, record.version);
  await savePostgresMutation(tx, "contact_update", mutationId, "contact", contactId);
  await bumpContactRevision(tx);
  return { ok: true, record, idempotentReplay: false };
}

async function attachPostgresReferralContact(tx: TransactionSql, referralId: number, input: ReferralContactInput, actor: ContactActor, mutationId?: string): Promise<{ ok: true; record: ReferralContactRecord; idempotentReplay: boolean } | null> {
  await lockPostgresReferralContacts(tx, referralId);
  const scope = `contact_attach:${referralId}`;
  const replayId = await lockPostgresMutation(tx, scope, mutationId);
  if (replayId) {
    const replay = await selectPostgresReferralContact(tx, referralId, replayId, false);
    if (replay) return { ok: true, record: replay, idempotentReplay: true };
  }
  const contact = await selectPostgresContact(tx, input.contactId, false);
  if (!contact?.active) return null;
  const duplicates = await tx<{ referral_contact_id: string }[]>`
    select referral_contact_id from pipeline.referral_contacts
    where referral_id = ${referralId} and contact_id = ${input.contactId}::uuid and role = ${input.role}
  `;
  if (duplicates[0]) {
    const duplicate = await selectPostgresReferralContact(tx, referralId, duplicates[0].referral_contact_id, false);
    return duplicate ? { ok: true, record: duplicate, idempotentReplay: true } : null;
  }
  if (input.primaryForScheduling) await clearPostgresPrimary(tx, referralId, actor);
  const rows = await tx<{ referral_contact_id: string }[]>`
    insert into pipeline.referral_contacts (
      referral_id, contact_id, role, relationship, notes, primary_for_scheduling,
      created_by, created_by_name, updated_by, updated_by_name
    ) values (
      ${referralId}, ${input.contactId}::uuid, ${input.role}, ${input.relationship}, ${input.notes}, ${input.primaryForScheduling},
      ${actor.id}, ${actor.name}, ${actor.id}, ${actor.name}
    ) returning referral_contact_id
  `;
  const record = await selectPostgresReferralContact(tx, referralId, rows[0].referral_contact_id, false);
  if (!record) throw new Error("The contact link could not be reloaded.");
  await writeContactAudit(tx, "referral", String(referralId), "referral_contact_attached", actor, ["contact", "role", ...(input.primaryForScheduling ? ["primaryForScheduling"] : [])], null, 1);
  await savePostgresMutation(tx, scope, mutationId, "referral_contact", record.id);
  await bumpContactRevision(tx);
  return { ok: true, record, idempotentReplay: false };
}

async function updatePostgresReferralContact(tx: TransactionSql, referralId: number, linkId: string, patch: ReferralContactPatch, expectedVersion: number, actor: ContactActor, mutationId?: string): Promise<ContactMutationResult<ReferralContactRecord> | null> {
  await lockPostgresReferralContacts(tx, referralId);
  const scope = `contact_link_update:${referralId}`;
  const replayId = await lockPostgresMutation(tx, scope, mutationId);
  const current = await selectPostgresReferralContact(tx, referralId, linkId, true);
  if (!current) return null;
  if (replayId === linkId) return { ok: true, record: current, idempotentReplay: true };
  if (current.version !== expectedVersion) return { ok: false, conflict: true, current };
  if (patch.primaryForScheduling) await clearPostgresPrimary(tx, referralId, actor, linkId);
  const next = { ...current, ...patch };
  await tx`
    update pipeline.referral_contacts set
      version = version + 1, role = ${next.role}, relationship = ${next.relationship}, notes = ${next.notes},
      primary_for_scheduling = ${next.primaryForScheduling}, updated_by = ${actor.id}, updated_by_name = ${actor.name}, updated_at = now()
    where referral_contact_id = ${linkId}::uuid and referral_id = ${referralId}
  `;
  const record = await selectPostgresReferralContact(tx, referralId, linkId, false);
  if (!record) throw new Error("The contact link could not be reloaded.");
  await writeContactAudit(tx, "referral", String(referralId), "referral_contact_updated", actor, Object.keys(patch), current.version, record.version);
  await savePostgresMutation(tx, scope, mutationId, "referral_contact", linkId);
  await bumpContactRevision(tx);
  return { ok: true, record, idempotentReplay: false };
}

async function unlinkPostgresReferralContact(tx: TransactionSql, referralId: number, linkId: string, expectedVersion: number, actor: ContactActor, mutationId?: string) {
  await lockPostgresReferralContacts(tx, referralId);
  const scope = `contact_unlink:${referralId}`;
  const replayId = await lockPostgresMutation(tx, scope, mutationId);
  if (replayId === linkId) return { ok: true as const, idempotentReplay: true };
  const current = await selectPostgresReferralContact(tx, referralId, linkId, true);
  if (!current) return null;
  if (current.version !== expectedVersion) return { ok: false as const, conflict: true as const, current };
  await tx`delete from pipeline.referral_contacts where referral_contact_id = ${linkId}::uuid and referral_id = ${referralId}`;
  await writeContactAudit(tx, "referral", String(referralId), "referral_contact_unlinked", actor, ["contact"], current.version, null);
  await savePostgresMutation(tx, scope, mutationId, "referral_contact", linkId);
  await bumpContactRevision(tx);
  return { ok: true as const, idempotentReplay: false };
}

function referralContactSelect() {
  const sql = getPipelineSql();
  return sql`
    select rc.referral_contact_id, rc.referral_id, rc.contact_id as link_contact_id, rc.version as link_version,
      rc.role, rc.relationship, rc.notes as link_notes, rc.primary_for_scheduling,
      rc.created_by as link_created_by, rc.created_by_name as link_created_by_name,
      rc.updated_by as link_updated_by, rc.updated_by_name as link_updated_by_name,
      rc.created_at as link_created_at, rc.updated_at as link_updated_at,
      c.*
    from pipeline.referral_contacts rc join pipeline.contacts c on c.contact_id = rc.contact_id
  `;
}

async function selectPostgresContact(tx: TransactionSql, contactId: string, lock: boolean) {
  const rows = lock
    ? await tx<ContactRow[]>`select * from pipeline.contacts where contact_id = ${contactId}::uuid for update`
    : await tx<ContactRow[]>`select * from pipeline.contacts where contact_id = ${contactId}::uuid`;
  return rows[0] ? mapContactRow(rows[0]) : null;
}

async function selectPostgresReferralContact(tx: TransactionSql, referralId: number, linkId: string, lock: boolean) {
  const rows = lock
    ? await tx<ReferralContactRow[]>`${referralContactSelect()} where rc.referral_id = ${referralId} and rc.referral_contact_id = ${linkId}::uuid for update of rc`
    : await tx<ReferralContactRow[]>`${referralContactSelect()} where rc.referral_id = ${referralId} and rc.referral_contact_id = ${linkId}::uuid`;
  return rows[0] ? mapReferralContactRow(rows[0]) : null;
}

async function clearPostgresPrimary(tx: TransactionSql, referralId: number, actor: ContactActor, exceptId?: string) {
  const rows = await tx<{ referral_contact_id: string; version: number | string }[]>`
    update pipeline.referral_contacts set primary_for_scheduling = false, version = version + 1,
      updated_by = ${actor.id}, updated_by_name = ${actor.name}, updated_at = now()
    where referral_id = ${referralId} and primary_for_scheduling
      and (${exceptId ?? null}::uuid is null or referral_contact_id <> ${exceptId ?? null}::uuid)
    returning referral_contact_id, version
  `;
  if (rows.length) await writeContactAudit(tx, "referral", String(referralId), "referral_contact_primary_changed", actor, ["primaryForScheduling"], null, null);
}

async function lockPostgresMutation(tx: TransactionSql, scope: string, mutationId?: string) {
  if (!mutationId) return null;
  await tx`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${mutationId}`}, 0))`;
  const rows = await tx<{ entity_id: string }[]>`select entity_id from pipeline.idempotency_keys where scope = ${scope} and mutation_id = ${mutationId}`;
  return rows[0]?.entity_id ?? null;
}

async function lockPostgresReferralContacts(tx: TransactionSql, referralId: number) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`referral_contacts:${referralId}`}, 0))`;
}

async function savePostgresMutation(tx: TransactionSql, scope: string, mutationId: string | undefined, entityType: string, entityId: string) {
  if (!mutationId) return;
  await tx`
    insert into pipeline.idempotency_keys (scope, mutation_id, entity_type, entity_id, expires_at)
    values (${scope}, ${mutationId}, ${entityType}, ${entityId}, now() + interval '30 days')
    on conflict (scope, mutation_id) do nothing
  `;
}

async function writeContactAudit(tx: TransactionSql, entityType: string, entityId: string, action: string, actor: ContactActor, changedFields: string[], fromVersion: number | null, toVersion: number | null) {
  await tx`
    insert into pipeline.audit_events (
      entity_type, entity_id, action, actor_id, actor_name, from_version, to_version, changed_fields, metadata
    ) values (${entityType}, ${entityId}, ${action}, ${actor.id}, ${actor.name}, ${fromVersion}, ${toVersion}, ${changedFields}, ${tx.json({ contact_values_redacted: true })})
  `;
}

async function bumpContactRevision(tx: TransactionSql) {
  await tx`update pipeline.store_revisions set revision = revision + 1, updated_at = now() where store_name = 'contacts'`;
}

function mapContactRow(row: ContactRow): ContactRecord {
  return {
    id: row.contact_id, version: Number(row.version), firstName: row.first_name, lastName: row.last_name,
    organization: row.organization, jobTitle: row.job_title, phone: row.phone, email: row.email,
    preferredContactMethod: row.preferred_contact_method, bestContactTime: row.best_contact_time,
    notes: row.notes, active: row.active,
    createdBy: { id: row.created_by, name: row.created_by_name }, updatedBy: { id: row.updated_by, name: row.updated_by_name },
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function mapReferralContactRow(row: ReferralContactRow): ReferralContactRecord {
  return {
    id: row.referral_contact_id, referralId: Number(row.referral_id), contactId: row.link_contact_id,
    version: Number(row.link_version), role: row.role, relationship: row.relationship, notes: row.link_notes,
    primaryForScheduling: row.primary_for_scheduling,
    createdBy: { id: row.link_created_by, name: row.link_created_by_name },
    updatedBy: { id: row.link_updated_by, name: row.link_updated_by_name },
    createdAt: iso(row.link_created_at), updatedAt: iso(row.link_updated_at), contact: mapContactRow(row),
  };
}

function clearLocalPrimary(referralId: number, actor: ContactActor, exceptId?: string) {
  const now = new Date().toISOString();
  const changed = localState.links.some((item) =>
    item.referralId === referralId && item.primaryForScheduling && item.id !== exceptId,
  );
  localState.links = localState.links.map((item) =>
    item.referralId === referralId && item.primaryForScheduling && item.id !== exceptId
      ? { ...item, primaryForScheduling: false, version: item.version + 1, updatedBy: actor, updatedAt: now }
      : item,
  );
  if (changed) {
    localState.auditEvents.push(localAudit(referralId, "referral_contact_primary_changed", actor, ["primaryForScheduling"], null, null));
  }
}

function localAudit(referralId: number, action: string, actor: ContactActor, changedFields: string[], fromVersion: number | null, toVersion: number | null): LocalContactAuditEvent {
  return { eventId: randomUUID(), referralId, action, actor, changedFields, fromVersion, toVersion, createdAt: new Date().toISOString() };
}

function localReplay(scope: string, mutationId?: string) {
  return mutationId ? localState.mutations.get(`${scope}:${mutationId}`) : undefined;
}

function saveLocalReplay(scope: string, mutationId: string | undefined, entityId: string) {
  if (mutationId) localState.mutations.set(`${scope}:${mutationId}`, entityId);
}

async function runLocalMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const previous = localState.mutationQueue;
  let release: () => void = () => undefined;
  localState.mutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const snapshot = {
    revision: localState.revision,
    contacts: structuredClone(localState.contacts),
    links: structuredClone(localState.links),
    mutations: new Map(localState.mutations),
    auditEvents: structuredClone(localState.auditEvents),
  };
  try {
    return await mutation();
  } catch (error) {
    localState.revision = snapshot.revision;
    localState.contacts = snapshot.contacts;
    localState.links = snapshot.links;
    localState.mutations = snapshot.mutations;
    localState.auditEvents = snapshot.auditEvents;
    throw error;
  } finally {
    release();
  }
}

async function ensureLocalLoaded() {
  if (localState.initialized) {
    if (localState.loadPromise) await localState.loadPromise;
    return;
  }
  localState.initialized = true;
  localState.loadPromise = (async () => {
    try {
      const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ contactStorePath(), "utf8")) as Partial<ContactStoreFile>;
      if (parsed.schema !== 1) return;
      localState.revision = Number(parsed.revision ?? 0);
      localState.contacts = Array.isArray(parsed.contacts) ? parsed.contacts : [];
      localState.links = Array.isArray(parsed.links) ? parsed.links : [];
      localState.mutations = new Map(Object.entries(parsed.mutations ?? {}));
      localState.auditEvents = Array.isArray(parsed.auditEvents) ? parsed.auditEvents.slice(-100_000) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  })();
  await localState.loadPromise;
  localState.loadPromise = undefined;
}

async function persistLocal() {
  const file: ContactStoreFile = {
    schema: 1, revision: localState.revision, contacts: localState.contacts, links: localState.links,
    mutations: Object.fromEntries(localState.mutations), auditEvents: localState.auditEvents.slice(-100_000),
  };
  const target = contactStorePath();
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(/* turbopackIgnore: true */ dirname(target), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(file), { encoding: "utf8", mode: 0o600 });
  await chmod(/* turbopackIgnore: true */ temporary, 0o600);
  await rename(/* turbopackIgnore: true */ temporary, target);
  await chmod(/* turbopackIgnore: true */ target, 0o600);
}

function contactStorePath() {
  return resolve(/* turbopackIgnore: true */ process.env.PIPELINE_CONTACT_STORE_PATH?.trim() || ".data/contacts.json");
}

function contactSearchText(contact: Partial<ContactRecord> | ContactInput) {
  return normalizeSearch([contact.firstName, contact.lastName, contact.organization, contact.jobTitle, contact.phone, contact.email].filter(Boolean).join(" "));
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}@.+-]+/gu, " ").replace(/\s+/gu, " ");
}

function hasContactIdentity(contact: Pick<ContactRecord, "firstName" | "lastName" | "organization">) {
  return Boolean(contact.firstName.trim() || contact.lastName.trim() || contact.organization.trim());
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
