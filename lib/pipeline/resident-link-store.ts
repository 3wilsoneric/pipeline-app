import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { TransactionSql } from "postgres";

import {
  getPipelineDatabaseReadiness,
  getPipelineSql,
} from "@/lib/database/pipeline-database";
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  isAfterDescendingCursor,
} from "@/lib/pipeline/keyset-cursor";
import type {
  PipelineResidentLink,
  ResidentLinkActor,
  ResidentLinkAuditEvent,
  ResidentLinkCreateInput,
  ResidentLinkListResponse,
  ResidentLinkReviewInput,
  ResidentLinkStatus,
} from "./resident-link-records";

export type ResidentLinkListOptions = {
  residentKey?: string;
  residentNumber?: string;
  referralId?: number;
  pipelineClientId?: string;
  status?: ResidentLinkStatus;
  limit?: number;
  cursor?: string;
};

export type ResidentLinkMutation =
  | { ok: true; link: PipelineResidentLink; revision: number }
  | { ok: false; conflict: true; link: PipelineResidentLink }
  | {
      ok: false;
      blocked: true;
      link: PipelineResidentLink;
      blockers: { code: string; label: string }[];
    };

export type ResidentLinkStoreReadiness = {
  mode: "local_file" | "postgres";
  ready: boolean;
  multi_instance_safe: boolean;
  message: string | null;
};

export interface ResidentLinkStore {
  list(options?: ResidentLinkListOptions): Promise<ResidentLinkListResponse>;
  get(linkId: string): Promise<PipelineResidentLink | null>;
  create(input: ResidentLinkCreateInput, actor: ResidentLinkActor, mutationId?: string): Promise<ResidentLinkMutation>;
  review(linkId: string, input: ResidentLinkReviewInput, actor: ResidentLinkActor, expectedVersion: number): Promise<ResidentLinkMutation | null>;
}

type LocalResidentLinkFile = {
  version: 1;
  revision: number;
  links: PipelineResidentLink[];
  create_mutations?: Record<string, string>;
};

type LocalResidentLinkState = {
  initialized: boolean;
  loadPromise?: Promise<void>;
  revision: number;
  links: PipelineResidentLink[];
  createMutations: Map<string, string>;
  mutationQueue: Promise<void>;
  persistQueue: Promise<void>;
};

const globalForResidentLinks = globalThis as typeof globalThis & {
  __pipelineResidentLinkState?: LocalResidentLinkState;
};

const localState = globalForResidentLinks.__pipelineResidentLinkState ??
  (globalForResidentLinks.__pipelineResidentLinkState = {
    initialized: false,
    revision: 0,
    links: [],
    createMutations: new Map<string, string>(),
    mutationQueue: Promise.resolve(),
    persistQueue: Promise.resolve(),
  });

const maxRows = 100_000;
const maxPageSize = 200;

export function getResidentLinkStoreReadiness(): ResidentLinkStoreReadiness {
  const configured = process.env.PIPELINE_RESIDENT_LINK_STORE_MODE?.trim();
  const postgresMode = configured === "postgres" ||
    (!configured && process.env.PIPELINE_DATABASE_MODE === "postgres");

  if (postgresMode) {
    const database = getPipelineDatabaseReadiness();
    return {
      mode: "postgres",
      ready: database.ready,
      multi_instance_safe: database.ready,
      message: database.message,
    };
  }

  const localAllowed = process.env.NODE_ENV !== "production" ||
    process.env.PIPELINE_ALLOW_LOCAL_REFERRAL_STORE === "true";
  return {
    mode: "local_file",
    ready: localAllowed,
    multi_instance_safe: false,
    message: localAllowed
      ? "Local resident links are suitable for one development instance only."
      : "Production requires PIPELINE_RESIDENT_LINK_STORE_MODE=postgres.",
  };
}

export function requireResidentLinkStore() {
  const readiness = getResidentLinkStoreReadiness();
  if (readiness.ready) return { ok: true as const, readiness };
  return {
    ok: false as const,
    readiness,
    response: Response.json(
      { error: readiness.message, readiness },
      { status: 503, headers: privateHeaders() },
    ),
  };
}

export function getResidentLinkStore(): ResidentLinkStore {
  return getResidentLinkStoreReadiness().mode === "postgres"
    ? postgresResidentLinkStore
    : localResidentLinkStore;
}

