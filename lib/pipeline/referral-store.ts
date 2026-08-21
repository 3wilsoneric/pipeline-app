import "server-only";

import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { JSONValue, TransactionSql } from "postgres";

import { listAssessments } from "@/lib/assessment/assessment-store";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import { decodeKeysetCursor, encodeKeysetCursor, isAfterDescendingCursor } from "@/lib/pipeline/keyset-cursor";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import { isUnassignedOwner, normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import type {
  AdmissionDecision,
  AdmissionRequirement,
  Priority,
  Referral,
  ReferralFile,
  ReferralSection,
  ReferralSectionVersions,
} from "@/lib/pipeline/referral-types";
import {
  defaultReferralSectionVersions,
  getReferralPatchSections,
  incrementReferralSections,
  normalizeReferralSectionVersions,
} from "@/lib/pipeline/referral-sections";
import {
  getReferralTransitionBlockers,
  isReferralStage,
  type ReferralStage,
} from "@/lib/pipeline/referral-workflow";

type ReferralStoreState = {
  initialized: boolean;
  loadPromise?: Promise<void>;
  revision: number;
  nextId: number;
  referrals: Referral[];
  createMutations: Map<string, number>;
  persistQueue: Promise<void>;
};

type ReferralStoreFile = {
  version: 1;
  revision: number;
  next_id: number;
  referrals: Referral[];
  create_mutations?: Record<string, number>;
};

export type ReferralCreateInput = Omit<Referral, "id" | "version" | "sectionVersions" | "updatedBy">;
export type ReferralPatch = Partial<Omit<Referral, "id" | "version" | "clientId" | "sectionVersions" | "updatedBy">>;
export type ReferralQueueView = "my_work" | "unassigned" | "packet_review" | "assessment" | "decision";

export type ReferralListOptions = {
  query?: string;
  limit?: number;
  cursor?: string;
  stage?: ReferralStage;
  community?: string;
  owner?: string;
  priority?: Priority;
  tag?: string;
  month?: string;
  activeOnly?: boolean;
  queue?: ReferralQueueView;
  /** Internal access-control filter. Never populated from query parameters. */
  assignedOwnerId?: string;
  /** Legacy fallback while older rows are backfilled with stable owner ids. */
  assignedOwnerNames?: string[];
};

export type ReferralFacetValue = {
  value: string;
  count: number;
};

export type ReferralFacets = {
  communities: ReferralFacetValue[];
  stages: ReferralFacetValue[];
  owners: ReferralFacetValue[];
  priorities: ReferralFacetValue[];
  tags: ReferralFacetValue[];
  months: ReferralFacetValue[];
};

export type ReferralListResult = {
  referrals: Referral[];
  total: number;
  revision: number;
  next_cursor?: string;
  generated_at: string;
};

export type ReferralFileListOptions = {
  query?: string;
  limit?: number;
  cursor?: string;
  clientId?: string;
  canonicalClientId?: string;
  community?: string;
  category?: string;
  identityStatus?: "linked" | "candidate" | "unmatched";
  sourceSystem?: "pipeline" | "alamo_platform" | "allo" | "import";
  uploadedAfter?: string;
  uploadedBefore?: string;
  assignedOwnerId?: string;
  assignedOwnerNames?: string[];
};

export type ReferralFileListResult = {
  files: ReferralFile[];
  total: number;
  revision: number;
  next_cursor?: string;
  generated_at: string;
};

export type ReferralConflict = {
  ok: false;
  conflict: true;
  referral: Referral;
  conflictingSections?: ReferralSection[];
};

export type ReferralTransitionBlocked = {
  ok: false;
  blocked: true;
  blockers: { code: string; label: string }[];
  referral: Referral;
};

export type ReferralMutation =
  | { ok: true; referral: Referral; revision: number }
  | ReferralConflict
  | ReferralTransitionBlocked;

export type ReferralStoreReadiness = {
  mode: "local_file" | "postgres";
  ready: boolean;
  multi_instance_safe: boolean;
  message?: string;
};

export type ReferralActor = { id: string; name: string };

export type ReferralMutationMetadata = {
  auditAction?: string;
  auditReason?: string;
};

export type ReferralChangeMetadata = {
  sequence: number;
  sectionVersions: ReferralSectionVersions;
  updatedAt: string;
  updatedBy?: ReferralActor;
};

interface ReferralStore {
  revision(): Promise<number>;
  list(options?: ReferralListOptions): Promise<ReferralListResult>;
  facets(query?: string, access?: Pick<ReferralListOptions, "assignedOwnerId" | "assignedOwnerNames">): Promise<ReferralFacets>;
  get(id: number): Promise<Referral | null>;
  getByPacketId(packetId: string): Promise<Referral | null>;
  changeMetadata(id: number): Promise<ReferralChangeMetadata | null>;
  listByClient(clientId: string): Promise<Referral[]>;
  listFiles(options?: ReferralFileListOptions): Promise<ReferralFileListResult>;
  listFilesByClient(clientId: string): Promise<ReferralFile[]>;
  create(input: ReferralCreateInput, actor: ReferralActor, mutationId?: string): Promise<{ referral: Referral; revision: number }>;
  patch(
    id: number,
    patch: ReferralPatch,
    actor: ReferralActor,
    expectedVersion?: number,
    expectedSectionVersions?: Partial<ReferralSectionVersions>,
    metadata?: ReferralMutationMetadata,
  ): Promise<ReferralMutation | null>;
}

export class DuplicateReferralPacketError extends Error {
  constructor(public readonly referralId: number) {
    super("This packet has already been uploaded.");
    this.name = "DuplicateReferralPacketError";
  }
}

const globalForReferralStore = globalThis as typeof globalThis & {
  __pipelineReferralStore?: ReferralStoreState;
};

const state =
  globalForReferralStore.__pipelineReferralStore ??
  (globalForReferralStore.__pipelineReferralStore = {
    initialized: false,
    revision: 0,
    nextId: 1,
    referrals: [],
    createMutations: new Map<string, number>(),
    persistQueue: Promise.resolve(),
  });

state.createMutations ??= new Map<string, number>();

const maxReferralRows = 100_000;
const maxPageSize = 200;

export function getReferralStoreReadiness(): ReferralStoreReadiness {
  const configured = process.env.PIPELINE_REFERRAL_STORE_MODE?.trim();
  const postgresMode = configured === "postgres" || configured === "external" ||
    (!configured && process.env.PIPELINE_DATABASE_MODE === "postgres");

  if (postgresMode) {
    const database = getPipelineDatabaseReadiness();
    return {
      mode: "postgres",
      ready: database.ready,
      multi_instance_safe: database.ready,
      message: database.message ?? "PostgreSQL referral storage is ready.",
    };
  }

  const allowLocalForTests = process.env.PIPELINE_ALLOW_LOCAL_REFERRAL_STORE === "true";

  if (process.env.NODE_ENV === "production" && !allowLocalForTests) {
    return {
      mode: "local_file",
      ready: false,
      multi_instance_safe: false,
      message: "Production requires PIPELINE_REFERRAL_STORE_MODE=postgres.",
    };
  }

  return {
    mode: "local_file",
    ready: true,
    multi_instance_safe: false,
    message: "Local file mode is suitable for one app instance and development only.",
  };
}

const localReferralStore: ReferralStore = {
  revision: getLocalReferralRevision,
  list: listLocalReferrals,
  facets: listLocalReferralFacets,
  get: getLocalReferral,
  getByPacketId: getLocalReferralByPacketId,
  changeMetadata: getLocalReferralChangeMetadata,
  listByClient: listLocalReferralsByClient,
  listFiles: listLocalReferralFiles,
  listFilesByClient: listLocalReferralFilesByClient,
  create: (input, actor, mutationId) => createLocalReferral(input, actor, mutationId),
  patch: (id, patch, actor, expectedVersion, expectedSectionVersions, metadata) =>
    patchLocalReferral(id, patch, actor, expectedVersion, expectedSectionVersions, metadata),
};

const postgresReferralStore: ReferralStore = {
  revision: getPostgresReferralRevision,
  list: listPostgresReferrals,
  facets: listPostgresReferralFacets,
  get: getPostgresReferral,
  getByPacketId: getPostgresReferralByPacketId,
  changeMetadata: getPostgresReferralChangeMetadata,
  listByClient: listPostgresReferralsByClient,
  listFiles: listPostgresReferralFiles,
  listFilesByClient: listPostgresReferralFilesByClient,
  create: createPostgresReferral,
  patch: patchPostgresReferral,
};

function getReferralStore(): ReferralStore {
  return getReferralStoreReadiness().mode === "postgres" ? postgresReferralStore : localReferralStore;
}

function systemActor(): ReferralActor {
  return { id: "pipeline-system", name: "Pipeline System" };
}

export async function listReferrals(options: ReferralListOptions = {}) {
  return getReferralStore().list(options);
}

export async function getReferralStoreRevision() {
  return getReferralStore().revision();
}

export async function listReferralFacets(
  query = "",
  access: Pick<ReferralListOptions, "assignedOwnerId" | "assignedOwnerNames"> = {},
) {
  return getReferralStore().facets(query, access);
}

export async function getReferral(id: number) {
  return getReferralStore().get(id);
}

export async function getReferralByPacketId(packetId: string) {
  const normalized = packetId.trim();
  if (!normalized || normalized.length > 256) return null;
  return getReferralStore().getByPacketId(normalized);
}

export async function getReferralChangeMetadata(id: number) {
  return getReferralStore().changeMetadata(id);
}

export async function listReferralsByClient(clientId: string) {
  return getReferralStore().listByClient(clientId);
}

export async function listReferralFiles(options: ReferralFileListOptions = {}) {
  return getReferralStore().listFiles(options);
}

export async function listReferralFilesByClient(clientId: string) {
  return getReferralStore().listFilesByClient(clientId);
}

export async function listReferralFilesByCanonicalClient(canonicalClientId: string) {
  const files: ReferralFile[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 500; page += 1) {
    const result = await getReferralStore().listFiles({
      canonicalClientId,
      limit: maxPageSize,
      cursor,
    });
    files.push(...result.files);
    cursor = result.next_cursor;
    if (!cursor) return files;
  }
  throw new Error("The canonical client document inventory exceeded its safe pagination limit.");
}

export async function createReferral(
  input: ReferralCreateInput,
  mutationId?: string,
  actor: ReferralActor = systemActor(),
) {
  return getReferralStore().create(input, actor, mutationId);
}

export async function patchReferral(
  id: number,
  patch: ReferralPatch,
  expectedVersion?: number,
  actor: ReferralActor = systemActor(),
  expectedSectionVersions?: Partial<ReferralSectionVersions>,
  metadata?: ReferralMutationMetadata,
) {
  return getReferralStore().patch(id, patch, actor, expectedVersion, expectedSectionVersions, metadata);
}

export function requireReferralStore() {
  const readiness = getReferralStoreReadiness();
  if (readiness.ready) return { ok: true as const, readiness };

  return {
    ok: false as const,
    response: Response.json(
      {
        error: readiness.message,
        readiness,
      },
      { status: 503 },
    ),
    readiness,
  };
}

function storePath() {
  return (
    process.env.PIPELINE_REFERRAL_STORE_PATH?.trim() ||
    ".data/referrals.json"
  );
}

async function ensureLoaded() {
  if (state.initialized) {
    if (state.loadPromise) await state.loadPromise;
    return;
  }

  state.initialized = true;
  state.loadPromise = (async () => {
    try {
      const raw = await readFile(/* turbopackIgnore: true */ storePath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<ReferralStoreFile>;
      const referrals = Array.isArray(parsed.referrals)
        ? parsed.referrals.filter(isReferralRecord).slice(0, maxReferralRows)
        : [];

      state.referrals = referrals.map(normalizeReferral);
      state.revision = Number.isInteger(parsed.revision) ? Number(parsed.revision) : 0;
      state.createMutations = new Map(
        Object.entries(parsed.create_mutations ?? {}).filter(
          ([key, value]) => Boolean(key) && Number.isInteger(value),
        ),
      );
      state.nextId = Math.max(
        Number.isInteger(parsed.next_id) ? Number(parsed.next_id) : 1,
        ...state.referrals.map((referral) => referral.id + 1),
      );
    } catch (error) {
      if (!isMissingFile(error)) {
        console.warn(
          JSON.stringify({
            service: "pipeline-app",
            event: "referral_store_load_failed",
            path: storePath(),
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  })();

  await state.loadPromise;
  state.loadPromise = undefined;
}

async function persist() {
  const snapshot: ReferralStoreFile = {
    version: 1,
    revision: state.revision,
    next_id: state.nextId,
    referrals: state.referrals,
    create_mutations: Object.fromEntries(state.createMutations),
  };
  const path = storePath();
  const temporaryPath = `${path}.${process.pid}.tmp`;

  state.persistQueue = state.persistQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(/* turbopackIgnore: true */ dirname(path), { recursive: true });
      await writeFile(
        /* turbopackIgnore: true */ temporaryPath,
        JSON.stringify(snapshot),
        { encoding: "utf8", mode: 0o600 },
      );
      await chmod(/* turbopackIgnore: true */ temporaryPath, 0o600);
      await rename(/* turbopackIgnore: true */ temporaryPath, path);
      await chmod(/* turbopackIgnore: true */ path, 0o600);
    });

  await state.persistQueue;
}

async function listLocalReferrals(
  options: ReferralListOptions = {},
): Promise<ReferralListResult> {
  await ensureLoaded();

  const queryTokens = normalizedSearchTokens(options.query ?? "");
  const matching = state.referrals
    .filter((referral) => matchesSearchTokens(searchableReferralText(referral), queryTokens) && matchesReferralFilters(referral, options))
    .sort(compareReferrals);
  const cursor = decodeKeysetCursor(options.cursor);
  const limit = clampPageSize(options.limit);
  const page = matching
    .filter((referral) => isAfterDescendingCursor(
      referral.updatedAt ?? referral.createdAt,
      paddedNumericKey(referral.id),
      cursor,
    ))
    .slice(0, limit + 1);
  const referrals = page.slice(0, limit);

  return {
    referrals,
    total: matching.length,
    revision: state.revision,
    next_cursor:
      page.length > limit && referrals.at(-1)
        ? encodeKeysetCursor({
            timestamp: referrals.at(-1)!.updatedAt ?? referrals.at(-1)!.createdAt,
            key: paddedNumericKey(referrals.at(-1)!.id),
          })
        : undefined,
    generated_at: new Date().toISOString(),
  };
}

async function getLocalReferralRevision() {
  await ensureLoaded();
  return state.revision;
}

async function listLocalReferralFacets(
  query = "",
  access: Pick<ReferralListOptions, "assignedOwnerId" | "assignedOwnerNames"> = {},
): Promise<ReferralFacets> {
  await ensureLoaded();
  const queryTokens = normalizedSearchTokens(query);
  const referrals = state.referrals.filter(
    (referral) => matchesSearchTokens(searchableReferralText(referral), queryTokens)
      && matchesAssignmentScope(referral, access),
  );
  return buildReferralFacets(referrals);
}

async function getLocalReferral(id: number): Promise<Referral | null> {
  await ensureLoaded();
  return state.referrals.find((referral) => referral.id === id) ?? null;
}

async function getLocalReferralByPacketId(packetId: string): Promise<Referral | null> {
  await ensureLoaded();
  return state.referrals.find((referral) => referral.packetId === packetId) ?? null;
}

async function getLocalReferralChangeMetadata(id: number): Promise<ReferralChangeMetadata | null> {
  const referral = await getLocalReferral(id);
  if (!referral) return null;
  return {
    sequence: referral.version ?? 1,
    sectionVersions: normalizeReferralSectionVersions(referral.sectionVersions),
    updatedAt: referral.updatedAt ?? referral.createdAt,
    updatedBy: referral.updatedBy,
  };
}

/**
 * Read all referral episodes for one client from the store boundary. The local
 * implementation scans memory; an external adapter can replace this with an
 * indexed query without changing callers.
 */
async function listLocalReferralsByClient(clientId: string): Promise<Referral[]> {
  await ensureLoaded();
  return state.referrals
    .filter((referral) => referral.clientId === clientId)
    .sort(compareReferrals);
}

async function listLocalReferralFilesByClient(clientId: string): Promise<ReferralFile[]> {
  await ensureLoaded();
  return state.referrals
    .filter((referral) => referral.clientId === clientId)
    .flatMap(getReferralFiles)
    .sort(compareFiles);
}

async function listLocalReferralFiles(
  options: ReferralFileListOptions = {},
): Promise<ReferralFileListResult> {
  await ensureLoaded();

  const queryTokens = normalizedSearchTokens(options.query ?? "");
  const matching = state.referrals
    .filter((referral) => !options.clientId || referral.clientId === options.clientId)
    .filter((referral) => matchesAssignmentScope(referral, options))
    .flatMap(getReferralFiles)
    .filter((file) => matchesSearchTokens(searchableFileText(file), queryTokens))
    .filter((file) => !options.canonicalClientId || file.canonicalClientId === options.canonicalClientId)
    .filter((file) => !options.community || file.community === options.community)
    .filter((file) => !options.category || file.category === options.category)
    .filter((file) => !options.identityStatus || (file.identityStatus ?? "linked") === options.identityStatus)
    .filter((file) => !options.sourceSystem || (file.sourceSystem ?? "pipeline") === options.sourceSystem)
    .filter((file) => !options.uploadedAfter || file.uploadedAt.slice(0, 10) >= options.uploadedAfter)
    .filter((file) => !options.uploadedBefore || file.uploadedAt.slice(0, 10) <= options.uploadedBefore)
    .sort(compareFiles);
  const cursor = decodeKeysetCursor(options.cursor);
  const limit = clampPageSize(options.limit);
  const page = matching
    .filter((file) => isAfterDescendingCursor(file.uploadedAt, file.id, cursor))
    .slice(0, limit + 1);
  const files = page.slice(0, limit);

  return {
    files,
    total: matching.length,
    revision: state.revision,
    next_cursor:
      page.length > limit && files.at(-1)
        ? encodeKeysetCursor({ timestamp: files.at(-1)!.uploadedAt, key: files.at(-1)!.id })
        : undefined,
    generated_at: new Date().toISOString(),
  };
}

async function createLocalReferral(
  input: ReferralCreateInput,
  actor: ReferralActor,
  mutationId?: string,
): Promise<{ referral: Referral; revision: number }> {
  await ensureLoaded();

  const existingId = mutationId ? state.createMutations.get(mutationId) : undefined;
  const existingReferral = existingId
    ? state.referrals.find((referral) => referral.id === existingId)
    : undefined;

  if (existingReferral) {
    return { referral: existingReferral, revision: state.revision };
  }

  assertPacketIsUnique(input.documentHash);

  if (state.referrals.length >= maxReferralRows) {
    throw new Error("Referral capacity reached. Archive closed referrals before creating more.");
  }

  const referral = normalizeReferral({
    ...input,
    id: state.nextId,
    version: 1,
    sectionVersions: defaultReferralSectionVersions(),
    updatedBy: actor,
  });

  state.nextId += 1;
  state.revision += 1;
  state.referrals = [referral, ...state.referrals];
  if (mutationId) state.createMutations.set(mutationId, referral.id);
  await persist();

  return { referral, revision: state.revision };
}

async function patchLocalReferral(
  id: number,
  patch: ReferralPatch,
  actor: ReferralActor,
  expectedVersion?: number,
  expectedSectionVersions?: Partial<ReferralSectionVersions>,
  _metadata?: ReferralMutationMetadata,
): Promise<ReferralMutation | null> {
  void _metadata;
  await ensureLoaded();

  const index = state.referrals.findIndex((referral) => referral.id === id);
  if (index < 0) return null;

  const current = state.referrals[index];
  const safePatch = sanitizePatch(patch);
  const touchedSections = getReferralPatchSections(safePatch);
  const sectionConflict = getSectionConflicts(
    normalizeReferralSectionVersions(current.sectionVersions),
    touchedSections,
    expectedSectionVersions,
  );
  if (sectionConflict.length > 0) {
    return { ok: false, conflict: true, referral: current, conflictingSections: sectionConflict };
  }
  if (!expectedSectionVersions && expectedVersion !== undefined && expectedVersion !== current.version) {
    return { ok: false, conflict: true, referral: current };
  }

  if (patch.stage && patch.stage !== current.stage) {
    if (!isReferralStage(patch.stage)) {
      return {
        ok: false,
        blocked: true,
        blockers: [{ code: "stage_invalid", label: "Choose a valid workflow stage." }],
        referral: current,
      };
    }
    const assessments = await listAssessments({ referralId: current.id, limit: 100 });
    const blockers = getReferralTransitionBlockers(current, patch.stage as ReferralStage, {
      assessmentComplete: assessments.assessments.some((assessment) => assessment.status === "complete"),
      decision: current.admissionDecision ?? null,
      requirements: current.requirements ?? [],
    });
    if (blockers.length > 0) {
      return { ok: false, blocked: true, blockers, referral: current };
    }
  }

  assertPacketIsUnique(patch.documentHash, current.id);

  const next = normalizeReferral({
    ...current,
    ...safePatch,
    id: current.id,
    version: (current.version ?? 1) + 1,
    sectionVersions: incrementReferralSections(
      normalizeReferralSectionVersions(current.sectionVersions),
      touchedSections,
    ),
    updatedBy: actor,
    updatedAt: new Date().toISOString(),
  });

  state.referrals[index] = next;
  state.revision += 1;
  await persist();

  return { ok: true, referral: next, revision: state.revision };
}

type ReferralRow = {
  referral_id: number | string;
  external_client_id: string;
  display_name: string;
  version: number;
  stage: Referral["stage"];
  community: Referral["community"];
  owner_name: string | null;
  owner_id: string | null;
  priority: Referral["priority"];
  source: string;
  received_date: Date | string | null;
  tags: string[];
  summary: string | null;
  document_sha256: string | null;
  data: unknown;
  section_versions: unknown;
  updated_by: string;
  updated_by_name: string;
  created_at: Date | string;
  updated_at: Date | string;
  total_count?: number | string;
  cursor_time?: string;
};

type ReferralFileRow = {
  id: string;
  name: string;
  category: ReferralFile["category"];
  referral_id: number | string | null;
  referral_name: string;
  community: Referral["community"] | null;
  uploaded_at: Date | string;
  size_bytes: number | string | null;
  status: ReferralFile["status"];
  content_type: string | null;
  preview_status: ReferralFile["previewStatus"];
  page_count: number | string | null;
  external_client_id: string | null;
  canonical_client_id: string | null;
  source_system: ReferralFile["sourceSystem"] | null;
  identity_status: ReferralFile["identityStatus"] | null;
  total_count?: number | string;
  cursor_time?: string;
};

async function listPostgresReferrals(options: ReferralListOptions = {}): Promise<ReferralListResult> {
  const sql = getPipelineSql();
  const queryTokens = normalizedSearchTokens(options.query ?? "");
  const stage = options.stage ?? null;
  const community = options.community?.trim() || null;
  const owner = options.owner ? normalizeOwnerName(options.owner) : null;
  const assignedOwnerId = options.assignedOwnerId?.trim() || null;
  const assignedOwnerNames = options.assignedOwnerNames ?? [];
  const priority = options.priority ?? null;
  const tag = options.tag?.trim() || null;
  const month = options.month?.trim() || null;
  const activeOnly = options.activeOnly === true;
  const queue = options.queue ?? null;
  const cursor = decodeKeysetCursor(options.cursor);
  const cursorId = cursor ? Number.parseInt(cursor.key, 10) : null;
  if (cursor && (!Number.isSafeInteger(cursorId) || cursorId! <= 0)) throw new Error("Invalid referral cursor.");
  const limit = clampPageSize(options.limit);
  const rows = await sql<ReferralRow[]>`
    with filtered as (
      select r.*, p.external_client_id, p.display_name,
        to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_time
      from pipeline.referrals r
      join pipeline.people p on p.person_id = r.person_id
      where (${queryTokens.length === 0} or not exists (
          select 1 from unnest(${queryTokens}::text[]) as search_term(value)
          where r.search_text not ilike ('%' || search_term.value || '%')
        ))
        and (${stage}::text is null or r.stage = ${stage})
        and (${community}::text is null or r.community = ${community})
        and (${owner}::text is null or case
          when lower(coalesce(nullif(trim(r.owner_name), ''), 'unassigned')) in ('unassigned', 'unknown', 'pending')
            then 'Unassigned'
          else trim(r.owner_name)
        end = ${owner})
        and (${assignedOwnerId}::text is null or r.owner_id = ${assignedOwnerId}
          or (r.owner_id is null and lower(trim(coalesce(r.owner_name, ''))) = any(${assignedOwnerNames}::text[])))
        and (${priority}::text is null or r.priority = ${priority})
        and (${tag}::text is null or ${tag} = any(r.tags))
        and (${month}::text is null or to_char(r.created_at at time zone 'UTC', 'YYYY-MM') = ${month})
        and (${activeOnly} = false or r.closed_at is null)
        and (
          ${queue}::text is null
          or (${queue} = 'unassigned' and lower(coalesce(nullif(trim(r.owner_name), ''), 'unassigned')) in ('unassigned', 'unknown', 'pending'))
          or (${queue} = 'packet_review' and coalesce(r.data->>'packetStatus', '') in ('ready_for_review', 'failed'))
          or (${queue} = 'assessment' and r.stage = 'Assessment')
          or (${queue} = 'decision' and r.stage = 'Community Review')
        )
    )
    select filtered.*, (select count(*) from filtered) as total_count
    from filtered
    where (${cursor?.timestamp ?? null}::timestamptz is null or
      (updated_at, referral_id) < (${cursor?.timestamp ?? null}::timestamptz, ${cursorId}::bigint))
    order by updated_at desc, referral_id desc
    limit ${limit + 1}
  `;
  const revision = await getPostgresReferralRevision();
  const total = Number(rows[0]?.total_count ?? 0);
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    referrals: pageRows.map(mapReferralRow),
    total,
    revision,
    next_cursor: rows.length > limit && last
      ? encodeKeysetCursor({ timestamp: last.cursor_time ?? isoTimestamp(last.updated_at), key: String(last.referral_id) })
      : undefined,
    generated_at: new Date().toISOString(),
  };
}

type FacetRow = { value: string; count: number | string };

async function listPostgresReferralFacets(
  query = "",
  access: Pick<ReferralListOptions, "assignedOwnerId" | "assignedOwnerNames"> = {},
): Promise<ReferralFacets> {
  const sql = getPipelineSql();
  const queryTokens = normalizedSearchTokens(query);
  const assignedOwnerId = access.assignedOwnerId?.trim() || null;
  const assignedOwnerNames = access.assignedOwnerNames ?? [];
  const searchClause = sql`(${queryTokens.length === 0} or not exists (
    select 1 from unnest(${queryTokens}::text[]) as search_term(value)
    where r.search_text not ilike ('%' || search_term.value || '%')
  )) and (${assignedOwnerId}::text is null or r.owner_id = ${assignedOwnerId}
    or (r.owner_id is null and lower(trim(coalesce(r.owner_name, ''))) = any(${assignedOwnerNames}::text[])))`;
  const [communities, stages, owners, priorities, tags, months] = await Promise.all([
    sql<FacetRow[]>`
      select r.community as value, count(*) as count
      from pipeline.referrals r where ${searchClause}
      group by r.community order by r.community
    `,
    sql<FacetRow[]>`
      select r.stage as value, count(*) as count
      from pipeline.referrals r where ${searchClause}
      group by r.stage order by r.stage
    `,
    sql<FacetRow[]>`
      select case
        when lower(coalesce(nullif(trim(r.owner_name), ''), 'unassigned')) in ('unassigned', 'unknown', 'pending')
          then 'Unassigned'
        else trim(r.owner_name)
      end as value, count(*) as count
      from pipeline.referrals r where ${searchClause}
      group by value order by value
    `,
    sql<FacetRow[]>`
      select r.priority as value, count(*) as count
      from pipeline.referrals r where ${searchClause}
      group by r.priority order by r.priority
    `,
    sql<FacetRow[]>`
      select tag as value, count(*) as count
      from pipeline.referrals r cross join lateral unnest(r.tags) tag
      where ${searchClause}
      group by tag order by tag
    `,
    sql<FacetRow[]>`
      select to_char(r.created_at at time zone 'UTC', 'YYYY-MM') as value, count(*) as count
      from pipeline.referrals r where ${searchClause}
      group by value order by value desc
    `,
  ]);

  return {
    communities: mapFacetRows(communities),
    stages: mapFacetRows(stages),
    owners: mapFacetRows(owners),
    priorities: mapFacetRows(priorities),
    tags: mapFacetRows(tags),
    months: mapFacetRows(months),
  };
}

async function getPostgresReferral(id: number) {
  const sql = getPipelineSql();
  const rows = await sql<ReferralRow[]>`
    select r.*, p.external_client_id, p.display_name
    from pipeline.referrals r
    join pipeline.people p on p.person_id = r.person_id
    where r.referral_id = ${id}
    limit 1
  `;
  return rows[0] ? mapReferralRow(rows[0]) : null;
}

async function getPostgresReferralByPacketId(packetId: string) {
  const sql = getPipelineSql();
  const rows = await sql<ReferralRow[]>`
    select r.*, p.external_client_id, p.display_name
    from pipeline.referrals r
    join pipeline.people p on p.person_id = r.person_id
    where r.data->>'packetId' = ${packetId}
      or exists (
        select 1 from pipeline.packet_uploads pu
        where pu.referral_id = r.referral_id and pu.packet_id::text = ${packetId}
      )
    order by r.updated_at desc, r.referral_id desc
    limit 1
  `;
  return rows[0] ? mapReferralRow(rows[0]) : null;
}

async function getPostgresReferralChangeMetadata(id: number): Promise<ReferralChangeMetadata | null> {
  const sql = getPipelineSql();
  const rows = await sql<{
    version: number | string;
    section_versions: unknown;
    updated_at: Date | string;
    updated_by: string;
    updated_by_name: string;
  }[]>`
    select version, section_versions, updated_at, updated_by, updated_by_name
    from pipeline.referrals
    where referral_id = ${id}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    sequence: Number(row.version),
    sectionVersions: normalizeReferralSectionVersions(row.section_versions),
    updatedAt: isoTimestamp(row.updated_at),
    updatedBy: { id: row.updated_by, name: row.updated_by_name },
  };
}

async function listPostgresReferralsByClient(clientId: string) {
  const sql = getPipelineSql();
  const rows = await sql<ReferralRow[]>`
    select r.*, p.external_client_id, p.display_name
    from pipeline.referrals r
    join pipeline.people p on p.person_id = r.person_id
    where p.external_client_id = ${clientId}
    order by r.updated_at desc, r.referral_id desc
    limit ${maxReferralRows}
  `;
  return rows.map(mapReferralRow);
}

async function listPostgresReferralFiles(options: ReferralFileListOptions = {}): Promise<ReferralFileListResult> {
  const sql = getPipelineSql();
  const queryTokens = normalizedSearchTokens(options.query ?? "");
  const clientId = options.clientId?.trim() || null;
  const canonicalClientId = options.canonicalClientId?.trim() || null;
  const community = options.community?.trim() || null;
  const category = options.category?.trim() || null;
  const identityStatus = options.identityStatus ?? null;
  const sourceSystem = options.sourceSystem ?? null;
  const uploadedAfter = options.uploadedAfter?.trim() || null;
  const uploadedBefore = options.uploadedBefore?.trim() || null;
  const assignedOwnerId = options.assignedOwnerId?.trim() || null;
  const assignedOwnerNames = options.assignedOwnerNames ?? [];
  const cursor = decodeKeysetCursor(options.cursor);
  const limit = clampPageSize(options.limit);
  const rows = await sql<ReferralFileRow[]>`
    with file_rows as (
      select
        d.document_id::text as id,
        d.file_name as name,
        case d.category
          when 'face_sheet' then 'Face sheet'
          when 'assessment' then 'Assessment'
          when 'assessment_workbook' then 'Assessment'
          when 'medication_list' then 'Medication list'
          when 'tb_test' then 'TB test'
          when 'signed_admission_agreement' then 'Admission agreement'
          when 'conservatorship_document' then 'Conservatorship'
          when 'lic_602' then 'LIC 602'
          when 'lic_601_603' then 'LIC 601/603'
          when 'provider_form' then 'Provider form'
          when 'payer_verification' then 'Payer verification'
          when 'responsible_party' then 'Responsible party'
          when 'other' then 'Other'
          else 'Referral packet'
        end::text as category,
        coalesce(r.referral_id, latest_referral.referral_id) as referral_id,
        p.external_client_id,
        d.canonical_client_id,
        coalesce(p.display_name, d.client_display_name, 'Identity review needed') as referral_name,
        coalesce(r.community, latest_referral.community, d.client_community) as community,
        coalesce(r.owner_id, latest_referral.owner_id) as owner_id,
        coalesce(r.owner_name, latest_referral.owner_name) as owner_name,
        d.uploaded_at,
        d.byte_size as size_bytes,
        case when d.processing_status = 'reviewed' then 'Reviewed' else 'Uploaded' end::text as status,
        d.content_type,
        d.preview_status,
        d.page_count,
        d.source_system,
        d.identity_status
      from pipeline.documents d
      left join pipeline.referrals r on r.referral_id = d.referral_id
      left join pipeline.people p on p.person_id = coalesce(d.person_id, r.person_id)
      left join lateral (
        select lr.referral_id, lr.community, lr.owner_id, lr.owner_name
        from pipeline.referrals lr
        where p.person_id is not null and lr.person_id = p.person_id
        order by lr.updated_at desc, lr.referral_id desc
        limit 1
      ) latest_referral on true
      where d.deleted_at is null
      union all
      select
        ('referral-' || r.referral_id || '-packet')::text as id,
        r.data->>'documentName' as name,
        'Referral packet'::text as category,
        r.referral_id,
        p.external_client_id,
        null::text as canonical_client_id,
        p.display_name as referral_name,
        r.community,
        r.owner_id,
        r.owner_name,
        r.updated_at as uploaded_at,
        case when coalesce(r.data->>'documentSizeBytes', '') ~ '^\\d+$'
          then (r.data->>'documentSizeBytes')::bigint else null end as size_bytes,
        case when r.data->>'documentStatus' = 'Reviewed' then 'Reviewed' else 'Uploaded' end::text as status,
        null::text as content_type,
        'unavailable'::text as preview_status,
        null::integer as page_count,
        'pipeline'::text as source_system,
        'linked'::text as identity_status
      from pipeline.referrals r
      join pipeline.people p on p.person_id = r.person_id
      where coalesce(r.data->>'documentName', '') <> ''
        and coalesce(r.data->>'documentStatus', 'Missing') <> 'Missing'
        and not exists (
          select 1 from pipeline.documents d
          where d.referral_id = r.referral_id and d.deleted_at is null
            and d.category not in ('assessment', 'assessment_workbook')
        )
      union all
      select
        ('referral-' || r.referral_id || '-assessment')::text,
        r.data->>'assessmentDocumentName',
        'Assessment'::text,
        r.referral_id,
        p.external_client_id,
        null::text,
        p.display_name,
        r.community,
        r.owner_id,
        r.owner_name,
        r.updated_at,
        case when coalesce(r.data->>'assessmentDocumentSizeBytes', '') ~ '^\\d+$'
          then (r.data->>'assessmentDocumentSizeBytes')::bigint else null end,
        'Uploaded'::text,
        null::text,
        'unavailable'::text,
        null::integer,
        'pipeline'::text,
        'linked'::text
      from pipeline.referrals r
      join pipeline.people p on p.person_id = r.person_id
      where coalesce(r.data->>'assessmentDocumentName', '') <> ''
        and not exists (
          select 1 from pipeline.documents d
          where d.referral_id = r.referral_id and d.deleted_at is null
            and d.category in ('assessment', 'assessment_workbook')
        )
    )
    , filtered_rows as (
      select file_rows.*,
        to_char(uploaded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_time
      from file_rows
      where (${queryTokens.length === 0} or not exists (
          select 1 from unnest(${queryTokens}::text[]) as search_term(value)
          where lower(concat_ws(' ', name, category, referral_name, community, status)) not ilike ('%' || search_term.value || '%')
        ))
        and (${clientId}::text is null or external_client_id = ${clientId})
        and (${canonicalClientId}::text is null or canonical_client_id = ${canonicalClientId})
        and (${community}::text is null or file_rows.community = ${community})
        and (${category}::text is null or file_rows.category = ${category})
        and (${identityStatus}::text is null or file_rows.identity_status = ${identityStatus})
        and (${sourceSystem}::text is null or file_rows.source_system = ${sourceSystem})
        and (${uploadedAfter}::date is null or uploaded_at >= ${uploadedAfter}::date)
        and (${uploadedBefore}::date is null or uploaded_at < (${uploadedBefore}::date + interval '1 day'))
        and (${assignedOwnerId}::text is null or owner_id = ${assignedOwnerId}
          or (owner_id is null and lower(trim(coalesce(owner_name, ''))) = any(${assignedOwnerNames}::text[])))
    )
    select filtered_rows.*, (select count(*) from filtered_rows) as total_count
    from filtered_rows
    where (${cursor?.timestamp ?? null}::timestamptz is null or
      (uploaded_at, id) < (${cursor?.timestamp ?? null}::timestamptz, ${cursor?.key ?? null}::text))
    order by uploaded_at desc, id desc
    limit ${limit + 1}
  `;
  const revision = await getPostgresReferralRevision();
  const total = Number(rows[0]?.total_count ?? 0);
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    files: pageRows.map(mapReferralFileRow),
    total,
    revision,
    next_cursor: rows.length > limit && last
      ? encodeKeysetCursor({ timestamp: last.cursor_time ?? isoTimestamp(last.uploaded_at), key: last.id })
      : undefined,
    generated_at: new Date().toISOString(),
  };
}

async function listPostgresReferralFilesByClient(clientId: string) {
  const files: ReferralFile[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 500; page += 1) {
    const result = await listPostgresReferralFiles({ clientId, limit: maxPageSize, cursor });
    files.push(...result.files);
    cursor = result.next_cursor;
    if (!cursor) return files;
  }
  throw new Error("The client document inventory exceeded its safe pagination limit.");
}

async function createPostgresReferral(
  input: ReferralCreateInput,
  actor: ReferralActor,
  mutationId?: string,
): Promise<{ referral: Referral; revision: number }> {
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    if (mutationId) {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`referral_create:${mutationId}`}, 0))`;
      const idempotent = await tx<{ entity_id: string }[]>`
        select entity_id from pipeline.idempotency_keys
        where scope = 'referral_create' and mutation_id = ${mutationId}
        limit 1
      `;
      if (idempotent[0]) {
        const existing = await getReferralInTransaction(tx, Number(idempotent[0].entity_id));
        if (existing) return { referral: existing, revision: await getReferralRevisionInTransaction(tx) };
      }
    }

    if (input.documentHash) {
      await tx`select pg_advisory_xact_lock(hashtextextended(${'packet:' + input.documentHash}, 0))`;
      const duplicate = await tx<{ referral_id: number | string }[]>`
        select referral_id from pipeline.referrals
        where document_sha256 = ${input.documentHash}
        limit 1
      `;
      if (duplicate[0]) throw new DuplicateReferralPacketError(Number(duplicate[0].referral_id));
    }

    const clientId = normalizeClientId(input.clientId) || `pipeline-client-${randomUUID()}`;
    const people = await tx<{ person_id: string }[]>`
      insert into pipeline.people (external_client_id, display_name, date_of_birth)
      values (${clientId}, ${input.name}, ${dateToSql(input.dob)}::date)
      on conflict (external_client_id) do update
        set display_name = excluded.display_name,
            date_of_birth = coalesce(pipeline.people.date_of_birth, excluded.date_of_birth),
            updated_at = now()
      returning person_id
    `;
    const payload = { ...input, clientId };
    const rows = await tx<ReferralRow[]>`
      insert into pipeline.referrals (
        person_id, stage, community, owner_id, owner_name, priority, source, received_date,
        tags, summary, document_sha256, search_text, data,
        closed_at, created_by, created_by_name, updated_by, updated_by_name
      ) values (
        ${people[0].person_id}::uuid, ${input.stage}, ${input.community}, ${input.ownerId || null}, ${input.owner || null},
        ${input.priority}, ${input.source}, ${dateToSql(input.date)}::date, ${input.tags ?? []},
        ${input.note || null}, ${input.documentHash ?? null}, ${referralSearchText(payload)}, ${tx.json(payload)},
        ${isClosedStage(input.stage) ? new Date() : null}, ${actor.id}, ${actor.name}, ${actor.id}, ${actor.name}
      )
      returning *, ${clientId}::text as external_client_id, ${input.name}::text as display_name
    `;
    const referral = mapReferralRow(rows[0]);
    if (referral.requirements?.length) {
      await syncPostgresWorkItems(tx, referral.id, people[0].person_id, referral.requirements);
    }
    await writeReferralAudit(tx, referral.id, "referral_created", actor, [], null, referral.stage, 1);
    if (mutationId) {
      await tx`
        insert into pipeline.idempotency_keys (scope, mutation_id, entity_type, entity_id)
        values ('referral_create', ${mutationId}, 'referral', ${String(referral.id)})
        on conflict (scope, mutation_id) do nothing
      `;
    }
    const revision = await bumpReferralRevision(tx);
    return { referral, revision };
  });
}

async function patchPostgresReferral(
  id: number,
  patch: ReferralPatch,
  actor: ReferralActor,
  expectedVersion?: number,
  expectedSectionVersions?: Partial<ReferralSectionVersions>,
  metadata?: ReferralMutationMetadata,
): Promise<ReferralMutation | null> {
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    const current = await getReferralInTransaction(tx, id, true);
    if (!current) return null;
    const currentVersion = current.version ?? 1;
    const clientId = current.clientId ?? buildLocalClientId(current.id);
    const safePatch = sanitizePatch(patch);
    const touchedSections = getReferralPatchSections(safePatch);
    const currentSectionVersions = normalizeReferralSectionVersions(current.sectionVersions);
    const sectionConflict = getSectionConflicts(
      currentSectionVersions,
      touchedSections,
      expectedSectionVersions,
    );
    if (sectionConflict.length > 0) {
      return { ok: false, conflict: true, referral: current, conflictingSections: sectionConflict };
    }
    if (!expectedSectionVersions && expectedVersion !== undefined && expectedVersion !== currentVersion) {
      return { ok: false, conflict: true, referral: current };
    }
    if (patch.stage && patch.stage !== current.stage) {
      if (!isReferralStage(patch.stage)) {
        return { ok: false, blocked: true, blockers: [{ code: "stage_invalid", label: "Choose a valid workflow stage." }], referral: current };
      }
      const workflow = await getPostgresWorkflowContext(tx, id, current);
      const blockers = getReferralTransitionBlockers(current, patch.stage as ReferralStage, workflow);
      if (blockers.length > 0) return { ok: false, blocked: true, blockers, referral: current };
    }
    if (patch.documentHash && patch.documentHash !== current.documentHash) {
      await tx`select pg_advisory_xact_lock(hashtextextended(${'packet:' + patch.documentHash}, 0))`;
      const duplicate = await tx<{ referral_id: number | string }[]>`
        select referral_id from pipeline.referrals
        where document_sha256 = ${patch.documentHash} and referral_id <> ${id}
        limit 1
      `;
      if (duplicate[0]) throw new DuplicateReferralPacketError(Number(duplicate[0].referral_id));
    }

    const changedFields = Object.keys(safePatch);
    const nextSectionVersions = incrementReferralSections(currentSectionVersions, touchedSections);
    const next = normalizeReferral({
      ...current,
      ...safePatch,
      id: current.id,
      clientId,
      version: currentVersion + 1,
      sectionVersions: nextSectionVersions,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    });
    const rows = await tx<ReferralRow[]>`
      update pipeline.referrals r
      set stage = ${next.stage},
          community = ${next.community},
          owner_id = ${next.ownerId || null},
          owner_name = ${next.owner || null},
          priority = ${next.priority},
          source = ${next.source},
          received_date = ${dateToSql(next.date)}::date,
          tags = ${next.tags ?? []},
          summary = ${next.note || null},
          document_sha256 = ${next.documentHash ?? null},
          search_text = ${referralSearchText(next)},
          data = ${tx.json(referralDataPayload(next))},
          section_versions = ${tx.json(nextSectionVersions)},
          closed_at = ${isClosedStage(next.stage) ? new Date() : null},
          version = r.version + 1,
          updated_by = ${actor.id},
          updated_by_name = ${actor.name},
          updated_at = now()
      from pipeline.people p
      where r.referral_id = ${id} and p.person_id = r.person_id and r.version = ${currentVersion}
      returning r.*, p.external_client_id, p.display_name
    `;
    if (!rows[0]) {
      const latest = await getReferralInTransaction(tx, id);
      return latest ? { ok: false, conflict: true, referral: latest } : null;
    }
    await tx`
      update pipeline.people
      set display_name = ${next.name}, date_of_birth = coalesce(${dateToSql(next.dob)}::date, date_of_birth), updated_at = now()
      where external_client_id = ${clientId}
    `;
    const referral = mapReferralRow({ ...rows[0], display_name: next.name });
    if (safePatch.requirements) {
      await syncPostgresWorkItems(tx, id, null, referral.requirements ?? []);
    }
    const auditAction = metadata?.auditAction
      ?? (safePatch.owner !== undefined && safePatch.owner !== current.owner
        ? "referral_reassigned"
        : safePatch.ehrHandoff !== undefined
          ? "ehr_handoff_updated"
          : current.stage === referral.stage
            ? "referral_updated"
            : "referral_stage_changed");
    await writeReferralAudit(
      tx,
      id,
      auditAction,
      actor,
      changedFields,
      current.stage,
      referral.stage,
      referral.version ?? currentVersion + 1,
      metadata?.auditReason,
    );
    const revision = await bumpReferralRevision(tx);
    return { ok: true, referral, revision };
  });
}

