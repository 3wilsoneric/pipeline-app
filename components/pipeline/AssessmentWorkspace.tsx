"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

import {
  fetchCurrentPipelineUser,
  fetchPipelineJson,
  PipelineApiError,
  type PipelineCurrentUser,
} from "@/lib/auth/authenticated-fetch";
import PipelineArcadeLoader from "@/components/pipeline/PipelineArcadeLoader";
import { getAssessmentCompletionSummary } from "@/lib/assessment/assessment-completion";
import type {
  AssessmentListResponse,
  PipelineAssessmentRecord,
} from "@/lib/assessment/assessment-records";
import { getAssessmentFieldWritingSpec } from "@/lib/assessment/assessment-field-writing-spec";
import {
  assessmentToolFieldDefinitions,
  createEmptyAssessmentToolData,
  pickAssessmentToolData,
  type AssessmentFieldProvenance,
  type AssessmentToolData,
  type AssessmentToolFieldDefinition,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
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
import { usesServerUserWorkspaceState } from "@/lib/pipeline/user-workspace-state-client";
import {
  flushOfflineAssessmentMutations,
  initializeOfflineAssessmentStore,
  loadOfflineAssessmentDraft,
  loadOfflineAssessmentWorkingSet,
  pendingOfflineAssessmentMutations,
  queueOfflineAssessmentMutation,
  removeOfflineAssessmentDraft,
  removeOfflineAssessmentWorkingSet,
  saveOfflineAssessmentDraft,
  saveOfflineAssessmentWorkingSet,
} from "@/lib/offline/offline-assessment-store";
import {
  buildTrainingAssessment,
  type TrainingAssessmentMode,
} from "@/lib/training/mock-assessment";
import {
  assessmentPracticeSectionGuidance,
  getAssessmentPracticeReview,
} from "@/lib/training/assessment-practice";

type AssessmentWorkspaceProps = {
  referralId?: number;
  trainingAssessmentMode?: TrainingAssessmentMode;
  assignedAssessorId?: string;
  packetEvidenceVersion?: string;
  onSummaryChange?: (summary: {
    captured: number;
    total: number;
    status: string;
    assessmentId?: string;
    scheduledStartAt?: string | null;
    startedAt?: string | null;
    signedAt?: string | null;
  }) => void;
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

const assessmentSectionGuideTargets: Readonly<Record<AssessmentToolSection, string>> = {
  identity: "assessment-section-identity",
  prior_placement: "assessment-section-prior-placement",
  prior_history: "assessment-section-history",
  diagnosis_clinical: "assessment-section-clinical",
  functional_adl: "assessment-section-function",
  medication: "assessment-section-medication",
  substance_use: "assessment-section-substance-use",
  behavioral_risk: "assessment-section-behavior-safety",
  physical_health: "assessment-section-physical-health",
  legal_conservatorship: "assessment-section-legal",
  social_support: "assessment-section-support-goals",
  provenance_qc: "assessment-section-review",
};

const assessmentSectionGuideTargetList = Object.values(assessmentSectionGuideTargets).join(" ");

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

export default function AssessmentWorkspace({ referralId, trainingAssessmentMode, assignedAssessorId, packetEvidenceVersion, onSummaryChange, onAssessmentSaved }: AssessmentWorkspaceProps) {
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
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showBeginDialog, setShowBeginDialog] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleDuration, setScheduleDuration] = useState("60");
  const [scheduleMethod, setScheduleMethod] = useState<"in_person" | "phone" | "zoom" | "record_review">("in_person");
  const [scheduleLocation, setScheduleLocation] = useState("");
  const [showAddendum, setShowAddendum] = useState(false);
  const [addendumReason, setAddendumReason] = useState("");
  const [addendumNote, setAddendumNote] = useState("");
  const [viewer, setViewer] = useState<PipelineCurrentUser | null>(null);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [pendingOfflineSaves, setPendingOfflineSaves] = useState(0);
  const selectedRef = useRef<PipelineAssessmentRecord | null>(null);
  const draftRef = useRef<AssessmentToolData>(draft);
  const baseDataRef = useRef<AssessmentToolData>(draft);
  const dirtySectionsRef = useRef<Set<AssessmentToolSection>>(dirtySections);
  const remoteChangeRef = useRef<AssessmentRemoteChange | null>(remoteChange);
  const draftVersionRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const initializedAssessmentIdRef = useRef("");
  const focusedAssessmentIdRef = useRef("");
  const packetSyncKeysRef = useRef(new Set<string>());
  const dirty = dirtySections.size > 0;
  const offlinePrincipal = assessmentOfflinePrincipal(trainingAssessmentMode, viewer);

  const selected = assessments.find((assessment) => assessment.assessment_id === selectedId) ?? null;
  const canSupervise = canSuperviseAssessment(trainingAssessmentMode, viewer);
  const canCreateClinical = canCreateAssessment(trainingAssessmentMode, viewer);
  const canEditClinical = canEditAssessment(trainingAssessmentMode, viewer, selected, canSupervise);
  const canCreateAssignedAssessment = Boolean(viewer && canCreateClinical && (assignedAssessorId === viewer.id || canSupervise));
  const canAddAddendum = canAddAssessmentAddendum(trainingAssessmentMode, viewer, selected, canSupervise);
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
  const practiceReview = useMemo(
    () => trainingAssessmentMode ? getAssessmentPracticeReview(draft) : null,
    [draft, trainingAssessmentMode],
  );

  const upsertAssessment = useCallback((assessment: PipelineAssessmentRecord, select = false) => {
    setAssessments((current) => [assessment, ...current.filter((item) => item.assessment_id !== assessment.assessment_id)]);
    if (select) setSelectedId(assessment.assessment_id);
    selectedRef.current = assessment;
    const data = pickAssessmentToolData(assessment);
    baseDataRef.current = data;
    draftRef.current = data;
    setDraft(data);
    setDirtySections(new Set());
    setRemoteChange(null);
  }, []);

  const loadRecoveryDraft = useCallback(async (assessment: PipelineAssessmentRecord, currentData: AssessmentToolData) => {
    let recovered: PipelineAssessmentDraft | null = null;
    let recoveredVersion = 0;
    if (offlinePrincipal) {
      try {
        recovered = await loadOfflineAssessmentDraft(offlinePrincipal, assessment.assessment_id);
        const workingSet = await loadOfflineAssessmentWorkingSet(offlinePrincipal, assessment.assessment_id);
        if (workingSet?.draft && (!recovered || Date.parse(workingSet.draft.savedAt) >= Date.parse(recovered.savedAt))) {
          recovered = workingSet.draft;
        }
      } catch {
        // Server recovery remains available when encrypted browser storage is unavailable.
      }
    }
    if (usesServerUserWorkspaceState()) {
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
        // Browser recovery remains available during a transient server-state outage.
      }
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
  }, [offlinePrincipal]);

  const persistOfflineWorkingSet = useCallback(async (assessment: PipelineAssessmentRecord) => {
    if (!offlinePrincipal) return;
    if (!assessment.started_at || assessment.signed_at || !canEditClinical) {
      await removeOfflineAssessmentWorkingSet(offlinePrincipal, assessment.assessment_id);
      return;
    }
    const workingDraft: PipelineAssessmentDraft = {
      schema: 1,
      assessmentId: assessment.assessment_id,
      savedAt: new Date().toISOString(),
      baseVersion: assessment.version,
      sectionVersions: normalizeAssessmentSectionVersions(assessment.section_versions),
      dirtySections: [...dirtySectionsRef.current],
      data: pickAssessmentToolData(draftRef.current),
      baseData: pickAssessmentToolData(baseDataRef.current),
    };
    await saveOfflineAssessmentWorkingSet(
      offlinePrincipal,
      workingDraft,
      `${window.location.pathname}${window.location.search}`,
      { editable: true },
    );
  }, [canEditClinical, offlinePrincipal]);

  const persistRecoveryDraft = useCallback(async (assessment: PipelineAssessmentRecord) => {
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
    if (offlinePrincipal) {
      try {
        await saveOfflineAssessmentDraft(offlinePrincipal, assessment.assessment_id, recovery);
      } catch {
        // The server draft remains authoritative when browser storage is unavailable.
      }
    }
    if (usesServerUserWorkspaceState()) {
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
  }, [offlinePrincipal]);

  const clearRecoveryDraft = useCallback(async (assessmentId: string) => {
    if (offlinePrincipal) {
      try {
        await removeOfflineAssessmentDraft(offlinePrincipal, assessmentId);
      } catch {
        // The expiring encrypted recovery copy is harmless if cleanup is unavailable.
      }
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
  }, [offlinePrincipal]);

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
    const updateConnection = () => setNetworkOnline(window.navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    if (trainingAssessmentMode) {
      const assessment = buildTrainingAssessment(trainingAssessmentMode);
      setAssessments([assessment]);
      setSelectedId(assessment.assessment_id);
      setIsLoading(false);
      return;
    }
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
  }, [referralId, trainingAssessmentMode]);

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
    const initializationKey = `${selected.assessment_id}:${offlinePrincipal || "server"}`;
    if (initializedAssessmentIdRef.current === initializationKey) return;
    initializedAssessmentIdRef.current = initializationKey;
    const data = pickAssessmentToolData(selected);
    selectedRef.current = selected;
    baseDataRef.current = data;
    setDraft(data);
    setDirtySections(new Set());
    setRemoteChange(null);
    setScheduleStart(toLocalDateTimeInput(selected.scheduled_start_at));
    setScheduleDuration(String(selected.scheduled_duration_minutes ?? 60));
    setScheduleMethod(normalizeScheduleMethod(selected.scheduled_method));
    setScheduleLocation(selected.scheduled_location ?? "");
    setShowScheduleDialog(!selected.scheduled_start_at && !selected.started_at && !selected.signed_at);
    setShowBeginDialog(Boolean(selected.scheduled_start_at && !selected.started_at && !selected.signed_at));
    setShowAddendum(false);
    loadRecoveryDraftForLiveAssessment(trainingAssessmentMode, loadRecoveryDraft, selected, data);
  }, [loadRecoveryDraft, offlinePrincipal, selected, trainingAssessmentMode]);

  useEffect(() => {
    if (!referralId || !selected || selected.signed_at || !packetEvidenceVersion || dirty) return;
    const syncKey = `${selected.assessment_id}:${packetEvidenceVersion}`;
    if (packetSyncKeysRef.current.has(syncKey)) return;
    packetSyncKeysRef.current.add(syncKey);
    let cancelled = false;
    fetchPipelineJson<{ assessment: PipelineAssessmentRecord; synced: boolean }>(
      `/api/referrals/${referralId}/assessments/sync-packet`,
      {
        method: "POST",
        body: JSON.stringify({
          assessment_id: selected.assessment_id,
          if_match: selected.version,
        }),
      },
    )
      .then((payload) => {
        if (cancelled || !payload.synced) return;
        upsertAssessment(payload.assessment, true);
        setMessage("Packet evidence is ready for review");
      })
      .catch((syncError) => {
        if (cancelled) return;
        setError(messageFor(syncError, "Packet evidence could not be synchronized."));
      });
    return () => {
      cancelled = true;
    };
  }, [dirty, packetEvidenceVersion, referralId, selected, upsertAssessment]);

  useEffect(() => {
    if (!selected?.assessment_id || focusedAssessmentIdRef.current === selected.assessment_id) return;
    focusedAssessmentIdRef.current = selected.assessment_id;
    setIsFocused(true);
    setShowScheduleDialog(!selected.scheduled_start_at && !selected.started_at && !selected.signed_at);
    setShowBeginDialog(Boolean(selected.scheduled_start_at && !selected.started_at && !selected.signed_at));
  }, [selected?.assessment_id, selected?.scheduled_start_at, selected?.signed_at, selected?.started_at]);

  useEffect(() => {
    if (!isFocused) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (showBeginDialog) setShowBeginDialog(false);
      if (showScheduleDialog) setShowScheduleDialog(false);
      setIsFocused(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isFocused, showBeginDialog, showScheduleDialog]);

  useEffect(() => {
    onSummaryChange?.({
      captured: coverage.captured,
      total: coverage.total,
      status: selected?.status ?? "not_started",
      assessmentId: selected?.assessment_id,
      scheduledStartAt: selected?.scheduled_start_at,
      startedAt: selected?.started_at,
      signedAt: selected?.signed_at,
    });
  }, [coverage.captured, coverage.total, onSummaryChange, selected?.assessment_id, selected?.scheduled_start_at, selected?.signed_at, selected?.started_at, selected?.status]);

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
      setIsFocused(true);
      setShowScheduleDialog(true);
      setShowBeginDialog(false);
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
      if (trainingAssessmentMode) {
        const updated = updateTrainingAssessment(current, {
          started_at: new Date().toISOString(),
        });
        upsertAssessment(updated, true);
        setMessage("Training assessment in progress");
        setShowBeginDialog(false);
        return;
      }
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
      setShowBeginDialog(false);
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
    if (!canSaveAssessmentSection(current, dirtySectionsRef.current, section)) return;
    if (hasSectionConflict(remoteChangeRef.current, section)) {
      throw new Error(`Resolve the ${sectionLabels[section]} conflict before saving.`);
    }

    const sentData = editableSectionData(draftRef.current, section);
    if (trainingAssessmentMode) {
      const saved = updateTrainingAssessment(current, sentData);
      selectedRef.current = saved;
      baseDataRef.current = pickAssessmentToolData(saved);
      draftRef.current = pickAssessmentToolData(saved);
      setDraft(draftRef.current);
      setAssessments((items) => [saved, ...items.filter((item) => item.assessment_id !== saved.assessment_id)]);
      setDirtySections((sections) => {
        const next = new Set(sections);
        next.delete(section);
        dirtySectionsRef.current = next;
        return next;
      });
      setMessage("Practice changes saved locally");
      setError("");
      return;
    }
    const requestBody = JSON.stringify({
      section,
      if_match_section: normalizeAssessmentSectionVersions(current.section_versions)[section],
      client_mutation_id: mutationId(`assessment-${section}`),
      patch: { data: sentData },
    });
    try {
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/assessments/${encodeURIComponent(current.assessment_id)}`,
        {
          method: "PATCH",
          body: requestBody,
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
      if (isOfflineAssessmentSave(saveError, offlinePrincipal)) {
        await queueOfflineAssessmentMutation(offlinePrincipal, {
          dedupeKey: `${current.assessment_id}:${section}`,
          url: `/api/assessments/${encodeURIComponent(current.assessment_id)}`,
          method: "PATCH",
          body: requestBody,
          createdAt: new Date().toISOString(),
        });
        const nextBase = pickAssessmentToolData(baseDataRef.current);
        for (const field of fieldsForAssessmentSection(section)) {
          if (sentData[field] !== undefined) nextBase[field] = sentData[field] as never;
        }
        baseDataRef.current = nextBase;
        const nextDirty = dirtyAssessmentSections(draftRef.current, nextBase);
        dirtySectionsRef.current = nextDirty;
        setDirtySections(nextDirty);
        const queued = await pendingOfflineAssessmentMutations(offlinePrincipal);
        setPendingOfflineSaves(queued);
        setNetworkOnline(false);
        setMessage(`${queued} offline change${queued === 1 ? "" : "s"} queued`);
        setError("");
        return;
      }
      if (saveError instanceof PipelineApiError && saveError.status === 409) {
        const latest = assessmentFromConflict(saveError.payload);
        if (latest) receiveRemoteAssessment(latest);
      }
      setError(messageFor(saveError, `${sectionLabels[section]} could not be saved.`));
      setMessage("");
      throw saveError;
    }
  }, [clearRecoveryDraft, offlinePrincipal, receiveRemoteAssessment, trainingAssessmentMode]);

  const syncOfflineChanges = useCallback(async () => {
    if (!offlinePrincipal || !window.navigator.onLine) return;
    const result = await flushOfflineAssessmentMutations(offlinePrincipal, async (mutation) => {
      await fetchPipelineJson(mutation.url, { method: mutation.method, body: mutation.body });
    });
    setPendingOfflineSaves(result.remaining);
    if (result.conflicts > 0) {
      setMessage(`${result.conflicts} synced change${result.conflicts === 1 ? "" : "s"} need conflict review`);
    } else if (result.completed > 0) {
      setMessage(result.remaining > 0 ? `${result.remaining} offline changes still queued` : "Offline changes synced");
    }
    const current = selectedRef.current;
    if (result.completed > 0 && current) {
      try {
        const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
          `/api/assessments/${encodeURIComponent(current.assessment_id)}`,
          { cache: "no-store" },
        );
        receiveRemoteAssessment(payload.assessment, false);
        if (result.remaining === 0) await removeOfflineAssessmentDraft(offlinePrincipal, current.assessment_id);
      } catch {
        // The normal active-assessment poll will reconcile the saved version.
      }
    }
  }, [offlinePrincipal, receiveRemoteAssessment]);

  useEffect(() => {
    if (!offlinePrincipal) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        await initializeOfflineAssessmentStore(offlinePrincipal);
        const count = await pendingOfflineAssessmentMutations(offlinePrincipal);
        if (!cancelled) setPendingOfflineSaves(count);
      } catch {
        // The server autosave remains available when encrypted browser storage is unavailable.
      }
    };
    const onStateChange = () => void refresh();
    const onOnline = () => void syncOfflineChanges();
    void refresh().then(() => syncOfflineChanges());
    window.addEventListener("pipeline:offline-state-changed", onStateChange);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("pipeline:offline-state-changed", onStateChange);
      window.removeEventListener("online", onOnline);
    };
  }, [offlinePrincipal, syncOfflineChanges]);

  const queueSectionSave = useCallback((section: AssessmentToolSection) => {
    const next = saveQueueRef.current.then(() => saveSectionNow(section));
    saveQueueRef.current = next.catch(() => undefined);
    return next;
  }, [saveSectionNow]);

  const flushDirtySections = useCallback(async () => {
    for (const section of [...dirtySectionsRef.current]) await queueSectionSave(section);
    await saveQueueRef.current;
  }, [queueSectionSave]);

  const reviewExtractedField = async (
    field: AssessmentToolFieldKey,
    action: "accept" | "reject",
  ) => {
    const definition = assessmentToolFieldDefinitions.find((candidate) => candidate.key === field);
    if (!definition) return;
    setIsBusy(true);
    setError("");
    setMessage(action === "accept" ? "Confirming suggested answer..." : "Removing unsupported answer...");
    try {
      if (dirtySectionsRef.current.has(definition.section)) await queueSectionSave(definition.section);
      const current = selectedRef.current;
      if (!current) return;
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/assessments/${encodeURIComponent(current.assessment_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            section: definition.section,
            if_match_section: normalizeAssessmentSectionVersions(current.section_versions)[definition.section],
            client_mutation_id: mutationId(`assessment-review-${field}-${action}`),
            patch: { review_extraction: [{ field, action }] },
          }),
        },
      );
      upsertAssessment(payload.assessment, true);
      await onAssessmentSaved?.(payload.assessment);
      setMessage(action === "accept" ? "Suggested answer confirmed" : "Suggested answer removed");
    } catch (reviewError) {
      if (reviewError instanceof PipelineApiError && reviewError.status === 409) {
        const latest = assessmentFromConflict(reviewError.payload);
        if (latest) receiveRemoteAssessment(latest);
      }
      setError(messageFor(reviewError, "The suggested answer could not be reviewed."));
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
      if (trainingAssessmentMode) {
        const signedAt = new Date().toISOString();
        const updated = updateTrainingAssessment(current, {
          status: "complete",
          completed_at: signedAt,
          signed_at: signedAt,
          signed_by: current.updated_by,
        });
        upsertAssessment(updated, true);
        setMessage("Practice assessment signed locally");
        return;
      }
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
      if (offlinePrincipal) void removeOfflineAssessmentWorkingSet(offlinePrincipal, payload.assessment.assessment_id);
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
    if (!hasAssessmentScheduleInput(current, scheduleStart)) return;
    const start = new Date(scheduleStart);
    if (Number.isNaN(start.getTime())) {
      setError("Choose a valid assessment date and time.");
      return;
    }
    setIsBusy(true);
    setError("");
    setMessage("Saving schedule...");
    try {
      if (trainingAssessmentMode) {
        const updated = updateTrainingAssessment(current, {
          scheduled_start_at: start.toISOString(),
          scheduled_duration_minutes: Number(scheduleDuration),
          scheduled_method: scheduleMethod,
          scheduled_location: nullableTrimmedText(scheduleLocation),
          schedule_status: nextAssessmentScheduleStatus(current.schedule_status),
        });
        upsertAssessment(updated, true);
        setMessage("Practice appointment saved locally");
        setShowScheduleDialog(false);
        setShowBeginDialog(true);
        return;
      }
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/assessments/${encodeURIComponent(current.assessment_id)}/schedule`,
        {
          method: "POST",
          body: JSON.stringify({
            if_match: current.version,
            client_mutation_id: mutationId("assessment-schedule"),
            schedule: {
              status: nextAssessmentScheduleStatus(current.schedule_status),
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
      setMessage("Assessment scheduled");
      setShowScheduleDialog(false);
      if (!payload.assessment.started_at && !payload.assessment.signed_at) setShowBeginDialog(true);
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
    if (trainingAssessmentMode) return;
    const current = selectedRef.current;
    if (!current || dirtySections.size === 0) return;
    const timer = window.setTimeout(() => void persistRecoveryDraft(current), 350);
    return () => window.clearTimeout(timer);
  }, [dirtySections, draft, persistRecoveryDraft, trainingAssessmentMode]);

  useEffect(() => {
    if (trainingAssessmentMode) return;
    const current = selectedRef.current;
    if (!current || !offlinePrincipal) return;
    const timer = window.setTimeout(() => {
      void persistOfflineWorkingSet(current).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [dirtySections, draft, offlinePrincipal, persistOfflineWorkingSet, selected?.assessment_id, selected?.signed_at, trainingAssessmentMode]);

  useEffect(() => {
    if (trainingAssessmentMode) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtySectionsRef.current.size === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [trainingAssessmentMode]);

  useEffect(() => {
    if (trainingAssessmentMode || !selected?.assessment_id) return;
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
  }, [receiveRemoteAssessment, selected?.assessment_id, trainingAssessmentMode]);

  useEffect(() => {
    if (trainingAssessmentMode || !referralId || !selected?.assessment_id) return;
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
  }, [activeSection, referralId, selected?.assessment_id, trainingAssessmentMode]);

  if (assessmentRequiresSavedReferral(referralId, trainingAssessmentMode)) {
    return (
      <AssessmentEmpty
        title="Save the referral before starting the assessment"
        detail="The assessment needs a referral ID so its history, files, and edits stay attached to one intake episode."
      />
    );
  }

  if (isLoading) {
    return <div className="flex min-h-56 items-center justify-center bg-white"><PipelineArcadeLoader label="Loading assessment history" /></div>;
  }

  if (!selected) {
    return (
      <AssessmentEmpty
        title="Assessment not scheduled"
        detail="The assigned assessor schedules the interview here. Pipeline will keep the same assessment open through scheduling, interview, review, and signature."
        action={canCreateAssignedAssessment ? <button type="button" data-guide-target="assessment-schedule-open" onClick={createAssessmentDraft} disabled={isBusy} className="h-11 bg-[#111111] px-5 text-[12px] font-black text-white hover:bg-[#0f8b73] disabled:opacity-50">Schedule assessment</button> : null}
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
        <button type="button" data-guide-target={["assessment-open", "assessment-schedule-open"].join(" ")} onClick={() => {
          setIsFocused(true);
          setShowScheduleDialog(!selected.scheduled_start_at && !selected.started_at && !selected.signed_at);
          setShowBeginDialog(Boolean(selected.scheduled_start_at && !selected.started_at && !selected.signed_at));
        }} className="h-11 bg-[#111111] px-5 text-[12px] font-black text-white hover:bg-[#0f8b73]">Open assessment</button>
      </section>
    );
  }

  return createPortal(
    <section role="dialog" aria-modal="true" aria-label="Assessment interview" className="fixed inset-0 z-[90] flex h-[100dvh] flex-col overflow-hidden bg-white">
      <header className="relative flex min-h-16 shrink-0 items-center gap-3 border-b border-[#d9dfdb] bg-white px-3 py-2 sm:px-5">
        <button type="button" onClick={() => { setShowScheduleDialog(false); setShowBeginDialog(false); setIsFocused(false); }} aria-label="Close assessment" title="Close assessment" className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#d6ddd9] text-[#444444] hover:border-[#0f8b73] hover:text-[#0f8b73]"><X size={18} /></button>
        <div className="min-w-[170px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[17px] font-black">{formatClientIdentityTitle({ name: draft.resident_name || "Client", community: draft.community })} assessment</h2>
            <StatusLabel status={selected.status} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[#737373]">
            <span>{formatDate(selected.assessment_date)}</span><span aria-hidden="true">·</span><span>{selected.assessor || "Unassigned"}</span>
            {canSupervise && selected.assessor_id !== viewer?.id ? <span className="sr-only">Supervisor access</span> : null}
          </div>
        </div>
        <span data-guide-target="assessment-save-status" aria-live="polite" className={`hidden max-w-[280px] truncate text-[10px] lg:block ${error ? "text-[#a63d2f]" : !networkOnline || pendingOfflineSaves > 0 || dirty ? "text-[#9a6115]" : "text-[#737373]"}`}>{assessmentSaveStatus({ error, trainingAssessmentMode, dirty, message, networkOnline, pendingOfflineSaves })}</span>
        {!selected.signed_at && !selected.started_at && (canEditClinical || canSupervise) ? (
          <button type="button" data-guide-target={showScheduleDialog ? undefined : "assessment-schedule-open"} onClick={() => { setShowBeginDialog(false); setShowScheduleDialog(true); }} aria-label={selected.scheduled_start_at ? "Reschedule assessment" : "Schedule assessment"} className="flex h-10 shrink-0 items-center gap-2 border border-[#c9ceca] px-3 text-[11px] font-black text-[#444444] hover:border-[#0f8b73] hover:text-[#0f8b73]"><CalendarClock size={15} /><span className="hidden sm:inline">{selected.scheduled_start_at ? "Reschedule" : "Schedule"}</span></button>
        ) : null}
        {!selected.signed_at && !selected.started_at && selected.scheduled_start_at && canEditClinical ? (
          <button type="button" data-guide-target="assessment-begin" onClick={() => setShowBeginDialog(true)} className="flex h-10 items-center gap-2 bg-[#111111] px-3 text-[11px] font-black text-white hover:bg-[#0f8b73] sm:px-4"><Play size={13} fill="currentColor" /><span className="hidden sm:inline">Begin assessment</span><span className="sm:hidden">Begin</span></button>
        ) : null}
        {selected.signed_at ? (
          canAddAddendum ? <button type="button" onClick={() => setShowAddendum((value) => !value)} disabled={isBusy} className="flex h-10 items-center gap-2 border border-[#c9ceca] px-3 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73]"><Plus size={14} /> Addendum</button> : <span className="text-[11px] font-black text-[#0f6f5e]">Signed</span>
        ) : selected.started_at && canEditClinical ? (
          <button type="button" data-guide-target="assessment-sign" onClick={() => window.confirm("Sign and lock this assessment?") && void signAssessment()} disabled={isBusy || completion.missing.length > 0} className="h-10 bg-[#111111] px-4 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:opacity-35">Sign assessment</button>
        ) : null}
      </header>

      <TrainingAssessmentBanner mode={trainingAssessmentMode} />

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
          <nav data-guide-target="assessment-section-nav" aria-label="Assessment sections" className="space-y-5">
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
                    return <button key={section.key} type="button" data-guide-target={`assessment-section-nav ${assessmentSectionGuideTargets[section.key]}`} onClick={() => setActiveSection(section.key)} aria-current={active ? "step" : undefined} className={`flex w-full items-center justify-between gap-3 border-l-2 px-3 py-2.5 text-left text-[11px] font-black transition-colors ${active ? "border-[#0f8b73] bg-[#e7f3ee] text-[#0f6f5d]" : "border-transparent text-[#595959] hover:bg-white hover:text-[#0f8b73]"}`}><span>{section.label}</span><span className="text-[9px] font-semibold opacity-65">{filled}/{questions.length}</span></button>;
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
              <select data-guide-target={`assessment-section-nav ${assessmentSectionGuideTargetList}`} id="assessment-section-mobile" value={activeSection} onChange={(event) => setActiveSection(event.target.value as AssessmentToolSection)} className="h-11 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-10 text-[12px] font-black outline-none focus:border-[#0f8b73]">{assessmentNavigationGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.sections.map((sectionKey) => { const section = assessmentInterviewSections.find((candidate) => candidate.key === sectionKey); return section ? <option key={section.key} value={section.key}>{section.label}</option> : null; })}</optgroup>)}</select>
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

          <div className="mx-auto max-w-[980px] px-5 py-7 sm:px-8">
            <div className="mb-7 flex flex-wrap items-start justify-between gap-4 border-b border-[#d9dfdb] pb-5">
              <div className="max-w-2xl">
                <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Section {activeSectionIndex + 1} of {assessmentInterviewSections.length}</div>
                <h3 className="mt-1 text-[22px] font-black">{sectionDefinition.label}</h3>
                <p className="mt-1 text-[12px] leading-5 text-[#737373]">{sectionDefinition.description}</p>
                {trainingAssessmentMode ? <p className="mt-2 max-w-[760px] border-l-2 border-[#0f8b73] pl-3 text-[11px] font-semibold leading-5 text-[#315e50]"><span className="font-black">Practice focus:</span> {assessmentPracticeSectionGuidance[activeSection]}</p> : null}
                <p className={`mt-3 text-[11px] font-semibold ${selected.started_at ? "text-[#315e50]" : "text-[#9a6115]"}`}>{!selected.started_at ? "Preview mode · open Interview setup when you are ready to begin entering answers." : nextUnansweredQuestion ? `Next: ${assessmentInterviewFieldLabel(nextUnansweredQuestion.field)}` : "This section is complete. Continue when ready."}</p>
              </div>
              <div className="text-right"><div className="text-[18px] font-black">{activeSectionCaptured}/{sectionQuestions.length}</div><div className="text-[9px] font-black uppercase text-[#8a8a8a]">captured here</div></div>
            </div>
            {trainingAssessmentMode && activeSection === "provenance_qc" && practiceReview ? <PracticeAssessmentReview review={practiceReview} /> : null}
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
                      pendingProvenance={latestPendingProvenance(selected, question.field)}
                      disabled={Boolean(selected.signed_at) || !selected.started_at || !canEditClinical}
                      reviewDisabled={isBusy || Boolean(selected.signed_at) || !canEditClinical}
                      onChange={(value) => updateField(question.field, value)}
                      onReview={(action) => void reviewExtractedField(question.field, action)}
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
              <button type="button" data-guide-target="assessment-next-section" onClick={() => setActiveSection(assessmentInterviewSections[Math.min(assessmentInterviewSections.length - 1, activeSectionIndex + 1)].key)} disabled={activeSectionIndex >= assessmentInterviewSections.length - 1} className="flex h-10 items-center gap-2 bg-[#111111] px-4 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:opacity-35">Next section <ChevronRight size={14} /></button>
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

        <aside className="hidden w-[290px] shrink-0 overflow-y-auto border-l border-[#d9dfdb] bg-[#fbfcfb] px-5 py-5 xl:block">
          <h3 className="text-[12px] font-black">{trainingAssessmentMode ? "Practice guide" : "Interview guide"}</h3>
          <p className="mt-1 text-[10px] leading-4 text-[#737373]">{trainingAssessmentMode ? assessmentPracticeSectionGuidance[activeSection] : "Answers save automatically. Conditional questions appear only when relevant."}</p>
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

      {showScheduleDialog ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-0 sm:p-5">
          <section role="dialog" aria-modal="true" aria-label="Schedule assessment" className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-[0_24px_80px_rgba(17,17,17,0.24)] sm:h-auto sm:max-w-[640px]">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#d9dfdb] px-5 py-4 sm:px-7 sm:py-5">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Assigned to {selected.assessor || "Unassigned"}</div>
                <h3 className="mt-1 text-[22px] font-black">{selected.scheduled_start_at ? "Reschedule assessment" : "Schedule assessment"}</h3>
                <p className="mt-1 max-w-[520px] text-[11px] leading-5 text-[#737373]">Set the interview time once. It will appear on the assigned assessor calendar and remain attached to this referral.</p>
              </div>
              <button type="button" onClick={() => { setShowScheduleDialog(false); setIsFocused(false); }} aria-label="Close schedule" className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#d6ddd9] text-[#444444] hover:border-[#0f8b73] hover:text-[#0f8b73]"><X size={18} /></button>
            </header>

            <div data-guide-target="assessment-schedule-open" className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              {selected.scheduled_start_at ? <div className="mb-5 border-l-2 border-[#0f8b73] bg-[#f4f8f6] px-4 py-3 text-[11px] text-[#315e50]">Currently scheduled for <strong>{new Date(selected.scheduled_start_at).toLocaleString()}</strong>.</div> : null}
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
                <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Date and time</span><input data-guide-target="assessment-schedule-fields" aria-label="Assessment date and time" type="datetime-local" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} className="mt-1 h-11 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none focus:border-[#0f8b73]" /></label>
                <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Duration</span><span className="relative mt-1 block"><select aria-label="Assessment duration" value={scheduleDuration} onChange={(event) => setScheduleDuration(event.target.value)} className="h-11 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-9 text-[12px] outline-none hover:border-[#8ca59c] focus:border-[#0f8b73]"><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option><option value="90">90 min</option><option value="120">2 hours</option></select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" /></span></label>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Method</span><span className="relative mt-1 block"><select aria-label="Assessment method" value={scheduleMethod} onChange={(event) => setScheduleMethod(event.target.value as typeof scheduleMethod)} className="h-11 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-9 text-[12px] outline-none hover:border-[#8ca59c] focus:border-[#0f8b73]"><option value="in_person">In person</option><option value="zoom">Zoom</option><option value="phone">Phone</option><option value="record_review">Record review</option></select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" /></span></label>
                <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Location or link</span><input aria-label="Assessment location or link" value={scheduleLocation} maxLength={500} onChange={(event) => setScheduleLocation(event.target.value)} className="mt-1 h-11 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none focus:border-[#0f8b73]" /></label>
              </div>
              {error ? <div role="alert" className="mt-4 text-[11px] font-semibold text-[#a63d2f]">{error}</div> : null}
            </div>

            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#d9dfdb] bg-[#f8faf9] px-5 py-4 sm:px-7">
              <button type="button" onClick={() => { setShowScheduleDialog(false); setIsFocused(false); }} className="h-10 border border-[#c9ceca] bg-white px-4 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73]">Back to workspace</button>
              <button type="button" data-guide-target="assessment-schedule-save" onClick={() => void saveSchedule()} disabled={isBusy || !scheduleStart || Number(scheduleDuration) < 15} className="h-10 bg-[#111111] px-5 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:bg-[#c9ceca]">{isBusy ? "Saving..." : selected.scheduled_start_at ? "Save new time" : "Schedule assessment"}</button>
            </footer>
          </section>
        </div>
      ) : null}

      {showBeginDialog ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4">
          <section role="dialog" aria-modal="true" aria-label="Begin assessment" className="w-full max-w-[500px] bg-white shadow-[0_24px_80px_rgba(17,17,17,0.24)]">
            <header className="border-b border-[#d9dfdb] px-6 py-5">
              <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">{selected.assessor || "Assigned assessor"}</div>
              <h3 className="mt-1 text-[23px] font-black">Begin assessment</h3>
              <p className="mt-2 text-[11px] leading-5 text-[#737373]">Starting records the interview start time and unlocks the questionnaire. Every answer saves back to this assessment as you work.</p>
            </header>
            <div className="px-6 py-5">
              <dl className="divide-y divide-[#e1e4e2] border-y border-[#e1e4e2]">
                <BeginAssessmentDetail label="Scheduled" value={selected.scheduled_start_at ? new Date(selected.scheduled_start_at).toLocaleString() : "Not scheduled"} />
                <BeginAssessmentDetail label="Method" value={formatScheduleMethod(selected.scheduled_method)} />
                {selected.scheduled_location ? <BeginAssessmentDetail label="Location" value={selected.scheduled_location} /> : null}
              </dl>
              {error ? <div role="alert" className="mt-4 text-[11px] font-semibold text-[#a63d2f]">{error}</div> : null}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[#d9dfdb] bg-[#f8faf9] px-6 py-4">
              <button type="button" onClick={() => { setShowBeginDialog(false); setIsFocused(false); }} className="h-10 border border-[#c9ceca] bg-white px-4 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73]">Back to workspace</button>
              <button type="button" data-guide-target="assessment-begin-confirm" onClick={() => void beginAssessment()} disabled={isBusy || !canEditClinical} className="flex h-10 items-center gap-2 bg-[#111111] px-5 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:opacity-45"><Play size={13} fill="currentColor" /> {isBusy ? "Starting..." : "Begin assessment"}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>,
    document.body,
  );
}

function AssessmentField({
  definition,
  question,
  value,
  unableReason,
  required,
  pending,
  pendingProvenance,
  disabled,
  reviewDisabled,
  onChange,
  onReview,
  onUnableReasonChange,
}: {
  definition: AssessmentToolFieldDefinition;
  question: AssessmentInterviewQuestion;
  value: AssessmentToolData[AssessmentToolFieldKey];
  unableReason: string;
  required: boolean;
  pending: boolean;
  pendingProvenance?: AssessmentFieldProvenance;
  disabled: boolean;
  reviewDisabled: boolean;
  onChange: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
  onReview: (action: "accept" | "reject") => void;
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
      {pending && pendingProvenance ? (
        <div className="mb-2 border-l-2 border-[#c9892a] bg-[#fffaf0] px-3 py-2">
          <div className="text-[10px] leading-4 text-[#70480d]">
            Suggested from <strong>{assessmentEvidenceSource(pendingProvenance)}</strong>
            {assessmentEvidenceLocation(pendingProvenance)}
            {Number.isFinite(pendingProvenance.confidence) ? ` · ${Math.round(pendingProvenance.confidence * 100)}% confidence` : ""}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={reviewDisabled} onClick={() => onReview("accept")} className="h-8 bg-[#0f8b73] px-3 text-[10px] font-black text-white hover:bg-[#0b6d5b] disabled:opacity-50">Use</button>
            <button type="button" disabled={reviewDisabled} onClick={() => onReview("reject")} className="h-8 border border-[#c9a978] bg-white px-3 text-[10px] font-black text-[#70480d] hover:border-[#9a6115] disabled:opacity-50">Reject</button>
            {!disabled ? <span className="self-center text-[9px] text-[#8a6c43]">Or correct the answer below.</span> : null}
          </div>
        </div>
      ) : null}
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
        <>
          <textarea
            data-guide-target="assessment-answer"
            id={id}
            value={stringValue}
            readOnly={readOnly}
            rows={definition.value_type === "string_list" ? 3 : 4}
            onChange={(event) => onChange(definition.value_type === "string_list" ? listFromLines(event.target.value) : event.target.value || null)}
            placeholder={question.placeholder ?? (definition.value_type === "string_list" ? "One item per line" : "Enter assessment detail")}
            className="w-full resize-y border border-[#c9ceca] bg-white px-3 py-2 text-[12px] leading-5 outline-none placeholder:text-[#a3a3a3] focus:border-[#0f8b73] read-only:bg-[#f4f6f5]"
          />
          <AssessmentFieldWritingGuidePanel field={definition.key} />
        </>
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

function PracticeAssessmentReview({ review }: { review: ReturnType<typeof getAssessmentPracticeReview> }) {
  const sections = [
    { label: "Required answers missing", items: review.missingRequired },
    { label: "Follow-ups still open", items: review.openConditionalDetails },
    { label: "Conflicting information", items: review.conflicts },
    { label: "Awaiting confirmation", items: review.awaitingConfirmation },
  ];

  return (
    <section aria-label="Practice assessment review" className="mb-7 border-y border-[#cfd8d4] py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Final check</div>
          <h4 className="mt-1 text-[17px] font-black">Review what still needs attention</h4>
        </div>
        <div className="text-[10px] font-bold text-[#52605a]">{review.sectionsReady.length} of {assessmentInterviewSections.length} sections ready</div>
      </div>
      <div className="mt-4 grid gap-x-7 gap-y-5 md:grid-cols-2">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="flex items-center justify-between gap-3 border-b border-[#e0e5e2] pb-2">
              <h5 className="text-[10px] font-black uppercase text-[#505a55]">{section.label}</h5>
              <span className="text-[10px] font-black tabular-nums text-[#0f7c68]">{section.items.length}</span>
            </div>
            {section.items.length > 0 ? (
              <ul className="mt-2 space-y-2 text-[11px] leading-5 text-[#59645f]">
                {section.items.slice(0, 5).map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : <p className="mt-2 text-[11px] font-semibold text-[#0f6f5d]">Clear</p>}
          </div>
        ))}
      </div>
      <div className="mt-5 border-t border-[#e0e5e2] pt-4">
        <div className="text-[10px] font-black uppercase text-[#505a55]">Sections ready</div>
        <p className="mt-2 text-[11px] leading-5 text-[#59645f]">{review.sectionsReady.join(" · ") || "None yet"}</p>
      </div>
    </section>
  );
}

function AssessmentFieldWritingGuidePanel({ field }: { field: AssessmentToolFieldKey }) {
  const specification = getAssessmentFieldWritingSpec(field);
  if (!specification) return null;

  return (
    <details className="mt-2 border border-[#d9dfdb] bg-[#f8faf9]">
      <summary data-guide-target="assessment-answer-help" className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:hidden">
        <span className="flex items-center gap-2 text-[10px] font-black text-[#315e50]"><Sparkles size={12} /> Answer format</span>
        <span className="text-[9px] font-semibold text-[#7b837e]">{specification.formatLabel} · {specification.lengthGuidance}</span>
      </summary>
      <div className="border-t border-[#d9dfdb] px-3 py-3">
        <AssessmentFieldWritingGuide specification={specification} />
      </div>
    </details>
  );
}

function AssessmentFieldWritingGuide({ specification }: { specification: NonNullable<ReturnType<typeof getAssessmentFieldWritingSpec>> }) {
  return (
    <>
      <div className="border-l-2 border-[#0f8b73] bg-white px-3 py-2.5">
        <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#315e50]">Use this order</div>
        <p className="mt-1.5 text-[10px] font-semibold leading-4 text-[#3f4a45]">{specification.formatTemplate}</p>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(260px,1.1fr)]">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Include</div>
          <ul className="mt-2 grid gap-1.5 text-[10px] leading-4 text-[#595959] sm:grid-cols-2 lg:grid-cols-1">
            {specification.requiredElements.map((item) => <li key={item} className="flex items-start gap-2"><Check size={11} className="mt-0.5 shrink-0 text-[#0f8b73]" />{item}</li>)}
          </ul>
        </div>
        <div className="border-l border-[#d9dfdb] pl-3">
          <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Example format</div>
          <p className="mt-2 text-[10px] leading-4 text-[#4f5652]">{specification.strongExample}</p>
        </div>
      </div>
      <p className="mt-3 border-l-2 border-[#d2a759] bg-[#fffaf0] px-2 py-1.5 text-[9px] leading-4 text-[#70480d]">{specification.guardrail}</p>
    </>
  );
}

function AssessmentEmpty({ title, detail, action, error }: { title: string; detail: string; action?: React.ReactNode; error?: string }) {
  return (
    <section className="flex min-h-64 items-center justify-center border border-[#d6ddd9] bg-white px-6 py-12 text-center">
      <div className="max-w-lg">
        <CalendarClock size={25} className="mx-auto text-[#0f8b73]" />
        <h2 className="mt-4 text-[17px] font-black">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-5 text-[#737373]">{detail}</p>
        {action ? <div className="mt-5">{action}</div> : null}
        {error ? <div role="alert" className="mt-4 flex items-center justify-center gap-2 text-[11px] text-[#a63d2f]"><AlertTriangle size={13} /> {error}</div> : null}
      </div>
    </section>
  );
}

function BeginAssessmentDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-[10px] font-black uppercase tracking-[0.08em] text-[#737373]">{label}</dt>
      <dd className="max-w-[68%] text-right text-[11px] font-semibold text-[#303638]">{value}</dd>
    </div>
  );
}

function formatScheduleMethod(method: PipelineAssessmentRecord["scheduled_method"]) {
  if (!method) return "Not recorded";
  if (method === "in_person") return "In person";
  if (method === "zoom") return "Zoom";
  if (method === "record_review") return "Record review";
  return method[0].toUpperCase() + method.slice(1);
}

function normalizeScheduleMethod(method: PipelineAssessmentRecord["scheduled_method"] | "video") {
  if (method === "video" || method === "zoom") return "zoom";
  if (method === "phone" || method === "record_review" || method === "in_person") return method;
  return "in_person";
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

function latestPendingProvenance(
  assessment: PipelineAssessmentRecord,
  field: AssessmentToolFieldKey,
) {
  const latest = assessment.field_provenance[field]?.at(-1);
  return latest?.review_status === "pending" ? latest : undefined;
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

function assessmentOfflinePrincipal(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
) {
  if (trainingAssessmentMode) return "";
  return viewer?.id ?? viewer?.email ?? "";
}

function viewerHasAnyRole(viewer: PipelineCurrentUser | null, roles: readonly string[]) {
  return Boolean(viewer?.roles.some((role) => roles.includes(role)));
}

function canSuperviseAssessment(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
) {
  if (trainingAssessmentMode) return true;
  return viewerHasAnyRole(viewer, ["admin", "assessment_coordinator"]);
}

function canCreateAssessment(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
) {
  if (trainingAssessmentMode) return true;
  return viewerHasAnyRole(viewer, ["admin", "assessment_coordinator", "reviewer"]);
}

function canEditAssessment(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
  selected: PipelineAssessmentRecord | null,
  canSupervise: boolean,
) {
  if (trainingAssessmentMode) return true;
  if (!viewer || !selected) return false;
  return selected.assessor_id === viewer.id || canSupervise;
}

function canAddAssessmentAddendum(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
  selected: PipelineAssessmentRecord | null,
  canSupervise: boolean,
) {
  if (trainingAssessmentMode) return true;
  if (!viewer) return false;
  return selected?.signed_by?.id === viewer.id || canSupervise;
}

function loadRecoveryDraftForLiveAssessment(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  loadRecoveryDraft: (assessment: PipelineAssessmentRecord, currentData: AssessmentToolData) => Promise<void>,
  assessment: PipelineAssessmentRecord,
  currentData: AssessmentToolData,
) {
  if (!trainingAssessmentMode) void loadRecoveryDraft(assessment, currentData);
}

function canSaveAssessmentSection(
  assessment: PipelineAssessmentRecord | null,
  dirtySections: ReadonlySet<AssessmentToolSection>,
  section: AssessmentToolSection,
): assessment is PipelineAssessmentRecord {
  return Boolean(assessment && dirtySections.has(section));
}

function hasSectionConflict(
  remoteChange: AssessmentRemoteChange | null,
  section: AssessmentToolSection,
) {
  return Boolean(remoteChange?.conflicts.some((conflict) => conflict.section === section));
}

function isOfflineAssessmentSave(error: unknown, offlinePrincipal: string): error is PipelineApiError {
  return error instanceof PipelineApiError && error.status === 0 && Boolean(offlinePrincipal);
}

function hasAssessmentScheduleInput(
  assessment: PipelineAssessmentRecord | null,
  scheduleStart: string,
): assessment is PipelineAssessmentRecord {
  return Boolean(assessment && scheduleStart);
}

function nextAssessmentScheduleStatus(status: PipelineAssessmentRecord["schedule_status"]) {
  if (status === "scheduled") return "rescheduled" as const;
  if (status === "rescheduled") return "rescheduled" as const;
  return "scheduled" as const;
}

function nullableTrimmedText(value: string) {
  return value.trim() || null;
}

function assessmentRequiresSavedReferral(
  referralId: number | undefined,
  trainingAssessmentMode?: TrainingAssessmentMode,
) {
  return Boolean(!referralId && !trainingAssessmentMode);
}

function assessmentSaveStatus({
  error,
  trainingAssessmentMode,
  dirty,
  message,
  networkOnline,
  pendingOfflineSaves,
}: {
  error: string;
  trainingAssessmentMode: TrainingAssessmentMode | undefined;
  dirty: boolean;
  message: string;
  networkOnline: boolean;
  pendingOfflineSaves: number;
}) {
  if (error) return error;
  if (trainingAssessmentMode) return trainingAssessmentSaveStatus(dirty, message);
  return liveAssessmentSaveStatus(dirty, message, networkOnline, pendingOfflineSaves);
}

function trainingAssessmentSaveStatus(dirty: boolean, message: string) {
  if (dirty) return "Saving practice changes...";
  return message || "Practice changes saved locally";
}

function liveAssessmentSaveStatus(
  dirty: boolean,
  message: string,
  networkOnline: boolean,
  pendingOfflineSaves: number,
) {
  if (!networkOnline) return `Offline${pendingOfflineSaves > 0 ? ` · ${pendingOfflineSaves} queued` : ""}`;
  if (pendingOfflineSaves > 0) {
    return `${pendingOfflineSaves} change${pendingOfflineSaves === 1 ? "" : "s"} waiting to sync`;
  }
  if (dirty) return "Saving changes...";
  return message || "All changes saved";
}

function TrainingAssessmentBanner({ mode }: { mode?: TrainingAssessmentMode }) {
  if (!mode) return null;
  return (
    <div className="shrink-0 border-b border-[#b9d8cd] bg-[#f1f8f5] px-5 py-2 text-[10px] font-semibold text-[#315e50]">
      Practice case · Taylor Rivera · synthetic · changes stay in this guide
    </div>
  );
}

function updateTrainingAssessment(
  assessment: PipelineAssessmentRecord,
  patch: Partial<PipelineAssessmentRecord>,
): PipelineAssessmentRecord {
  return {
    ...assessment,
    ...patch,
    version: assessment.version + 1,
    updated_at: new Date().toISOString(),
  };
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

function assessmentEvidenceLocation(provenance: AssessmentFieldProvenance) {
  if (provenance.evidence_url?.startsWith("workbook://")) return "";
  return provenance.source_page_no ? `, page ${provenance.source_page_no}` : "";
}

function assessmentEvidenceSource(provenance: AssessmentFieldProvenance) {
  if (provenance.evidence_url?.startsWith("workbook://") || /\.(xlsx?|csv|tsv)$/i.test(provenance.source_file ?? "")) {
    return "existing assessment data";
  }
  return provenance.source_file || "the uploaded packet";
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