export async function listResidentLinks(options: ResidentLinkListOptions = {}) {
  return getResidentLinkStore().list(options);
}

export async function getResidentLink(linkId: string) {
  return getResidentLinkStore().get(linkId);
}

export async function createResidentLink(
  input: ResidentLinkCreateInput,
  actor: ResidentLinkActor,
  mutationId?: string,
) {
  return getResidentLinkStore().create(input, actor, mutationId);
}

export async function reviewResidentLink(
  linkId: string,
  input: ResidentLinkReviewInput,
  actor: ResidentLinkActor,
  expectedVersion: number,
) {
  return getResidentLinkStore().review(linkId, input, actor, expectedVersion);
}

const localResidentLinkStore: ResidentLinkStore = {
  list: listLocalResidentLinks,
  get: getLocalResidentLink,
  create: createLocalResidentLink,
  review: reviewLocalResidentLink,
};

async function listLocalResidentLinks(options: ResidentLinkListOptions = {}): Promise<ResidentLinkListResponse> {
  await ensureLocalLoaded();
  const matches = localState.links
    .filter((link) => matchesOptions(link, options))
    .sort(compareLinks);
  const cursor = decodeKeysetCursor(options.cursor);
  const limit = clampLimit(options.limit);
  const afterCursor = matches.filter((link) =>
    isAfterDescendingCursor(link.updated_at, link.link_id, cursor),
  );
  const links = afterCursor.slice(0, limit);
  const last = links.at(-1);
  return {
    links,
    total: matches.length,
    next_cursor: afterCursor.length > limit && last
      ? encodeKeysetCursor({ timestamp: last.updated_at, key: last.link_id })
      : null,
    generated_at: new Date().toISOString(),
    store: { mode: "local_file", multi_instance_safe: false },
  };
}

async function getLocalResidentLink(linkId: string) {
  await ensureLocalLoaded();
  return localState.links.find((link) => link.link_id === linkId) ?? null;
}

async function createLocalResidentLink(
  input: ResidentLinkCreateInput,
  actor: ResidentLinkActor,
  mutationId?: string,
): Promise<ResidentLinkMutation> {
  return withLocalMutation(async () => {
    await ensureLocalLoaded();
    const mutationLinkId = mutationId ? localState.createMutations.get(mutationId) : undefined;
    const mutationLink = mutationLinkId
      ? localState.links.find((link) => link.link_id === mutationLinkId)
      : undefined;
    if (mutationLink) return { ok: true, link: mutationLink, revision: localState.revision };

    const duplicate = localState.links.find((link) =>
      link.status !== "rejected" &&
      link.pipeline_client_id === input.pipeline_client_id &&
      link.resident_key === input.resident_key,
    );
    if (duplicate) {
      if (mutationId) {
        localState.createMutations.set(mutationId, duplicate.link_id);
        await persistLocal();
      }
      return { ok: true, link: duplicate, revision: localState.revision };
    }
    if (localState.links.length >= maxRows) throw new Error("Resident-link capacity reached.");

    const now = new Date().toISOString();
    const linkId = randomUUID();
    const personId = localState.links.find((link) => link.pipeline_client_id === input.pipeline_client_id)?.person_id ?? randomUUID();
    const audit = createAuditEvent(linkId, "resident_link_created", actor, null, "candidate", now);
    const link: PipelineResidentLink = {
      link_id: linkId,
      person_id: personId,
      pipeline_client_id: input.pipeline_client_id,
      referral_id: input.referral_id ?? null,
      resident_key: input.resident_key,
      resident_number: input.resident_number ?? null,
      community_id: input.community_id,
      status: "candidate",
      match_method: input.match_method,
      match_confidence: input.match_confidence ?? null,
      version: 1,
      created_by: actor,
      reviewed_by: null,
      review_note: null,
      created_at: now,
      reviewed_at: null,
      updated_at: now,
      audit_events: [audit],
    };
    localState.links = [link, ...localState.links];
    localState.revision += 1;
    if (mutationId) localState.createMutations.set(mutationId, linkId);
    await persistLocal();
    return { ok: true, link, revision: localState.revision };
  });
}

