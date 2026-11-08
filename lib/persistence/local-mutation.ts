import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type LocalStore = "referrals" | "assessments";
type PendingWrite = { store: LocalStore; path: string; data: string };
type JournalEntry = PendingWrite & { before: string | null; after: string };
type MutationLease = {
  active: boolean;
  committed: boolean;
  writes: Map<LocalStore, PendingWrite>;
  rollbacks: Array<() => void>;
};
const local = globalThis as typeof globalThis & {
  __pipelineLocalMutation?: { queue: Promise<void>; context: AsyncLocalStorage<MutationLease>; generation: number };
};
const state = local.__pipelineLocalMutation ??= {
  queue: Promise.resolve(), context: new AsyncLocalStorage<MutationLease>(), generation: 0,
};
state.generation ??= 0;

// Only the two single-process local adapters use this boundary. Their nested
// writes commit together via a private journal; PostgreSQL keeps its transactions.
export async function withLocalMutation<T>(work: () => Promise<T>): Promise<T> {
  const current = state.context.getStore();
  if (current?.active) {
    const writes = new Map(current.writes);
    const checkpoint = current.rollbacks.length;
    try { return await work(); }
    catch (error) {
      current.writes = writes;
      rollback(current, checkpoint);
      throw error;
    }
  }
  const previous = state.queue;
  let release!: () => void;
  state.queue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const lease: MutationLease = { active: true, committed: false, writes: new Map(), rollbacks: [] };
  try {
    return await state.context.run(lease, async () => {
      await recover();
      const result = await work();
      if (lease.writes.size) await commit(lease);
      return result;
    });
  } catch (error) {
    // Once the journal is published the accepted intent must survive. Further
    // reads/writes must recover it before accessing either adapter's cache.
    if (!lease.committed) rollback(lease, 0);
    throw error;
  } finally {
    lease.active = false;
    release();
  }
}

export function localStoreGeneration() { return state.generation; }

export function onLocalMutationRollback(restore: () => void) {
  lease().rollbacks.push(restore);
}

export function stageLocalStoreWrite(store: LocalStore, path: string, data: string) {
  if (storePath("referrals") === storePath("assessments")) throw new Error("Local referral and assessment stores require different files.");
  if (resolve(path) !== storePath(store)) throw new Error("Local store path changed during a save.");
  lease().writes.set(store, { store, path: resolve(path), data });
}

function lease() {
  const current = state.context.getStore();
  if (!current?.active) throw new Error("Local writes require a mutation transaction.");
  return current;
}

function rollback(current: MutationLease, checkpoint: number) {
  for (const restore of current.rollbacks.splice(checkpoint).reverse()) restore();
}

function storePath(store: LocalStore) {
  const configured = store === "referrals" ? process.env.PIPELINE_REFERRAL_STORE_PATH : process.env.PIPELINE_ASSESSMENT_STORE_PATH;
  return resolve(configured?.trim() || `.data/${store}.json`);
}

function journalPath() { return `${storePath("referrals")}.transaction.json`; }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function optionalRead(path: string) {
  try { return await readFile(/* turbopackIgnore: true */ path, "utf8"); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function commit(current: MutationLease) {
  const entries: JournalEntry[] = [];
  for (const write of current.writes.values()) {
    const before = await optionalRead(write.path);
    entries.push({ ...write, before: before === null ? null : hash(before), after: hash(write.data) });
  }
  await replaceFile(journalPath(), JSON.stringify({ version: 1, entries }), () => { current.committed = true; });
  await applyJournal(entries);
}

async function recover() {
  const raw = await optionalRead(journalPath());
  if (raw === null) return;
  const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown };
  if (parsed.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length < 1 || parsed.entries.length > 2) {
    throw new Error("The local recovery journal is invalid. Preserve it for recovery.");
  }
  const entries = parsed.entries as JournalEntry[];
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!entry || !["referrals", "assessments"].includes(entry.store) || names.has(entry.store) || paths.has(entry.path)
      || entry.path !== storePath(entry.store) || typeof entry.data !== "string"
      || (entry.before !== null && !/^[a-f0-9]{64}$/.test(entry.before)) || hash(entry.data) !== entry.after) {
      throw new Error("The local recovery journal is invalid. Preserve it for recovery.");
    }
    const data = JSON.parse(entry.data);
    if (data?.version !== 1 || !Array.isArray(data[entry.store])) {
      throw new Error("The local recovery journal contains invalid store data.");
    }
    names.add(entry.store);
    paths.add(entry.path);
  }
  await applyJournal(entries);
  state.generation += 1;
}

async function applyJournal(entries: JournalEntry[]) {
  // Validate every file first: never overwrite unexpected later work during
  // recovery, even when another file already contains this transaction's data.
  const pending: JournalEntry[] = [];
  for (const entry of entries) {
    const raw = await optionalRead(entry.path);
    const actual = raw === null ? null : hash(raw);
    if (actual !== entry.before && actual !== entry.after) {
      throw new Error("Local store contents changed outside the saved transaction. Preserve the files and recovery journal.");
    }
    if (actual !== entry.after) pending.push(entry);
  }
  for (const entry of pending) await replaceFile(entry.path, entry.data);
  await unlink(/* turbopackIgnore: true */ journalPath());
  await syncDirectory(dirname(journalPath()));
}

async function replaceFile(path: string, data: string, published?: () => void) {
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(/* turbopackIgnore: true */ dirname(path), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ temporary, data, { encoding: "utf8", mode: 0o600 });
  await chmod(/* turbopackIgnore: true */ temporary, 0o600);
  const file = await open(/* turbopackIgnore: true */ temporary, "r+");
  try { await file.sync(); } finally { await file.close(); }
  await rename(/* turbopackIgnore: true */ temporary, path);
  published?.();
  await syncDirectory(dirname(path));
}

async function syncDirectory(path: string) {
  const directory = await open(/* turbopackIgnore: true */ path, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
