import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import {
  buildNoteLabSamples,
  NOTE_LAB_SAMPLE_SCHEMA_VERSION,
  type InternalNoteLabSample,
  type NoteCandidateSource,
} from "@/lib/note-lab/note-lab-engine";
import { ASSESSMENT_LANGUAGE_TAXONOMY_VERSION } from "@/lib/note-lab/assessment-language-core.mjs";

export type NoteLabSampleSet = {
  available: boolean;
  message: string | null;
  samples: InternalNoteLabSample[];
  sampleSetVersion: string;
  source: "private_manifest" | "postgres" | "unavailable";
};

type CanvasCandidateRow = {
  candidate_id: string;
  source_canvas_id: string;
  source_canvas_name: string | null;
  proposed_value: string | null;
};

const globalCache = globalThis as typeof globalThis & {
  __pipelineNoteLabSamples?: {
    key: string;
    expiresAt: number;
    value: NoteLabSampleSet;
  };
};

export async function getNoteLabSampleSet(): Promise<NoteLabSampleSet> {
  const localPath = localManifestPath();
  if (localPath) return loadPrivateManifest(localPath);

  const readiness = getPipelineDatabaseReadiness();
  if (!readiness.ready) return unavailable("Assessment-language source material is not connected in this environment.");
  const cacheKey = `postgres:${NOTE_LAB_SAMPLE_SCHEMA_VERSION}:assessment-language-v1`;
  const cached = globalCache.__pipelineNoteLabSamples;
  if (cached?.key === cacheKey && cached.expiresAt > Date.now()) return cached.value;

  try {
    const rows = await getPipelineSql()<CanvasCandidateRow[]>`
      select
        c.canvas_content_candidate_id::text as candidate_id,
        s.source_canvas_id,
        s.source_canvas_name,
        case when jsonb_typeof(c.proposed_value) = 'string'
          then c.proposed_value #>> '{}'
          else null
        end as proposed_value
      from pipeline.canvas_content_field_candidates c
      join pipeline.canvas_content_snapshots s
        on s.canvas_content_snapshot_id = c.canvas_content_snapshot_id
      where c.target_field_key = 'assessment_notes'
        and c.review_status in ('pending', 'accepted', 'edited', 'applied')
      order by c.canvas_content_candidate_id
      limit 10000
    `;
    const sourceRows = rows.flatMap((row) => row.proposed_value ? [{
      candidateId: row.candidate_id,
      sourceCanvasId: row.source_canvas_id,
      sourceCanvasName: row.source_canvas_name,
      proposedValue: row.proposed_value,
    }] : []);
    const sampleSet = sampleSetFrom(sourceRows, "postgres");
    globalCache.__pipelineNoteLabSamples = { key: cacheKey, expiresAt: Date.now() + 60_000, value: sampleSet };
    return sampleSet;
  } catch {
    return unavailable("Assessment-language source material is temporarily unavailable.");
  }
}

async function loadPrivateManifest(filePath: string): Promise<NoteLabSampleSet> {
  if (process.env.NODE_ENV === "production") return unavailable("Private file sources are disabled in production.");
  const metadata = await stat(filePath).catch(() => null);
  if (!metadata?.isFile()) return unavailable("The private assessment-language manifest could not be found.");
  const cacheKey = `file:${NOTE_LAB_SAMPLE_SCHEMA_VERSION}:${ASSESSMENT_LANGUAGE_TAXONOMY_VERSION}:${filePath}:${metadata.size}:${metadata.mtimeMs}`;
  const cached = globalCache.__pipelineNoteLabSamples;
  if (cached?.key === cacheKey) return cached.value;

  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    const sources = candidateSourcesFromPrivateData(parsed);
    const value = sampleSetFrom(sources, "private_manifest");
    globalCache.__pipelineNoteLabSamples = { key: cacheKey, expiresAt: Number.POSITIVE_INFINITY, value };
    return value;
  } catch {
    return unavailable("The private assessment-language manifest could not be read safely.");
  }
}

function candidateSourcesFromPrivateData(value: unknown): NoteCandidateSource[] {
  if (!isRecord(value)) return [];
  if (Array.isArray(value.snapshots)) return manifestCandidateSources(value.snapshots);
  if (Array.isArray(value.clients)) return combinedCandidateSources(value.clients);
  return [];
}

function manifestCandidateSources(snapshots: unknown[]): NoteCandidateSource[] {
  const sources: NoteCandidateSource[] = [];
  for (const snapshot of snapshots) {
    if (!isRecord(snapshot) || typeof snapshot.source_canvas_id !== "string" || !Array.isArray(snapshot.candidates)) continue;
    for (let index = 0; index < snapshot.candidates.length; index += 1) {
      const candidate = snapshot.candidates[index];
      if (!isRecord(candidate) || candidate.target_field_key !== "assessment_notes"
        || typeof candidate.proposed_value !== "string") continue;
      sources.push({
        candidateId: `${snapshot.source_canvas_id}:${index}`,
        sourceCanvasId: snapshot.source_canvas_id,
        sourceCanvasName: typeof snapshot.source_canvas_name === "string" ? snapshot.source_canvas_name : null,
        proposedValue: candidate.proposed_value,
      });
    }
  }
  return sources;
}

function combinedCandidateSources(clients: unknown[]): NoteCandidateSource[] {
  const sources: NoteCandidateSource[] = [];
  for (const client of clients) {
    for (const canvas of combinedClientCanvases(client)) {
      for (let index = 0; index < canvas.note_candidates.length; index += 1) {
        const source = combinedCandidateSource(canvas, index);
        if (source) sources.push(source);
      }
    }
  }
  return sources;
}

function combinedClientCanvases(client: unknown): Array<Record<string, unknown> & { note_candidates: unknown[] }> {
  if (!isRecord(client) || !isRecord(client.allo_content) || !Array.isArray(client.allo_content.canvases)) return [];
  return client.allo_content.canvases.filter(
    (canvas): canvas is Record<string, unknown> & { note_candidates: unknown[] } =>
      isRecord(canvas) && typeof canvas.source_canvas_id === "string" && Array.isArray(canvas.note_candidates),
  );
}

function combinedCandidateSource(
  canvas: Record<string, unknown> & { note_candidates: unknown[] },
  index: number,
): NoteCandidateSource | null {
  const candidate = canvas.note_candidates[index];
  if (!isRecord(candidate) || candidate.target_field_key !== "assessment_notes" || typeof candidate.proposed_value !== "string") return null;
  return {
    candidateId: `${canvas.source_canvas_id}:${index}`,
    sourceCanvasId: String(canvas.source_canvas_id),
    sourceCanvasName: typeof canvas.source_canvas_name === "string" ? canvas.source_canvas_name : null,
    proposedValue: candidate.proposed_value,
  };
}

function sampleSetFrom(sources: NoteCandidateSource[], source: NoteLabSampleSet["source"]): NoteLabSampleSet {
  const built = buildNoteLabSamples(sources);
  if (built.samples.length < 2) return unavailable("At least two confidently mapped answers to the same assessment field are required.");
  return { available: true, message: null, source, ...built };
}

function localManifestPath() {
  const configured = process.env.PIPELINE_NOTE_LAB_MANIFEST_PATH?.trim();
  return configured ? path.resolve(configured) : null;
}

function unavailable(message: string): NoteLabSampleSet {
  return { available: false, message, source: "unavailable", samples: [], sampleSetVersion: "unavailable" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