async function reviewLocalResidentLink(
  linkId: string,
  input: ResidentLinkReviewInput,
  actor: ResidentLinkActor,
  expectedVersion: number,
): Promise<ResidentLinkMutation | null> {
  return withLocalMutation(async () => {
    await ensureLocalLoaded();
    const index = localState.links.findIndex((link) => link.link_id === linkId);
    if (index < 0) return null;
    const current = localState.links[index];
    if (current.version !== expectedVersion) return { ok: false, conflict: true, link: current };
    const nextStatus = input.action === "confirm" ? "confirmed" : "rejected";
    if (current.status === nextStatus) return { ok: true, link: current, revision: localState.revision };
    if (current.status !== "candidate") {
      return {
        ok: false,
        blocked: true,
        link: current,
        blockers: [{ code: "resident_link_already_reviewed", label: "This resident link has already been reviewed." }],
      };
    }
    if (nextStatus === "confirmed") {
      const collision = localState.links.find((link) =>
        link.link_id !== current.link_id &&
        link.status === "confirmed" &&
        (link.resident_key === current.resident_key || link.person_id === current.person_id),
      );
      if (collision) {
        return {
          ok: false,
          blocked: true,
          link: current,
          blockers: [{
            code: collision.resident_key === current.resident_key
              ? "resident_already_linked"
              : "pipeline_person_already_linked",
            label: "A confirmed identity link already exists. Review both records instead of merging them.",
          }],
        };
      }
    }

    const now = new Date().toISOString();
    const action = nextStatus === "confirmed" ? "resident_link_confirmed" : "resident_link_rejected";
    const next: PipelineResidentLink = {
      ...current,
      status: nextStatus,
      version: current.version + 1,
      reviewed_by: actor,
      review_note: input.review_note?.trim() || null,
      reviewed_at: now,
      updated_at: now,
      audit_events: [...current.audit_events, createAuditEvent(linkId, action, actor, current.status, nextStatus, now)],
    };
    localState.links[index] = next;
    localState.revision += 1;
    await persistLocal();
    return { ok: true, link: next, revision: localState.revision };
  });
}

async function ensureLocalLoaded() {
  if (localState.initialized) {
    if (localState.loadPromise) await localState.loadPromise;
    return;
  }
  localState.initialized = true;
  localState.loadPromise = (async () => {
    try {
      const raw = await readFile(/* turbopackIgnore: true */ localStorePath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<LocalResidentLinkFile>;
      localState.links = Array.isArray(parsed.links)
        ? parsed.links.filter(isResidentLinkRecord).slice(0, maxRows)
        : [];
      localState.revision = Number.isInteger(parsed.revision) ? Number(parsed.revision) : 0;
      localState.createMutations = new Map(
        Object.entries(parsed.create_mutations ?? {}).filter(([, value]) => typeof value === "string"),
      );
    } catch (error) {
      if (!isMissingFile(error)) {
        console.warn(JSON.stringify({ service: "pipeline-app", event: "resident_link_store_load_failed" }));
      }
    }
  })();
  await localState.loadPromise;
  localState.loadPromise = undefined;
}

async function persistLocal() {
  const snapshot: LocalResidentLinkFile = {
    version: 1,
    revision: localState.revision,
    links: localState.links,
    create_mutations: Object.fromEntries(localState.createMutations),
  };
  const path = localStorePath();
  const temporaryPath = `${path}.${process.pid}.tmp`;
  localState.persistQueue = localState.persistQueue.catch(() => undefined).then(async () => {
    await mkdir(/* turbopackIgnore: true */ dirname(path), { recursive: true });
    await writeFile(/* turbopackIgnore: true */ temporaryPath, JSON.stringify(snapshot), "utf8");
    await rename(/* turbopackIgnore: true */ temporaryPath, path);
  });
  await localState.persistQueue;
}

async function withLocalMutation<T>(work: () => Promise<T>): Promise<T> {
  const previous = localState.mutationQueue;
  let release: () => void = () => {};
  localState.mutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
  }
}

const postgresResidentLinkStore: ResidentLinkStore = {
  list: listPostgresResidentLinks,
  get: getPostgresResidentLink,
  create: createPostgresResidentLink,
  review: reviewPostgresResidentLink,
};

type ResidentLinkRow = {
  resident_link_id: string;
  person_id: string;
  external_client_id: string;
  referral_id: number | string | null;
  resident_key: string;
  resident_number: string | null;
  community_id: string;
  status: ResidentLinkStatus;
  match_method: PipelineResidentLink["match_method"];
  match_confidence: number | string | null;
  version: number;
  created_by: string;
  created_by_name: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  created_at: Date | string;
  reviewed_at: Date | string | null;
  updated_at: Date | string;
  total_count?: number | string;
};

