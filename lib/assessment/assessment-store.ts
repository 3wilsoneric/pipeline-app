import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { TransactionSql } from "postgres";

import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import {
  resolveDurableStoreMode,
  selectStoreAdapter,
  type StoreAdapters,
} from "@/lib/persistence/store-adapter";
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  isAfterDescendingCursor,
} from "@/lib/pipeline/keyset-cursor";
import type { ReferralWorkflowStatus } from "@/lib/pipeline/referral-types";

import {
  assessmentToolFieldDefinitions,
  createEmptyAssessmentToolData,
  mapExtractedAssessmentFields,
  pickAssessmentToolData,
  validateAssessmentToolData,
  type AssessmentExtractionContext,
  type AssessmentExtractionField,
  type AssessmentFieldProvenance,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
  type UnmappedAssessmentField,
} from "./assessment-tool-schema";
import { getAssessmentCompletionSummary } from "./assessment-completion";
import {
  preserveCanonicalClientId,
  type AssessmentCompletionReport,
  type AssessmentActor,
  type AssessmentAuditAction,
  type AssessmentAuditEvent,
  type AssessmentAddendum,
  type AssessmentCreateInput,
  type AssessmentListResponse,
  type AssessmentPatchInput,
  type PipelineAssessmentRecord,
} from "./assessment-records";
import {
  assessmentSectionForField,
  defaultAssessmentSectionVersions,
  normalizeAssessmentSectionVersions,
  incrementAssessmentSectionVersions,
} from "./assessment-sections";
import type { AssessmentToolSection } from "./assessment-tool-schema";

type AssessmentStoreState = {
  initialized: boolean;
  loadPromise?: Promise<void>;
  revision: number;
  assessments: PipelineAssessmentRecord[];
  createMutations: Map<string, string>;
  importMutations: Map<string, string>;
  patchMutations: Map<string, string>;
  persistQueue: Promise<void>;
  mutationQueue: Promise<void>;
};

type AssessmentStoreFile = {
  version: 1;
  revision: number;
  assessments: PipelineAssessmentRecord[];
  create_mutations?: Record<string, string>;
  import_mutations?: Record<string, string>;
  patch_mutations?: Record<string, string>;
};

export type AssessmentPatchOptions = {
  expectedVersion?: number;
  section?: AssessmentToolSection;
  expectedSectionVersion?: number;
  mutationId?: string;
};

export type AssessmentListOptions = {
  referralId?: number;
  canonicalClientId?: string;
  residentNumber?: string;
  residentKey?: string;
  limit?: number;
  cursor?: string;
};

export type AssessmentStoreReadiness = {
  mode: "local_file" | "postgres";
  ready: boolean;
  multi_instance_safe: boolean;
  message?: string;
};

export type AssessmentMutation =
  | { ok: true; assessment: PipelineAssessmentRecord; revision: number }
  | { ok: false; conflict: true; assessment: PipelineAssessmentRecord }
  | {
      ok: false;
      blocked: true;
      assessment: PipelineAssessmentRecord;
      blockers: { code: string; label: string; fields?: AssessmentToolFieldKey[] }[];
    };

export type AssessmentAddendumMutation =
  | { ok: true; assessment: PipelineAssessmentRecord; addendum: AssessmentAddendum; revision: number }
  | { ok: false; conflict: true; assessment: PipelineAssessmentRecord }
  | { ok: false; blocked: true; assessment: PipelineAssessmentRecord; blockers: { code: string; label: string }[] };

export type AssessmentImportInput = {
  referralId: number;
  /** Server-resolved from the referral's authoritative assignment. */
  assignedAssessor?: AssessmentActor | null;
  canonicalClientId?: string | null;
  residentKey?: string | null;
  assessmentId?: string;
  expectedVersion?: number;
  fields: AssessmentExtractionField[];
  context: AssessmentExtractionContext;
  defaults: Partial<AssessmentToolData>;
  actor: AssessmentActor;
  mutationId?: string;
};

export interface AssessmentStore {
  list(options?: AssessmentListOptions): Promise<AssessmentListResponse>;
  get(assessmentId: string): Promise<PipelineAssessmentRecord | null>;
  create(input: AssessmentCreateInput, actor: AssessmentActor, mutationId?: string): Promise<AssessmentMutation>;
  patch(assessmentId: string, patch: AssessmentPatchInput, actor: AssessmentActor, options?: AssessmentPatchOptions): Promise<AssessmentMutation | null>;
  importExtraction(input: AssessmentImportInput): Promise<AssessmentMutation | null>;
  addAddendum(
    assessmentId: string,
    note: string,
    reasonCode: string,
    actor: AssessmentActor,
    expectedVersion: number,
  ): Promise<AssessmentAddendumMutation | null>;
}

const globalForAssessmentStore = globalThis as typeof globalThis & {
  __pipelineAssessmentStore?: AssessmentStoreState;
};

const state = globalForAssessmentStore.__pipelineAssessmentStore ??
  (globalForAssessmentStore.__pipelineAssessmentStore = {
    initialized: false,
    revision: 0,
    assessments: [],
    createMutations: new Map<string, string>(),
    importMutations: new Map<string, string>(),
    patchMutations: new Map<string, string>(),
    persistQueue: Promise.resolve(),
    mutationQueue: Promise.resolve(),
  });

state.createMutations ??= new Map<string, string>();
state.importMutations ??= new Map<string, string>();
state.patchMutations ??= new Map<string, string>();
state.persistQueue ??= Promise.resolve();
state.mutationQueue ??= Promise.resolve();

const maxAssessmentRows = 100_000;
const maxPageSize = 200;
const maxAuditEventsPerAssessment = 500;
const knownAssessmentFieldKeys = new Set(
  assessmentToolFieldDefinitions.map((definition) => definition.key),
);

export function getAssessmentStoreReadiness(): AssessmentStoreReadiness {
  const mode = resolveDurableStoreMode({
    configuredModes: [
      process.env.PIPELINE_ASSESSMENT_STORE_MODE,
      process.env.PIPELINE_REFERRAL_STORE_MODE,
    ],
    databaseMode: process.env.PIPELINE_DATABASE_MODE,
  });
  if (mode === "postgres") {
    const database = getPipelineDatabaseReadiness();
    return {
      mode: "postgres",
      ready: database.ready,
      multi_instance_safe: database.ready,
      message: database.message ?? "PostgreSQL assessment storage is ready.",
    };
  }

  const allowLocalForTests = process.env.PIPELINE_ALLOW_LOCAL_REFERRAL_STORE === "true";
  if (process.env.NODE_ENV === "production" && !allowLocalForTests) {
    return {
      mode: "local_file",
      ready: false,
      multi_instance_safe: false,
      message: "Production requires PIPELINE_ASSESSMENT_STORE_MODE=postgres.",
    };
  }

  return {
    mode: "local_file",
    ready: true,
    multi_instance_safe: false,
    message: "Local assessment storage is suitable for one app instance and development only.",
  };
}

export function requireAssessmentStore() {
  const readiness = getAssessmentStoreReadiness();
  if (readiness.ready) return { ok: true as const, readiness };
  return {
    ok: false as const,
    readiness,
    response: Response.json({ error: readiness.message, readiness }, { status: 503 }),
  };
}

const localAssessmentStore: AssessmentStore = {
  list: listLocalAssessments,
  get: getLocalAssessment,
  create: createLocalAssessment,
  patch: patchLocalAssessment,
  importExtraction: importLocalAssessmentExtraction,
  addAddendum: addLocalAssessmentAddendum,
};

const postgresAssessmentStore: AssessmentStore = {
  list: listPostgresAssessments,
  get: getPostgresAssessment,
  create: createPostgresAssessment,
  patch: patchPostgresAssessment,
  importExtraction: importPostgresAssessmentExtraction,
  addAddendum: addPostgresAssessmentAddendum,
};

const assessmentStoreAdapters: StoreAdapters<AssessmentStore> = {
  local_file: localAssessmentStore,
  postgres: postgresAssessmentStore,
};

function getAssessmentStore() {
  return selectStoreAdapter(getAssessmentStoreReadiness().mode, assessmentStoreAdapters);
}

export async function listAssessments(options: AssessmentListOptions = {}) {
  return getAssessmentStore().list(options);
}

export async function getAssessment(assessmentId: string) {
  return getAssessmentStore().get(assessmentId);
}

export async function createAssessment(input: AssessmentCreateInput, actor: AssessmentActor, mutationId?: string) {
  return getAssessmentStore().create(input, actor, mutationId);
}

export async function patchAssessment(
  assessmentId: string,
  patch: AssessmentPatchInput,
  actor: AssessmentActor,
  options?: AssessmentPatchOptions,
) {
  return getAssessmentStore().patch(assessmentId, patch, actor, options);
}

export async function importAssessmentExtraction(input: AssessmentImportInput) {
  return getAssessmentStore().importExtraction(input);
}

export async function addAssessmentAddendum(
  assessmentId: string,
  note: string,
  reasonCode: string,
  actor: AssessmentActor,
  expectedVersion: number,
) {
  return getAssessmentStore().addAddendum(assessmentId, note, reasonCode, actor, expectedVersion);
}

export async function getAssessmentCompletionReport(month: string): Promise<AssessmentCompletionReport> {
  const range = assessmentMonthRange(month);
  return getAssessmentStoreReadiness().mode === "postgres"
    ? getPostgresAssessmentCompletionReport(month, range)
    : getLocalAssessmentCompletionReport(month, range);
}

