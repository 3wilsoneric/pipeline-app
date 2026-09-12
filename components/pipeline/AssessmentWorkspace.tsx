"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import {
  fetchCurrentPipelineUser,
  fetchPipelineJson,
  PipelineApiError,
  type PipelineCurrentUser,
} from "@/lib/auth/authenticated-fetch";
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
import {
  assessmentFromConflict,
  assessmentOfflinePrincipal,
  assessmentRequiresSavedReferral,
  assessmentSaveStatus,
  canAddAssessmentAddendum,
  canCreateAssessment,
  canEditAssessment,
  canSaveAssessmentSection,
  canSuperviseAssessment,
  dirtyAssessmentSections,
  editableSectionData,
  getPendingFields,
  hasAssessmentScheduleInput,
  hasSectionConflict,
  isOfflineAssessmentSave,
  latestPendingProvenance,
  loadRecoveryDraftForLiveAssessment,
  nextAssessmentScheduleStatus,
  nullableTrimmedText,
  sameAssessmentValue,
  type AssessmentFieldConflict,
  type AssessmentRemoteChange,
} from "@/components/pipeline/assessment-workspace-state";
import {
  AssessmentField,
  PracticeAssessmentReview,
} from "@/components/pipeline/AssessmentInterviewFields";
import GuidedAssessmentInterview from "@/components/pipeline/GuidedAssessmentInterview";
import { AssessmentSchedulingDialogs } from "@/components/pipeline/AssessmentSchedulingDialogs";
import { isoToOperationalInput, operationalInputToIso } from "@/components/pipeline/pipeline-calendar-model";

type AssessmentWorkspaceProps = {
  referralId?: number;
  trainingAssessmentMode?: TrainingAssessmentMode;
  trainingAssessmentSection?: AssessmentToolSection;
  initialSection?: AssessmentToolSection;
  assignedAssessorId?: string;
  startScheduling?: boolean;
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
  onContinueToWorkflow?: () => void;
  onActiveSectionChange?: (section: AssessmentToolSection) => void;
};

const sectionLabels = Object.fromEntries(
  assessmentInterviewSections.map((section) => [section.key, section.label]),
) as Record<AssessmentToolSection, string>;

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

type AssessmentEscapeContext = {
  assessmentView: "guided" | "chart";
  showBeginDialog: boolean;
  showScheduleDialog: boolean;
  setAssessmentView: (view: "guided" | "chart") => void;
  setShowBeginDialog: (show: boolean) => void;
  setShowScheduleDialog: (show: boolean) => void;
  setIsFocused: (focused: boolean) => void;
};

type AssessmentFocusState = {
  section?: AssessmentToolSection;
  view: "guided" | "chart";
  showScheduleDialog: boolean;
  showBeginDialog: boolean;
};

type AssessmentAutoFocusState = AssessmentFocusState & { assessmentId: string };

type AssessmentAutoFocusSetters = {
  setActiveSection: (section: AssessmentToolSection) => void;
  setAssessmentView: (view: "guided" | "chart") => void;
  setIsFocused: (focused: boolean) => void;
  setShowScheduleDialog: (show: boolean) => void;
  setShowBeginDialog: (show: boolean) => void;
};

function handleAssessmentEscape(event: KeyboardEvent, context: AssessmentEscapeContext) {
  if (event.key !== "Escape") return;
  if (context.showBeginDialog) context.setShowBeginDialog(false);
  if (context.showScheduleDialog) context.setShowScheduleDialog(false);
  if (context.assessmentView === "guided" && !context.showBeginDialog && !context.showScheduleDialog) {
    context.setAssessmentView("chart");
    return;
  }
  context.setIsFocused(false);
}

function resolveAssessmentAutoFocus(
  assessment: PipelineAssessmentRecord | null,
  focusedAssessmentId: string,
  nextRequiredSection: AssessmentToolSection | undefined,
  initialSection: AssessmentToolSection | undefined,
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
): AssessmentAutoFocusState | null {
  if (!assessment?.assessment_id || focusedAssessmentId === assessment.assessment_id) return null;
  return {
    assessmentId: assessment.assessment_id,
    ...resolveAssessmentFocusState(assessment, nextRequiredSection, initialSection, trainingAssessmentMode),
  };
}