async function getReferralInTransaction(tx: TransactionSql, id: number, forUpdate = false) {
  const rows = forUpdate
    ? await tx<ReferralRow[]>`
        select r.*, p.external_client_id, p.display_name
        from pipeline.referrals r join pipeline.people p on p.person_id = r.person_id
        where r.referral_id = ${id} for update of r
      `
    : await tx<ReferralRow[]>`
        select r.*, p.external_client_id, p.display_name
        from pipeline.referrals r join pipeline.people p on p.person_id = r.person_id
        where r.referral_id = ${id} limit 1
      `;
  return rows[0] ? mapReferralRow(rows[0]) : null;
}

async function writeReferralAudit(
  tx: TransactionSql,
  referralId: number,
  action: string,
  actor: ReferralActor,
  changedFields: string[],
  fromStage: string | null,
  toStage: string,
  version: number,
  reason?: string,
) {
  await tx`
    insert into pipeline.audit_events (
      entity_type, entity_id, action, actor_id, actor_name,
      from_version, to_version, changed_fields, before_values, after_values, metadata
    ) values (
      'referral', ${String(referralId)}, ${action}, ${actor.id}, ${actor.name},
      ${version > 1 ? version - 1 : null}, ${version}, ${changedFields},
      ${fromStage ? tx.json({ stage: fromStage }) : null}, ${tx.json({ stage: toStage })},
      ${tx.json(reason ? { reason } : {})}
    )
  `;
}