function storePath() {
  return process.env.PIPELINE_ASSESSMENT_STORE_PATH?.trim() || ".data/assessments.json";
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
      const parsed = JSON.parse(raw) as Partial<AssessmentStoreFile>;
      state.assessments = Array.isArray(parsed.assessments)
        ? parsed.assessments.filter(isAssessmentRecord).slice(0, maxAssessmentRows).map(normalizeAssessmentRecord)
        : [];
      state.revision = Number.isInteger(parsed.revision) ? Number(parsed.revision) : 0;
      state.createMutations = safeMutationMap(parsed.create_mutations);
      state.importMutations = safeMutationMap(parsed.import_mutations);
      state.patchMutations = safeMutationMap(parsed.patch_mutations);
    } catch (error) {
      if (!isMissingFile(error)) {
        console.warn(JSON.stringify({
          service: "pipeline-app",
          event: "assessment_store_load_failed",
        }));
      }
    }
  })();

  await state.loadPromise;
  state.loadPromise = undefined;
}

async function persist() {
  const snapshot: AssessmentStoreFile = {
    version: 1,
    revision: state.revision,
    assessments: state.assessments,
    create_mutations: Object.fromEntries(state.createMutations),
    import_mutations: Object.fromEntries(state.importMutations),
    patch_mutations: Object.fromEntries(state.patchMutations),
  };
  const path = storePath();
  const temporaryPath = `${path}.${process.pid}.tmp`;

  state.persistQueue = state.persistQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(/* turbopackIgnore: true */ dirname(path), { recursive: true });
      await writeFile(/* turbopackIgnore: true */ temporaryPath, JSON.stringify(snapshot), "utf8");
      await rename(/* turbopackIgnore: true */ temporaryPath, path);
    });
  await state.persistQueue;
}

async function withMutation<T>(work: () => Promise<T>): Promise<T> {
  const previous = state.mutationQueue;
  let release: () => void = () => {};
  state.mutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
  }
}

async function listLocalAssessments(options: AssessmentListOptions = {}): Promise<AssessmentListResponse> {
  await ensureLoaded();
  const residentNumber = normalize(options.residentNumber ?? "");
  const residentKey = options.residentKey?.trim() ?? "";
  const canonicalClientId = options.canonicalClientId?.trim() ?? "";
  const matching = state.assessments
    .filter((assessment) => options.referralId === undefined || assessment.referral_id === options.referralId)
    .filter((assessment) => !canonicalClientId || assessment.canonical_client_id === canonicalClientId)
    .filter((assessment) => !residentNumber || normalize(assessment.resident_number ?? "") === residentNumber)
    .filter((assessment) => !residentKey || assessment.resident_key === residentKey)
    .sort(compareAssessments);
  const cursor = decodeKeysetCursor(options.cursor);
  const limit = clampPageSize(options.limit);
  const afterCursor = matching.filter((assessment) =>
    isAfterDescendingCursor(assessment.updated_at, assessment.assessment_id, cursor),
  );
  const assessments = afterCursor.slice(0, limit);
  const last = assessments.at(-1);
  const readiness = getAssessmentStoreReadiness();

  return {
    assessments,
    total: matching.length,
    revision: state.revision,
    next_cursor: afterCursor.length > limit && last
      ? encodeKeysetCursor({ timestamp: last.updated_at, key: last.assessment_id })
      : null,
    generated_at: new Date().toISOString(),
    store: {
      mode: readiness.mode,
      multi_instance_safe: readiness.multi_instance_safe,
    },
  };
}

async function getLocalAssessmentCompletionReport(
  month: string,
  range: { start: string; end: string },
): Promise<AssessmentCompletionReport> {
  await ensureLoaded();
  const grouped = new Map<string, AssessmentCompletionReport["rows"][number] & {
    duration_total: number;
    duration_count: number;
  }>();
  for (const assessment of state.assessments) {
    const signedAt = assessment.signed_at;
    if (!signedAt || signedAt < range.start || signedAt >= range.end) continue;
    const assessorName = assessment.signed_by?.name.trim() || assessment.assessor?.trim() || "Unassigned";
    const assessorId = assessment.signed_by?.id.trim() || assessment.assessor_id?.trim() || null;
    const key = assessorId || `legacy:${normalize(assessorName)}`;
    const current = grouped.get(key) ?? {
      assessor_id: assessorId,
      assessor_name: assessorName,
      completed_assessments: 0,
      average_duration_minutes: null,
      duration_total: 0,
      duration_count: 0,
    };
    current.completed_assessments += 1;
    const duration = elapsedMinutes(assessment.started_at, signedAt);
    if (duration !== null) {
      current.duration_total += duration;
      current.duration_count += 1;
      current.average_duration_minutes = Math.round(current.duration_total / current.duration_count);
    }
    grouped.set(key, current);
  }
  return assessmentCompletionReport(month, range, [...grouped.values()].map((row) => ({
    assessor_id: row.assessor_id,
    assessor_name: row.assessor_name,
    completed_assessments: row.completed_assessments,
    average_duration_minutes: row.average_duration_minutes,
  })));
}

async function getLocalAssessment(assessmentId: string) {
  await ensureLoaded();
  return state.assessments.find((assessment) => assessment.assessment_id === assessmentId) ?? null;
}

async function createLocalAssessment(
  input: AssessmentCreateInput,
  actor: AssessmentActor,
  mutationId?: string,
): Promise<AssessmentMutation> {
  await ensureLoaded();
  return withMutation(async () => {
    const existingId = mutationId ? state.createMutations.get(mutationId) : undefined;
    const existing = existingId
      ? state.assessments.find((assessment) => assessment.assessment_id === existingId)
      : undefined;
    if (existing) return { ok: true, assessment: existing, revision: state.revision };
    if (state.assessments.length >= maxAssessmentRows) throw new Error("Assessment capacity reached.");

    const data = pickAssessmentToolData(input.data);
    const issues = validateAssessmentToolData(data);
    if (issues.length > 0) throw new Error(issues[0].message);
    const status = input.status ?? "draft";
    const now = new Date().toISOString();
    const assessmentId = `asm_${randomUUID()}`;
    const assessment: PipelineAssessmentRecord = {
      ...data,
      assessment_id: assessmentId,
      referral_id: input.referral_id,
      assessor_id: input.assigned_assessor?.id ?? null,
      canonical_client_id: input.canonical_client_id?.trim() || null,
      resident_key: input.resident_key?.trim() || null,
      status,
      completed_at: status === "complete" ? now : null,
      schedule_status: "unscheduled",
      started_at: null,
      signed_at: null,
      signed_by: null,
      signature_version: 1,
      addenda: [],
      version: 1,
      section_versions: defaultAssessmentSectionVersions(),
      created_at: now,
      updated_at: now,
      created_by: actor,
      updated_by: actor,
      field_provenance: input.field_provenance ?? {},
      unmapped_fields: input.unmapped_fields ?? [],
      audit_events: [createAuditEvent(assessmentId, input.referral_id, "assessment_created", actor, [])],
    };
    const blockers = completionBlockers(assessment);
    if (status === "complete" && blockers.length > 0) {
      return { ok: false, blocked: true, assessment, blockers };
    }

    state.assessments = [assessment, ...state.assessments];
    state.revision += 1;
    if (mutationId) state.createMutations.set(mutationId, assessmentId);
    await persist();
    await syncLocalReferralWorkflow(assessment, actor, "assessment_created");
    return { ok: true, assessment, revision: state.revision };
  });
}

async function patchLocalAssessment(
  assessmentId: string,
  patch: AssessmentPatchInput,
  actor: AssessmentActor,
  options: AssessmentPatchOptions = {},
): Promise<AssessmentMutation | null> {
  await ensureLoaded();
  return withMutation(async () => {
    const index = state.assessments.findIndex((assessment) => assessment.assessment_id === assessmentId);
    if (index < 0) return null;
    const current = state.assessments[index];
    if (options.mutationId && state.patchMutations.get(options.mutationId) === assessmentId) {
      return { ok: true, assessment: current, revision: state.revision };
    }
    const sectionVersions = normalizeAssessmentSectionVersions(current.section_versions);
    if (options.section && options.expectedSectionVersion !== sectionVersions[options.section]) {
      return { ok: false, conflict: true, assessment: current };
    }
    if (!options.section && options.expectedVersion !== undefined && options.expectedVersion !== current.version) {
      return { ok: false, conflict: true, assessment: current };
    }
    assertPatchMatchesSection(patch, options.section);
    const prepared = prepareAssessmentPatch(current, patch, actor);
    const candidate = prepared.candidate;
    const blockers = completionBlockers(candidate);
    if (candidate.status === "complete" && blockers.length > 0) {
      return { ok: false, blocked: true, assessment: current, blockers };
    }
    candidate.audit_events = appendAuditEvent(
      current.audit_events,
      createAuditEvent(assessmentId, current.referral_id, prepared.action, actor, prepared.changedFields),
    );
    state.assessments[index] = candidate;
    state.revision += 1;
    if (options.mutationId) state.patchMutations.set(options.mutationId, assessmentId);
    await persist();
    await syncLocalReferralWorkflow(candidate, actor, prepared.action);
    return { ok: true, assessment: candidate, revision: state.revision };
  });
}

