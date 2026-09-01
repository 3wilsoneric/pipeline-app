import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  noteLabDocumentationCriteria,
} from "@/lib/note-lab/assessment-language-standards";
import {
  NOTE_LAB_CALIBRATION_TARGET,
  NOTE_LAB_CALIBRATION_VERSION,
  emptyNoteLabProgress,
  normalizeNoteLabProgress,
  type NoteLabFieldReview,
  type NoteLabProgress,
  type NoteLabReviewInput,
  type NoteLabSession,
} from "@/lib/note-lab/note-lab-contracts";
import {
  buildNoteLabCalibration,
  buildNoteLabScenarioCatalog,
  selectNextCalibrationScenario,
  selectSessionScenario,
  validateReviewAgainstScenario,
} from "@/lib/note-lab/note-lab-engine";
import {
  getPipelineDatabaseReadiness,
  getPipelineSql,
} from "@/lib/database/pipeline-database";

type ProgressRecord = {
  revision: number;
  progress: NoteLabProgress;
  persistence: NoteLabSession["persistence"];
};

type LocalEnvelope = {
  schemaVersion: 3;
  records: Record<string, { revision: number; progress: NoteLabProgress }>;
};

const globalLocal = globalThis as typeof globalThis & {
  __pipelineNoteLabScenarioCatalogV4?: ReturnType<typeof buildNoteLabScenarioCatalog>;
  __pipelineNoteLabLocalV4?: {
    initialized: boolean;
    records: Map<string, { revision: number; progress: NoteLabProgress }>;
    persistQueue: Promise<void>;
  };
};
const localState = globalLocal.__pipelineNoteLabLocalV4 ??= {
  initialized: false,
  records: new Map(),
  persistQueue: Promise.resolve(),
};

export async function getNoteLabSession(
  reviewerId: string,
  requestedField?: string | null,
): Promise<NoteLabSession> {
  const catalog = scenarioCatalog();
  if (catalog.length < NOTE_LAB_CALIBRATION_TARGET) {
    return unavailableSession("Assessment writing standards are not configured for enough fields yet.");
  }
  const record = await getProgressRecord(reviewerId, NOTE_LAB_CALIBRATION_VERSION);
  const validScenarioIds = new Set(catalog.map((scenario) => scenario.id));
  const progress = {
    ...record.progress,
    calibrationVersion: NOTE_LAB_CALIBRATION_VERSION,
    reviews: record.progress.reviews.filter((review) => validScenarioIds.has(review.scenarioId)),
  };
  const calibrationProgress = {
    ...progress,
    reviews: progress.reviews.slice(0, NOTE_LAB_CALIBRATION_TARGET),
  };
  const calibration = buildNoteLabCalibration(catalog, calibrationProgress);
  const scenario = selectSessionScenario(catalog, calibrationProgress, requestedField);
  const review = scenario
    ? calibrationProgress.reviews.find((item) => item.scenarioId === scenario.id) ?? null
    : null;
  return {
    enabled: true,
    available: true,
    message: calibration.complete
      ? "Your 15-field assessment writing standard is ready."
      : scenario ? null : "You reviewed every available assessment field in this calibration.",
    calibrationVersion: NOTE_LAB_CALIBRATION_VERSION,
    revision: record.revision,
    persistence: record.persistence,
    scenario,
    review,
    calibration,
    stats: {
      decisionsCompleted: progress.reviews.length,
      fieldsAvailable: catalog.length,
      criteriaAvailable: noteLabDocumentationCriteria.length,
      corpusSamplesAvailable: 0,
    },
  };
}

