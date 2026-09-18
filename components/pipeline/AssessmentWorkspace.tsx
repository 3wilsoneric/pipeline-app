"use client";

import { usePersonaSwitchSave } from "@/lib/demo/persona-switch-save";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";

import {
  fetchCurrentPipelineUser,
  fetchPipelineJson,
  PipelineApiError,
  type PipelineCurrentUser,
} from "@/lib/auth/authenticated-fetch";
import { getAssessmentCompletionSummary } from "@/lib/assessment/assessment-completion";
import type { Referral } from "@/lib/pipeline/referral-types";
import WorkspaceClientChart from "@/components/pipeline/TransferredWorkspaceChart";
import type {
  AssessmentListResponse,
  PipelineAssessmentRecord,
} from "@/lib/assessment/assessment-records";
import { isAssessmentFinalized } from "@/lib/assessment/assessment-records";
import {
  assessmentToolFieldDefinitions,
  createEmptyAssessmentToolData,
  pickAssessmentToolData,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import {
  assessmentInterviewFieldLabel,
  assessmentInterviewSections,
  getAssessmentInterviewCoverage,
  getAssessmentInterviewQuestions,
  getAssessmentUnableReason,
  getRequiredAssessmentInterviewQuestions,
  setAssessmentUnableReason,
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
import { getAssessmentPracticeReview } from "@/lib/training/assessment-practice";
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
  hasActiveAssessmentSchedule,
  hasAssessmentScheduleInput,
  hasSectionConflict,
  isOfflineAssessmentSave,
  loadRecoveryDraftForLiveAssessment,
  nextAssessmentScheduleStatus,
  nullableTrimmedText,
  sameAssessmentValue,
  type AssessmentFieldConflict,
  type AssessmentRemoteChange,
} from "@/components/pipeline/assessment-workspace-state";
import { PracticeAssessmentReview } from "@/components/pipeline/AssessmentInterviewFields";
import AssessmentWorkingSection, { AssessmentWorkingNavigation } from "@/components/pipeline/AssessmentWorkingSection";
import AssessmentInterviewHeader, { AssessmentFileDetails } from "@/components/pipeline/AssessmentInterviewHeader";
import { assessmentGapSections } from "@/components/pipeline/assessment-working-view";
import { AssessmentSchedulingDialogs } from "@/components/pipeline/AssessmentSchedulingDialogs";
import { isoToOperationalInput, operationalInputToIso } from "@/components/pipeline/pipeline-calendar-model";
import AssessmentPreparation, { PreparationNavigation, AssessmentFileSurface, AssessmentFileNavigation } from "@/components/pipeline/AssessmentPreparation";
import AssessmentPhoneInterview, { usePhoneAssessment } from "@/components/pipeline/AssessmentPhoneInterview";
import phoneStyles from "@/components/pipeline/AssessmentPhoneInterview.module.css";
import workingStyles from "@/components/pipeline/AssessmentWorkingSection.module.css";
import { assessmentPreparationGroups, preparationGroupForSection, preparationQuestions } from "@/lib/assessment/assessment-preparation";

type AssessmentWorkspaceProps = {
  readOnly?: boolean;
  referralId?: number;
  referral?: Referral;
  recommendationControl?: (assessmentId: string, onSavingChange: (saving: boolean) => void) => ReactNode;
  trainingAssessmentMode?: TrainingAssessmentMode;
  trainingAssessmentSection?: AssessmentToolSection;
  initialSection?: AssessmentToolSection;
  assignedAssessorId?: string;
  startQuestionnaire?: boolean;
  workspaceTitle?: string;
  chartReview?: boolean;
  chartActions?: ReactNode;
  onOpenChart?: () => void;
  beforeWorkspaceNavigationRef?: RefObject<(() => Promise<void>) | null>;
  packetEvidenceVersion?: string;
  onSummaryChange?: (summary: {
    captured: number;
    total: number;
    status: string;
    assessmentId?: string;
    scheduledStartAt?: string | null;
    scheduleStatus?: PipelineAssessmentRecord["schedule_status"];
    startedAt?: string | null;
    signedAt?: string | null;
  }) => void;
  onAssessmentSaved?: (assessment: PipelineAssessmentRecord) => void | Promise<void>;
  onContinueToWorkflow?: () => void;
  onOpenWorkspace?: () => void;
  onActiveSectionChange?: (section: AssessmentToolSection) => void;
  onOpenAssignedWork?: () => void | Promise<void>;
};

const sectionLabels = Object.fromEntries(
  assessmentInterviewSections.map((section) => [section.key, section.label]),
) as Record<AssessmentToolSection, string>;

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

type AssessmentEscapeContext = {
  showBeginDialog: boolean;
  showScheduleDialog: boolean;
  setShowBeginDialog: (show: boolean) => void;
  setShowScheduleDialog: (show: boolean) => void;
  closeAssessment: () => void;
};

type AssessmentFocusState = {
  section?: AssessmentToolSection;
  showScheduleDialog: boolean;
  showBeginDialog: boolean;
};

type AssessmentAutoFocusState = AssessmentFocusState & { assessmentId: string };

type AssessmentAutoFocusSetters = {
  setActiveSection: (section: AssessmentToolSection) => void;
  setIsFocused: (focused: boolean) => void;
  setShowScheduleDialog: (show: boolean) => void;
  setShowBeginDialog: (show: boolean) => void;
};

function handleAssessmentEscape(event: KeyboardEvent, context: AssessmentEscapeContext) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (context.showBeginDialog) { context.setShowBeginDialog(false); return; }
  if (context.showScheduleDialog) { context.setShowScheduleDialog(false); return; }
  context.closeAssessment();
}

function resolveAssessmentAutoFocus(
  assessment: PipelineAssessmentRecord | null,
  focusedAssessmentId: string,
  nextRequiredSection: AssessmentToolSection | undefined,
  initialSection: AssessmentToolSection | undefined,
  openSchedule: boolean,
): AssessmentAutoFocusState | null {
  if (!assessment?.assessment_id || focusedAssessmentId === assessment.assessment_id) return null;
  return {
    assessmentId: assessment.assessment_id,
    ...resolveAssessmentFocusState(assessment, nextRequiredSection, initialSection),
    showScheduleDialog: openSchedule,
  };
}

function resolveAssessmentFocusState(
  assessment: PipelineAssessmentRecord | null,
  nextRequiredSection: AssessmentToolSection | undefined,
  initialSection: AssessmentToolSection | undefined,
): AssessmentFocusState {
  return {
    section: autoFocusSection(assessment, nextRequiredSection, initialSection),
    showScheduleDialog: false,
    showBeginDialog: false,
  };
}