async function importLocalAssessmentExtraction(input: AssessmentImportInput): Promise<AssessmentMutation | null> {
  await ensureLoaded();
  return withMutation(async () => {
    const existingMutationId = input.mutationId ? state.importMutations.get(input.mutationId) : undefined;
    const existingMutation = existingMutationId
      ? state.assessments.find((assessment) => assessment.assessment_id === existingMutationId)
      : undefined;
    if (existingMutation) return { ok: true, assessment: existingMutation, revision: state.revision };

    const currentIndex = input.assessmentId
      ? state.assessments.findIndex((assessment) => assessment.assessment_id === input.assessmentId)
      : -1;
    const current = currentIndex >= 0 ? state.assessments[currentIndex] : null;
    if (input.assessmentId && !current) return null;
    if (current && current.referral_id !== input.referralId) return null;
    if (current && input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      return { ok: false, conflict: true, assessment: current };
    }
    if (current?.signed_at) throw new Error("This assessment is signed. Import into a new assessment instead.");

    const prepared = prepareAssessmentImport(input, current);
    const assessment = prepared.assessment;

    if (currentIndex >= 0) state.assessments[currentIndex] = assessment;
    else state.assessments = [assessment, ...state.assessments];
    state.revision += 1;
    if (input.mutationId) state.importMutations.set(input.mutationId, assessment.assessment_id);
    await persist();
    await syncLocalReferralWorkflow(assessment, input.actor, "assessment_imported");
    return { ok: true, assessment, revision: state.revision };
  });
}

async function addLocalAssessmentAddendum(
  assessmentId: string,
  note: string,
  reasonCode: string,
  actor: AssessmentActor,
  expectedVersion: number,
): Promise<AssessmentAddendumMutation | null> {
  await ensureLoaded();
  return withMutation(async () => {
    const index = state.assessments.findIndex((assessment) => assessment.assessment_id === assessmentId);
    if (index < 0) return null;
    const current = state.assessments[index];
    if (current.version !== expectedVersion) return { ok: false, conflict: true, assessment: current };
    if (!current.signed_at) {
      return {
        ok: false,
        blocked: true,
        assessment: current,
        blockers: [{ code: "assessment_signature_required", label: "Sign the assessment before adding an addendum." }],
      };
    }
    const now = new Date().toISOString();
    const addendum: AssessmentAddendum = {
      addendum_id: randomUUID(),
      assessment_id: assessmentId,
      version: 1,
      note,
      reason_code: reasonCode,
      authored_by: actor.id,
      authored_by_name: actor.name,
      created_at: now,
    };
    const assessment = normalizeAssessmentRecord({
      ...current,
      version: current.version + 1,
      updated_at: now,
      updated_by: actor,
      addenda: [...(current.addenda ?? []), addendum],
      audit_events: appendAuditEvent(
        current.audit_events,
        createAuditEvent(assessmentId, current.referral_id, "assessment_addendum_added", actor, []),
      ),
    });
    state.assessments[index] = assessment;
    state.revision += 1;
    await persist();
    return { ok: true, assessment, addendum, revision: state.revision };
  });
}

type AssessmentRow = {
  assessment_id: string;
  referral_id: number | string;
  canonical_client_id: string | null;
  resident_key: string | null;
  resident_number: string | null;
  assessment_date: Date | string | null;
  assessor_id: string | null;
  assessor_name: string | null;
  status: PipelineAssessmentRecord["status"];
  data: unknown;
  version: number;
  section_versions: unknown;
  completed_at: Date | string | null;
  scheduled_start_at: Date | string | null;
  scheduled_duration_minutes: number | string | null;
  scheduled_method: PipelineAssessmentRecord["scheduled_method"];
  scheduled_location: string | null;
  schedule_status: PipelineAssessmentRecord["schedule_status"];
  started_at: Date | string | null;
  signed_at: Date | string | null;
  signed_by: string | null;
  signed_by_name: string | null;
  signature_version: number | string;
  created_by: string;
  created_by_name: string;
  updated_by: string;
  updated_by_name: string;
  created_at: Date | string;
  updated_at: Date | string;
  total_count?: number | string;
};

type AssessmentProvenanceRow = {
  assessment_id: string;
  field_key: string;
  source_field_key: string;
  source_file: string | null;
  source_page: number | null;
  confidence: number | string | null;
  evidence_blob_key: string | null;
  review_status: AssessmentFieldProvenance["review_status"];
};

type AssessmentUnmappedRow = {
  assessment_id: string;
  source_field_key: string;
  source_value: unknown;
  reason: string;
  source_file: string | null;
  source_page: number | null;
  confidence: number | string | null;
  evidence_blob_key: string | null;
  review_status: AssessmentFieldProvenance["review_status"];
};

type AssessmentAuditRow = {
  audit_event_id: string;
  entity_id: string;
  action: AssessmentAuditAction;
  actor_id: string;
  actor_name: string;
  changed_fields: string[];
  created_at: Date | string;
};

type AssessmentAddendumRow = {
  addendum_id: string;
  assessment_id: string;
  version: number | string;
  note: string;
  reason_code: string;
  authored_by: string;
  authored_by_name: string;
  created_at: Date | string;
};

type AssessmentRelations = {
  provenance: AssessmentProvenanceRow[];
  unmapped: AssessmentUnmappedRow[];
  audits: AssessmentAuditRow[];
  addenda: AssessmentAddendumRow[];
};

type IndexedAssessmentRelations = {
  provenance: Map<string, AssessmentProvenanceRow[]>;
  unmapped: Map<string, AssessmentUnmappedRow[]>;
  audits: Map<string, AssessmentAuditRow[]>;
  addenda: Map<string, AssessmentAddendumRow[]>;
};

async function listPostgresAssessments(options: AssessmentListOptions = {}): Promise<AssessmentListResponse> {
  const sql = getPipelineSql();
  const cursor = decodeKeysetCursor(options.cursor);
  const limit = clampPageSize(options.limit);
  const queryLimit = limit + 1;
  const cursorTimestamp = cursor?.timestamp ?? null;
  const cursorKey = cursor?.key ?? null;
  const residentNumber = options.residentNumber?.trim() || null;
  const residentKey = options.residentKey?.trim() || null;
  const canonicalClientId = options.canonicalClientId?.trim() || null;
  const referralId = options.referralId ?? null;
  const rows = await sql<AssessmentRow[]>`
    with filtered as (
      select a.*, count(*) over() as total_count
      from pipeline.assessments a
      where (${referralId}::bigint is null or a.referral_id = ${referralId})
        and (${canonicalClientId}::text is null or a.canonical_client_id = ${canonicalClientId})
        and (${residentNumber}::text is null or a.resident_number = ${residentNumber})
        and (${residentKey}::text is null or a.resident_key = ${residentKey})
    )
    select * from filtered
    where (${cursorTimestamp}::timestamptz is null
      or (updated_at, assessment_id) < (${cursorTimestamp}::timestamptz, ${cursorKey}::text))
    order by updated_at desc, assessment_id desc
    limit ${queryLimit}
  `;
  const pageRows = rows.slice(0, limit);
  const relations = await loadPostgresAssessmentRelations(pageRows.map((row) => row.assessment_id));
  const total = Number(rows[0]?.total_count ?? 0);
  const last = pageRows.at(-1);
  return {
    assessments: hydrateAssessmentRows(pageRows, relations),
    total,
    revision: await getPostgresAssessmentRevision(),
    next_cursor: rows.length > limit && last
      ? encodeKeysetCursor({ timestamp: isoTimestamp(last.updated_at), key: last.assessment_id })
      : null,
    generated_at: new Date().toISOString(),
    store: { mode: "postgres", multi_instance_safe: true },
  };
}

type AssessmentCompletionCountRow = {
  assessor_id: string | null;
  assessor_name: string | null;
  completed_assessments: number | string;
  average_duration_minutes: number | string | null;
};

async function getPostgresAssessmentCompletionReport(
  month: string,
  range: { start: string; end: string },
): Promise<AssessmentCompletionReport> {
  const sql = getPipelineSql();
  const rows = await sql<AssessmentCompletionCountRow[]>`
    select signed_by as assessor_id,
      coalesce(nullif(btrim(signed_by_name), ''), nullif(btrim(assessor_name), ''), 'Unassigned') as assessor_name,
      count(*)::integer as completed_assessments,
      round(avg(extract(epoch from (signed_at - started_at)) / 60.0))::integer as average_duration_minutes
    from pipeline.assessments
    where signed_at >= ${range.start}::timestamptz
      and signed_at < ${range.end}::timestamptz
    group by signed_by, coalesce(nullif(btrim(signed_by_name), ''), nullif(btrim(assessor_name), ''), 'Unassigned')
    order by count(*) desc, lower(coalesce(nullif(btrim(signed_by_name), ''), nullif(btrim(assessor_name), ''), 'Unassigned')), signed_by nulls last
  `;
  return assessmentCompletionReport(month, range, rows.map((row) => ({
    assessor_id: row.assessor_id,
    assessor_name: row.assessor_name?.trim() || "Unassigned",
    completed_assessments: Number(row.completed_assessments),
    average_duration_minutes: row.average_duration_minutes === null ? null : Number(row.average_duration_minutes),
  })));
}

async function getPostgresAssessment(assessmentId: string) {
  const sql = getPipelineSql();
  const rows = await sql<AssessmentRow[]>`
    select * from pipeline.assessments where assessment_id = ${assessmentId} limit 1
  `;
  if (!rows[0]) return null;
  const relations = await loadPostgresAssessmentRelations([assessmentId]);
  return hydrateAssessmentRows(rows, relations)[0] ?? null;
}