export async function submitNoteLabReview(reviewerId: string, input: NoteLabReviewInput) {
  if (input.calibrationVersion !== NOTE_LAB_CALIBRATION_VERSION) {
    return { ok: false as const, conflict: true as const, current: await getNoteLabSession(reviewerId) };
  }
  const catalog = scenarioCatalog();
  const current = await getProgressRecord(reviewerId, NOTE_LAB_CALIBRATION_VERSION);
  if (current.progress.reviews.length >= NOTE_LAB_CALIBRATION_TARGET) {
    return { ok: false as const, invalid: true as const, message: "This calibration is already complete." };
  }
  if (current.revision !== input.expectedRevision
    || current.progress.reviews.some((review) => review.scenarioId === input.scenarioId)) {
    return { ok: false as const, conflict: true as const, current: await getNoteLabSession(reviewerId) };
  }
  const activeScenario = catalog.slice(0, NOTE_LAB_CALIBRATION_TARGET)
    .find((scenario) => scenario.id === input.scenarioId) ?? null;
  const scenarioValidation = validateReviewAgainstScenario(input, activeScenario);
  if (!scenarioValidation.ok) {
    return { ok: false as const, invalid: true as const, message: scenarioValidation.error };
  }
  const review: NoteLabFieldReview = {
    scenarioId: input.scenarioId,
    targetField: input.targetField,
    selectedCriterionIds: input.selectedCriterionIds,
    sampleId: input.sampleId,
    sampleDisposition: input.sampleDisposition,
    revisionReasonIds: input.revisionReasonIds,
    submittedAt: new Date().toISOString(),
  };
  const saved = await appendReviewRecord(
    reviewerId,
    NOTE_LAB_CALIBRATION_VERSION,
    current.revision,
    review,
  );
  if (!saved.ok) {
    if (saved.unavailable) return saved;
    return { ok: false as const, conflict: true as const, current: await getNoteLabSession(reviewerId) };
  }
  const updatedProgress: NoteLabProgress = {
    ...current.progress,
    reviews: [...current.progress.reviews, review],
  };
  const nextScenario = selectNextCalibrationScenario(catalog, updatedProgress, input.scenarioId);
  return {
    ok: true as const,
    session: await getNoteLabSession(reviewerId, nextScenario?.targetField),
  };
}

async function getProgressRecord(reviewerId: string, calibrationVersion: string): Promise<ProgressRecord> {
  const readiness = getPipelineDatabaseReadiness();
  if (readiness.ready) {
    const rows = await getPipelineSql()<PostgresReviewRow[]>`
      select scenario_id, target_field, selected_criterion_ids, sample_id,
        sample_disposition, revision_reason_ids, submitted_at::text
      from pipeline.note_lab_field_reviews
      where reviewer_principal_id = ${reviewerId}
        and calibration_version = ${calibrationVersion}
      order by submitted_at, note_lab_field_review_id
      limit 10000
    `;
    const progress = normalizeNoteLabProgress({
      schemaVersion: 3,
      calibrationVersion,
      reviews: rows.map(mapPostgresReview),
    }, calibrationVersion);
    return { revision: progress.reviews.length, progress, persistence: "postgres" };
  }
  if (process.env.NODE_ENV === "production" && !localNoteLabStoreAllowed()) {
    return { revision: 0, progress: emptyNoteLabProgress(calibrationVersion), persistence: "unavailable" };
  }
  await ensureLocalLoaded();
  const local = localState.records.get(reviewerId);
  return local
    ? { revision: local.revision, progress: normalizeNoteLabProgress(local.progress, calibrationVersion), persistence: "local_file" }
    : { revision: 0, progress: emptyNoteLabProgress(calibrationVersion), persistence: "local_file" };
}

async function appendReviewRecord(
  reviewerId: string,
  calibrationVersion: string,
  expectedRevision: number,
  review: NoteLabFieldReview,
) {
  const readiness = getPipelineDatabaseReadiness();
  if (readiness.ready) {
    try {
      return await getPipelineSql().begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${reviewerId}:${calibrationVersion}`}, 0))`;
        const revisionRows = await tx<{ revision: number | string | bigint }[]>`
          select count(*) as revision
          from pipeline.note_lab_field_reviews
          where reviewer_principal_id = ${reviewerId}
            and calibration_version = ${calibrationVersion}
        `;
        if (Number(revisionRows[0]?.revision ?? 0) !== expectedRevision) {
          return { ok: false as const, unavailable: false as const };
        }
        await tx`
          insert into pipeline.note_lab_field_reviews (
            reviewer_principal_id, calibration_version, scenario_id, target_field,
            selected_criterion_ids, sample_id, sample_disposition, revision_reason_ids, submitted_at
          ) values (
            ${reviewerId}, ${calibrationVersion}, ${review.scenarioId}, ${review.targetField},
            ${tx.json(review.selectedCriterionIds as never)}, ${review.sampleId}, ${review.sampleDisposition},
            ${tx.json(review.revisionReasonIds as never)}, ${review.submittedAt}::timestamptz
          )
        `;
        return { ok: true as const };
      });
    } catch {
      return { ok: false as const, unavailable: true as const, message: "Shared review storage is unavailable." };
    }
  }
  if (process.env.NODE_ENV === "production" && !localNoteLabStoreAllowed()) {
    return { ok: false as const, unavailable: true as const, message: "Shared review storage is not configured." };
  }
  await ensureLocalLoaded();
  const current = localState.records.get(reviewerId);
  if ((current?.revision ?? 0) !== expectedRevision) {
    return { ok: false as const, unavailable: false as const };
  }
  const progress: NoteLabProgress = current?.progress ?? emptyNoteLabProgress(calibrationVersion);
  if (progress.reviews.some((existing) => existing.scenarioId === review.scenarioId)) {
    return { ok: false as const, unavailable: false as const };
  }
  localState.records.set(reviewerId, {
    revision: expectedRevision + 1,
    progress: {
      schemaVersion: 3,
      calibrationVersion,
      reviews: [...progress.reviews, review],
    },
  });
  await persistLocal();
  return { ok: true as const };
}