type WorkflowRequirementRow = {
  work_item_id: string;
  type: AdmissionRequirement["type"];
  label: string;
  gate: AdmissionRequirement["requiredFor"];
  status: AdmissionRequirement["status"];
  owner_name: string | null;
  due_at: Date | string | null;
  next_action: string;
  blocker: boolean;
  evidence_document_id: string | null;
  evidence_document_name: string | null;
  waiver_reason: string | null;
  version: number;
  updated_at: Date | string;
};

type WorkflowDecisionRow = {
  decision_id: string;
  outcome: AdmissionDecision["outcome"];
  reason_code: string | null;
  reason_note: string | null;
  decided_by: string;
  decided_by_name: string;
  decided_at: Date | string;
  version: number;
};

async function getPostgresWorkflowContext(tx: TransactionSql, referralId: number, referral: Referral) {
  const [assessmentRows, requirementRows, decisionRows] = await Promise.all([
    tx<{ complete: boolean }[]>`
      select exists(
        select 1 from pipeline.assessments
        where referral_id = ${referralId} and status = 'complete'
      ) as complete
    `,
    tx<WorkflowRequirementRow[]>`
      select work_item_id, type, label, gate, status, owner_name, due_at,
             next_action, blocker, evidence_document_id, evidence_document_name, waiver_reason, version, updated_at
      from pipeline.work_items
      where referral_id = ${referralId}
      order by created_at, work_item_id
    `,
    tx<WorkflowDecisionRow[]>`
      select decision_id, outcome, reason_code, reason_note, decided_by,
             decided_by_name, decided_at, version
      from pipeline.admission_decisions
      where referral_id = ${referralId}
      limit 1
    `,
  ]);

  return {
    assessmentComplete: assessmentRows[0]?.complete || Boolean(referral.assessment?.completedAt),
    requirements: requirementRows.length > 0
      ? requirementRows.map(mapWorkflowRequirementRow)
      : referral.requirements ?? [],
    decision: decisionRows[0] ? mapWorkflowDecisionRow(decisionRows[0]) : referral.admissionDecision ?? null,
  };
}