async function loadPostgresAssessmentRelations(assessmentIds: string[]): Promise<AssessmentRelations> {
  if (assessmentIds.length === 0) return { provenance: [], unmapped: [], audits: [], addenda: [] };
  const sql = getPipelineSql();
  const [provenance, unmapped, audits, addenda] = await Promise.all([
    sql<AssessmentProvenanceRow[]>`
      select assessment_id, field_key, source_field_key, source_file, source_page,
        confidence, evidence_blob_key, review_status
      from pipeline.assessment_field_provenance
      where assessment_id = any(${assessmentIds}::text[])
      order by created_at, provenance_id
    `,
    sql<AssessmentUnmappedRow[]>`
      select assessment_id, source_field_key, source_value, reason, source_file,
        source_page, confidence, evidence_blob_key, review_status
      from pipeline.assessment_unmapped_fields
      where assessment_id = any(${assessmentIds}::text[])
      order by created_at, unmapped_field_id
    `,
    sql<AssessmentAuditRow[]>`
      select audit_event_id, entity_id, action, actor_id, actor_name, changed_fields, created_at
      from pipeline.audit_events
      where entity_type = 'assessment' and entity_id = any(${assessmentIds}::text[])
      order by created_at, audit_event_id
    `,
    sql<AssessmentAddendumRow[]>`
      select addendum_id, assessment_id, version, note, reason_code,
        authored_by, authored_by_name, created_at
      from pipeline.assessment_addenda
      where assessment_id = any(${assessmentIds}::text[])
      order by created_at, addendum_id
    `,
  ]);
  return { provenance, unmapped, audits, addenda };
}

async function createPostgresAssessment(
  input: AssessmentCreateInput,
  actor: AssessmentActor,
  mutationId?: string,
): Promise<AssessmentMutation> {
  const data = pickAssessmentToolData(input.data);
  const issues = validateAssessmentToolData(data);
  if (issues.length > 0) throw new Error(issues[0].message);
  const status = input.status ?? "draft";
  const now = new Date().toISOString();
  const assessmentId = `asm_${randomUUID()}`;
  const assessment: PipelineAssessmentRecord = {
    ...data,
    assessment_id: assessmentId,
    referral_id: input.referral_id,
    assessor_id: input.assigned_assessor?.id ?? null,
    canonical_client_id: input.canonical_client_id?.trim() || null,
    resident_key: input.resident_key?.trim() || null,
    status,
    completed_at: status === "complete" ? now : null,
    schedule_status: "unscheduled",
    started_at: null,
    signed_at: null,
    signed_by: null,
    signature_version: 1,
    addenda: [],
    version: 1,
    section_versions: defaultAssessmentSectionVersions(),
    created_at: now,
    updated_at: now,
    created_by: actor,
    updated_by: actor,
    field_provenance: input.field_provenance ?? {},
    unmapped_fields: input.unmapped_fields ?? [],
    audit_events: [],
  };
  const blockers = completionBlockers(assessment);
  if (status === "complete" && blockers.length > 0) {
    return { ok: false, blocked: true, assessment, blockers };
  }

  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    if (mutationId) {
      await lockIdempotencyMutation(tx, "assessment_create", mutationId);
      const existing = await findIdempotentAssessment(tx, "assessment_create", mutationId);
      if (existing) return { ok: true, assessment: existing, revision: await getAssessmentRevisionInTransaction(tx) };
    }
    await insertAssessmentRow(tx, assessment);
    await insertAssessmentProvenance(tx, assessmentId, assessment.field_provenance);
    await insertAssessmentUnmapped(tx, assessmentId, assessment.unmapped_fields);
    await writeAssessmentAudit(tx, assessment, "assessment_created", actor, []);
    await syncPostgresReferralWorkflow(tx, assessment, actor, "assessment_created");
    if (mutationId) await saveAssessmentIdempotency(tx, "assessment_create", mutationId, assessmentId);
    const saved = await getAssessmentInTransaction(tx, assessmentId);
    if (!saved) throw new Error("The assessment could not be read after creation.");
    return { ok: true, assessment: saved, revision: await bumpAssessmentRevision(tx) };
  });
}

async function patchPostgresAssessment(
  assessmentId: string,
  patch: AssessmentPatchInput,
  actor: AssessmentActor,
  options: AssessmentPatchOptions = {},
): Promise<AssessmentMutation | null> {
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    if (options.mutationId) {
      await lockIdempotencyMutation(tx, "assessment_patch", options.mutationId);
      const existing = await findIdempotentAssessment(tx, "assessment_patch", options.mutationId);
      if (existing) return { ok: true, assessment: existing, revision: await getAssessmentRevisionInTransaction(tx) };
    }
    const current = await getAssessmentInTransaction(tx, assessmentId, true);
    if (!current) return null;
    const sectionVersions = normalizeAssessmentSectionVersions(current.section_versions);
    if (options.section && options.expectedSectionVersion !== sectionVersions[options.section]) {
      return { ok: false, conflict: true, assessment: current };
    }
    if (!options.section && options.expectedVersion !== undefined && options.expectedVersion !== current.version) {
      return { ok: false, conflict: true, assessment: current };
    }
    assertPatchMatchesSection(patch, options.section);
    const prepared = prepareAssessmentPatch(current, patch, actor);
    if (prepared.completesAssessment) {
      const referralRows = await tx<{ referral_id: number | string }[]>`
        select referral_id from pipeline.referrals
        where referral_id = ${current.referral_id} and deleted_at is null
        for update
      `;
      if (!referralRows[0]) throw new Error("The assessment referral no longer exists.");
    }
    const candidate = prepared.candidate;
    const blockers = completionBlockers(candidate);
    if (candidate.status === "complete" && blockers.length > 0) {
      return { ok: false, blocked: true, assessment: current, blockers };
    }
    const updated = await updateAssessmentRow(tx, candidate, current.version);
    if (!updated) {
      const latest = await getAssessmentInTransaction(tx, assessmentId);
      return latest ? { ok: false, conflict: true, assessment: latest } : null;
    }
    await insertAssessmentProvenance(tx, assessmentId, candidate.field_provenance, current.field_provenance);
    await writeAssessmentAudit(tx, candidate, prepared.action, actor, prepared.changedFields);
    await syncPostgresReferralWorkflow(tx, candidate, actor, prepared.action);
    if (options.mutationId) {
      await saveAssessmentIdempotency(tx, "assessment_patch", options.mutationId, assessmentId);
    }
    const saved = await getAssessmentInTransaction(tx, assessmentId);
    if (!saved) throw new Error("The assessment could not be read after update.");
    return { ok: true, assessment: saved, revision: await bumpAssessmentRevision(tx) };
  });
}

function assertPatchMatchesSection(
  patch: AssessmentPatchInput,
  section: AssessmentToolSection | undefined,
) {
  if (!section || !patch.data) return;
  const mismatched = Object.keys(patch.data)
    .filter((field): field is AssessmentToolFieldKey => assessmentToolFieldDefinitions.some((definition) => definition.key === field))
    .filter((field) => assessmentSectionForField(field) !== section);
  if (mismatched.length > 0) {
    throw new Error(`Assessment section patch contains fields outside ${section}.`);
  }
}

function prepareAssessmentPatch(
  current: PipelineAssessmentRecord,
  patch: AssessmentPatchInput,
  actor: AssessmentActor,
) {
  if (current.signed_at && (
    patch.data !== undefined
    || patch.status !== undefined
    || patch.assigned_assessor !== undefined
    || patch.schedule !== undefined
    || patch.mark_started
    || patch.signer
  )) {
    throw new Error("This assessment is signed. Record later clinical information as an addendum.");
  }
  if (patch.assigned_assessor !== undefined && current.status === "complete") {
    throw new Error("Reopen the completed assessment before changing its assigned assessor.");
  }
  if (patch.mark_started && current.status === "complete") {
    throw new Error("A completed assessment cannot be started again.");
  }
  if (patch.signer && !current.started_at && current.status !== "complete") {
    throw new Error("Begin the assessment before signing it.");
  }

  const currentData = pickAssessmentToolData(current);
  const nextData = pickAssessmentToolData({ ...currentData, ...(patch.data ?? {}) });
  if (patch.assigned_assessor !== undefined) {
    nextData.assessor = patch.assigned_assessor?.name ?? null;
  }
  const issues = validateAssessmentToolData(nextData);
  if (issues.length > 0) throw new Error(issues[0].message);

  const changedFields = assessmentToolFieldDefinitions
    .filter((definition) => !sameValue(currentData[definition.key], nextData[definition.key]))
    .map((definition) => definition.key);
  const fieldProvenance = cloneProvenance(current.field_provenance);
  for (const key of changedFields) appendManualProvenance(fieldProvenance, key);
  const acceptedFields = patch.accept_pending
    ? acceptPendingProvenance(fieldProvenance)
    : [];
  const nextStatus = patch.signer ? "complete" : patch.status ?? (
    patch.accept_pending && current.status === "needs_review" ? "draft" : current.status
  );
  const now = new Date().toISOString();
  const schedule = patch.schedule;
  const candidate: PipelineAssessmentRecord = {
    ...current,
    ...nextData,
    assessor_id: patch.assigned_assessor === undefined
      ? current.assessor_id
      : patch.assigned_assessor?.id ?? null,
    canonical_client_id: preserveCanonicalClientId(current.canonical_client_id, patch.canonical_client_id),
    resident_key: patch.resident_key === undefined
      ? current.resident_key
      : patch.resident_key?.trim() || null,
    status: nextStatus,
    completed_at: nextStatus === "complete" ? current.completed_at ?? now : null,
    scheduled_start_at: schedule === undefined ? current.scheduled_start_at ?? null : schedule.start_at,
    scheduled_duration_minutes: schedule === undefined
      ? current.scheduled_duration_minutes ?? null
      : schedule.duration_minutes,
    scheduled_method: schedule === undefined ? current.scheduled_method ?? null : schedule.method,
    scheduled_location: schedule === undefined ? current.scheduled_location ?? null : schedule.location,
    schedule_status: patch.signer
      ? "completed"
      : schedule?.status ?? current.schedule_status ?? "unscheduled",
    started_at: patch.mark_started
      ? current.started_at ?? now
      : current.started_at ?? null,
    signed_at: patch.signer ? now : current.signed_at ?? null,
    signed_by: patch.signer ?? current.signed_by ?? null,
    signature_version: current.signature_version ?? 1,
    version: current.version + 1,
    section_versions: incrementAssessmentSectionVersions(current.section_versions, [
      ...assessmentSectionsForFields(changedFields),
      ...assessmentSectionsForFields(acceptedFields),
    ]),
    updated_at: now,
    updated_by: actor,
    field_provenance: fieldProvenance,
    audit_events: current.audit_events,
  };
  return {
    candidate,
    completesAssessment: nextStatus === "complete" && current.status !== "complete",
    changedFields: Array.from(new Set([...changedFields, ...acceptedFields])),
    action: assessmentPatchAuditAction(current, patch, nextStatus, acceptedFields.length),
  };
}

