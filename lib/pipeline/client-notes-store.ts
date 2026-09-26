import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { getPipelineSql } from "@/lib/database/pipeline-database";
import type { LatestNote, NoteBlock } from "@/lib/pipeline/client-notes";
import { getReferralStoreReadiness } from "@/lib/pipeline/referral-store";

// Client notes storage (docs/design/DECISIONS.md, "Notes"). Each heading has its own version and never
// changes the referral's version, so notes never make a referral or assessment save conflict. Each heading
// records who last edited it and when. Notes save as someone types, so they add no audit rows, which would
// flood the referral's Activity.

type Actor = { id: string; name: string };
export type NoteSaveResult = { ok: true; block: NoteBlock } | { ok: false; block: NoteBlock | null };

type LocalNotesFile = { schema: 1; blocks: (NoteBlock & { referral_id: number })[] };

const globalState = globalThis as typeof globalThis & { __pipelineClientNotes?: { loaded?: Promise<LocalNotesFile>; queue: Promise<unknown> } };
const localState = globalState.__pipelineClientNotes ??= { queue: Promise.resolve() };

const usesPostgres = () => getReferralStoreReadiness().mode === "postgres";
const localPath = () => process.env.PIPELINE_CLIENT_NOTES_STORE_PATH?.trim() || ".data/client-notes.json";

async function loadLocal(): Promise<LocalNotesFile> {
  localState.loaded ??= readFile(/* turbopackIgnore: true */ localPath(), "utf8")
    .then((raw) => {
      const parsed = JSON.parse(raw) as Partial<LocalNotesFile>;
      return { schema: 1 as const, blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [] };
    })
    .catch(() => ({ schema: 1 as const, blocks: [] }));
  return localState.loaded;
}

async function persistLocal(file: LocalNotesFile) {
  const path = localPath();
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(/* turbopackIgnore: true */ dirname(path), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(file), { mode: 0o600 });
  await rename(/* turbopackIgnore: true */ temporary, path);
}

// One local write at a time, so two saves never interleave.
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = localState.queue.catch(() => undefined).then(work);
  localState.queue = next.catch(() => undefined);
  return next;
}

type Row = { heading_key: string; body: string; version: number | string; updated_at: Date | string; updated_by_name: string };
const fromRow = (row: Row): NoteBlock => ({ block_key: row.heading_key, body: row.body, version: Number(row.version), updated_at: new Date(row.updated_at).toISOString(), updated_by_name: row.updated_by_name });
const fromLocal = ({ block_key, body, version, updated_at, updated_by_name }: NoteBlock): NoteBlock => ({ block_key, body, version, updated_at, updated_by_name });

export async function listClientNotes(referralId: number): Promise<NoteBlock[]> {
  if (usesPostgres()) {
    const rows = await getPipelineSql()<Row[]>`
      select heading_key, body, version, updated_at, updated_by_name
      from pipeline.client_note_blocks where referral_id = ${referralId}
    `;
    return rows.map(fromRow);
  }
  return (await loadLocal()).blocks.filter((block) => block.referral_id === referralId).map(fromLocal);
}

// expectedVersion 0 means "this heading has no notes yet". A stale version returns the current block.
export async function saveClientNote(referralId: number, headingKey: string, body: string, expectedVersion: number, actor: Actor): Promise<NoteSaveResult> {
  if (usesPostgres()) {
    return getPipelineSql().begin(async (tx) => {
      const current = await tx<Row[]>`
        select heading_key, body, version, updated_at, updated_by_name from pipeline.client_note_blocks
        where referral_id = ${referralId} and heading_key = ${headingKey} for update
      `;
      const existing = current[0] ? fromRow(current[0]) : null;
      if ((existing?.version ?? 0) !== expectedVersion) return { ok: false, block: existing } as const;
      const rows = existing
        ? await tx<Row[]>`
            update pipeline.client_note_blocks
            set body = ${body}, version = version + 1, updated_by = ${actor.id}, updated_by_name = ${actor.name}, updated_at = now()
            where referral_id = ${referralId} and heading_key = ${headingKey}
            returning heading_key, body, version, updated_at, updated_by_name`
        : await tx<Row[]>`
            insert into pipeline.client_note_blocks (referral_id, heading_key, body, updated_by, updated_by_name)
            values (${referralId}, ${headingKey}, ${body}, ${actor.id}, ${actor.name})
            on conflict (referral_id, heading_key) do nothing
            returning heading_key, body, version, updated_at, updated_by_name`;
      if (!rows[0]) {
        const latest = await tx<Row[]>`select heading_key, body, version, updated_at, updated_by_name from pipeline.client_note_blocks where referral_id = ${referralId} and heading_key = ${headingKey}`;
        return { ok: false, block: latest[0] ? fromRow(latest[0]) : null } as const;
      }
      return { ok: true, block: fromRow(rows[0]) } as const;
    });
  }
  return serial(async () => {
    const file = await loadLocal();
    const index = file.blocks.findIndex((block) => block.referral_id === referralId && block.block_key === headingKey);
    const existing = index >= 0 ? file.blocks[index] : null;
    if ((existing?.version ?? 0) !== expectedVersion) return { ok: false, block: existing ? fromLocal(existing) : null } as const;
    const now = new Date().toISOString();
    const block = { referral_id: referralId, block_key: headingKey, body, version: expectedVersion + 1, updated_at: now, updated_by_name: actor.name };
    if (index >= 0) file.blocks[index] = block; else file.blocks.push(block);
    await persistLocal(file);
    return { ok: true, block: fromLocal(block) } as const;
  });
}

// For the Home board and Workspaces: per referral, the first line of the most recently edited heading.
export async function latestClientNotes(referralIds: readonly number[]): Promise<LatestNote[]> {
  if (!referralIds.length) return [];
  const blocks = usesPostgres()
    ? (await getPipelineSql()<(Row & { referral_id: number | string })[]>`
        select referral_id, heading_key, body, version, updated_at, updated_by_name from pipeline.client_note_blocks
        where referral_id = any(${[...referralIds]}::bigint[]) and body <> ''
        order by updated_at desc`).map((row) => ({ referral_id: Number(row.referral_id), ...fromRow(row) }))
    : (await loadLocal()).blocks.filter((block) => referralIds.includes(block.referral_id)).sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  const latest = new Map<number, LatestNote>();
  for (const block of blocks) {
    if (latest.has(block.referral_id)) continue;
    const text = block.body.split("\n").map((line) => line.trim()).find(Boolean);
    if (text) latest.set(block.referral_id, { referral_id: block.referral_id, text: text.slice(0, 300), updated_at: block.updated_at });
  }
  return [...latest.values()];
}
