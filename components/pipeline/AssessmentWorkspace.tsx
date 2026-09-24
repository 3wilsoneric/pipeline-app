"use client";

import { useConfirmationDialog } from "./useConfirmationDialog";

import { referralDocumentAutofillEnabled } from "@/lib/extraction/contracts";

import { usePersonaSwitchSave } from "@/lib/demo/persona-switch-save";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
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
import type { ReferralChartEditField } from "@/lib/pipeline/client-chart-context";
import WorkspaceClientChart from "@/components/pipeline/TransferredWorkspaceChart";
import type {
  AssessmentListResponse,
  AssessmentPatchInput,
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
import { normalizeAssessmentSectionVersions } from "@/lib/assessment/assessment-sections";
import type { EditingPresence } from "@/lib/pipeline/editing-presence";
import type { AssessmentDraftWorkbookSources, PipelineAssessmentDraft } from "@/lib/pipeline/user-workspace-state-types";
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
  acknowledgeAssessmentWorkbookSave,
  assessmentSaveGroups,
  assessmentOfflinePrincipal,
  assessmentRequiresSavedReferral,
  assessmentSaveStatus,
  canAddAssessmentAddendum,
  canCreateAssessment,
  canEditAssessment,
  canSaveAssessmentSection,
  canRebaseAssessmentAnswers,
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
import AssessmentWorkingSection, { AssessmentWorkingNavigation, AssessmentWorkMode, WorkingAssessmentField } from "@/components/pipeline/AssessmentWorkingSection";
import HomeDialog from "@/components/pipeline/HomeDialog";
import AssessmentInterviewHeader, { AssessmentFileDetails } from "@/components/pipeline/AssessmentInterviewHeader";
import { assessmentGapSections, assessmentQuestionStatus, isInterviewFocusField } from "@/components/pipeline/assessment-working-view";
import { AssessmentSchedulingDialogs } from "@/components/pipeline/AssessmentSchedulingDialogs";
import { isoToOperationalInput, operationalInputToIso } from "@/components/pipeline/pipeline-calendar-model";
import { assessmentScheduleDraft, type AssessmentScheduleDraft } from "@/lib/assessment/assessment-schedule-draft";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import { loadPipelineAssessmentResumeLocation } from "@/lib/pipeline/work-continuity-client";
import { AssessmentFileSurface, AssessmentFileNavigation } from "@/components/pipeline/AssessmentPreparation";
import AssessmentPhoneInterview from "@/components/pipeline/AssessmentPhoneInterview";
import AssessmentExcelBackup from "@/components/pipeline/AssessmentExcelBackup";
import { validateAssessmentPatchRequest } from "@/lib/assessment/assessment-validation";
import { usePhoneAssessment } from "@/components/pipeline/use-phone-layout";
import phoneStyles from "@/components/pipeline/AssessmentPhoneInterview.module.css";
import workingStyles from "@/components/pipeline/AssessmentWorkingSection.module.css";
import { assessmentPreparationGroups, preparationGroupForSection, preparationQuestions } from "@/lib/assessment/assessment-preparation";

type AssessmentWorkspaceProps = {
  workbookImport?: File | null;
  onWorkbookImportRead?: () => void;
  readOnly?: boolean;
  referralId?: number;
  referral?: Referral;
  recommendationControl?: (assessmentId: string, onSavingChange: (saving: boolean) => void) => ReactNode;
  trainingAssessmentMode?: TrainingAssessmentMode;
  initialTrainingAssessment?: PipelineAssessmentRecord;
  onTrainingAssessmentChange?: (assessment: PipelineAssessmentRecord, action?: "scheduled") => void;
  trainingAssessmentSection?: AssessmentToolSection;
  initialSection?: AssessmentToolSection;
  initialQuestion?: AssessmentToolFieldKey;
  initialLocation?: PipelineWorkspaceLocation;
  assignedAssessorId?: string;
  startQuestionnaire?: boolean;
  scheduleRequested?: boolean;
  onScheduleRequestHandled?: () => void;
  beginRequested?: boolean;
  onBeginRequestHandled?: () => void;
  workspaceTitle?: string;
  chartReview?: boolean;
  assessmentReview?: boolean;
  chartActions?: ReactNode;
  chartDocuments?: ReactNode;
  onEditReferralField?: (field: ReferralChartEditField) => void;
  onOpenChart?: () => void;
  onReviewAssessment?: () => void;
  onOpenAssessment?: () => void;
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
  onAssessmentSaved?: (assessment: PipelineAssessmentRecord, referral?: Referral) => void | Promise<void>;
  onContinueToWorkflow?: () => void;
  onOpenWorkspace?: () => void;
  onActiveSectionChange?: (section: AssessmentToolSection, location: PipelineWorkspaceLocation) => void;
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
  showScheduleDialog: boolean;
  setShowScheduleDialog: (show: boolean) => void;
  closeAssessment: () => void;
};

type AssessmentFocusState = {
  section?: AssessmentToolSection;
  showScheduleDialog: boolean;
};

type AssessmentAutoFocusState = AssessmentFocusState & { assessmentId: string };

type AssessmentAutoFocusSetters = {
  setActiveSection: (section: AssessmentToolSection) => void;
  setIsFocused: (focused: boolean) => void;
  setShowScheduleDialog: (show: boolean) => void;
};

function handleAssessmentEscape(event: KeyboardEvent, context: AssessmentEscapeContext) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (context.showScheduleDialog) { context.setShowScheduleDialog(false); return; }
  context.closeAssessment();
}

function resolveAssessmentAutoFocus(
  assessment: PipelineAssessmentRecord | null,
  focusedAssessmentId: string,
  nextRequiredSection: AssessmentToolSection | undefined,
  initialSection: AssessmentToolSection | undefined,
  openSchedule: boolean,
  savedPosition: SavedAssessmentPosition,
): AssessmentAutoFocusState | null {
  // Wait for this user's saved position; a next-gap default must not replace it.
  if (!assessment?.assessment_id || focusedAssessmentId === assessment.assessment_id || savedPosition === undefined) return null;
  return {
    assessmentId: assessment.assessment_id,
    section: savedPosition?.assessmentSection ?? autoFocusSection(assessment, nextRequiredSection, initialSection),
    showScheduleDialog: openSchedule,
  };
}

// undefined while loading; null when there is no saved position or the entry was explicit.
type SavedAssessmentPosition = PipelineWorkspaceLocation | null | undefined;

function hasExplicitAssessmentEntry(props: Pick<AssessmentWorkspaceProps, "initialSection" | "trainingAssessmentSection" | "initialQuestion" | "initialLocation" | "trainingAssessmentMode" | "referralId">) {
  return Boolean(props.initialSection || props.trainingAssessmentSection || props.initialQuestion || props.initialLocation?.assessmentQuestion || props.trainingAssessmentMode || !props.referralId);
}

function resolveAssessmentFocusState(
  assessment: PipelineAssessmentRecord | null,
  nextRequiredSection: AssessmentToolSection | undefined,
  initialSection: AssessmentToolSection | undefined,
): AssessmentFocusState {
  return {
    section: autoFocusSection(assessment, nextRequiredSection, initialSection),
    showScheduleDialog: false,
  };
}

function autoFocusSection(assessment: PipelineAssessmentRecord | null, nextRequiredSection: AssessmentToolSection | undefined, initialSection: AssessmentToolSection | undefined) {
  return assessment?.started_at && nextRequiredSection && !initialSection ? nextRequiredSection : undefined;
}

function interviewWorkingTarget(field: AssessmentToolFieldKey | null) {
  return field && isInterviewFocusField(field) ? { field } : null;
}

function assessmentResumeTarget(assessment: PipelineAssessmentRecord, section: AssessmentToolSection | undefined, field: AssessmentToolFieldKey | undefined, preparing: boolean) {
  if (!field) return null;
  const data = pickAssessmentToolData(assessment);
  const pending = getPendingFields(assessment);
  const questions = preparing
    ? preparationQuestions(preparationGroupForSection(section ?? "identity"), data)
    : getAssessmentInterviewQuestions(section ?? "identity", data).filter((question) => isInterviewFocusField(question.field));
  // A saved position is an explicit return target, even after the answer was
  // captured. Only fall back to a gap if that question is no longer applicable.
  if (questions.some((question) => question.field === field)) return { field };
  const start = Math.max(0, questions.findIndex((question) => question.field === field));
  const next = [...questions.slice(start), ...questions.slice(0, start)]
    .find((question) => assessmentQuestionStatus(question, data, pending) !== "captured");
  return next ? { field: next.field } : null;
}

function canScheduleUnstartedAssessment(assessment: PipelineAssessmentRecord, canEdit: boolean) {
  return canEdit && !assessment.started_at && !assessment.signed_at;
}

function assessmentReadyToBegin(assessment: PipelineAssessmentRecord | null) {
  return Boolean(assessment && !assessment.started_at && !assessment.signed_at && assessment.status !== "complete");
}

function assessmentDialogLocation(reviewing: boolean, scheduling: boolean, beginning: boolean): Pick<PipelineWorkspaceLocation, "assessmentDialog"> {
  if (reviewing) return {};
  if (beginning) return { assessmentDialog: "begin" };
  return scheduling ? { assessmentDialog: "schedule" } : {};
}