function prepareAssessmentImport(
  input: AssessmentImportInput,
  current: PipelineAssessmentRecord | null,
) {
  const mapping = mapExtractedAssessmentFields(input.fields, input.context);
  const baseData = current
    ? pickAssessmentToolData(current)
    : pickAssessmentToolData({ ...createEmptyAssessmentToolData(), ...input.defaults });
  const merged = mergeImportedData(
    baseData,
    mapping.data,
    mapping.field_provenance,
    mapping.unmapped_fields,
  );
  merged.data.assessor = current?.assessor ?? input.assignedAssessor?.name ?? input.defaults.assessor ?? null;
  const issues = validateAssessmentToolData(merged.data);
  if (issues.length > 0) throw new Error(issues[0].message);

  const now = new Date().toISOString();
  const assessmentId = current?.assessment_id ?? `asm_${randomUUID()}`;
  const changedFields = assessmentToolFieldDefinitions
    .filter((definition) => !sameValue(baseData[definition.key], merged.data[definition.key]))
    .map((definition) => definition.key);
  const event = createAuditEvent(
    assessmentId,
    input.referralId,
    "assessment_imported",
    input.actor,
    changedFields,
  );
  const assessment: PipelineAssessmentRecord = {
    ...(current ?? {} as PipelineAssessmentRecord),
    ...merged.data,
    assessment_id: assessmentId,
    referral_id: input.referralId,
    assessor_id: current?.assessor_id ?? input.assignedAssessor?.id ?? null,
    canonical_client_id: preserveCanonicalClientId(
      current?.canonical_client_id,
      input.canonicalClientId,
    ),
    resident_key: current?.resident_key ?? (input.residentKey?.trim() || null),
    status: "needs_review",
    completed_at: null,
    schedule_status: current?.schedule_status ?? "unscheduled",
    started_at: current?.started_at ?? null,
    signed_at: current?.signed_at ?? null,
    signed_by: current?.signed_by ?? null,
    signature_version: current?.signature_version ?? 1,
    addenda: current?.addenda ?? [],
    version: current ? current.version + 1 : 1,
    section_versions: incrementAssessmentSectionVersions(
      current?.section_versions ?? defaultAssessmentSectionVersions(),
      assessmentSectionsForFields(changedFields),
    ),
    created_at: current?.created_at ?? now,
    updated_at: now,
    created_by: current?.created_by ?? input.actor,
    updated_by: input.actor,
    field_provenance: mergeProvenance(
      current?.field_provenance ?? {},
      merged.fieldProvenance,
    ),
    unmapped_fields: [
      ...(current?.unmapped_fields ?? []),
      ...merged.unmappedFields,
    ].slice(-1_000),
    audit_events: appendAuditEvent(current?.audit_events ?? [], event),
  };
  return {
    assessment,
    changedFields,
    newUnmappedFields: merged.unmappedFields,
  };
}

function appendManualProvenance(
  provenance: PipelineAssessmentRecord["field_provenance"],
  key: AssessmentToolFieldKey,
) {
  appendProvenance(provenance, key, {
    source_field_key: `manual.${key}`,
    source_file: null,
    confidence: 1,
    review_status: "edited",
    source_page_no: null,
    evidence_url: null,
  });
}

function acceptPendingProvenance(
  provenance: PipelineAssessmentRecord["field_provenance"],
) {
  const accepted: AssessmentToolFieldKey[] = [];
  for (const definition of assessmentToolFieldDefinitions) {
    const latest = provenance[definition.key]?.at(-1);
    if (latest?.review_status !== "pending") continue;
    appendProvenance(provenance, definition.key, { ...latest, review_status: "accepted" });
    accepted.push(definition.key);
  }
  return accepted;
}

function assessmentSectionsForFields(fields: AssessmentToolFieldKey[]) {
  return fields
    .map(assessmentSectionForField)
    .filter((section): section is AssessmentToolSection => Boolean(section));
}

function assessmentPatchAuditAction(
  current: PipelineAssessmentRecord,
  patch: AssessmentPatchInput,
  nextStatus: PipelineAssessmentRecord["status"],
  acceptedFieldCount: number,
): AssessmentAuditAction {
  if (patch.signer) return "assessment_signed";
  if (patch.mark_started) return "assessment_started";
  if (patch.schedule?.status === "cancelled") return "assessment_cancelled";
  if (patch.schedule?.status === "no_show") return "assessment_no_show";
  if (patch.schedule?.status === "rescheduled") return "assessment_rescheduled";
  if (patch.schedule) return "assessment_scheduled";
  if (nextStatus !== "complete" && current.status === "complete") return "assessment_reopened";
  if (nextStatus === "complete" && current.status !== "complete") return "assessment_completed";
  if (acceptedFieldCount > 0) return "extraction_confirmed";
  if (patch.assigned_assessor !== undefined) return "assessment_assigned";
  return "assessment_updated";
}

async function loadLocalAssessmentReferral(referralId: number) {
  const { getReferral } = await import("@/lib/pipeline/referral-store");
  return getReferral(referralId);
}

async function syncLocalReferralWorkflow(
  assessment: PipelineAssessmentRecord,
  actor: AssessmentActor,
  action: AssessmentAuditAction,
) {
  if (action === "assessment_assigned") return;
  const referral = await loadLocalAssessmentReferral(assessment.referral_id);
  if (!referral) throw new Error("The assessment referral no longer exists.");
  const { patchReferral } = await import("@/lib/pipeline/referral-store");
  const workflowStatus = workflowStatusAfterAssessment(assessment, action);
  if (referral.workflowStatus === workflowStatus) return;
  const result = await patchReferral(
    referral.id,
    { workflowStatus },
    referral.version,
    actor,
    { workflow: referral.sectionVersions?.workflow ?? 1 },
    { auditAction: action, auditReason: "Assessment lifecycle synchronized." },
  );
  if (!result?.ok) {
    throw new Error("The assessment was saved, but the referral workflow could not be updated.");
  }
}

async function syncPostgresReferralWorkflow(
  tx: TransactionSql,
  assessment: PipelineAssessmentRecord,
  actor: AssessmentActor,
  action: AssessmentAuditAction,
) {
  const workflowStatus = workflowStatusAfterAssessment(assessment, action);
  const rows = await tx<{ version: number; workflow_status: string }[]>`
    update pipeline.referrals
    set workflow_status = ${workflowStatus},
        version = version + 1,
        section_versions = jsonb_set(
          section_versions,
          '{workflow}',
          to_jsonb(coalesce((section_versions->>'workflow')::integer, 1) + 1)
        ),
        updated_by = ${actor.id},
        updated_by_name = ${actor.name},
        updated_at = now()
    where referral_id = ${assessment.referral_id}
      and workflow_status not in ('accepted', 'declined', 'closed')
      and workflow_status is distinct from ${workflowStatus}
    returning version, workflow_status
  `;
  if (!rows[0]) return;

  await tx`
    insert into pipeline.audit_events (
      entity_type, entity_id, action, actor_id, actor_name,
      from_version, to_version, changed_fields, metadata
    ) values (
      'referral', ${String(assessment.referral_id)}, ${action}, ${actor.id}, ${actor.name},
      ${rows[0].version - 1}, ${rows[0].version}, ${["workflowStatus"]},
      ${tx.json({ workflow_status: workflowStatus })}
    )
  `;
  await tx`
    update pipeline.store_revisions
    set revision = revision + 1, updated_at = now()
    where store_name in ('referrals', 'workflow')
  `;
}

function workflowStatusAfterAssessment(
  assessment: PipelineAssessmentRecord,
  action: AssessmentAuditAction,
): ReferralWorkflowStatus {
  if (assessment.signed_at) return "assessment_signed";
  if (action === "assessment_cancelled" || action === "assessment_no_show") return "ready_to_schedule";
  // Completed legacy records predate explicit start/sign events. Keep their
  // clinical content ready for review without inventing either timestamp.
  if (assessment.status === "complete") return "assessment_ready_to_sign";
  if (!assessment.started_at) {
    if (assessment.schedule_status === "scheduled" || assessment.schedule_status === "rescheduled") {
      return "assessment_scheduled";
    }
    return "ready_to_schedule";
  }
  if (completionBlockers(assessment).length === 0) return "assessment_ready_to_sign";
  return "assessment_in_progress";
}