function autoFocusSection(assessment: PipelineAssessmentRecord | null, nextRequiredSection: AssessmentToolSection | undefined, initialSection: AssessmentToolSection | undefined) {
  return assessment?.started_at && nextRequiredSection && !initialSection ? nextRequiredSection : undefined;
}

function assessmentReadyToBegin(assessment: PipelineAssessmentRecord | null) {
  return Boolean(assessment && !assessment.started_at && !assessment.signed_at && assessment.status !== "complete");
}

function applyAssessmentFocus(state: AssessmentFocusState, setters: AssessmentAutoFocusSetters) {
  if (state.section) setters.setActiveSection(state.section);
  setters.setIsFocused(true);
  setters.setShowScheduleDialog(state.showScheduleDialog);
  setters.setShowBeginDialog(state.showBeginDialog);
}

function assessmentWorkspacePermissions(
  trainingAssessmentMode: TrainingAssessmentMode | undefined,
  viewer: PipelineCurrentUser | null,
  selected: PipelineAssessmentRecord | null,
  assignedAssessorId: string | undefined,
  readOnly: boolean,
) {
  if (readOnly) return { canSupervise: false, canEditClinical: false, canCreateAssignedAssessment: false, canAddAddendum: false };
  const canSupervise = canSuperviseAssessment(trainingAssessmentMode, viewer);
  const canCreateClinical = canCreateAssessment(trainingAssessmentMode, viewer);
  return {
    canSupervise,
    canEditClinical: canEditAssessment(trainingAssessmentMode, viewer, selected, canSupervise),
    canCreateAssignedAssessment: Boolean(viewer && canCreateClinical && (assignedAssessorId === viewer.id || canSupervise)),
    canAddAddendum: canAddAssessmentAddendum(trainingAssessmentMode, viewer, selected, canSupervise),
  };
}

