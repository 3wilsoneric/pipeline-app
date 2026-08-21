import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { TransactionSql } from "postgres";

import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  isAfterDescendingCursor,
} from "@/lib/pipeline/keyset-cursor";

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
  type AssessmentActor,
  type AssessmentAuditAction,
  type AssessmentAuditEvent,
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

export type AssessmentImportInput = {
  referralId: number;
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

export function getAssessmentStoreReadiness(): AssessmentStoreReadiness {
  const configured = process.env.PIPELINE_ASSESSMENT_STORE_MODE?.trim() ||
    process.env.PIPELINE_REFERRAL_STORE_MODE?.trim();
  const postgresMode = configured === "postgres" || configured === "external" ||
    (!configured && process.env.PIPELINE_DATABASE_MODE === "postgres");
  if (postgresMode) {
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
};

const postgresAssessmentStore: AssessmentStore = {
  list: listPostgresAssessments,
  get: getPostgresAssessment,
  create: createPostgresAssessment,
  patch: patchPostgresAssessment,
  importExtraction: importPostgresAssessmentExtraction,
};

function getAssessmentStore() {
  return getAssessmentStoreReadiness().mode === "postgres"
    ? postgresAssessmentStore
    : localAssessmentStore;
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
      canonical_client_id: input.canonical_client_id?.trim() || null,
      resident_key: input.resident_key?.trim() || null,
      status,
      completed_at: status === "complete" ? now : null,
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

    const currentData = pickAssessmentToolData(current);
    const nextData = pickAssessmentToolData({ ...currentData, ...(patch.data ?? {}) });
    const issues = validateAssessmentToolData(nextData);
    if (issues.length > 0) throw new Error(issues[0].message);
    const changedFields = assessmentToolFieldDefinitions
      .filter((definition) => !sameValue(currentData[definition.key], nextData[definition.key]))
      .map((definition) => definition.key);
    const changedSections = changedFields
      .map(assessmentSectionForField)
      .filter((section): section is AssessmentToolSection => Boolean(section));
    const fieldProvenance = cloneProvenance(current.field_provenance);

    for (const key of changedFields) {
      appendProvenance(fieldProvenance, key, {
        source_field_key: `manual.${key}`,
        source_file: null,
        confidence: 1,
        review_status: "edited",
        source_page_no: null,
        evidence_url: null,
      });
    }

    const acceptedFields: AssessmentToolFieldKey[] = [];
    if (patch.accept_pending) {
      for (const definition of assessmentToolFieldDefinitions) {
        const history = fieldProvenance[definition.key] ?? [];
        const latest = history.at(-1);
        if (latest?.review_status !== "pending") continue;
        appendProvenance(fieldProvenance, definition.key, { ...latest, review_status: "accepted" });
        acceptedFields.push(definition.key);
      }
    }

    const nextStatus = patch.status ?? (
      patch.accept_pending && current.status === "needs_review" ? "draft" : current.status
    );
    const completesAssessment = nextStatus === "complete" && current.status !== "complete";
    const localReferral = completesAssessment
      ? await loadLocalAssessmentReferral(current.referral_id)
      : null;
    if (completesAssessment && localReferral && !["Assessment", "Community Review"].includes(localReferral.stage)) {
      return {
        ok: false,
        blocked: true,
        assessment: current,
        blockers: [{
          code: "assessment_stage_required",
          label: "Move the referral into Assessment before completing this assessment.",
        }],
      };
    }
    const now = new Date().toISOString();
    const candidate: PipelineAssessmentRecord = {
      ...current,
      ...nextData,
      canonical_client_id: preserveCanonicalClientId(current.canonical_client_id, patch.canonical_client_id),
      resident_key: patch.resident_key === undefined
        ? current.resident_key
        : patch.resident_key?.trim() || null,
      status: nextStatus,
      completed_at: nextStatus === "complete" ? current.completed_at ?? now : null,
      version: current.version + 1,
      section_versions: incrementAssessmentSectionVersions(current.section_versions, [
        ...changedSections,
        ...acceptedFields
          .map(assessmentSectionForField)
          .filter((section): section is AssessmentToolSection => Boolean(section)),
      ]),
      updated_at: now,
      updated_by: actor,
      field_provenance: fieldProvenance,
      audit_events: current.audit_events,
    };
    const blockers = completionBlockers(candidate);
    if (nextStatus === "complete" && blockers.length > 0) {
      return { ok: false, blocked: true, assessment: current, blockers };
    }

    let action: AssessmentAuditAction = "assessment_updated";
    if (acceptedFields.length > 0) action = "extraction_confirmed";
    if (nextStatus === "complete" && current.status !== "complete") action = "assessment_completed";
    if (nextStatus !== "complete" && current.status === "complete") action = "assessment_reopened";
    candidate.audit_events = appendAuditEvent(
      current.audit_events,
      createAuditEvent(assessmentId, current.referral_id, action, actor, Array.from(new Set([...changedFields, ...acceptedFields]))),
    );
    state.assessments[index] = candidate;
    state.revision += 1;
    if (options.mutationId) state.patchMutations.set(options.mutationId, assessmentId);
    await persist();
    if (completesAssessment && localReferral?.stage === "Assessment") {
      await advanceLocalReferralAfterAssessment(localReferral, actor);
    }
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

    const mapping = mapExtractedAssessmentFields(input.fields, input.context);
    const baseData = current
      ? pickAssessmentToolData(current)
      : pickAssessmentToolData({ ...createEmptyAssessmentToolData(), ...input.defaults });
    const merged = mergeImportedData(baseData, mapping.data, mapping.field_provenance, mapping.unmapped_fields);
    const now = new Date().toISOString();
    const assessmentId = current?.assessment_id ?? `asm_${randomUUID()}`;
    const fieldProvenance = mergeProvenance(current?.field_provenance ?? {}, merged.fieldProvenance);
    const unmappedFields = [
      ...(current?.unmapped_fields ?? []),
      ...merged.unmappedFields,
    ].slice(-1_000);
    const changedFields = assessmentToolFieldDefinitions
      .filter((definition) => !sameValue(baseData[definition.key], merged.data[definition.key]))
      .map((definition) => definition.key);
    const changedSections = changedFields
      .map(assessmentSectionForField)
      .filter((section): section is AssessmentToolSection => Boolean(section));
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
      canonical_client_id: preserveCanonicalClientId(current?.canonical_client_id, input.canonicalClientId),
      resident_key: current?.resident_key ?? (input.residentKey?.trim() || null),
      status: "needs_review",
      completed_at: null,
      version: current ? current.version + 1 : 1,
      section_versions: incrementAssessmentSectionVersions(
        current?.section_versions ?? defaultAssessmentSectionVersions(),
        changedSections,
      ),
      created_at: current?.created_at ?? now,
      updated_at: now,
      created_by: current?.created_by ?? input.actor,
      updated_by: input.actor,
      field_provenance: fieldProvenance,
      unmapped_fields: unmappedFields,
      audit_events: appendAuditEvent(current?.audit_events ?? [], event),
    };

    if (currentIndex >= 0) state.assessments[currentIndex] = assessment;
    else state.assessments = [assessment, ...state.assessments];
    state.revision += 1;
    if (input.mutationId) state.importMutations.set(input.mutationId, assessmentId);
    await persist();
    return { ok: true, assessment, revision: state.revision };
  });
}