async function importPostgresAssessmentExtraction(input: AssessmentImportInput): Promise<AssessmentMutation | null> {
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    if (input.mutationId) {
      await lockIdempotencyMutation(tx, "assessment_import", input.mutationId);
      const existing = await findIdempotentAssessment(tx, "assessment_import", input.mutationId);
      if (existing) return { ok: true, assessment: existing, revision: await getAssessmentRevisionInTransaction(tx) };
    }
    const current = input.assessmentId
      ? await getAssessmentInTransaction(tx, input.assessmentId, true)
      : null;
    if (input.assessmentId && !current) return null;
    if (current && current.referral_id !== input.referralId) return null;
    if (current && input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      return { ok: false, conflict: true, assessment: current };
    }
    if (current?.signed_at) throw new Error("This assessment is signed. Import into a new assessment instead.");

    const prepared = prepareAssessmentImport(input, current);
    const assessment = prepared.assessment;
    const assessmentId = assessment.assessment_id;

    if (current) {
      const updated = await updateAssessmentRow(tx, assessment, current.version);
      if (!updated) {
        const latest = await getAssessmentInTransaction(tx, assessmentId);
        return latest ? { ok: false, conflict: true, assessment: latest } : null;
      }
    } else {
      await insertAssessmentRow(tx, assessment);
    }
    await insertAssessmentProvenance(tx, assessmentId, assessment.field_provenance, current?.field_provenance);
    await insertAssessmentUnmapped(tx, assessmentId, prepared.newUnmappedFields);
    await writeAssessmentAudit(tx, assessment, "assessment_imported", input.actor, prepared.changedFields);
    await syncPostgresReferralWorkflow(tx, assessment, input.actor, "assessment_imported");
    if (input.mutationId) await saveAssessmentIdempotency(tx, "assessment_import", input.mutationId, assessmentId);
    const saved = await getAssessmentInTransaction(tx, assessmentId);
    if (!saved) throw new Error("The assessment could not be read after import.");
    return { ok: true, assessment: saved, revision: await bumpAssessmentRevision(tx) };
  });
}

async function addPostgresAssessmentAddendum(
  assessmentId: string,
  note: string,
  reasonCode: string,
  actor: AssessmentActor,
  expectedVersion: number,
): Promise<AssessmentAddendumMutation | null> {
  const sql = getPipelineSql();
  return sql.begin(async (tx) => {
    const current = await getAssessmentInTransaction(tx, assessmentId, true);
    if (!current) return null;
    if (current.version !== expectedVersion) return { ok: false, conflict: true, assessment: current };
    if (!current.signed_at) {
      return {
        ok: false,
        blocked: true,
        assessment: current,
        blockers: [{ code: "assessment_signature_required", label: "Sign the assessment before adding an addendum." }],
      };
    }
    const rows = await tx<AssessmentAddendumRow[]>`
      insert into pipeline.assessment_addenda (
        assessment_id, note, reason_code, authored_by, authored_by_name
      ) values (
        ${assessmentId}, ${note}, ${reasonCode}, ${actor.id}, ${actor.name}
      )
      returning addendum_id, assessment_id, version, note, reason_code,
        authored_by, authored_by_name, created_at
    `;
    const updated = await tx<{ assessment_id: string }[]>`
      update pipeline.assessments
      set version = version + 1,
          updated_by = ${actor.id},
          updated_by_name = ${actor.name},
          updated_at = now()
      where assessment_id = ${assessmentId} and version = ${expectedVersion}
      returning assessment_id
    `;
    if (!updated[0]) throw new Error("The assessment changed while its addendum was being recorded.");
    await tx`
      insert into pipeline.audit_events (
        entity_type, entity_id, action, actor_id, actor_name,
        from_version, to_version, changed_fields, metadata
      ) values (
        'assessment', ${assessmentId}, 'assessment_addendum_added', ${actor.id}, ${actor.name},
        ${expectedVersion}, ${expectedVersion + 1}, ${[] as string[]},
        ${tx.json({ addendum_id: rows[0].addendum_id, reason_code: reasonCode })}
      )
    `;
    const assessment = await getAssessmentInTransaction(tx, assessmentId);
    if (!assessment) throw new Error("The assessment could not be read after adding its addendum.");
    return {
      ok: true,
      assessment,
      addendum: mapAssessmentAddendumRow(rows[0]),
      revision: await bumpAssessmentRevision(tx),
    };
  });
}

async function getAssessmentInTransaction(
  tx: TransactionSql,
  assessmentId: string,
  forUpdate = false,
): Promise<PipelineAssessmentRecord | null> {
  const rows = forUpdate
    ? await tx<AssessmentRow[]>`
        select * from pipeline.assessments
        where assessment_id = ${assessmentId}
        for update
      `
    : await tx<AssessmentRow[]>`
        select * from pipeline.assessments
        where assessment_id = ${assessmentId}
        limit 1
      `;
  if (!rows[0]) return null;
  const assessmentIds = [assessmentId];
  const [provenance, unmapped, audits, addenda] = await Promise.all([
    tx<AssessmentProvenanceRow[]>`
      select assessment_id, field_key, source_field_key, source_file, source_page,
        confidence, evidence_blob_key, review_status
      from pipeline.assessment_field_provenance
      where assessment_id = any(${assessmentIds}::text[])
      order by created_at, provenance_id
    `,
    tx<AssessmentUnmappedRow[]>`
      select assessment_id, source_field_key, source_value, reason, source_file,
        source_page, confidence, evidence_blob_key, review_status
      from pipeline.assessment_unmapped_fields
      where assessment_id = any(${assessmentIds}::text[])
      order by created_at, unmapped_field_id
    `,
    tx<AssessmentAuditRow[]>`
      select audit_event_id, entity_id, action, actor_id, actor_name, changed_fields, created_at
      from pipeline.audit_events
      where entity_type = 'assessment' and entity_id = any(${assessmentIds}::text[])
      order by created_at, audit_event_id
    `,
    tx<AssessmentAddendumRow[]>`
      select addendum_id, assessment_id, version, note, reason_code,
        authored_by, authored_by_name, created_at
      from pipeline.assessment_addenda
      where assessment_id = any(${assessmentIds}::text[])
      order by created_at, addendum_id
    `,
  ]);
  return hydrateAssessmentRows(rows, { provenance, unmapped, audits, addenda })[0];
}

function hydrateAssessmentRows(rows: AssessmentRow[], relations: AssessmentRelations) {
  const indexed = indexAssessmentRelations(relations);
  return rows.map((row) => {
    const rawData = isPlainRecord(row.data) ? row.data as Partial<AssessmentToolData> : {};
    const data = pickAssessmentToolData({
      ...rawData,
      resident_number: row.resident_number ?? rawData.resident_number,
      assessment_date: sqlDate(row.assessment_date) ?? rawData.assessment_date,
      assessor: row.assessor_name ?? rawData.assessor,
    });
    const fieldProvenance: PipelineAssessmentRecord["field_provenance"] = {};
    for (const source of indexed.provenance.get(row.assessment_id) ?? []) {
      if (!knownAssessmentFieldKeys.has(source.field_key as AssessmentToolFieldKey)) continue;
      appendProvenance(fieldProvenance, source.field_key as AssessmentToolFieldKey, {
        source_field_key: source.source_field_key,
        source_file: source.source_file,
        confidence: Number(source.confidence ?? 0),
        review_status: source.review_status,
        source_page_no: source.source_page,
        evidence_url: source.evidence_blob_key,
      });
    }
    const unmappedFields = (indexed.unmapped.get(row.assessment_id) ?? [])
      .map(mapUnmappedAssessmentRow);
    const auditEvents = (indexed.audits.get(row.assessment_id) ?? [])
      .filter((item) => isAssessmentAuditAction(item.action))
      .map((item): AssessmentAuditEvent => ({
        event_id: item.audit_event_id,
        assessment_id: row.assessment_id,
        referral_id: Number(row.referral_id),
        action: item.action,
        actor_id: item.actor_id,
        actor_name: item.actor_name,
        changed_fields: item.changed_fields.filter((field) => knownAssessmentFieldKeys.has(field as AssessmentToolFieldKey)) as AssessmentToolFieldKey[],
        created_at: isoTimestamp(item.created_at),
      }))
      .slice(-maxAuditEventsPerAssessment);
    const addenda = (indexed.addenda.get(row.assessment_id) ?? []).map(mapAssessmentAddendumRow);
    return normalizeAssessmentRecord({
      ...data,
      assessment_id: row.assessment_id,
      referral_id: Number(row.referral_id),
      assessor_id: row.assessor_id,
      canonical_client_id: row.canonical_client_id,
      resident_key: row.resident_key,
      status: row.status,
      completed_at: row.completed_at ? isoTimestamp(row.completed_at) : null,
      scheduled_start_at: row.scheduled_start_at ? isoTimestamp(row.scheduled_start_at) : null,
      scheduled_duration_minutes: row.scheduled_duration_minutes === null
        ? null
        : Number(row.scheduled_duration_minutes),
      scheduled_method: row.scheduled_method ?? null,
      scheduled_location: row.scheduled_location,
      schedule_status: row.schedule_status ?? "unscheduled",
      started_at: row.started_at ? isoTimestamp(row.started_at) : null,
      signed_at: row.signed_at ? isoTimestamp(row.signed_at) : null,
      signed_by: row.signed_by && row.signed_by_name
        ? { id: row.signed_by, name: row.signed_by_name }
        : null,
      signature_version: Number(row.signature_version ?? 1),
      addenda,
      version: Number(row.version),
      section_versions: normalizeAssessmentSectionVersions(row.section_versions),
      created_at: isoTimestamp(row.created_at),
      updated_at: isoTimestamp(row.updated_at),
      created_by: { id: row.created_by, name: row.created_by_name },
      updated_by: { id: row.updated_by, name: row.updated_by_name },
      field_provenance: fieldProvenance,
      unmapped_fields: unmappedFields,
      audit_events: auditEvents,
    });
  });
}

