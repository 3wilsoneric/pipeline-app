import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import { recoverLegacyCanvasAssessmentCandidate } from "@/lib/pipeline/allo-note-recovery.mjs";
import type { Referral } from "@/lib/pipeline/referral-types";
import { buildHistoricalProfile } from "@/lib/pipeline/historical-profile";
import type {
  HistoricalProfileCandidateSource,
  HistoricalProfileCapturedSource,
  HistoricalProfileDocument,
  HistoricalProfileResponse,
  HistoricalProfileSourceBlock,
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
  page_number: number | null;
  page_title: string | null;
  ordinal: number;
  block_type: string;
  semantic_role: string | null;
  heading_path: string[] | null;
  text: string;
};

type HistoricalDocumentRow = {
  document_id: string;
  file_name: string;
  category: string;
  content_type: string | null;
  byte_size: number | string | null;
  page_count: number | string | null;
  uploaded_at: string;
  processing_status: string;
  preview_status: string;
  source_system: string | null;
};

type ManifestSnapshot = {
  source_canvas_id?: unknown;
  source_canvas_name?: unknown;
  source_project_name?: unknown;
  source_locator?: unknown;
  captured_at?: unknown;
  blocks?: unknown;
  candidates?: unknown;
};

type HistoricalProfileData = {
  candidates: HistoricalProfileCandidateSource[];
  capturedSources: HistoricalProfileCapturedSource[];
  documents: HistoricalProfileDocument[];
};

const globalCache = globalThis as typeof globalThis & {
  __pipelineHistoricalProfileManifest?: {
    key: string;
    byCanvasId: Map<string, Omit<HistoricalProfileData, "documents">>;
  };
};

export async function getHistoricalProfile(referral: Referral): Promise<HistoricalProfileResponse> {
  if (referral.workspaceOrigin !== "allo" && referral.workspaceOrigin !== "import") {
    throw new Error("Source profile is available only for imported workspaces.");
  }

  const readiness = getPipelineDatabaseReadiness();
  const data = readiness.ready
    ? await postgresProfileData(referral)
    : await localManifestProfileData(referral.sourceWorkspaceId);
  return buildHistoricalProfile(referral.id, data.candidates, data.capturedSources, data.documents);
}

async function postgresProfileData(referral: Referral): Promise<HistoricalProfileData> {
  const candidates = await postgresCandidates(referral);
  const capturedSources = await postgresCapturedSources(referral);
  const documents = await postgresDocuments(referral.id);
  return { candidates, capturedSources, documents };
}