function mapWorkflowRequirementRow(row: WorkflowRequirementRow): AdmissionRequirement {
  return {
    id: row.work_item_id,
    version: Number(row.version),
    type: row.type,
    label: row.label,
    status: row.status,
    requiredFor: row.gate,
    owner: row.owner_name ?? "",
    dueAt: row.due_at ? isoTimestamp(row.due_at) : "",
    nextStep: row.next_action,
    blocker: row.blocker,
    evidenceDocumentId: row.evidence_document_id ?? undefined,
    evidenceDocumentName: row.evidence_document_name ?? undefined,
    waiverReason: row.waiver_reason ?? undefined,
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function mapWorkflowDecisionRow(row: WorkflowDecisionRow): AdmissionDecision {
  return {
    decisionId: row.decision_id,
    outcome: row.outcome,
    reasonCode: row.reason_code ?? "",
    reasonNote: row.reason_note ?? "",
    decidedBy: row.decided_by,
    decidedByName: row.decided_by_name,
    decidedAt: isoTimestamp(row.decided_at),
    version: Number(row.version),
  };
}

async function syncPostgresWorkItems(
  tx: TransactionSql,
  referralId: number,
  knownPersonId: string | null,
  requirements: AdmissionRequirement[],
) {
  const personId = knownPersonId ?? (await tx<{ person_id: string }[]>`
    select person_id from pipeline.referrals where referral_id = ${referralId} limit 1
  `)[0]?.person_id;
  if (!personId) throw new Error("Referral person record is missing.");

  for (const requirement of requirements) {
    await tx`
      insert into pipeline.work_items (
        work_item_id, referral_id, person_id, type, label, gate, status,
        owner_name, due_at, next_action, blocker, evidence_document_id, evidence_document_name,
        waiver_reason, version, updated_at
      ) values (
        ${requirement.id}::uuid, ${referralId}, ${personId}::uuid, ${requirement.type},
        ${requirement.label}, ${requirement.requiredFor}, ${requirement.status},
        ${requirement.owner || null}, ${requirement.dueAt ? new Date(requirement.dueAt) : null},
        ${requirement.nextStep}, ${requirement.blocker}, ${requirement.evidenceDocumentId ?? null}::uuid,
        ${requirement.evidenceDocumentName ?? null},
        ${requirement.waiverReason ?? null}, ${requirement.version ?? 1}, ${new Date(requirement.updatedAt)}
      )
      on conflict (work_item_id) do update set
        type = excluded.type,
        label = excluded.label,
        gate = excluded.gate,
        status = excluded.status,
        owner_name = excluded.owner_name,
        due_at = excluded.due_at,
        next_action = excluded.next_action,
        blocker = excluded.blocker,
        evidence_document_id = excluded.evidence_document_id,
        evidence_document_name = excluded.evidence_document_name,
        waiver_reason = excluded.waiver_reason,
        version = greatest(pipeline.work_items.version, excluded.version),
        updated_at = excluded.updated_at
      where pipeline.work_items.referral_id = ${referralId}
    `;
  }

  const ids = requirements.map((requirement) => requirement.id);
  if (ids.length === 0) {
    await tx`delete from pipeline.work_items where referral_id = ${referralId}`;
  } else {
    await tx`
      delete from pipeline.work_items
      where referral_id = ${referralId}
        and not (work_item_id = any(${ids}::uuid[]))
    `;
  }
}

async function getPostgresReferralRevision() {
  const sql = getPipelineSql();
  const rows = await sql<{ revision: number | string }[]>`
    select revision from pipeline.store_revisions where store_name = 'referrals'
  `;
  return Number(rows[0]?.revision ?? 0);
}

async function getReferralRevisionInTransaction(tx: TransactionSql) {
  const rows = await tx<{ revision: number | string }[]>`
    select revision from pipeline.store_revisions where store_name = 'referrals'
  `;
  return Number(rows[0]?.revision ?? 0);
}

async function bumpReferralRevision(tx: TransactionSql) {
  const rows = await tx<{ revision: number | string }[]>`
    update pipeline.store_revisions
    set revision = revision + 1, updated_at = now()
    where store_name = 'referrals'
    returning revision
  `;
  return Number(rows[0]?.revision ?? 0);
}

function mapReferralRow(row: ReferralRow): Referral {
  const data = isPlainRecord(row.data) ? row.data as Partial<Referral> : {};
  return normalizeReferral({
    ...data,
    id: Number(row.referral_id),
    clientId: row.external_client_id ?? undefined,
    version: Number(row.version),
    sectionVersions: normalizeReferralSectionVersions(row.section_versions ?? data.sectionVersions),
    updatedBy: {
      id: row.updated_by,
      name: row.updated_by_name,
    },
    name: row.display_name,
    stage: row.stage,
    community: row.community,
    owner: row.owner_name ?? data.owner ?? "",
    ownerId: row.owner_id ?? data.ownerId ?? undefined,
    priority: row.priority,
    source: row.source,
    tags: row.tags ?? [],
    note: row.summary ?? data.note ?? "",
    documentHash: row.document_sha256 ?? undefined,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  } as Referral);
}

function mapReferralFileRow(row: ReferralFileRow): ReferralFile {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    referralId: row.referral_id === null ? null : Number(row.referral_id),
    clientId: row.external_client_id ?? undefined,
    canonicalClientId: row.canonical_client_id ?? undefined,
    referralName: row.referral_name,
    community: row.community ?? "",
    uploadedAt: isoTimestamp(row.uploaded_at),
    ...(row.size_bytes === null ? {} : { sizeBytes: Number(row.size_bytes) }),
    status: row.status,
    ...(row.content_type ? { contentType: row.content_type } : {}),
    previewStatus: row.preview_status,
    sourceSystem: row.source_system ?? undefined,
    identityStatus: row.identity_status ?? undefined,
    ...(row.page_count === null ? {} : { pageCount: Number(row.page_count) }),
    ...(row.preview_status === "ready" && /^[0-9a-f-]{36}$/i.test(row.id)
      ? {
          previewUrl: toPipelinePath(`/api/files/${row.id}/preview`),
          ...(Number(row.page_count ?? 0) > 0
            ? { thumbnailUrl: toPipelinePath(`/api/files/${row.id}/preview?page=1&variant=thumbnail`) }
            : {}),
        }
      : {}),
  };
}

function referralSearchText(referral: Partial<Referral>) {
  return normalize([
    referral.name,
    referral.community,
    referral.source,
    referral.owner,
    referral.stage,
    referral.priority,
    referral.documentStatus,
    referral.packetStatus,
    referral.note,
    ...(referral.tags ?? []),
  ].filter(Boolean).join(" "));
}

function dateToSql(value: string | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))) return value;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  const iso = `${match[3]}-${month}-${day}`;
  return Number.isFinite(Date.parse(`${iso}T00:00:00.000Z`)) ? iso : null;
}