function indexAssessmentRelations(relations: AssessmentRelations): IndexedAssessmentRelations {
  return {
    provenance: groupRows(relations.provenance, (row) => row.assessment_id),
    unmapped: groupRows(relations.unmapped, (row) => row.assessment_id),
    audits: groupRows(relations.audits, (row) => row.entity_id),
    addenda: groupRows(relations.addenda, (row) => row.assessment_id),
  };
}

function mapAssessmentAddendumRow(row: AssessmentAddendumRow): AssessmentAddendum {
  return {
    addendum_id: row.addendum_id,
    assessment_id: row.assessment_id,
    version: Number(row.version),
    note: row.note,
    reason_code: row.reason_code,
    authored_by: row.authored_by,
    authored_by_name: row.authored_by_name,
    created_at: isoTimestamp(row.created_at),
  };
}

function groupRows<T>(rows: T[], keyFor: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    const group = grouped.get(key);
    if (group) group.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

async function insertAssessmentRow(tx: TransactionSql, assessment: PipelineAssessmentRecord) {
  await tx`
    insert into pipeline.assessments (
      assessment_id, referral_id, canonical_client_id, resident_key, resident_number, assessment_date,
      assessor_id, assessor_name, status, data, version, completed_at,
      scheduled_start_at, scheduled_duration_minutes, scheduled_method, scheduled_location,
      schedule_status, started_at, signed_at, signed_by, signed_by_name, signature_version,
      section_versions, created_by, created_by_name, updated_by, updated_by_name, created_at, updated_at
    ) values (
      ${assessment.assessment_id}, ${assessment.referral_id}, ${assessment.canonical_client_id}, ${assessment.resident_key},
      ${assessment.resident_number}, ${assessment.assessment_date}::date,
      ${assessment.assessor_id},
      ${assessment.assessor}, ${assessment.status},
      ${tx.json(pickAssessmentToolData(assessment))}, ${assessment.version}, ${assessment.completed_at}::timestamptz,
      ${assessment.scheduled_start_at ?? null}::timestamptz, ${assessment.scheduled_duration_minutes ?? null},
      ${assessment.scheduled_method ?? null}, ${assessment.scheduled_location ?? null},
      ${assessment.schedule_status ?? "unscheduled"}, ${assessment.started_at ?? null}::timestamptz,
      ${assessment.signed_at ?? null}::timestamptz, ${assessment.signed_by?.id ?? null},
      ${assessment.signed_by?.name ?? null}, ${assessment.signature_version ?? 1},
      ${tx.json(assessment.section_versions)},
      ${assessment.created_by.id}, ${assessment.created_by.name}, ${assessment.updated_by.id},
      ${assessment.updated_by.name}, ${assessment.created_at}::timestamptz, ${assessment.updated_at}::timestamptz
    )
  `;
}

async function updateAssessmentRow(
  tx: TransactionSql,
  assessment: PipelineAssessmentRecord,
  expectedVersion: number,
) {
  const rows = await tx<{ assessment_id: string }[]>`
    update pipeline.assessments
    set canonical_client_id = ${assessment.canonical_client_id},
        resident_key = ${assessment.resident_key},
        resident_number = ${assessment.resident_number},
        assessment_date = ${assessment.assessment_date}::date,
        assessor_id = ${assessment.assessor_id},
        assessor_name = ${assessment.assessor},
        status = ${assessment.status},
        data = ${tx.json(pickAssessmentToolData(assessment))},
        section_versions = ${tx.json(assessment.section_versions)},
        version = version + 1,
        completed_at = ${assessment.completed_at}::timestamptz,
        scheduled_start_at = ${assessment.scheduled_start_at ?? null}::timestamptz,
        scheduled_duration_minutes = ${assessment.scheduled_duration_minutes ?? null},
        scheduled_method = ${assessment.scheduled_method ?? null},
        scheduled_location = ${assessment.scheduled_location ?? null},
        schedule_status = ${assessment.schedule_status ?? "unscheduled"},
        started_at = ${assessment.started_at ?? null}::timestamptz,
        signed_at = ${assessment.signed_at ?? null}::timestamptz,
        signed_by = ${assessment.signed_by?.id ?? null},
        signed_by_name = ${assessment.signed_by?.name ?? null},
        signature_version = ${assessment.signature_version ?? 1},
        updated_by = ${assessment.updated_by.id},
        updated_by_name = ${assessment.updated_by.name},
        updated_at = ${assessment.updated_at}::timestamptz
    where assessment_id = ${assessment.assessment_id} and version = ${expectedVersion}
    returning assessment_id
  `;
  return Boolean(rows[0]);
}

async function insertAssessmentProvenance(
  tx: TransactionSql,
  assessmentId: string,
  next: PipelineAssessmentRecord["field_provenance"],
  previous: PipelineAssessmentRecord["field_provenance"] = {},
) {
  const rows = assessmentToolFieldDefinitions.flatMap((definition) => {
    const priorCount = previous[definition.key]?.length ?? 0;
    return (next[definition.key] ?? []).slice(priorCount).map((source) => ({
      assessment_id: assessmentId,
      field_key: definition.key,
      source_field_key: source.source_field_key,
      source_file: source.source_file,
      source_page: source.source_page_no,
      confidence: source.confidence,
      evidence_blob_key: source.evidence_url,
      review_status: source.review_status,
    }));
  });
  if (rows.length === 0) return;
  await tx`
    insert into pipeline.assessment_field_provenance ${tx(
      rows,
      "assessment_id",
      "field_key",
      "source_field_key",
      "source_file",
      "source_page",
      "confidence",
      "evidence_blob_key",
      "review_status",
    )}
  `;
}

async function insertAssessmentUnmapped(
  tx: TransactionSql,
  assessmentId: string,
  fields: UnmappedAssessmentField[],
) {
  if (fields.length === 0) return;
  const rows = fields.map((field) => ({
    assessment_id: assessmentId,
    source_field_key: field.source_field_key,
    source_value: JSON.stringify(field.value),
    reason: field.reason ?? "unmapped",
    source_file: field.source_file,
    source_page: field.source_page_no,
    confidence: field.confidence,
    evidence_blob_key: field.evidence_url,
    review_status: field.review_status,
  }));
  await tx`
    insert into pipeline.assessment_unmapped_fields ${tx(
      rows,
      "assessment_id",
      "source_field_key",
      "source_value",
      "reason",
      "source_file",
      "source_page",
      "confidence",
      "evidence_blob_key",
      "review_status",
    )}
  `;
}

async function writeAssessmentAudit(
  tx: TransactionSql,
  assessment: PipelineAssessmentRecord,
  action: AssessmentAuditAction,
  actor: AssessmentActor,
  changedFields: AssessmentToolFieldKey[],
) {
  await tx`
    insert into pipeline.audit_events (
      entity_type, entity_id, action, actor_id, actor_name,
      from_version, to_version, changed_fields, after_values
    ) values (
      'assessment', ${assessment.assessment_id}, ${action}, ${actor.id}, ${actor.name},
      ${assessment.version > 1 ? assessment.version - 1 : null}, ${assessment.version}, ${changedFields},
      ${tx.json({ status: assessment.status })}
    )
  `;
}

async function lockIdempotencyMutation(tx: TransactionSql, scope: string, mutationId: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${mutationId}`}, 0))`;
}

async function findIdempotentAssessment(tx: TransactionSql, scope: string, mutationId: string) {
  const rows = await tx<{ entity_id: string }[]>`
    select entity_id from pipeline.idempotency_keys
    where scope = ${scope} and mutation_id = ${mutationId}
    limit 1
  `;
  return rows[0] ? getAssessmentInTransaction(tx, rows[0].entity_id) : null;
}

async function saveAssessmentIdempotency(
  tx: TransactionSql,
  scope: string,
  mutationId: string,
  assessmentId: string,
) {
  await tx`
    insert into pipeline.idempotency_keys (scope, mutation_id, entity_type, entity_id)
    values (${scope}, ${mutationId}, 'assessment', ${assessmentId})
    on conflict (scope, mutation_id) do nothing
  `;
}

async function getPostgresAssessmentRevision() {
  const sql = getPipelineSql();
  const rows = await sql<{ revision: number | string }[]>`
    select revision from pipeline.store_revisions where store_name = 'assessments'
  `;
  return Number(rows[0]?.revision ?? 0);
}

async function getAssessmentRevisionInTransaction(tx: TransactionSql) {
  const rows = await tx<{ revision: number | string }[]>`
    select revision from pipeline.store_revisions where store_name = 'assessments'
  `;
  return Number(rows[0]?.revision ?? 0);
}

async function bumpAssessmentRevision(tx: TransactionSql) {
  const rows = await tx<{ revision: number | string }[]>`
    update pipeline.store_revisions
    set revision = revision + 1, updated_at = now()
    where store_name = 'assessments'
    returning revision
  `;
  return Number(rows[0]?.revision ?? 0);
}

function mapUnmappedAssessmentRow(row: AssessmentUnmappedRow): UnmappedAssessmentField {
  const reason = ["conflict", "invalid", "rejected", "unmapped"].includes(row.reason)
    ? row.reason as NonNullable<UnmappedAssessmentField["reason"]>
    : "unmapped";
  return {
    source_field_key: row.source_field_key,
    source_file: row.source_file,
    confidence: Number(row.confidence ?? 0),
    review_status: row.review_status,
    source_page_no: row.source_page,
    evidence_url: row.evidence_blob_key,
    value: jsonScalarToString(row.source_value),
    reason,
  };
}

function jsonScalarToString(value: unknown) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isAssessmentAuditAction(value: string): value is AssessmentAuditAction {
  return [
    "assessment_created",
    "assessment_assigned",
    "assessment_imported",
    "assessment_updated",
    "extraction_confirmed",
    "assessment_completed",
    "assessment_reopened",
    "assessment_scheduled",
    "assessment_rescheduled",
    "assessment_cancelled",
    "assessment_no_show",
    "assessment_started",
    "assessment_signed",
    "assessment_addendum_added",
  ].includes(value);
}

function sqlDate(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function isoTimestamp(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeImportedData(
  base: AssessmentToolData,
  incoming: AssessmentToolData,
  incomingProvenance: Partial<Record<AssessmentToolFieldKey, AssessmentFieldProvenance[]>>,
  incomingUnmapped: UnmappedAssessmentField[],
) {
  const data = pickAssessmentToolData(base);
  const fieldProvenance: Partial<Record<AssessmentToolFieldKey, AssessmentFieldProvenance[]>> = {};
  const unmappedFields = incomingUnmapped.map((field) => ({ ...field, reason: field.reason ?? "unmapped" as const }));

  for (const definition of assessmentToolFieldDefinitions) {
    const key = definition.key;
    const value = incoming[key];
    const provenance = incomingProvenance[key] ?? [];
    if (!hasValue(value)) continue;
    if (key === "assessor") {
      for (const source of provenance) {
        unmappedFields.push({ ...source, value: serializeAssessmentValue(value), reason: "unmapped" });
      }
      continue;
    }
    if (!hasValue(base[key]) || sameValue(base[key], value)) {
      assignValue(data, key, value);
      if (provenance.length > 0) fieldProvenance[key] = provenance;
      continue;
    }

    for (const source of provenance) {
      unmappedFields.push({ ...source, value: serializeAssessmentValue(value), reason: "conflict" });
    }
  }

  for (const contextKey of ["source_file", "match_confidence", "extraction_date"] as const) {
    if (hasValue(incoming[contextKey])) assignValue(data, contextKey, incoming[contextKey]);
  }
  return { data, fieldProvenance, unmappedFields };
}

function completionBlockers(assessment: PipelineAssessmentRecord) {
  const blockers: { code: string; label: string; fields?: AssessmentToolFieldKey[] }[] = [];
  if (!assessment.assessor_id || !assessment.assessor?.trim()) {
    blockers.push({
      code: "assessment_assessor_required",
      label: "Assign an active staff member before completing this assessment.",
      fields: ["assessor"],
    });
  }
  const completeness = getAssessmentCompletionSummary(assessment);
  if (completeness.missing.length > 0) {
    blockers.push({
      code: "assessment_data_incomplete",
      label: "Complete the required identity and core clinical assessment sections before finishing.",
      fields: [...new Set(completeness.missing.flatMap((rule) => rule.fields))],
    });
  }
  const pending = pendingFields(assessment.field_provenance);
  if (pending.length > 0) {
    blockers.push({
      code: "assessment_extraction_unreviewed",
      label: "Confirm or correct the imported assessment values before finishing.",
      fields: pending,
    });
  }
  return blockers;
}

function pendingFields(provenance: PipelineAssessmentRecord["field_provenance"]) {
  return assessmentToolFieldDefinitions
    .filter((definition) => provenance[definition.key]?.at(-1)?.review_status === "pending")
    .map((definition) => definition.key);
}

function normalizeAssessmentRecord(value: PipelineAssessmentRecord): PipelineAssessmentRecord {
  const data = pickAssessmentToolData(value);
  return {
    ...value,
    ...data,
    assessor_id: value.assessor_id?.trim() || null,
    version: Number.isInteger(value.version) && value.version > 0 ? value.version : 1,
    section_versions: normalizeAssessmentSectionVersions(value.section_versions),
    canonical_client_id: value.canonical_client_id?.trim() || null,
    resident_key: value.resident_key?.trim() || null,
    status: ["draft", "needs_review", "complete"].includes(value.status) ? value.status : "draft",
    completed_at: value.completed_at ?? null,
    scheduled_start_at: value.scheduled_start_at ?? null,
    scheduled_duration_minutes: value.scheduled_duration_minutes ?? null,
    scheduled_method: value.scheduled_method ?? null,
    scheduled_location: value.scheduled_location?.trim() || null,
    schedule_status: value.schedule_status ?? "unscheduled",
    started_at: value.started_at ?? null,
    signed_at: value.signed_at ?? null,
    signed_by: value.signed_by ?? null,
    signature_version: Number.isInteger(value.signature_version) && Number(value.signature_version) > 0
      ? Number(value.signature_version)
      : 1,
    addenda: Array.isArray(value.addenda) ? value.addenda : [],
    field_provenance: value.field_provenance ?? {},
    unmapped_fields: Array.isArray(value.unmapped_fields) ? value.unmapped_fields.slice(-1_000) : [],
    audit_events: Array.isArray(value.audit_events) ? value.audit_events.slice(-maxAuditEventsPerAssessment) : [],
  };
}

function assessmentMonthRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const year = Number(match?.[1]);
  const monthIndex = Number(match?.[2]) - 1;
  if (!match || year < 2000 || year > 2200 || monthIndex < 0 || monthIndex > 11) {
    throw new Error("month must use YYYY-MM.");
  }
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString(),
  };
}

function assessmentCompletionReport(
  month: string,
  range: { start: string; end: string },
  rows: AssessmentCompletionReport["rows"],
): AssessmentCompletionReport {
  const sorted = [...rows].sort((left, right) =>
    right.completed_assessments - left.completed_assessments
      || left.assessor_name.localeCompare(right.assessor_name)
      || (left.assessor_id ?? "").localeCompare(right.assessor_id ?? ""));
  return {
    month,
    period_start: range.start,
    period_end: range.end,
    total_completed: sorted.reduce((total, row) => total + row.completed_assessments, 0),
    rows: sorted,
    generated_at: new Date().toISOString(),
  };
}

function elapsedMinutes(startedAt: string | null | undefined, signedAt: string) {
  if (!startedAt) return null;
  const elapsed = Date.parse(signedAt) - Date.parse(startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed / 60_000) : null;
}

function isAssessmentRecord(value: unknown): value is PipelineAssessmentRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PipelineAssessmentRecord>;
  return typeof candidate.assessment_id === "string" && Number.isInteger(candidate.referral_id) && typeof candidate.created_at === "string";
}