type PostgresReviewRow = {
  scenario_id: string;
  target_field: string;
  selected_criterion_ids: unknown;
  sample_id: string | null;
  sample_disposition: NoteLabFieldReview["sampleDisposition"];
  revision_reason_ids: unknown;
  submitted_at: string;
};

function mapPostgresReview(row: PostgresReviewRow): NoteLabFieldReview {
  return {
    scenarioId: row.scenario_id,
    targetField: row.target_field as NoteLabFieldReview["targetField"],
    selectedCriterionIds: Array.isArray(row.selected_criterion_ids)
      ? row.selected_criterion_ids as NoteLabFieldReview["selectedCriterionIds"] : [],
    sampleId: row.sample_id,
    sampleDisposition: row.sample_disposition,
    revisionReasonIds: Array.isArray(row.revision_reason_ids)
      ? row.revision_reason_ids as NoteLabFieldReview["revisionReasonIds"] : [],
    submittedAt: row.submitted_at,
  };
}

async function ensureLocalLoaded() {
  if (localState.initialized) return;
  const source = await readFile(localPath(), "utf8").catch(() => null);
  if (source) {
    try {
      const parsed = JSON.parse(source) as LocalEnvelope;
      if (parsed.schemaVersion === 3 && parsed.records && typeof parsed.records === "object") {
        for (const [reviewerId, record] of Object.entries(parsed.records)) {
          if (Number.isInteger(record?.revision) && record.revision >= 0) {
            localState.records.set(reviewerId, record);
          }
        }
      }
    } catch {
      // A malformed development file is ignored; the next write replaces it atomically.
    }
  }
  localState.initialized = true;
}

async function persistLocal() {
  localState.persistQueue = localState.persistQueue.then(async () => {
    const destination = localPath();
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    const envelope: LocalEnvelope = { schemaVersion: 3, records: Object.fromEntries(localState.records) };
    await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, destination);
  });
  await localState.persistQueue;
}

function localPath() {
  if ((process.env.NODE_ENV !== "production" || localNoteLabStoreAllowed())
    && process.env.PIPELINE_NOTE_LAB_STORE_PATH) {
    return path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      process.env.PIPELINE_NOTE_LAB_STORE_PATH.trim(),
    );
  }
  return path.join(process.cwd(), ".data", "note-lab-field-reviews.json");
}

function localNoteLabStoreAllowed() {
  return process.env.PIPELINE_ALLOW_LOCAL_NOTE_LAB_STORE === "true";
}

function scenarioCatalog() {
  return globalLocal.__pipelineNoteLabScenarioCatalogV4 ??= buildNoteLabScenarioCatalog();
}

function unavailableSession(message: string): NoteLabSession {
  return {
    enabled: true,
    available: false,
    message,
    calibrationVersion: NOTE_LAB_CALIBRATION_VERSION,
    revision: 0,
    persistence: "unavailable",
    scenario: null,
    review: null,
    calibration: {
      targetDecisions: NOTE_LAB_CALIBRATION_TARGET,
      decisionsCompleted: 0,
      currentStep: 1,
      remaining: NOTE_LAB_CALIBRATION_TARGET,
      progressPercent: 0,
      complete: false,
      estimatedMinutesRemaining: 23,
      fieldSteps: [],
      trail: [],
      profile: {
        schemaVersion: 3,
        calibrationVersion: NOTE_LAB_CALIBRATION_VERSION,
        status: "collecting",
        targetDecisions: NOTE_LAB_CALIBRATION_TARGET,
        decisionsCompleted: 0,
        fieldsReviewed: 0,
        purposeTracksReviewed: 0,
        criteria: [],
        sampleOutcomes: { teach: 0, revise: 0, do_not_teach: 0 },
        revisionReasons: [],
        fieldStandards: [],
        inferredRules: [],
      },
    },
    stats: {
      decisionsCompleted: 0,
      fieldsAvailable: 0,
      criteriaAvailable: noteLabDocumentationCriteria.length,
      corpusSamplesAvailable: 0,
    },
  };
}