function resolveAssessmentFocusState(
  assessment: PipelineAssessmentRecord | null,
  nextRequiredSection: AssessmentToolSection | undefined,
  initialSection: AssessmentToolSection | undefined,
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
): AssessmentFocusState {
  return {
    section: autoFocusSection(assessment, nextRequiredSection, initialSection),
    view: assessmentInterviewView(assessment, trainingAssessmentMode),
    showScheduleDialog: assessmentNeedsSchedule(assessment),
    showBeginDialog: assessmentReadyToBegin(assessment),
  };
}

function autoFocusSection(assessment: PipelineAssessmentRecord | null, nextRequiredSection: AssessmentToolSection | undefined, initialSection: AssessmentToolSection | undefined) {
  return assessment?.started_at && nextRequiredSection && !initialSection ? nextRequiredSection : undefined;
}

function assessmentInterviewView(assessment: PipelineAssessmentRecord | null, trainingAssessmentMode: TrainingAssessmentMode | undefined) {
  return assessment?.started_at && !assessment.signed_at && (!trainingAssessmentMode || trainingAssessmentMode === "guided") ? "guided" : "chart";
}

function assessmentNeedsSchedule(assessment: PipelineAssessmentRecord | null) {
  return Boolean(assessment && !assessment.scheduled_start_at && !assessment.started_at && !assessment.signed_at);
}

function assessmentReadyToBegin(assessment: PipelineAssessmentRecord | null) {
  return Boolean(assessment?.scheduled_start_at && !assessment.started_at && !assessment.signed_at);
}

function applyAssessmentFocus(state: AssessmentFocusState, setters: AssessmentAutoFocusSetters) {
  if (state.section) setters.setActiveSection(state.section);
  setters.setAssessmentView(state.view);
  setters.setIsFocused(true);
  setters.setShowScheduleDialog(state.showScheduleDialog);
  setters.setShowBeginDialog(state.showBeginDialog);
}

