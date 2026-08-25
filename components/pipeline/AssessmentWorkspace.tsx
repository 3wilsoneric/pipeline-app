"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  History,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";

import {
  fetchCurrentPipelineUser,
  fetchPipelineJson,
  PipelineApiError,
  type PipelineCurrentUser,
} from "@/lib/auth/authenticated-fetch";
import { parseAssessmentFile } from "@/lib/assessment/assessment-file-parser";
import { getAssessmentCompletionSummary } from "@/lib/assessment/assessment-completion";
import type {
  AssessmentListResponse,
  PipelineAssessmentRecord,
} from "@/lib/assessment/assessment-records";
import {
  assessmentToolFieldDefinitions,
  createEmptyAssessmentToolData,
  pickAssessmentToolData,
  type AssessmentToolData,
  type AssessmentToolFieldDefinition,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";
import {
  assessmentInterviewFieldLabel,
  assessmentInterviewSections,
  getAssessmentUnableReason,
  getAssessmentInterviewCoverage,
  getAssessmentInterviewQuestions,
  getRequiredAssessmentInterviewQuestions,
  getAssessmentInterviewSnapshot,
  hasAssessmentInterviewValue,
  setAssessmentUnableReason,
  type AssessmentInterviewQuestion,
} from "@/lib/assessment/assessment-interview-schema";
import {
  fieldsForAssessmentSection,
  normalizeAssessmentSectionVersions,
} from "@/lib/assessment/assessment-sections";
import type { EditingPresence } from "@/lib/pipeline/editing-presence";
import type { PipelineAssessmentDraft } from "@/lib/pipeline/user-workspace-state-types";

type AssessmentWorkspaceProps = {
  referralId?: number;
  onSummaryChange?: (summary: { captured: number; total: number; status: string; assessmentId?: string }) => void;
  onAssessmentSaved?: (assessment: PipelineAssessmentRecord) => void | Promise<void>;
};

const sectionLabels = Object.fromEntries(
  assessmentInterviewSections.map((section) => [section.key, section.label]),
) as Record<AssessmentToolSection, string>;

const extractionOwnedFields = new Set<AssessmentToolFieldKey>([
  "assessor",
  "source_file",
  "match_confidence",
  "extraction_date",
]);

const assessmentNavigationGroups: ReadonlyArray<{
  label: string;
  sections: readonly AssessmentToolSection[];
}> = [
  { label: "Intake", sections: ["identity", "prior_placement", "prior_history"] },
  { label: "Clinical interview", sections: ["diagnosis_clinical", "functional_adl", "medication", "substance_use"] },
  { label: "Safety and care", sections: ["behavioral_risk", "physical_health", "legal_conservatorship"] },
  { label: "Plan and review", sections: ["social_support", "provenance_qc"] },
];

type AssessmentFieldConflict = {
  field: AssessmentToolFieldKey;
  localValue: AssessmentToolData[AssessmentToolFieldKey];
  remoteValue: AssessmentToolData[AssessmentToolFieldKey];
  section: AssessmentToolSection;
};

type AssessmentRemoteChange = {
  assessment: PipelineAssessmentRecord;
  conflicts: AssessmentFieldConflict[];
};

export default function AssessmentWorkspace({ referralId, onSummaryChange, onAssessmentSaved }: AssessmentWorkspaceProps) {
  const [assessments, setAssessments] = useState<PipelineAssessmentRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<AssessmentToolData>(createEmptyAssessmentToolData);
  const [activeSection, setActiveSection] = useState<AssessmentToolSection>("identity");
  const [isLoading, setIsLoading] = useState(Boolean(referralId));
  const [isBusy, setIsBusy] = useState(false);
  const [dirtySections, setDirtySections] = useState<Set<AssessmentToolSection>>(new Set());
  const [remoteChange, setRemoteChange] = useState<AssessmentRemoteChange | null>(null);
  const [presence, setPresence] = useState<EditingPresence[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleDuration, setScheduleDuration] = useState("60");
  const [scheduleMethod, setScheduleMethod] = useState<"in_person" | "phone" | "video" | "record_review">("in_person");
  const [scheduleLocation, setScheduleLocation] = useState("");
  const [showAddendum, setShowAddendum] = useState(false);
  const [addendumReason, setAddendumReason] = useState("");
  const [addendumNote, setAddendumNote] = useState("");
  const [viewer, setViewer] = useState<PipelineCurrentUser | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<PipelineAssessmentRecord | null>(null);
  const draftRef = useRef<AssessmentToolData>(draft);
  const baseDataRef = useRef<AssessmentToolData>(draft);
  const dirtySectionsRef = useRef<Set<AssessmentToolSection>>(dirtySections);
  const remoteChangeRef = useRef<AssessmentRemoteChange | null>(remoteChange);
  const draftVersionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const initializedAssessmentIdRef = useRef("");
  const focusedAssessmentIdRef = useRef("");
  const dirty = dirtySections.size > 0;

  const selected = assessments.find((assessment) => assessment.assessment_id === selectedId) ?? null;
  const canSupervise = Boolean(viewer?.roles.some((role) => role === "admin" || role === "assessment_coordinator"));
  const canCreateClinical = Boolean(viewer?.roles.some((role) => role === "admin" || role === "assessment_coordinator" || role === "reviewer"));
  const canEditClinical = Boolean(viewer && selected && (selected.assessor_id === viewer.id || canSupervise));
  const canAddAddendum = Boolean(viewer && (selected?.signed_by?.id === viewer.id || canSupervise));
  const coverage = useMemo(() => getAssessmentInterviewCoverage(draft), [draft]);
  const completion = useMemo(() => getAssessmentCompletionSummary(draft), [draft]);
  const pendingFields = useMemo(() => getPendingFields(selected), [selected]);
  const sectionQuestions = useMemo(() => getAssessmentInterviewQuestions(activeSection, draft), [activeSection, draft]);
  const sectionDefinition = assessmentInterviewSections.find((section) => section.key === activeSection) ?? assessmentInterviewSections[0];
  const sectionGroups = useMemo(() => groupAssessmentQuestions(sectionQuestions), [sectionQuestions]);
  const interviewSnapshot = useMemo(() => getAssessmentInterviewSnapshot(draft), [draft]);
  const requiredInterviewFields = useMemo(
    () => new Set(getRequiredAssessmentInterviewQuestions(draft).map((question) => question.field)),
    [draft],
  );
  const activeSectionIndex = assessmentInterviewSections.findIndex((section) => section.key === activeSection);
  const activeSectionCaptured = sectionQuestions.filter((question) => hasAssessmentInterviewValue(draft[question.field])).length;
  const nextUnansweredQuestion = sectionQuestions.find((question) => !hasAssessmentInterviewValue(draft[question.field]));

  useEffect(() => {
    let cancelled = false;
    fetchCurrentPipelineUser()
      .then(({ user }) => {
        if (!cancelled) setViewer(user ?? null);
      })
      .catch(() => {
        if (!cancelled) setViewer(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!referralId) {
      setAssessments([]);
      setSelectedId("");
      setDraft(createEmptyAssessmentToolData());
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    fetchPipelineJson<AssessmentListResponse>(`/api/referrals/${referralId}/assessments`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((payload) => {
        setAssessments(payload.assessments);
        setSelectedId((current) => current && payload.assessments.some((item) => item.assessment_id === current)
          ? current
          : payload.assessments[0]?.assessment_id ?? "");
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(messageFor(loadError, "Assessment history could not be loaded."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [referralId]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    dirtySectionsRef.current = dirtySections;
  }, [dirtySections]);

  useEffect(() => {
    remoteChangeRef.current = remoteChange;
  }, [remoteChange]);

  useEffect(() => {
    if (!selected) return;
    if (initializedAssessmentIdRef.current === selected.assessment_id) return;
    initializedAssessmentIdRef.current = selected.assessment_id;
    const data = pickAssessmentToolData(selected);
    selectedRef.current = selected;
    baseDataRef.current = data;
    setDraft(data);
    setDirtySections(new Set());
    setRemoteChange(null);
    setScheduleStart(toLocalDateTimeInput(selected.scheduled_start_at));
    setScheduleDuration(String(selected.scheduled_duration_minutes ?? 60));
    setScheduleMethod(selected.scheduled_method ?? "in_person");
    setScheduleLocation(selected.scheduled_location ?? "");
    setShowSchedule(false);
    setShowAddendum(false);
    void loadRecoveryDraft(selected, data);
  }, [selected]);

  useEffect(() => {
    if (!selected?.assessment_id || focusedAssessmentIdRef.current === selected.assessment_id) return;
    focusedAssessmentIdRef.current = selected.assessment_id;
    setIsFocused(true);
  }, [selected?.assessment_id]);

  useEffect(() => {
    if (!isFocused) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFocused(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isFocused]);

  useEffect(() => {
    onSummaryChange?.({
      captured: coverage.captured,
      total: coverage.total,
      status: selected?.status ?? "not_started",
      assessmentId: selected?.assessment_id,
    });
  }, [coverage.captured, coverage.total, onSummaryChange, selected?.assessment_id, selected?.status]);

  const createAssessmentDraft = async () => {
    if (!referralId) return;
    setIsBusy(true);
    setError("");
    setMessage("Creating assessment record...");
    try {
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/referrals/${referralId}/assessments`,
        {
          method: "POST",
          body: JSON.stringify({ data: {}, client_mutation_id: mutationId("assessment-create") }),
        },
      );
      upsertAssessment(payload.assessment, true);
      setMessage("Assessment draft created");
      setActiveSection("identity");
    } catch (createError) {
      setError(messageFor(createError, "The assessment record could not be created."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const beginAssessment = async () => {
    const current = selectedRef.current;
    if (!current || current.started_at || current.signed_at) return;
    setIsBusy(true);
    setError("");
    setMessage("Beginning assessment...");
    try {
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/assessments/${encodeURIComponent(current.assessment_id)}/start`,
        {
          method: "POST",
          body: JSON.stringify({
            if_match: current.version,
            client_mutation_id: mutationId("assessment-start"),
          }),
        },
      );
      upsertAssessment(payload.assessment, true);
      await onAssessmentSaved?.(payload.assessment);
      setMessage("Assessment in progress");
    } catch (startError) {
      setError(messageFor(startError, "The assessment could not be begun."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const receiveRemoteAssessment = useCallback((latest: PipelineAssessmentRecord, announce = true) => {
    const current = selectedRef.current;
    if (!current || current.assessment_id !== latest.assessment_id || latest.version <= current.version) return;
    const base = baseDataRef.current;
    const local = draftRef.current;
    const latestData = pickAssessmentToolData(latest);
    const merged = pickAssessmentToolData(latestData);
    const conflicts: AssessmentFieldConflict[] = [];

    for (const definition of assessmentToolFieldDefinitions) {
      const field = definition.key;
      const localChanged = !sameAssessmentValue(local[field], base[field]);
      const remoteChanged = !sameAssessmentValue(latestData[field], base[field]);
      if (localChanged && remoteChanged && !sameAssessmentValue(local[field], latestData[field])) {
        merged[field] = local[field] as never;
        conflicts.push({ field, localValue: local[field], remoteValue: latestData[field], section: definition.section });
      } else if (localChanged) {
        merged[field] = local[field] as never;
      }
    }

    selectedRef.current = latest;
    baseDataRef.current = latestData;
    draftRef.current = merged;
    setDraft(merged);
    setAssessments((items) => [latest, ...items.filter((item) => item.assessment_id !== latest.assessment_id)]);
    const nextDirty = dirtyAssessmentSections(merged, latestData);
    setDirtySections(nextDirty);
    setRemoteChange({ assessment: latest, conflicts });
    if (announce) {
      setMessage(conflicts.length > 0
        ? `${conflicts.length} field conflict${conflicts.length === 1 ? "" : "s"} need review`
        : `Updated by ${latest.updated_by.name}`);
    }
  }, []);

  const saveSectionNow = useCallback(async (section: AssessmentToolSection) => {
    const current = selectedRef.current;
    if (!current || !dirtySectionsRef.current.has(section)) return;
    if (remoteChangeRef.current?.conflicts.some((conflict) => conflict.section === section)) {
      throw new Error(`Resolve the ${sectionLabels[section]} conflict before saving.`);
    }

    const sentData = editableSectionData(draftRef.current, section);
    try {
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/assessments/${encodeURIComponent(current.assessment_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            section,
            if_match_section: normalizeAssessmentSectionVersions(current.section_versions)[section],
            client_mutation_id: mutationId(`assessment-${section}`),
            patch: { data: sentData },
          }),
        },
      );
      const saved = payload.assessment;
      const savedData = pickAssessmentToolData(saved);
      const local = draftRef.current;
      const nextDraft = pickAssessmentToolData(local);
      for (const field of fieldsForAssessmentSection(section)) {
        const sentValue = sentData[field];
        if (sentValue !== undefined && sameAssessmentValue(local[field], sentValue)) {
          nextDraft[field] = savedData[field] as never;
        }
      }
      selectedRef.current = saved;
      baseDataRef.current = savedData;
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setAssessments((items) => [saved, ...items.filter((item) => item.assessment_id !== saved.assessment_id)]);
      const nextDirty = dirtyAssessmentSections(nextDraft, savedData);
      setDirtySections(nextDirty);
      setMessage(nextDirty.size > 0 ? "Saving changes..." : "All changes saved");
      setError("");
      if (nextDirty.size === 0) void clearRecoveryDraft(saved.assessment_id);
    } catch (saveError) {
      if (saveError instanceof PipelineApiError && saveError.status === 409) {
        const latest = assessmentFromConflict(saveError.payload);
        if (latest) receiveRemoteAssessment(latest);
      }
      setError(messageFor(saveError, `${sectionLabels[section]} could not be saved.`));
      setMessage("");
      throw saveError;
    }
  }, [receiveRemoteAssessment]);

  const queueSectionSave = useCallback((section: AssessmentToolSection) => {
    const next = saveQueueRef.current.then(() => saveSectionNow(section));
    saveQueueRef.current = next.catch(() => undefined);
    return next;
  }, [saveSectionNow]);

  const flushDirtySections = useCallback(async () => {
    for (const section of [...dirtySectionsRef.current]) await queueSectionSave(section);
    await saveQueueRef.current;
  }, [queueSectionSave]);

  const saveAssessment = async (nextStatus = selectedRef.current?.status ?? "draft", acceptPending = false) => {
    const initial = selectedRef.current;
    if (!initial) return;
    setIsBusy(true);
    setError("");
    setMessage(nextStatus === "complete" ? "Checking assessment..." : "Saving assessment...");
    try {
      await flushDirtySections();
      const current = selectedRef.current;
      if (!current) return;
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/assessments/${encodeURIComponent(current.assessment_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            if_match: current.version,
            client_mutation_id: mutationId(`assessment-${nextStatus}`),
            patch: {
              status: nextStatus,
              ...(acceptPending ? { accept_pending: true } : {}),
            },
          }),
        },
      );
      upsertAssessment(payload.assessment, true);
      try {
        await onAssessmentSaved?.(payload.assessment);
      } catch {
        setMessage("Assessment saved; workspace refresh will retry automatically");
        return;
      }
      void clearRecoveryDraft(payload.assessment.assessment_id);
      setMessage(
        nextStatus === "complete"
          ? "Assessment completed"
          : acceptPending
            ? "Imported values confirmed"
            : "Assessment saved",
      );
    } catch (saveError) {
      setError(messageFor(saveError, "The assessment could not be saved."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const signAssessment = async () => {
    setIsBusy(true);
    setError("");
    setMessage("Signing assessment...");
    try {
      await flushDirtySections();
      const current = selectedRef.current;
      if (!current) return;
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/assessments/${encodeURIComponent(current.assessment_id)}/sign`,
        {
          method: "POST",
          body: JSON.stringify({
            if_match: current.version,
            client_mutation_id: mutationId("assessment-sign"),
          }),
        },
      );
      upsertAssessment(payload.assessment, true);
      await onAssessmentSaved?.(payload.assessment);
      void clearRecoveryDraft(payload.assessment.assessment_id);
      setMessage("Assessment signed");
    } catch (signError) {
      setError(messageFor(signError, "The assessment could not be signed."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const saveSchedule = async () => {
    const current = selectedRef.current;
    if (!current || !scheduleStart) return;
    const start = new Date(scheduleStart);
    if (Number.isNaN(start.getTime())) {
      setError("Choose a valid assessment date and time.");
      return;
    }
    setIsBusy(true);
    setError("");
    setMessage("Saving schedule...");
    try {
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/assessments/${encodeURIComponent(current.assessment_id)}/schedule`,
        {
          method: "POST",
          body: JSON.stringify({
            if_match: current.version,
            client_mutation_id: mutationId("assessment-schedule"),
            schedule: {
              status: current.schedule_status === "scheduled" || current.schedule_status === "rescheduled" ? "rescheduled" : "scheduled",
              start_at: start.toISOString(),
              duration_minutes: Number(scheduleDuration),
              method: scheduleMethod,
              location: scheduleLocation.trim(),
            },
          }),
        },
      );
      upsertAssessment(payload.assessment, true);
      await onAssessmentSaved?.(payload.assessment);
      setShowSchedule(false);
      setMessage("Assessment scheduled");
    } catch (scheduleError) {
      setError(messageFor(scheduleError, "The assessment schedule could not be saved."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const addAddendum = async () => {
    const current = selectedRef.current;
    if (!current || !addendumReason.trim() || !addendumNote.trim()) return;
    setIsBusy(true);
    setError("");
    setMessage("Saving addendum...");
    try {
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/assessments/${encodeURIComponent(current.assessment_id)}/addenda`,
        {
          method: "POST",
          body: JSON.stringify({
            if_match: current.version,
            reason_code: addendumReason.trim(),
            note: addendumNote.trim(),
          }),
        },
      );
      upsertAssessment(payload.assessment, true);
      await onAssessmentSaved?.(payload.assessment);
      setAddendumReason("");
      setAddendumNote("");
      setShowAddendum(false);
      setMessage("Addendum added");
    } catch (addendumError) {
      setError(messageFor(addendumError, "The addendum could not be saved."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file || !referralId) return;
    setIsBusy(true);
    setError("");
    setMessage("Reading assessment file...");
    try {
      const parsed = await parseAssessmentFile(file);
      setMessage(`Mapping ${parsed.fields.length} extracted values...`);
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/referrals/${referralId}/assessments/import`,
        {
          method: "POST",
          body: JSON.stringify({
            assessment_id: selected?.assessment_id,
            if_match: selected?.version,
            fields: parsed.fields,
            context: {
              source_file: file.name,
              extraction_date: new Date().toISOString(),
              match_confidence: parsed.matchConfidence,
            },
            client_mutation_id: mutationId("assessment-import"),
          }),
        },
      );
      upsertAssessment(payload.assessment, true);
      setMessage("Extracted values are ready for review");
    } catch (importError) {
      setError(messageFor(importError, "The assessment file could not be imported."));
      setMessage("");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      setIsBusy(false);
    }
  };

  const upsertAssessment = (assessment: PipelineAssessmentRecord, select = false) => {
    setAssessments((current) => [assessment, ...current.filter((item) => item.assessment_id !== assessment.assessment_id)]);
    if (select) setSelectedId(assessment.assessment_id);
    selectedRef.current = assessment;
    const data = pickAssessmentToolData(assessment);
    baseDataRef.current = data;
    draftRef.current = data;
    setDraft(data);
    setDirtySections(new Set());
    setRemoteChange(null);
  };

  const updateField = (key: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => {
    const next = setAssessmentValue(draftRef.current, key, value);
    draftRef.current = next;
    setDraft(next);
    const section = assessmentToolFieldDefinitions.find((definition) => definition.key === key)?.section;
    if (section) {
      setDirtySections((current) => new Set(current).add(section));
    }
    setMessage("Saving changes...");
    setError("");
  };

  async function loadRecoveryDraft(assessment: PipelineAssessmentRecord, currentData: AssessmentToolData) {
    let recovered: PipelineAssessmentDraft | null = null;
    let recoveredVersion = 0;
    try {
      const local = window.sessionStorage.getItem(assessmentDraftStorageKey(assessment.assessment_id));
      if (local) recovered = JSON.parse(local) as PipelineAssessmentDraft;
    } catch {
      // Server recovery remains available when session storage is unavailable.
    }
    try {
      const payload = await fetchPipelineJson<{ draft: PipelineAssessmentDraft | null; version: number }>(
        `/api/me/assessment-drafts/${encodeURIComponent(assessment.assessment_id)}`,
        { cache: "no-store" },
      );
      if (payload.draft && (!recovered || Date.parse(payload.draft.savedAt) >= Date.parse(recovered.savedAt))) {
        recovered = payload.draft;
      }
      recoveredVersion = payload.version;
    } catch {
      // Local recovery is sufficient in development and remains a safe fallback in a transient outage.
    }
    draftVersionRef.current = recoveredVersion;
    if (!recovered || recovered.assessmentId !== assessment.assessment_id || recovered.dirtySections.length === 0) return;

    const merged = pickAssessmentToolData(currentData);
    const conflicts: AssessmentFieldConflict[] = [];
    for (const definition of assessmentToolFieldDefinitions) {
      const field = definition.key;
      const localChanged = !sameAssessmentValue(recovered.data[field], recovered.baseData[field]);
      if (!localChanged) continue;
      const remoteChanged = !sameAssessmentValue(currentData[field], recovered.baseData[field]);
      merged[field] = recovered.data[field] as never;
      if (remoteChanged && !sameAssessmentValue(recovered.data[field], currentData[field])) {
        conflicts.push({
          field,
          localValue: recovered.data[field],
          remoteValue: currentData[field],
          section: definition.section,
        });
      }
    }
    baseDataRef.current = currentData;
    draftRef.current = merged;
    setDraft(merged);
    const recoveredDirty = dirtyAssessmentSections(merged, currentData);
    setDirtySections(recoveredDirty);
    setRemoteChange(conflicts.length > 0 ? { assessment, conflicts } : null);
    setMessage(conflicts.length > 0 ? "Recovered changes need conflict review" : "Recovered unsaved assessment changes");
  }

  async function persistRecoveryDraft(assessment: PipelineAssessmentRecord) {
    if (dirtySectionsRef.current.size === 0) return;
    const recovery: PipelineAssessmentDraft = {
      schema: 1,
      assessmentId: assessment.assessment_id,
      savedAt: new Date().toISOString(),
      baseVersion: assessment.version,
      sectionVersions: normalizeAssessmentSectionVersions(assessment.section_versions),
      dirtySections: [...dirtySectionsRef.current],
      data: pickAssessmentToolData(draftRef.current),
      baseData: pickAssessmentToolData(baseDataRef.current),
    };
    try {
      window.sessionStorage.setItem(assessmentDraftStorageKey(assessment.assessment_id), JSON.stringify(recovery));
    } catch {
      // The server draft remains authoritative when browser storage is unavailable.
    }
    try {
      const payload = await fetchPipelineJson<{ version: number }>(
        `/api/me/assessment-drafts/${encodeURIComponent(assessment.assessment_id)}`,
        {
          method: "PUT",
          body: JSON.stringify({ if_match: draftVersionRef.current, draft: recovery }),
        },
      );
      draftVersionRef.current = payload.version;
    } catch (draftError) {
      if (draftError instanceof PipelineApiError && draftError.status === 409) {
        const payload = draftError.payload as { version?: unknown } | undefined;
        if (Number.isSafeInteger(payload?.version)) draftVersionRef.current = Number(payload?.version);
      }
    }
  }

  async function clearRecoveryDraft(assessmentId: string) {
    try {
      window.sessionStorage.removeItem(assessmentDraftStorageKey(assessmentId));
    } catch {
      // Nothing else is required for browser storage cleanup.
    }
    if (draftVersionRef.current < 1) return;
    try {
      await fetchPipelineJson(`/api/me/assessment-drafts/${encodeURIComponent(assessmentId)}`, {
        method: "DELETE",
        body: JSON.stringify({ if_match: draftVersionRef.current }),
      });
      draftVersionRef.current = 0;
    } catch {
      // Expiring server drafts are harmless once the canonical assessment is saved.
    }
  }

  const resolveAssessmentConflict = (field: AssessmentToolFieldKey, useLatest: boolean) => {
    const change = remoteChangeRef.current;
    const conflict = change?.conflicts.find((item) => item.field === field);
    if (!change || !conflict) return;
    const nextDraft = pickAssessmentToolData(draftRef.current);
    const nextBase = pickAssessmentToolData(baseDataRef.current);
    if (useLatest) nextDraft[field] = conflict.remoteValue as never;
    nextBase[field] = conflict.remoteValue as never;
    draftRef.current = nextDraft;
    baseDataRef.current = nextBase;
    setDraft(nextDraft);
    const remaining = change.conflicts.filter((item) => item.field !== field);
    setRemoteChange(remaining.length > 0 ? { ...change, conflicts: remaining } : null);
    const nextDirty = dirtyAssessmentSections(nextDraft, nextBase);
    setDirtySections(nextDirty);
    setMessage(remaining.length > 0 ? `${remaining.length} field conflicts still need review` : "Conflict resolved; saving changes...");
  };

  useEffect(() => {
    const current = selectedRef.current;
    if (!current || dirtySections.size === 0) return;
    const timer = window.setTimeout(() => {
      for (const section of dirtySections) {
        if (!remoteChangeRef.current?.conflicts.some((conflict) => conflict.section === section)) {
          void queueSectionSave(section);
        }
      }
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [dirtySections, draft, queueSectionSave]);

  useEffect(() => {
    const current = selectedRef.current;
    if (!current || dirtySections.size === 0) return;
    const timer = window.setTimeout(() => void persistRecoveryDraft(current), 350);
    return () => window.clearTimeout(timer);
  }, [dirtySections, draft]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtySectionsRef.current.size === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, []);

  useEffect(() => {
    if (!selected?.assessment_id) return;
    let cancelled = false;
    let checking = false;
    const checkForChanges = async () => {
      if (checking) return;
      checking = true;
      try {
        const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
          `/api/assessments/${encodeURIComponent(selected.assessment_id)}`,
          { cache: "no-store" },
        );
        if (!cancelled) receiveRemoteAssessment(payload.assessment);
      } catch {
        // The next three-second poll retries; local editing and drafts remain available.
      } finally {
        checking = false;
      }
    };
    const interval = window.setInterval(checkForChanges, 3_000);
    const onFocus = () => void checkForChanges();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [receiveRemoteAssessment, selected?.assessment_id]);

  useEffect(() => {
    if (!referralId || !selected?.assessment_id) return;
    const leaseId = crypto.randomUUID();
    let cancelled = false;
    const heartbeat = async () => {
      try {
        await fetchPipelineJson(`/api/referrals/${referralId}/presence`, {
          method: "POST",
          body: JSON.stringify({ lease_id: leaseId, section: `assessment:${activeSection}` }),
        });
        const payload = await fetchPipelineJson<{ presence: Array<EditingPresence & { is_me?: boolean }> }>(
          `/api/referrals/${referralId}/presence`,
          { cache: "no-store" },
        );
        if (!cancelled) setPresence(payload.presence.filter((item) => !item.is_me));
      } catch {
        // Presence is advisory; section versions remain authoritative.
      }
    };
    void heartbeat();
    const interval = window.setInterval(heartbeat, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void fetchPipelineJson(`/api/referrals/${referralId}/presence`, {
        method: "DELETE",
        body: JSON.stringify({ lease_id: leaseId }),
      }).catch(() => undefined);
    };
  }, [activeSection, referralId, selected?.assessment_id]);

  if (!referralId) {
    return (
      <AssessmentEmpty
        title="Save the referral before starting the assessment"
        detail="The assessment needs a referral ID so its history, files, and edits stay attached to one intake episode."
      />
    );
  }

  if (isLoading) {
    return <div className="flex min-h-56 items-center justify-center gap-2 text-[12px] text-[#737373]"><LoaderCircle className="animate-spin" size={16} /> Loading assessment history...</div>;
  }

  if (!selected) {
    return (
      <AssessmentEmpty
        title="No assessment yet"
        detail="Open the questionnaire to review it, import answers, schedule the interview, or enter information directly."
        action={canCreateClinical ? <button type="button" onClick={createAssessmentDraft} disabled={isBusy} className="h-11 bg-[#111111] px-5 text-[12px] font-black text-white hover:bg-[#0f8b73] disabled:opacity-50">Open assessment</button> : null}
        error={error}
      />
    );
  }

  if (!isFocused) {
    return (
      <section aria-label="Assessment" className="flex min-h-48 items-center justify-between gap-5 border border-[#d6ddd9] bg-white px-6 py-8">
        <div>
          <div className="flex items-center gap-2"><h2 className="text-[18px] font-black">Assessment</h2><StatusLabel status={selected.status} /></div>
          <p className="mt-2 text-[12px] text-[#737373]">{completion.complete} of {completion.total} required areas complete · {selected.assessor || "Unassigned"}</p>
        </div>
        <button type="button" onClick={() => setIsFocused(true)} className="h-11 bg-[#111111] px-5 text-[12px] font-black text-white hover:bg-[#0f8b73]">Open assessment</button>
      </section>
    );
  }

  return createPortal(
    <section role="dialog" aria-modal="true" aria-label="Assessment interview" className="fixed inset-0 z-[90] flex h-[100dvh] flex-col overflow-hidden bg-white">
      <header className="relative flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-[#d9dfdb] bg-white px-3 py-2 sm:px-5">
        <button type="button" onClick={() => { setShowMobileActions(false); setIsFocused(false); }} aria-label="Close assessment" title="Close assessment" className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#d6ddd9] text-[#444444] hover:border-[#0f8b73] hover:text-[#0f8b73]"><X size={18} /></button>
        <div className="min-w-[170px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[17px] font-black">{draft.resident_name || "Client"} assessment</h2>
            <StatusLabel status={selected.status} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[#737373]">
            <span>{formatDate(selected.assessment_date)}</span><span aria-hidden="true">·</span><span>{selected.assessor || "Unassigned"}</span>
            {canSupervise && selected.assessor_id !== viewer?.id ? <span className="sr-only">Supervisor access</span> : null}
          </div>
        </div>
        <span aria-live="polite" className={`hidden max-w-[240px] truncate text-[10px] lg:block ${error ? "text-[#a63d2f]" : dirty ? "text-[#9a6115]" : "text-[#737373]"}`}>{error || (dirty ? "Saving changes..." : message || "All changes saved")}</span>
        <div className="relative hidden min-w-[210px] sm:block">
          <History size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#0f8b73]" />
          <select id="assessment-history" aria-label="Assessment history" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="h-10 w-full appearance-none border border-[#c9ceca] bg-white pl-9 pr-9 text-[11px] font-semibold outline-none hover:border-[#8ca59c] focus:border-[#0f8b73]">
            {assessments.map((assessment, index) => <option key={assessment.assessment_id} value={assessment.assessment_id}>{formatDate(assessment.assessment_date)} · {assessment.status.replace("_", " ")}{index === 0 ? " · latest" : ""}</option>)}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" />
        </div>
        {canCreateClinical ? <button type="button" onClick={createAssessmentDraft} disabled={isBusy} aria-label="New assessment" title="New assessment" className="hidden h-10 w-10 items-center justify-center border border-[#c9ceca] hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:opacity-50 sm:flex"><Plus size={17} /></button> : null}
        <button type="button" onClick={() => setShowImport((value) => !value)} aria-label="Import assessment answers" title="Import assessment answers" className={`hidden h-10 items-center gap-2 border px-3 text-[11px] font-black sm:flex ${showImport ? "border-[#0f8b73] bg-[#e7f3ee] text-[#0f6f5d]" : "border-[#c9ceca] hover:border-[#0f8b73] hover:text-[#0f8b73]"}`}><UploadCloud size={15} /> <span className="hidden md:inline">Import</span></button>
        {!selected.signed_at && (canEditClinical || canSupervise) ? <button type="button" onClick={() => setShowSchedule((value) => !value)} disabled={isBusy} aria-label={selected.scheduled_start_at ? "Reschedule assessment" : "Schedule assessment"} title={selected.scheduled_start_at ? "Reschedule assessment" : "Schedule assessment"} className="hidden h-10 items-center gap-2 border border-[#c9ceca] px-3 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:opacity-50 sm:flex"><CalendarClock size={15} /> <span className="hidden md:inline">{selected.scheduled_start_at ? "Reschedule" : "Schedule"}</span></button> : null}
        {!selected.signed_at && !selected.started_at && selected.status !== "complete" && canEditClinical ? <button type="button" onClick={() => void beginAssessment()} disabled={isBusy} className="flex h-10 items-center gap-2 bg-[#111111] px-4 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:opacity-50"><Play size={13} fill="currentColor" /> Begin interview</button> : null}
        {selected.signed_at ? (
          canAddAddendum ? <button type="button" onClick={() => setShowAddendum((value) => !value)} disabled={isBusy} className="flex h-10 items-center gap-2 border border-[#c9ceca] px-3 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73]"><Plus size={14} /> Addendum</button> : <span className="text-[11px] font-black text-[#0f6f5e]">Signed</span>
        ) : selected.started_at && canEditClinical ? (
          <button type="button" onClick={() => window.confirm("Sign and lock this assessment?") && void signAssessment()} disabled={isBusy || completion.missing.length > 0} className="h-10 bg-[#111111] px-4 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:opacity-35">Sign assessment</button>
        ) : null}
        <button type="button" onClick={() => setShowMobileActions((value) => !value)} aria-label="More assessment actions" aria-expanded={showMobileActions} className="flex h-10 w-10 items-center justify-center border border-[#c9ceca] text-[#444444] hover:border-[#0f8b73] hover:text-[#0f8b73] sm:hidden"><MoreHorizontal size={18} /></button>
        {showMobileActions ? (
          <div role="menu" aria-label="Assessment actions" className="absolute right-3 top-[calc(100%+1px)] z-20 w-[min(310px,calc(100vw-24px))] border border-[#c9ceca] bg-white p-2 shadow-[0_12px_30px_rgba(17,17,17,0.12)] sm:hidden">
            {assessments.length > 1 ? <div className="relative mb-2"><History size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#0f8b73]" /><select aria-label="Assessment history" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setShowMobileActions(false); }} className="h-10 w-full appearance-none border border-[#c9ceca] bg-white pl-9 pr-9 text-[11px] font-semibold outline-none focus:border-[#0f8b73]">{assessments.map((assessment, index) => <option key={assessment.assessment_id} value={assessment.assessment_id}>{formatDate(assessment.assessment_date)} · {assessment.status.replace("_", " ")}{index === 0 ? " · latest" : ""}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" /></div> : null}
            {canCreateClinical ? <button role="menuitem" type="button" onClick={() => { setShowMobileActions(false); void createAssessmentDraft(); }} disabled={isBusy} className="flex h-10 w-full items-center gap-3 px-3 text-left text-[11px] font-black hover:bg-[#f4f7f5] disabled:opacity-50"><Plus size={15} /> New assessment</button> : null}
            <button role="menuitem" type="button" onClick={() => { setShowMobileActions(false); setShowImport((value) => !value); }} className="flex h-10 w-full items-center gap-3 px-3 text-left text-[11px] font-black hover:bg-[#f4f7f5]"><UploadCloud size={15} /> Import answers</button>
            {!selected.signed_at && (canEditClinical || canSupervise) ? <button role="menuitem" type="button" onClick={() => { setShowMobileActions(false); setShowSchedule((value) => !value); }} disabled={isBusy} className="flex h-10 w-full items-center gap-3 px-3 text-left text-[11px] font-black hover:bg-[#f4f7f5] disabled:opacity-50"><CalendarClock size={15} /> {selected.scheduled_start_at ? "Reschedule" : "Schedule"}</button> : null}
          </div>
        ) : null}
      </header>

      {showSchedule ? (
        <div className="grid shrink-0 gap-3 border-b border-[#d9dfdb] bg-[#f8faf9] px-4 py-4 sm:grid-cols-[minmax(210px,1fr)_100px_150px_minmax(180px,1fr)_auto] sm:items-end">
          <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Date and time</span><input type="datetime-local" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} className="mt-1 h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none focus:border-[#0f8b73]" /></label>
          <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Minutes</span><input type="number" min={15} max={480} step={15} value={scheduleDuration} onChange={(event) => setScheduleDuration(event.target.value)} className="mt-1 h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none focus:border-[#0f8b73]" /></label>
          <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Method</span><span className="relative mt-1 block"><select value={scheduleMethod} onChange={(event) => setScheduleMethod(event.target.value as typeof scheduleMethod)} className="h-10 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-9 text-[12px] outline-none hover:border-[#8ca59c] focus:border-[#0f8b73]"><option value="in_person">In person</option><option value="video">Video</option><option value="phone">Phone</option><option value="record_review">Record review</option></select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" /></span></label>
          <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Location or link</span><input value={scheduleLocation} maxLength={500} onChange={(event) => setScheduleLocation(event.target.value)} className="mt-1 h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none focus:border-[#0f8b73]" /></label>
          <button type="button" onClick={() => void saveSchedule()} disabled={isBusy || !scheduleStart || Number(scheduleDuration) < 15} className="h-10 bg-[#111111] px-5 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:bg-[#c9ceca]">Save schedule</button>
        </div>
      ) : null}

      {showAddendum ? (
        <div className="shrink-0 border-b border-[#d9dfdb] bg-[#f8faf9] px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-end">
            <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Reason</span><input value={addendumReason} maxLength={128} onChange={(event) => setAddendumReason(event.target.value)} placeholder="Correction or later information" className="mt-1 h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none focus:border-[#0f8b73]" /></label>
            <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Addendum</span><textarea value={addendumNote} maxLength={20_000} rows={2} onChange={(event) => setAddendumNote(event.target.value)} className="mt-1 w-full resize-y border border-[#c9ceca] bg-white px-3 py-2 text-[12px] leading-5 outline-none focus:border-[#0f8b73]" /></label>
            <button type="button" onClick={() => void addAddendum()} disabled={isBusy || !addendumReason.trim() || !addendumNote.trim()} className="h-10 bg-[#111111] px-5 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:bg-[#c9ceca]">Add</button>
          </div>
        </div>
      ) : null}

      {selected.signed_at ? (
        <div className="shrink-0 border-b border-[#d9dfdb] px-4 py-3 text-[11px] text-[#595959]">
          Signed by <strong>{selected.signed_by?.name ?? selected.assessor ?? "Assigned assessor"}</strong> on {new Date(selected.signed_at).toLocaleString()}.
          {(selected.addenda ?? []).length > 0 ? (
            <div className="mt-3 divide-y divide-[#e5e5e5] border-y border-[#e5e5e5]">
              {(selected.addenda ?? []).map((addendum) => <div key={addendum.addendum_id} className="py-3"><div className="font-black text-[#111111]">{addendum.reason_code}</div><div className="mt-1 whitespace-pre-wrap leading-5">{addendum.note}</div><div className="mt-1 text-[9px] text-[#737373]">{addendum.authored_by_name} · {new Date(addendum.created_at).toLocaleString()}</div></div>)}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[230px] shrink-0 overflow-y-auto border-r border-[#d9dfdb] bg-[#f8faf9] px-3 py-4 lg:block">
          <div className="mb-5 px-2">
            <div className="flex items-end justify-between"><span className="text-[10px] font-black uppercase text-[#666666]">Required</span><strong className="text-[15px]">{completion.complete}/{completion.total}</strong></div>
            <div className="mt-2 h-1.5 bg-[#dfe5e1]"><div className="h-full bg-[#0f8b73] transition-[width]" style={{ width: `${completion.percent}%` }} /></div>
            <p className="mt-2 text-[10px] leading-4 text-[#737373]">{completion.missing.length ? `${completion.missing.length} required areas remain` : "Ready to sign"}</p>
          </div>
          <nav aria-label="Assessment sections" className="space-y-5">
            {assessmentNavigationGroups.map((group) => (
              <div key={group.label}>
                <div className="px-2 text-[9px] font-black uppercase tracking-[0.08em] text-[#8a8a8a]">{group.label}</div>
                <div className="mt-1 space-y-0.5">
                  {group.sections.map((sectionKey) => {
                    const section = assessmentInterviewSections.find((candidate) => candidate.key === sectionKey);
                    if (!section) return null;
                    const questions = getAssessmentInterviewQuestions(section.key, draft);
                    const filled = questions.filter((question) => hasAssessmentInterviewValue(draft[question.field])).length;
                    const active = activeSection === section.key;
                    return <button key={section.key} type="button" onClick={() => setActiveSection(section.key)} aria-current={active ? "step" : undefined} className={`flex w-full items-center justify-between gap-3 border-l-2 px-3 py-2.5 text-left text-[11px] font-black transition-colors ${active ? "border-[#0f8b73] bg-[#e7f3ee] text-[#0f6f5d]" : "border-transparent text-[#595959] hover:bg-white hover:text-[#0f8b73]"}`}><span>{section.label}</span><span className="text-[9px] font-semibold opacity-65">{filled}/{questions.length}</span></button>;
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto bg-white">
          <div className="border-b border-[#d9dfdb] px-4 py-3 lg:hidden">
            <label htmlFor="assessment-section-mobile" className="mb-1 block text-[9px] font-black uppercase text-[#737373]">Assessment section</label>
            <div className="relative">
              <select id="assessment-section-mobile" value={activeSection} onChange={(event) => setActiveSection(event.target.value as AssessmentToolSection)} className="h-11 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-10 text-[12px] font-black outline-none focus:border-[#0f8b73]">{assessmentNavigationGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.sections.map((sectionKey) => { const section = assessmentInterviewSections.find((candidate) => candidate.key === sectionKey); return section ? <option key={section.key} value={section.key}>{section.label}</option> : null; })}</optgroup>)}</select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" />
            </div>
          </div>

          {error ? <div role="alert" className="border-b border-[#e1b6ad] bg-[#fff5f2] px-5 py-3 text-[11px] font-semibold text-[#a63d2f]">{error}</div> : null}
          {presence.some((item) => item.section === `assessment:${activeSection}`) ? (
            <div className="border-b border-[#c9d9d3] bg-[#f2f8f5] px-5 py-2 text-[11px] text-[#315e50]">
          {presence
            .filter((item) => item.section === `assessment:${activeSection}`)
            .map((item) => item.actor_name)
            .join(", ")} {presence.filter((item) => item.section === `assessment:${activeSection}`).length === 1 ? "is" : "are"} also editing {sectionLabels[activeSection]}.
            </div>
          ) : null}

          {remoteChange ? (
            <div className={`border-b px-5 py-3 ${remoteChange.conflicts.length > 0 ? "border-[#d9b56c] bg-[#fff8e9]" : "border-[#a9d2c3] bg-[#f2faf7]"}`}>
          <div className="flex items-center gap-2 text-[11px] font-black text-[#333333]">
            <RefreshCw size={13} className="text-[#0f8b73]" />
            {remoteChange.conflicts.length > 0
              ? `${remoteChange.assessment.updated_by.name} changed fields you were editing.`
              : `Latest changes from ${remoteChange.assessment.updated_by.name} were merged.`}
          </div>
          {remoteChange.conflicts.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {remoteChange.conflicts.map((conflict) => {
                const definition = assessmentToolFieldDefinitions.find((item) => item.key === conflict.field);
                return (
                  <div key={conflict.field} className="grid gap-2 border-t border-[#e5cf9d] pt-2 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-center">
                    <div className="text-[11px] font-black">{definition?.label ?? conflict.field}</div>
                    <div className="min-w-0 text-[10px] text-[#595959]">
                      <span className="font-semibold">Yours:</span> {displayAssessmentValue(conflict.localValue)}
                      <span className="mx-2 text-[#9a6115]">|</span>
                      <span className="font-semibold">Latest:</span> {displayAssessmentValue(conflict.remoteValue)}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => resolveAssessmentConflict(conflict.field, false)} className="h-8 border border-[#9a6115] px-3 text-[10px] font-black text-[#7a4c0d] hover:bg-white">Keep mine</button>
                      <button type="button" onClick={() => resolveAssessmentConflict(conflict.field, true)} className="h-8 bg-[#111111] px-3 text-[10px] font-black text-white hover:bg-[#0f8b73]">Use latest</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
            </div>
          ) : null}

          {showImport ? <AssessmentImport busy={isBusy || Boolean(selected.signed_at) || !canEditClinical} pendingFields={pendingFields} assessment={selected} inputRef={fileInputRef} onFile={importFile} onConfirm={() => saveAssessment("draft", true)} onOpenField={(field) => { const definition = assessmentToolFieldDefinitions.find((candidate) => candidate.key === field); if (definition) { setActiveSection(definition.section); setShowImport(false); } }} /> : null}

          <div className="mx-auto max-w-[980px] px-5 py-7 sm:px-8">
            <div className="mb-7 flex flex-wrap items-start justify-between gap-4 border-b border-[#d9dfdb] pb-5">
              <div className="max-w-2xl">
                <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Section {activeSectionIndex + 1} of {assessmentInterviewSections.length}</div>
                <h3 className="mt-1 text-[22px] font-black">{sectionDefinition.label}</h3>
                <p className="mt-1 text-[12px] leading-5 text-[#737373]">{sectionDefinition.description}</p>
                <p className={`mt-3 text-[11px] font-semibold ${selected.started_at ? "text-[#315e50]" : "text-[#9a6115]"}`}>{!selected.started_at ? "Review the questionnaire now. Choose Begin interview when you are ready to enter answers." : nextUnansweredQuestion ? `Next: ${assessmentInterviewFieldLabel(nextUnansweredQuestion.field)}` : "This section is complete. Continue when ready."}</p>
              </div>
              <div className="text-right"><div className="text-[18px] font-black">{activeSectionCaptured}/{sectionQuestions.length}</div><div className="text-[9px] font-black uppercase text-[#8a8a8a]">captured here</div></div>
            </div>
            <div className="divide-y divide-[#e1e4e2] border-y border-[#e1e4e2]">
          {sectionGroups.map((group) => (
            <div key={group.label} className="grid gap-4 py-5 lg:grid-cols-[190px_minmax(0,1fr)]">
              <div>
                <h4 className="text-[11px] font-black text-[#333333]">{group.label}</h4>
                <p className="mt-1 text-[10px] leading-4 text-[#8a8a8a]">Answer what is known; conditional follow-ups appear as needed.</p>
              </div>
              <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
                {group.questions.map((question) => {
                  const definition = assessmentToolFieldDefinitions.find((candidate) => candidate.key === question.field);
                  if (!definition) return null;
                  return (
                    <AssessmentField
                      key={question.field}
                      definition={definition}
                      question={question}
                      value={draft[question.field]}
                      unableReason={getAssessmentUnableReason(draft, question.field)}
                      required={requiredInterviewFields.has(question.field)}
                      pending={pendingFields.includes(question.field)}
                      disabled={Boolean(selected.signed_at) || !selected.started_at || !canEditClinical}
                      onChange={(value) => updateField(question.field, value)}
                      onUnableReasonChange={(reason) => updateField(
                        "unable_to_assess_reasons",
                        setAssessmentUnableReason(draftRef.current.unable_to_assess_reasons, question.field, reason),
                      )}
                    />
                  );
                })}
              </div>
            </div>
          ))}
            </div>

            <div className="mt-7 flex items-center justify-between gap-3">
              <button type="button" onClick={() => setActiveSection(assessmentInterviewSections[Math.max(0, activeSectionIndex - 1)].key)} disabled={activeSectionIndex <= 0} className="flex h-10 items-center gap-2 border border-[#c9ceca] px-4 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:opacity-35"><ChevronLeft size={14} /> Previous</button>
              <button type="button" onClick={() => setActiveSection(assessmentInterviewSections[Math.min(assessmentInterviewSections.length - 1, activeSectionIndex + 1)].key)} disabled={activeSectionIndex >= assessmentInterviewSections.length - 1} className="flex h-10 items-center gap-2 bg-[#111111] px-4 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:opacity-35">Next section <ChevronRight size={14} /></button>
            </div>

            {selected.unmapped_fields.length > 0 ? (
              <details className="mt-7 border-t border-[#d9dfdb] py-4">
          <summary className="cursor-pointer text-[12px] font-black text-[#9a6115]">{selected.unmapped_fields.length} banked values need mapping</summary>
          <div className="mt-3 divide-y divide-[#e1e4e2] border-y border-[#e1e4e2]">
            {selected.unmapped_fields.map((field, index) => (
              <div key={`${field.source_field_key}-${index}`} className="grid gap-1 py-3 text-[11px] sm:grid-cols-[220px_90px_minmax(0,1fr)]">
                <span className="font-black text-[#333333]">{field.source_field_key}</span>
                <span className="text-[#8a5a10]">{field.reason ?? "unmapped"}</span>
                <span className="break-words text-[#595959]">{field.value || "No value"}</span>
              </div>
            ))}
          </div>
              </details>
            ) : null}
          </div>
        </main>

        <aside className="hidden w-[270px] shrink-0 overflow-y-auto border-l border-[#d9dfdb] bg-[#fbfcfb] px-5 py-5 xl:block">
          <h3 className="text-[12px] font-black">Interview guide</h3>
          <p className="mt-1 text-[10px] leading-4 text-[#737373]">Answers save automatically. Conditional questions appear only when relevant.</p>
          <div className="mt-5 border-y border-[#d9dfdb] py-4">
            <div className="flex items-end justify-between"><span className="text-[9px] font-black uppercase text-[#737373]">Overall progress</span><strong className="text-[20px]">{completion.percent}%</strong></div>
            <div className="mt-2 h-1.5 bg-[#dfe5e1]"><div className="h-full bg-[#0f8b73]" style={{ width: `${completion.percent}%` }} /></div>
            <p className="mt-2 text-[10px] text-[#737373]">{coverage.captured} of {coverage.total} total fields captured</p>
          </div>
          <div className="mt-5">
            <div className="text-[9px] font-black uppercase text-[#737373]">Key answers</div>
            <div className="mt-2 divide-y divide-[#e1e4e2]">
              {interviewSnapshot.map((item) => <button key={item.label} type="button" onClick={() => setActiveSection(item.section)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:text-[#0f8b73]"><span className="text-[10px] font-semibold text-[#595959]">{item.label}</span><span className={`text-[10px] font-black ${item.value === "Not answered" ? "text-[#9a6115]" : "text-[#111111]"}`}>{item.value}</span></button>)}
            </div>
          </div>
          {completion.missing.length > 0 ? <div className="mt-5"><div className="text-[9px] font-black uppercase text-[#737373]">Still required</div><div className="mt-2 space-y-2">{completion.missing.slice(0, 6).map((item) => <div key={item.key} className="text-[10px] leading-4 text-[#595959]">{item.label}</div>)}</div>{completion.missing.length > 6 ? <div className="mt-2 text-[9px] text-[#8a8a8a]">+ {completion.missing.length - 6} more</div> : null}</div> : null}
        </aside>
      </div>
    </section>,
    document.body,
  );
}

function AssessmentImport({
  busy,
  pendingFields,
  assessment,
  inputRef,
  onFile,
  onConfirm,
  onOpenField,
}: {
  busy: boolean;
  pendingFields: AssessmentToolFieldKey[];
  assessment: PipelineAssessmentRecord;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File | undefined) => void;
  onConfirm: () => void;
  onOpenField: (field: AssessmentToolFieldKey) => void;
}) {
  return (
    <div className="border-t border-[#d9dfdb] bg-[#fbfdfc] px-4 py-4">
      <div className="grid items-start gap-4 lg:grid-cols-[310px_minmax(0,1fr)]">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onFile(event.dataTransfer.files[0]);
          }}
          disabled={busy}
          className="flex min-h-24 items-center gap-4 border border-dashed border-[#8cb9aa] bg-white px-4 text-left hover:border-[#0f8b73] disabled:opacity-50"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-[#e7f3ee] text-[#0f8b73]"><UploadCloud size={19} /></span>
          <span>
            <span className="block text-[12px] font-black">Drop assessment file</span>
            <span className="mt-1 block text-[10px] leading-4 text-[#737373]">CSV or JSON locally. XLSX routes to Azure when connected.</span>
          </span>
        </button>
        <input ref={inputRef} type="file" accept=".csv,.tsv,.json,.xlsx,.xls" className="hidden" aria-label="Upload assessment file" onChange={(event) => onFile(event.target.files?.[0])} />

        <div aria-label="Imported assessment values" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[12px] font-black"><FileSpreadsheet size={15} className="text-[#0f8b73]" /> Imported values</div>
              <div className="mt-1 text-[10px] text-[#737373]">{assessment.source_file || "No assessment file imported"}</div>
            </div>
            {pendingFields.length > 0 ? <button type="button" onClick={onConfirm} disabled={busy} className="flex h-9 items-center gap-2 bg-[#0f8b73] px-3 text-[11px] font-black text-white hover:bg-[#0b6d5b] disabled:opacity-50"><Check size={14} /> Confirm {pendingFields.length} values</button> : null}
          </div>
          {pendingFields.length > 0 ? (
            <div className="mt-3 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {pendingFields.map((field) => {
                const definition = assessmentToolFieldDefinitions.find((candidate) => candidate.key === field);
                return (
                  <button key={field} type="button" onClick={() => onOpenField(field)} className="flex min-w-0 items-center justify-between gap-2 border-b border-[#d9dfdb] px-2 py-2 text-left hover:bg-white">
                    <span className="truncate text-[11px] font-semibold">{definition?.label ?? field}</span>
                    <ChevronRight size={13} className="shrink-0 text-[#0f8b73]" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 text-[11px] text-[#737373]"><CheckCircle2 size={14} className="text-[#0f8b73]" /> No imported values are waiting for review.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssessmentField({
  definition,
  question,
  value,
  unableReason,
  required,
  pending,
  disabled,
  onChange,
  onUnableReasonChange,
}: {
  definition: AssessmentToolFieldDefinition;
  question: AssessmentInterviewQuestion;
  value: AssessmentToolData[AssessmentToolFieldKey];
  unableReason: string;
  required: boolean;
  pending: boolean;
  disabled: boolean;
  onChange: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
  onUnableReasonChange: (reason: string) => void;
}) {
  const id = `assessment-${definition.key}`;
  const readOnly = disabled || extractionOwnedFields.has(definition.key);
  const stringValue = Array.isArray(value) ? value.join("\n") : value === null ? "" : String(value);
  const options = question.options ?? [];
  const selectedValues = Array.isArray(value) ? value : [];
  const extraOptions = selectedValues
    .filter((selected) => !options.some((option) => option.value === selected))
    .map((selected) => ({ value: selected, label: selected }));
  const selectHasCurrentValue = typeof value === "string" && value.length > 0 && !options.some((option) => option.value === value);

  return (
    <div className={question.span === "full" ? "md:col-span-2" : ""}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-black text-[#444444]">{definition.label}{required ? " *" : ""}</label>
        {pending ? <span className="bg-[#fff3dc] px-2 py-0.5 text-[9px] font-black uppercase text-[#9a6115]">Review</span> : hasValue(value) ? <Check size={12} className="text-[#0f8b73]" /> : required ? <span className="text-[9px] font-semibold uppercase text-[#9a6115]">Required</span> : <span className="text-[9px] font-semibold uppercase text-[#999999]">Optional</span>}
      </div>
      {question.control === "yes_no" ? (
        <>
          <div id={id} className="grid min-h-10 grid-cols-[0.7fr_0.7fr_1.35fr]" role="group" aria-label={definition.label}>
            {(question.options ?? []).map((option) => {
              const active = value === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={readOnly}
                  aria-pressed={active}
                  onClick={() => {
                    if (option.value !== "unable_to_assess" && value === "unable_to_assess") onUnableReasonChange("");
                    onChange(option.value);
                  }}
                  className={`border border-r-0 px-2 py-2 text-[10px] font-black leading-4 transition-colors last:border-r ${active ? "border-[#0f8b73] bg-[#e7f3ee] text-[#0f6f5d]" : "border-[#c9ceca] bg-white text-[#737373] hover:bg-[#f4f7f5]"} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {value === "unable_to_assess" ? (
            <div className="mt-2 border-l-2 border-[#c9892a] bg-[#fffaf0] px-3 py-2.5">
              <label htmlFor={`${id}-unable-reason`} className="text-[10px] font-black text-[#70480d]">Why could this not be assessed? *</label>
              <textarea
                id={`${id}-unable-reason`}
                value={unableReason}
                readOnly={readOnly}
                required
                rows={3}
                maxLength={2000}
                onChange={(event) => onUnableReasonChange(event.target.value)}
                placeholder="Record the missing source, unavailable client response, or other reason."
                className="mt-1.5 w-full resize-y border border-[#d7bd8e] bg-white px-3 py-2 text-[11px] leading-5 outline-none placeholder:text-[#a58b65] focus:border-[#9a6115] read-only:bg-[#f5f1e9]"
              />
              {!unableReason.trim() ? <p className="mt-1 text-[9px] font-semibold text-[#9a6115]">An explanation is required before this assessment can be signed.</p> : null}
            </div>
          ) : null}
        </>
      ) : question.control === "rating" ? (
        <div id={id} className="grid h-10 grid-cols-5" role="group" aria-label={`${definition.label}, 1 through 5`}>
          {[1, 2, 3, 4, 5].map((rating) => {
            const active = value === rating;
            return <button key={rating} type="button" disabled={readOnly} aria-pressed={active} onClick={() => onChange(rating)} className={`border border-r-0 text-[11px] font-black last:border-r ${active ? "border-[#0f8b73] bg-[#e7f3ee] text-[#0f6f5d]" : "border-[#c9ceca] bg-white text-[#737373] hover:bg-[#f4f7f5]"} disabled:cursor-not-allowed disabled:opacity-60`}>{rating}</button>;
          })}
        </div>
      ) : question.control === "select" ? (
        <div className="relative">
          <select id={id} value={stringValue} disabled={readOnly} onChange={(event) => onChange(event.target.value || null)} className="h-10 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-9 text-[12px] outline-none transition-colors hover:border-[#8ca59c] focus:border-[#0f8b73] disabled:bg-[#f4f6f5] disabled:text-[#737373]">
            <option value="">Select...</option>
            {selectHasCurrentValue ? <option value={stringValue}>{stringValue}</option> : null}
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" />
        </div>
      ) : question.control === "multi_select" ? (
        <div id={id} className="grid gap-px border border-[#c9ceca] bg-[#d9dfdb] sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={definition.label}>
          {[...options, ...extraOptions].map((option) => {
            const active = selectedValues.includes(option.value);
            return (
              <label key={option.value} className={`flex min-h-10 items-center gap-2 bg-white px-3 text-[11px] font-semibold ${readOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-[#f4f7f5]"}`}>
                <input type="checkbox" checked={active} disabled={readOnly} onChange={() => onChange(active ? selectedValues.filter((item) => item !== option.value) : [...selectedValues, option.value])} className="h-4 w-4 accent-[#0f8b73]" />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : question.control === "textarea" ? (
        <textarea
          id={id}
          value={stringValue}
          readOnly={readOnly}
          rows={definition.value_type === "string_list" ? 3 : 4}
          onChange={(event) => onChange(definition.value_type === "string_list" ? listFromLines(event.target.value) : event.target.value || null)}
          placeholder={question.placeholder ?? (definition.value_type === "string_list" ? "One item per line" : "Enter assessment detail")}
          className="w-full resize-y border border-[#c9ceca] bg-white px-3 py-2 text-[12px] leading-5 outline-none placeholder:text-[#a3a3a3] focus:border-[#0f8b73] read-only:bg-[#f4f6f5]"
        />
      ) : (
        <input
          id={id}
          type={question.control === "date" ? "date" : question.control === "number" ? "number" : "text"}
          min={question.min ?? (definition.value_type === "integer" || definition.value_type === "confidence" ? 0 : undefined)}
          max={question.max ?? (definition.value_type === "confidence" ? 1 : undefined)}
          step={definition.value_type === "confidence" ? 0.01 : definition.value_type === "integer" ? 1 : undefined}
          value={stringValue}
          readOnly={readOnly}
          placeholder={question.placeholder}
          onChange={(event) => onChange(
            definition.value_type === "integer" || definition.value_type === "confidence"
              ? event.target.value === "" ? null : Number(event.target.value)
              : event.target.value || null,
          )}
          className="h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none placeholder:text-[#a3a3a3] focus:border-[#0f8b73] read-only:bg-[#f4f6f5]"
        />
      )}
      {question.help ? <p className="mt-1.5 text-[10px] leading-4 text-[#737373]">{question.help}</p> : null}
    </div>
  );
}

function AssessmentEmpty({ title, detail, action, error }: { title: string; detail: string; action?: React.ReactNode; error?: string }) {
  return (
    <section className="flex min-h-64 items-center justify-center border border-[#d6ddd9] bg-white px-6 py-12 text-center">
      <div className="max-w-lg">
        <FileSpreadsheet size={25} className="mx-auto text-[#0f8b73]" />
        <h2 className="mt-4 text-[17px] font-black">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-5 text-[#737373]">{detail}</p>
        {action ? <div className="mt-5">{action}</div> : null}
        {error ? <div role="alert" className="mt-4 flex items-center justify-center gap-2 text-[11px] text-[#a63d2f]"><AlertTriangle size={13} /> {error}</div> : null}
      </div>
    </section>
  );
}

function StatusLabel({ status }: { status: PipelineAssessmentRecord["status"] }) {
  const style = status === "complete" ? "bg-[#e7f3ee] text-[#0f6f5d]" : status === "needs_review" ? "bg-[#fff3dc] text-[#8a5a10]" : "bg-[#eef1f6] text-[#4e6177]";
  return <span className={`px-2 py-1 text-[9px] font-black uppercase ${style}`}>{status.replace("_", " ")}</span>;
}

function getPendingFields(assessment: PipelineAssessmentRecord | null) {
  if (!assessment) return [];
  return assessmentToolFieldDefinitions
    .filter((definition) => assessment.field_provenance[definition.key]?.at(-1)?.review_status === "pending")
    .map((definition) => definition.key);
}

function editableSectionData(data: AssessmentToolData, section: AssessmentToolSection) {
  return Object.fromEntries(
    assessmentToolFieldDefinitions
      .filter((definition) => definition.section === section && !extractionOwnedFields.has(definition.key))
      .map((definition) => [definition.key, data[definition.key]]),
  ) as Partial<AssessmentToolData>;
}

function dirtyAssessmentSections(data: AssessmentToolData, base: AssessmentToolData) {
  const sections = new Set<AssessmentToolSection>();
  for (const definition of assessmentToolFieldDefinitions) {
    if (!extractionOwnedFields.has(definition.key) && !sameAssessmentValue(data[definition.key], base[definition.key])) {
      sections.add(definition.section);
    }
  }
  return sections;
}

function sameAssessmentValue(
  left: AssessmentToolData[AssessmentToolFieldKey],
  right: AssessmentToolData[AssessmentToolFieldKey],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assessmentFromConflict(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const assessment = (payload as { assessment?: unknown }).assessment;
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) return null;
  const candidate = assessment as Partial<PipelineAssessmentRecord>;
  return typeof candidate.assessment_id === "string" && Number.isSafeInteger(candidate.version)
    ? assessment as PipelineAssessmentRecord
    : null;
}

function assessmentDraftStorageKey(assessmentId: string) {
  return `pipeline:assessment-draft:${assessmentId}`;
}

function displayAssessmentValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return value.join(", ") || "Empty";
  if (value && typeof value === "object") {
    const text = Object.entries(value)
      .map(([field, reason]) => `${assessmentInterviewFieldLabel(field as AssessmentToolFieldKey)}: ${reason}`)
      .join("; ");
    return text.length === 0 ? "Empty" : text.length > 180 ? `${text.slice(0, 177)}...` : text;
  }
  if (value === null || String(value).trim() === "") return "Empty";
  const text = String(value);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function setAssessmentValue(
  data: AssessmentToolData,
  key: AssessmentToolFieldKey,
  value: AssessmentToolData[AssessmentToolFieldKey],
) {
  const next = pickAssessmentToolData(data);
  const target = next as unknown as Record<AssessmentToolFieldKey, AssessmentToolData[AssessmentToolFieldKey]>;
  target[key] = Array.isArray(value) ? [...value] : value && typeof value === "object" ? { ...value } : value;
  return next;
}

function groupAssessmentQuestions(questions: readonly AssessmentInterviewQuestion[]) {
  const groups: Array<{ label: string; questions: AssessmentInterviewQuestion[] }> = [];
  for (const question of questions) {
    const current = groups.at(-1);
    if (!current || current.label !== question.group) groups.push({ label: question.group, questions: [question] });
    else current.questions.push(question);
  }
  return groups;
}

function listFromLines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function hasValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null;
}

let mutationSequence = 0;

function mutationId(prefix: string) {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  mutationSequence += 1;
  return `${prefix}-${Date.now()}-${mutationSequence.toString(36)}`;
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDate(value: string | null) {
  if (!value) return "Date not entered";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function toLocalDateTimeInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