function isClosedStage(stage: Referral["stage"]) {
  return stage === "Accepted / Admitted" || stage === "Declined";
}

function isoTimestamp(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizePatch(patch: ReferralPatch): ReferralPatch {
  const allowedKeys: ReadonlyArray<keyof ReferralPatch> = [
    "name",
    "date",
    "stage",
    "community",
    "source",
    "priority",
    "tags",
    "documentName",
    "documentSizeBytes",
    "documentHash",
    "documentStatus",
    "owner",
    "ownerId",
    "note",
    "createdAt",
    "dob",
    "gender",
    "reportedAge",
    "ssn",
    "admissionDate",
    "responsiblePerson",
    "interview",
    "conserved",
    "fieldSources",
    "phone",
    "email",
    "payer",
    "packetId",
    "packetStatus",
    "packetFields",
    "packetReadiness",
    "packetCompleteness",
    "packetMessage",
    "assessment",
    "assessmentDocumentName",
    "assessmentDocumentSizeBytes",
    "assessmentMessage",
    "requirements",
    "admissionDecision",
    "ehrHandoff",
  ];

  return Object.fromEntries(
    allowedKeys
      .filter((key) => key in patch)
      .map((key) => [key, patch[key]]),
  ) as ReferralPatch;
}

function getSectionConflicts(
  current: ReferralSectionVersions,
  touchedSections: ReferralSection[],
  expected?: Partial<ReferralSectionVersions>,
) {
  if (!expected) return [];
  return touchedSections.filter((section) => expected[section] !== current[section]);
}

function referralDataPayload(referral: Referral): JSONValue {
  const data: Record<string, unknown> = { ...referral };
  for (const key of ["id", "sectionVersions", "updatedAt", "updatedBy", "version"]) delete data[key];
  return JSON.parse(JSON.stringify(data)) as JSONValue;
}

function assertPacketIsUnique(documentHash: string | undefined, currentReferralId?: number) {
  if (!documentHash) return;

  const duplicate = state.referrals.find(
    (referral) => referral.id !== currentReferralId && referral.documentHash === documentHash,
  );
  if (duplicate) throw new DuplicateReferralPacketError(duplicate.id);
}

function normalizeReferral(input: Referral): Referral {
  return {
    ...input,
    id: Number(input.id),
    clientId: normalizeClientId(input.clientId) || buildLocalClientId(Number(input.id)),
    version: Number.isInteger(input.version) && input.version && input.version > 0
      ? input.version
      : 1,
    sectionVersions: normalizeReferralSectionVersions(input.sectionVersions),
    ownerId: input.ownerId?.trim() || undefined,
    gender: input.gender ?? "",
    reportedAge: input.reportedAge ?? "",
    ssn: input.ssn ?? "",
    admissionDate: input.admissionDate ?? "",
    responsiblePerson: input.responsiblePerson ?? "",
    interview: input.interview ?? "",
    conserved: input.conserved ?? "",
    fieldSources: input.fieldSources ?? {},
    requirements: input.requirements ?? [],
  };
}

function normalizeClientId(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized && /^[a-zA-Z0-9._:-]{1,128}$/.test(normalized) ? normalized : "";
}

function buildLocalClientId(referralId: number) {
  return `local-client-${String(referralId).padStart(6, "0")}`;
}

function isReferralRecord(value: unknown): value is Referral {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Referral>;

  return (
    Number.isInteger(candidate.id) &&
    typeof candidate.name === "string" &&
    typeof candidate.stage === "string" &&
    typeof candidate.community === "string" &&
    typeof candidate.createdAt === "string"
  );
}

function matchesReferralFilters(referral: Referral, options: ReferralListOptions) {
  if (options.stage && referral.stage !== options.stage) return false;
  if (options.community && referral.community !== options.community) return false;
  if (options.owner && normalizeOwnerName(referral.owner) !== normalizeOwnerName(options.owner)) return false;
  if (options.priority && referral.priority !== options.priority) return false;
  if (options.tag && !(referral.tags ?? []).includes(options.tag)) return false;
  if (options.month && monthKey(referral.createdAt) !== options.month) return false;
  if (options.activeOnly && isClosedStage(referral.stage)) return false;
  if (options.queue && !matchesReferralQueue(referral, options.queue)) return false;
  if (!matchesAssignmentScope(referral, options)) return false;
  return true;
}

function matchesAssignmentScope(
  referral: Referral,
  options: Pick<ReferralListOptions, "assignedOwnerId" | "assignedOwnerNames">,
) {
  const assignedOwnerId = options.assignedOwnerId?.trim();
  if (!assignedOwnerId) return true;
  if (referral.ownerId?.trim()) {
    return referral.ownerId.trim().toLowerCase() === assignedOwnerId.toLowerCase();
  }
  return (options.assignedOwnerNames ?? []).includes(normalizeOwnerName(referral.owner).toLowerCase());
}

function matchesReferralQueue(referral: Referral, queue: ReferralQueueView) {
  if (queue === "unassigned") return isUnassignedOwner(referral.owner);
  if (queue === "packet_review") return ["ready_for_review", "failed"].includes(referral.packetStatus ?? "");
  if (queue === "assessment") return referral.stage === "Assessment";
  if (queue === "decision") return referral.stage === "Community Review";
  return true;
}

function buildReferralFacets(referrals: Referral[]): ReferralFacets {
  return {
    communities: countFacet(referrals.map((referral) => referral.community)),
    stages: countFacet(referrals.map((referral) => referral.stage)),
    owners: countFacet(referrals.map((referral) => normalizeOwnerName(referral.owner))),
    priorities: countFacet(referrals.map((referral) => referral.priority)),
    tags: countFacet(referrals.flatMap((referral) => referral.tags ?? [])),
    months: countFacet(referrals.map((referral) => monthKey(referral.createdAt))).sort((left, right) => right.value.localeCompare(left.value)),
  };
}

function countFacet(values: string[]): ReferralFacetValue[] {
  const counts = new Map<string, number>();
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => left.value.localeCompare(right.value));
}