export default function AssessmentWorkspace({
  referralId,
  trainingAssessmentMode,
  trainingAssessmentSection,
  initialSection,
  assignedAssessorId,
  startScheduling = false,
  packetEvidenceVersion,
  onSummaryChange,
  onAssessmentSaved,
  onContinueToWorkflow,
  onActiveSectionChange,
}: AssessmentWorkspaceProps) {
  const [assessments, setAssessments] = useState<PipelineAssessmentRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<AssessmentToolData>(createEmptyAssessmentToolData);
  const [activeSection, setActiveSection] = useState<AssessmentToolSection>(initialSection ?? trainingAssessmentSection ?? "identity");
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
  const [assessmentView, setAssessmentView] = useState<"guided" | "chart">("chart");
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
  const schedulingRequestedRef = useRef(false);
  const onActiveSectionChangeRef = useRef(onActiveSectionChange);
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
  const nextRequiredTarget = assessmentCompletionTarget(completion.missing[0]);
  const practiceReview = useMemo(
    () => trainingAssessmentMode ? getAssessmentPracticeReview(draft) : null,
    [draft, trainingAssessmentMode],
  );

  const openFocusedAssessment = () => {
    applyAssessmentFocus(
      resolveAssessmentFocusState(selected, nextRequiredTarget?.section, undefined, trainingAssessmentMode),
      { setActiveSection, setAssessmentView, setIsFocused, setShowScheduleDialog, setShowBeginDialog },
    );
  };

  const continueToWorkflow = () => {
    setIsFocused(false);
    onContinueToWorkflow?.();
  };

  useEffect(() => {
    const routedSection = initialSection ?? trainingAssessmentSection;
    if (routedSection) setActiveSection(routedSection);
  }, [initialSection, trainingAssessmentSection]);

  useEffect(() => {
    onActiveSectionChangeRef.current = onActiveSectionChange;
  }, [onActiveSectionChange]);

  useEffect(() => {
    onActiveSectionChangeRef.current?.(activeSection);
  }, [activeSection]);

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
    setActiveSection((current) => initialSection ?? recovered.activeSection ?? current);
    setRemoteChange(conflicts.length > 0 ? { assessment, conflicts } : null);
    setMessage(conflicts.length > 0 ? "Recovered changes need conflict review" : "Recovered unsaved assessment changes");
  }, [initialSection, offlinePrincipal]);

  const persistOfflineWorkingSet = useCallback(async (assessment: PipelineAssessmentRecord) => {
    if (!offlinePrincipal) return;
    if (!assessment.started_at || assessment.signed_at || !canEditClinical) {
      await removeOfflineAssessmentWorkingSet(offlinePrincipal, assessment.assessment_id);
      return;
    }
    const workingDraft: PipelineAssessmentDraft = {
      schema: 1,
      assessmentId: assessment.assessment_id,
      ...(referralId ? { referralId } : {}),
      savedAt: new Date().toISOString(),
      baseVersion: assessment.version,
      sectionVersions: normalizeAssessmentSectionVersions(assessment.section_versions),
      dirtySections: [...dirtySectionsRef.current],
      activeSection,
      data: pickAssessmentToolData(draftRef.current),
      baseData: pickAssessmentToolData(baseDataRef.current),
    };
    await saveOfflineAssessmentWorkingSet(
      offlinePrincipal,
      workingDraft,
      `${window.location.pathname}${window.location.search}`,
      { editable: true },
    );
  }, [activeSection, canEditClinical, offlinePrincipal, referralId]);

  const persistRecoveryDraft = useCallback(async (assessment: PipelineAssessmentRecord) => {
    if (dirtySectionsRef.current.size === 0) return;
    const recovery: PipelineAssessmentDraft = {
      schema: 1,
      assessmentId: assessment.assessment_id,
      ...(referralId ? { referralId } : {}),
      savedAt: new Date().toISOString(),
      baseVersion: assessment.version,
      sectionVersions: normalizeAssessmentSectionVersions(assessment.section_versions),
      dirtySections: [...dirtySectionsRef.current],
      activeSection,
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
  }, [activeSection, offlinePrincipal, referralId]);

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
    setScheduleStart(isoToOperationalInput(selected.scheduled_start_at));
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
    const focus = resolveAssessmentAutoFocus(
      selected,
      focusedAssessmentIdRef.current,
      nextRequiredTarget?.section,
      initialSection,
      trainingAssessmentMode,
    );
    if (!focus) return;
    focusedAssessmentIdRef.current = focus.assessmentId;
    applyAssessmentFocus(focus, {
      setActiveSection,
      setAssessmentView,
      setIsFocused,
      setShowScheduleDialog,
      setShowBeginDialog,
    });
  }, [initialSection, nextRequiredTarget, selected, trainingAssessmentMode]);

  useEffect(() => {
    if (!isFocused) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => handleAssessmentEscape(event, {
      assessmentView,
      showBeginDialog,
      showScheduleDialog,
      setAssessmentView,
      setShowBeginDialog,
      setShowScheduleDialog,
      setIsFocused,
    });
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [assessmentView, isFocused, showBeginDialog, showScheduleDialog]);

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
      setAssessmentView("chart");
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

  const scheduleFromIntake = useEffectEvent(() => {
    void createAssessmentDraft();
  });

  useEffect(() => {
    if (!startScheduling || isLoading || selected || !canCreateAssignedAssessment || schedulingRequestedRef.current) return;
    schedulingRequestedRef.current = true;
    scheduleFromIntake();
  }, [canCreateAssignedAssessment, isLoading, selected, startScheduling]);

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
        setAssessmentView("chart");
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
      setAssessmentView("guided");
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
        // Keep the last confirmed server data as the comparison base. Treating
        // a queued write as saved would hide a later server collision and allow
        // polling to replace the user's offline edits.
        const queued = await pendingOfflineAssessmentMutations(offlinePrincipal);
        setPendingOfflineSaves(queued);
        setNetworkOnline(window.navigator.onLine);
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
    const current = selectedRef.current;
    if ((result.completed > 0 || result.conflicts > 0) && current) {
      try {
        const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
          `/api/assessments/${encodeURIComponent(current.assessment_id)}`,
          { cache: "no-store" },
        );
        receiveRemoteAssessment(payload.assessment, false);
        if (result.conflicts > 0) {
          setMessage(`${result.conflicts} offline change${result.conflicts === 1 ? "" : "s"} need conflict review`);
        } else {
          setMessage(result.remaining > 0 ? `${result.remaining} offline changes still queued` : "Offline changes synced");
          if (result.remaining === 0) await removeOfflineAssessmentDraft(offlinePrincipal, current.assessment_id);
        }
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
    const start = operationalInputToIso(scheduleStart);
    if (!start) {
      setError("Choose a valid assessment date and time in Pacific Time.");
      return;
    }
    setIsBusy(true);
    setError("");
    setMessage("Saving schedule...");
    try {
      if (trainingAssessmentMode) {
        const updated = updateTrainingAssessment(current, {
          scheduled_start_at: start,
          scheduled_duration_minutes: Number(scheduleDuration),
          scheduled_method: scheduleMethod,
          scheduled_location: scheduleMethod === "record_review" ? null : nullableTrimmedText(scheduleLocation),
          schedule_status: nextAssessmentScheduleStatus(current.schedule_status),
        });
        upsertAssessment(updated, true);
        setMessage("Practice appointment saved locally");
        dispatchGuideCompletion("assessment-schedule-save");
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
              start_at: start,
              duration_minutes: Number(scheduleDuration),
              method: scheduleMethod,
              location: scheduleMethod === "record_review" ? "" : scheduleLocation.trim(),
            },
          }),
        },
      );
      upsertAssessment(payload.assessment, true);
      await onAssessmentSaved?.(payload.assessment);
      setMessage("Assessment scheduled");
      dispatchGuideCompletion("assessment-schedule-save");
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
    }, 400);
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
        title="Create the referral before scheduling an assessment"
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
        title="Assessment not scheduled"
        detail="The assigned assessor schedules the interview here. Pipeline will keep the same assessment open through scheduling, interview, review, and signature."
        action={canCreateAssignedAssessment ? <button type="button" data-guide-target="assessment-schedule-open" onClick={createAssessmentDraft} disabled={isBusy} className="h-10 bg-[#0f8b73] px-5 text-[11px] font-bold text-white transition-colors hover:bg-[#0b6d5b] disabled:opacity-50">Schedule assessment</button> : null}
        error={error}
      />
    );
  }

  if (!isFocused) {
    const openLabel = assessmentOpenLabel(selected);
    return (
      <section aria-label="Assessment" className="flex flex-col gap-3 border border-[#d6ddd9] bg-[#f8faf9] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#cfe0da] bg-white text-[#0f8b73]" aria-hidden="true">
            <CalendarClock size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-[14px] font-extrabold text-[#202522]">Assessment</h2><StatusLabel status={selected.status} /></div>
            <p className="mt-0.5 truncate text-[11px] text-[#68716c]">{assessmentSummaryLine(selected, completion, nextRequiredTarget)}</p>
          </div>
        </div>
        <button type="button" data-guide-target={["assessment-open", "assessment-schedule-open"].join(" ")} onClick={openFocusedAssessment} className="flex h-9 w-full items-center justify-center gap-2 bg-[#0f8b73] px-4 text-[11px] font-bold text-white transition-colors hover:bg-[#0b6d5b] sm:w-auto">{openLabel} <ChevronRight size={14} /></button>
      </section>
    );
  }

  if (assessmentView === "guided" && selected.started_at && !selected.signed_at) {
    const saveStatus = assessmentSaveStatus({ error, trainingAssessmentMode, dirty, message, networkOnline, pendingOfflineSaves });
    return createPortal(
      <GuidedAssessmentInterview
        key={selected.assessment_id}
        assessment={selected}
        data={draft}
        activeSection={activeSection}
        requiredFields={requiredInterviewFields}
        disabled={!canEditClinical}
        reviewDisabled={isBusy || !canEditClinical}
        saveStatus={saveStatus}
        saveTone={error ? "error" : !networkOnline || pendingOfflineSaves > 0 || dirty || isBusy ? "pending" : "saved"}
        error={error}
        hasConflicts={Boolean(remoteChange?.conflicts.length)}
        onChange={updateField}
        onReview={(field, action) => void reviewExtractedField(field, action)}
        onSectionChange={setActiveSection}
        onExitToChart={() => setAssessmentView("chart")}
        onDone={() => {
          setActiveSection("provenance_qc");
          setAssessmentView("chart");
        }}
      />,
      document.body,
    );
  }

  return createPortal(
    <section role="dialog" aria-modal="true" aria-label="Assessment interview" data-assessment-view="chart" className="fixed inset-0 z-[90] flex h-[100dvh] flex-col overflow-hidden bg-white">
      <header className="relative flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#d9dfdb] bg-white px-4 py-2 sm:flex-nowrap sm:px-6 lg:px-9">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[17px] font-black">{formatClientIdentityTitle({ name: draft.resident_name || "Client", community: draft.community })} assessment</h2>
            <StatusLabel status={selected.status} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-[10px] text-[#737373]">
            <span>{formatDate(selected.assessment_date)}</span><span aria-hidden="true">·</span><span>{selected.assessor || "Unassigned"}</span>
            {canSupervise && selected.assessor_id !== viewer?.id ? <span className="sr-only">Supervisor access</span> : null}
          </div>
        </div>
        <span data-guide-target="assessment-save-status" aria-live="polite" className={`order-last flex min-w-0 basis-full items-center justify-end gap-1.5 text-[10px] sm:order-none sm:max-w-[220px] sm:shrink-0 sm:basis-auto ${error ? "text-[#a63d2f]" : !networkOnline || pendingOfflineSaves > 0 || dirty || isBusy ? "text-[#9a6115]" : "text-[#0c705f]"}`}>
          {!error && networkOnline && pendingOfflineSaves === 0 && !dirty && !isBusy ? <Check size={12} className="shrink-0" aria-hidden="true" /> : null}
          <span className="truncate">{assessmentSaveStatus({ error, trainingAssessmentMode, dirty, message, networkOnline, pendingOfflineSaves })}</span>
        </span>
        {!selected.signed_at && !selected.started_at && (canEditClinical || canSupervise) ? (
          <button type="button" data-guide-target={showScheduleDialog ? undefined : "assessment-schedule-open"} onClick={() => { setShowBeginDialog(false); setShowScheduleDialog(true); }} aria-label={selected.scheduled_start_at ? "Reschedule assessment" : "Schedule assessment"} className="flex h-10 shrink-0 items-center gap-2 border border-[#c9ceca] px-3 text-[11px] font-black text-[#444444] hover:border-[#0f8b73] hover:text-[#0f8b73]"><CalendarClock size={15} /><span className="hidden sm:inline">{selected.scheduled_start_at ? "Reschedule" : "Schedule"}</span></button>
        ) : null}
        {!selected.signed_at && !selected.started_at && selected.scheduled_start_at && canEditClinical ? (
          <button type="button" data-guide-target="assessment-begin" onClick={() => setShowBeginDialog(true)} className="flex h-10 items-center gap-2 bg-[#111111] px-3 text-[11px] font-black text-white hover:bg-[#0f8b73] sm:px-4"><Play size={13} fill="currentColor" /><span className="hidden sm:inline">Begin assessment</span><span className="sm:hidden">Begin</span></button>
        ) : null}
        {selected.started_at && !selected.signed_at && (!trainingAssessmentMode || trainingAssessmentMode === "guided") && canEditClinical ? (
          <button type="button" onClick={() => setAssessmentView("guided")} aria-label="Guided interview" title="Guided interview" className="flex h-10 w-10 shrink-0 items-center justify-center gap-2 border border-[#c9ceca] text-[11px] font-black text-[#444444] hover:border-[#0f8b73] hover:text-[#0f8b73] sm:w-auto sm:px-3"><Play size={13} /><span className="hidden sm:inline">Guided interview</span></button>
        ) : null}
        {selected.signed_at ? (
          canAddAddendum ? <button type="button" onClick={() => setShowAddendum((value) => !value)} disabled={isBusy} className="flex h-10 items-center gap-2 border border-[#c9ceca] px-3 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73]"><Plus size={14} /> Addendum</button> : <span className="text-[11px] font-black text-[#0f6f5e]">Signed</span>
        ) : selected.started_at && canEditClinical ? (
          <button type="button" data-guide-target="assessment-sign" aria-label="Sign assessment" onClick={() => window.confirm("Sign and lock this assessment?") && void signAssessment()} disabled={isBusy || completion.missing.length > 0} className="h-10 shrink-0 bg-[#111111] px-3 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:opacity-35 sm:px-4"><span className="hidden sm:inline">Sign assessment</span><span className="sm:hidden">Sign</span></button>
        ) : null}
        <button type="button" onClick={() => { setShowScheduleDialog(false); setShowBeginDialog(false); setIsFocused(false); }} aria-label="Close assessment" title="Close assessment" className="flex h-10 w-10 shrink-0 items-center justify-center text-[#4d534f] transition-colors hover:bg-[#f1f4f2] hover:text-[#0f7664]"><X size={20} /></button>
      </header>
      <TrainingAssessmentBanner mode={trainingAssessmentMode} />

      <AssessmentReadiness
        completion={completion}
        nextTarget={nextRequiredTarget}
        started={Boolean(selected.started_at)}
        signed={Boolean(selected.signed_at)}
        canContinue={Boolean(onContinueToWorkflow)}
        onOpenTarget={(target) => setActiveSection(target.section)}
        onContinue={continueToWorkflow}
      />

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
            <div className="flex items-center gap-2 border-b border-[#c9d9d3] bg-[#f7fbf9] px-5 py-2 text-[11px] font-semibold text-[#315e50]" aria-live="polite">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#20a464]" />
              <span>{presence
                .filter((item) => item.section === `assessment:${activeSection}`)
                .map((item) => item.actor_name)
                .join(", ")} {presence.filter((item) => item.section === `assessment:${activeSection}`).length === 1 ? "is" : "are"} also editing {sectionLabels[activeSection]}.</span>
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

      <AssessmentSchedulingDialogs
        assessment={selected}
        showScheduleDialog={showScheduleDialog}
        showBeginDialog={showBeginDialog}
        isBusy={isBusy}
        error={error}
        canEditClinical={canEditClinical}
        scheduleStart={scheduleStart}
        scheduleDuration={scheduleDuration}
        scheduleMethod={scheduleMethod}
        scheduleLocation={scheduleLocation}
        onScheduleStartChange={setScheduleStart}
        onScheduleDurationChange={setScheduleDuration}
        onScheduleMethodChange={setScheduleMethod}
        onScheduleLocationChange={setScheduleLocation}
        onCloseSchedule={() => { setShowScheduleDialog(false); setIsFocused(false); }}
        onSaveSchedule={() => void saveSchedule()}
        onCloseBegin={() => { setShowBeginDialog(false); setIsFocused(false); }}
        onBeginAssessment={() => void beginAssessment()}
      />
    </section>,
    document.body,
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

type AssessmentCompletionTarget = {
  field: AssessmentToolFieldKey;
  label: string;
  section: AssessmentToolSection;
};

function assessmentCompletionTarget(
  rule: ReturnType<typeof getAssessmentCompletionSummary>["missing"][number] | undefined,
): AssessmentCompletionTarget | null {
  if (!rule) return null;
  const field = (rule.key.startsWith("unable:") ? rule.key.slice("unable:".length) : rule.fields[0]) as AssessmentToolFieldKey;
  const definition = assessmentToolFieldDefinitions.find((candidate) => candidate.key === field);
  return definition ? { field, label: rule.label, section: definition.section } : null;
}

export function assessmentOpenLabel(assessment: Pick<PipelineAssessmentRecord, "signed_at" | "started_at" | "scheduled_start_at">) {
  if (assessment.signed_at) return "Review assessment";
  if (assessment.started_at) return "Resume assessment";
  if (assessment.scheduled_start_at) return "Begin assessment";
  return "Schedule assessment";
}

function assessmentSummaryLine(
  assessment: PipelineAssessmentRecord,
  completion: ReturnType<typeof getAssessmentCompletionSummary>,
  nextTarget: AssessmentCompletionTarget | null,
) {
  const assessor = assessment.assessor || "Unassigned";
  if (assessment.signed_at) return `Signed · ${assessor}`;
  if (assessment.started_at) {
    return nextTarget
      ? `${completion.complete} of ${completion.total} required · Next: ${nextTarget.label}`
      : `Ready to sign · ${assessor}`;
  }
  if (assessment.scheduled_start_at) return `${new Date(assessment.scheduled_start_at).toLocaleString()} · ${assessor}`;
  return `${completion.complete} of ${completion.total} required areas complete · ${assessor}`;
}

function AssessmentReadiness({
  completion,
  nextTarget,
  started,
  signed,
  canContinue,
  onOpenTarget,
  onContinue,
}: {
  completion: ReturnType<typeof getAssessmentCompletionSummary>;
  nextTarget: AssessmentCompletionTarget | null;
  started: boolean;
  signed: boolean;
  canContinue: boolean;
  onOpenTarget: (target: AssessmentCompletionTarget) => void;
  onContinue: () => void;
}) {
  if (!started) return null;
  const presentation = assessmentReadinessPresentation(completion, signed, nextTarget);
  return (
    <section aria-label="Assessment readiness" className="flex shrink-0 flex-col gap-3 border-b border-[#d9dfdb] bg-[#f7faf8] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[11px] font-black text-[#244a40]">
          <Check size={13} className={presentation.iconClassName} />
          {presentation.title}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-[#68716c]">
          <span>{completion.percent}% complete</span>
          {presentation.nextLabel ? <><span aria-hidden="true">·</span><span className="truncate">Next: {presentation.nextLabel}</span></> : null}
        </div>
      </div>
      <AssessmentReadinessAction signed={signed} canContinue={canContinue} nextTarget={nextTarget} onOpenTarget={onOpenTarget} onContinue={onContinue} />
    </section>
  );
}

function assessmentReadinessPresentation(
  completion: ReturnType<typeof getAssessmentCompletionSummary>,
  signed: boolean,
  nextTarget: AssessmentCompletionTarget | null,
) {
  if (signed) return { title: "Assessment signed and locked", iconClassName: "text-[#0f8b73]", nextLabel: "" };
  if (completion.missing.length === 0) return { title: "Ready to sign", iconClassName: "text-[#0f8b73]", nextLabel: "" };
  return { title: `${completion.missing.length} required areas remain`, iconClassName: "text-[#8a611f]", nextLabel: nextTarget?.label ?? "" };
}

function AssessmentReadinessAction({
  signed,
  canContinue,
  nextTarget,
  onOpenTarget,
  onContinue,
}: {
  signed: boolean;
  canContinue: boolean;
  nextTarget: AssessmentCompletionTarget | null;
  onOpenTarget: (target: AssessmentCompletionTarget) => void;
  onContinue: () => void;
}) {
  if (signed && canContinue) {
    return <button type="button" onClick={onContinue} className="flex h-9 shrink-0 items-center justify-center gap-2 bg-[#0f8b73] px-4 text-[10px] font-black text-white hover:bg-[#0b6d5b]">Continue to recommendation <ChevronRight size={13} /></button>;
  }
  if (!nextTarget) return null;
  return <button type="button" onClick={() => onOpenTarget(nextTarget)} className="flex h-9 min-w-0 shrink-0 items-center justify-center gap-2 border border-[#a9bdb5] bg-white px-4 text-[10px] font-black text-[#174f43] hover:border-[#0f8b73]">Next required: <span className="max-w-[240px] truncate">{nextTarget.label}</span><ChevronRight size={13} /></button>;
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

function dispatchGuideCompletion(target: string) {
  document
    .querySelector<HTMLElement>(`[data-guide-target~="${target}"]`)
    ?.dispatchEvent(new CustomEvent("pipeline:guide-complete", { bubbles: true }));
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
