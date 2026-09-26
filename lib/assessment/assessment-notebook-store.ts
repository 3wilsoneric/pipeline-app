import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AssessmentActor } from "@/lib/assessment/assessment-records";
import type { NotebookBlock } from "@/lib/assessment/assessment-notebook";
import { getAssessmentStoreReadiness } from "@/lib/assessment/assessment-store";
import { getPipelineSql } from "@/lib/database/pipeline-database";

// Interview notebook storage (docs/design/DECISIONS.md, "Interview notebook"). Each block has its own
// version and never changes the assessment's version, so notes and answers never conflict. A signed
// assessment's notebook is locked; later changes go through an addendum.

export type NotebookSaveResult =
  | { ok: true; block: NotebookBlock }
  | { ok: false; reason: "conflict"; block: NotebookBlock | null }
  | { ok: false; reason: "locked" };

type LocalNotebookFile = {
  schema: 1;
  blocks: (NotebookBlock & { assessment_id: string })[];
  audit: { event_id: string; assessment_id: string; referral_id: number; block_key: string; actor_id: string; actor_name: string; from_version: number; to_version: number; length: number; created_at: string }[];
};

const globalState = globalThis as typeof globalThis & {
  __pipelineNotebookState?: { loaded?: Promise<LocalNotebookFile>; queue: Promise<unknown> };
};
const localState = globalState.__pipelineNotebookState ??= { queue: Promise.resolve() };
const maxLocalAudit = 5_000;

function localPath() {
  return process.env.PIPELINE_ASSESSMENT_NOTEBOOK_STORE_PATH?.trim() || ".data/assessment-notebooks.json";
}

async function loadLocal(): Promise<LocalNotebookFile> {
  localState.loaded ??= readFile(/* turbopackIgnore: true */ localPath(), "utf8")
    .then((raw) => {
      const parsed = JSON.parse(raw) as Partial<LocalNotebookFile>;
      return { schema: 1 as const, blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [], audit: Array.isArray(parsed.audit) ? parsed.audit : [] };
    })
    .catch(() => ({ schema: 1 as const, blocks: [], audit: [] }));
  return localState.loaded;
}

async function persistLocal(file: LocalNotebookFile) {
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

const toBlock = ({ block_key, body, version, updated_at, updated_by_name }: NotebookBlock): NotebookBlock => ({ block_key, body, version, updated_at, updated_by_name });

export async function listNotebookBlocks(assessmentId: string): Promise<NotebookBlock[]> {
  if (getAssessmentStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<(NotebookBlock & { updated_at: Date | string })[]>`
      select block_key, body, version, updated_at, updated_by_name
      from pipeline.assessment_notebook_blocks where assessment_id = ${assessmentId}
    `;
    return rows.map((row) => ({ ...row, version: Number(row.version), updated_at: new Date(row.updated_at).toISOString() }));
  }
  const file = await loadLocal();
  return file.blocks.filter((block) => block.assessment_id === assessmentId).map(toBlock);
}

// expectedVersion 0 means "the block does not exist yet". Signed assessments are locked.
export async function saveNotebookBlock(input: {
  assessmentId: string;
  referralId: number;
  blockKey: string;
  body: string;
  expectedVersion: number;
  actor: AssessmentActor;
}): Promise<NotebookSaveResult> {
  const { assessmentId, referralId, blockKey, body, expectedVersion, actor } = input;
  if (getAssessmentStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    return sql.begin(async (tx) => {
      const assessment = await tx<{ signed_at: Date | null }[]>`
        select signed_at from pipeline.assessments where assessment_id = ${assessmentId} for share
      `;
      if (!assessment[0] || assessment[0].signed_at) return { ok: false, reason: "locked" } as const;
      const current = await tx<(NotebookBlock & { updated_at: Date | string })[]>`
        select block_key, body, version, updated_at, updated_by_name from pipeline.assessment_notebook_blocks
        where assessment_id = ${assessmentId} and block_key = ${blockKey} for update
      `;
      const existing = current[0] ? { ...current[0], version: Number(current[0].version), updated_at: new Date(current[0].updated_at).toISOString() } : null;
      if ((existing?.version ?? 0) !== expectedVersion) return { ok: false, reason: "conflict", block: existing } as const;
      const rows = existing
        ? await tx<(NotebookBlock & { updated_at: Date | string })[]>`
            update pipeline.assessment_notebook_blocks
            set body = ${body}, version = version + 1, updated_by = ${actor.id}, updated_by_name = ${actor.name}, updated_at = now()
            where assessment_id = ${assessmentId} and block_key = ${blockKey}
            returning block_key, body, version, updated_at, updated_by_name`
        : await tx<(NotebookBlock & { updated_at: Date | string })[]>`
            insert into pipeline.assessment_notebook_blocks (assessment_id, block_key, body, updated_by, updated_by_name)
            values (${assessmentId}, ${blockKey}, ${body}, ${actor.id}, ${actor.name})
            returning block_key, body, version, updated_at, updated_by_name`;
      const block = { ...rows[0], version: Number(rows[0].version), updated_at: new Date(rows[0].updated_at).toISOString() };
      // Audited with the assessment; the note text itself stays in the notebook, not the audit log.
      await tx`
        insert into pipeline.audit_events (
          entity_type, entity_id, action, actor_id, actor_name, from_version, to_version, changed_fields, metadata
        ) values (
          'assessment', ${assessmentId}, 'assessment_notebook_updated', ${actor.id}, ${actor.name},
          ${expectedVersion}, ${block.version}, ${[blockKey]}, ${tx.json({ referral_id: referralId, block_key: blockKey, length: body.length })}
        )
      `;
      return { ok: true, block } as const;
    });
  }
  return serial(async () => {
    // Local mode is development only; the assessment store already enforces one app instance.
    const { getAssessment } = await import("@/lib/assessment/assessment-store");
    const assessment = await getAssessment(assessmentId);
    if (!assessment || assessment.signed_at) return { ok: false, reason: "locked" } as const;
    const file = await loadLocal();
    const index = file.blocks.findIndex((block) => block.assessment_id === assessmentId && block.block_key === blockKey);
    const existing = index >= 0 ? file.blocks[index] : null;
    if ((existing?.version ?? 0) !== expectedVersion) return { ok: false, reason: "conflict", block: existing ? toBlock(existing) : null } as const;
    const now = new Date().toISOString();
    const block = { assessment_id: assessmentId, block_key: blockKey, body, version: expectedVersion + 1, updated_at: now, updated_by_name: actor.name };
    if (index >= 0) file.blocks[index] = block; else file.blocks.push(block);
    file.audit = [...file.audit, { event_id: `aud_${randomUUID()}`, assessment_id: assessmentId, referral_id: referralId, block_key: blockKey, actor_id: actor.id, actor_name: actor.name, from_version: expectedVersion, to_version: block.version, length: body.length, created_at: now }].slice(-maxLocalAudit);
    await persistLocal(file);
    return { ok: true, block: toBlock(block) } as const;
  });
}