function mapFacetRows(rows: FacetRow[]): ReferralFacetValue[] {
  return rows.map((row) => ({ value: row.value, count: Number(row.count) }));
}

function monthKey(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function searchableReferralText(referral: Referral) {
  return normalize(
    [
      referral.name,
      referral.community,
      referral.source,
      referral.owner,
      referral.stage,
      referral.priority,
      referral.documentStatus,
      referral.packetStatus,
      referral.note,
      ...(referral.tags ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function getReferralFiles(referral: Referral): ReferralFile[] {
  const files: ReferralFile[] = [];

  if (referral.documentName.trim() && referral.documentStatus !== "Missing") {
    files.push({
      id: `referral-${referral.id}-packet`,
      name: referral.documentName,
      category: "Referral packet",
      referralId: referral.id,
      clientId: referral.clientId,
      referralName: referral.name,
      community: referral.community,
      uploadedAt: referral.updatedAt ?? referral.createdAt,
      sizeBytes: referral.documentSizeBytes,
      status: referral.documentStatus,
      previewStatus: referral.documentHash ? "ready" : "unavailable",
      sourceSystem: "pipeline",
      identityStatus: "linked",
      ...(referral.documentHash
        ? { previewUrl: toPipelinePath(`/api/referrals/${referral.id}/packet`) }
        : {}),
    });
  }

  if (referral.assessmentDocumentName?.trim()) {
    files.push({
      id: `referral-${referral.id}-assessment`,
      name: referral.assessmentDocumentName,
      category: "Assessment",
      referralId: referral.id,
      clientId: referral.clientId,
      referralName: referral.name,
      community: referral.community,
      uploadedAt: referral.updatedAt ?? referral.createdAt,
      sizeBytes: referral.assessmentDocumentSizeBytes,
      status: "Uploaded",
      previewStatus: "unavailable",
      sourceSystem: "pipeline",
      identityStatus: "linked",
    });
  }

  for (const requirement of referral.requirements ?? []) {
    if (!requirement.evidenceDocumentId || !requirement.evidenceDocumentName?.trim()) continue;
    files.push({
      id: requirement.evidenceDocumentId,
      name: requirement.evidenceDocumentName,
      category: requirementFileCategory(requirement.type),
      referralId: referral.id,
      clientId: referral.clientId,
      referralName: referral.name,
      community: referral.community,
      uploadedAt: requirement.updatedAt || referral.updatedAt || referral.createdAt,
      status: requirement.status === "reviewed" ? "Reviewed" : "Uploaded",
      previewStatus: "unavailable",
      sourceSystem: "pipeline",
      identityStatus: "linked",
    });
  }

  return files;
}

function requirementFileCategory(type: AdmissionRequirement["type"]): ReferralFile["category"] {
  const categories: Record<AdmissionRequirement["type"], ReferralFile["category"]> = {
    medication_list: "Medication list",
    tb_test: "TB test",
    signed_admission_agreement: "Admission agreement",
    conservatorship_document: "Conservatorship",
    lic_602: "LIC 602",
    lic_601_603: "LIC 601/603",
    provider_form: "Provider form",
    face_sheet: "Face sheet",
    payer_verification: "Payer verification",
    responsible_party: "Responsible party",
    no_admission_reason: "Other",
  };
  return categories[type];
}

function searchableFileText(file: ReferralFile) {
  return normalize(
    [file.name, file.category, file.referralName, file.community, file.status]
      .filter(Boolean)
      .join(" "),
  );
}

function compareFiles(left: ReferralFile, right: ReferralFile) {
  return right.uploadedAt.localeCompare(left.uploadedAt) || right.id.localeCompare(left.id);
}

function compareReferrals(left: Referral, right: Referral) {
  return (
    (right.updatedAt ?? right.createdAt).localeCompare(left.updatedAt ?? left.createdAt) ||
    right.id - left.id
  );
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizedSearchTokens(value: string) {
  return normalize(value).split(" ").filter(Boolean).slice(0, 12);
}

function matchesSearchTokens(haystack: string, tokens: string[]) {
  return tokens.every((token) => haystack.includes(token));
}

function paddedNumericKey(value: number) {
  return String(value).padStart(20, "0");
}

function clampPageSize(value: number | undefined) {
  if (!Number.isFinite(value)) return 100;
  return Math.min(maxPageSize, Math.max(1, Math.floor(value as number)));
}

function isMissingFile(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT",
  );
}
