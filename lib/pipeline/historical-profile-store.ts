import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import { recoverLegacyCanvasAssessmentCandidate } from "@/lib/pipeline/allo-note-recovery.mjs";
import type { Referral } from "@/lib/pipeline/referral-types";
import { buildHistoricalProfile } from "@/lib/pipeline/historical-profile";
import type {
  HistoricalProfileCandidateSource,
  HistoricalProfileResponse,
} from "@/lib/pipeline/historical-profile-contracts";

type CanvasCandidateRow = {
  candidate_id: string;
  source_canvas_id: string;
  source_canvas_name: string;
  source_project_name: string | null;
  source_locator: string | null;
  captured_at: string | null;
  proposed_value: string | null;
};

type CanvasBlockRow = {
  canvas_content_snapshot_id: string;
  source_canvas_id: string;
  source_canvas_name: string;
  source_project_name: string | null;
  source_locator: string | null;
  captured_at: string | null;
  source_block_id: string;
  block_type: string;
  text: string;
};

type ManifestSnapshot = {
  source_canvas_id?: unknown;
  source_canvas_name?: unknown;
  source_project_name?: unknown;
  source_locator?: unknown;
  captured_at?: unknown;
  candidates?: unknown;
};

const globalCache = globalThis as typeof globalThis & {
  __pipelineHistoricalProfileManifest?: {
    key: string;
    byCanvasId: Map<string, HistoricalProfileCandidateSource[]>;
  };
};

export async function getHistoricalProfile(referral: Referral): Promise<HistoricalProfileResponse> {
  if (referral.workspaceStatus !== "historical") {
    throw new Error("Historical profile is available only for imported historical workspaces.");
  }

  const readiness = getPipelineDatabaseReadiness();
  const candidates = readiness.ready
    ? await postgresCandidates(referral)
    : await localManifestCandidates(referral.sourceWorkspaceId);
  return buildHistoricalProfile(referral.id, candidates);
}

async function postgresCandidates(referral: Referral): Promise<HistoricalProfileCandidateSource[]> {
  const rows = await getPipelineSql()<CanvasCandidateRow[]>`
    select
      c.canvas_content_candidate_id::text as candidate_id,
      s.source_canvas_id,
      s.source_canvas_name,
      s.source_project_name,
      s.source_locator,
      s.captured_at::text,
      case when jsonb_typeof(c.proposed_value) = 'string'
        then c.proposed_value #>> '{}'
        else null
      end as proposed_value
    from pipeline.canvas_content_snapshots s
    join pipeline.canvas_content_field_candidates c
      on c.canvas_content_snapshot_id = s.canvas_content_snapshot_id
    where c.target_field_key = 'assessment_notes'
      and (
        s.referral_id = ${referral.id}
        or (
          s.referral_id is null
          and ${referral.sourceWorkspaceId ?? null}::text is not null
          and s.source_canvas_id = ${referral.sourceWorkspaceId ?? null}
        )
      )
    order by s.captured_at desc, c.canvas_content_candidate_id
  `;
  const imported = rows.flatMap((row) => row.proposed_value ? [{
    candidateId: row.candidate_id,
    sourceCanvasId: row.source_canvas_id,
    sourceCanvasName: row.source_canvas_name,
    sourceProjectName: row.source_project_name,
    sourceLocator: row.source_locator,
    capturedAt: row.captured_at,
    proposedValue: row.proposed_value,
  }] : []);
  const recovered = await postgresLegacyCandidates(referral);
  return [...imported, ...recovered];
}