async function listPostgresResidentLinks(options: ResidentLinkListOptions = {}): Promise<ResidentLinkListResponse> {
  const sql = getPipelineSql();
  const cursor = decodeKeysetCursor(options.cursor);
  const limit = clampLimit(options.limit);
  const queryLimit = limit + 1;
  const cursorTimestamp = cursor?.timestamp ?? null;
  const cursorKey = cursor?.key ?? null;
  const residentKey = options.residentKey?.trim() || null;
  const residentNumber = options.residentNumber?.trim() || null;
  const pipelineClientId = options.pipelineClientId?.trim() || null;
  const referralId = options.referralId ?? null;
  const status = options.status ?? null;
  const rows = await sql<ResidentLinkRow[]>`
    with filtered as (
      select rl.*, p.external_client_id, count(*) over() as total_count
      from pipeline.resident_links rl
      join pipeline.people p on p.person_id = rl.person_id
      where (${residentKey}::text is null or rl.resident_key = ${residentKey})
        and (${residentNumber}::text is null or rl.resident_number = ${residentNumber})
        and (${pipelineClientId}::text is null or p.external_client_id = ${pipelineClientId})
        and (${referralId}::bigint is null or rl.referral_id = ${referralId})
        and (${status}::text is null or rl.status = ${status})
    )
    select * from filtered
    where (${cursorTimestamp}::timestamptz is null
      or (updated_at, resident_link_id) < (${cursorTimestamp}::timestamptz, ${cursorKey}::uuid))
    order by updated_at desc, resident_link_id desc
    limit ${queryLimit}
  `;
  const pageRows = rows.slice(0, limit);
  const total = Number(rows[0]?.total_count ?? 0);
  const last = pageRows.at(-1);
  return {
    links: pageRows.map(mapResidentLinkRow),
    total,
    next_cursor: rows.length > limit && last
      ? encodeKeysetCursor({ timestamp: isoTimestamp(last.updated_at), key: last.resident_link_id })
      : null,
    generated_at: new Date().toISOString(),
    store: { mode: "postgres", multi_instance_safe: true },
  };
}

async function getPostgresResidentLink(linkId: string) {
  const sql = getPipelineSql();
  const rows = await sql<ResidentLinkRow[]>`
    select rl.*, p.external_client_id
    from pipeline.resident_links rl
    join pipeline.people p on p.person_id = rl.person_id
    where rl.resident_link_id = ${linkId}::uuid
    limit 1
  `;
  return rows[0] ? mapResidentLinkRow(rows[0]) : null;
}