export default function AssessmentWorkspace({
  readOnly = false,
  referralId,
  referral,
  recommendationControl,
  trainingAssessmentMode,
  trainingAssessmentSection,
  initialSection,
  assignedAssessorId,
  startQuestionnaire = false,
  workspaceTitle,
  chartReview,
  chartActions,
  onOpenChart,
  beforeWorkspaceNavigationRef,
  packetEvidenceVersion,
  onSummaryChange,
  onAssessmentSaved,
  onContinueToWorkflow,
  onOpenWorkspace,
  onOpenAssignedWork,
  onActiveSectionChange,
}: AssessmentWorkspaceProps) {
  const { contentRef, beforeNavigationRef, setAssessmentFocused } = usePipelineShell();
  const phoneInterview = usePhoneAssessment();
  const secondaryActionsRef = useRef<HTMLDetailsElement>(null);
  const [assessments, setAssessments] = useState<PipelineAssessmentRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<AssessmentToolData>(createEmptyAssessmentToolData);
  const [activeSection, setActiveSection] = useState<AssessmentToolSection>(initialSection ?? trainingAssessmentSection ?? "identity");
  const [isLoading, setIsLoading] = useState(Boolean(referralId));
  const [isBusy, setIsBusy] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [dirtySections, setDirtySections] = useState<Set<AssessmentToolSection>>(new Set());
  const [remoteChange, setRemoteChange] = useState<AssessmentRemoteChange | null>(null);
  const [presence, setPresence] = useState<EditingPresence[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [showBeginDialog, setShowBeginDialog] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [workingTarget, setWorkingTarget] = useState<{ field: AssessmentToolFieldKey } | null>(null);
  const [notebookPage, setNotebookPage] = useState<{ assessmentId: string; view: "prepare" | "assessment" | "chart" } | null>(null);
  const [isRecommendationSaving, setIsRecommendationSaving] = useState(false);
  const phoneQuestionRef = useRef<AssessmentToolFieldKey | null>(null);
  const rememberPhoneQuestion = useCallback((field: AssessmentToolFieldKey) => { phoneQuestionRef.current = field; }, []);
  const chartScrollRef = useRef<HTMLElement>(null);
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
  const recoveryQueueRef = useRef<Promise<void>>(Promise.resolve());
  const localRecoveryQueueRef = useRef<Promise<void>>(Promise.resolve());
  const offlineSyncRef = useRef(false);
  const closingRef = useRef(false);
  const initializedAssessmentIdRef = useRef("");
  const focusedAssessmentIdRef = useRef("");
  const preparationRequestedRef = useRef(false);
  const focusedFieldRef = useRef<{ field: AssessmentToolFieldKey; value: string; reason: string } | null>(null);
  const onActiveSectionChangeRef = useRef(onActiveSectionChange);
  const packetSyncKeysRef = useRef(new Set<string>());
  const dirty = dirtySections.size > 0;
  const offlinePrincipal = assessmentOfflinePrincipal(trainingAssessmentMode, viewer);

  const selected = assessments.find((assessment) => assessment.assessment_id === selectedId) ?? null;
  const notebookView = notebookPage?.assessmentId === selectedId ? notebookPage.view : null;
  const setNotebookView = (view: "prepare" | "assessment" | "chart") => setNotebookPage({ assessmentId: selectedId, view });
  const reviewingChart = chartReview ?? notebookView === "chart";
  const embeddedFolder = Boolean(workspaceTitle);
  const preparing = !embeddedFolder && !trainingAssessmentMode && (notebookView === "prepare" || (notebookView === null && assessmentReadyToBegin(selected)));
  const preparationGroup = preparationGroupForSection(activeSection);
  const preparationIndex = assessmentPreparationGroups.indexOf(preparationGroup);
  const visibleSectionKey = preparing ? preparationGroup.key : activeSection;
  const previousVisibleSectionRef = useRef(visibleSectionKey);
  const QuestionPage = phoneInterview ? AssessmentPhoneInterview : preparing ? AssessmentPreparation : AssessmentWorkingSection;
  const { canSupervise, canEditClinical, canCreateAssignedAssessment, canAddAddendum } = assessmentWorkspacePermissions(
    trainingAssessmentMode, viewer, selected, assignedAssessorId, readOnly,
  );
  const coverage = useMemo(() => getAssessmentInterviewCoverage(draft), [draft]);
  const completion = useMemo(() => getAssessmentCompletionSummary(draft), [draft]);
  const pendingFields = useMemo(() => getPendingFields(selected), [selected]);
  const sectionQuestions = useMemo(() => getAssessmentInterviewQuestions(activeSection, draft), [activeSection, draft]);
  const sectionDefinition = assessmentInterviewSections.find((section) => section.key === activeSection) ?? assessmentInterviewSections[0];
  const requiredInterviewFields = useMemo(
    () => new Set(getRequiredAssessmentInterviewQuestions(draft).map((question) => question.field)),
    [draft],
  );
  const conversationSections = assessmentGapSections(draft, pendingFields);
  const activeSectionIndex = conversationSections.findIndex((section) => section.key === activeSection);
  const nextSection = conversationSections[activeSectionIndex + 1];
  const previousSection = conversationSections[activeSectionIndex - 1];
  const showSecondaryActions = Boolean(
    selected && !selected.signed_at && !selected.started_at && canEditClinical
    || recommendationControl && phoneInterview && !preparing && !selected?.signed_at
    || selected?.signed_at && canAddAddendum
  );
  const nextRequiredTarget = assessmentCompletionTarget(completion.missing[0]);
  const practiceReview = useMemo(
    () => trainingAssessmentMode ? getAssessmentPracticeReview(draft) : null,
    [draft, trainingAssessmentMode],
  );

  useEffect(() => {
    if (chartScrollRef.current) chartScrollRef.current.scrollTop = 0;
    if (preparing && previousVisibleSectionRef.current !== visibleSectionKey) {
      chartScrollRef.current?.scrollIntoView({ block: "start" });
    }
    previousVisibleSectionRef.current = visibleSectionKey;
  }, [visibleSectionKey, preparing, isFocused]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = secondaryActionsRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  const openFocusedAssessment = () => {
    applyAssessmentFocus(
      resolveAssessmentFocusState(selected, nextRequiredTarget?.section, activeSection),
      { setActiveSection, setIsFocused, setShowScheduleDialog, setShowBeginDialog },
    );
  };

  const continueToWorkflow = () => void closeAssessment(onContinueToWorkflow);

  useEffect(() => {
    const routedSection = initialSection ?? trainingAssessmentSection;
    // A reflected history update can arrive after the user has chosen the next section.
    const currentRouteSection = new URLSearchParams(window.location.search).get("assessmentSection");
    if (currentRouteSection && currentRouteSection !== routedSection) return;
    if (routedSection) setActiveSection(routedSection);
  }, [initialSection, trainingAssessmentSection]);

  useLayoutEffect(() => {
    onActiveSectionChangeRef.current = onActiveSectionChange;
  }, [onActiveSectionChange]);

  // Publish the committed section before a reflected route effect can restore an older choice.
  useLayoutEffect(() => {
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
    dirtySectionsRef.current = new Set();
    setDirtySections(dirtySectionsRef.current);
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
    dirtySectionsRef.current = recoveredDirty;
    setDirtySections(recoveredDirty);
    setActiveSection((current) => initialSection ?? recovered.activeSection ?? current);
    setRemoteChange(conflicts.length > 0 ? { assessment, conflicts } : null);
    setMessage(conflicts.length > 0 ? "Recovered changes need conflict review" : "Recovered unsaved assessment changes");
  }, [initialSection, offlinePrincipal]);

  const persistOfflineWorkingSet = useCallback(async (assessment: PipelineAssessmentRecord) => {
    if (!offlinePrincipal) return;
    if (isAssessmentFinalized(assessment) || !canEditClinical) {
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
    const local = localRecoveryQueueRef.current.catch(() => undefined).then(async () => {
      if (!offlinePrincipal) throw new Error("Encrypted draft storage is unavailable.");
      await saveOfflineAssessmentDraft(offlinePrincipal, assessment.assessment_id, recovery);
    });
    localRecoveryQueueRef.current = local.catch(() => undefined);
    const server = recoveryQueueRef.current.then(async () => {
      if (!usesServerUserWorkspaceState()) throw new Error("Server draft storage is unavailable.");
      if (selectedRef.current?.assessment_id !== assessment.assessment_id) throw new Error("The assessment changed.");
      const payload = await fetchPipelineJson<{ version: number }>(
        `/api/me/assessment-drafts/${encodeURIComponent(assessment.assessment_id)}`,
        { method: "PUT", body: JSON.stringify({ if_match: draftVersionRef.current, draft: recovery }) },
      );
      if (selectedRef.current?.assessment_id === assessment.assessment_id) draftVersionRef.current = payload.version;
    });
    recoveryQueueRef.current = server.catch(() => undefined);
    // One confirmed durable copy is sufficient for navigation. Never report
    // success when both persistence paths fail.
    await Promise.any([local, server]);
  }, [activeSection, offlinePrincipal, referralId]);

  const clearRecoveryDraft = useCallback((assessmentId: string) => {
    const next = recoveryQueueRef.current.then(async () => {
      await localRecoveryQueueRef.current;
      if (dirtySectionsRef.current.size > 0) return;
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
    });
    recoveryQueueRef.current = next.catch(() => undefined);
    return next;
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
    setShowBeginDialog(false);
    setShowAddendum(false);
    loadRecoveryDraftForLiveAssessment(trainingAssessmentMode, loadRecoveryDraft, selected, data);
  }, [loadRecoveryDraft, offlinePrincipal, selected, trainingAssessmentMode]);

  useEffect(() => {
    if (!referralId || !selected || isAssessmentFinalized(selected) || !packetEvidenceVersion || dirty) return;
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
      initialSection ?? trainingAssessmentSection,
      trainingAssessmentMode === "schedule",
    );
    if (!focus) return;
    focusedAssessmentIdRef.current = focus.assessmentId;
    applyAssessmentFocus(focus, {
      setActiveSection,
      setIsFocused,
      setShowScheduleDialog,
      setShowBeginDialog,
    });
  }, [initialSection, nextRequiredTarget, selected, trainingAssessmentMode, trainingAssessmentSection]);

  const closeFromEscape = useEffectEvent(() => void closeAssessment(!preparing && !trainingAssessmentMode && onOpenAssignedWork ? onOpenAssignedWork : onOpenWorkspace));

  useEffect(() => {
    if (!isFocused || (embeddedFolder && !showBeginDialog && !showScheduleDialog)) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => handleAssessmentEscape(event, {
      showBeginDialog,
      showScheduleDialog,
      setShowBeginDialog,
      setShowScheduleDialog,
      closeAssessment: closeFromEscape,
    });
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isFocused, embeddedFolder, showBeginDialog, showScheduleDialog]);

  useEffect(() => {
    onSummaryChange?.({
      captured: coverage.captured,
      total: coverage.total,
      status: selected?.status ?? "not_started",
      assessmentId: selected?.assessment_id,
      scheduledStartAt: selected?.scheduled_start_at,
      scheduleStatus: selected?.schedule_status,
      startedAt: selected?.started_at,
      signedAt: selected?.signed_at,
    });
  }, [coverage.captured, coverage.total, onSummaryChange, selected?.assessment_id, selected?.scheduled_start_at, selected?.schedule_status, selected?.signed_at, selected?.started_at, selected?.status]);

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
      setShowScheduleDialog(false);
      setShowBeginDialog(false);
    } catch (createError) {
      setError(messageFor(createError, "The assessment record could not be created."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const prepareFromIntake = useEffectEvent(() => {
    void createAssessmentDraft();
  });

  useEffect(() => {
    if (!startQuestionnaire || isLoading || selected || !canCreateAssignedAssessment || preparationRequestedRef.current) return;
    preparationRequestedRef.current = true;
    prepareFromIntake();
  }, [canCreateAssignedAssessment, isLoading, selected, startQuestionnaire]);

  const beginAssessment = async () => {
    if (!assessmentReadyToBegin(selectedRef.current) || isBusy) return;
    setIsBusy(true);
    setError("");
    setMessage("Recording interview start...");
    try {
      await saveBeforeExit();
      await saveQueueRef.current;
      const current = selectedRef.current;
      if (!current || !assessmentReadyToBegin(current)) return;
      if (trainingAssessmentMode) {
        const updated = updateTrainingAssessment(current, {
          started_at: new Date().toISOString(),
        });
        upsertAssessment(updated, true);
        setNotebookView(preparing ? "prepare" : "assessment");
        setMessage("Interview start recorded locally");
        setShowBeginDialog(false);
        setShowScheduleDialog(false);
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
      // Merge the lifecycle response without replacing locally queued answers.
      receiveRemoteAssessment(payload.assessment, false);
      setNotebookView(preparing ? "prepare" : "assessment");
      await onAssessmentSaved?.(payload.assessment);
      setMessage("Interview start recorded");
      setShowBeginDialog(false);
      setShowScheduleDialog(false);
    } catch (startError) {
      setError(messageFor(startError, "The interview start could not be recorded. You can keep working and try again."));
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
    dirtySectionsRef.current = nextDirty;
    setDirtySections(nextDirty);
    setRemoteChange(conflicts.length > 0 || announce ? { assessment: latest, conflicts } : null);
    if (announce) {
      setMessage(remoteAssessmentMessage(conflicts.length, latest.updated_by.name));
    }
  }, []);

  const saveSectionNow = useCallback(async (section: AssessmentToolSection, captured?: Partial<AssessmentToolData>) => {
    const current = selectedRef.current;
    if (!canSaveAssessmentSection(current, dirtySectionsRef.current, section, Boolean(captured))) return;
    if (hasSectionConflict(remoteChangeRef.current, section)) {
      throw new Error(`Resolve the ${sectionLabels[section]} conflict before saving.`);
    }

    const sentData = captured ?? editableSectionData(draftRef.current, section);
    if (Object.entries(sentData).every(([field, value]) => sameAssessmentValue(current[field as AssessmentToolFieldKey], value))) return;
    setMessage("Saving changes...");
    const requestBody = JSON.stringify({
      section,
      if_match_section: normalizeAssessmentSectionVersions(current.section_versions)[section],
      client_mutation_id: mutationId(`assessment-${section}`),
      patch: { data: sentData },
    });
    try {
      const payload = trainingAssessmentMode ? { assessment: updateTrainingAssessment(current, sentData) } : await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
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
      dirtySectionsRef.current = nextDirty;
      setDirtySections(nextDirty);
      setMessage(nextDirty.size > 0 ? "Unsaved changes" : trainingAssessmentMode ? "Practice changes saved locally" : "All changes saved");
      setError("");
      if (nextDirty.size === 0 && !trainingAssessmentMode) void clearRecoveryDraft(saved.assessment_id);
    } catch (saveError) {
      if (isOfflineAssessmentSave(saveError, offlinePrincipal)) {
        await queueOfflineAssessmentMutation(offlinePrincipal, {
          dedupeKey: `${current.assessment_id}:${section}${captured ? `:${Object.keys(captured).sort().join(",")}` : ""}`,
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
        setMessage("Pending · retrying automatically");
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
    if (!offlinePrincipal || !window.navigator.onLine || offlineSyncRef.current) return;
    offlineSyncRef.current = true;
    try {
      const result = await flushOfflineAssessmentMutations(offlinePrincipal, async (mutation) => {
        const next = saveQueueRef.current.then(async () => {
          const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(mutation.url, { method: mutation.method, body: mutation.body });
          const current = selectedRef.current;
          const saved = payload.assessment;
          if (!current || current.assessment_id !== saved.assessment_id || saved.version <= current.version) return;
          const sent = JSON.parse(mutation.body) as { patch?: { data?: Partial<AssessmentToolData> } };
          // Acknowledged answers become the comparison base; newer typing stays
          // local without being mistaken for another person's concurrent edit.
          const base = pickAssessmentToolData(baseDataRef.current);
          for (const definition of assessmentToolFieldDefinitions) {
            const field = definition.key;
            if (sent.patch?.data?.[field] !== undefined && sameAssessmentValue(sent.patch.data[field], saved[field])) base[field] = saved[field] as never;
          }
          baseDataRef.current = base;
          receiveRemoteAssessment(saved, false);
        });
        saveQueueRef.current = next.catch(() => undefined);
        await next;
      });
      setPendingOfflineSaves(result.remaining);
      const current = selectedRef.current;
      if (current && result.completed + result.conflicts > 0) {
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
            if (result.remaining + dirtySectionsRef.current.size === 0) await removeOfflineAssessmentDraft(offlinePrincipal, current.assessment_id);
          }
        } catch {
          // The normal active-assessment poll will reconcile the saved version.
        }
      }
    } finally {
      offlineSyncRef.current = false;
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
    const onOnline = () => void syncOfflineChanges().catch(() => undefined);
    void refresh().then(() => syncOfflineChanges()).catch(() => undefined);
    const retryTimer = window.setInterval(onOnline, 10_000);
    window.addEventListener("pipeline:offline-state-changed", onStateChange);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.clearInterval(retryTimer);
      window.removeEventListener("pipeline:offline-state-changed", onStateChange);
      window.removeEventListener("online", onOnline);
    };
  }, [offlinePrincipal, syncOfflineChanges]);

  const queueSectionSave = useCallback((section: AssessmentToolSection, captured?: Partial<AssessmentToolData>) => {
    const next = saveQueueRef.current.then(() => saveSectionNow(section, captured));
    saveQueueRef.current = next.catch(() => undefined);
    return next;
  }, [saveSectionNow]);

  const flushDirtySections = useCallback(async () => {
    for (const section of [...dirtySectionsRef.current]) await queueSectionSave(section);
    await saveQueueRef.current;
  }, [queueSectionSave]);

  const saveBeforeExit = async () => {
    const current = selectedRef.current;
    if (trainingAssessmentMode) {
      await flushDirtySections();
      return;
    }
    if (!current || dirtySectionsRef.current.size === 0) return;
    const canonical = flushDirtySections().then(() => {
      if (dirtySectionsRef.current.size > 0) throw new Error("Answers are still pending.");
    });
    // A confirmed recovery copy or canonical save releases navigation; a failed
    // request never becomes a saved or signed record.
    await Promise.any([persistRecoveryDraft(current), canonical]);
  };

  usePersonaSwitchSave(async () => {
    if (isBusy || closingRef.current) throw new Error("Wait for the assessment to finish saving before switching.");
    const current = selectedRef.current;
    if (current) await persistRecoveryDraft(current);
    await flushDirtySections();
    if (dirtySectionsRef.current.size > 0) throw new Error("Some answers are not saved yet. Stay on this account and retry when connected.");
    if (current) await clearRecoveryDraft(current.assessment_id);
  });

  const saveAndCloseAssessment = async (onClosed?: () => void | Promise<void>) => {
    if (closingRef.current) throw new Error("Assessment navigation is already in progress.");
    closingRef.current = true;
    setIsClosing(true);
    setMessage("Saving last changes...");
    try {
      await saveBeforeExit();
      setMessage("");
      setShowScheduleDialog(false);
      setShowBeginDialog(false);
      await onClosed?.();
      setIsFocused(false);
    } catch (saveError) {
      setError(messageFor(saveError, "Your last changes could not be saved. Keep this assessment open and try again."));
      throw saveError;
    } finally {
      closingRef.current = false;
      setIsClosing(false);
    }
  };

  const closeAssessment = (onClosed?: () => void | Promise<void>) => saveAndCloseAssessment(onClosed).catch(() => undefined);
  const saveForHeaderNavigation = useEffectEvent(async () => {
    if (!embeddedFolder) return saveAndCloseAssessment();
    try {
      await saveBeforeExit();
      if (phoneInterview && phoneQuestionRef.current) setWorkingTarget({ field: phoneQuestionRef.current });
    } catch (saveError) {
      setError(messageFor(saveError, "Your last changes could not be saved. Keep this assessment open and try again."));
      throw saveError;
    }
  });

  useEffect(() => {
    if (!isFocused) return;
    if (!embeddedFolder) setAssessmentFocused(true);
    const content = contentRef.current;
    const previousIsolation = content?.style.isolation ?? "";
    if (content && !embeddedFolder) content.style.isolation = "isolate";
    // The open folder covers the workspace; do not tab into controls behind it.
    const backgrounds = !embeddedFolder && content ? Array.from(content.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.matches("[data-assessment-view]"))
      .map((element) => ({ element, inert: element.inert })) : [];
    for (const { element } of backgrounds) element.inert = true;
    const save = () => saveForHeaderNavigation();
    beforeNavigationRef.current = save;
    if (beforeWorkspaceNavigationRef) beforeWorkspaceNavigationRef.current = save;
    return () => {
      if (!embeddedFolder) setAssessmentFocused(false);
      if (content) content.style.isolation = previousIsolation;
      for (const { element, inert } of backgrounds) element.inert = inert;
      if (beforeNavigationRef.current === save) beforeNavigationRef.current = null;
      if (beforeWorkspaceNavigationRef?.current === save) beforeWorkspaceNavigationRef.current = null;
    };
  }, [beforeNavigationRef, beforeWorkspaceNavigationRef, contentRef, embeddedFolder, isFocused, phoneInterview, setAssessmentFocused]);

  const saveOnUnmount = useEffectEvent(() => {
    if (dirtySectionsRef.current.size > 0) void saveBeforeExit().catch(() => undefined);
  });

  useEffect(() => () => saveOnUnmount(), []);

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
    if (!reviewingChart || isRecommendationSaving) return;
    setIsBusy(true);
    setError("");
    setMessage("Signing assessment...");
    try {
      await flushDirtySections();
      if (dirtySectionsRef.current.size > 0) throw new Error("Signature pending until your answers finish saving. You can keep navigating.");
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
      void persistOfflineWorkingSet(payload.assessment);
      setMessage("Assessment signed");
    } catch (signError) {
      setError(messageFor(signError, "The assessment could not be signed."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const reviewChart = async () => {
    try {
      await saveBeforeExit();
      if (phoneInterview && phoneQuestionRef.current) setWorkingTarget({ field: phoneQuestionRef.current });
      if (onOpenChart) onOpenChart();
      else setNotebookView("chart");
    } catch (saveError) {
      setError(messageFor(saveError, "Your answers could not be saved. Please try again."));
    }
  };

  const saveSchedule = async () => {
    if (!hasAssessmentScheduleInput(selectedRef.current, scheduleStart) || isBusy) return;
    const start = operationalInputToIso(scheduleStart);
    if (!start) {
      setError("Choose a valid assessment date and time in Pacific Time.");
      return;
    }
    setIsBusy(true);
    setError("");
    setMessage("Saving schedule...");
    try {
      await saveBeforeExit();
      await saveQueueRef.current;
      const current = selectedRef.current;
      if (!hasAssessmentScheduleInput(current, scheduleStart)) return;
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
        return;
      }
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord; warnings?: string[] }>(
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
      receiveRemoteAssessment(payload.assessment, false);
      await onAssessmentSaved?.(payload.assessment);
      setMessage(payload.warnings?.length ? `Assessment scheduled. ${payload.warnings.join(" ")}` : "Assessment scheduled");
      dispatchGuideCompletion("assessment-schedule-save");
      setShowScheduleDialog(false);
      setShowBeginDialog(false);
    } catch (scheduleError) {
      setError(messageFor(scheduleError, "The assessment schedule could not be saved."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const addAddendum = async () => {
    const current = selectedRef.current;
    if (!isAssessmentFinalized(current) || !current || !addendumReason.trim() || !addendumNote.trim()) return;
    setIsBusy(true);
    setError("");
    setMessage("Saving note...");
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
      setMessage("Note added");
    } catch (addendumError) {
      setError(messageFor(addendumError, "The note could not be saved."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const updateField = (key: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => {
    const next = setAssessmentValue(draftRef.current, key, value);
    draftRef.current = next;
    setDraft(next);
    dirtySectionsRef.current = dirtyAssessmentSections(next, baseDataRef.current);
    setDirtySections(dirtySectionsRef.current);
    setMessage("Unsaved changes");
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
    const nextRemote = remaining.length > 0 ? { ...change, conflicts: remaining } : null;
    remoteChangeRef.current = nextRemote;
    setRemoteChange(nextRemote);
    const nextDirty = dirtyAssessmentSections(nextDraft, nextBase);
    dirtySectionsRef.current = nextDirty;
    setDirtySections(nextDirty);
    setMessage(remaining.length > 0 ? `${remaining.length} field conflicts still need review` : "Conflict resolved; saving changes...");
    if (!useLatest) void queueSectionSave(conflict.section, { [field]: structuredClone(nextDraft[field]) }).catch(() => undefined);
  };

  const focusAnswer = (field: AssessmentToolFieldKey) => {
    if (focusedFieldRef.current?.field === field) return;
    focusedFieldRef.current = { field, value: JSON.stringify(draftRef.current[field]), reason: getAssessmentUnableReason(draftRef.current, field) };
  };

  const commitAnswer = (field: AssessmentToolFieldKey) => {
    const focus = focusedFieldRef.current;
    focusedFieldRef.current = null;
    if (!focus || focus.field !== field) return;
    const data = draftRef.current;
    if (focus.value !== JSON.stringify(data[field])) {
      const section = assessmentToolFieldDefinitions.find((definition) => definition.key === field)!.section;
      void queueSectionSave(section, { [field]: structuredClone(data[field]) }).catch(() => undefined);
    }
    if (focus.reason !== getAssessmentUnableReason(data, field)) {
      // Reasons belong to the canonical QC section, not the question's section.
      void queueSectionSave("provenance_qc", { unable_to_assess_reasons: { ...data.unable_to_assess_reasons } }).catch(() => undefined);
    }
  };

  const commitForLayoutChange = useEffectEvent(() => {
    if (focusedFieldRef.current) commitAnswer(focusedFieldRef.current.field);
  });
  useLayoutEffect(() => () => { commitForLayoutChange(); }, [phoneInterview]);

  useEffect(() => {
    if (trainingAssessmentMode) return;
    const current = selectedRef.current;
    if (!current || !offlinePrincipal) return;
    const timer = window.setTimeout(() => {
      void persistOfflineWorkingSet(current).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [dirtySections, draft, offlinePrincipal, persistOfflineWorkingSet, selected?.assessment_id, selected?.meet_client_sent_at, trainingAssessmentMode]);

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
        title="Save the referral to open its questionnaire"
        detail="The assessment needs a referral ID so its history, files, and edits stay attached to one intake episode."
      />
    );
  }

  if (isLoading) {
    return <div className="flex min-h-56 items-center justify-center gap-2 text-[12px] text-[#737373]"><LoaderCircle className="animate-spin" size={16} /> Loading assessment history...</div>;
  }

  if (!selected) {
    if (reviewingChart) return <AssessmentFileSurface title={workspaceTitle} container={contentRef.current} header={null} dialogs={null}>
      <div className="min-h-0 flex-1 overflow-y-auto"><WorkspaceClientChart referral={referral ?? null} headerActions={chartActions} /></div>
    </AssessmentFileSurface>;
    return (
      <AssessmentEmpty
        title="Questionnaire"
        detail="Fill in what you know from the referral. Schedule and begin the interview when ready."
        action={canCreateAssignedAssessment ? <button type="button" data-guide-target="assessment-open" onClick={createAssessmentDraft} disabled={isBusy} className="h-10 bg-[#0f8b73] px-5 text-[11px] font-bold text-white transition-colors hover:bg-[#0b6d5b] disabled:opacity-50">Open questionnaire</button> : null}
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
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-[14px] font-extrabold text-[#202522]">{selected.started_at || selected.signed_at ? "Assessment" : "Questionnaire"}</h2><StatusLabel status={selected.status} /></div>
            <p className="mt-0.5 truncate text-[11px] text-[#68716c]">{assessmentSummaryLine(selected, completion, nextRequiredTarget)}</p>
          </div>
        </div>
        <button type="button" data-guide-target={["assessment-open", "assessment-schedule-open"].join(" ")} onClick={openFocusedAssessment} className="flex h-9 w-full items-center justify-center gap-2 bg-[#0f8b73] px-4 text-[11px] font-bold text-white transition-colors hover:bg-[#0b6d5b] sm:w-auto">{openLabel} <ChevronRight size={14} /></button>
      </section>
    );
  }

  const assessmentDetails = showSecondaryActions ? <>
    {phoneInterview && !preparing && !selected.signed_at ? recommendationControl?.(selected.assessment_id, setIsRecommendationSaving) : null}
    {!selected.signed_at && !selected.started_at && canEditClinical ? <button type="button" data-guide-target={showScheduleDialog ? undefined : "assessment-schedule-open"} onClick={() => { setShowBeginDialog(false); setShowScheduleDialog(true); }} aria-label={selected.scheduled_start_at ? "Reschedule assessment" : "Schedule assessment"}><CalendarClock size={15} />{selected.scheduled_start_at ? "Reschedule assessment" : "Schedule assessment"}</button> : null}
    {assessmentReadyToBegin(selected) && canEditClinical ? <button type="button" data-guide-target="assessment-begin" onClick={() => setShowBeginDialog(true)} disabled={isBusy || isClosing}><Play size={15} />Begin assessment</button> : null}
    {selected.signed_at && canAddAddendum ? <button type="button" onClick={() => setShowAddendum((value) => !value)} disabled={isBusy}><Plus size={14} />Add note</button> : null}
  </> : null;
  const nextConversationSection = () => {
    setWorkingTarget(null);
    if (nextSection) setActiveSection(nextSection.key);
    else void reviewChart();
  };

  return (
    <AssessmentFileSurface
      title={workspaceTitle}
      container={contentRef.current}
      header={<AssessmentInterviewHeader name={draft.resident_name} community={draft.community} disabled={isClosing}
        details={assessmentDetails} detailsRef={secondaryActionsRef}
        returnLabel={!preparing && !trainingAssessmentMode && onOpenAssignedWork ? "Workspaces" : onOpenWorkspace ? "Back to referral" : "Back to workspace"}
        onClose={() => void closeAssessment(!preparing && !trainingAssessmentMode && onOpenAssignedWork ? onOpenAssignedWork : onOpenWorkspace)}
        pages={<AssessmentFileNavigation hidden={phoneInterview} disabled={isClosing} preparing={preparing} reviewingChart={reviewingChart} preparationAvailable={!trainingAssessmentMode}
          onPrepare={() => { setWorkingTarget(null); setNotebookView("prepare"); }}
          onAssessment={() => { if (!reviewingChart) setWorkingTarget(null); setNotebookView("assessment"); }}
          onChart={() => void reviewChart()}
        />}
      />}
      dialogs={<AssessmentSchedulingDialogs
        assessment={selected}
        showScheduleDialog={!readOnly && showScheduleDialog}
        showBeginDialog={!readOnly && showBeginDialog}
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
        onCloseSchedule={() => setShowScheduleDialog(false)}
        onSaveSchedule={() => void saveSchedule()}
        onCloseBegin={() => setShowBeginDialog(false)}
        onBeginAssessment={() => void beginAssessment()}
      />}
    >

      {showAddendum && canAddAddendum ? (
        <div className="shrink-0 border-b border-[#d9dfdb] bg-[#f8faf9] px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-end">
            <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Reason</span><input value={addendumReason} maxLength={128} onChange={(event) => setAddendumReason(event.target.value)} placeholder="Correction or later information" className="mt-1 h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none focus:border-[#0f8b73]" /></label>
            <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Note</span><textarea value={addendumNote} maxLength={20_000} rows={2} onChange={(event) => setAddendumNote(event.target.value)} className="mt-1 w-full resize-y border border-[#c9ceca] bg-white px-3 py-2 text-[12px] leading-5 outline-none focus:border-[#0f8b73]" /></label>
            <button type="button" onClick={() => void addAddendum()} disabled={isBusy || !addendumReason.trim() || !addendumNote.trim()} className="h-10 bg-[#111111] px-5 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:bg-[#c9ceca]">Add</button>
          </div>
        </div>
      ) : null}

      {selected.signed_at ? (
        <div className="shrink-0 border-b border-[#d9dfdb] px-4 py-3 text-[11px] text-[#595959]">
          Signed by <strong>{selected.signed_by?.name ?? selected.assessor ?? "Assigned assessor"}</strong> on {new Date(selected.signed_at).toLocaleString()}.
          {!isAssessmentFinalized(selected) ? " You can still edit until Meet the Client is sent." : " Meet the Client sent. Use Add note for later information."}
          {(selected.addenda ?? []).length > 0 ? (
            <div className="mt-3 divide-y divide-[#e5e5e5] border-y border-[#e5e5e5]">
              {(selected.addenda ?? []).map((addendum) => <div key={addendum.addendum_id} className="py-3"><div className="font-black text-[#111111]">{addendum.reason_code}</div><div className="mt-1 whitespace-pre-wrap leading-5">{addendum.note}</div><div className="mt-1 text-[9px] text-[#737373]">{addendum.authored_by_name} · {new Date(addendum.created_at).toLocaleString()}</div></div>)}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {preparing && !phoneInterview ? <aside aria-label="Preparation navigation" className="order-last hidden w-[280px] shrink-0 overflow-y-auto border-l border-[#d9dfdb] bg-[#f7faf4] px-5 py-5 lg:block">
          <PreparationNavigation active={preparationGroup.key} data={draft} pending={pendingFields} onChange={setActiveSection} />
        </aside> : null}

        <main ref={chartScrollRef} className={`min-w-0 flex-1 bg-[#f7faf4] ${reviewingChart ? "overflow-y-auto" : phoneInterview ? phoneStyles.mobileMain : preparing ? "overflow-y-auto" : workingStyles.readingMain}`}>
          {phoneInterview ? null : preparing ? <div className="border-b border-[#d9dfdb] px-4 py-3 lg:hidden">
            <label htmlFor="preparation-group-mobile" className="mb-1 block text-[11px] font-semibold text-[#56665d]">Preparation group</label>
            <select id="preparation-group-mobile" value={preparationGroup.key} onChange={(event) => setActiveSection(event.target.value as AssessmentToolSection)} className="min-h-11 w-full rounded border border-[#cddace] bg-white px-3 text-[14px] text-[#234c36]">
              {assessmentPreparationGroups.map((group) => <option key={group.key} value={group.key}>{group.label}</option>)}
            </select>
          </div> : null}

          {error ? <div role="alert" className="border-b border-[#dce3e0] bg-[#f7faf9] px-5 py-3 text-[11px] font-semibold text-[#59645e]">{error}</div> : null}
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

          {reviewingChart ? <section aria-label="Assessment chart review" className={workingStyles.chartReview}>
            {!embeddedFolder ? <div className={workingStyles.chartReviewToolbar}>
              {phoneInterview ? <button type="button" onClick={() => setNotebookView("assessment")}><ChevronLeft size={16} />Return to questions</button> : null}
              <span>{selected.signed_at && dirtySections.size === 0 ? "Assessment signed" : "Chart in progress"}</span>
            </div> : null}
            {conversationSections.some((section) => section.remaining.length > 0) ? <p className={workingStyles.chartReviewNotice}>Assessment has {conversationSections.reduce((count, section) => count + section.remaining.length, 0)} unanswered or unverified items.</p> : null}
            <WorkspaceClientChart referral={referral ?? null} headerActions={chartActions} assessment={{ ...selected, ...draft, signed_at: dirtySections.size > 0 ? null : selected.signed_at }} practice={Boolean(trainingAssessmentMode)} />
          </section> : <div data-assessment-question-content className={!preparing && !phoneInterview ? workingStyles.readingContent : "w-full px-3 py-3 sm:px-4"}>
            <div className={preparing && !phoneInterview ? "mb-3" : "sr-only"}>
              <h3 className="text-[21px] font-bold text-[#213629]">{preparing ? preparationGroup.label : sectionDefinition.label}</h3>
                {preparing ? <p className="mt-2 text-[12px] leading-5 text-[#657167]">Use documented information; leave unknowns unanswered. These are the same answers used in the assessment.</p> : null}
            </div>
            {trainingAssessmentMode && activeSection === "provenance_qc" && practiceReview ? <PracticeAssessmentReview review={practiceReview} /> : null}
            <QuestionPage
              key={`${selected.assessment_id}-${preparing}`}
              preparing={preparing}
              onQuestionChange={rememberPhoneQuestion}
              onSectionChange={(section) => { setWorkingTarget(null); setActiveSection(section); }}
              onFinish={() => {
                if (preparing) setNotebookView("assessment");
                else void reviewChart();
              }}
              section={activeSection}
              assessment={selected}
              data={draft}
              pending={pendingFields}
              questions={preparing ? preparationQuestions(preparationGroup, draft) : sectionQuestions}
              required={requiredInterviewFields}
              target={workingTarget}
              questionNavigation={!preparing && !phoneInterview ? <AssessmentWorkingNavigation data={draft} pending={pendingFields} activeSection={activeSection} guideTargets={assessmentSectionGuideTargets} onSectionChange={(section) => { setWorkingTarget(null); setActiveSection(section); }} /> : null}
              disabled={isBusy || isAssessmentFinalized(selected) || !canEditClinical}
              reviewDisabled={isBusy || isAssessmentFinalized(selected) || !canEditClinical}
              onChange={updateField}
              onFieldFocus={(field) => {
                focusAnswer(field);
                if (preparing) setActiveSection(assessmentToolFieldDefinitions.find((definition) => definition.key === field)!.section);
              }}
              onFieldBlur={commitAnswer}
              onReview={(field, action) => void reviewExtractedField(field, action)}
              onUnableReasonChange={(field, reason) => updateField("unable_to_assess_reasons", setAssessmentUnableReason(draftRef.current.unable_to_assess_reasons, field, reason))}
              onReferenceEdit={(field) => {
                setActiveSection(assessmentToolFieldDefinitions.find((definition) => definition.key === field)!.section);
                setWorkingTarget({ field });
              }}
            />

            {preparing && !phoneInterview ? <div className="mt-7 flex items-center justify-between gap-3">
              <button type="button" onClick={() => setActiveSection(assessmentPreparationGroups[preparationIndex - 1].key)} disabled={preparationIndex === 0} className="flex h-10 items-center gap-2 border border-[#c9ceca] px-4 text-[11px] font-bold disabled:opacity-35"><ChevronLeft size={14} />Previous</button>
              <button type="button" data-guide-target="assessment-next-section" onClick={() => {
                if (preparationIndex === assessmentPreparationGroups.length - 1) setNotebookView("assessment");
                else setActiveSection(assessmentPreparationGroups[preparationIndex + 1].key);
              }} className="flex h-10 items-center gap-2 bg-[#0f8b73] px-4 text-[11px] font-bold text-white">{preparationIndex === assessmentPreparationGroups.length - 1 ? "Review assessment" : "Next group"}<ChevronRight size={14} /></button>
            </div> : null}

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
          </div>}
        </main>

      </div>

      <footer aria-label="Assessment actions" data-assessment-chart-review={reviewingChart || undefined} className={`${workingStyles.footer} flex shrink-0 flex-wrap items-center justify-between bg-white ${phoneInterview ? phoneStyles.mobileFooter : "gap-x-3 gap-y-2 px-4 py-2 sm:px-6 lg:px-8"}`}>
        <span data-guide-target="assessment-save-status" aria-live="polite" className={`flex min-w-0 flex-1 items-center gap-1.5 text-[11px] ${error ? "text-[#69716c]" : !networkOnline || pendingOfflineSaves > 0 || dirty || isBusy ? "text-[#59645e]" : "text-[#0c705f]"}`}>
          {!error && networkOnline && pendingOfflineSaves === 0 && !dirty && !isBusy ? <Check size={14} className="shrink-0" aria-hidden="true" /> : null}
          <span className="truncate">{assessmentSaveStatus({ error, trainingAssessmentMode, dirty, message, networkOnline, pendingOfflineSaves })}</span>
        </span>
        {!phoneInterview && !preparing && !selected.signed_at ? recommendationControl?.(selected.assessment_id, setIsRecommendationSaving) : null}
        {embeddedFolder && assessmentDetails ? <AssessmentFileDetails label="Assessment details" detailsRef={secondaryActionsRef}>{assessmentDetails}</AssessmentFileDetails> : null}
        {!preparing && !reviewingChart && !phoneInterview ? <nav aria-label="Assessment section steps" className={workingStyles.sectionSteps}>
          <button type="button" className={workingStyles.previousSection} onClick={() => { if (previousSection) { setWorkingTarget(null); setActiveSection(previousSection.key); } }} disabled={!previousSection || isBusy || isClosing} title={previousSection ? `Previous: ${previousSection.label}` : undefined}><ChevronLeft size={16} aria-hidden="true" />Previous section</button>
          <span className={workingStyles.stepPosition} aria-label={`Section ${activeSectionIndex + 1} of ${conversationSections.length}`}>{activeSectionIndex + 1} / {conversationSections.length}</span>
          <div data-assessment-primary-action><button type="button" data-guide-target="assessment-next-section" onClick={nextConversationSection} disabled={isBusy || isClosing} title={nextSection ? `Next: ${nextSection.label}` : "Review the chart before signing"}>{nextSection ? "Next section" : "Review chart"}<ChevronRight size={16} aria-hidden="true" /></button></div>
        </nav> : (preparing || reviewingChart || selected.signed_at) ? <div>
        <div data-assessment-primary-action className="flex flex-wrap items-center gap-2">
          {selected.signed_at ? (
            onContinueToWorkflow && !embeddedFolder ? <button type="button" onClick={continueToWorkflow} disabled={isBusy || isClosing}>{isAssessmentFinalized(selected) ? "View admission" : "Admission decision"}<ChevronRight size={14} /></button> : <span className="text-[12px] font-semibold text-[#0f6f5e]">{isAssessmentFinalized(selected) ? "Sent" : "Signed"}</span>
          ) : preparing ? (
            <button type="button" onClick={() => setNotebookView("assessment")}>{selected.started_at ? "Return to assessment" : "Open assessment"}<ChevronRight size={14} /></button>
          ) : canEditClinical ? (
            <button type="button" data-guide-target="assessment-sign" aria-label="Sign assessment" onClick={() => window.confirm("Sign this assessment? You can still edit it until Meet the Client is sent. Changes are logged.") && void signAssessment()} disabled={isBusy || isClosing || isRecommendationSaving}>{isRecommendationSaving ? "Saving recommendation..." : "Sign assessment"}</button>
          ) : !selected.started_at && canSupervise ? (
            <button type="button" data-guide-target={showScheduleDialog ? undefined : "assessment-schedule-open"} onClick={() => { setShowBeginDialog(false); setShowScheduleDialog(true); }} disabled={isBusy || isClosing}><CalendarClock size={15} />{selected.scheduled_start_at ? "Reschedule assessment" : "Schedule assessment"}</button>
          ) : null}
        </div>
        </div> : null}
      </footer>

    </AssessmentFileSurface>
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
        {error ? <div role="alert" className="mt-4 flex items-center justify-center gap-2 text-[11px] text-[#59645e]"><AlertTriangle size={13} /> {error}</div> : null}
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

export function assessmentOpenLabel(assessment: Pick<PipelineAssessmentRecord, "signed_at" | "started_at" | "scheduled_start_at" | "schedule_status">) {
  if (assessment.signed_at) return "Review assessment";
  if (assessment.started_at) return "Resume assessment";
  return "Open questionnaire";
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
      ? `${completion.complete} of ${completion.total} captured · Next: ${nextTarget.label}`
      : `Ready to sign · ${assessor}`;
  }
  if (hasActiveAssessmentSchedule(assessment)) return `${new Date(assessment.scheduled_start_at!).toLocaleString()} · ${assessor}`;
  return `${completion.complete} of ${completion.total} captured · ${assessor}`;
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

function remoteAssessmentMessage(conflicts: number, updatedBy: string) {
  return conflicts > 0
    ? `${conflicts} field conflict${conflicts === 1 ? "" : "s"} need review`
    : `Updated by ${updatedBy}`;
}