function safeMutationMap(value: Record<string, string> | undefined) {
  return new Map(Object.entries(value ?? {}).filter(([key, id]) => Boolean(key) && typeof id === "string"));
}

function mergeProvenance(
  current: PipelineAssessmentRecord["field_provenance"],
  incoming: PipelineAssessmentRecord["field_provenance"],
) {
  const merged = cloneProvenance(current);
  for (const definition of assessmentToolFieldDefinitions) {
    const values = incoming[definition.key];
    if (values?.length) merged[definition.key] = [...(merged[definition.key] ?? []), ...values];
  }
  return merged;
}

function cloneProvenance(provenance: PipelineAssessmentRecord["field_provenance"]) {
  return Object.fromEntries(
    Object.entries(provenance).map(([key, values]) => [key, values?.map((value) => ({ ...value }))]),
  ) as PipelineAssessmentRecord["field_provenance"];
}

function appendProvenance(
  provenance: PipelineAssessmentRecord["field_provenance"],
  key: AssessmentToolFieldKey,
  value: AssessmentFieldProvenance,
) {
  provenance[key] = [...(provenance[key] ?? []), value];
}

function createAuditEvent(
  assessmentId: string,
  referralId: number,
  action: AssessmentAuditAction,
  actor: AssessmentActor,
  changedFields: AssessmentToolFieldKey[],
): AssessmentAuditEvent {
  return {
    event_id: `aud_${randomUUID()}`,
    assessment_id: assessmentId,
    referral_id: referralId,
    action,
    actor_id: actor.id,
    actor_name: actor.name,
    changed_fields: changedFields,
    created_at: new Date().toISOString(),
  };
}

function appendAuditEvent(events: AssessmentAuditEvent[], event: AssessmentAuditEvent) {
  return [...events, event].slice(-maxAuditEventsPerAssessment);
}

function assignValue(
  data: AssessmentToolData,
  key: AssessmentToolFieldKey,
  value: AssessmentToolData[AssessmentToolFieldKey],
) {
  if (key === "secondary_diagnoses" || key === "medications_at_intake" || key === "substances") {
    if (Array.isArray(value)) data[key] = value;
  } else if (key === "prior_hospitalizations_count" || key === "match_confidence") {
    if (typeof value === "number" || value === null) data[key] = value;
  } else if (typeof value === "string" || value === null) {
    data[key] = value;
  }
}

function sameValue(left: AssessmentToolData[AssessmentToolFieldKey], right: AssessmentToolData[AssessmentToolFieldKey]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== null;
}

function serializeAssessmentValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return JSON.stringify(value);
  return value === null ? null : String(value);
}

function compareAssessments(left: PipelineAssessmentRecord, right: PipelineAssessmentRecord) {
  return right.updated_at.localeCompare(left.updated_at) ||
    right.assessment_id.localeCompare(left.assessment_id);
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function clampPageSize(value: number | undefined) {
  if (!Number.isFinite(value)) return 100;
  return Math.min(maxPageSize, Math.max(1, Math.floor(value as number)));
}

function isMissingFile(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}