async function createPostgresResidentLink(
  input: ResidentLinkCreateInput,
  actor: ResidentLinkActor,
  mutationId?: string,
): Promise<ResidentLinkMutation> {
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    if (mutationId) {
      const idempotent = await tx<{ entity_id: string }[]>`
        select entity_id from pipeline.idempotency_keys
        where scope = 'resident_link_create' and mutation_id = ${mutationId}
        limit 1
      `;
      if (idempotent[0]) {
        const existing = await getResidentLinkInTransaction(tx, idempotent[0].entity_id);
        if (existing) return { ok: true, link: existing, revision: existing.version };
      }
    }

    const people = await tx<{ person_id: string }[]>`
      insert into pipeline.people (external_client_id, display_name, date_of_birth)
      values (${input.pipeline_client_id}, ${input.display_name}, ${input.date_of_birth ?? null}::date)
      on conflict (external_client_id) do update
        set display_name = excluded.display_name,
            date_of_birth = coalesce(pipeline.people.date_of_birth, excluded.date_of_birth),
            updated_at = now()
      returning person_id
    `;
    const personId = people[0].person_id;
    const duplicateRows = await tx<ResidentLinkRow[]>`
      select rl.*, p.external_client_id
      from pipeline.resident_links rl
      join pipeline.people p on p.person_id = rl.person_id
      where rl.person_id = ${personId}::uuid
        and rl.resident_key = ${input.resident_key}
        and rl.status <> 'rejected'
      order by rl.updated_at desc
      limit 1
    `;
    if (duplicateRows[0]) return { ok: true, link: mapResidentLinkRow(duplicateRows[0]), revision: duplicateRows[0].version };

    const linkId = randomUUID();
    const rows = await tx<ResidentLinkRow[]>`
      insert into pipeline.resident_links (
        resident_link_id, person_id, referral_id, resident_key, resident_number,
        community_id, status, match_method, match_confidence, created_by, created_by_name
      ) values (
        ${linkId}::uuid, ${personId}::uuid, ${input.referral_id ?? null}::bigint,
        ${input.resident_key}, ${input.resident_number ?? null}, ${input.community_id},
        'candidate', ${input.match_method}, ${input.match_confidence ?? null},
        ${actor.id}, ${actor.name}
      )
      on conflict (person_id, resident_key) where status <> 'rejected' do nothing
      returning *, ${input.pipeline_client_id}::text as external_client_id
    `;
    const row = rows[0] ?? (await tx<ResidentLinkRow[]>`
      select rl.*, p.external_client_id
      from pipeline.resident_links rl
      join pipeline.people p on p.person_id = rl.person_id
      where rl.person_id = ${personId}::uuid
        and rl.resident_key = ${input.resident_key}
        and rl.status <> 'rejected'
      order by rl.updated_at desc
      limit 1
    `)[0];
    if (!row) throw new Error("The resident-link candidate could not be created.");
    const effectiveLinkId = row.resident_link_id;
    if (rows[0]) {
      await tx`
        insert into pipeline.audit_events (
          entity_type, entity_id, action, actor_id, actor_name,
          from_version, to_version, changed_fields, after_values
        ) values (
          'resident_link', ${effectiveLinkId}, 'resident_link_created', ${actor.id}, ${actor.name},
          null, 1, array['status'], ${tx.json({ status: "candidate" })}
        )
      `;
    }
    if (mutationId) {
      await tx`
        insert into pipeline.idempotency_keys (scope, mutation_id, entity_type, entity_id)
        values ('resident_link_create', ${mutationId}, 'resident_link', ${effectiveLinkId})
        on conflict (scope, mutation_id) do nothing
      `;
    }
    const link = mapResidentLinkRow(row);
    return { ok: true, link, revision: link.version };
  });
}