async function postgresCandidates(referral: Referral): Promise<HistoricalProfileCandidateSource[]> {
  const rows = await getPipelineSql()<CanvasCandidateRow[]>`
    with latest_snapshots as (
      select distinct on (source_canvas_id) *
      from pipeline.canvas_content_snapshots s
      where (
        s.referral_id = ${referral.id}
        or (
          s.referral_id is null
          and ${referral.sourceWorkspaceId ?? null}::text is not null
          and s.source_canvas_id = ${referral.sourceWorkspaceId ?? null}
        )
      )
      order by source_canvas_id, captured_at desc, canvas_content_snapshot_id desc
    )
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
    from latest_snapshots s
    join pipeline.canvas_content_field_candidates c
      on c.canvas_content_snapshot_id = s.canvas_content_snapshot_id
    where c.target_field_key = 'assessment_notes'
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
    with latest_snapshots as (
      select distinct on (source_canvas_id) *
      from pipeline.canvas_content_snapshots s
      where (
        s.referral_id = ${referral.id}
        or (
          s.referral_id is null
          and ${referral.sourceWorkspaceId ?? null}::text is not null
          and s.source_canvas_id = ${referral.sourceWorkspaceId ?? null}
        )
      )
      order by source_canvas_id, captured_at desc, canvas_content_snapshot_id desc
    )
    select
      s.canvas_content_snapshot_id::text,
      s.source_canvas_id,
      s.source_canvas_name,
      s.source_project_name,
      s.source_locator,
      s.captured_at::text,
      b.source_block_id,
      b.page_number,
      b.page_title,
      b.ordinal,
      b.block_type,
      b.semantic_role,
      b.heading_path,
      b.text_content as text
    from latest_snapshots s
    join pipeline.canvas_content_blocks b
      on b.canvas_content_snapshot_id = s.canvas_content_snapshot_id
    where not exists (
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

async function postgresCapturedSources(referral: Referral): Promise<HistoricalProfileCapturedSource[]> {
  const rows = await getPipelineSql()<CanvasBlockRow[]>`
    with latest_snapshots as (
      select distinct on (source_canvas_id) *
      from pipeline.canvas_content_snapshots s
      where (
        s.referral_id = ${referral.id}
        or (
          s.referral_id is null
          and ${referral.sourceWorkspaceId ?? null}::text is not null
          and s.source_canvas_id = ${referral.sourceWorkspaceId ?? null}
        )
      )
      order by source_canvas_id, captured_at desc, canvas_content_snapshot_id desc
    )
    select
      s.canvas_content_snapshot_id::text,
      s.source_canvas_id,
      s.source_canvas_name,
      s.source_project_name,
      s.source_locator,
      s.captured_at::text,
      b.source_block_id,
      b.page_number,
      b.page_title,
      b.ordinal,
      b.block_type,
      b.semantic_role,
      b.heading_path,
      b.text_content as text
    from latest_snapshots s
    join pipeline.canvas_content_blocks b
      on b.canvas_content_snapshot_id = s.canvas_content_snapshot_id
    order by s.captured_at desc, s.canvas_content_snapshot_id, b.ordinal
  `;
  return capturedSourcesFromRows(rows);
}

async function postgresDocuments(referralId: number): Promise<HistoricalProfileDocument[]> {
  const rows = await getPipelineSql()<HistoricalDocumentRow[]>`
    select
      document_id::text,
      file_name,
      category,
      content_type,
      byte_size,
      page_count,
      uploaded_at::text,
      processing_status,
      preview_status,
      source_system
    from pipeline.documents
    where referral_id = ${referralId}
      and deleted_at is null
    order by uploaded_at desc, document_id
    limit 500
  `;
  return rows.map((row) => ({
    documentId: row.document_id,
    name: row.file_name,
    category: row.category,
    contentType: row.content_type,
    sizeBytes: nullableNumber(row.byte_size),
    pageCount: nullableNumber(row.page_count),
    uploadedAt: row.uploaded_at,
    status: row.processing_status,
    previewStatus: row.preview_status,
    sourceSystem: row.source_system,
  }));
}

async function localManifestProfileData(sourceCanvasId: string | undefined): Promise<HistoricalProfileData> {
  const empty = { candidates: [], capturedSources: [], documents: [] };
  if (!sourceCanvasId) return empty;
  const configured = process.env.PIPELINE_NOTE_LAB_MANIFEST_PATH?.trim();
  if (!configured || process.env.NODE_ENV === "production") return empty;
  const filePath = path.resolve(configured);
  const metadata = await stat(filePath).catch(() => null);
  if (!metadata?.isFile()) return empty;
  const key = `${filePath}:${metadata.size}:${metadata.mtimeMs}`;
  if (globalCache.__pipelineHistoricalProfileManifest?.key !== key) {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as { snapshots?: unknown };
    const snapshots = Array.isArray(parsed.snapshots) ? parsed.snapshots : [];
    globalCache.__pipelineHistoricalProfileManifest = {
      key,
      byCanvasId: indexManifestProfileData(snapshots),
    };
  }
  const data = globalCache.__pipelineHistoricalProfileManifest.byCanvasId.get(sourceCanvasId);
  return data ? { ...data, documents: [] } : empty;
}

function indexManifestProfileData(snapshots: unknown[]) {
  const byCanvasId = new Map<string, Omit<HistoricalProfileData, "documents">>();
  for (const value of snapshots) {
    if (!isRecord(value)) continue;
    const snapshot = value as ManifestSnapshot;
    if (typeof snapshot.source_canvas_id !== "string") continue;
    const sourceCanvasId = snapshot.source_canvas_id;
    const candidates = (Array.isArray(snapshot.candidates) ? snapshot.candidates : []).flatMap((candidate, index) => {
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
    const source = manifestCapturedSource(snapshot);
    byCanvasId.set(sourceCanvasId, {
      candidates,
      capturedSources: source ? [source] : [],
    });
  }
  return byCanvasId;
}

function capturedSourcesFromRows(rows: CanvasBlockRow[]): HistoricalProfileCapturedSource[] {
  const snapshots = new Map<string, CanvasBlockRow[]>();
  for (const row of rows) {
    const current = snapshots.get(row.canvas_content_snapshot_id) ?? [];
    current.push(row);
    snapshots.set(row.canvas_content_snapshot_id, current);
  }
  return [...snapshots.entries()].flatMap(([snapshotId, blocks]) => {
    const first = blocks[0];
    if (!first) return [];
    const source = {
      sourceCanvasId: first.source_canvas_id,
      sourceCanvasName: first.source_canvas_name,
      sourceProjectName: first.source_project_name,
      sourceLocator: first.source_locator,
      capturedAt: first.captured_at,
    };
    return [{
      ...source,
      snapshotId,
      blocks: blocks.map((block) => ({
        blockId: block.source_block_id,
        ordinal: Number(block.ordinal),
        pageNumber: nullableNumber(block.page_number),
        pageTitle: block.page_title,
        blockType: block.block_type,
        semanticRole: block.semantic_role,
        headingPath: Array.isArray(block.heading_path) ? block.heading_path : [],
        text: block.text,
      })),
    }];
  });
}

function manifestCapturedSource(snapshot: ManifestSnapshot): HistoricalProfileCapturedSource | null {
  if (typeof snapshot.source_canvas_id !== "string" || !Array.isArray(snapshot.blocks)) return null;
  const source = {
    sourceCanvasId: snapshot.source_canvas_id,
    sourceCanvasName: typeof snapshot.source_canvas_name === "string" ? snapshot.source_canvas_name : "Imported canvas",
    sourceProjectName: typeof snapshot.source_project_name === "string" ? snapshot.source_project_name : null,
    sourceLocator: typeof snapshot.source_locator === "string" ? snapshot.source_locator : null,
    capturedAt: typeof snapshot.captured_at === "string" ? snapshot.captured_at : null,
  };
  const blocks = snapshot.blocks.flatMap((value, index): HistoricalProfileSourceBlock[] => {
    if (!isRecord(value) || typeof value.text !== "string") return [];
    const ordinal = nullableNumber(value.ordinal) ?? index + 1;
    return [{
      blockId: typeof value.source_block_id === "string"
        ? value.source_block_id
        : `${source.sourceCanvasId}:block:${ordinal}`,
      ordinal,
      pageNumber: nullableNumber(value.page_number),
      pageTitle: typeof value.page_title === "string" ? value.page_title : null,
      blockType: typeof value.block_type === "string" ? value.block_type : "text",
      semanticRole: typeof value.semantic_role === "string" ? value.semantic_role : null,
      headingPath: Array.isArray(value.heading_path)
        ? value.heading_path.filter((item): item is string => typeof item === "string")
        : [],
      text: value.text,
    }];
  });
  return {
    ...source,
    snapshotId: `${source.sourceCanvasId}:${source.capturedAt ?? "local"}`,
    blocks,
  };
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