function applyAssessmentFocus(state: AssessmentFocusState, setters: AssessmentAutoFocusSetters) {
  if (state.section) setters.setActiveSection(state.section);
  setters.setIsFocused(true);
  setters.setShowScheduleDialog(state.showScheduleDialog);
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
  workbookImport,
  onWorkbookImportRead,
  readOnly = false,
  referralId,
  referral,
  recommendationControl,
  trainingAssessmentMode,
  initialTrainingAssessment,
  onTrainingAssessmentChange,
  trainingAssessmentSection,
  initialSection,
  initialQuestion,
  initialLocation,
  assignedAssessorId,
  startQuestionnaire = false,
  scheduleRequested = false,
  onScheduleRequestHandled,
  beginRequested = false,
  onBeginRequestHandled,
  workspaceTitle,
  chartReview,
  assessmentReview = false,
  chartActions,
  chartDocuments,
  onEditReferralField,
  onOpenChart,
  onReviewAssessment,
  onOpenAssessment,
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
  const initialTrainingAssessmentRef = useRef(initialTrainingAssessment);
  const phoneLayout = usePhoneAssessment();
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const secondaryActionsRef = useRef<HTMLDetailsElement>(null);
  const [recoveryToolsAssessment, setRecoveryToolsAssessment] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<PipelineAssessmentRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<AssessmentToolData>(createEmptyAssessmentToolData);
  const [activeSection, setActiveSection] = useState<AssessmentToolSection>(initialSection ?? trainingAssessmentSection ?? "identity");
  // Entry order: explicit requested section/question, then this user's saved
  // position for the workspace, then the existing default entry behavior.
  const [savedPosition, setSavedPosition] = useState<SavedAssessmentPosition>(() => hasExplicitAssessmentEntry({
    initialSection, trainingAssessmentSection, initialQuestion, initialLocation, trainingAssessmentMode, referralId,
  }) ? null : undefined);
  // The assessment whose entry position has been resolved and may be published.
  const [resolvedPositionFor, setResolvedPositionFor] = useState("");
  const [isLoading, setIsLoading] = useState(Boolean(referralId));
  const [isBusy, setIsBusy] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [dirtySections, setDirtySections] = useState<Set<AssessmentToolSection>>(new Set());
  const [remoteChange, setRemoteChange] = useState<AssessmentRemoteChange | null>(null);
  const [presence, setPresence] = useState<EditingPresence[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showScheduleDialog, setShowScheduleDialog] = useState(initialLocation?.assessmentDialog === "schedule");
  const [showInterviewDate, setShowInterviewDate] = useState(false);
  const [showBeginDialog, setShowBeginDialog] = useState(initialLocation?.assessmentDialog === "begin");
  const [isFocused, setIsFocused] = useState(false);
  const [workingTarget, setWorkingTarget] = useState<{ field: AssessmentToolFieldKey } | null>(initialLocation?.assessmentQuestion ? { field: initialLocation.assessmentQuestion } : null);
  const [notebookPage, setNotebookPage] = useState<{ assessmentId: string; view: "prepare" | "assessment" | "chart" } | null>(null);
  const [unrecordedStartId, setUnrecordedStartId] = useState<string | null>(null);
  const [isRecommendationSaving, setIsRecommendationSaving] = useState(false);
  const [phoneQuestion, setPhoneQuestion] = useState<AssessmentToolFieldKey | null>(() => initialQuestion ?? initialLocation?.assessmentQuestion ?? null);
  const phoneQuestionRef = useRef(phoneQuestion);
  const interviewReturnRef = useRef<{ assessmentId: string; section: AssessmentToolSection; field: AssessmentToolFieldKey | null } | null>(null);
  const questionSectionRef = useRef(initialSection);
  const rememberPhoneQuestion = useCallback((field: AssessmentToolFieldKey) => {
    if (phoneQuestionRef.current === field && questionSectionRef.current === activeSection) return;
    phoneQuestionRef.current = field;
    questionSectionRef.current = activeSection;
    setPhoneQuestion(field);
    sectionRevisionRef.current += 1;
  }, [activeSection]);
  const chartScrollRef = useRef<HTMLElement>(null);
  const [scheduleFields, setScheduleFields] = useState<AssessmentScheduleDraft>({ start: "", duration: "60", method: "in_person", location: "", base: "" });
  const { start: scheduleStart, duration: scheduleDuration, method: scheduleMethod, location: scheduleLocation } = scheduleFields;
  const pendingScheduleRef = useRef<AssessmentScheduleDraft | null>(null);
  const scheduleRevisionRef = useRef(0);
  const [scheduleDraftStatus, setScheduleDraftStatus] = useState("");
  const [recoveryLoadedFor, setRecoveryLoadedFor] = useState("");
  const changeScheduleField = <Key extends keyof AssessmentScheduleDraft>(key: Key, value: AssessmentScheduleDraft[Key]) => {
    scheduleRevisionRef.current += 1;
    const next = { ...(pendingScheduleRef.current ?? scheduleFields), [key]: value };
    pendingScheduleRef.current = next;
    setScheduleFields(next);
    setScheduleDraftStatus("Unsaved appointment details");
  };
  const [showAddendum, setShowAddendum] = useState(false);
  const [addendumReason, setAddendumReason] = useState("");
  const [addendumNote, setAddendumNote] = useState("");
  const [viewer, setViewer] = useState<PipelineCurrentUser | null>(null);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [pendingOfflineSaves, setPendingOfflineSaves] = useState(0);
  const [offlineReturnToSync, setOfflineReturnToSync] = useState<string | null>(null);
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
  const initializedAssessmentIdRef = useRef<{ id: string; principal: string } | null>(null);
  const touchedFieldsRef = useRef(new Set<AssessmentToolFieldKey>());
  const workbookSourcesRef = useRef<AssessmentDraftWorkbookSources>({});
  const focusedAssessmentIdRef = useRef("");
  const preparationRequestedRef = useRef(false);
  const focusedFieldRef = useRef<{ field: AssessmentToolFieldKey; value: string; reason: string } | null>(null);
  const onActiveSectionChangeRef = useRef(onActiveSectionChange);
  const sectionRevisionRef = useRef(0);
  const packetSyncKeysRef = useRef(new Set<string>());
  const createMutationRef = useRef<{ referralId: number; id: string } | null>(null);
  const dirty = dirtySections.size > 0;
  const offlinePrincipal = assessmentOfflinePrincipal(trainingAssessmentMode, viewer);

  const selected = assessments.find((assessment) => assessment.assessment_id === selectedId) ?? null;
  const notebookView = notebookPage?.assessmentId === selectedId ? notebookPage.view : initialLocation?.assessmentMode === "prepare" ? "prepare" : initialLocation?.assessmentMode === "interview" ? "assessment" : null;
  const setNotebookView = (view: "prepare" | "assessment" | "chart") => setNotebookPage({ assessmentId: selectedId, view });
  const reviewingChart = chartReview ?? notebookView === "chart";
  const embeddedFolder = Boolean(workspaceTitle);
  const preparationActive = () => notebookView === "prepare" || (notebookView === null && (trainingAssessmentMode === "prepare" || trainingAssessmentMode === "schedule" || (!trainingAssessmentMode && assessmentReadyToBegin(selected) && unrecordedStartId !== selectedId)));
  const preparing = preparationActive();
  const phoneInterview = phoneLayout && !preparing;
  const preparationGroup = preparationGroupForSection(activeSection);
  const preparationIndex = assessmentPreparationGroups.indexOf(preparationGroup);
  const visibleSectionKey = preparing ? preparationGroup.key : activeSection;
  const previousVisibleSectionRef = useRef(visibleSectionKey);
  const QuestionPage = phoneInterview ? AssessmentPhoneInterview : AssessmentWorkingSection;
  const { canSupervise, canEditClinical, canCreateAssignedAssessment, canAddAddendum } = assessmentWorkspacePermissions(
    trainingAssessmentMode, viewer, selected, assignedAssessorId, readOnly,
  );
  const coverage = useMemo(() => getAssessmentInterviewCoverage(draft), [draft]);
  const completion = useMemo(() => getAssessmentCompletionSummary(draft), [draft]);
  const pendingFields = useMemo(() => getPendingFields(selected), [selected]);
  const sectionDefinition = assessmentInterviewSections.find((section) => section.key === activeSection) ?? assessmentInterviewSections[0];
  const requiredInterviewFields = useMemo(
    () => new Set(getRequiredAssessmentInterviewQuestions(draft).map((question) => question.field)),
    [draft],
  );
  const reviewSections = assessmentGapSections(draft, pendingFields);
  const conversationSections = assessmentGapSections(draft, pendingFields, true);
  const activeSectionIndex = conversationSections.findIndex((section) => section.key === activeSection);
  const sectionQuestions = conversationSections[activeSectionIndex].questions;
  const pageSections = preparing ? assessmentPreparationGroups : conversationSections;
  const pageIndex = preparing ? preparationIndex : activeSectionIndex;
  const nextSection = pageSections[pageIndex + 1];
  const previousSection = pageSections[pageIndex - 1];
  const nextRequiredTarget = assessmentCompletionTarget(completion.missing[0]);
  const practiceReview = useMemo(
    () => trainingAssessmentMode && !initialTrainingAssessment ? getAssessmentPracticeReview(draft) : null,
    [draft, trainingAssessmentMode, initialTrainingAssessment],
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
      { setActiveSection, setIsFocused, setShowScheduleDialog },
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

  useEffect(() => {
    if (savedPosition !== undefined || !referralId) return;
    let cancelled = false;
    void loadPipelineAssessmentResumeLocation(referralId).catch(() => undefined).then((location) => {
      if (!cancelled) setSavedPosition(location ?? null);
    });
    return () => { cancelled = true; };
  }, [referralId, savedPosition]);

  // Publish the committed section before a reflected route effect can restore an older choice.
  useLayoutEffect(() => {
    sectionRevisionRef.current += 1;
  }, [activeSection, preparing, reviewingChart, showScheduleDialog, showBeginDialog, phoneQuestion, selectedId]);
  useLayoutEffect(() => {
    // Do not publish the placeholder section before the entry position is resolved;
    // it would overwrite the saved bookmark and read back as an explicit route.
    if (!selectedId || resolvedPositionFor !== selectedId) return;
    onActiveSectionChangeRef.current?.(activeSection, {
      view: "assessment", assessmentSection: activeSection,
      assessmentMode: reviewingChart ? "review" : preparing ? "prepare" : "interview",
      ...assessmentDialogLocation(reviewingChart, showScheduleDialog, showBeginDialog),
      ...(phoneQuestion && questionSectionRef.current === activeSection && !reviewingChart ? { assessmentQuestion: phoneQuestion } : {}),
    });
  }, [activeSection, preparing, reviewingChart, showScheduleDialog, showBeginDialog, phoneQuestion, selectedId, resolvedPositionFor]);

  const upsertAssessment = useCallback((assessment: PipelineAssessmentRecord, select = false) => {
    setAssessments((current) => [assessment, ...current.filter((item) => item.assessment_id !== assessment.assessment_id)]);
    if (select) setSelectedId(assessment.assessment_id);
    selectedRef.current = assessment;
    const data = pickAssessmentToolData(assessment);
    baseDataRef.current = data;
    draftRef.current = data;
    setDraft(data);
    workbookSourcesRef.current = {};
    dirtySectionsRef.current = new Set();
    setDirtySections(dirtySectionsRef.current);
    setRemoteChange(null);
  }, []);

  const loadRecoveryDraft = useCallback(async (assessment: PipelineAssessmentRecord) => {
    const positionRevision = sectionRevisionRef.current;
    const scheduleRevision = scheduleRevisionRef.current;
    const mergeRecoveryAnswers = (recovered: PipelineAssessmentDraft, currentData: AssessmentToolData) => {
      const merged = pickAssessmentToolData(draftRef.current);
      const recoveredBase = pickAssessmentToolData(baseDataRef.current);
      const conflicts: AssessmentFieldConflict[] = [...(remoteChangeRef.current?.conflicts ?? [])];
      for (const definition of assessmentToolFieldDefinitions) {
        const field = definition.key;
        if (touchedFieldsRef.current.has(field)) continue;
        const localChanged = !sameAssessmentValue(recovered.data[field], recovered.baseData[field]);
        if (!localChanged) continue;
        const previousConflict = conflicts.findIndex((conflict) => conflict.field === field);
        if (previousConflict >= 0) conflicts.splice(previousConflict, 1);
        const remoteChanged = !sameAssessmentValue(currentData[field], recovered.baseData[field]);
        merged[field] = recovered.data[field] as never;
        if (recovered.workbookSources?.[field]) workbookSourcesRef.current[field] = recovered.workbookSources[field];
        else delete workbookSourcesRef.current[field];
        if (remoteChanged && !sameAssessmentValue(recovered.data[field], currentData[field])) {
          recoveredBase[field] = recovered.baseData[field] as never;
          conflicts.push({
            field,
            localValue: recovered.data[field],
            remoteValue: currentData[field],
            section: definition.section,
          });
        }
      }
      return { merged, recoveredBase, conflicts };
    };

    const restoreRecoveryPosition = (recovered: PipelineAssessmentDraft) => {
      // Reading position is useful even when every answer already reached the server.
      // A late recovery read must not undo a newer section choice.
      if (sectionRevisionRef.current !== positionRevision) return;
      if (touchedFieldsRef.current.size === 0 && (!initialSection || initialSection === recovered.activeSection)) {
        if (recovered.activeSection) setActiveSection(recovered.activeSection);
        if (recovered.activeQuestion) setWorkingTarget((current) => current ?? { field: recovered.activeQuestion! });
      }
    };
    const applyRecoveryAnswers = (recovered: PipelineAssessmentDraft, assessment: PipelineAssessmentRecord) => {
      restoreRecoveryPosition(recovered);
      if (recovered.dirtySections.length === 0) return;

      // Recovery may finish after the assessor has already typed or saved. Only
      // restore untouched fields; a late read must never erase newer input.
      const currentData = pickAssessmentToolData(assessment);
      const { merged, recoveredBase, conflicts } = mergeRecoveryAnswers(recovered, currentData);
      // Keep the pre-conflict comparison value until the assessor chooses an
      // answer. Otherwise the next persisted draft loses the conflict on reopen.
      baseDataRef.current = recoveredBase;
      draftRef.current = merged;
      setDraft(merged);
      const recoveredDirty = dirtyAssessmentSections(merged, currentData);
      dirtySectionsRef.current = recoveredDirty;
      setDirtySections(recoveredDirty);
      const change = conflicts.length > 0 ? { assessment, conflicts } : null;
      remoteChangeRef.current = change;
      setRemoteChange(change);
      setMessage(conflicts.length > 0
        ? "Restored answers · review conflicting changes"
        : recoveredDirty.size > 0 ? "Restored answers · not yet saved" : "All changes saved");
    };
    const restoreAppointmentDraft = (recovered: PipelineAssessmentDraft, current: PipelineAssessmentRecord) => {
    if (recovered.scheduleDraft && scheduleRevisionRef.current === scheduleRevision && !isAssessmentFinalized(current)) {
      if (recovered.scheduleDraft.base === assessmentScheduleDraft(current).base) {
        pendingScheduleRef.current = recovered.scheduleDraft;
        setScheduleFields(recovered.scheduleDraft);
        setScheduleDraftStatus("Appointment draft restored · not booked");
      } else {
        setScheduleDraftStatus("The appointment changed since your draft. Showing the current booking.");
      }
    }
    };
    const initialization = initializedAssessmentIdRef.current;
    const { recovered, recoveredVersion } = await readAssessmentRecovery(assessment.assessment_id, offlinePrincipal);
    if (initializedAssessmentIdRef.current !== initialization || selectedRef.current?.assessment_id !== assessment.assessment_id) return;
    draftVersionRef.current = recoveredVersion;
    setRecoveryLoadedFor(`${assessment.assessment_id}:${offlinePrincipal}`);
    if (!recovered || recovered.assessmentId !== assessment.assessment_id) return;
    restoreAppointmentDraft(recovered, selectedRef.current);
    applyRecoveryAnswers(recovered, selectedRef.current);
    if (offlinePrincipal && new URL(window.location.href).searchParams.get("syncOfflineAssessment") === assessment.assessment_id) {
      setOfflineReturnToSync(assessment.assessment_id);
    }
  }, [initialSection, offlinePrincipal]);

  const persistOfflineWorkingSet = useCallback(async (assessment: PipelineAssessmentRecord, activate = true) => {
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
      ...(pendingScheduleRef.current ? { scheduleDraft: { ...pendingScheduleRef.current } } : {}),
      ...(phoneQuestion && assessmentToolFieldDefinitions.some((field) => field.key === phoneQuestion && field.section === activeSection) ? { activeQuestion: phoneQuestion } : {}),
      data: pickAssessmentToolData(draftRef.current),
      baseData: pickAssessmentToolData(baseDataRef.current),
      workbookSources: structuredClone(workbookSourcesRef.current),
    };
    const returnPath = `${window.location.pathname}${window.location.search}`;
    // Serialize snapshots with recovery writes so an older encrypted copy
    // cannot finish after an acknowledged save and become the newest draft.
    const next = localRecoveryQueueRef.current.catch(() => undefined).then(() =>
      saveOfflineAssessmentWorkingSet(offlinePrincipal, workingDraft, returnPath, { editable: true, activate }));
    localRecoveryQueueRef.current = next.catch(() => undefined);
    await next;
  }, [activeSection, canEditClinical, offlinePrincipal, phoneQuestion, referralId]);

  const persistRecoveryDraft = useCallback(async (assessment: PipelineAssessmentRecord) => {
    if (trainingAssessmentMode) return;
    if (dirtySectionsRef.current.size === 0 && !pendingScheduleRef.current) return;
    const recovery: PipelineAssessmentDraft = {
      schema: 1,
      assessmentId: assessment.assessment_id,
      ...(referralId ? { referralId } : {}),
      savedAt: new Date().toISOString(),
      baseVersion: assessment.version,
      sectionVersions: normalizeAssessmentSectionVersions(assessment.section_versions),
      dirtySections: [...dirtySectionsRef.current],
      activeSection,
      ...(pendingScheduleRef.current ? { scheduleDraft: { ...pendingScheduleRef.current } } : {}),
      ...(phoneQuestionRef.current && assessmentToolFieldDefinitions.some((field) => field.key === phoneQuestionRef.current && field.section === activeSection) ? { activeQuestion: phoneQuestionRef.current } : {}),
      data: pickAssessmentToolData(draftRef.current),
      baseData: pickAssessmentToolData(baseDataRef.current),
      workbookSources: structuredClone(workbookSourcesRef.current),
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
  }, [activeSection, offlinePrincipal, referralId, trainingAssessmentMode]);

  const clearRecoveryDraft = useCallback((assessmentId: string) => {
    const canRetireRecovery = () => dirtySectionsRef.current.size === 0 && !pendingScheduleRef.current && selectedRef.current?.assessment_id === assessmentId;
    const next = recoveryQueueRef.current.then(async () => {
      await localRecoveryQueueRef.current;
      if (!canRetireRecovery()) return;
      const current = selectedRef.current!;
      if (offlinePrincipal) {
        try {
          // A fast tab change can cancel the debounced clean snapshot. Replace
          // its dirty predecessor before retiring the separate recovery copy.
          await persistOfflineWorkingSet(current, false);
          if (!canRetireRecovery()) return;
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
  }, [offlinePrincipal, persistOfflineWorkingSet]);

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
      const assessment = initialTrainingAssessmentRef.current ?? buildTrainingAssessment(trainingAssessmentMode);
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

  const publishTrainingAssessment = useEffectEvent((assessment: PipelineAssessmentRecord) => onTrainingAssessmentChange?.(assessment));
  useEffect(() => {
    if (trainingAssessmentMode && selected) publishTrainingAssessment(selected);
  }, [selected, trainingAssessmentMode]);

  useLayoutEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useLayoutEffect(() => {
    dirtySectionsRef.current = dirtySections;
  }, [dirtySections]);

  useLayoutEffect(() => {
    remoteChangeRef.current = remoteChange;
  }, [remoteChange]);

  // Initialize before editable fields paint; a passive reset can erase immediate input.
  useLayoutEffect(() => {
    if (!selected) return;
    const previous = initializedAssessmentIdRef.current;
    if (previous?.id === selected.assessment_id && previous.principal === offlinePrincipal) return;
    const attachingPrincipal = previous?.id === selected.assessment_id && !previous.principal && Boolean(offlinePrincipal);
    initializedAssessmentIdRef.current = { id: selected.assessment_id, principal: offlinePrincipal };
    const data = pickAssessmentToolData(selected);
    // Resolving the signed-in identity enables encrypted recovery; it does not
    // open a different assessment or authorize resetting work already entered.
    if (!attachingPrincipal) {
      touchedFieldsRef.current.clear();
      workbookSourcesRef.current = {};
      selectedRef.current = selected;
      baseDataRef.current = data;
      draftRef.current = data;
      setDraft(data);
      setWorkingTarget(assessmentResumeTarget(selected, initialSection, initialQuestion ?? initialLocation?.assessmentQuestion, preparing));
      dirtySectionsRef.current = new Set();
      setDirtySections(dirtySectionsRef.current);
      remoteChangeRef.current = null;
      setRemoteChange(null);
    }
    if (!attachingPrincipal) {
      pendingScheduleRef.current = null;
      setScheduleFields(assessmentScheduleDraft(selected));
      setScheduleDraftStatus("");
    }
    setShowAddendum(false);
    loadRecoveryDraftForLiveAssessment(trainingAssessmentMode, loadRecoveryDraft, selected, data);
  }, [initialLocation?.assessmentQuestion, initialQuestion, initialSection, loadRecoveryDraft, offlinePrincipal, preparing, selected, trainingAssessmentMode]);

  useEffect(() => {
    if (!referralDocumentAutofillEnabled || !referralId || !selected || isAssessmentFinalized(selected) || !packetEvidenceVersion || dirty) return;
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

  const restoreSavedAssessmentPosition = useEffectEvent(() => {
    if (selected && savedPosition?.assessmentSection) {
      const mode = savedPosition.assessmentMode;
      if (mode === "prepare" || mode === "interview") setNotebookPage({ assessmentId: selected.assessment_id, view: mode === "prepare" ? "prepare" : "assessment" });
      // A removed or no-longer-applicable question falls back within the saved section.
      setWorkingTarget(assessmentResumeTarget(selected, savedPosition.assessmentSection, savedPosition.assessmentQuestion, mode === "prepare" || (!mode && preparing)));
    }
  });

  useEffect(() => {
    const focus = resolveAssessmentAutoFocus(
      selected,
      focusedAssessmentIdRef.current,
      nextRequiredTarget?.section,
      initialSection ?? trainingAssessmentSection,
      trainingAssessmentMode === "schedule" || initialLocation?.assessmentDialog === "schedule",
      savedPosition,
    );
    if (!focus) return;
    focusedAssessmentIdRef.current = focus.assessmentId;
    setResolvedPositionFor(focus.assessmentId);
    restoreSavedAssessmentPosition();
    applyAssessmentFocus(focus, {
      setActiveSection,
      setIsFocused,
      setShowScheduleDialog,
    });
  }, [initialSection, initialLocation?.assessmentDialog, nextRequiredTarget, preparing, savedPosition, selected, trainingAssessmentMode, trainingAssessmentSection]);

  useEffect(() => {
    if (!scheduleRequested || !selected || isLoading || isBusy || (!trainingAssessmentMode && !viewer)) return;
    if (canScheduleUnstartedAssessment(selected, canEditClinical)) {
      setIsFocused(true);
      setShowBeginDialog(false);
      setShowScheduleDialog(true);
    }
    onScheduleRequestHandled?.();
  }, [scheduleRequested, selected, isLoading, isBusy, viewer, trainingAssessmentMode, canEditClinical, onScheduleRequestHandled]);

  useEffect(() => {
    if (!beginRequested || !selected || isLoading || isBusy || (!trainingAssessmentMode && !viewer)) return;
    // Recheck the loaded record: a stale Home card must not restart an interview.
    if (canEditClinical && assessmentReadyToBegin(selected)) {
      setIsFocused(true);
      setShowScheduleDialog(false);
      setShowBeginDialog(true);
    }
    onBeginRequestHandled?.();
  }, [beginRequested, selected, isLoading, isBusy, viewer, trainingAssessmentMode, canEditClinical, onBeginRequestHandled]);

  const closeFromEscape = useEffectEvent(() => void closeAssessment(!preparing && !trainingAssessmentMode && onOpenAssignedWork ? onOpenAssignedWork : onOpenWorkspace));

  useEffect(() => {
    if (!selected || (!trainingAssessmentMode && !viewer)) return;
    // A saved confirmation is only a place to return to; it must never restart
    // an interview already begun or signed elsewhere.
    if (!canEditClinical || !assessmentReadyToBegin(selected)) setShowBeginDialog(false);
  }, [selected, viewer, trainingAssessmentMode, canEditClinical]);

  useEffect(() => {
    if (!isFocused || (embeddedFolder && !showScheduleDialog)) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => handleAssessmentEscape(event, {
      showScheduleDialog,
      setShowScheduleDialog,
      closeAssessment: closeFromEscape,
    });
    if (!embeddedFolder) document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      if (!embeddedFolder) document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isFocused, embeddedFolder, showScheduleDialog]);

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
    const clientMutationId = createMutationRef.current?.referralId === referralId
      ? createMutationRef.current.id : mutationId("assessment-create");
    createMutationRef.current = { referralId, id: clientMutationId };
    const openDraft = (assessment: PipelineAssessmentRecord, message: string) => {
      upsertAssessment(assessment, true);
      setMessage(message);
      setActiveSection("identity");
      setIsFocused(true);
      setShowScheduleDialog(false);
    };
    setIsBusy(true);
    setError("");
    setMessage("Creating assessment record...");
    const sendCreate = async () => {
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/referrals/${referralId}/assessments`,
        { method: "POST", body: JSON.stringify({ data: {}, client_mutation_id: clientMutationId }) },
      );
      if (!payload?.assessment) throw new Error("The assessment creation response was incomplete.");
      return payload.assessment;
    };
    try {
      let created: PipelineAssessmentRecord;
      try {
        created = await sendCreate();
      } catch (createError) {
        const ambiguous = !(createError instanceof PipelineApiError)
          || createError.status === 0 || createError.status === 408 || createError.status === 499 || createError.status >= 500;
        if (!ambiguous) throw createError;
        try {
          // The store replays this exact mutation ID if the first response was lost.
          created = await sendCreate();
        } catch {
          throw new Error("Could not confirm whether the assessment draft was created. Try Prepare assessment again; it will use the same request safely.");
        }
      }
      createMutationRef.current = null;
      openDraft(created, "Assessment draft created");
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

  const enterInterview = () => {
    if (preparing) {
      setWorkingTarget(null);
      setActiveSection(assessmentGapSections(draftRef.current, getPendingFields(selectedRef.current), true).find((section) => section.remaining.length > 0)?.key ?? "identity");
    }
    setNotebookView("assessment");
    setShowBeginDialog(false);
    setShowScheduleDialog(false);
  };

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
          assessment_date: current.assessment_date || isoToOperationalInput(new Date().toISOString()).slice(0, 10),
        });
        upsertAssessment(updated, true);
        enterInterview();
        setMessage("Interview start recorded locally");
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
      enterInterview();
      await onAssessmentSaved?.(payload.assessment);
      setMessage("Interview start recorded");
    } catch (startError) {
      // A failed timestamp/save request must not prevent an in-person interview.
      // Do not invent a persisted start; expose a retry until the server confirms it.
      if (assessmentReadyToBegin(selectedRef.current)) {
        setUnrecordedStartId(selectedRef.current!.assessment_id);
        enterInterview();
      }
      setError(messageFor(startError, "The interview start could not be recorded. You can keep answering and retry the start time."));
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
    const nextBase = pickAssessmentToolData(latestData);
    const conflicts: AssessmentFieldConflict[] = [];

    for (const definition of assessmentToolFieldDefinitions) {
      const field = definition.key;
      const localChanged = !sameAssessmentValue(local[field], base[field]);
      const remoteChanged = !sameAssessmentValue(latestData[field], base[field]);
      const unresolved = remoteChangeRef.current?.conflicts.some((conflict) => conflict.field === field);
      if (localChanged && (remoteChanged || unresolved) && !sameAssessmentValue(local[field], latestData[field])) {
        merged[field] = local[field] as never;
        nextBase[field] = base[field] as never;
        conflicts.push({ field, localValue: local[field], remoteValue: latestData[field], section: definition.section });
      } else if (localChanged) {
        merged[field] = local[field] as never;
      }
    }

    selectedRef.current = latest;
    baseDataRef.current = nextBase;
    draftRef.current = merged;
    setDraft(merged);
    setAssessments((items) => [latest, ...items.filter((item) => item.assessment_id !== latest.assessment_id)]);
    const nextDirty = dirtyAssessmentSections(merged, latestData);
    dirtySectionsRef.current = nextDirty;
    setDirtySections(nextDirty);
    const change = conflicts.length > 0 || announce ? { assessment: latest, conflicts } : null;
    remoteChangeRef.current = change;
    setRemoteChange(change);
    if (announce) {
      setMessage(remoteAssessmentMessage(conflicts.length, latest.updated_by.name));
    }
  }, []);

  const saveSectionNow = useCallback(async (section: AssessmentToolSection, captured?: Partial<AssessmentToolData>, workbook?: AssessmentPatchInput["workbook_restore"]) => {
    const initial = selectedRef.current;
    if (!canSaveAssessmentSection(initial, dirtySectionsRef.current, section, Boolean(captured))) return;
    let current = initial;
    const sentData = captured ?? Object.fromEntries(Object.entries(editableSectionData(draftRef.current, section))
      .filter(([field, value]) => !sameAssessmentValue(baseDataRef.current[field as AssessmentToolFieldKey], value))) as Partial<AssessmentToolData>;
    if (hasSectionConflict(remoteChangeRef.current, section, sentData)) {
      throw new Error(`Resolve the ${sectionLabels[section]} conflict before saving.`);
    }

    if (Object.entries(sentData).every(([field, value]) => sameAssessmentValue(current[field as AssessmentToolFieldKey], value))) return;
    setMessage("Saving changes...");
    let requestBody = "";
    const sectionRequestBody = () => {
      return JSON.stringify({
          section,
          if_match_section: normalizeAssessmentSectionVersions(current.section_versions)[section],
          ...(sentData.resident_name !== undefined && sentData.resident_name !== current.resident_name
            ? { if_match_referral_name: referral?.name ?? current.resident_name }
            : {}),
          client_mutation_id: mutationId(`assessment-${section}`),
          patch: { data: sentData, ...(workbook ? { workbook_restore: workbook } : {}) },
        });
    };
    const persistSectionAnswers = async () => {
      let payload: { assessment: PipelineAssessmentRecord; referral?: Referral };
      for (let attempt = 0; ; attempt += 1) {
        requestBody = sectionRequestBody();
        try {
          payload = trainingAssessmentMode ? { assessment: updateTrainingAssessment(current, sentData), referral: undefined } : await fetchPipelineJson<{ assessment: PipelineAssessmentRecord; referral?: Referral }>(
            `/api/assessments/${encodeURIComponent(current.assessment_id)}`,
            { method: "PATCH", body: requestBody },
          );
          break;
        } catch (error) {
          const latest = error instanceof PipelineApiError && error.status === 409 ? assessmentFromConflict(error.payload) : null;
          if (!latest || attempt >= 3 || !canRebaseAssessmentAnswers(current, latest, sentData)) throw error;
          current = latest;
        }
      }
      return payload;
    };
    const reconcileSavedAnswers = (saved: PipelineAssessmentRecord) => {
      const savedData = pickAssessmentToolData(saved);
      const local = draftRef.current;
      workbookSourcesRef.current = acknowledgeAssessmentWorkbookSave(workbookSourcesRef.current, local, sentData, workbook);
      const nextDraft = pickAssessmentToolData(local);
      for (const { key: field } of assessmentToolFieldDefinitions) {
        const sentValue = sentData[field];
        if ((sentValue !== undefined && sameAssessmentValue(local[field], sentValue))
          || sameAssessmentValue(local[field], baseDataRef.current[field])) {
          nextDraft[field] = savedData[field] as never;
        }
      }
      const nextBase = pickAssessmentToolData(savedData);
      for (const conflict of remoteChangeRef.current?.conflicts ?? []) {
        if (!Object.hasOwn(sentData, conflict.field) && !sameAssessmentValue(nextDraft[conflict.field], savedData[conflict.field])) {
          nextBase[conflict.field] = baseDataRef.current[conflict.field] as never;
        }
      }
      return { savedData, nextDraft, nextBase };
    };
    const acceptSavedSection = (payload: { assessment: PipelineAssessmentRecord; referral?: Referral }) => {
      const saved = payload.assessment;
      const { savedData, nextDraft, nextBase } = reconcileSavedAnswers(saved);
      selectedRef.current = saved;
      baseDataRef.current = nextBase;
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setAssessments((items) => [saved, ...items.filter((item) => item.assessment_id !== saved.assessment_id)]);
      const nextDirty = dirtyAssessmentSections(nextDraft, savedData);
      dirtySectionsRef.current = nextDirty;
      setDirtySections(nextDirty);
      setMessage(nextDirty.size > 0 ? "Unsaved changes" : trainingAssessmentMode ? "Practice changes saved locally" : "All changes saved");
      setError("");
      if (nextDirty.size === 0 && !trainingAssessmentMode) void clearRecoveryDraft(saved.assessment_id);
      if (trainingAssessmentMode) onTrainingAssessmentChange?.(saved);
      if (payload.referral) void Promise.resolve(onAssessmentSaved?.(saved, payload.referral)).catch(() => undefined);
    };
    try {
      acceptSavedSection(await persistSectionAnswers());
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
  }, [clearRecoveryDraft, offlinePrincipal, onAssessmentSaved, onTrainingAssessmentChange, receiveRemoteAssessment, referral?.name, trainingAssessmentMode]);

  const syncOfflineChanges = useCallback(async () => {
    if (!offlinePrincipal || !window.navigator.onLine || offlineSyncRef.current) return;
    const initialization = initializedAssessmentIdRef.current;
    const isCurrentSync = () => initialization !== null
      && initializedAssessmentIdRef.current === initialization
      && selectedRef.current?.assessment_id === initialization.id
      && initialization.principal === offlinePrincipal;
    offlineSyncRef.current = true;
    try {
      const result = await flushOfflineAssessmentMutations(offlinePrincipal, async (mutation) => {
        const next = saveQueueRef.current.then(async () => {
          if (!isCurrentSync()) throw new PipelineApiError("Assessment sync paused because the open assessment changed.");
          const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(mutation.url, { method: mutation.method, body: mutation.body });
          if (!isCurrentSync()) return;
          const current = selectedRef.current;
          const saved = payload.assessment;
          if (!current || current.assessment_id !== saved.assessment_id || saved.version <= current.version) return;
          const sent = JSON.parse(mutation.body) as { patch?: AssessmentPatchInput };
          workbookSourcesRef.current = acknowledgeAssessmentWorkbookSave(workbookSourcesRef.current, draftRef.current, sent.patch?.data ?? {}, sent.patch?.workbook_restore);
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
      if (!isCurrentSync()) return;
      setPendingOfflineSaves(result.remaining);
      const retryWorkbookSaves = async () => {
        for (const section of [...dirtySectionsRef.current]) {
          const retry = saveQueueRef.current.then(async () => {
            if (!isCurrentSync()) return;
            const groups = assessmentSaveGroups(editableSectionData(draftRef.current, section), draftRef.current, workbookSourcesRef.current);
            for (const group of groups) {
              if (!isCurrentSync()) return;
              if (group.workbook_restore && !hasSectionConflict(remoteChangeRef.current, section, group.data)) await saveSectionNow(section, group.data, group.workbook_restore);
            }
          });
          saveQueueRef.current = retry.catch(() => undefined);
          await retry;
        }
      };
      const finishOfflineReconciliation = async () => {
        const current = selectedRef.current;
        if (!current) return;
        if (result.conflicts > 0 && dirtySectionsRef.current.size > 0) {
          setMessage(`${result.conflicts} offline change${result.conflicts === 1 ? "" : "s"} need conflict review`);
        } else {
          setMessage(result.remaining > 0 ? `${result.remaining} offline changes still queued` : dirtySectionsRef.current.size > 0 ? "Changes saved on this device; waiting to sync" : "Offline changes synced");
          if (result.remaining + dirtySectionsRef.current.size === 0) await removeOfflineAssessmentDraft(offlinePrincipal, current.assessment_id);
        }
      };
      const reconcileOfflineResult = async () => {
        const current = selectedRef.current;
        if (!current || result.completed + result.conflicts === 0) return;
        try {
          const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
            `/api/assessments/${encodeURIComponent(current.assessment_id)}`,
            { cache: "no-store" },
          );
          // A -> B -> A and principal switches are new sessions too. Never use
          // the newly open assessment's clean refs to discard the old draft.
          if (!isCurrentSync()) return;
          receiveRemoteAssessment(payload.assessment, false);
          // Rebase only still-current workbook answers after the canonical
          // three-way merge; never replay over another person's conflicting edit.
          await retryWorkbookSaves();
          if (!isCurrentSync()) return;
          await finishOfflineReconciliation();
        } catch {
          // The normal active-assessment poll will reconcile the saved version.
        }
      };
      await reconcileOfflineResult();
    } finally {
      offlineSyncRef.current = false;
    }
  }, [offlinePrincipal, receiveRemoteAssessment, saveSectionNow]);

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

  const queueSectionSave = useCallback((section: AssessmentToolSection, captured?: Partial<AssessmentToolData>, expectedAssessmentId?: string) => {
    const assessmentId = expectedAssessmentId ?? selectedRef.current?.assessment_id;
    const next = saveQueueRef.current.then(async () => {
      if (selectedRef.current?.assessment_id !== assessmentId) throw new Error("The open assessment changed before saving. Your previous draft remains available for recovery.");
      const data = captured ?? Object.fromEntries(Object.entries(editableSectionData(draftRef.current, section))
        .filter(([field, value]) => !sameAssessmentValue(baseDataRef.current[field as AssessmentToolFieldKey], value)));
      for (const group of assessmentSaveGroups(data, draftRef.current, workbookSourcesRef.current)) {
        if (selectedRef.current?.assessment_id !== assessmentId) throw new Error("The open assessment changed before saving. Your previous draft remains available for recovery.");
        await saveSectionNow(section, group.data, group.workbook_restore);
      }
    });
    saveQueueRef.current = next.catch(() => undefined);
    return next;
  }, [saveSectionNow]);

  const flushDirtySections = useCallback(async (expectedAssessmentId?: string) => {
    for (const section of [...dirtySectionsRef.current]) await queueSectionSave(section, undefined, expectedAssessmentId);
    await saveQueueRef.current;
  }, [queueSectionSave]);

  useEffect(() => {
    if (!offlineReturnToSync || selectedRef.current?.assessment_id !== offlineReturnToSync) return;
    setOfflineReturnToSync(null);
    // Only the offline screen's explicit Return and sync action commits recovery.
    // Ordinary recovered drafts and conflicting fields retain their current behavior.
    void flushDirtySections(offlineReturnToSync).then(() => {
      if (selectedRef.current?.assessment_id !== offlineReturnToSync || dirtySectionsRef.current.size > 0) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get("syncOfflineAssessment") !== offlineReturnToSync) return;
      url.searchParams.delete("syncOfflineAssessment");
      window.history.replaceState(window.history.state, "", url);
    }).catch(() => undefined); // Canonical saving retains the draft and its error/conflict feedback.
  }, [flushDirtySections, offlineReturnToSync]);

  const restoreWorkbook = async (patch: Partial<AssessmentToolData>, expected: AssessmentToolData, source: NonNullable<AssessmentPatchInput["workbook_restore"]>) => {
    const current = selectedRef.current;
    if (!current || workbookReadOnly(current, canEditClinical, isBusy, isClosing)) throw new Error("This assessment cannot accept Excel changes right now.");
    if (JSON.stringify(draftRef.current) !== JSON.stringify(expected) || remoteChangeRef.current?.conflicts.length) throw new Error("The assessment changed while reviewing Excel. Review the current answers before applying.");
    const validation = validateAssessmentPatchRequest({ if_match: current.version, patch: { data: patch, workbook_restore: source } });
    if (!validation.ok) throw new Error(validation.message);
    for (const key of Object.keys(patch)) {
      const field = key as AssessmentToolFieldKey;
      touchedFieldsRef.current.add(field);
      workbookSourcesRef.current[field] = { ...source };
    }
    const next = pickAssessmentToolData({ ...draftRef.current, ...patch });
    draftRef.current = next;
    dirtySectionsRef.current = dirtyAssessmentSections(next, baseDataRef.current);
    setDraft(next); setDirtySections(new Set(dirtySectionsRef.current));
    setMessage("Restored answers; saving changes...");
    // Preserve the full restored working copy before starting per-section saves.
    // The existing queue owns retries, authorization, optimistic versions and sync.
    if (!trainingAssessmentMode) await persistRecoveryDraft(current);
    for (const section of new Set(Object.keys(patch).map((key) => assessmentToolFieldDefinitions.find((field) => field.key === key)!.section))) {
      if (selectedRef.current?.assessment_id !== current.assessment_id) throw new Error("The open assessment changed. Return to the original assessment to finish restoring its saved draft.");
      await queueSectionSave(section, undefined, current.assessment_id);
    }
  };

  const saveBeforeExit = async () => {
    const current = selectedRef.current;
    if (trainingAssessmentMode) {
      await flushDirtySections();
      return;
    }
    if (!current) return;
    if (pendingScheduleRef.current) await persistRecoveryDraft(current);
    if (dirtySectionsRef.current.size === 0) return;
    const canonical = flushDirtySections().then(() => {
      if (dirtySectionsRef.current.size > 0) throw new Error("Answers are still pending.");
    });
    // A confirmed recovery copy or canonical save releases navigation; a failed
    // request never becomes a saved or signed record.
    try {
      await Promise.any([persistRecoveryDraft(current), canonical]);
    } catch (cause) {
      throw new Error("Your last changes could not be saved. Keep this assessment open and try again.", { cause });
    }
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
    if (isBusy) throw new Error("Wait for the assessment action to finish before leaving.");
    if (closingRef.current) throw new Error("Assessment navigation is already in progress.");
    closingRef.current = true;
    setIsClosing(true);
    setMessage("Saving last changes...");
    try {
      await saveBeforeExit();
      setMessage("");
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
  // Returning from Chart, Files or Activity reopens the question being worked, not the section top.
  const retainWorkingQuestion = () => {
    if (phoneQuestionRef.current && (phoneInterview || questionSectionRef.current === activeSection)) setWorkingTarget({ field: phoneQuestionRef.current });
  };
  const saveForHeaderNavigation = useEffectEvent(async () => {
    if (!embeddedFolder) return saveAndCloseAssessment();
    try {
      if (isBusy) throw new Error("Wait for the assessment action to finish before leaving.");
      await saveBeforeExit();
      retainWorkingQuestion();
    } catch (saveError) {
      setError(messageFor(saveError, "Your last changes could not be saved. Keep this assessment open and try again."));
      throw saveError;
    }
  });

  useEffect(() => {
    if (!isFocused) return;
    if (!embeddedFolder) setAssessmentFocused(true);
    const content = contentRef.current;
    const restoreIsolation = isolateAssessmentContent(content, embeddedFolder);
    const save = () => saveForHeaderNavigation();
    if (!embeddedFolder) beforeNavigationRef.current = save;
    if (beforeWorkspaceNavigationRef) beforeWorkspaceNavigationRef.current = save;
    return () => {
      if (!embeddedFolder) setAssessmentFocused(false);
      restoreIsolation();
      if (beforeNavigationRef.current === save) beforeNavigationRef.current = null;
      if (beforeWorkspaceNavigationRef?.current === save) beforeWorkspaceNavigationRef.current = null;
    };
  }, [beforeNavigationRef, beforeWorkspaceNavigationRef, contentRef, embeddedFolder, isFocused, phoneInterview, setAssessmentFocused]);

  const saveOnUnmount = useEffectEvent(() => {
    if (dirtySectionsRef.current.size > 0) void saveBeforeExit().catch(() => undefined);
  });

  useEffect(() => () => {
    initializedAssessmentIdRef.current = null;
    saveOnUnmount();
  }, []);

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

  const canSignSelectedAssessment = (assessmentId: string) => reviewingChart && !isRecommendationSaving && !isBusy && !isClosing && canEditClinical && assessmentId === selectedRef.current?.assessment_id;
  const signAssessment = async (assessmentId: string) => {
    if (!canSignSelectedAssessment(assessmentId)) return;
    const initialization = initializedAssessmentIdRef.current;
    const isCurrent = () => initialization !== null && initializedAssessmentIdRef.current === initialization;
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
        onTrainingAssessmentChange?.(updated);
        onContinueToWorkflow?.();
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
      if (!isCurrent()) return;
      upsertAssessment(payload.assessment, true);
      let referralRefreshed = true;
      try {
        await onAssessmentSaved?.(payload.assessment);
      } catch {
        referralRefreshed = false;
      }
      if (!isCurrent()) return;
      void clearRecoveryDraft(payload.assessment.assessment_id);
      void persistOfflineWorkingSet(payload.assessment);
      setMessage(referralRefreshed ? "Assessment signed" : "Assessment signed. Referral details could not refresh; reload to check them.");
      onContinueToWorkflow?.();
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
      retainWorkingQuestion();
      if (onReviewAssessment) onReviewAssessment();
      else if (onOpenChart) onOpenChart();
      else setNotebookView("chart");
    } catch (saveError) {
      setError(messageFor(saveError, "Your answers could not be saved. Please try again."));
    }
  };

  const verifyScheduleDraft = (current: PipelineAssessmentRecord) => {
      if (pendingScheduleRef.current && pendingScheduleRef.current.base !== assessmentScheduleDraft(current).base) {
        pendingScheduleRef.current = null;
        setScheduleFields(assessmentScheduleDraft(current));
        throw new Error("The appointment changed while you were editing. Review the current booking before saving a new time.");
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
      verifyScheduleDraft(current);
      if (trainingAssessmentMode) {
        const updated = updateTrainingAssessment(current, {
          scheduled_start_at: start,
          scheduled_duration_minutes: Number(scheduleDuration),
          scheduled_method: scheduleMethod,
          scheduled_location: scheduleMethod === "record_review" ? null : nullableTrimmedText(scheduleLocation),
          schedule_status: nextAssessmentScheduleStatus(current.schedule_status),
        });
        upsertAssessment(updated, true);
        pendingScheduleRef.current = null;
        setScheduleFields(assessmentScheduleDraft(updated));
        setMessage("Practice appointment saved locally");
        dispatchGuideCompletion("assessment-schedule-save");
        setShowScheduleDialog(false);
        onTrainingAssessmentChange?.(updated, "scheduled");
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
      pendingScheduleRef.current = null;
      setScheduleFields(assessmentScheduleDraft(payload.assessment));
      setScheduleDraftStatus("");
      await persistOfflineWorkingSet(payload.assessment).catch(() => undefined);
      void clearRecoveryDraft(payload.assessment.assessment_id);
      await onAssessmentSaved?.(payload.assessment);
      setMessage(payload.warnings?.length ? `Interview scheduled. ${payload.warnings.join(" ")}` : "Interview scheduled · you can keep preparing");
      dispatchGuideCompletion("assessment-schedule-save");
      setShowScheduleDialog(false);
    } catch (scheduleError) {
      setError(messageFor(scheduleError, "The assessment schedule could not be saved."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const scheduleDraftStillCurrent = (assessmentId: string, revision: number) => Boolean(pendingScheduleRef.current && selectedRef.current?.assessment_id === assessmentId && scheduleRevisionRef.current === revision);

  const saveAppointmentDraft = async () => {
    const current = selectedRef.current;
    if (!current || !pendingScheduleRef.current || trainingAssessmentMode) return;
    const revision = scheduleRevisionRef.current;
    try {
      await persistRecoveryDraft(current);
      if (scheduleDraftStillCurrent(current.assessment_id, revision)) setScheduleDraftStatus(current.scheduled_start_at ? "Draft saved · existing appointment unchanged" : "Appointment draft saved · not booked");
    } catch {
      if (selectedRef.current?.assessment_id === current.assessment_id) setScheduleDraftStatus("Appointment draft could not be saved. Keep this screen open and retry.");
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
      setAddendumReason("");
      setAddendumNote("");
      setShowAddendum(false);
      try {
        await onAssessmentSaved?.(payload.assessment);
        setMessage("Note added");
      } catch {
        setMessage("Note added. Referral details could not refresh; reload to check them.");
      }
    } catch (addendumError) {
      setError(messageFor(addendumError, "The note could not be saved."));
      setMessage("");
    } finally {
      setIsBusy(false);
    }
  };

  const updateField = (key: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => {
    touchedFieldsRef.current.add(key);
    if (!sameAssessmentValue(draftRef.current[key], value)) delete workbookSourcesRef.current[key];
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
    touchedFieldsRef.current.add(field);
    const nextDraft = pickAssessmentToolData(draftRef.current);
    const nextBase = pickAssessmentToolData(baseDataRef.current);
    if (useLatest) {
      nextDraft[field] = conflict.remoteValue as never;
      delete workbookSourcesRef.current[field];
    }
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
    rememberPhoneQuestion(field);
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
  useLayoutEffect(() => () => { commitForLayoutChange(); }, [phoneInterview, preparing, visibleSectionKey]);

  useEffect(() => {
    if (trainingAssessmentMode) return;
    const current = selectedRef.current;
    if (!current || !offlinePrincipal || recoveryLoadedFor !== `${current.assessment_id}:${offlinePrincipal}`) return;
    const timer = window.setTimeout(() => {
      void persistOfflineWorkingSet(current).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [dirtySections, draft, offlinePrincipal, persistOfflineWorkingSet, selected?.assessment_id, selected?.meet_client_sent_at, trainingAssessmentMode, scheduleFields, recoveryLoadedFor]);

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
      <div className="min-h-0 flex-1 overflow-y-auto">{chartDocuments}<WorkspaceClientChart referral={referral ?? null} headerActions={chartActions} onEditReferralField={onEditReferralField} assessmentOnly={assessmentReview} /></div>
    </AssessmentFileSurface>;
    return (
      <AssessmentEmpty
        title="Questionnaire"
        detail="Fill in what you know from the referral. Schedule and begin the interview when ready."
        action={canCreateAssignedAssessment ? <button type="button" data-guide-target="assessment-open" onClick={createAssessmentDraft} disabled={isBusy} className="min-h-11 rounded-md bg-[#0f8b73] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#0b6d5b] disabled:opacity-50">Prepare assessment</button> : null}
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

  const openScheduleDialog = () => { setError(""); setShowBeginDialog(false); setShowScheduleDialog(true); };
  const scheduleLabel = () => hasActiveAssessmentSchedule(selected) ? "Change appointment" : "Schedule interview";
  const renderScheduleDetail = () => (canScheduleUnstartedAssessment(selected, canEditClinical) ? <button type="button" data-guide-target={showScheduleDialog ? undefined : "assessment-schedule-open"} onClick={openScheduleDialog} aria-label={scheduleLabel()}><CalendarClock size={15} />{scheduleLabel()}</button> : null);
  // Scheduling belongs beside the referral's contact and coordination details, not only in a menu.
  const renderChartScheduling = () => (reviewingChart && !assessmentReview ? <div className={workingStyles.chartScheduling}>
    <p>{hasActiveAssessmentSchedule(selected)
      ? `Assessment appointment: ${new Date(selected.scheduled_start_at!).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`
      : "No assessment appointment booked yet."}</p>
    {canScheduleUnstartedAssessment(selected, canEditClinical)
      ? <button type="button" onClick={openScheduleDialog} disabled={isBusy || isClosing}><CalendarClock size={16} aria-hidden="true" />{scheduleLabel()}</button>
      : null}
  </div> : null);
  const renderAssessmentDetails = () => <>
    {reviewingChart ? renderScheduleDetail() : null}
    {selected.signed_at && canAddAddendum ? <button type="button" onClick={() => setShowAddendum((value) => !value)} disabled={isBusy}><Plus size={14} />Add note</button> : null}
  </>;
  const assessmentDetails = <>{renderAssessmentDetails()}
    <button type="button" onClick={() => setShowInterviewDate(true)}><CalendarClock size={15} aria-hidden="true" />Interview date{draft.assessment_date ? `: ${draft.assessment_date}` : ""}</button>
  </>;
  // The recommendation belongs to the deliberate review, not to every question
  // during the interview. Render exactly one instance of the existing control.
  const renderPhoneQuestionHeading = () => phoneInterview ? <div className="sr-only"><h3>{preparing ? preparationGroup.label : sectionDefinition.label}</h3></div> : null;
  const workingSectionLabel = () => pageSections[pageIndex]?.label ?? sectionDefinition.label;
  const renderRecommendation = () => recommendationControl && assessmentReview ? recommendationControl(selected.assessment_id, setIsRecommendationSaving) : null;
  const recommendationNode = renderRecommendation();
  const requestInterviewStart = () => {
    if (!canEditClinical || isBusy || isClosing) return;
    if (focusedFieldRef.current) commitAnswer(focusedFieldRef.current.field);
    setShowBeginDialog(true);
  };
  const changeWorkingMode = (prepare: boolean) => {
    if (prepare && !preparing) interviewReturnRef.current = { assessmentId: selectedId, section: activeSection, field: focusedFieldRef.current?.field ?? phoneQuestionRef.current };
    if (focusedFieldRef.current) commitAnswer(focusedFieldRef.current.field);
    const returning = interviewReturnRef.current;
    if (!prepare && preparing && returning?.assessmentId === selectedId) {
      setActiveSection(returning.section);
      setWorkingTarget(interviewWorkingTarget(returning.field));
    } else setWorkingTarget(null);
    setNotebookView(prepare ? "prepare" : "assessment");
  };
  const continueFromPreparation = () => changeWorkingMode(false);

  const nextConversationSection = () => {
    setWorkingTarget(null);
    if (nextSection) setActiveSection(nextSection.key);
    else if (preparing) continueFromPreparation();
    else void reviewChart();
  };

  const renderSignatureHistory = () => (
    selected.signed_at ? (
        <div className="shrink-0 border-b border-[#d9dfdb] px-4 py-3 text-[11px] text-[#595959]">
          Signed by <strong>{selected.signed_by?.name ?? selected.assessor ?? "Assigned assessor"}</strong> on {new Date(selected.signed_at).toLocaleString()}.
          {!isAssessmentFinalized(selected) ? " You can still edit until Meet the Client is sent." : " Meet the Client sent. Use Add note for later information."}
          {(selected.addenda ?? []).length > 0 ? (
            <div className="mt-3 divide-y divide-[#e5e5e5] border-y border-[#e5e5e5]">
              {(selected.addenda ?? []).map((addendum) => <div key={addendum.addendum_id} className="py-3"><div className="font-black text-[#111111]">{addendum.reason_code}</div><div className="mt-1 whitespace-pre-wrap leading-5">{addendum.note}</div><div className="mt-1 text-[9px] text-[#737373]">{addendum.authored_by_name} · {new Date(addendum.created_at).toLocaleString()}</div></div>)}
            </div>
          ) : null}
        </div>
      ) : null
  );

  const saveIndicatorColor = () => error ? "text-[#69716c]" : !networkOnline || pendingOfflineSaves > 0 || dirty || isBusy ? "text-[#59645e]" : "text-[#0c705f]";
  const renderReturnToInterview = () => !reviewingChart && preparing && interviewReturnRef.current?.assessmentId === selectedId
    ? <button type="button" className={workingStyles.returnToInterview} disabled={isBusy || isClosing} onClick={() => changeWorkingMode(false)}>Return to interview</button>
    : null;
  const renderSaveStatus = () => (
    <div className={workingStyles.footerUtilities}>
          <button type="button" className={workingStyles.saveRecovery} title="Excel workbook, backup & recovery" aria-haspopup="dialog" onClick={() => setRecoveryToolsAssessment(selected.assessment_id)}>
          <span data-guide-target="assessment-save-status" aria-live="polite" className={`flex min-w-0 items-center gap-1.5 ${saveIndicatorColor()}`}>
            {!error && networkOnline && pendingOfflineSaves === 0 && !dirty && !isBusy ? <Check size={14} className="shrink-0" aria-hidden="true" /> : null}
            <span>{assessmentSaveStatus({ error, trainingAssessmentMode, dirty, message, networkOnline, pendingOfflineSaves })}</span>
          </span>
          <ChevronDown size={13} aria-hidden="true" />
          <span className="sr-only">Open Excel and recovery</span>
          </button>
          {renderReturnToInterview()}
          {embeddedFolder && assessmentDetails ? <AssessmentFileDetails label="Details" detailsRef={secondaryActionsRef}>{assessmentDetails}</AssessmentFileDetails> : null}
        </div>
  );

  const renderSignedAction = () => (onContinueToWorkflow && !trainingAssessmentMode ? <button type="button" onClick={continueToWorkflow} disabled={isBusy || isClosing}>{isAssessmentFinalized(selected) ? "View admission" : "Continue to decision"}<ChevronRight size={14} /></button> : <span className="text-[12px] font-semibold text-[#0f6f5e]">{isAssessmentFinalized(selected) ? "Sent" : "Signed"}</span>);
  const renderSignAction = () => (<button type="button" data-guide-target="assessment-sign" onClick={async (event) => { event.currentTarget.focus({ preventScroll: true }); if (await confirm({ title: "Sign this assessment?", message: "You can still edit it until Meet the Client is sent. Changes are logged.", confirmLabel: "Sign assessment" })) void signAssessment(selected.assessment_id); }} disabled={isBusy || isClosing || isRecommendationSaving}>{isRecommendationSaving ? "Saving recommendation..." : onContinueToWorkflow && !trainingAssessmentMode ? "Sign & continue to decision" : "Sign assessment"}</button>);

  const renderScheduleAction = () => (
    <button type="button" aria-label={hasActiveAssessmentSchedule(selected) ? "Edit assessment appointment" : undefined} data-guide-target={showScheduleDialog ? undefined : "assessment-schedule-open"} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); openScheduleDialog(); }} disabled={isBusy || isClosing}>{hasActiveAssessmentSchedule(selected) ? "Edit" : <><CalendarClock size={15} aria-hidden="true" />Schedule interview</>}</button>
  );

  const renderPrimaryAssessmentActions = () => (
    <div data-assessment-primary-action className="flex flex-wrap items-center gap-2">
          {selected.signed_at ? (
            renderSignedAction()
          ) : !assessmentReview && onReviewAssessment ? (
            <button type="button" onClick={() => void reviewChart()} disabled={isBusy || isClosing}>Review assessment<ChevronRight size={14} /></button>
          ) : canEditClinical ? (
            renderSignAction()
          ) : canSupervise ? (
            renderScheduleAction()
          ) : null}
        </div>
  );

  const renderRemoteChanges = () => (
    remoteChange ? (
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
          ) : null
  );

  const renderChartReviewToolbar = () => (assessmentReview ? <div className={workingStyles.chartReviewToolbar}>
              <div className={workingStyles.reviewHeading}><h3>Review assessment</h3><p>Check the record below. Next: admission decision, then the client handoff.</p></div>
              <button type="button" onClick={() => { setNotebookView("assessment"); onOpenAssessment?.(); }}><ChevronLeft size={16} aria-hidden="true" />Back to questions</button>
            </div> : !embeddedFolder ? <div className={workingStyles.chartReviewToolbar}>
              {phoneInterview ? <button type="button" onClick={() => setNotebookView("assessment")}><ChevronLeft size={16} />Return to questions</button> : null}
              <span>{selected.signed_at && dirtySections.size === 0 ? "Assessment signed" : "Chart in progress"}</span>
            </div> : null);

  const openSectionForReview = (section: AssessmentToolSection, field?: AssessmentToolFieldKey) => {
    setActiveSection(section);
    setWorkingTarget(field ? { field } : null);
    setNotebookView("prepare");
    onOpenAssessment?.();
  };
  const reviewEditDisabled = isBusy || isClosing || !canEditClinical || isAssessmentFinalized(selected);
  const remainingReviewItems = reviewSections.reduce((count, section) => count + section.remaining.length, 0);

  const renderReviewRecommendation = () => (recommendationNode ? <section className={workingStyles.reviewRecommendation} aria-label="Placement recommendation">
                <h4>Placement recommendation</h4>
                <p>Your working recommendation for this client. It guides the next steps; it does not sign the assessment or record the admission decision.</p>
                {recommendationNode}
              </section> : null);

  const renderSigningExplanation = () => (selected.signed_at || !canEditClinical ? null : <section className={workingStyles.signingNote} aria-label="What signing does">
                <h4>Before you sign</h4>
                <p>Signing records your signature and the time on this assessment and marks it complete. Unanswered items stay unanswered; they never become a clinical finding and they do not prevent signing.</p>
                <p>Signing does not record the admission decision and does not send the Meet the Client packet. You can keep correcting answers until that packet is sent, and changes after signing are logged.</p>
              </section>);

  const renderReviewOverview = () => <div className={workingStyles.reviewOverview}>
              <dl className={workingStyles.reviewFacts}>
                <div><dt>Assessor</dt><dd>{draft.assessor || selected.assessor || "Not recorded"}</dd></div>
                <div><dt>Assessment date</dt><dd>{draft.assessment_date || "Not recorded"}</dd></div>
                <div><dt>Recorded answers</dt><dd>{reviewSections.reduce((count, section) => count + section.questions.length - section.remaining.length, 0)} of {reviewSections.reduce((count, section) => count + section.questions.length, 0)}</dd></div>
              </dl>
              {remainingReviewItems > 0
                ? <p className={workingStyles.reviewRemaining}>{remainingReviewItems} item{remainingReviewItems === 1 ? "" : "s"} still need an answer or verification. They do not prevent signing.</p>
                : <p className={workingStyles.reviewComplete}><Check size={17} aria-hidden="true" />All visible questions have recorded answers. Review for accuracy before signing.</p>}
              <h4 className={workingStyles.reviewSectionsHeading} id="assessment-review-sections">Answers by section</h4>
              <ul className={workingStyles.reviewChecklist} aria-labelledby="assessment-review-sections">{reviewSections.map((section) => <li key={section.key}>
                  <button type="button" disabled={reviewEditDisabled} onClick={() => openSectionForReview(section.key, section.remaining[0]?.field)}>
                    <span>{section.label}</span>
                    <span>{section.questions.length - section.remaining.length} of {section.questions.length} recorded{section.remaining.length > 0 ? ` · ${section.remaining.length} to review` : ""}<ChevronRight size={15} aria-hidden="true" /></span>
                  </button>
                </li>)}</ul>
              {renderReviewRecommendation()}
              {renderSigningExplanation()}
            </div>;

  // Chart shows unanswered items as a neutral way into the review, not a warning.
  const renderUnansweredEntry = () => {
    const questions = reviewSections.reduce((count, section) => count + section.questions.length, 0);
    const remaining = reviewSections.reduce((count, section) => count + section.remaining.length, 0);
    if (!remaining) return null;
    return <div className={workingStyles.chartReviewNotice} data-chart-unanswered>
      {onReviewAssessment ? <button type="button" onClick={() => void reviewChart()} disabled={isBusy || isClosing}>Review unanswered assessment items<ChevronRight size={15} aria-hidden="true" /></button> : null}
      <p>Assessment answers: {questions - remaining} of {questions} recorded. The rest are unanswered or unverified and do not prevent continuing.</p>
    </div>;
  };

  const renderChartReview = () => (
    <section data-guide-target="assessment-review" aria-label="Assessment chart review" className={workingStyles.chartReview}>
            {chartDocuments}
            {renderChartReviewToolbar()}
            {assessmentReview ? renderReviewOverview() : renderUnansweredEntry()}
            <div className={assessmentReview ? workingStyles.reviewDocument : undefined}>
            <WorkspaceClientChart referral={referral ?? null} headerActions={chartActions} contactActions={renderChartScheduling()} onEditReferralField={onEditReferralField} assessmentOnly={assessmentReview}
              onEditAssessmentField={!isBusy && !isAssessmentFinalized(selected) && canEditClinical ? (field) => {
                if (field === "assessment_date") { setShowInterviewDate(true); return; }
                setActiveSection(assessmentToolFieldDefinitions.find((definition) => definition.key === field)!.section);
                setWorkingTarget({ field });
                setNotebookView(isInterviewFocusField(field) ? "assessment" : "prepare");
                onOpenAssessment?.();
              } : undefined}
              assessment={{ ...selected, ...draft, signed_at: dirtySections.size > 0 ? null : selected.signed_at }} practice={Boolean(trainingAssessmentMode)} />
            </div>
          </section>
  );

  const renderInterviewDate = () => (showInterviewDate ? <HomeDialog label="Interview date" title="Interview date" onClose={() => { commitAnswer("assessment_date"); setShowInterviewDate(false); }}>
        <div className="space-y-5 p-5">
          <p className="text-[15px] leading-6 text-[#52675d]">The date the interview took place, not the appointment. Begin interview records today&apos;s date if this is blank. Correct it here when documenting an earlier interview.</p>
          <WorkingAssessmentField section="identity" questions={[]} question={getAssessmentInterviewQuestions("identity", draft).find((question) => question.field === "assessment_date")!} assessment={selected} data={draft} pending={pendingFields} required={requiredInterviewFields} target={null} disabled={isBusy || isAssessmentFinalized(selected) || !canEditClinical} reviewDisabled={isBusy || isAssessmentFinalized(selected) || !canEditClinical} onChange={updateField} onFieldFocus={focusAnswer} onFieldBlur={commitAnswer} onReview={(field, action) => void reviewExtractedField(field, action)} onUnableReasonChange={() => undefined} />
        </div>
      </HomeDialog> : null);

  const sectionSteps = <nav aria-label="Assessment section steps" className={`${workingStyles.sectionSteps} ${phoneLayout ? workingStyles.phonePreparationSteps : ""}`}>
    <button type="button" aria-label="Previous section" className={workingStyles.previousSection} onClick={() => { if (previousSection) { setWorkingTarget(null); setActiveSection(previousSection.key); } }} disabled={!previousSection || isBusy || isClosing} title={previousSection ? `Previous: ${previousSection.label}` : undefined}><ChevronLeft size={16} aria-hidden="true" /><span>Previous</span></button>
    <span className={workingStyles.stepPosition} aria-label={`Section ${pageIndex + 1} of ${pageSections.length}`}><strong>{pageIndex + 1}</strong> of {pageSections.length}</span>
    <div data-assessment-primary-action><button type="button" data-guide-target="assessment-next-section" onClick={nextConversationSection} disabled={isBusy || isClosing || (preparing && !nextSection && !canEditClinical)} title={nextSection ? `Next: ${nextSection.label}` : undefined}>{nextSection ? "Next section" : preparing ? "Open interview" : "Review assessment"}<ChevronRight size={16} aria-hidden="true" /></button></div>
  </nav>;

  return (
    <AssessmentFileSurface
      title={workspaceTitle}
      container={contentRef.current}
      header={<AssessmentInterviewHeader name={draft.resident_name} community={draft.community} disabled={isClosing} tools={null}
        details={assessmentDetails} detailsRef={secondaryActionsRef}
        returnLabel={!preparing && !trainingAssessmentMode && onOpenAssignedWork ? "Workspaces" : onOpenWorkspace ? "Back to referral" : "Back to workspace"}
        onClose={() => void closeAssessment(!preparing && !trainingAssessmentMode && onOpenAssignedWork ? onOpenAssignedWork : onOpenWorkspace)}
        pages={<AssessmentFileNavigation hidden={phoneInterview} disabled={isClosing} preparing={preparing} reviewingChart={reviewingChart}
          onAssessment={() => { if (!reviewingChart) setWorkingTarget(null); setNotebookView("assessment"); }}
          onChart={() => void reviewChart()}
        />}
      />}
      dialogs={<>{confirmationDialog}<AssessmentSchedulingDialogs
        assessment={selected}
        showScheduleDialog={!readOnly && showScheduleDialog}
        showBeginDialog={!readOnly && showBeginDialog}
        canEditClinical={canEditClinical}
        scheduleModal={!initialTrainingAssessment}
        isBusy={isBusy}
        error={error}
        scheduleStart={scheduleStart}
        scheduleDuration={scheduleDuration}
        scheduleMethod={scheduleMethod}
        scheduleLocation={scheduleLocation}
        draftStatus={scheduleDraftStatus}
        onDraftBlur={() => void saveAppointmentDraft()}
        onScheduleStartChange={(value) => changeScheduleField("start", value)}
        onScheduleDurationChange={(value) => changeScheduleField("duration", value)}
        onScheduleMethodChange={(value) => changeScheduleField("method", value)}
        onScheduleLocationChange={(value) => changeScheduleField("location", value)}
        onCloseSchedule={() => { void saveAppointmentDraft(); setShowScheduleDialog(false); if (initialTrainingAssessment) onOpenAssessment?.(); }}
        onSaveSchedule={() => void saveSchedule()}
        onCloseBegin={() => setShowBeginDialog(false)}
        onBeginAssessment={() => void beginAssessment()}
      />{renderInterviewDate()}</>}
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

      {renderSignatureHistory()}

      <div className="flex min-h-0 flex-1">
        <main ref={chartScrollRef} className={`min-w-0 flex-1 ${reviewingChart ? "overflow-y-auto" : phoneInterview ? phoneStyles.mobileMain : `${workingStyles.readingMain} ${preparing ? workingStyles.preparationMain : ""}`}`}>
          {!reviewingChart && !selected.signed_at ? <AssessmentWorkMode preparing={preparing} disabled={isBusy || isClosing} canBegin={assessmentReadyToBegin(selected) && canEditClinical} startAttemptFailed={unrecordedStartId === selectedId} onChange={changeWorkingMode} onBegin={requestInterviewStart} scheduleAction={canEditClinical ? renderScheduleAction() : null} appointment={hasActiveAssessmentSchedule(selected) ? new Date(selected.scheduled_start_at!).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : undefined} /> : null}
          <AssessmentExcelBackup key={selected.assessment_id} assessment={selected} data={draft} readOnly={workbookReadOnly(selected, canEditClinical, isBusy, isClosing)} onApply={restoreWorkbook}
            importFile={workbookImport} onImportFileRead={onWorkbookImportRead}
            toolsOpen={recoveryToolsAssessment === selected.assessment_id} onCloseTools={() => setRecoveryToolsAssessment(null)}
            saveStatus={<>
              <p role="status">{assessmentSaveStatus({ error, trainingAssessmentMode, dirty, message, networkOnline, pendingOfflineSaves })}</p>
              <p>{trainingAssessmentMode ? "Practice answers stay local; they are not a live client record." : "Changes sync automatically when connected. If you lose connection, keep this assessment open and check its save status before switching devices."}</p>
            </>} />

          {error && !reviewingChart ? <div role="alert" className="border-b border-[#dce3e0] bg-[#f7faf9] px-5 py-3 text-[14px] font-semibold leading-6 text-[#59645e]">{error}</div> : null}
          {presence.some((item) => item.section === `assessment:${activeSection}`) ? (
            <div className="flex items-center gap-2 border-b border-[#c9d9d3] bg-[#f7fbf9] px-5 py-2 text-[11px] font-semibold text-[#315e50]" aria-live="polite">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[#20a464]" />
              <span>{presence
                .filter((item) => item.section === `assessment:${activeSection}`)
                .map((item) => item.actor_name)
                .join(", ")} {presence.filter((item) => item.section === `assessment:${activeSection}`).length === 1 ? "is" : "are"} also editing {sectionLabels[activeSection]}.</span>
            </div>
          ) : null}

          {renderRemoteChanges()}

          {reviewingChart ? renderChartReview() : <div data-assessment-question-content className={!phoneInterview ? workingStyles.readingContent : "w-full px-3 py-3 sm:px-4"}>
            {renderPhoneQuestionHeading()}
            {trainingAssessmentMode && activeSection === "provenance_qc" && practiceReview ? <PracticeAssessmentReview review={practiceReview} /> : null}
            <QuestionPage
              key={`${selected.assessment_id}-${preparing}`}
              preparing={preparing}
              onQuestionChange={rememberPhoneQuestion}
              onSectionChange={(section) => { setWorkingTarget(null); setActiveSection(section); }}
              onFinish={() => {
                if (preparing) continueFromPreparation();
                else void reviewChart();
              }}
              section={visibleSectionKey}
              sectionLabel={workingSectionLabel()}
              assessment={selected}
              data={draft}
              pending={pendingFields}
              questions={preparing ? preparationQuestions(preparationGroup, draft) : sectionQuestions}
              referenceQuestions={conversationSections[activeSectionIndex].referenceQuestions}
              onAllQuestions={() => changeWorkingMode(true)}
              required={requiredInterviewFields}
              target={workingTarget}
              questionNavigation={!phoneInterview ? (recordedAnswers) => <AssessmentWorkingNavigation preparing={preparing} recordedAnswers={recordedAnswers} data={draft} pending={pendingFields} activeSection={visibleSectionKey} guideTargets={assessmentSectionGuideTargets} onSectionChange={(section) => { setWorkingTarget(null); setActiveSection(section); }} /> : undefined}
              disabled={isBusy || isAssessmentFinalized(selected) || !canEditClinical}
              reviewDisabled={isBusy || isAssessmentFinalized(selected) || !canEditClinical}
              onChange={updateField}
              onFieldFocus={(field) => {
                focusAnswer(field);
                rememberPhoneQuestion(field);
                if (preparing) setActiveSection(assessmentToolFieldDefinitions.find((definition) => definition.key === field)!.section);
              }}
              onFieldBlur={commitAnswer}
              onReview={(field, action) => void reviewExtractedField(field, action)}
              onUnableReasonChange={(field, reason) => updateField("unable_to_assess_reasons", setAssessmentUnableReason(draftRef.current.unable_to_assess_reasons, field, reason))}
              onReferenceEdit={(field) => {
                if (field === "assessment_date") { setShowInterviewDate(true); return; }
                if (!preparing && !isInterviewFocusField(field)) changeWorkingMode(true);
                setActiveSection(assessmentToolFieldDefinitions.find((definition) => definition.key === field)!.section);
                setWorkingTarget({ field });
              }}
            />

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

      {!reviewingChart && preparing && phoneLayout ? sectionSteps : null}
      <footer aria-label="Assessment actions" data-assessment-chart-review={reviewingChart || undefined} className={`${workingStyles.footer} flex shrink-0 flex-wrap items-center justify-between bg-white ${phoneLayout ? phoneStyles.mobileFooter : "gap-x-3 gap-y-2 px-4 py-2 sm:px-6 lg:px-8"}`}>
        {reviewingChart && error ? <p role="alert" className={workingStyles.reviewError}>{error}</p> : null}
        {renderSaveStatus()}
        {!reviewingChart && !phoneLayout ? sectionSteps : (reviewingChart || selected.signed_at) ? <div>
        {renderPrimaryAssessmentActions()}
        </div> : null}
      </footer>

    </AssessmentFileSurface>
  );
}

function workbookReadOnly(assessment: PipelineAssessmentRecord, canEdit: boolean, busy: boolean, closing: boolean) {
  return Boolean(assessment.signed_at) || isAssessmentFinalized(assessment) || !canEdit || busy || closing;
}

function newestRecoveryDraft(current: PipelineAssessmentDraft | null, candidate: PipelineAssessmentDraft | null | undefined) {
  return candidate && (!current || Date.parse(candidate.savedAt) >= Date.parse(current.savedAt)) ? candidate : current;
}

async function readBrowserAssessmentRecovery(assessmentId: string, principal: string | null) {
  let recovered: PipelineAssessmentDraft | null = null;
  if (principal) {
    try {
      recovered = await loadOfflineAssessmentDraft(principal, assessmentId);
      const workingSet = await loadOfflineAssessmentWorkingSet(principal, assessmentId);
      recovered = newestRecoveryDraft(recovered, workingSet?.draft);
    } catch {
      // Server recovery remains available when encrypted browser storage is unavailable.
    }
  }
  return recovered;
}

async function readAssessmentRecovery(assessmentId: string, principal: string | null) {
  let recovered = await readBrowserAssessmentRecovery(assessmentId, principal);
  let recoveredVersion = 0;
  if (usesServerUserWorkspaceState()) {
    try {
      const payload = await fetchPipelineJson<{ draft: PipelineAssessmentDraft | null; version: number }>(
        `/api/me/assessment-drafts/${encodeURIComponent(assessmentId)}`, { cache: "no-store" },
      );
      recovered = newestRecoveryDraft(recovered, payload.draft);
      recoveredVersion = payload.version;
    } catch {
      // Browser recovery remains available during a transient server-state outage.
    }
  }
  return { recovered, recoveredVersion };
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
  if (assessment.started_at) return "Resume interview";
  return "Prepare assessment";
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

function isolateAssessmentContent(content: HTMLElement | null, embeddedFolder: boolean) {
    const previousIsolation = content?.style.isolation ?? "";
    if (content && !embeddedFolder) content.style.isolation = "isolate";
    // The open folder covers the workspace; do not tab into controls behind it.
    const backgrounds = !embeddedFolder && content ? Array.from(content.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.matches("[data-assessment-view]"))
      .map((element) => ({ element, inert: element.inert })) : [];
    for (const { element } of backgrounds) element.inert = true;
    return () => {
      if (content) content.style.isolation = previousIsolation;
      for (const { element, inert } of backgrounds) element.inert = inert;
    };
}