async function postgresLegacyCandidates(referral: Referral): Promise<HistoricalProfileCandidateSource[]> {
  const rows = await getPipelineSql()<CanvasBlockRow[]>`
    select
      s.canvas_content_snapshot_id::text,
      s.source_canvas_id,
      s.source_canvas_name,
      s.source_project_name,
      s.source_locator,
      s.captured_at::text,
      b.source_block_id,
      b.block_type,
      b.text_content as text
    from pipeline.canvas_content_snapshots s
    join pipeline.canvas_content_blocks b
      on b.canvas_content_snapshot_id = s.canvas_content_snapshot_id
    where (
      s.referral_id = ${referral.id}
      or (
        s.referral_id is null
        and ${referral.sourceWorkspaceId ?? null}::text is not null
        and s.source_canvas_id = ${referral.sourceWorkspaceId ?? null}
      )
    )
    and not exists (
      select 1
      from pipeline.canvas_content_field_candidates c
      where c.canvas_content_snapshot_id = s.canvas_content_snapshot_id
        and c.target_field_key = 'assessment_notes'
    )
    order by s.captured_at desc, s.canvas_content_snapshot_id, b.ordinal
  `;

  const snapshots = new Map<string, CanvasBlockRow[]>();
  for (const row of rows) {
    const current = snapshots.get(row.canvas_content_snapshot_id) ?? [];
    current.push(row);
    snapshots.set(row.canvas_content_snapshot_id, current);
  }

  return [...snapshots.entries()].flatMap(([snapshotId, blocks]) => {
    const recovered = recoverLegacyCanvasAssessmentCandidate(blocks);
    const source = blocks[0];
    if (!recovered || !source) return [];
    return [{
      candidateId: `recovered:${snapshotId}`,
      sourceCanvasId: source.source_canvas_id,
      sourceCanvasName: source.source_canvas_name,
      sourceProjectName: source.source_project_name,
      sourceLocator: source.source_locator,
      capturedAt: source.captured_at,
      proposedValue: recovered.proposedValue,
    }];
  });
}

async function localManifestCandidates(sourceCanvasId: string | undefined) {
  if (!sourceCanvasId) return [];
  const configured = process.env.PIPELINE_NOTE_LAB_MANIFEST_PATH?.trim();
  if (!configured || process.env.NODE_ENV === "production") return [];
  const filePath = path.resolve(configured);
  const metadata = await stat(filePath).catch(() => null);
  if (!metadata?.isFile()) return [];
  const key = `${filePath}:${metadata.size}:${metadata.mtimeMs}`;
  if (globalCache.__pipelineHistoricalProfileManifest?.key !== key) {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { snapshots?: unknown };
    const snapshots = Array.isArray(parsed.snapshots) ? parsed.snapshots : [];
    globalCache.__pipelineHistoricalProfileManifest = {
      key,
      byCanvasId: indexManifestCandidates(snapshots),
    };
  }
  return globalCache.__pipelineHistoricalProfileManifest.byCanvasId.get(sourceCanvasId) ?? [];
}

function indexManifestCandidates(snapshots: unknown[]) {
  const byCanvasId = new Map<string, HistoricalProfileCandidateSource[]>();
  for (const value of snapshots) {
    if (!isRecord(value)) continue;
    const snapshot = value as ManifestSnapshot;
    if (typeof snapshot.source_canvas_id !== "string" || !Array.isArray(snapshot.candidates)) continue;
    const sourceCanvasId = snapshot.source_canvas_id;
    const candidates = snapshot.candidates.flatMap((candidate, index) => {
      if (!isRecord(candidate) || candidate.target_field_key !== "assessment_notes"
        || typeof candidate.proposed_value !== "string") return [];
      return [{
        candidateId: `${sourceCanvasId}:${index + 1}`,
        sourceCanvasId,
        sourceCanvasName: typeof snapshot.source_canvas_name === "string" ? snapshot.source_canvas_name : "Imported canvas",
        sourceProjectName: typeof snapshot.source_project_name === "string" ? snapshot.source_project_name : null,
        sourceLocator: typeof snapshot.source_locator === "string" ? snapshot.source_locator : null,
        capturedAt: typeof snapshot.captured_at === "string" ? snapshot.captured_at : null,
        proposedValue: candidate.proposed_value,
      }];
    });
    if (candidates.length) byCanvasId.set(sourceCanvasId, candidates);
  }
  return byCanvasId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