async function reviewPostgresResidentLink(
  linkId: string,
  input: ResidentLinkReviewInput,
  actor: ResidentLinkActor,
  expectedVersion: number,
): Promise<ResidentLinkMutation | null> {
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    const currentRows = await tx<ResidentLinkRow[]>`
      select rl.*, p.external_client_id
      from pipeline.resident_links rl
      join pipeline.people p on p.person_id = rl.person_id
      where rl.resident_link_id = ${linkId}::uuid
      for update
    `;
    if (!currentRows[0]) return null;
    const current = mapResidentLinkRow(currentRows[0]);
    if (current.version !== expectedVersion) return { ok: false, conflict: true, link: current };
    const nextStatus = input.action === "confirm" ? "confirmed" : "rejected";
    if (current.status === nextStatus) return { ok: true, link: current, revision: current.version };
    if (current.status !== "candidate") {
      return {
        ok: false,
        blocked: true,
        link: current,
        blockers: [{ code: "resident_link_already_reviewed", label: "This resident link has already been reviewed." }],
      };
    }
    if (nextStatus === "confirmed") {
      for (const lockKey of [`person:${current.person_id}`, `resident:${current.resident_key}`].sort()) {
        await tx`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      }
      const collisions = await tx<{ resident_key: string; person_id: string }[]>`
        select resident_key, person_id
        from pipeline.resident_links
        where resident_link_id <> ${linkId}::uuid
          and status = 'confirmed'
          and (resident_key = ${current.resident_key} or person_id = ${current.person_id}::uuid)
        limit 1
      `;
      if (collisions[0]) {
        return {
          ok: false,
          blocked: true,
          link: current,
          blockers: [{
            code: collisions[0].resident_key === current.resident_key
              ? "resident_already_linked"
              : "pipeline_person_already_linked",
            label: "A confirmed identity link already exists. Review both records instead of merging them.",
          }],
        };
      }
    }

    const rows = await tx<ResidentLinkRow[]>`
      update pipeline.resident_links
      set status = ${nextStatus},
          version = version + 1,
          reviewed_by = ${actor.id},
          reviewed_by_name = ${actor.name},
          review_note = ${input.review_note?.trim() || null},
          reviewed_at = now(),
          updated_at = now()
      where resident_link_id = ${linkId}::uuid and version = ${expectedVersion}
      returning *, ${current.pipeline_client_id}::text as external_client_id
    `;
    if (!rows[0]) {
      const latest = await getResidentLinkInTransaction(tx, linkId);
      return latest ? { ok: false, conflict: true, link: latest } : null;
    }
    await tx`
      insert into pipeline.audit_events (
        entity_type, entity_id, action, actor_id, actor_name,
        from_version, to_version, changed_fields, before_values, after_values
      ) values (
        'resident_link', ${linkId}, ${nextStatus === "confirmed" ? "resident_link_confirmed" : "resident_link_rejected"},
        ${actor.id}, ${actor.name}, ${current.version}, ${current.version + 1}, array['status'],
        ${tx.json({ status: current.status })}, ${tx.json({ status: nextStatus })}
      )
    `;
    const next = mapResidentLinkRow(rows[0]);
    return { ok: true, link: next, revision: next.version };
  });
}

async function getResidentLinkInTransaction(tx: TransactionSql, linkId: string) {
  const rows = await tx<ResidentLinkRow[]>`
    select rl.*, p.external_client_id
    from pipeline.resident_links rl
    join pipeline.people p on p.person_id = rl.person_id
    where rl.resident_link_id = ${linkId}::uuid
    limit 1
  `;
  return rows[0] ? mapResidentLinkRow(rows[0]) : null;
}

function mapResidentLinkRow(row: ResidentLinkRow): PipelineResidentLink {
  return {
    link_id: row.resident_link_id,
    person_id: row.person_id,
    pipeline_client_id: row.external_client_id,
    referral_id: row.referral_id === null ? null : Number(row.referral_id),
    resident_key: row.resident_key,
    resident_number: row.resident_number,
    community_id: row.community_id,
    status: row.status,
    match_method: row.match_method,
    match_confidence: row.match_confidence === null ? null : Number(row.match_confidence),
    version: Number(row.version),
    created_by: { id: row.created_by, name: row.created_by_name },
    reviewed_by: row.reviewed_by
      ? { id: row.reviewed_by, name: row.reviewed_by_name || row.reviewed_by }
      : null,
    review_note: row.review_note,
    created_at: isoTimestamp(row.created_at),
    reviewed_at: row.reviewed_at ? isoTimestamp(row.reviewed_at) : null,
    updated_at: isoTimestamp(row.updated_at),
    audit_events: [],
  };
}

function matchesOptions(link: PipelineResidentLink, options: ResidentLinkListOptions) {
  return (!options.residentKey || link.resident_key === options.residentKey) &&
    (!options.residentNumber || link.resident_number === options.residentNumber) &&
    (!options.pipelineClientId || link.pipeline_client_id === options.pipelineClientId) &&
    (!options.referralId || link.referral_id === options.referralId) &&
    (!options.status || link.status === options.status);
}

function createAuditEvent(
  linkId: string,
  action: ResidentLinkAuditEvent["action"],
  actor: ResidentLinkActor,
  fromStatus: ResidentLinkStatus | null,
  toStatus: ResidentLinkStatus,
  createdAt: string,
): ResidentLinkAuditEvent {
  return {
    event_id: randomUUID(),
    link_id: linkId,
    action,
    actor_id: actor.id,
    actor_name: actor.name,
    from_status: fromStatus,
    to_status: toStatus,
    created_at: createdAt,
  };
}

function compareLinks(left: PipelineResidentLink, right: PipelineResidentLink) {
  return right.updated_at.localeCompare(left.updated_at) || right.link_id.localeCompare(left.link_id);
}

function localStorePath() {
  return process.env.PIPELINE_RESIDENT_LINK_STORE_PATH?.trim() || ".data/resident-links.json";
}

function clampLimit(limit: number | undefined) {
  return Number.isFinite(limit) ? Math.min(maxPageSize, Math.max(1, Math.floor(limit!))) : 100;
}

function isoTimestamp(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function isResidentLinkRecord(value: unknown): value is PipelineResidentLink {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PipelineResidentLink>;
  return typeof row.link_id === "string" &&
    typeof row.person_id === "string" &&
    typeof row.pipeline_client_id === "string" &&
    typeof row.resident_key === "string" &&
    (row.status === "candidate" || row.status === "confirmed" || row.status === "rejected") &&
    Number.isInteger(row.version);
}

function isMissingFile(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0" };
}