type AssessmentRow = {
  assessment_id: string;
  referral_id: number | string;
  canonical_client_id: string | null;
  resident_key: string | null;
  resident_number: string | null;
  assessment_date: Date | string | null;
  assessor_name: string | null;
  status: PipelineAssessmentRecord["status"];
  data: unknown;
  version: number;
  section_versions: unknown;
  completed_at: Date | string | null;
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

type AssessmentRelations = {
  provenance: AssessmentProvenanceRow[];
  unmapped: AssessmentUnmappedRow[];
  audits: AssessmentAuditRow[];
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
  if (assessmentIds.length === 0) return { provenance: [], unmapped: [], audits: [] };
  const sql = getPipelineSql();
  const [provenance, unmapped, audits] = await Promise.all([
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
  ]);
  return { provenance, unmapped, audits };
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
    canonical_client_id: input.canonical_client_id?.trim() || null,
    resident_key: input.resident_key?.trim() || null,
    status,
    completed_at: status === "complete" ? now : null,
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

    const currentData = pickAssessmentToolData(current);
    const nextData = pickAssessmentToolData({ ...currentData, ...(patch.data ?? {}) });
    const issues = validateAssessmentToolData(nextData);
    if (issues.length > 0) throw new Error(issues[0].message);
    const changedFields = assessmentToolFieldDefinitions
      .filter((definition) => !sameValue(currentData[definition.key], nextData[definition.key]))
      .map((definition) => definition.key);
    const changedSections = changedFields
      .map(assessmentSectionForField)
      .filter((section): section is AssessmentToolSection => Boolean(section));
    const fieldProvenance = cloneProvenance(current.field_provenance);
    for (const key of changedFields) {
      appendProvenance(fieldProvenance, key, {
        source_field_key: `manual.${key}`,
        source_file: null,
        confidence: 1,
        review_status: "edited",
        source_page_no: null,
        evidence_url: null,
      });
    }
    const acceptedFields: AssessmentToolFieldKey[] = [];
    if (patch.accept_pending) {
      for (const definition of assessmentToolFieldDefinitions) {
        const latest = fieldProvenance[definition.key]?.at(-1);
        if (latest?.review_status !== "pending") continue;
        appendProvenance(fieldProvenance, definition.key, { ...latest, review_status: "accepted" });
        acceptedFields.push(definition.key);
      }
    }
    const nextStatus = patch.status ?? (
      patch.accept_pending && current.status === "needs_review" ? "draft" : current.status
    );
    const completesAssessment = nextStatus === "complete" && current.status !== "complete";
    if (completesAssessment) {
      const stageRows = await tx<{ stage: string }[]>`
        select stage from pipeline.referrals
        where referral_id = ${current.referral_id}
        for update
      `;
      if (!stageRows[0]) throw new Error("The assessment referral no longer exists.");
      if (!["Assessment", "Community Review"].includes(stageRows[0].stage)) {
        return {
          ok: false,
          blocked: true,
          assessment: current,
          blockers: [{
            code: "assessment_stage_required",
            label: "Move the referral into Assessment before completing this assessment.",
          }],
        };
      }
    }
    const now = new Date().toISOString();
    const candidate: PipelineAssessmentRecord = {
      ...current,
      ...nextData,
      canonical_client_id: preserveCanonicalClientId(current.canonical_client_id, patch.canonical_client_id),
      resident_key: patch.resident_key === undefined ? current.resident_key : patch.resident_key?.trim() || null,
      status: nextStatus,
      completed_at: nextStatus === "complete" ? current.completed_at ?? now : null,
      version: current.version + 1,
      section_versions: incrementAssessmentSectionVersions(current.section_versions, [
        ...changedSections,
        ...acceptedFields
          .map(assessmentSectionForField)
          .filter((section): section is AssessmentToolSection => Boolean(section)),
      ]),
      updated_at: now,
      updated_by: actor,
      field_provenance: fieldProvenance,
    };
    const blockers = completionBlockers(candidate);
    if (nextStatus === "complete" && blockers.length > 0) {
      return { ok: false, blocked: true, assessment: current, blockers };
    }
    let action: AssessmentAuditAction = "assessment_updated";
    if (acceptedFields.length > 0) action = "extraction_confirmed";
    if (nextStatus === "complete" && current.status !== "complete") action = "assessment_completed";
    if (nextStatus !== "complete" && current.status === "complete") action = "assessment_reopened";
    const allChangedFields = Array.from(new Set([...changedFields, ...acceptedFields]));
    const updated = await updateAssessmentRow(tx, candidate, current.version);
    if (!updated) {
      const latest = await getAssessmentInTransaction(tx, assessmentId);
      return latest ? { ok: false, conflict: true, assessment: latest } : null;
    }
    await insertAssessmentProvenance(tx, assessmentId, fieldProvenance, current.field_provenance);
    await writeAssessmentAudit(tx, candidate, action, actor, allChangedFields);
    if (completesAssessment) {
      await advancePostgresReferralAfterAssessment(tx, current.referral_id, actor);
    }
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

async function loadLocalAssessmentReferral(referralId: number) {
  const { getReferral } = await import("@/lib/pipeline/referral-store");
  return getReferral(referralId);
}

async function advanceLocalReferralAfterAssessment(
  referral: NonNullable<Awaited<ReturnType<typeof loadLocalAssessmentReferral>>>,
  actor: AssessmentActor,
) {
  const { patchReferral } = await import("@/lib/pipeline/referral-store");
  const result = await patchReferral(
    referral.id,
    { stage: "Community Review" },
    referral.version,
    actor,
    { workflow: referral.sectionVersions?.workflow ?? 1 },
    { auditAction: "assessment_completed", auditReason: "Canonical assessment completed." },
  );
  if (!result?.ok) {
    throw new Error("The assessment was saved, but the referral could not advance to community review.");
  }
}

async function advancePostgresReferralAfterAssessment(
  tx: TransactionSql,
  referralId: number,
  actor: AssessmentActor,
) {
  const rows = await tx<{ version: number; stage: string }[]>`
    update pipeline.referrals
    set stage = 'Community Review',
        version = version + 1,
        section_versions = jsonb_set(
          section_versions,
          '{workflow}',
          to_jsonb(coalesce((section_versions->>'workflow')::integer, 1) + 1)
        ),
        updated_by = ${actor.id},
        updated_by_name = ${actor.name},
        updated_at = now()
    where referral_id = ${referralId} and stage = 'Assessment'
    returning version, stage
  `;
  if (!rows[0]) return;

  await tx`
    insert into pipeline.audit_events (
      entity_type, entity_id, action, actor_id, actor_name,
      from_version, to_version, changed_fields, metadata
    ) values (
      'referral', ${String(referralId)}, 'assessment_completed', ${actor.id}, ${actor.name},
      ${rows[0].version - 1}, ${rows[0].version}, ${["stage"]},
      ${tx.json({ from_stage: "Assessment", to_stage: "Community Review" })}
    )
  `;
  await tx`
    update pipeline.store_revisions
    set revision = revision + 1, updated_at = now()
    where store_name in ('referrals', 'workflow')
  `;
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

    const mapping = mapExtractedAssessmentFields(input.fields, input.context);
    const baseData = current
      ? pickAssessmentToolData(current)
      : pickAssessmentToolData({ ...createEmptyAssessmentToolData(), ...input.defaults });
    const merged = mergeImportedData(baseData, mapping.data, mapping.field_provenance, mapping.unmapped_fields);
    const issues = validateAssessmentToolData(merged.data);
    if (issues.length > 0) throw new Error(issues[0].message);
    const now = new Date().toISOString();
    const assessmentId = current?.assessment_id ?? `asm_${randomUUID()}`;
    const changedFields = assessmentToolFieldDefinitions
      .filter((definition) => !sameValue(baseData[definition.key], merged.data[definition.key]))
      .map((definition) => definition.key);
    const changedSections = changedFields
      .map(assessmentSectionForField)
      .filter((section): section is AssessmentToolSection => Boolean(section));
    const assessment: PipelineAssessmentRecord = {
      ...(current ?? {} as PipelineAssessmentRecord),
      ...merged.data,
      assessment_id: assessmentId,
      referral_id: input.referralId,
      canonical_client_id: preserveCanonicalClientId(current?.canonical_client_id, input.canonicalClientId),
      resident_key: current?.resident_key ?? (input.residentKey?.trim() || null),
      status: "needs_review",
      completed_at: null,
      version: current ? current.version + 1 : 1,
      section_versions: incrementAssessmentSectionVersions(
        current?.section_versions ?? defaultAssessmentSectionVersions(),
        changedSections,
      ),
      created_at: current?.created_at ?? now,
      updated_at: now,
      created_by: current?.created_by ?? input.actor,
      updated_by: input.actor,
      field_provenance: mergeProvenance(current?.field_provenance ?? {}, merged.fieldProvenance),
      unmapped_fields: [...(current?.unmapped_fields ?? []), ...merged.unmappedFields].slice(-1_000),
      audit_events: current?.audit_events ?? [],
    };

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
    await insertAssessmentUnmapped(tx, assessmentId, merged.unmappedFields);
    await writeAssessmentAudit(tx, assessment, "assessment_imported", input.actor, changedFields);
    if (input.mutationId) await saveAssessmentIdempotency(tx, "assessment_import", input.mutationId, assessmentId);
    const saved = await getAssessmentInTransaction(tx, assessmentId);
    if (!saved) throw new Error("The assessment could not be read after import.");
    return { ok: true, assessment: saved, revision: await bumpAssessmentRevision(tx) };
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
  const [provenance, unmapped, audits] = await Promise.all([
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
  ]);
  return hydrateAssessmentRows(rows, { provenance, unmapped, audits })[0];
}

function hydrateAssessmentRows(rows: AssessmentRow[], relations: AssessmentRelations) {
  const knownFields = new Set(assessmentToolFieldDefinitions.map((definition) => definition.key));
  return rows.map((row) => {
    const rawData = isPlainRecord(row.data) ? row.data as Partial<AssessmentToolData> : {};
    const data = pickAssessmentToolData({
      ...rawData,
      resident_number: row.resident_number ?? rawData.resident_number,
      assessment_date: sqlDate(row.assessment_date) ?? rawData.assessment_date,
      assessor: row.assessor_name ?? rawData.assessor,
    });
    const fieldProvenance: PipelineAssessmentRecord["field_provenance"] = {};
    for (const source of relations.provenance.filter((item) => item.assessment_id === row.assessment_id)) {
      if (!knownFields.has(source.field_key as AssessmentToolFieldKey)) continue;
      appendProvenance(fieldProvenance, source.field_key as AssessmentToolFieldKey, {
        source_field_key: source.source_field_key,
        source_file: source.source_file,
        confidence: Number(source.confidence ?? 0),
        review_status: source.review_status,
        source_page_no: source.source_page,
        evidence_url: source.evidence_blob_key,
      });
    }
    const unmappedFields = relations.unmapped
      .filter((item) => item.assessment_id === row.assessment_id)
      .map(mapUnmappedAssessmentRow);
    const auditEvents = relations.audits
      .filter((item) => item.entity_id === row.assessment_id)
      .filter((item) => isAssessmentAuditAction(item.action))
      .map((item): AssessmentAuditEvent => ({
        event_id: item.audit_event_id,
        assessment_id: row.assessment_id,
        referral_id: Number(row.referral_id),
        action: item.action,
        actor_id: item.actor_id,
        actor_name: item.actor_name,
        changed_fields: item.changed_fields.filter((field) => knownFields.has(field as AssessmentToolFieldKey)) as AssessmentToolFieldKey[],
        created_at: isoTimestamp(item.created_at),
      }))
      .slice(-maxAuditEventsPerAssessment);
    return normalizeAssessmentRecord({
      ...data,
      assessment_id: row.assessment_id,
      referral_id: Number(row.referral_id),
      canonical_client_id: row.canonical_client_id,
      resident_key: row.resident_key,
      status: row.status,
      completed_at: row.completed_at ? isoTimestamp(row.completed_at) : null,
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

async function insertAssessmentRow(tx: TransactionSql, assessment: PipelineAssessmentRecord) {
  await tx`
    insert into pipeline.assessments (
      assessment_id, referral_id, canonical_client_id, resident_key, resident_number, assessment_date,
      assessor_id, assessor_name, status, data, version, completed_at,
      section_versions, created_by, created_by_name, updated_by, updated_by_name, created_at, updated_at
    ) values (
      ${assessment.assessment_id}, ${assessment.referral_id}, ${assessment.canonical_client_id}, ${assessment.resident_key},
      ${assessment.resident_number}, ${assessment.assessment_date}::date,
      ${assessment.assessor === assessment.updated_by.name ? assessment.updated_by.id : null},
      ${assessment.assessor}, ${assessment.status},
      ${tx.json(pickAssessmentToolData(assessment))}, ${assessment.version}, ${assessment.completed_at}::timestamptz,
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
        assessor_id = case
          when assessor_name is not distinct from ${assessment.assessor} then assessor_id
          when ${assessment.assessor} = ${assessment.updated_by.name} then ${assessment.updated_by.id}
          else null
        end,
        assessor_name = ${assessment.assessor},
        status = ${assessment.status},
        data = ${tx.json(pickAssessmentToolData(assessment))},
        section_versions = ${tx.json(assessment.section_versions)},
        version = version + 1,
        completed_at = ${assessment.completed_at}::timestamptz,
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
    "assessment_imported",
    "assessment_updated",
    "extraction_confirmed",
    "assessment_completed",
    "assessment_reopened",
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
    version: Number.isInteger(value.version) && value.version > 0 ? value.version : 1,
    section_versions: normalizeAssessmentSectionVersions(value.section_versions),
    canonical_client_id: value.canonical_client_id?.trim() || null,
    resident_key: value.resident_key?.trim() || null,
    status: ["draft", "needs_review", "complete"].includes(value.status) ? value.status : "draft",
    completed_at: value.completed_at ?? null,
    field_provenance: value.field_provenance ?? {},
    unmapped_fields: Array.isArray(value.unmapped_fields) ? value.unmapped_fields.slice(-1_000) : [],
    audit_events: Array.isArray(value.audit_events) ? value.audit_events.slice(-maxAuditEventsPerAssessment) : [],
  };
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
