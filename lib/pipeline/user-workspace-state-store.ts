import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getPipelineAuthMode } from "@/lib/auth/pipeline-auth";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import { isPipelineDesktopStateEnabled } from "@/lib/desktop/desktop-server-config";

export type UserWorkspaceStateKind =
  | "recent_destination"
  | "referral_draft"
  | "assessment_draft"
  | "academy_progress"
  | "operator_training_progress"
  | "home_dashboard_layout";

export type UserWorkspaceState<T = unknown> = {
  principal_id: string;
  state_kind: UserWorkspaceStateKind;
  state_key: string;
  payload: T;
  version: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

type PostgresUserWorkspaceState<T = unknown> = Omit<UserWorkspaceState<T>, "version"> & {
  version: string | number | bigint;
};

type WorkspaceStateFile = { schema: 1; records: UserWorkspaceState[] };
type StoreReadiness = {
  enabled: boolean;
  mode: "disabled" | "postgres" | "local_file";
  ready: boolean;
  multi_instance_safe: boolean;
  message: string;
};

const globalState = globalThis as typeof globalThis & {
  __pipelineWorkspaceState?: {
    initialized: boolean;
    loadPromise?: Promise<void>;
    records: Map<string, UserWorkspaceState>;
    persistQueue: Promise<void>;
  };
};

type LocalWorkspaceState = NonNullable<typeof globalState.__pipelineWorkspaceState>;

const localState: LocalWorkspaceState = globalState.__pipelineWorkspaceState ??= {
  initialized: false,
  records: new Map(),
  persistQueue: Promise.resolve(),
};

export function getUserWorkspaceStateReadiness(): StoreReadiness {
  const authenticatedWebEnabled = getPipelineAuthMode() === "entra_jwt"
    && process.env.NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED === "true";
  const browserEnabled = process.env.NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED === "true"
    || authenticatedWebEnabled;
  const serverEnabled = isPipelineDesktopStateEnabled() || authenticatedWebEnabled;
  if (!browserEnabled && !serverEnabled) {
    return {
      enabled: false,
      mode: "disabled",
      ready: false,
      multi_instance_safe: false,
      message: "Per-user workspace state is disabled.",
    };
  }
  if (!browserEnabled || !serverEnabled) {
    return {
      enabled: true,
      mode: "disabled",
      ready: false,
      multi_instance_safe: false,
      message: "Browser and server workspace-state settings must be enabled together.",
    };
  }

  const database = getPipelineDatabaseReadiness();
  if (database.mode === "postgres") {
    return {
      enabled: true,
      mode: "postgres",
      ready: database.ready,
      multi_instance_safe: database.ready,
      message: database.message ?? "Per-user workspace state is ready.",
    };
  }

  const localAllowed = process.env.PIPELINE_ALLOW_LOCAL_DESKTOP_STATE_STORE === "true"
    && (
      process.env.NODE_ENV !== "production"
      || process.env.PIPELINE_DESKTOP_E2E === "true"
    );
  return {
    enabled: true,
    mode: "local_file",
    ready: localAllowed,
    multi_instance_safe: false,
    message: localAllowed
      ? "Local workspace state is suitable for development and tests only."
      : "Per-user workspace state requires PostgreSQL.",
  };
}

export async function listUserWorkspaceState<T>(principalId: string, kind: UserWorkspaceStateKind, limit: number) {
  requireReady();
  if (getUserWorkspaceStateReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<PostgresUserWorkspaceState<T>[]>`
      select principal_id, state_kind, state_key, payload, version,
        expires_at::text, created_at::text, updated_at::text
      from pipeline.user_workspace_state
      where principal_id = ${principalId}
        and state_kind = ${kind}
        and expires_at > now()
      order by updated_at desc, state_key asc
      limit ${limit}
    `;
    return rows.map(normalizePostgresState);
  }

  await ensureLocalLoaded();
  pruneExpiredLocal();
  return [...localState.records.values()]
    .filter((record) => record.principal_id === principalId && record.state_kind === kind)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .slice(0, limit) as UserWorkspaceState<T>[];
}

export async function getUserWorkspaceState<T>(principalId: string, kind: UserWorkspaceStateKind, key: string) {
  requireReady();
  if (getUserWorkspaceStateReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<PostgresUserWorkspaceState<T>[]>`
      select principal_id, state_kind, state_key, payload, version,
        expires_at::text, created_at::text, updated_at::text
      from pipeline.user_workspace_state
      where principal_id = ${principalId}
        and state_kind = ${kind}
        and state_key = ${key}
        and expires_at > now()
    `;
    return rows[0] ? normalizePostgresState(rows[0]) : null;
  }

  await ensureLocalLoaded();
  pruneExpiredLocal();
  return (localState.records.get(recordKey(principalId, kind, key)) as UserWorkspaceState<T> | undefined) ?? null;
}

export async function putUserWorkspaceState<T>(input: {
  principalId: string;
  kind: UserWorkspaceStateKind;
  key: string;
  payload: T;
  expectedVersion: number;
  ttlDays: number;
}) {
  requireReady();
  if (getUserWorkspaceStateReadiness().mode === "postgres") return putPostgresState(input);

  await ensureLocalLoaded();
  pruneExpiredLocal();
  const key = recordKey(input.principalId, input.kind, input.key);
  const current = localState.records.get(key) as UserWorkspaceState<T> | undefined;
  if ((current?.version ?? 0) !== input.expectedVersion) {
    return { ok: false as const, current: current ?? null };
  }
  const now = new Date();
  const next: UserWorkspaceState<T> = {
    principal_id: input.principalId,
    state_kind: input.kind,
    state_key: input.key,
    payload: input.payload,
    version: (current?.version ?? 0) + 1,
    expires_at: new Date(now.getTime() + input.ttlDays * 86_400_000).toISOString(),
    created_at: current?.created_at ?? now.toISOString(),
    updated_at: now.toISOString(),
  };
  localState.records.set(key, next);
  await persistLocal();
  return { ok: true as const, state: next };
}

export async function deleteUserWorkspaceState(principalId: string, kind: UserWorkspaceStateKind, key?: string) {
  requireReady();
  if (getUserWorkspaceStateReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const result = key
      ? await sql`delete from pipeline.user_workspace_state where principal_id = ${principalId} and state_kind = ${kind} and state_key = ${key}`
      : await sql`delete from pipeline.user_workspace_state where principal_id = ${principalId} and state_kind = ${kind}`;
    return result.count;
  }

  await ensureLocalLoaded();
  let deleted = 0;
  for (const [recordMapKey, record] of localState.records) {
    if (record.principal_id !== principalId || record.state_kind !== kind || (key && record.state_key !== key)) continue;
    localState.records.delete(recordMapKey);
    deleted += 1;
  }
  if (deleted) await persistLocal();
  return deleted;
}

export async function deleteVersionedUserWorkspaceState(
  principalId: string,
  kind: UserWorkspaceStateKind,
  key: string,
  expectedVersion: number,
) {
  requireReady();
  if (getUserWorkspaceStateReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    return sql.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended(${postgresLockKey(principalId, kind, key)}, 0)
        )
      `;
      const currentRows = await transaction<PostgresUserWorkspaceState[]>`
        select principal_id, state_kind, state_key, payload, version,
          expires_at::text, created_at::text, updated_at::text
        from pipeline.user_workspace_state
        where principal_id = ${principalId}
          and state_kind = ${kind}
          and state_key = ${key}
          and expires_at > now()
        for update
      `;
      const current = currentRows[0] ? normalizePostgresState(currentRows[0]) : null;
      if (!current) return { ok: true as const, deleted: false };
      if (current.version !== expectedVersion) return { ok: false as const, current };
      await transaction`
        delete from pipeline.user_workspace_state
        where principal_id = ${principalId}
          and state_kind = ${kind}
          and state_key = ${key}
          and version = ${expectedVersion}
      `;
      return { ok: true as const, deleted: true };
    });
  }

  await ensureLocalLoaded();
  pruneExpiredLocal();
  const mapKey = recordKey(principalId, kind, key);
  const current = localState.records.get(mapKey);
  if (!current) return { ok: true as const, deleted: false };
  if (current.version !== expectedVersion) return { ok: false as const, current };
  localState.records.delete(mapKey);
  await persistLocal();
  return { ok: true as const, deleted: true };
}

export async function trimUserWorkspaceState(principalId: string, kind: UserWorkspaceStateKind, keep: number) {
  const records = await listUserWorkspaceState(principalId, kind, 1_000);
  const stale = records.slice(keep);
  await Promise.all(stale.map((record) => deleteVersionedUserWorkspaceState(
    principalId,
    kind,
    record.state_key,
    record.version,
  )));
}

export async function pruneExpiredUserWorkspaceState(limit = 100, dryRun = true) {
  const readiness = getUserWorkspaceStateReadiness();
  if (!readiness.enabled || !readiness.ready) return { mode: readiness.mode, eligible: 0, deleted: 0, dry_run: dryRun };

  if (readiness.mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<{ principal_id: string; state_kind: UserWorkspaceStateKind; state_key: string }[]>`
      select principal_id, state_kind, state_key
      from pipeline.user_workspace_state
      where expires_at <= now()
      order by expires_at asc
      limit ${limit}
    `;
    if (!dryRun && rows.length > 0) {
      await sql.begin(async (transaction) => {
        for (const row of rows) {
          await transaction`
            delete from pipeline.user_workspace_state
            where principal_id = ${row.principal_id}
              and state_kind = ${row.state_kind}
              and state_key = ${row.state_key}
              and expires_at <= now()
          `;
        }
      });
    }
    return { mode: readiness.mode, eligible: rows.length, deleted: dryRun ? 0 : rows.length, dry_run: dryRun };
  }

  await ensureLocalLoaded();
  const expiredKeys = [...localState.records.entries()]
    .filter(([, record]) => Date.parse(record.expires_at) <= Date.now())
    .slice(0, limit)
    .map(([key]) => key);
  if (!dryRun) {
    for (const key of expiredKeys) localState.records.delete(key);
    if (expiredKeys.length) await persistLocal();
  }
  return { mode: readiness.mode, eligible: expiredKeys.length, deleted: dryRun ? 0 : expiredKeys.length, dry_run: dryRun };
}

async function putPostgresState<T>(input: {
  principalId: string;
  kind: UserWorkspaceStateKind;
  key: string;
  payload: T;
  expectedVersion: number;
  ttlDays: number;
}) {
  const sql = getPipelineSql();
  return sql.begin(async (transaction) => {
    await transaction`
      select pg_advisory_xact_lock(
        hashtextextended(${postgresLockKey(input.principalId, input.kind, input.key)}, 0)
      )
    `;
    const currentRows = await transaction<PostgresUserWorkspaceState<T>[]>`
      select principal_id, state_kind, state_key, payload, version,
        expires_at::text, created_at::text, updated_at::text
      from pipeline.user_workspace_state
      where principal_id = ${input.principalId}
        and state_kind = ${input.kind}
        and state_key = ${input.key}
        and expires_at > now()
      for update
    `;
    const current = currentRows[0] ? normalizePostgresState(currentRows[0]) : null;
    if ((current?.version ?? 0) !== input.expectedVersion) {
      return { ok: false as const, current };
    }

    const rows = await transaction<PostgresUserWorkspaceState<T>[]>`
      insert into pipeline.user_workspace_state (
        principal_id, state_kind, state_key, payload, version, expires_at
      ) values (
        ${input.principalId}, ${input.kind}, ${input.key}, ${transaction.json(input.payload as never)},
        1, now() + (${input.ttlDays}::text || ' days')::interval
      )
      on conflict (principal_id, state_kind, state_key) do update
      set payload = excluded.payload,
          version = pipeline.user_workspace_state.version + 1,
          expires_at = excluded.expires_at,
          updated_at = now()
      returning principal_id, state_kind, state_key, payload, version,
        expires_at::text, created_at::text, updated_at::text
    `;
    return { ok: true as const, state: normalizePostgresState(rows[0]) };
  });
}

function requireReady() {
  const readiness = getUserWorkspaceStateReadiness();
  if (!readiness.ready) throw new Error(readiness.message);
}

function localStorePath() {
  return process.env.PIPELINE_DESKTOP_STATE_STORE_PATH?.trim() || ".data/desktop-workspace-state.json";
}

async function ensureLocalLoaded() {
  if (localState.initialized) {
    if (localState.loadPromise) await localState.loadPromise;
    return;
  }
  localState.initialized = true;
  localState.loadPromise = (async () => {
    try {
      const source = JSON.parse(await readFile(/* turbopackIgnore: true */ localStorePath(), "utf8")) as Partial<WorkspaceStateFile>;
      if (source.schema !== 1 || !Array.isArray(source.records)) return;
      for (const record of source.records) {
        if (!isLocalRecord(record)) continue;
        localState.records.set(recordKey(record.principal_id, record.state_kind, record.state_key), record);
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  })().catch((error) => {
    localState.initialized = false;
    localState.loadPromise = undefined;
    throw error;
  });
  const loading = localState.loadPromise;
  await loading;
  if (localState.loadPromise === loading) localState.loadPromise = undefined;
}

function pruneExpiredLocal() {
  const now = Date.now();
  for (const [key, record] of localState.records) {
    if (Date.parse(record.expires_at) <= now) localState.records.delete(key);
  }
}

async function persistLocal() {
  const destination = localStorePath();
  const temporary = `${destination}.${process.pid}.tmp`;
  const payload: WorkspaceStateFile = { schema: 1, records: [...localState.records.values()] };
  localState.persistQueue = localState.persistQueue.catch(() => undefined).then(async () => {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, destination);
  });
  await localState.persistQueue;
}

function isLocalRecord(value: unknown): value is UserWorkspaceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<UserWorkspaceState>;
  return typeof record.principal_id === "string"
    && isWorkspaceStateKind(record.state_kind)
    && typeof record.state_key === "string"
    && Number.isSafeInteger(record.version)
    && Number(record.version) > 0
    && typeof record.expires_at === "string"
    && typeof record.created_at === "string"
    && typeof record.updated_at === "string";
}

const workspaceStateKinds = new Set<UserWorkspaceStateKind>([
  "recent_destination",
  "referral_draft",
  "assessment_draft",
  "academy_progress",
  "operator_training_progress",
  "home_dashboard_layout",
]);

function isWorkspaceStateKind(value: unknown): value is UserWorkspaceStateKind {
  return typeof value === "string" && workspaceStateKinds.has(value as UserWorkspaceStateKind);
}

function recordKey(principalId: string, kind: UserWorkspaceStateKind, key: string) {
  return `${principalId}\u0000${kind}\u0000${key}`;
}

function postgresLockKey(principalId: string, kind: UserWorkspaceStateKind, key: string) {
  return [principalId, kind, key].map((part) => `${part.length}:${part}`).join("");
}

function normalizePostgresState<T>(row: PostgresUserWorkspaceState<T>): UserWorkspaceState<T> {
  const version = Number(row.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Workspace state version is outside the supported range.");
  }
  return { ...row, version };
}

function isMissingFile(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
