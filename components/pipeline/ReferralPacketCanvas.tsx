"use client";

import { usePersonaSwitchSave } from "@/lib/demo/persona-switch-save";
import ReferralHandoffContacts from "./ReferralHandoffContacts";
import { useHandoffRecipients } from "./useHandoffRecipients";
import FeedbackCue from "@/components/pipeline/FeedbackCue";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type FocusEvent, type SetStateAction } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  FolderOpen,
  History,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { pipelineCommunities, type PipelineCommunity } from "@/lib/pipeline/community-config";
import { handoffWorkspaceView } from "@/lib/pipeline/admission-lifecycle";
import { formatPhoneForEntry } from "@/lib/pipeline/phone-display";
import {
  californiaCountyOptions,
  isImportedWorkspace,
  isInternalWorkspaceTag,
} from "@/lib/pipeline/workspace-presentation";
import PacketExtractionReview from "@/components/pipeline/PacketExtractionReview";
import { usePacketExtraction } from "@/components/pipeline/use-packet-extraction";
import { useIntakeFileExtraction } from "@/components/pipeline/use-intake-file-extraction";
import { IntakeExtractionProgress, IntakeSuggestionLabel } from "@/components/pipeline/IntakeExtractionProgress";
import AssessmentWorkspace, { assessmentOpenLabel } from "@/components/pipeline/AssessmentWorkspace";
import AssessmentChartWorkspace from "@/components/pipeline/AssessmentChartWorkspace";
import ReferralWorkflowPanel from "@/components/pipeline/ReferralWorkflowPanel";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import TransferredWorkspaceChart from "@/components/pipeline/TransferredWorkspaceChart";
import StartReferralFromChart from "@/components/pipeline/StartReferralFromChart";
import { ClientChartFrame, ClientChartHeader, ChartHeaderCell, ChartBand } from "@/components/pipeline/ClientMedicalChart";
import folderStyles from "./ClientFolder.module.css";
import { usePhoneAssessment } from "./use-phone-layout";
import workspaceFolderStyles from "./ReferralWorkspaceFolder.module.css";
import type { AssessmentListResponse, PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { hasActiveAssessmentSchedule } from "@/components/pipeline/assessment-workspace-state";
import DeleteWorkspaceDialog from "@/components/pipeline/DeleteWorkspaceDialog";
import HomeDialog from "@/components/pipeline/HomeDialog";
import ActionDetailDialog from "@/components/pipeline/ActionDetailDialog";
import DuplicateReferralReviewDialog, {
  type ReferralDuplicateReview,
} from "@/components/pipeline/DuplicateReferralReviewDialog";
import ReferralActivityPanel from "@/components/pipeline/ReferralActivityPanel";
import ReferralDocumentUpload from "./ReferralDocumentUpload";
import { validateReferralDocumentFiles, type LabeledReferralFile } from "@/lib/pipeline/referral-document-labels";
import type {
  Referral,
  ReferralFile,
  ReferralCanvasFieldKey,
  ReferralSection,
  RequirementType,
} from "@/lib/pipeline/referral-types";
import { canEditWorkspace, canModifyReferral, isUnassignedOwner } from "@/lib/pipeline/referral-ownership";
import type { ReferralCreateInput, ReferralPatch } from "@/lib/pipeline/referral-store";
import {
  fetchCurrentPipelineUser,
  fetchPipelineJson,
  PipelineApiError,
  type PipelineCurrentUser,
} from "@/lib/auth/authenticated-fetch";
import { recordRecentDestination } from "@/lib/pipeline/recent-destinations";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import {
  clearServerReferralDraft,
  loadServerReferralDraft,
  saveServerReferralDraft,
  type ReferralRecoveryDraftKey,
  usesServerReferralDrafts,
} from "@/lib/pipeline/referral-draft-recovery";
import {
  parsePipelineReferralDraft,
  type PipelineReferralDraft,
} from "@/lib/pipeline/user-workspace-state-types";
import {
  clearLocalReferralRecovery,
  loadLocalReferralRecovery,
  referralRecoveryPrincipal,
  saveLocalReferralRecovery,
  type ReferralLocalRecovery,
} from "@/lib/pipeline/referral-local-recovery";
import { createDefaultAdmissionRequirements } from "@/lib/pipeline/workflow-records";
import type { ReferralChangeSnapshot, ReferralPresenceView } from "@/lib/pipeline/collaboration-types";
import { getReferralPatchSections, normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import { documentCategoryForRequirement } from "@/lib/pipeline/document-requirements";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";
import {
  referralDocumentAutofillEnabled,
  maxUploadFileBytes,
  type ExtractedField,
  type PacketFieldsResponse,
  type ReviewFieldResponse,
} from "@/lib/extraction/contracts";
import type { TrainingAssessmentMode } from "@/lib/training/mock-assessment";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import { workspaceCanvasCacheTtlMs } from "@/lib/pipeline/client-navigation";
import type { AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import {
  createMutationId,
  hashPacket,
  uploadReferralPacket,
  uploadReferralSupportingDocument,
  type InitialDocumentCategory,
} from "@/lib/pipeline/referral-packet-upload";
import {
  extractedCanvasFieldKeys,
  intakePreviewSuggestions,
  populateFormFromExtraction,
  type IntakeFieldSuggestion,
  type ReferralCanvasDirtyKey,
  type ReferralCanvasPacketField,
} from "@/lib/pipeline/referral-canvas-extraction";
import {
  buildReferralCanvasCreateInput,
  buildReferralCanvasPatch,
  canRebaseReferralCanvasPatch,
  isPersistedCanvasFieldKey,
  persistedCanvasFieldKeys,
  referralCanvasValue,
  type PersistedCanvasFieldKey,
} from "@/lib/pipeline/referral-canvas-persistence";
import {
  canvasDraftStorageKey,
  captureReferralSaveSnapshot,
  currentDraftValues,
  draftKeySignature,
  hasPendingDocumentUploads,
  mergePendingDocumentNames,
  normalizeTags,
  reconcileSavedDirtyKeys,
  referralDraftSaveStatus,
  referralSaveStatus,
  type ReferralSaveSnapshot,
  type DraftValueSnapshot,
} from "@/components/pipeline/referral-canvas-save-state";
import type { AssessmentEntryAction, PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { ReferralChartEditField } from "@/lib/pipeline/client-chart-context";
import ReferralContactsCard from "@/components/pipeline/ReferralContactsCard";
import AssignedWorkButton from "@/components/pipeline/AssignedWorkButton";
import ContactDirectorySuggestion from "@/components/pipeline/ContactDirectorySuggestion";
import { ageFromCalendarDate, calendarToday, normalizeCalendarDate } from "@/lib/pipeline/calendar-date";
import { stringLimits } from "@/lib/pipeline/referral-validation";

type FieldKey = ReferralCanvasFieldKey;

type PacketField = ReferralCanvasPacketField;

const fileChartRefreshWarning = "The file change was saved. Reload to update the chart if it does not refresh.";

type PacketFieldReviewResult = ReviewFieldResponse & {
  packet_fields?: PacketFieldsResponse;
  referral?: Referral;
  projection_status?: "synchronized" | "not_linked";
};

type Requirement = {
  id: string;
  label: string;
  type: RequirementType;
};

type ReferralPacketCanvasProps = {
  referral?: {
    id: number;
    name?: string;
    community?: string;
  };
  newDraftKey?: `new-${string}`;
  initialWorkspaceStage?: WorkspaceStageName;
  initialWorkspaceLocation?: PipelineWorkspaceLocation;
  assessmentEntryAction?: AssessmentEntryAction;
  onAssessmentEntryHandled?: () => void;
  resumeWorkflowOnOpen?: boolean;
  trainingAssessmentMode?: TrainingAssessmentMode;
  trainingAssessmentSection?: AssessmentToolSection;
  trainingIntakeMode?: boolean;
  onReferralSaved?: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onReferralDeleted?: () => void;
  onWorkspaceStageChange?: (stage: WorkspaceStageName) => void;
  onWorkspaceLocationChange?: (location: PipelineWorkspaceLocation) => void;
  onOpenProfile?: (canonicalClientId: string) => void;
  onOpenAssignedWork?: () => void;
};

type DirtyDraftKey = ReferralCanvasDirtyKey;

type CanvasSessionDraft = PipelineReferralDraft;

type InitialPacketSelectionResult =
  | { accepted: false; error?: string }
  | { accepted: true; file: File };

type RemoteFieldConflict = {
  key: DirtyDraftKey;
  label: string;
  localValue: string;
  remoteValue: string;
};

type RemoteChange = {
  referral: Referral;
  updatedBy: string;
  conflicts: RemoteFieldConflict[];
};

type ExtractionReviewConflict = {
  field: ExtractedField;
  attemptedValue: string;
  latestValue: string;
};

type WorkspaceStage = 1 | 2 | 3;
type WorkspaceView = WorkspaceStage | "workflow" | "email" | "files" | "activity";
type WorkspaceStep = { page: WorkspaceStage | "workflow" | "email"; label: string };
type WorkspaceStageName = "intake" | "assessment" | "chart";

const packetSteps: ReadonlyArray<{ page: WorkspaceStage; label: string }> = [
  { page: 1, label: "Intake" },
] as const;

const savedWorkspaceSteps: ReadonlyArray<WorkspaceStep> = [
  { page: 3, label: "Chart" },
  { page: 2, label: "Assessment" },
  { page: "workflow", label: "Decision" },
  { page: "email", label: "Finish & send" },
];

const importedWorkspaceSteps: ReadonlyArray<{ page: WorkspaceStage; label: string }> = [
  { page: 1, label: "Chart" },
] as const;

function mutableReferralId(loadedReferral: Referral | null, routeReferralId?: number, readOnly = false) {
  if (readOnly || !loadedReferral || loadedReferral.id !== routeReferralId || loadedReferral.workspaceStatus === "historical") return null;
  return routeReferralId;
}

function isWorkspacePermissionReadOnly(referral: Referral | null, viewer: PipelineCurrentUser | null, trainingMode?: TrainingAssessmentMode) {
  if (!referral || trainingMode) return false;
  return !viewer?.id || !canModifyReferral(referral, { ...viewer, id: viewer.id });
}

function IntakeEditScope({ readOnly, accessError, accessChecking, children }: { readOnly: boolean; accessError: string; accessChecking: boolean; children: React.ReactNode }) {
  return <>
    {!accessError && !accessChecking && readOnly ? <p role="status" className="mb-4 text-sm font-bold text-[#595959]">Sign in with an approved Pipeline account to make changes.</p> : null}
    <fieldset disabled={readOnly} className="min-w-0" onDropCapture={readOnly ? (event) => { event.preventDefault(); event.stopPropagation(); } : undefined}>
      {children}
    </fieldset>
  </>;
}

function visibleWorkspacePage(
  activePage: WorkspaceView,
  steps: ReadonlyArray<WorkspaceStep>,
): WorkspaceView {
  // Intake remains the detail editor inside the saved chart, not another tab.
  if (activePage === 1 && steps.some((step) => step.page === 3)) return 1;
  if (activePage === "workflow" && !steps.some((step) => step.page === "workflow")) return steps.some((step) => step.page === 2) ? 2 : 1;
  if (typeof activePage !== "number" || steps.some((step) => step.page === activePage)) return activePage;
  return steps[0]?.page ?? 1;
}

function showWorkspaceEditingControls(trainingAssessmentMode: TrainingAssessmentMode | undefined, readOnly: boolean) {
  return !trainingAssessmentMode && !readOnly;
}

function showWorkspaceTrashControl(referral: Referral | null, canSupervise: boolean, readOnly: boolean) {
  return Boolean(referral && canSupervise && !readOnly);
}

export const initialFields: Record<FieldKey, PacketField> = {
  name: { label: "NAME", value: "", placeholder: "Client name" },
  gender: { label: "GENDER", value: "", placeholder: "" },
  age: { label: "AGE", value: "", placeholder: "" },
  dob: { label: "DOB", value: "", placeholder: "M/D/YYYY" },
  ssn: { label: "SSN", value: "", placeholder: "" },
  owner: { label: "Owner (@name):", value: "", placeholder: "Assign owner" },
  referralReceived: {
    label: "Referral received:",
    value: "",
    placeholder: "M/D/YYYY",
  },
  admissionDate: {
    label: "Admission date:",
    value: "",
    placeholder: "M/D/YYYY",
  },
  community: { label: "Community:", value: "", placeholder: "Select community" },
  county: { label: "County:", value: "", placeholder: "Select county" },
  referent: { label: "Referent:", value: "", placeholder: "Facility or referring provider" },
  responsiblePerson: {
    label: "Responsible Person:",
    value: "",
    placeholder: "",
  },
  phone: { label: "Referrer phone:", value: "", placeholder: "Phone number" },
  email: { label: "Referrer email:", value: "", placeholder: "Email address" },
  referrerName: { label: "Referrer name:", value: "", placeholder: "Name" },
  summary: {
    label: "Summary",
    value: "",
    placeholder: "Referral summary",
  },
  currentMedications: {
    label: "Current medications",
    value: "",
    placeholder: "One medication per line, or paste the med list note",
  },
};

const genderOptions = ["Male", "Female", "Non-binary", "Unknown", "Other"] as const;

const visibleChartFieldKeys: readonly FieldKey[] = [
  "name",
  "gender",
  "dob",
  "ssn",
  "owner",
  "referralReceived",
  "community",
  "county",
  "referent",
  "responsiblePerson",
  "referrerName",
  "phone",
  "email",
  "currentMedications",
];

const requirements: Requirement[] = [
  {
    id: "medication-list",
    label: "Signed Medication List",
    type: "medication_list",
  },
  {
    id: "conservatorship",
    label: "Letters of Conservatorship (if applicable)",
    type: "conservatorship_document",
  },
  {
    id: "admission-agreement",
    label: "Signed Admission Agreement + LIC Forms",
    type: "signed_admission_agreement",
  },
  {
    id: "lic-602",
    label: "LIC602",
    type: "lic_602",
  },
  {
    id: "tb-test",
    label: "TB Test-Results",
    type: "tb_test",
  },
  {
    id: "lic-601-603",
    label: "LIC 601 & LIC 603",
    type: "lic_601_603",
  },
];

const attachments: Requirement[] = [
  { id: "provider-form", label: "Provider Form", type: "provider_form" },
  { id: "face-sheet", label: "Face Sheet", type: "face_sheet" },
];

function hasRememberedAssessmentWork(location: PipelineWorkspaceLocation | undefined) {
  return Boolean(location?.assessmentDialog || location?.assessmentMode === "prepare" || location?.assessmentMode === "interview");
}

export default function ReferralPacketCanvas({
  referral,
  newDraftKey,
  initialWorkspaceStage = "intake",
  initialWorkspaceLocation,
  assessmentEntryAction,
  onAssessmentEntryHandled,
  resumeWorkflowOnOpen = false,
  trainingAssessmentMode,
  trainingAssessmentSection,
  trainingIntakeMode = false,
  onReferralSaved,
  onReferralDeleted,
  onWorkspaceStageChange,
  onWorkspaceLocationChange,
  onOpenProfile = () => undefined,
  onOpenAssignedWork,
}: ReferralPacketCanvasProps = {}) {
  const phone = usePhoneAssessment();
  const [fields, setFields] = useState<Record<FieldKey, PacketField>>(() => ({
    ...initialFields,
    name: { ...initialFields.name, value: referral?.name ?? "" },
    referralReceived: { ...initialFields.referralReceived, value: referral?.id ? "" : calendarToday() },
  }));
  const [conserved, setConserved] = useState<"yes" | "no" | "">("");
  const [documents, setDocuments] = useState<Record<string, string>>({});
  const [pendingDocuments, setPendingDocuments] = useState<Record<string, File>>({});
  const [additionalFiles, setAdditionalFiles] = useState<LabeledReferralFile[]>([]);
  const [workbookImport, setWorkbookImport] = useState<File | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<ReferralFile[]>([]);
  const [workspaceFilesLoading, setWorkspaceFilesLoading] = useState(Boolean(referral?.id));
  const [workspaceFilesError, setWorkspaceFilesError] = useState("");
  const [workspaceFilesRevision, setWorkspaceFilesRevision] = useState(0);
  const [uploadingDocumentIds, setUploadingDocumentIds] = useState<Set<string>>(() => new Set());
  const [initialPacket, setInitialPacket] = useState<File | null>(null);
  const [initialPacketCategory, setInitialPacketCategory] = useState<InitialDocumentCategory>("face_sheet");
  const [tagsInput, setTagsInput] = useState("");
  const routedWorkspaceLocation = initialWorkspaceLocationOrStage(initialWorkspaceLocation, initialWorkspaceStage);
  const lastAssessmentSectionRef = useRef(routedWorkspaceLocation.assessmentSection);
  const lastAssessmentQuestionRef = useRef(routedWorkspaceLocation.assessmentQuestion);
  const lastAssessmentLocationRef = useRef<PipelineWorkspaceLocation>(routedWorkspaceLocation.view === "assessment"
    ? { ...routedWorkspaceLocation, assessmentMode: routedWorkspaceLocation.assessmentMode === "review" ? undefined : routedWorkspaceLocation.assessmentMode }
    : { view: "assessment" });
  const [activePage, setActivePage] = useState<WorkspaceView>(workspacePageForLocation(routedWorkspaceLocation, referral?.id));
  const [assessmentSummary, setAssessmentSummary] = useState<{
    captured: number;
    total: number;
    status: string;
    assessmentId?: string;
    scheduledStartAt?: string | null;
    scheduleStatus?: PipelineAssessmentRecord["schedule_status"];
    startedAt?: string | null;
    signedAt?: string | null;
  }>({
    captured: 0,
    total: 52,
    status: "not_started",
  });
  const [entryAssessment, setEntryAssessment] = useState<PipelineAssessmentRecord | null>();
  const entryResolvedRef = useRef(false);
  const publishedAssessmentSectionRef = useRef<AssessmentToolSection | undefined>(undefined);
  const [emailSending, setEmailSending] = useState(false);
  const [emailFinishing, setEmailFinishing] = useState(false);
  const emailSendingRef = useRef(false);
  const assessmentNavigationRef = useRef<(() => Promise<void>) | null>(null);
  const [savedAt, setSavedAt] = useState(referral?.id ? "Loading referral..." : "Draft");
  const [loadedReferral, setLoadedReferral] = useState<Referral | null>(null);
  const handoff = useHandoffRecipients(activeReferralId(loadedReferral, referral), fields.community.value);
  const flushHandoff = handoff.flush;
  const { beforeNavigationRef, assessmentFocused, setAssessmentFocused } = usePipelineShell();
  // Keep the shell stable for the whole folder, not just while its assessment is mounted.
  useLayoutEffect(() => {
    setAssessmentFocused(true);
    return () => setAssessmentFocused(false);
  }, [setAssessmentFocused]);
  const extraction = usePacketExtraction(extractionPacketId(loadedReferral));
  const intakeExtraction = useIntakeFileExtraction();
  const [dismissedSuggestionKeys, setDismissedSuggestionKeys] = useState<Set<FieldKey>>(() => new Set());
  const { start: startIntakeExtraction, reset: resetIntakeExtraction } = intakeExtraction;
  useEffect(() => {
    resetIntakeExtraction();
    setDismissedSuggestionKeys(new Set());
  }, [newDraftKey, referral?.id, resetIntakeExtraction]);
  const serverDraftsEnabled = usesServerReferralDrafts() && !trainingIntakeMode;
  const [draftRecoveryLoading, setDraftRecoveryLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<number | null>(null);
  const [showCreationHandoff, setShowCreationHandoff] = useState(routedWorkspaceLocation.workspaceDialog === "created");
  const creationHandoffPendingRef = useRef(false);
  useEffect(() => {
    if (!showCreationHandoff || activePage !== 3 || !referral?.id || initialWorkspaceLocation?.workspaceDialog === "created") return;
    onWorkspaceLocationChange?.({ view: "chart", workspaceDialog: "created" });
  }, [showCreationHandoff, activePage, referral?.id, initialWorkspaceLocation?.workspaceDialog, onWorkspaceLocationChange]);
  const [scheduleRequested, setScheduleRequested] = useState(false);
  const [preparingReferralId, setPreparingReferralId] = useState<number | null>(null);
  const [reviewBusyFieldKey, setReviewBusyFieldKey] = useState<string>();
  const [isBulkReviewing, setIsBulkReviewing] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [recoveredDraftAt, setRecoveredDraftAt] = useState("");
  const [recoveredPacketName, setRecoveredPacketName] = useState("");
  const [dirtyKeys, setDirtyKeys] = useState<Set<DirtyDraftKey>>(() => new Set());
  const [remoteChange, setRemoteChange] = useState<RemoteChange | null>(null);
  const [extractionConflict, setExtractionConflict] = useState<ExtractionReviewConflict | null>(null);
  const [presence, setPresence] = useState<ReferralPresenceView[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersError, setMembersError] = useState("");
  const [membersRetry, setMembersRetry] = useState(0);
  const [canSupervise, setCanSupervise] = useState(false);
  const [viewer, setViewer] = useState<PipelineCurrentUser | null>(null);
  const [accessError, setAccessError] = useState("");
  const [accessChecking, setAccessChecking] = useState(true);
  const [accessRetry, setAccessRetry] = useState(0);
  const [ownerPrincipalId, setOwnerPrincipalId] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [duplicateReview, setDuplicateReview] = useState<ReferralDuplicateReview | null>(null);
  const [saveAlert, setSaveAlert] = useState("");
  const [pendingOwnerChange, setPendingOwnerChange] = useState<{ principalId: string; displayName: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const permissionReadOnly = Boolean(!trainingAssessmentMode && (accessError || accessChecking))
    || Boolean(referral?.id && loadedReferral?.id !== referral.id)
    || isWorkspacePermissionReadOnly(loadedReferral, viewer, trainingAssessmentMode);
  const editableReferralId = mutableReferralId(loadedReferral, referral?.id, permissionReadOnly);
  const canvasRef = useRef<HTMLDivElement>(null);
  const loadedReferralRef = useRef<Referral | null>(null);
  const fieldsRef = useRef(fields);
  const tagsInputRef = useRef(tagsInput);
  const documentsRef = useRef(documents);
  const pendingDocumentsRef = useRef(pendingDocuments);
  const additionalFilesRef = useRef(additionalFiles);
  const initialPacketRef = useRef(initialPacket);
  const conservedRef = useRef(conserved);
  const dirtyKeysRef = useRef(dirtyKeys);
  const isSavingRef = useRef(isSaving);
  const draftRevisionRef = useRef(0);
  const creationMutationIdRef = useRef(newReferralCreationMutationId(newDraftKey));
  const patchMutationIdsRef = useRef(new Map<string, string>());
  const deleteMutationIdRef = useRef(createMutationId());
  const ownerPrincipalIdRef = useRef(ownerPrincipalId);
  const lastFocusRef = useRef<FieldKey | undefined>(initialIntakeFocus(routedWorkspaceLocation));
  const chartEditTargetRef = useRef<ReferralChartEditField | null>(null);
  // The chart edit control that opened intake, so Done returns to it.
  const chartReturnRef = useRef<{ label: string; index: number } | null>(null);
  const lastChartEditControlRef = useRef<HTMLElement | null>(null);
  const locallyFocusedFieldRef = useRef<FieldKey | undefined>(undefined);
  useWorkspaceLocationRouting(referral?.id, newDraftKey, routedWorkspaceLocation, setActivePage);
  const defaultOwnerRef = useRef<{ principalId: string; displayName: string } | null>(null);
  const handoffReasonRef = useRef("");
  const draftBaseVersionRef = useRef<number | undefined>(undefined);
  const draftBaseValuesRef = useRef<Partial<Record<DirtyDraftKey, string>>>({});
  const recoveryDraftReferenceRef = useRef<ReferralRecoveryDraftKey>(referralRecoveryDraftReference(referral?.id, newDraftKey));
  const initialPacketCategoryRef = useRef(initialPacketCategory);
  const persistRecoveryDraftRef = useRef<() => void>(() => undefined);
  const persistRecoveryDraftWithStatusRef = useRef<() => void>(() => undefined);
  const preserveIntakeBeforeNavigationRef = useRef<() => Promise<void>>(async () => undefined);
  const intakeSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const fileUploadQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const deletedFileIdsRef = useRef(new Set<string>());
  const focusedCellRef = useRef<{ key: DirtyDraftKey; signature: string } | null>(null);

  useEffect(() => {
    loadedReferralRef.current = loadedReferral;
  }, [loadedReferral]);

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  useEffect(() => {
    tagsInputRef.current = tagsInput;
  }, [tagsInput]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    pendingDocumentsRef.current = pendingDocuments;
  }, [pendingDocuments]);

  useEffect(() => {
    additionalFilesRef.current = additionalFiles;
  }, [additionalFiles]);

  useEffect(() => {
    const referralId = loadedReferral?.id;
    if (!referralId) return;
    const controller = new AbortController();
    setWorkspaceFilesLoading(true);
    setWorkspaceFilesError("");
    loadWorkspaceFileInventory(referralId, controller.signal)
      .then((files) => { if (!controller.signal.aborted) setWorkspaceFiles(files.filter((file) => !deletedFileIdsRef.current.has(file.id))); })
      .catch(() => {
        if (!controller.signal.aborted) setWorkspaceFilesError(deletedFileIdsRef.current.size > 0
          ? "The file was deleted, but the file list could not be refreshed."
          : "The file list could not be loaded.");
      })
      .finally(() => { if (!controller.signal.aborted) setWorkspaceFilesLoading(false); });
    return () => controller.abort();
  }, [loadedReferral?.id, loadedReferral?.sectionVersions?.documents, loadedReferral?.sectionVersions?.workflow, workspaceFilesRevision]);

  useEffect(() => {
    const refreshDocuments = (event: Event) => {
      const detail = (event as CustomEvent<{ referralId: number; refreshChart?: boolean; deletedFileId?: string }>).detail;
      if (detail?.referralId !== loadedReferralRef.current?.id) return;
      const id = loadedReferralRef.current!.id;
      if (detail.deletedFileId) {
        deletedFileIdsRef.current.add(detail.deletedFileId);
        setWorkspaceFiles((files) => files.filter((file) => file.id !== detail.deletedFileId));
      } else deletedFileIdsRef.current.clear();
      setWorkspaceFilesRevision((revision) => revision + 1);
      if (detail.refreshChart === false) return;
      void fetchPipelineJson<{ referral: Referral }>(`/api/referrals/${id}/canvas`, { cache: "no-store" }).then((result) => {
        const current = loadedReferralRef.current;
        if (current?.id !== id) return;
        const latest = (current.version ?? 1) > (result.referral.version ?? 1) ? current : result.referral;
        loadedReferralRef.current = latest;
        setLoadedReferral(latest);
        const next = mergePendingDocumentNames(documentsFromReferral(latest), pendingDocumentsRef.current);
        documentsRef.current = next;
        setDocuments(next);
        setSaveAlert((alert) => alert === fileChartRefreshWarning ? "" : alert);
      }).catch(() => {
        if (loadedReferralRef.current?.id === id) setSaveAlert(fileChartRefreshWarning);
      });
    };
    window.addEventListener("pipeline:documents-changed", refreshDocuments);
    return () => window.removeEventListener("pipeline:documents-changed", refreshDocuments);
  }, []);

  useEffect(() => {
    initialPacketRef.current = initialPacket;
    initialPacketCategoryRef.current = initialPacketCategory;
  }, [initialPacket, initialPacketCategory]);

  useEffect(() => {
    conservedRef.current = conserved;
  }, [conserved]);

  useEffect(() => {
    dirtyKeysRef.current = dirtyKeys;
  }, [dirtyKeys]);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    ownerPrincipalIdRef.current = ownerPrincipalId;
  }, [ownerPrincipalId]);

  const referralWorkspaceId = activeReferralId(loadedReferral, referral);
  useEffect(() => {
    const referralId = referralWorkspaceId;
    if (!referralId) {
      setAssessmentSummary({ captured: 0, total: 52, status: "not_started" });
      return;
    }
    setAssessmentSummary({ captured: 0, total: 52, status: "not_started" });
    setEntryAssessment(undefined);
    let cancelled = false;
    fetchPipelineJson<AssessmentListResponse>(`/api/referrals/${referralId}/assessments`, { cache: "no-store" })
      .then((payload) => {
        if (cancelled) return;
        const assessment = payload.assessments[0];
        setEntryAssessment(assessment ?? null);
        if (!assessment) return;
        setAssessmentSummary({
          captured: 0,
          total: 52,
          status: assessment.status,
          assessmentId: assessment.assessment_id,
          scheduledStartAt: assessment.scheduled_start_at,
          scheduleStatus: assessment.schedule_status,
          startedAt: assessment.started_at,
          signedAt: assessment.signed_at,
        });
      })
      .catch(() => {
        // Workspace navigation remains usable if the assessment summary cannot be loaded.
        if (!cancelled) setEntryAssessment(null);
      });
    return () => {
      cancelled = true;
    };
  }, [referralWorkspaceId]);

  useEffect(() => {
    if (!resumeWorkflowOnOpen || entryResolvedRef.current || entryAssessment === undefined || !loadedReferral || draftRecoveryLoading) return;
    entryResolvedRef.current = true;
    // Never pull someone away after they have started editing or chosen a tab.
    if (dirtyKeysRef.current.size || locallyFocusedFieldRef.current) return;
    // A remembered preparation/interview task is unfinished work, including
    // revisiting answers after signing. Only completion sends it forward.
    if (hasRememberedAssessmentWork(initialWorkspaceLocation)) return;
    const view = handoffWorkspaceView(loadedReferral, { signedAt: entryAssessment?.signed_at, packetSentAt: entryAssessment?.meet_client_sent_at });
    if (!view) return;
    setActivePage(view);
    onWorkspaceLocationChange?.({ view });
  }, [resumeWorkflowOnOpen, entryAssessment, loadedReferral, draftRecoveryLoading, onWorkspaceLocationChange, initialWorkspaceLocation]);

  useEffect(() => {
    let cancelled = false;
    fetchPipelineJson<{ members: WorkspaceMember[]; current_principal_id: string }>("/api/members?scope=assessors", { cache: "no-store" }, { cacheTtlMs: 30_000 })
      .then((payload) => {
        if (cancelled) return;
        setMembersError("");
        setMembers(payload.members);
        const current = payload.members.find((member) => member.principal_id === payload.current_principal_id);
        defaultOwnerRef.current = current
          ? { principalId: current.principal_id, displayName: current.display_name }
          : null;
        if (!loadedReferralRef.current && !fieldsRef.current.owner.value.trim()) {
          if (current) {
            setOwnerPrincipalId(current.principal_id);
            setFields((fields) => ({ ...fields, owner: { ...fields.owner, value: current.display_name } }));
          }
        }
      })
      .catch(() => {
        if (!cancelled) setMembersError("The assessor list could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [membersRetry]);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentPipelineUser()
      .then(({ user }) => {
        if (!cancelled) {
          setAccessError("");
          setViewer(user ?? null);
          setCanSupervise(canEditWorkspace(user));
          setAccessChecking(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setViewer(null);
          setCanSupervise(false);
          setAccessError("Pipeline could not verify your access.");
          setAccessChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessRetry]);

  const captureRecoveryDraft = (): CanvasSessionDraft | null => {
    const activeDirtyKeys = dirtyKeysRef.current;
    if (!workspaceHasQueuedChanges(activeDirtyKeys, pendingDocumentsRef.current, initialPacketRef.current, additionalFilesRef.current)) return null;
    return {
      schema: 1,
      savedAt: new Date().toISOString(),
      ...(draftBaseVersionRef.current ? { baseVersion: draftBaseVersionRef.current } : {}),
      ...(Object.keys(draftBaseValuesRef.current).length > 0 ? { baseValues: { ...draftBaseValuesRef.current } } : {}),
      dirtyKeys: [...activeDirtyKeys],
      fields: Object.fromEntries(
        persistedFieldKeys.map((key) => [key, {
          value: fieldsRef.current[key].value,
          ...(fieldsRef.current[key].sourceFile ? { sourceFile: fieldsRef.current[key].sourceFile } : {}),
        }]),
      ) as CanvasSessionDraft["fields"],
      conserved: conservedRef.current,
      tagsInput: tagsInputRef.current,
      documents: documentsRef.current,
      ...(lastFocusRef.current ? { lastFocus: lastFocusRef.current } : {}),
      ...(initialPacketRef.current ? { initialPacketName: initialPacketRef.current.name } : {}),
      initialPacketCategory: initialPacketCategoryRef.current,
    };
  };

  const preservePendingIntake = async (allowServerFallback = true) => {
    const draft = captureRecoveryDraft();
    if (!draft || trainingIntakeMode) return;
    const reference = recoveryDraftReferenceRef.current;
    const recovery: ReferralLocalRecovery = {
      draft, ownerPrincipalId: ownerPrincipalIdRef.current,
      initialPacket: initialPacketRef.current,
      pendingDocuments: { ...pendingDocumentsRef.current }, additionalFiles: [...additionalFilesRef.current],
    };
    const principal = viewer?.id ?? await referralRecoveryPrincipal();
    try {
      await saveLocalReferralRecovery(principal, reference, recovery);
    } catch (localError) {
      if (!allowServerFallback || recovery.initialPacket || Object.keys(recovery.pendingDocuments).length || recovery.additionalFiles.length) throw localError;
      await saveServerReferralDraft(reference, draft);
    }
  };

  const preserveIntakeBeforeNavigation = async () => {
    try {
      if (!serverDraftsEnabled) {
        const draft = captureRecoveryDraft();
        if (draft) window.sessionStorage.setItem(canvasDraftStorageKey(recoveryDraftReferenceRef.current), JSON.stringify(draft));
      }
      const hasPendingFiles = Boolean(initialPacketRef.current || Object.keys(pendingDocumentsRef.current).length || additionalFilesRef.current.length);
      if (serverDraftsEnabled || hasPendingFiles) await preservePendingIntake();
      await intakeSaveQueueRef.current;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Your intake could not be saved. Try again before leaving.");
      setSavedAt("Unsaved changes");
      throw error;
    }
  };
  preserveIntakeBeforeNavigationRef.current = preserveIntakeBeforeNavigation;

  useEffect(() => {
    const waitForDelivery = async () => {
      if (emailSendingRef.current) throw new Error("Wait for the email delivery result before leaving.");
      await flushHandoff();
      await assessmentNavigationRef.current?.();
      await preserveIntakeBeforeNavigationRef.current();
    };
    beforeNavigationRef.current = waitForDelivery;
    return () => {
      if (beforeNavigationRef.current === waitForDelivery) beforeNavigationRef.current = null;
    };
  }, [beforeNavigationRef, emailSending, flushHandoff]);

  const restoreLocalFiles = useCallback((recovery: ReferralLocalRecovery) => {
    initialPacketRef.current = recovery.initialPacket;
    setInitialPacket(recovery.initialPacket);
    pendingDocumentsRef.current = recovery.pendingDocuments;
    setPendingDocuments(recovery.pendingDocuments);
    additionalFilesRef.current = recovery.additionalFiles;
    setAdditionalFiles(recovery.additionalFiles);
    ownerPrincipalIdRef.current = recovery.ownerPrincipalId;
    setOwnerPrincipalId(recovery.ownerPrincipalId);
    if (recovery.initialPacket) {
      dirtyKeysRef.current.add("initialPacket");
      setDirtyKeys(new Set(dirtyKeysRef.current));
      setRecoveredPacketName("");
      startIntakeExtraction(recovery.initialPacket, "initial", loadedReferralRef.current?.id);
    }
    Object.entries(recovery.pendingDocuments).forEach(([key, file]) => startIntakeExtraction(file, key, loadedReferralRef.current?.id));
    recovery.additionalFiles.forEach(({ file }) => startIntakeExtraction(file, `additional-${createMutationId()}`, loadedReferralRef.current?.id));
  }, [startIntakeExtraction]);

  const loadIntakeRecovery = async (reference: ReferralRecoveryDraftKey) => {
    const [server, local] = await Promise.allSettled([
      loadServerReferralDraft(reference), loadLocalReferralRecovery(reference),
    ]);
    const localRecovery = local.status === "fulfilled" ? local.value : null;
    const serverDraft = server.status === "fulfilled" ? server.value : null;
    if (localRecovery && (!serverDraft || localRecovery.initialPacket || localRecovery.additionalFiles.length > 0 || Object.keys(localRecovery.pendingDocuments).length > 0 || Date.parse(localRecovery.draft.savedAt) >= Date.parse(serverDraft.savedAt))) {
      return { draft: localRecovery.draft, local: localRecovery };
    }
    return { draft: serverDraft, local: localRecovery };
  };

  const persistRecoveryDraft = (reportStatus: boolean) => {
    const draft = captureRecoveryDraft();
    if (!draft) return;
    const revision = draftRevisionRef.current;
    const reference = recoveryDraftReferenceRef.current;
    const canReportRecovery = () => reportStatus && draftRevisionRef.current === revision
      && (!loadedReferralRef.current || dirtyKeysRef.current.size > 0);
    if (serverDraftsEnabled) {
      void preservePendingIntake(false)
        .then(() => {
          if (canReportRecovery()) setSavedAt("Saved on this device; not synced");
        })
        .catch((error) => {
          if (canReportRecovery()) {
            const message = error instanceof Error ? error.message : "Could not save on this device.";
            setSavedAt(`Pending · ${message}`);
          }
        });
      return;
    }
    try {
      window.sessionStorage.setItem(canvasDraftStorageKey(reference), JSON.stringify(draft));
      if (reportStatus && !loadedReferralRef.current && draftRevisionRef.current === revision) setSavedAt("Draft saved in this tab");
    } catch {
      if (reportStatus) setSaveError("This browser could not keep a recovery draft. Your changes are still open in this tab.");
    }
  };
  persistRecoveryDraftRef.current = () => persistRecoveryDraft(false);
  persistRecoveryDraftWithStatusRef.current = () => persistRecoveryDraft(true);

  useEffect(() => {
    if (isSaving || (dirtyKeys.size === 0 && Object.keys(pendingDocuments).length === 0)) return;
    const timer = window.setTimeout(() => {
      if (!isSavingRef.current) persistRecoveryDraftWithStatusRef.current();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [conserved, dirtyKeys, documents, fields, initialPacket, initialPacketCategory, isSaving, pendingDocuments, tagsInput]);

  useEffect(() => {
    if (dirtyKeys.size === 0) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      persistRecoveryDraftRef.current();
    };
  }, [dirtyKeys, pendingDocuments]);

  const markDirty = (key: DirtyDraftKey) => {
    draftRevisionRef.current += 1;
    const next = new Set(dirtyKeysRef.current);
    if (!next.has(key)) {
      const base = loadedReferralRef.current;
      if (base && draftBaseVersionRef.current === undefined) draftBaseVersionRef.current = base.version;
      draftBaseValuesRef.current = {
        ...draftBaseValuesRef.current,
        [key]: referralBaseDraftValue(base, key),
      };
    }
    next.add(key);
    dirtyKeysRef.current = next;
    setDirtyKeys(next);
  };

  const restoreDraftTracking = (draft: CanvasSessionDraft | null) => {
    if (!draft) return null;
    lastFocusRef.current = draft.lastFocus;
    const recoveredDirtyKeys = new Set(draft.dirtyKeys.filter((key) => key !== "initialPacket"));
    dirtyKeysRef.current = recoveredDirtyKeys;
    draftBaseVersionRef.current = draft.baseVersion;
    draftBaseValuesRef.current = { ...draft.baseValues };
    return draft;
  };

  const clearDraftTracking = () => {
    draftBaseVersionRef.current = undefined;
    draftBaseValuesRef.current = {};
  };

  const rebaseDraftTracking = (latest: Referral, activeDirtyKeys: ReadonlySet<DirtyDraftKey>, savedKeys?: ReadonlySet<DirtyDraftKey>) => {
    if (activeDirtyKeys.size === 0) {
      clearDraftTracking();
      return;
    }
    draftBaseVersionRef.current = latest.version;
    draftBaseValuesRef.current = Object.fromEntries(
      [...activeDirtyKeys].map((key) => [key, savedKeys && !savedKeys.has(key)
        ? draftBaseValuesRef.current[key] ?? referralBaseDraftValue(latest, key)
        : referralBaseDraftValue(latest, key)]),
    );
  };

  useEffect(() => {
    const nextDraftReference = referralRecoveryDraftReference(referral?.id, newDraftKey);
    if (recoveryDraftReferenceRef.current !== nextDraftReference) persistRecoveryDraftRef.current();
    recoveryDraftReferenceRef.current = nextDraftReference;
    if (!referral?.id) {
      let cancelled = false;
      creationMutationIdRef.current = newReferralCreationMutationId(newDraftKey);
      const defaultOwner = defaultOwnerRef.current;
      const resetFields = {
        ...initialFields,
        name: { ...initialFields.name },
        owner: { ...initialFields.owner, value: defaultOwner?.displayName ?? "" },
        referralReceived: { ...initialFields.referralReceived, value: calendarToday() },
      };
      fieldsRef.current = resetFields;
      setFields(resetFields);
      ownerPrincipalIdRef.current = defaultOwner?.principalId ?? "";
      setOwnerPrincipalId(defaultOwner?.principalId ?? "");
      conservedRef.current = "";
      setConserved("");
      tagsInputRef.current = "";
      setTagsInput("");
      documentsRef.current = {};
      setDocuments({});
      initialPacketRef.current = null;
      setInitialPacket(null);
      initialPacketCategoryRef.current = "face_sheet";
      setInitialPacketCategory("face_sheet");
      setLoadedReferral(null);
      loadedReferralRef.current = null;
      const resetDirtyKeys = new Set<DirtyDraftKey>();
      dirtyKeysRef.current = resetDirtyKeys;
      setDirtyKeys(resetDirtyKeys);
      clearDraftTracking();
      draftRevisionRef.current = 0;
      setRemoteChange(null);
      setExtractionConflict(null);
      setPresence([]);
      pendingDocumentsRef.current = {};
      setPendingDocuments({});
      additionalFilesRef.current = [];
      setAdditionalFiles([]);
      setWorkspaceFiles([]);
      setUploadingDocumentIds(new Set());
      setRecoveredDraftAt("");
      setRecoveredPacketName("");
      setSaveError("");
      const setters = {
        setFields,
        setConserved,
        setTagsInput,
        setDocuments,
        setInitialPacketCategory,
        setDirtyKeys,
        setRecoveredDraftAt,
        setRecoveredPacketName,
      };
      if (serverDraftsEnabled) {
        setDraftRecoveryLoading(true);
        void loadIntakeRecovery(newDraftKey).then(({ draft, local }) => {
          if (cancelled) return;
          const recovered = draft ? restoreDraftTracking(applyRecoveryDraft(draft, setters)) : null;
          if (local) restoreLocalFiles(local);
          if (recovered || dirtyKeysRef.current.size === 0) setSavedAt(recovered ? "Restored edits · not yet saved" : "Draft");
        }).catch(() => {
          if (!cancelled) setSaveError("Could not check for a recovery draft.");
        }).finally(() => {
          if (!cancelled) setDraftRecoveryLoading(false);
        });
      } else {
        setDraftRecoveryLoading(false);
        const recovered = restoreDraftTracking(restoreSessionDraft(newDraftKey, setters));
        setSavedAt(recovered ? "Restored edits · not yet saved" : "Draft");
      }
      return () => {
        cancelled = true;
      };
    }
    if (loadedReferralRef.current?.id === referral.id) return;

    let cancelled = false;
    setDraftRecoveryLoading(true);
    fetchPipelineJson<{ referral?: Referral }>(`/api/referrals/${referral.id}/canvas`, { cache: "no-store" }, { cacheTtlMs: workspaceCanvasCacheTtlMs }).then((canvasPayload) => {
      if (cancelled) return;
      const savedRecord = canvasPayload.referral ?? null;
      const record = savedRecord;
      loadedReferralRef.current = record;
      setLoadedReferral(record);
      additionalFilesRef.current = [];
      setAdditionalFiles([]);
      if (record) {
        const identityTitle = formatClientIdentityTitle(record);
        recordRecentDestination({
          id: `referral:${record.id}`,
          kind: "referral",
          screen: "packet",
          title: identityTitle.slice(0, 200),
          detail: "Referral workspace",
          referralId: record.id,
          community: record.community,
        });
        setFields((current) => {
          const next = fieldsFromReferral(current, record);
          fieldsRef.current = next;
          return next;
        });
        ownerPrincipalIdRef.current = record.ownerId ?? "";
        setOwnerPrincipalId(record.ownerId ?? "");
        conservedRef.current = record.conserved ?? "";
        setConserved(record.conserved ?? "");
        const nextTags = workspaceTagsInput(record.tags);
        tagsInputRef.current = nextTags;
        setTagsInput(nextTags);
        const nextDocuments = documentsFromReferral(record);
        documentsRef.current = nextDocuments;
        setDocuments(nextDocuments);
        const nextPacketCategory = initialDocumentCategoryFromReferral(record);
        initialPacketCategoryRef.current = nextPacketCategory;
        setInitialPacketCategory(nextPacketCategory);
        const cleanKeys = new Set<DirtyDraftKey>();
        dirtyKeysRef.current = cleanKeys;
        setDirtyKeys(cleanKeys);
        clearDraftTracking();
        setRemoteChange(null);
        setExtractionConflict(null);
        setSavedAt("Workspace loaded");
        if (record.workspaceStatus === "historical") {
          setDraftRecoveryLoading(false);
          return;
        }
        const setters = {
          setFields,
          setConserved,
          setTagsInput,
          setDocuments,
          setInitialPacketCategory,
          setDirtyKeys,
          setRecoveredDraftAt,
          setRecoveredPacketName,
        };
        const finishRecovery = (recovered: CanvasSessionDraft | null) => {
          const recoveredConflicts = recovered ? buildRecoveredDraftConflicts(recovered, record) : [];
          if (recoveredConflicts.length > 0) {
            setRemoteChange({
              referral: record,
              updatedBy: record.updatedBy?.name || "Another user",
              conflicts: recoveredConflicts,
            });
          }
          if (recovered) setSavedAt("Restored edits · not yet saved");
        };
        if (serverDraftsEnabled) {
          setDraftRecoveryLoading(true);
          void loadIntakeRecovery(record.id)
            .then(({ draft, local }) => {
              if (cancelled) return;
              finishRecovery(draft ? restoreDraftTracking(applyRecoveryDraft(draft, setters)) : null);
              if (local) restoreLocalFiles(local);
            })
            .catch(() => {
              if (!cancelled) setSaveError("Could not check for a recovery draft.");
            })
            .finally(() => {
              if (!cancelled) setDraftRecoveryLoading(false);
            });
        } else {
          setDraftRecoveryLoading(false);
          finishRecovery(restoreDraftTracking(restoreSessionDraft(record.id, setters)));
        }
      } else {
        setDraftRecoveryLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setSaveError("Could not load the saved referral record.");
        setDraftRecoveryLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [newDraftKey, referral?.id, serverDraftsEnabled, restoreLocalFiles]);

  useEffect(() => {
    const packet = extraction?.packet;
    if (!packet) return;
    setLoadedReferral((current) => {
      if (!current || current.packetId !== packet.packet_id) return current;
      const known = new Map(current.packetFields?.map((field) => [field.field_key, field]) ?? []);
      const updates = packet.fields.filter((field) => !known.has(field.field_key) || (known.get(field.field_key)?.version ?? 0) < field.version);
      if (!updates.length) return current;
      for (const field of updates) known.set(field.field_key, field);
      const next = { ...current, packetFields: [...known.values()], packetReadiness: packet.ehr_readiness, packetCompleteness: packet.packet_completeness };
      loadedReferralRef.current = next;
      return next;
    });
  }, [extraction?.packet, loadedReferral?.packetFields]);

  useEffect(() => {
    const extractedFields = loadedReferral?.packetFields;
    const sourceFile = loadedReferral?.documentName;
    if (!referralDocumentAutofillEnabled || loadedReferral?.workspaceStatus === "historical" || !extractedFields?.length) return;

    setFields((current) => {
      const next = populateFormFromExtraction(
        current,
        extractedFields,
        sourceFile || "Uploaded packet",
        dirtyKeysRef.current,
      );
      if (next !== current) {
        const changed = persistedFieldKeys.filter((key) => (
          next[key].value !== current[key].value || next[key].sourceFile !== current[key].sourceFile
        ));
        const nextDirtyKeys = new Set(dirtyKeysRef.current);
        for (const key of changed) {
          if (!nextDirtyKeys.has(key)) {
            const base = loadedReferralRef.current;
            if (base && draftBaseVersionRef.current === undefined) draftBaseVersionRef.current = base.version;
            draftBaseValuesRef.current = {
              ...draftBaseValuesRef.current,
              [key]: referralBaseDraftValue(base, key),
            };
          }
          nextDirtyKeys.add(key);
        }
        if (changed.length > 0) draftRevisionRef.current += 1;
        dirtyKeysRef.current = nextDirtyKeys;
        setDirtyKeys(nextDirtyKeys);
        setSavedAt("Extracted values ready to save");
      }
      return next;
    });
  }, [loadedReferral?.documentName, loadedReferral?.packetFields, loadedReferral?.workspaceStatus]);

  useEffect(() => {
    const editTarget = chartEditTargetRef.current;
    const field = editTarget ?? (routedWorkspaceLocation.view === "intake" ? routedWorkspaceLocation.intakeField : undefined);
    if (!field || draftRecoveryLoading || activePage !== 1) return;
    if (!editTarget && locallyFocusedFieldRef.current === field) {
      locallyFocusedFieldRef.current = undefined;
      return;
    }
    if (field !== "conserved") lastFocusRef.current = field;
    const frame = window.requestAnimationFrame(() => {
      const cell = canvasRef.current?.querySelector<HTMLElement>(`[data-workspace-field="${field}"]`);
      if (editTarget) {
        chartEditTargetRef.current = null;
        cell?.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
      }
      cell?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePage, draftRecoveryLoading, newDraftKey, referral?.id, routedWorkspaceLocation.intakeField, routedWorkspaceLocation.view]);

  useEffect(() => {
    const target = chartReturnRef.current;
    if (activePage !== 3 || !target) return;
    // The chart and its supporting records render asynchronously. Wait briefly
    // for the same control, then return to it; otherwise stay at the chart top.
    let frame = 0;
    let attempts = 0;
    const restore = () => {
      const control = canvasRef.current?.querySelectorAll<HTMLElement>(`[data-chart-edit="${CSS.escape(target.label)}"]`)[Math.max(target.index, 0)];
      if (!control && attempts++ < 120) { frame = window.requestAnimationFrame(restore); return; }
      chartReturnRef.current = null;
      control?.scrollIntoView({ block: "center" });
      control?.focus({ preventScroll: true });
    };
    frame = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(frame);
  }, [activePage]);

  const receiveRemoteReferral = (latest: Referral, updatedBy?: string, force = false) => {
    const base = loadedReferralRef.current;
    if (!base || (latest.version ?? 1) <= (base.version ?? 1) || (isSavingRef.current && !force)) return;
    const dirty = dirtyKeysRef.current;
    const conflicts = buildRemoteFieldConflicts({
      base,
      latest,
      dirty,
      fields: fieldsRef.current,
      conserved: conservedRef.current,
      tags: tagsInputRef.current,
      documents: documentsRef.current,
      initialPacket: initialPacketRef.current,
    });

    setLoadedReferral(latest);
    loadedReferralRef.current = latest;
    setFields((current) => mergeRemoteReferralFields(current, latest, dirty));
    if (!dirty.has("conserved")) setConserved(latest.conserved ?? "");
    if (!dirty.has("owner")) setOwnerPrincipalId(latest.ownerId ?? "");
    if (!dirty.has("tags")) setTagsInput(workspaceTagsInput(latest.tags));
    if (!dirty.has("documents")) setDocuments(documentsFromReferral(latest));
    if (!dirty.has("initialPacket")) setInitialPacket(null);
    setRemoteChange((previous) => ({
      referral: latest,
      updatedBy: updatedBy?.trim() || latest.updatedBy?.name || "Another user",
      // A later unrelated update cannot resolve a conflict on the user's behalf.
      conflicts: [...conflicts, ...(previous?.conflicts ?? []).filter((conflict) =>
        dirty.has(conflict.key) && !conflicts.some((next) => next.key === conflict.key)
        && draftKeySignature(conflict.key, currentDraftValues(fieldsRef.current, conservedRef.current, tagsInputRef.current, documentsRef.current, initialPacketRef.current)) !== referralBaseDraftValue(latest, conflict.key)
      ).map((conflict) => ({ ...conflict, remoteValue: remoteDisplayValue(latest, conflict.key) }))],
    }));
    if (dirty.size === 0) setSavedAt(`Updated by ${updatedBy?.trim() || latest.updatedBy?.name || "another user"}`);
  };

  const applyConfirmedWorkflowReferral = (latest: Referral) => {
    loadedReferralRef.current = latest;
    setLoadedReferral(latest);
    setRemoteChange(null);
    setSavedAt("Workflow updated");
  };

  useEffect(() => {
    const referralId = editableReferralId;
    if (!referralId) return;
    let cancelled = false;
    let checking = false;

    const checkForChanges = async () => {
      const current = loadedReferralRef.current;
      if (cancelled || checking || !current) return;
      checking = true;
      try {
        const change = await fetchPipelineJson<ReferralChangeSnapshot>(
          `/api/referrals/${referralId}/changes?after=${current.version ?? 1}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        setPresence(dedupePresence(change.presence.filter((item) => !item.is_me)));
        if (change.changed) {
          const payload = await fetchPipelineJson<{ referral?: Referral }>(`/api/referrals/${referralId}`, { cache: "no-store" });
          if (!cancelled && payload.referral) receiveRemoteReferral(payload.referral, change.updated_by?.name);
        }
      } catch {
        // A missed poll is retried in three seconds; it never blocks local editing.
      } finally {
        checking = false;
      }
    };

    const refreshOnFocus = () => void checkForChanges();
    void checkForChanges();
    const interval = window.setInterval(checkForChanges, 3_000);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [editableReferralId]);

  useEffect(() => {
    const referralId = editableReferralId;
    if (!referralId) return;
    const leaseId = crypto.randomUUID();
    const section = presenceSection(activePage);
    let cancelled = false;

    const heartbeat = async () => {
      try {
        await fetchPipelineJson(`/api/referrals/${referralId}/presence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lease_id: leaseId, section }),
        });
      } catch {
        // Presence is advisory. Save/version checks remain authoritative.
      }
    };

    void heartbeat();
    const interval = window.setInterval(() => {
      if (!cancelled) void heartbeat();
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void fetchPipelineJson(`/api/referrals/${referralId}/presence`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lease_id: leaseId }),
      }).catch(() => undefined);
    };
  }, [activePage, editableReferralId]);

  const updateField = (key: FieldKey, value: string) => {
    setDismissedSuggestionKeys((current) => new Set(current).add(key));
    setSaveError("");
    setDuplicateReview((current) => duplicateIdentityFields.has(key) ? null : current);
    setSavedAt("Unsaved changes");
    markDirty(key);
    const next = { ...fieldsRef.current, [key]: { ...fieldsRef.current[key], value } };
    fieldsRef.current = next;
    setFields(next);
  };

  const acceptIntakeSuggestion = (key: FieldKey, suggestion: IntakeFieldSuggestion) => {
    if (permissionReadOnly || suggestion.conflicting || fieldsRef.current[key].value.trim() || dirtyKeysRef.current.has(key)) return;
    updateField(key, suggestion.value);
    const next = { ...fieldsRef.current, [key]: { ...fieldsRef.current[key], sourceFile: suggestion.fileName } };
    fieldsRef.current = next;
    setFields(next);
    commitIntakeCell(key);
    focusedCellRef.current = null;
  };

  const applyOwnerChange = (change: { principalId: string; displayName: string }, handoffReason = "") => {
    handoffReasonRef.current = handoffReason;
    ownerPrincipalIdRef.current = change.principalId;
    setOwnerPrincipalId(change.principalId);
    updateField("owner", change.displayName);
  };

  const attachAdditionalFiles = (files: LabeledReferralFile[]) => {
    if (permissionReadOnly || loadedReferralRef.current?.workspaceStatus === "historical" || !files.length) return;
    const error = validateReferralDocumentFiles(files.map(({ file }) => file));
    if (error) {
      setSaveError(error);
      return;
    }
    const next = [...additionalFilesRef.current, ...files];
    additionalFilesRef.current = next;
    setAdditionalFiles(next);
    files.forEach(({ file }) => intakeExtraction.start(file, `additional-${createMutationId()}`, loadedReferralRef.current?.id));
    markDirty("documents");
    setSaveError("");
    setSavedAt(loadedReferralRef.current ? "Uploading files..." : "Files queued with referral draft");
    if (loadedReferralRef.current) void queueFileUpload(async () => {
      const current = loadedReferralRef.current;
      if (!current) return;
      await uploadAdditionalFiles(current, files);
      if (Object.keys(pendingDocumentsRef.current).length === 0 && additionalFilesRef.current.length === 0) {
        dirtyKeysRef.current.delete("documents");
        setDirtyKeys(new Set(dirtyKeysRef.current));
      }
      setSavedAt("Files uploaded");
    }).catch((error) => setSaveError(error instanceof Error ? error.message : "File upload failed. Retry Save."));
  };

  const uploadAdditionalFiles = async (referral: Referral, files: LabeledReferralFile[]) => {
    if (!files.length) return referral;
    for (const entry of files) {
      const { file, category } = entry;
      setSavedAt(`Uploading ${file.name}...`);
      const result = await uploadReferralSupportingDocument(referral, file, category);
      if (!result.documents?.length) throw new Error(`${file.name} uploaded without a document record. Check the file list before retrying.`);
      const remaining = additionalFilesRef.current.filter((queued) => queued !== entry);
      additionalFilesRef.current = remaining;
      setAdditionalFiles(remaining);
      window.dispatchEvent(new CustomEvent("pipeline:documents-changed", { detail: { referralId: referral.id, refreshChart: false } }));
    }
    try {
      const refreshed = await fetchPipelineJson<{ referral?: Referral }>(`/api/referrals/${referral.id}/canvas`, { cache: "no-store" });
      if (!refreshed.referral) throw new Error("The chart refresh returned no referral.");
      const current = loadedReferralRef.current;
      const latest = current?.id === referral.id && (current.version ?? 1) > (refreshed.referral.version ?? 1)
        ? current : refreshed.referral;
      loadedReferralRef.current = latest;
      setLoadedReferral(latest);
      const nextDocuments = mergePendingDocumentNames(documentsFromReferral(latest), pendingDocumentsRef.current);
      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);
      setSaveAlert((alert) => alert === fileChartRefreshWarning ? "" : alert);
      return latest;
    } catch {
      setSaveAlert(fileChartRefreshWarning);
      return loadedReferralRef.current?.id === referral.id ? loadedReferralRef.current : referral;
    }
  };

  const retainQueuedAdditionalFileDraft = () => {
    if (additionalFilesRef.current.length) markDirty("documents");
  };

  const uploadAndLinkSupportingDocument = async (currentReferral: Referral, requirementId: string, file: File) => {
    const definition = [...requirements, ...attachments].find((item) => item.id === requirementId);
    if (!definition) return currentReferral;
    setUploadingDocumentIds((current) => new Set(current).add(requirementId));
    setSaveError("");
    setSavedAt(`Uploading ${definition.label}...`);
    try {
      let workingReferral = currentReferral;
      let workItem = workingReferral.requirements?.find((item) => item.type === definition.type);
      if (!workItem) {
        workingReferral = await persistExistingChanges(workingReferral, new Set(["documents"]));
        workItem = workingReferral.requirements?.find((item) => item.type === definition.type);
      }
      if (!workItem) throw new Error(`${definition.label} could not be linked to its requirement.`);

      const uploaded = await uploadReferralSupportingDocument(
        workingReferral,
        file,
        documentCategoryForRequirement(definition.type),
      );
      const document = uploaded.documents?.[0];
      if (!document) throw new Error("Pipeline uploaded the file but did not return its document record.");
      const refreshed = await fetchPipelineJson<{ referral?: Referral }>(`/api/referrals/${workingReferral.id}/canvas`, { cache: "no-store" });
      if (!refreshed.referral) throw new Error("The document was saved, but the refreshed referral was unavailable.");
      const linkedRequirement = refreshed.referral.requirements?.find((item) => item.type === definition.type);
      if (linkedRequirement?.evidenceDocumentId !== document.document_id) {
        throw new Error(`${definition.label} was stored, but its checklist item was not updated. Retry the upload.`);
      }
      loadedReferralRef.current = refreshed.referral;
      setLoadedReferral(refreshed.referral);
      const refreshedDocuments = mergePendingDocumentNames(
        documentsFromReferral(refreshed.referral),
        pendingDocumentsRef.current,
      );
      documentsRef.current = refreshedDocuments;
      setDocuments(refreshedDocuments);
      completeSupportingDocumentUpload(requirementId, file);
      setSavedAt(`${definition.label} uploaded`);
      return refreshed.referral;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : `Could not upload ${definition.label}.`);
      throw error;
    } finally {
      setUploadingDocumentIds((current) => {
        const next = new Set(current);
        next.delete(requirementId);
        return next;
      });
    }
  };

  const completeSupportingDocumentUpload = (requirementId: string, uploadedFile: File) => {
    if (pendingDocumentsRef.current[requirementId] !== uploadedFile) return;
    const nextPendingDocuments = { ...pendingDocumentsRef.current };
    delete nextPendingDocuments[requirementId];
    pendingDocumentsRef.current = nextPendingDocuments;
    setPendingDocuments(nextPendingDocuments);
    if (hasPendingDocumentUploads(nextPendingDocuments, additionalFilesRef.current)) return;
    const nextDirtyKeys = new Set(dirtyKeysRef.current);
    nextDirtyKeys.delete("documents");
    dirtyKeysRef.current = nextDirtyKeys;
    setDirtyKeys(nextDirtyKeys);
    const latest = loadedReferralRef.current;
    if (latest) rebaseDraftTracking(latest, nextDirtyKeys);
  };

  const selectInitialPacket = (file: File | undefined): InitialPacketSelectionResult => {
    const selection = validateInitialPacketSelection(file);
    if (!selection.accepted) {
      setSaveError(selection.error ?? "");
      return selection;
    }

    initialPacketRef.current = selection.file;
    setInitialPacket(selection.file);
    intakeExtraction.start(selection.file, "initial", loadedReferralRef.current?.id);
    markDirty("initialPacket");
    setSaveError("");
    setSavedAt("Unsaved changes");
    return selection;
  };

  const selectInitialFiles = (files: File[]): InitialPacketSelectionResult => {
    const selection = validateInitialPacketSelection(files[0]);
    if (!selection.accepted) return selection;
    selectInitialPacket(selection.file);
    if (loadedReferralRef.current) {
      void queueFileUpload(async () => {
        const current = loadedReferralRef.current;
        if (!current) return;
        const snapshot = captureReferralSaveSnapshot(new Set(["initialPacket"]), currentDraftValues(fieldsRef.current, conservedRef.current, tagsInputRef.current, documentsRef.current, selection.file), initialPacketCategoryRef.current, {});
        const hash = await resolveInitialDocumentHash(selection.file, current.documentHash, setSavedAt);
        const saved = await uploadAndLinkInitialPacket(current, snapshot, hash);
        await finishReferralSave(saved, snapshot, true);
      }).catch((error) => setSaveError(error instanceof Error ? error.message : "Packet upload failed. Retry the upload."));
    }
    return selection;
  };

  const addLabeledFiles = (files: LabeledReferralFile[]) => {
    if (permissionReadOnly || loadedReferralRef.current?.workspaceStatus === "historical") return;
    const invalid = validateReferralDocumentFiles(files.map(({ file }) => file));
    if (invalid) { setSaveError(invalid); return; }
    // Only establish a primary document when there isn't one already.
    const current = loadedReferralRef.current;
    const hasPacket = initialPacketRef.current || (current?.documentName && current.documentStatus !== "Missing");
    const primary = !hasPacket ? files.find(({ category }) => category === "face_sheet" || category === "referral_packet") : undefined;
    if (primary && (primary.category === "face_sheet" || primary.category === "referral_packet")) {
      initialPacketCategoryRef.current = primary.category;
      setInitialPacketCategory(primary.category);
      selectInitialFiles([primary.file]);
    }
    attachAdditionalFiles(files.filter((entry) => entry !== primary));
  };

  const removeQueuedFile = (file: File) => {
    if (permissionReadOnly || uploadingDocumentIds.size || isSavingRef.current) return;
    intakeExtraction.removeFile(file);
    if (initialPacketRef.current === file) {
      initialPacketRef.current = null;
      setInitialPacket(null);
      markDirty("initialPacket");
    }
    const pending = Object.fromEntries(Object.entries(pendingDocumentsRef.current).filter(([, queued]) => queued !== file));
    const names = Object.fromEntries(Object.entries(documentsRef.current).filter(([key]) => pendingDocumentsRef.current[key] !== file));
    pendingDocumentsRef.current = pending;
    setPendingDocuments(pending);
    documentsRef.current = names;
    setDocuments(names);
    additionalFilesRef.current = additionalFilesRef.current.filter((entry) => entry.file !== file);
    setAdditionalFiles(additionalFilesRef.current);
    markDirty("documents");
    setSavedAt("Unsaved changes");
  };

  const locationForPage = (page: WorkspaceView, editField?: ReferralChartEditField, assessmentMode?: "review" | null): PipelineWorkspaceLocation => (page === 1 && loadedReferralRef.current
      ? { view: "intake", intakeField: editField && editField !== "conserved" ? editField : "name" }
      : page === 2 ? { ...lastAssessmentLocationRef.current, view: "assessment", assessmentSection: lastAssessmentSectionRef.current, ...(assessmentMode !== undefined ? { assessmentMode: assessmentMode ?? undefined, assessmentDialog: undefined } : {}) }
      : workspaceLocationForPage(page));

  const openPage = (page: WorkspaceView, editField?: ReferralChartEditField, assessmentMode?: "review" | null) => {
    entryResolvedRef.current = true;
    if (emailSendingRef.current) return;
    if (page !== 2) setPreparingReferralId(null);
    setActivePage(page);
    chartEditTargetRef.current = editField ?? null;
    if (page !== 1 && page !== 3) chartReturnRef.current = null;
    const returningToChart = page === 3 && chartReturnRef.current !== null;
    if (typeof page === "number") onWorkspaceStageChange?.(workspaceStageName(page));
    onWorkspaceLocationChange?.(locationForPage(page, editField, assessmentMode));
    requestAnimationFrame(() => {
      if (!editField && !returningToChart) canvasRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const editReferralFieldFromChart = (field: ReferralChartEditField) => {
    const control = lastChartEditControlRef.current;
    lastChartEditControlRef.current = null;
    const label = control?.dataset.chartEdit;
    chartReturnRef.current = label && canvasRef.current?.contains(control)
      ? { label, index: [...canvasRef.current.querySelectorAll(`[data-chart-edit="${CSS.escape(label)}"]`)].indexOf(control!) }
      : null;
    void navigatePage(1, field);
  };

  const assessmentChartProps = () => ({
    chartReview: displayedPage === 3 || routedWorkspaceLocation.assessmentMode === "review",
    assessmentReview: displayedPage === 2 && routedWorkspaceLocation.assessmentMode === "review",
    chartActions: !permissionReadOnly && loadedReferral ? <button type="button" onClick={() => void navigatePage(1)} className="min-h-11 px-3 text-[13px] font-semibold text-[#08735e] underline-offset-4 hover:underline focus-visible:outline-2">Edit referral details</button> : undefined,
    onEditReferralField: !permissionReadOnly && loadedReferral ? editReferralFieldFromChart : undefined,
  });

  const navigatePage = async (page: WorkspaceView, editField?: ReferralChartEditField, assessmentMode?: "review" | null) => {
    entryResolvedRef.current = true;
    if ((page === activePage && !(page === 2 && routedWorkspaceLocation.assessmentMode === "review")) || emailSendingRef.current) return;
    try {
      await assessmentNavigationRef.current?.();
      if (activePage === 1 && loadedReferralRef.current) await preserveIntakeBeforeNavigation();
      if (assessmentMode === undefined && (activePage === 1 || activePage === 3) && page === 2 && hasReferralRecord(loadedReferralRef.current, referral?.id)) {
        await openQuestionnaireFromIntake();
      } else {
        openPage(page, editField, assessmentMode);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Your last changes could not be saved. Try again before leaving this page.");
    }
  };

  const focusWorkspaceField = (key: FieldKey) => {
    lastFocusRef.current = key;
    if (activePage === 1 && onWorkspaceLocationChange) {
      locallyFocusedFieldRef.current = key;
      onWorkspaceLocationChange({ view: "intake", intakeField: key });
    }
  };

  const persistExistingChanges = async (
    current: Referral,
    keys: ReadonlySet<DirtyDraftKey>,
    packet?: { file: File; hash: string },
    captured: { values: DraftValueSnapshot; ownerId: string; handoffReason: string } = {
      values: currentDraftValues(fieldsRef.current, conservedRef.current, tagsInputRef.current, documentsRef.current, initialPacketRef.current),
      ownerId: ownerPrincipalIdRef.current, handoffReason: handoffReasonRef.current,
    },
  ) => {
    const { values, ownerId, handoffReason } = captured;
    const tags = normalizeTags(values.tagsInput);
    const admissionRequirements = canvasAdmissionRequirements(current, values, ownerId);
    // Bound contention retries; a sustained collision remains an unsaved draft.
    for (let attempt = 0; ; attempt += 1) {
      const patch = buildCanvasPatch({
        keys,
        fields: values.fields,
        conserved: values.conserved,
        tags,
        requirements: admissionRequirements,
        existingFieldSources: current.fieldSources,
        packet,
      });
      if (Object.keys(patch).length === 0) return current;
      const ownerTouched = keys.has("owner");
      const mutationKey = canvasMutationKey(current.id, keys, values, packet?.hash, ownerId, handoffReason);
      const clientMutationId = patchMutationIdsRef.current.get(mutationKey) ?? createMutationId();
      patchMutationIdsRef.current.set(mutationKey, clientMutationId);
      let payload: { referral?: Referral; error?: string };
      try {
        payload = await fetchPipelineJson<{ referral?: Referral; error?: string }>(`/api/referrals/${current.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: canvasMutationBody(current, patch, clientMutationId, ownerTouched, ownerId, handoffReason),
        });
      } catch (error) {
        const latest = error instanceof PipelineApiError && error.status === 409 ? getConflictReferral(error.payload) : null;
        if (!latest || attempt >= 3 || !canRebaseReferralCanvasPatch(current, latest, patch)) throw error;
        // The 409 confirms this mutation was not applied. A new version gets a new
        // mutation ID; an uncertain network response keeps its original ID.
        patchMutationIdsRef.current.delete(mutationKey);
        current = latest;
        continue;
      }
      if (!payload.referral) throw new Error(payload.error ?? "Could not save this referral.");
      const saved = payload.referral;
      loadedReferralRef.current = saved;
      setLoadedReferral(saved);
      setFields((fields) => mergeRemoteReferralFields(fields, saved, dirtyKeysRef.current));
      setSaveError("");
      patchMutationIdsRef.current.delete(mutationKey);
      if (ownerTouched) acceptSavedOwner(saved, ownerId);
      return saved;
    }
  };

  const acceptSavedOwner = (saved: Referral, sentOwnerId: string) => {
    if (ownerPrincipalIdRef.current !== sentOwnerId) return;
    setOwnerPrincipalId(saved.ownerId ?? "");
    handoffReasonRef.current = "";
  };

  const queueIntakeSave = <T,>(save: () => Promise<T>): Promise<T> => {
    const next = intakeSaveQueueRef.current.then(save);
    intakeSaveQueueRef.current = next.catch(() => undefined);
    return next;
  };

  const queueFileUpload = <T,>(upload: () => Promise<T>): Promise<T> => {
    const key = `upload:${createMutationId()}`;
    setUploadingDocumentIds((current) => new Set(current).add(key));
    const next = fileUploadQueueRef.current.then(upload).finally(() => {
      setUploadingDocumentIds((current) => {
        const remaining = new Set(current);
        remaining.delete(key);
        return remaining;
      });
    });
    fileUploadQueueRef.current = next.catch(() => undefined);
    return next;
  };

  const commitIntakeCell = (key: DirtyDraftKey, resolvedConflict = false) => {
    const values = currentDraftValues(fieldsRef.current, conservedRef.current, tagsInputRef.current, documentsRef.current, null);
    const snapshot = captureReferralSaveSnapshot(new Set([key]), values, initialPacketCategoryRef.current, {});
    const captured = { values, ownerId: ownerPrincipalIdRef.current, handoffReason: handoffReasonRef.current };
    const referralId = loadedReferralRef.current?.id;
    const reference = recoveryDraftReferenceRef.current;
    const draft = captureRecoveryDraft();
    const conflicted = remoteChange?.conflicts.some((conflict) => conflict.key === key);
    if (conflicted && !resolvedConflict) return;
    void queueIntakeSave(async () => {
      if (reference !== recoveryDraftReferenceRef.current) return;
      setSavedAt("Saving changes...");
      if (trainingIntakeMode || !referralId) {
        if (!trainingIntakeMode && serverDraftsEnabled && draft) await saveServerReferralDraft(reference, draft);
        else persistRecoveryDraft(false);
        setSavedAt(trainingIntakeMode ? "Practice changes saved in this tab" : "Draft saved");
        return;
      }
      const current = loadedReferralRef.current;
      if (!current || current.id !== referralId) return;
      const saved = await persistExistingChanges(current, snapshot.dirtyKeys, undefined, captured);
      await finishReferralSave(saved, snapshot, true);
    }).catch((error) => {
      if (error instanceof PipelineApiError && error.status === 409) {
        const latest = getConflictReferral(error.payload);
        if (latest) receiveRemoteReferral(latest, latest.updatedBy?.name, true);
      }
      setSaveError(error instanceof Error ? error.message : "Could not save this field.");
      setSavedAt("Unsaved changes");
      void preservePendingIntake(false).catch(() => undefined);
    });
  };

  const focusIntakeCell = (event: FocusEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-workspace-field]");
    const key = cell?.dataset.workspaceField;
    if (!key || (!isPersistedFieldKey(key as DirtyDraftKey) && key !== "tags" && key !== "conserved")) return;
    if (focusedCellRef.current?.key === key) return;
    focusedCellRef.current = { key: key as DirtyDraftKey, signature: draftKeySignature(key as DirtyDraftKey, currentDraftValues(fieldsRef.current, conservedRef.current, tagsInputRef.current, documentsRef.current, null)) };
  };

  const blurIntakeCell = (event: FocusEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-workspace-field]");
    if (!cell || cell.contains(event.relatedTarget)) return;
    const focus = focusedCellRef.current;
    focusedCellRef.current = null;
    if (!focus || focus.key !== cell.dataset.workspaceField) return;
    const signature = draftKeySignature(focus.key, currentDraftValues(fieldsRef.current, conservedRef.current, tagsInputRef.current, documentsRef.current, null));
    if (signature !== focus.signature) commitIntakeCell(focus.key);
  };

  const persistReferralSave = async (
    snapshot: ReferralSaveSnapshot,
    community: PipelineCommunity,
    tags: string[],
    admissionRequirements: Referral["requirements"],
    documentHash: string | undefined,
    confirmedDistinctReferralIds: number[],
  ) => {
    const currentReferral = loadedReferralRef.current;
    const referralId = referral?.id ?? currentReferral?.id;
    if (referralId) {
      if (!currentReferral) throw new Error("Wait for the saved referral to finish loading before making changes.");
      const saved = await persistExistingChanges(
        currentReferral,
        snapshot.dirtyKeys,
        packetPatch(snapshot.initialPacket, documentHash),
      );
      return { referral: saved, created: false };
    }

    const owner = fieldsRef.current.owner.value.trim() || "Unassigned";
    const createdReferral: ReferralCreateInput = buildReferralCanvasCreateInput({
      fields: fieldsRef.current,
      conserved: conservedRef.current,
      community,
      tags: referralCreateTags(tags, owner, community),
      requirements: admissionRequirements,
      createdAt: new Date().toISOString(),
      ...initialDocumentInput(snapshot.initialPacket, documentHash),
    });
    const payload = await fetchPipelineJson<{ referral?: Referral; error?: string; idempotent_replay?: boolean; warnings?: string[] }>("/api/referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referral: createdReferral,
        client_mutation_id: creationMutationIdRef.current,
        ...(ownerPrincipalIdRef.current ? { assignee_id: ownerPrincipalIdRef.current } : {}),
        ...(confirmedDistinctReferralIds.length > 0
          ? { duplicate_confirmation: { referral_ids: confirmedDistinctReferralIds } }
          : {}),
      }),
    });
    if (!payload.referral) throw new Error(payload.error ?? "Could not save this referral workspace.");
    setSaveAlert(payload.warnings?.join(" ") ?? "");
    const saved = await mergeIdempotentCreateReplay(payload.referral, payload.idempotent_replay, snapshot, documentHash);
    return { referral: saved, created: true };
  };

  const mergeIdempotentCreateReplay = async (
    savedReferral: Referral,
    replayed: boolean | undefined,
    snapshot: ReferralSaveSnapshot,
    documentHash: string | undefined,
  ) => {
    if (!replayed || snapshot.dirtyKeys.size === 0) return savedReferral;
    loadedReferralRef.current = savedReferral;
    return persistExistingChanges(
      savedReferral,
      snapshot.dirtyKeys,
      packetPatch(snapshot.initialPacket, documentHash),
    );
  };

  const uploadAndLinkInitialPacket = async (
    currentReferral: Referral,
    snapshot: ReferralSaveSnapshot,
    documentHash: string | undefined,
  ) => {
    const packet = snapshot.initialPacket;
    if (!packet || !documentHash) return currentReferral;
    setSavedAt("Uploading packet...");
    const upload = await uploadReferralPacket(currentReferral, packet, documentHash, snapshot.initialPacketCategory);
    const refreshedWorkspace = await fetchPipelineJson<{ referral?: Referral }>(`/api/referrals/${currentReferral.id}/canvas`, { cache: "no-store" });
    if (!refreshedWorkspace.referral) throw new Error("The document was saved, but the referral workspace could not be refreshed.");
    assertInitialDocumentLinked(refreshedWorkspace.referral, snapshot.initialPacketCategory, upload.document?.document_id);
    loadedReferralRef.current = refreshedWorkspace.referral;
    setLoadedReferral(refreshedWorkspace.referral);
    const refreshedDocuments = mergePendingDocumentNames(
      documentsFromReferral(refreshedWorkspace.referral),
      pendingDocumentsRef.current,
    );
    documentsRef.current = refreshedDocuments;
    setDocuments(refreshedDocuments);
    setSavedAt("Saving document...");
    const extractedForm = upload.fields
      ? populateFormFromExtraction(fieldsRef.current, upload.fields.fields, packet.name, dirtyKeysRef.current)
      : fieldsRef.current;
    const extractedKeys = changedExtractionKeys(fieldsRef.current, extractedForm, dirtyKeysRef.current);
    const extractedPatch = buildReferralCanvasPatch({
      keys: extractedKeys,
      fields: extractedForm,
      conserved: conservedRef.current,
      tags: normalizeTags(tagsInputRef.current),
      requirements: refreshedWorkspace.referral.requirements ?? [],
      existingFieldSources: refreshedWorkspace.referral.fieldSources,
    });
    const linkMutationKey = JSON.stringify(["packet-link", currentReferral.id, refreshedWorkspace.referral.version, upload.packetId, extractedPatch]);
    const linkMutationId = patchMutationIdsRef.current.get(linkMutationKey) ?? createMutationId();
    patchMutationIdsRef.current.set(linkMutationKey, linkMutationId);
    const linkedPayload = await fetchPipelineJson<{ referral?: Referral; error?: string }>(`/api/referrals/${currentReferral.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        if_match: refreshedWorkspace.referral.version,
        if_match_sections: normalizeReferralSectionVersions(refreshedWorkspace.referral.sectionVersions),
        client_mutation_id: linkMutationId,
        patch: {
          ...extractedPatch,
          documentName: packet.name,
          documentSizeBytes: packet.size,
          documentHash,
          documentStatus: "Uploaded",
          packetId: upload.packetId,
          packetStatus: upload.status,
          packetFields: upload.fields?.fields,
          packetReadiness: upload.fields?.ehr_readiness,
          packetCompleteness: upload.fields?.packet_completeness,
          packetMessage: packetUploadStatusMessage(upload.mock, upload.pageCount),
        },
      }),
    });
    if (!linkedPayload.referral) throw new Error(linkedPayload.error ?? "Could not link the packet to this referral.");
    patchMutationIdsRef.current.delete(linkMutationKey);
    loadedReferralRef.current = linkedPayload.referral;
    setLoadedReferral(linkedPayload.referral);
    setFields((current) => {
      const next = mergeExtractedFields(current, extractedForm, extractedKeys, dirtyKeysRef.current);
      fieldsRef.current = next;
      return next;
    });
    if (initialPacketRef.current === packet) {
      initialPacketRef.current = null;
      setInitialPacket(null);
    }
    return linkedPayload.referral;
  };

  const finishReferralSave = async (savedReferral: Referral, snapshot: ReferralSaveSnapshot, preserveConflicts = false) => {
    const remainingDirtyKeys = reconcileSavedDirtyKeys(
      dirtyKeysRef.current,
      snapshot,
      currentDraftValues(fieldsRef.current, conservedRef.current, tagsInputRef.current, documentsRef.current, initialPacketRef.current),
      !hasPendingDocumentUploads(pendingDocumentsRef.current, additionalFilesRef.current),
    );
    dirtyKeysRef.current = remainingDirtyKeys;
    setDirtyKeys(remainingDirtyKeys);
    setFields((current) => mergeRemoteReferralFields(current, savedReferral, remainingDirtyKeys));
    rebaseDraftTracking(savedReferral, remainingDirtyKeys, snapshot.dirtyKeys);
    if (remainingDirtyKeys.size === 0) await clearSessionDraft(savedReferral.id);
    setRecoveredDraftAt("");
    setRecoveredPacketName("");
    if (!preserveConflicts) setRemoteChange(null);
    setSavedAt(referralSaveStatus(remainingDirtyKeys.size, Boolean(snapshot.initialPacket)));
  };

  const completeCreationHandoff = () => {
    if (!creationHandoffPendingRef.current) return;
    creationHandoffPendingRef.current = false;
    openPage(3);
    setShowCreationHandoff(true);
  };

  const assessmentEntryProps = () => ({
    startQuestionnaire: preparingReferralId === referralWorkspaceId || Boolean(assessmentEntryAction),
    scheduleRequested: scheduleRequested || assessmentEntryAction === "schedule",
    onScheduleRequestHandled: () => { setScheduleRequested(false); onAssessmentEntryHandled?.(); },
    beginRequested: assessmentEntryAction === "begin",
    onBeginRequestHandled: onAssessmentEntryHandled,
  });

  const saveDraft = async (confirmedDistinctReferralIds: number[] = []): Promise<Referral | null> => {
    setSaveError("");
    const blockedMessage = referralSaveBlockedMessage(uploadingDocumentIds.size, Boolean(remoteChange?.conflicts.length));
    if (blockedMessage) {
      setSaveError(blockedMessage);
      return null;
    }
    setIsSaving(true);
    isSavingRef.current = true;
    const snapshot = captureReferralSaveSnapshot(
      dirtyKeysRef.current,
      currentDraftValues(fieldsRef.current, conservedRef.current, tagsInputRef.current, documentsRef.current, initialPacketRef.current),
      initialPacketCategory,
      pendingDocumentsRef.current,
    );
    const additionalFilesSnapshot = [...additionalFilesRef.current];
    let savedReferral = loadedReferralRef.current;
    try {
      const tags = normalizeTags(tagsInputRef.current);
      const community = resolveDraftCommunity(
        fieldsRef.current.community.value,
        loadedReferralRef.current?.community ?? referral?.community,
      );
      const admissionRequirements = createDefaultAdmissionRequirements(
        loadedReferralRef.current?.requirements ?? [],
        getEvidenceByType(documentsRef.current),
        new Date().toISOString(),
        fieldsRef.current.owner.value.trim() || "Unassigned",
        ownerPrincipalIdRef.current || undefined,
        {
          date_of_birth: fieldsRef.current.dob.value,
          community,
          referral_source: fieldsRef.current.referent.value,
        },
      );
      const documentHash = await resolveInitialDocumentHash(snapshot.initialPacket, loadedReferralRef.current?.documentHash, setSavedAt);
      const persisted = await persistReferralSave(
        snapshot,
        community,
        tags,
        admissionRequirements,
        documentHash,
        confirmedDistinctReferralIds,
      );
      savedReferral = persisted.referral;
      loadedReferralRef.current = savedReferral;
      setLoadedReferral(savedReferral);
      if (persisted.created) {
        creationHandoffPendingRef.current = true;
        setCreatedWorkspaceId(savedReferral.id);
        recoveryDraftReferenceRef.current = savedReferral.id;
        onReferralSaved?.({ id: savedReferral.id, name: savedReferral.name, community: savedReferral.community });
        void preservePendingIntake().then(() => clearSessionDraft(newDraftKey)).catch(() => undefined);
        setSavedAt(snapshot.initialPacket ? "Referral created; uploading packet..." : "Referral created");
      }
      savedReferral = await uploadAndLinkInitialPacket(savedReferral, snapshot, documentHash);
      for (const [requirementId, file] of Object.entries(snapshot.pendingDocuments)) {
        savedReferral = await uploadAndLinkSupportingDocument(savedReferral, requirementId, file);
      }
      savedReferral = await uploadAdditionalFiles(savedReferral, additionalFilesSnapshot);
      await finishReferralSave(savedReferral, snapshot);
      retainQueuedAdditionalFileDraft();
      completeCreationHandoff();
      return savedReferral;
    } catch (error) {
      let latestConflict: Referral | null = null;
      if (error instanceof PipelineApiError && error.status === 409) {
        const suspectedDuplicate = getSuspectedDuplicateReview(error.payload);
        if (suspectedDuplicate) {
          setDuplicateReview(suspectedDuplicate);
          setSavedAt("Review possible duplicate");
          return null;
        }
        latestConflict = getConflictReferral(error.payload);
        if (latestConflict) receiveRemoteReferral(latestConflict, latestConflict.updatedBy?.name, true);
      }
      if (!latestConflict && savedReferral) setLoadedReferral(savedReferral);
      setSaveError(error instanceof Error ? error.message : "Could not save this referral workspace.");
      void preservePendingIntake().catch(() => undefined);
      setSavedAt(intakeSaveFailureStatus(error));
      return null;
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const saveWorkspaceDraft = (confirmedDistinctReferralIds: number[] = []): Promise<Referral | null> => queueIntakeSave(async () => {
    if (isSavingRef.current) return null;
    setCreatedWorkspaceId(null);
    setSavedAt(loadedReferralRef.current ? "Saving changes..." : "Creating referral...");
    if (!trainingIntakeMode) return saveDraft(confirmedDistinctReferralIds);
    setSaveError("");
    setSavedAt("Practice changes saved in this tab");
    return null;
  });

  const openAssignedWork = async () => {
    if (!onOpenAssignedWork || emailSendingRef.current) return;
    await handoff.flush();
    await assessmentNavigationRef.current?.();
    await preserveIntakeBeforeNavigation();
    onOpenAssignedWork();
  };

  const openClientProfile = (clientId: string) => {
    void (async () => {
      try {
        await beforeNavigationRef.current?.();
        onOpenProfile(clientId);
      } catch {
        // The active editor keeps its working copy open and explains the failure.
      }
    })();
  };

  usePersonaSwitchSave(async () => {
    if (emailSendingRef.current) throw new Error("Wait for the email delivery result before switching.");
    if (isSavingRef.current || uploadingDocumentIds.size > 0) throw new Error("Wait for the workspace and files to finish saving before switching.");
    const pending = workspaceHasPendingChanges(dirtyKeysRef.current, pendingDocumentsRef.current, initialPacketRef.current);
    if (pending && !await saveWorkspaceDraft()) throw new Error("Finish saving this intake before switching accounts.");
  });

  const openQuestionnaireFromIntake = async () => {
    const id = activeReferralId(loadedReferralRef.current, referral);
    if (!id) return;
    await preservePendingIntake();
    await intakeSaveQueueRef.current;
    setPreparingReferralId(id);
    openPage(2);
  };

  const continueToAssessment = async () => {
    if (trainingIntakeMode) {
      window.location.assign(toPipelinePath("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=prepare&demo=1"));
      return;
    }
    await openQuestionnaireFromIntake();
  };

  const continueCreatedWorkspace = async (schedule: boolean) => {
    try {
      await openQuestionnaireFromIntake();
      setScheduleRequested(schedule);
      setShowCreationHandoff(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not open assessment preparation. Please try again.");
    }
  };

  const reviewExtractedField = async (
    extractedField: ExtractedField,
    action: "accept" | "edit",
    correctedValue?: string,
    allowManualOverride = true,
  ) => {
    if (!loadedReferral?.packetId || !loadedReferral.packetFields) {
      setSaveError("Wait for the packet to finish uploading and extracting before reviewing its values.");
      return;
    }

    setSaveError("");
    setReviewBusyFieldKey(extractedField.field_key);
    let fieldReviewSaved = false;
    try {
      const result = await fetchPipelineJson<PacketFieldReviewResult>(
        `/api/packets/${encodeURIComponent(loadedReferral.packetId)}/fields/${encodeURIComponent(extractedField.field_key)}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            if_match: extractedField.version,
            action,
            ...(action === "edit" ? { value: correctedValue } : {}),
          }),
        },
      );
      fieldReviewSaved = true;

      const currentPacket = result.packet_fields ?? await fetchPipelineJson<PacketFieldsResponse>(
          `/api/packets/${encodeURIComponent(loadedReferral.packetId)}/fields`,
          { cache: "no-store" },
        ).catch(() => null);
      const packetFields = reviewedPacketFields(loadedReferral.packetFields, result, currentPacket);
      const {
        mappedFieldKeys,
        mappedFields,
        referralPatch,
        currentReferral,
      } = prepareReviewedExtraction({
        fieldKey: extractedField.field_key,
        packetFields,
        currentPacket,
        currentFields: fieldsRef.current,
        dirtyKeys: dirtyKeysRef.current,
        allowManualOverride,
        documentName: loadedReferral.documentName || "Uploaded packet",
        requirements: loadedReferral.requirements ?? [],
        conserved: conservedRef.current,
        tags: normalizeTags(tagsInputRef.current),
        projectionWasServerOwned: result.projection_status === "synchronized" && Boolean(result.referral),
        currentReferral: result.referral ?? loadedReferralRef.current ?? loadedReferral,
      });
      if (Object.keys(referralPatch).length === 0) {
        loadedReferralRef.current = currentReferral;
        setLoadedReferral(currentReferral);
        applyReviewedExtraction(mappedFieldKeys, mappedFields, currentReferral);
        setExtractionConflict(null);
        setSavedAt(action === "edit" ? "Correction saved" : "Extracted value confirmed");
        return;
      }
      const touchedSections = getReferralPatchSections(referralPatch as Record<string, unknown>);
      const expectedSections = normalizeReferralSectionVersions(currentReferral.sectionVersions);
      const reviewMutationKey = JSON.stringify(["extraction-review", currentReferral.id, currentReferral.version, referralPatch]);
      const reviewMutationId = patchMutationIdsRef.current.get(reviewMutationKey) ?? createMutationId();
      patchMutationIdsRef.current.set(reviewMutationKey, reviewMutationId);

      const payload = await fetchPipelineJson<{ referral?: Referral; error?: string }>(
        `/api/referrals/${currentReferral.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            if_match: currentReferral.version,
            if_match_sections: Object.fromEntries(
              touchedSections.map((section) => [section, expectedSections[section]]),
            ),
            client_mutation_id: reviewMutationId,
            patch: referralPatch,
          }),
        },
      );
      if (!payload.referral) throw new Error(payload.error ?? "The reviewed value could not be linked to this referral.");
      patchMutationIdsRef.current.delete(reviewMutationKey);

      loadedReferralRef.current = payload.referral;
      setLoadedReferral(payload.referral);
      applyReviewedExtraction(mappedFieldKeys, mappedFields, payload.referral);
      setExtractionConflict(null);
      setSavedAt(action === "edit" ? "Correction saved" : "Extracted value confirmed");
    } catch (error) {
      if (shouldReloadExtractionConflict(error, fieldReviewSaved)) {
        const latestPacket = await fetchPipelineJson<PacketFieldsResponse>(
          `/api/packets/${encodeURIComponent(loadedReferral.packetId)}/fields`,
          { cache: "no-store" },
        ).catch(() => null);
        const latestField = latestPacket?.fields.find((field) => field.field_key === extractedField.field_key);
        if (latestPacket && latestField) {
          setLoadedReferral((current) => current ? {
            ...current,
            packetFields: latestPacket.fields,
            packetReadiness: latestPacket.ehr_readiness,
            packetCompleteness: latestPacket.packet_completeness,
          } : current);
          setExtractionConflict({
            field: latestField,
            attemptedValue: action === "edit"
              ? correctedValue ?? ""
              : extractedField.final_value ?? extractedField.proposed_value ?? "",
            latestValue: latestField.final_value ?? latestField.proposed_value ?? "",
          });
        }
      } else if (error instanceof PipelineApiError && error.status === 409) {
        const latest = getConflictReferral(error.payload);
        if (latest) receiveRemoteReferral(latest, latest.updatedBy?.name, true);
      }
      setSaveError(error instanceof Error ? error.message : "The extracted value could not be reviewed.");
      throw error;
    } finally {
      setReviewBusyFieldKey(undefined);
    }
  };

  const applyReviewedExtraction = (
    mappedFieldKeys: ReadonlySet<PersistedFieldKey>,
    mappedFields: Record<FieldKey, PacketField>,
    latest: Referral,
  ) => {
    if (mappedFieldKeys.size === 0) return;
    setFields((current) => {
      const next = { ...current };
      for (const key of mappedFieldKeys) next[key] = mappedFields[key];
      return next;
    });
    const nextDirtyKeys = new Set(dirtyKeysRef.current);
    for (const key of mappedFieldKeys) nextDirtyKeys.delete(key);
    dirtyKeysRef.current = nextDirtyKeys;
    setDirtyKeys(nextDirtyKeys);
    rebaseDraftTracking(latest, nextDirtyKeys);
  };

  const acceptExtractedFields = async (extractedFields: ExtractedField[]) => {
    if (extractedFields.length === 0) return;
    setIsBulkReviewing(true);
    setSaveError("");
    try {
      for (const extractedField of extractedFields) {
        await reviewExtractedField(extractedField, "accept", undefined, false);
      }
      setSavedAt(`${extractedFields.length} extracted values confirmed`);
    } finally {
      setIsBulkReviewing(false);
    }
  };

  const resolveRemoteConflict = (conflict: RemoteFieldConflict, useLatest: boolean) => {
    const latest = remoteChange?.referral;
    if (!latest) return;
    const remainingConflicts = remoteChange.conflicts.filter((item) => item.key !== conflict.key);
    const nextDirtyKeys = new Set(dirtyKeysRef.current);
    if (useLatest) {
      applyLatestConflictValue(conflict.key, latest);
      nextDirtyKeys.delete(conflict.key);
      delete draftBaseValuesRef.current[conflict.key];
    } else {
      draftBaseValuesRef.current = {
        ...draftBaseValuesRef.current,
        [conflict.key]: referralBaseDraftValue(latest, conflict.key),
      };
    }
    dirtyKeysRef.current = nextDirtyKeys;
    setDirtyKeys(nextDirtyKeys);
    if (remainingConflicts.length === 0) rebaseDraftTracking(latest, nextDirtyKeys);
    setRemoteChange({
      ...remoteChange,
      conflicts: remainingConflicts,
    });
    if (!useLatest) commitIntakeCell(conflict.key, true);
  };

  const applyLatestConflictValue = (key: DirtyDraftKey, latest: Referral) => {
    if (isPersistedFieldKey(key)) {
      setFields((current) => {
        const next = {
          ...current,
          [key]: {
            ...current[key],
            value: referralDraftValue(latest, key),
            sourceFile: latest.fieldSources?.[key],
          },
        };
        fieldsRef.current = next;
        return next;
      });
      if (key === "owner") {
        ownerPrincipalIdRef.current = latest.ownerId ?? "";
        setOwnerPrincipalId(latest.ownerId ?? "");
      }
      return;
    }
    if (key === "tags") {
      const nextTags = workspaceTagsInput(latest.tags);
      tagsInputRef.current = nextTags;
      setTagsInput(nextTags);
      return;
    }
    if (key === "documents") {
      const nextDocuments = documentsFromReferral(latest);
      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);
      return;
    }
    if (key === "conserved") {
      const nextConserved = latest.conserved ?? "";
      conservedRef.current = nextConserved;
      setConserved(nextConserved);
      return;
    }
    initialPacketRef.current = null;
    setInitialPacket(null);
  };

  const discardRecoveredDraft = () => {
    const current = loadedReferralRef.current;
    if (current) {
      const restoredFields = fieldsFromReferral(fieldsRef.current, current);
      const restoredTags = workspaceTagsInput(current.tags);
      const restoredDocuments = documentsFromReferral(current);
      const restoredCategory = initialDocumentCategoryFromReferral(current);
      fieldsRef.current = restoredFields;
      setFields(restoredFields);
      conservedRef.current = current.conserved ?? "";
      setConserved(current.conserved ?? "");
      tagsInputRef.current = restoredTags;
      setTagsInput(restoredTags);
      documentsRef.current = restoredDocuments;
      setDocuments(restoredDocuments);
      initialPacketCategoryRef.current = restoredCategory;
      setInitialPacketCategory(restoredCategory);
    } else {
      const restoredFields = { ...initialFields, name: { ...initialFields.name, value: referral?.name ?? "" }, referralReceived: { ...initialFields.referralReceived, value: calendarToday() } };
      fieldsRef.current = restoredFields;
      setFields(restoredFields);
      conservedRef.current = "";
      setConserved("");
      tagsInputRef.current = "";
      setTagsInput("");
      documentsRef.current = {};
      setDocuments({});
      initialPacketCategoryRef.current = "face_sheet";
      setInitialPacketCategory("face_sheet");
    }
    initialPacketRef.current = null;
    setInitialPacket(null);
    const cleanKeys = new Set<DirtyDraftKey>();
    dirtyKeysRef.current = cleanKeys;
    setDirtyKeys(cleanKeys);
    clearDraftTracking();
    setRemoteChange(null);
    setRecoveredDraftAt("");
    setRecoveredPacketName("");
    void clearSessionDraft(current?.id ?? referral?.id ?? newDraftKey);
    setSavedAt(current ? "Saved chart kept; unsaved edits discarded" : "Unfinished intake cleared");
  };

  const fieldCount = countCompleteFields(fields, visibleChartFieldKeys);
  const admissionDocumentCount = requirements.filter((requirement) => Boolean(documents[requirement.id])).length;
  const attachmentCount = attachments.filter((attachment) => Boolean(documents[attachment.id])).length;
  const workspaceTitle = formatClientIdentityTitle({
    name: loadedReferral?.name?.trim()
      || referral?.name?.trim()
      || fields.name.value.trim()
      || "New referral",
    gender: loadedReferral?.gender || fields.gender.value,
    community: loadedReferral?.community || referral?.community || fields.community.value,
    referralId: loadedReferral?.id ?? referral?.id,
  });
  const workspacePresentation = getWorkspacePresentation(
    loadedReferral,
    admissionDocumentCount,
    attachmentCount,
    permissionReadOnly,
  );
  const { readOnly, historicalReadOnly, steps } = workspacePresentation;
  const workspaceSteps = trainingAssessmentMode
    ? savedWorkspaceSteps.filter((step) => step.page !== "workflow" && step.page !== "email")
    : workspacePresentation.usesSourceProfile && !historicalReadOnly
      ? [...steps, savedWorkspaceSteps[3]] : steps;
  const navigableWorkspaceSteps: ReadonlyArray<WorkspaceStep> = loadedReferral?.chartSource && !historicalReadOnly
    ? [{ page: 1, label: "Intake" }, ...workspaceSteps]
    : workspaceSteps;
  const chartPage = workspacePresentation.usesSourceProfile || historicalReadOnly ? 1 : 3;
  const displayedPage = visibleWorkspacePage(activePage, navigableWorkspaceSteps);
  const readingAssessment = (displayedPage === 2 || displayedPage === 3) && !historicalReadOnly;
  const editingControlsVisible = showWorkspaceEditingControls(trainingAssessmentMode, readOnly);
  const trashControlVisible = showWorkspaceTrashControl(loadedReferral, canSupervise, readOnly);
  const referralContextPacketFields = (loadedReferral?.packetFields ?? []).filter(
    (field) => extractedCanvasFieldKeys(field.field_key).length > 0,
  );
  const intakeSuggestions = intakePreviewSuggestions(fields, intakeExtraction.previews, new Set([...dirtyKeys, ...dismissedSuggestionKeys]));
  const suggestionCount = visibleChartFieldKeys.filter((key) => intakeSuggestions[key] && !intakeSuggestions[key]?.conflicting).length;
  const packetEvidenceVersion = referralPacketEvidenceVersion(loadedReferral);
  const hasPendingWorkspaceChanges = workspaceHasPendingChanges(dirtyKeys, pendingDocuments, initialPacket) || additionalFiles.length > 0;
  const hasReferral = hasReferralRecord(loadedReferral, referral?.id);
  const queuedFileCount = Object.keys(pendingDocuments).length + Number(Boolean(initialPacket)) + additionalFiles.length;
  const saveStatus = referralDraftSaveStatus(savedAt, hasReferral, queuedFileCount);

  const moveWorkspaceToTrash = async () => {
    const current = loadedReferralRef.current;
    if (!current) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      await Promise.allSettled([intakeSaveQueueRef.current, fileUploadQueueRef.current]);
      const latest = await fetchPipelineJson<{ referral: Referral }>(`/api/referrals/${current.id}`, { cache: "no-store" });
      await fetchPipelineJson(`/api/referrals/${current.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_match: latest.referral.version, client_mutation_id: deleteMutationIdRef.current }),
      });
      await clearSessionDraft(current.id);
      setDeleteDialogOpen(false);
      onReferralDeleted?.();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "The workspace could not be moved to trash.");
    } finally {
      setIsDeleting(false);
    }
  };

  const renderRestoredEdits = () => (
    recoveredDraftAt ? (
          <section aria-label="Restored edits" className="mb-3 flex flex-wrap items-center justify-between gap-3 border-l-2 border-[#0f8b73] bg-[#effaf5] px-4 py-3" aria-live="polite">
            <div>
              <div className="text-[12px] font-black text-[#174f43]">
                Unfinished edits restored
              </div>
              <div className="mt-1 text-[11px] text-[#3c665d]">
                {hasReferral
                  ? "These edits are back in the form, but aren't saved to the chart yet."
                  : "Continue intake, then choose Create referral when you're ready."}
                {recoveredPacketName ? <span className="block">Re-select {recoveredPacketName} before uploading the packet.</span> : null}
              </div>
            </div>
            <button type="button" onClick={discardRecoveredDraft} className="h-8 border border-[#0f8b73] px-3 text-[10px] font-black text-[#174f43] hover:bg-white">
              Discard unsaved edits
            </button>
          </section>
        ) : null
  );

  const renderWorkspaceConflicts = () => (
    remoteChange && remoteChange.conflicts.length > 0 ? (
          <section aria-label="Remote changes" className="mb-3 border border-[#d5b75b] bg-[#fffbe8] px-4 py-3" aria-live="assertive">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-black text-[#4e451d]">{remoteChange.updatedBy} updated this referral.</div>
                <div className="mt-1 text-[11px] leading-5 text-[#6a6031]">
                  Choose which value to keep for the fields changed in both sessions.
                </div>
              </div>
            </div>
            {remoteChange.conflicts.length > 0 ? (
              <div className="mt-3 divide-y divide-[#dfd39c] border-y border-[#dfd39c]">
                {remoteChange.conflicts.map((conflict) => (
                  <div key={conflict.key} className="grid gap-3 py-3 md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                    <div className="text-[11px] font-black text-[#111111]">{conflict.label}</div>
                    <div className="min-w-0">
                      <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#737373]">Your draft</div>
                      <div className="mt-1 break-words text-[11px] text-[#303638]">{conflict.localValue || "Empty"}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#737373]">Latest saved</div>
                      <div className="mt-1 break-words text-[11px] text-[#303638]">{conflict.remoteValue || "Empty"}</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => resolveRemoteConflict(conflict, false)} className="h-8 border border-[#111111] px-3 text-[10px] font-black hover:bg-white">Keep mine</button>
                      <button type="button" onClick={() => resolveRemoteConflict(conflict, true)} className="h-8 bg-[#111111] px-3 text-[10px] font-black text-white hover:bg-[#0f8b73]">Use latest</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null
  );

  const renderExtractionConflict = () => (
    extractionConflict ? (
          <section aria-label="Extracted field conflict" className="mb-3 border border-[#d4a39d] bg-[#f7faf9] px-4 py-3" aria-live="assertive">
            <div className="text-[12px] font-black text-[#7c3229]">This extracted field was reviewed in another session.</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><span className="text-[9px] font-black uppercase text-[#737373]">Your value</span><div className="mt-1 text-[11px]">{extractionConflict.attemptedValue || "Empty"}</div></div>
              <div><span className="text-[9px] font-black uppercase text-[#737373]">Latest saved</span><div className="mt-1 text-[11px]">{extractionConflict.latestValue || "Empty"}</div></div>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setExtractionConflict(null)} className="h-8 border border-[#7c3229] px-3 text-[10px] font-black text-[#7c3229]">Use latest</button>
              <button
                type="button"
                onClick={() => void reviewExtractedField(extractionConflict.field, "edit", extractionConflict.attemptedValue).catch(() => undefined)}
                className="h-8 bg-[#7c3229] px-3 text-[10px] font-black text-white"
              >
                Apply mine
              </button>
            </div>
          </section>
        ) : null
  );

  const renderWorkspaceSyncStatus = () => remoteChange && remoteChange.conflicts.length === 0 ? (
    <span role="status" data-testid="workspace-sync-status" className={workspaceFolderStyles.syncStatus} title={`Changes from ${remoteChange.updatedBy} were merged into your open draft.`}>
      <CheckCircle2 size={16} aria-hidden="true" />
      <span className="sr-only">Changes from {remoteChange.updatedBy} were merged into your open draft.</span>
    </span>
  ) : null;

  const renderWorkspaceActions = () => (
            <div className={workspaceFolderStyles.actions}>
              {renderWorkspaceSyncStatus()}
              <StartReferralFromChart
                sourceReferralId={loadedReferral?.id}
                allowed={Boolean(loadedReferral?.clientId && isImportedWorkspace(loadedReferral) && !loadedReferral.chartSource && !trainingAssessmentMode && !trainingIntakeMode)}
                inFolder
                beforeStart={async () => {
                  if (emailSendingRef.current) throw new Error("Wait for the email delivery result before starting an intake.");
                  await handoff.flush();
                  await assessmentNavigationRef.current?.();
                  await preservePendingIntake();
                  await intakeSaveQueueRef.current;
                }}
              />
              {!readingAssessment ? <WorkspaceAssignedWorkControl
                referral={loadedReferral}
                available={onOpenAssignedWork}
                onOpen={openAssignedWork}
                disabled={draftRecoveryLoading || emailSending}
              /> : null}
              {editingControlsVisible ? (
                <WorkspaceSaveControl
                  saving={isSaving}
                  hasReferral={hasReferral}
                  hasChanges={hasPendingWorkspaceChanges}
                  blocked={workspaceSaveIsBlocked(uploadingDocumentIds, remoteChange)}
                  onSave={saveWorkspaceDraft}
                  retry={false}
                />
              ) : null}
              <button
                type="button"
                onClick={() => void navigatePage("files")}
                aria-current={displayedPage === "files" ? "page" : undefined}
                aria-label="Workspace files"
                title="Files"
                className={workspaceFolderStyles.utilityTab}
              >
                <FolderOpen size={15} aria-hidden="true" />
                <span>{workspacePresentation.filesLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => void navigatePage("activity")}
                aria-current={displayedPage === "activity" ? "page" : undefined}
                aria-label="Workspace activity"
                title="Activity"
                className={workspaceFolderStyles.utilityTab}
              >
                <History size={15} aria-hidden="true" />
                <span>Activity</span>
              </button>
              {trashControlVisible ? (
                <button
                  type="button"
                  className={`${workspaceFolderStyles.utilityTab} ${workspaceFolderStyles.trashTab}`}
                  aria-label="Move workspace to trash"
                  title="Move workspace to trash"
                  disabled={isDeleting}
                  onClick={() => {
                    setDeleteError("");
                    setDeleteDialogOpen(true);
                  }}
                ><Trash2 size={16} aria-hidden="true" /><span>Trash</span></button>
              ) : null}
            </div>
  );

  const renderWorkspaceHeader = () => (
    <div data-testid="workspace-folder-header" className={workspaceFolderStyles.header} data-focused={assessmentFocused || undefined} data-reading-assessment={readingAssessment || undefined}>
          <div className={workspaceFolderStyles.tabRow}>
            <h1 data-testid="workspace-identity-title" className={workspaceFolderStyles.identity} title={workspaceTitle}>
              <span className={workspaceFolderStyles.nameLabel}>{workspaceTitle}</span>
            </h1>
            <WorkspaceStageNavigation steps={navigableWorkspaceSteps} activePage={displayedPage === 1 && loadedReferral && !navigableWorkspaceSteps.some((step) => step.page === 1) ? chartPage : displayedPage} onOpen={(page) => void navigatePage(page)} />

            {renderWorkspaceActions()}
          </div>
          {editingControlsVisible && displayedPage !== 2 && (displayedPage !== "email" || Boolean(saveError || isSaving || hasPendingWorkspaceChanges || saveStatus === deviceOnlySaveStatus)) ? (
            <WorkspaceSaveStatus
              status={saveStatus}
              error={saveError}
              createdWorkspaceId={createdWorkspaceId}
              referralId={editableReferralId}
              hasReferral={hasReferral}
              saving={isSaving}
              dirtyCount={dirtyKeys.size}
              queuedFileCount={queuedFileCount}
              onRetry={hasReferral && hasPendingWorkspaceChanges ? () => void saveWorkspaceDraft() : undefined}
            />
          ) : null}
        </div>
  );

  const renderPacketReview = () => (
    referralDocumentAutofillEnabled && (loadedReferral?.workspaceStatus !== "historical" || referralContextPacketFields.length) ? (
              <PacketExtractionReview
                fields={referralContextPacketFields}
                packetId={loadedReferral?.packetId}
                fileName={loadedReferral?.documentName || "the uploaded packet"}
                status={extraction?.status}
                hasPacket={Boolean(loadedReferral?.packetId)}
                developmentOnly={loadedReferral?.packetMessage?.startsWith("Development")}
                busyFieldKey={reviewBusyFieldKey}
                bulkBusy={isBulkReviewing}
                onAccept={(field) => reviewExtractedField(field, "accept")}
                onAcceptAll={acceptExtractedFields}
                onEdit={(field, value) => reviewExtractedField(field, "edit", value)}
              />
            ) : null
  );

  const renderDocumentUpload = (collapsible: boolean) => (
    <ReferralDocumentUpload
      readOnly={readOnly || draftRecoveryLoading}
      collapsible={collapsible}
      queued={[
        ...(initialPacket ? [{ file: initialPacket, category: initialPacketCategory }] : []),
        ...Object.entries(pendingDocuments).map(([id, file]): LabeledReferralFile => {
          const requirement = [...requirements, ...attachments].find((item) => item.id === id);
          return { file, category: requirement ? documentCategoryForRequirement(requirement.type) : "other" };
        }),
        ...additionalFiles,
      ]}
      files={workspaceFiles}
      filesLoading={workspaceFilesLoading}
      filesError={workspaceFilesError}
      onRetryFiles={() => setWorkspaceFilesRevision((revision) => revision + 1)}
      onAdd={addLabeledFiles}
      onRemove={removeQueuedFile}
      uploading={isSaving || uploadingDocumentIds.size > 0}
      onWorkbook={loadedReferral && assessmentSummary.assessmentId && !readOnly ? (file) => { setWorkbookImport(file); void navigatePage(2); } : undefined}
    >
      {historicalReadOnly ? <p className="text-sm text-[#52655d]">Files in this imported chart can be opened and downloaded. Add new files to the current referral.</p> : null}
      {renderPacketReview()}
      <details className="mt-4 border-t border-[#dce4df] pt-3">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-[#52655d]">Document checklist</summary>
        <ul className="mt-2 grid gap-x-6 sm:grid-cols-2">
          {[...requirements, ...attachments].map((item) => {
            const filename = getRequirementReviewValue(item, documents[item.id], loadedReferral);
            const queued = Boolean(pendingDocuments[item.id]) || additionalFiles.some((entry) => entry.category === documentCategoryForRequirement(item.type)) || Boolean(initialPacket && item.type === initialPacketCategory);
            const pending = queued || uploadingDocumentIds.has(item.id);
            return <li key={item.id} className="flex items-start justify-between gap-3 border-b border-[#edf0ee] py-3 text-[13px]">
              <span>{item.label}{filename ? <small className="mt-1 block break-all text-[#52655d]">{filename}</small> : null}</span>
              <span className={pending ? "text-[#755618]" : filename ? "text-[#08735e]" : "text-[#66736c]"}>{pending ? "Pending" : filename ? "Received" : "Not added"}</span>
            </li>;
          })}
        </ul>
      </details>
    </ReferralDocumentUpload>
  );

  const renderCreationHandoff = () => (showCreationHandoff && loadedReferral ? <HomeDialog label="Workspace created" title="Workspace created" onClose={() => { setShowCreationHandoff(false); onWorkspaceLocationChange?.({ view: "chart" }); }} className="rounded-xl">
        <div className="space-y-5 p-5 sm:p-6">
          <div><p className="text-xl font-bold text-[#243d34]">{loadedReferral.name}</p><p className="mt-1 text-[15px] leading-6 text-[#586c63]">The intake is now the chart. Book a time, or prepare from the records first.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={permissionReadOnly} onClick={() => void continueCreatedWorkspace(true)} className="flex min-h-28 flex-col items-start gap-2 rounded-lg bg-[#08765e] p-5 text-left text-white hover:bg-[#065c49] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#08765e] disabled:opacity-50"><CalendarClock size={22} aria-hidden="true" /><span className="text-lg font-bold">Schedule assessment</span><span className="text-sm">Choose a date, time and meeting details.</span></button>
            <button type="button" disabled={permissionReadOnly} onClick={() => void continueCreatedWorkspace(false)} className="flex min-h-28 flex-col items-start gap-2 rounded-lg border border-[#c6d6ce] bg-[#f5f8f6] p-5 text-left text-[#234a3c] hover:bg-[#eaf2ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#08765e] disabled:opacity-50"><FolderOpen size={22} aria-hidden="true" /><span className="text-lg font-bold">Assessment prep</span><span className="text-sm">Fill in what is known before the interview.</span></button>
          </div>
          {saveError ? <p role="alert" className="text-sm leading-6 text-[#59645e]">{saveError}</p> : null}
          <p className="text-sm leading-6 text-[#586c63]">Neither option starts the interview. Use <strong>Begin assessment</strong> when you are with the client.</p>
        </div>
      </HomeDialog> : null);

  const renderChartDocuments = () => loadedReferral && displayedPage === 3 ? renderDocumentUpload(true) : undefined;

  const renderIntakePage = () => (
    <PacketPage id="packet-page-1" title={loadedReferral ? "Referral details" : "Intake"} flush>
            <IntakeEditScope readOnly={permissionReadOnly || draftRecoveryLoading} accessError={accessError} accessChecking={accessChecking}>
            <div data-testid="intake-client-folder" className={`${folderStyles.recordFolder} ${workspaceFolderStyles.connectedFolder}`}>
              <div className={folderStyles.body}>
                <div className={`${folderStyles.paper} ${folderStyles.recordPaper}`}>
            {referralDocumentAutofillEnabled ? <IntakeExtractionProgress extraction={intakeExtraction} referralId={loadedReferral?.id} suggestionCount={suggestionCount} /> : null}
            {renderDocumentUpload(true)}
            <ClientChartFrame label="Referral intake chart">
              <ClientChartHeader title={loadedReferral ? "Referral details" : "Referral intake"}>
                <ChartHeaderCell label="Intake details" value={`${fieldCount} of ${visibleChartFieldKeys.length} recorded`} />
              </ClientChartHeader>
              <div className="min-w-0" onFocusCapture={focusIntakeCell} onBlur={blurIntakeCell}>
                <ChartSection title="Identity" complete={countCompleteFields(fields, ["name", "dob", "gender", "ssn"])} total={4}>
                  <div className="grid gap-px bg-[#bfcac5] sm:grid-cols-2 xl:grid-cols-5">
                    {(["name", "dob", "gender", "ssn"] as FieldKey[]).map((key) => (
                      <EditablePacketField
                        key={key}
                        fieldKey={key}
                        field={fields[key]}
                        suggestion={intakeSuggestions[key]}
                        onAcceptSuggestion={acceptIntakeSuggestion}
                        className={key === "name" ? "sm:col-span-2" : key === "ssn" ? "sm:col-span-2 xl:col-span-1" : undefined}
                        options={key === "gender" ? genderOptions : undefined}
                        detail={key === "dob" ? (
                          ageFromCalendarDate(fields.dob.value) !== null
                            ? `Age ${ageFromCalendarDate(fields.dob.value)}`
                            : !fields.dob.value && fields.age.value ? `Reported age: ${fields.age.value}` : undefined
                        ) : undefined}
                        onChange={(value) => updateField(key, value)}
                        onFocus={focusWorkspaceField}
                      />
                    ))}
                  </div>
                </ChartSection>

                <ChartSection title="Referral details" complete={countCompleteFields(fields, ["owner", "community", "county", "referralReceived", "referent", "responsiblePerson"])} total={6}>
                  <div aria-label="Referral routing" className="grid gap-px bg-[#bfcac5] sm:grid-cols-2 lg:grid-cols-3">
                    {(["owner", "referralReceived", "community", "county", "referent", "responsiblePerson"] as FieldKey[]).map((key) => (
                      key === "owner" ? (
                        <OwnerPacketField
                          key={key}
                          fieldKey={key}
                          field={{ ...fields.owner, label: "Assessor", placeholder: "Assign assessor" }}
                          members={members}
                          membersError={membersError}
                          onRetryMembers={() => { setMembersError(""); setMembersRetry((retry) => retry + 1); }}
                          ownerPrincipalId={ownerPrincipalId}
                          confirmedOwnerId={loadedReferral?.ownerId ?? ""}
                          onChange={(principalId) => {
                            const member = members.find((candidate) => candidate.principal_id === principalId);
                            const change = { principalId, displayName: member?.display_name ?? "Unassigned" };
                            const current = loadedReferralRef.current;
                            if (current && !isUnassignedOwner(current.owner) && (current.ownerId ?? "") !== principalId) {
                              setPendingOwnerChange(change);
                              return;
                            }
                            applyOwnerChange(change);
                          }}
                          onFocus={focusWorkspaceField}
                        />
                      ) : (
                        <EditablePacketField
                          key={key}
                          fieldKey={key}
                          field={fields[key]}
                          suggestion={intakeSuggestions[key]}
                          onAcceptSuggestion={acceptIntakeSuggestion}
                          options={key === "community" ? pipelineCommunities : key === "county" ? californiaCountyOptions : undefined}
                          directory={canSupervise || editableReferralId ? (
                            key === "referent" ? "organization" : key === "responsiblePerson" ? "person" : undefined
                          ) : undefined}
                          referralId={editableReferralId ?? undefined}
                          onChange={(value) => updateField(key, value)}
                          onFocus={focusWorkspaceField}
                        />
                      )
                    ))}
                    <div data-workspace-field="tags" className="min-h-[82px] min-w-0 bg-white px-5 py-4 sm:px-6 lg:col-span-2">
                      <label htmlFor="packet-tags" className="text-[9px] font-black uppercase tracking-[0.09em] text-[#5f6b66] sm:text-[10px]">Tags</label>
                      <input
                        id="packet-tags"
                        aria-label="Tags"
                        value={tagsInput}
                        onChange={(event) => {
                          tagsInputRef.current = event.target.value;
                          setTagsInput(event.target.value);
                          markDirty("tags");
                          setSavedAt("Unsaved changes");
                        }}
                        placeholder="urgent, county-intake"
                        className="mt-1.5 h-8 w-full border-0 bg-transparent p-0 text-[14px] font-bold text-[#18211d] outline-none placeholder:text-[#a0a0a0] focus-visible:ring-2 focus-visible:ring-[#0f8b73]"
                      />
                    </div>
                    <div data-workspace-field="conserved" className="min-h-[82px] min-w-0 bg-white px-5 py-4 sm:px-6">
                      <label htmlFor="packet-conserved" className="text-[9px] font-black uppercase tracking-[0.09em] text-[#5f6b66] sm:text-[10px]">Conservatorship</label>
                      <select id="packet-conserved" value={conserved} onChange={(event) => {
                        setSaveError("");
                        conservedRef.current = event.target.value as "yes" | "no" | "";
                        setConserved(event.target.value as "yes" | "no" | "");
                        markDirty("conserved");
                        setSavedAt("Unsaved changes");
                      }} className="mt-1.5 h-8 w-full border-0 bg-transparent p-0 text-[14px] font-bold text-[#18211d] outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]">
                        <option value="">Not yet verified</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                  </div>
                </ChartSection>

                <ChartSection title="Contact and coordination" complete={countCompleteFields(fields, ["referrerName", "phone", "email"])} total={3}>
                  <div className="grid gap-px overflow-hidden bg-[#bfcac5] sm:grid-cols-2 lg:grid-cols-3">
                    {(["referrerName", "phone", "email"] as FieldKey[]).map((key) => (
                      <EditablePacketField
                        key={key}
                        fieldKey={key}
                        field={fields[key]}
                        suggestion={intakeSuggestions[key]}
                        onAcceptSuggestion={acceptIntakeSuggestion}
                        onChange={(value) => updateField(key, value)}
                        onFocus={focusWorkspaceField}
                      />
                    ))}
                  </div>
                  <div className="border-t border-[#bfcac5] px-5 py-4 sm:px-6"><ReferralContactsCard
                    referralId={editableReferralId ?? undefined}
                    referrerPhone={fields.phone.value}
                    referrerEmail={fields.email.value}
                  /></div>
                </ChartSection>

                <ChartSection title="Medication profile" complete={countCompleteFields(fields, ["currentMedications"])} total={1}>
                  <div className="px-5 py-4 sm:px-6" data-workspace-field="currentMedications" onFocusCapture={() => focusWorkspaceField("currentMedications")}>
                    <MedicationProfileField
                      field={fields.currentMedications}
                      onChange={(value) => updateField("currentMedications", value)}
                    />
                  </div>
                </ChartSection>
              </div>

              <aside aria-label="Intake progress" className="border-t border-[#bfcac5] bg-[#f7faf8]">
                {loadedReferral && chartPage === 3 ? <div className="flex justify-end px-4 py-3">
                  <button type="button" onClick={() => void navigatePage(3)} disabled={isSaving} className="min-h-11 rounded-md bg-[#087d66] px-6 text-[14px] font-semibold text-white disabled:opacity-50">Done</button>
                </div> : <ChartCompletionRail
                  fieldCount={fieldCount}
                  fieldTotal={visibleChartFieldKeys.length}
                  assessmentSummary={assessmentSummary}
                  continuing={isSaving}
                  hasReferral={Boolean(loadedReferral) || trainingIntakeMode}
                  onContinue={() => void continueToAssessment()}
                />}
              </aside>
            </ClientChartFrame>
            <ReferralHandoffContacts key={fields.community.value} value={handoff} community={fields.community.value} disabled={permissionReadOnly} compact />
                </div>
              </div>
            </div>
            </IntakeEditScope>
          </PacketPage>
  );

  return (
    <div ref={canvasRef} onClickCapture={(event) => { lastChartEditControlRef.current = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-chart-edit]") : null; }} data-guide-target="packet-workspace" data-performance-ready={workspacePerformanceReady(draftRecoveryLoading, referral?.id, loadedReferral)} className={`relative h-full overflow-y-auto pipeline-page-surface text-[#111111] ${phone ? workspaceFolderStyles.phoneWorkspace : ""}`}>
      {draftRecoveryLoading ? (
        <div className="absolute inset-0 z-50 flex items-start justify-center bg-white/85 pt-24" role="status" aria-live="polite">
          <div className="border-l-2 border-[#0f8b73] bg-white px-4 py-3 text-[12px] font-black text-[#174f43] shadow-sm">
            Restoring saved work...
          </div>
        </div>
      ) : null}
      <div
        data-testid="packet-workspace"
        inert={draftRecoveryLoading}
        aria-busy={draftRecoveryLoading}
        className={`mx-auto w-full max-w-[1480px] px-2 pb-10 pt-0 sm:px-4 lg:px-6 ${readingAssessment ? workspaceFolderStyles.readingWorkspace : ""}`}
      >
        {renderWorkspaceHeader()}

        {accessError ? <div role="alert" className="mb-3 border border-[#e2c592] bg-[#fff9ec] px-4 py-3 text-[12px] font-semibold text-[#7a4c0d]">
          {accessError} <button type="button" onClick={() => { setAccessChecking(true); setAccessRetry((retry) => retry + 1); }} disabled={accessChecking} className="font-bold underline underline-offset-2 disabled:opacity-50">{accessChecking ? "Checking access..." : "Retry access check"}</button>
        </div> : null}

        {renderRestoredEdits()}

        {saveAlert ? <div role="status" className="mb-3 bg-[#fff9ec] px-4 py-3 text-[12px] font-semibold leading-5 text-[#7a4c0d]">{saveAlert}</div> : null}

        {presence.length > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 border border-[#cfe4da] bg-[#f7fbf9] px-3 py-2" aria-live="polite" aria-label="People editing this workspace">
            {presence.map((item) => (
              <span key={item.lease_id} className="inline-flex items-center gap-2 rounded-full border border-[#c7ded4] bg-white px-2.5 py-1 text-[10px] font-bold text-[#315e50]">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#20a464]" />
                {item.actor_name} is editing {presenceSectionLabel(item.section)}
              </span>
            ))}
          </div>
        ) : null}

        {renderWorkspaceConflicts()}

        {renderExtractionConflict()}

        <div key={readingAssessment ? "assessment-chart" : displayedPage} className={readingAssessment ? workspaceFolderStyles.readingPages : "pipeline-step-enter"}>
          {displayedPage === 1 && historicalReadOnly && loadedReferral ? (
            <PacketPage id="transferred-chart" title="Chart" flush>
              <WorkspaceChartFolder>
              <TransferredWorkspaceChart key={loadedReferral.id} referral={loadedReferral} />
              </WorkspaceChartFolder>
            </PacketPage>
          ) : displayedPage === 1 ? (
          renderIntakePage()
          ) : displayedPage === "files" ? (
            <PacketPage id="packet-files" title={workspacePresentation.filesLabel}>
              <div className="max-sm:px-3">{renderDocumentUpload(false)}</div>
            </PacketPage>
          ) : displayedPage === "workflow" && loadedReferral ? (
            <PacketPage id="admission-workflow" title="Decision" flush>
              <WorkspaceChartFolder>
              <ReferralWorkflowPanel
                referral={loadedReferral}
                beforeWorkspaceNavigationRef={assessmentNavigationRef}
                onDone={onOpenAssignedWork ? openAssignedWork : undefined}
                onReferralChange={applyConfirmedWorkflowReferral}
                onOpenIntake={() => void navigatePage(1)}
                onOpenAssessment={() => void navigatePage(2)}
                onOpenFiles={() => void navigatePage("files")}
                onOpenEmail={() => openPage("email")}
                onOpenProfile={openClientProfile}
              />
              </WorkspaceChartFolder>
            </PacketPage>
          ) : displayedPage === "email" ? (
            <PacketPage id="packet-email" title="Finish & send" flush>
              <WorkspaceChartFolder>
              <AssessmentChartWorkspace key={referralWorkspaceId} referralId={referralWorkspaceId} emailPage
                onReferralChange={applyConfirmedWorkflowReferral}
                onSendingChange={(sending) => { emailSendingRef.current = sending; setEmailSending(sending); }}
                emailDraft={handoff}
                onOpenIntake={() => void navigatePage(1)}
                onOpenFiles={() => void navigatePage("files")} onOpenAssessment={() => void navigatePage(2, undefined, "review")}
                onOpenDecision={() => void navigatePage("workflow")}
                finishActions={onOpenAssignedWork ? <button type="button" disabled={emailSending || emailFinishing} onClick={() => {
                  setEmailFinishing(true);
                  void openAssignedWork().catch((error) => setSaveError(error instanceof Error ? error.message : "The workspace could not be saved.")).finally(() => setEmailFinishing(false));
                }} className="min-h-12 rounded-md bg-[#087d66] px-6 text-[16px] font-semibold text-white hover:bg-[#06634f] focus-visible:outline-2 disabled:opacity-50">{emailFinishing ? "Saving..." : "Close workspace"}</button> : null} />
              </WorkspaceChartFolder>
            </PacketPage>
          ) : readingAssessment ? (
            <PacketPage id="packet-page-2" title={displayedPage === 3 ? "Chart" : "Assessment"} flush>
                <AssessmentWorkspace
                  readOnly={permissionReadOnly}
                  workbookImport={workbookImport}
                  onWorkbookImportRead={() => setWorkbookImport(null)}
                  referralId={referralWorkspaceId}
                  referral={loadedReferral ?? undefined}
                  recommendationControl={loadedReferral && !permissionReadOnly && !trainingAssessmentMode ? (assessmentId, onSavingChange) => <ReferralWorkflowPanel key={assessmentId} compactRecommendation recommendationAssessmentId={assessmentId} onSavingChange={onSavingChange} referral={loadedReferral} onReferralChange={applyConfirmedWorkflowReferral} onOpenIntake={() => openPage(1)} onOpenAssessment={() => openPage(2)} onOpenFiles={() => openPage("files")} onOpenEmail={() => openPage("email")} onOpenProfile={openClientProfile} /> : undefined}
                  trainingAssessmentMode={trainingAssessmentMode}
                  trainingAssessmentSection={trainingAssessmentSection}
                  initialSection={routedWorkspaceLocation.assessmentSection ?? lastAssessmentSectionRef.current}
                  initialQuestion={routedWorkspaceLocation.assessmentQuestion ?? lastAssessmentQuestionRef.current}
                  initialLocation={routedWorkspaceLocation}
                  assignedAssessorId={loadedReferral?.ownerId}
                  {...assessmentEntryProps()}
                  workspaceTitle={workspaceTitle}
                  {...assessmentChartProps()}
                  chartDocuments={renderChartDocuments()}
                  onOpenChart={() => openPage(3)}
                  onReviewAssessment={() => openPage(2, undefined, "review")}
                  onOpenAssessment={() => openPage(2, undefined, null)}
                  beforeWorkspaceNavigationRef={assessmentNavigationRef}
                  packetEvidenceVersion={packetEvidenceVersion}
                  onSummaryChange={setAssessmentSummary}
                  onContinueToWorkflow={() => openPage("workflow")}
                  onOpenWorkspace={() => openPage(3)}
                  onOpenAssignedWork={onOpenAssignedWork ? openAssignedWork : undefined}
                  onActiveSectionChange={(section, location) => {
                    lastAssessmentSectionRef.current = section;
                    lastAssessmentQuestionRef.current = location.assessmentQuestion;
                    if (location.assessmentMode !== "review") lastAssessmentLocationRef.current = location;
                    const previous = publishedAssessmentSectionRef.current;
                    publishedAssessmentSectionRef.current = section;
                    // Mount-time section publication is not a deliberate navigation choice.
                    if (resumeWorkflowOnOpen && !entryResolvedRef.current && previous === undefined) return;
                    if (previous !== undefined && previous !== section) entryResolvedRef.current = true;
                    if (activePage === 2) onWorkspaceLocationChange?.(location);
                  }}
                  onAssessmentSaved={async (assessment, savedReferral) => {
                    if (savedReferral) {
                      receiveRemoteReferral(savedReferral, savedReferral.updatedBy?.name, true);
                      return;
                    }
                    if (assessment.status !== "complete" || !assessment.signed_at) return;
                    const current = loadedReferralRef.current;
                    if (!current) return;
                    const canvas = await fetchPipelineJson<{
                      referral?: Referral;
                    }>(`/api/referrals/${current.id}/canvas`, { cache: "no-store" });
                    if (canvas.referral) receiveRemoteReferral(canvas.referral, canvas.referral.updatedBy?.name, true);
                  }}
                />
            </PacketPage>
          ) : displayedPage === 3 ? (
            <PacketPage id="packet-charts" title="Chart" flush>
              <WorkspaceChartFolder>
              <TransferredWorkspaceChart key={loadedReferral?.id} referral={loadedReferral} />
              </WorkspaceChartFolder>
            </PacketPage>
          ) : (
            <PacketPage id="packet-activity" title="Activity">
              <ReferralActivityPanel referralId={referralWorkspaceId} version={loadedReferral?.version} />
            </PacketPage>
          )}
        </div>
      </div>
      {renderCreationHandoff()}
      {deleteDialogOpen && loadedReferral ? (
        <DeleteWorkspaceDialog
          name={loadedReferral.name}
          busy={isDeleting}
          unsavedChanges={hasPendingWorkspaceChanges}
          error={deleteError}
          onConfirm={() => void moveWorkspaceToTrash()}
          onClose={() => { if (!isDeleting) setDeleteDialogOpen(false); }}
        />
      ) : null}
      <OwnerChangeDialog
        change={pendingOwnerChange}
        currentOwner={fields.owner.value}
        onConfirm={(change, reason) => {
          setPendingOwnerChange(null);
          applyOwnerChange(change, reason);
          commitIntakeCell("owner");
        }}
        onClose={() => setPendingOwnerChange(null)}
      />
      <DuplicateReferralReviewDialog
        review={duplicateReview}
        busy={isSaving}
        onOpenExisting={(candidate) => {
          setDuplicateReview(null);
          onReferralSaved?.({
            id: candidate.referral_id,
            name: candidate.name,
            community: candidate.community,
          });
        }}
        onConfirmDistinctPerson={(referralIds) => {
          setDuplicateReview(null);
          void saveWorkspaceDraft(referralIds);
        }}
        onClose={() => {
          if (!isSaving) setDuplicateReview(null);
        }}
      />
    </div>
  );
}

function workspacePageForLocation(location: PipelineWorkspaceLocation, referralId?: number): WorkspaceView {
  if (location.view === "assessment") return 2;
  if (location.view === "chart") return 3;
  if (location.view === "workflow" || location.view === "email" || location.view === "files" || location.view === "activity") return location.view;
  if (referralId && !location.intakeField) return 3;
  return 1;
}

function initialWorkspaceLocationOrStage(
  location: PipelineWorkspaceLocation | undefined,
  stage: WorkspaceStageName,
): PipelineWorkspaceLocation {
  return location ?? { view: stage };
}

function initialIntakeFocus(location: PipelineWorkspaceLocation) {
  return location.view === "intake" ? location.intakeField : undefined;
}

function workspaceLocationForPage(page: WorkspaceView): PipelineWorkspaceLocation {
  if (page === 2) return { view: "assessment" };
  if (page === 3) return { view: "chart" };
  if (page === "workflow" || page === "email" || page === "files" || page === "activity") return { view: page };
  return { view: "intake" };
}

function workspaceStageName(stage: WorkspaceStage): WorkspaceStageName {
  if (stage === 2) return "assessment";
  if (stage === 3) return "chart";
  return "intake";
}

function useWorkspaceLocationRouting(
  referralId: number | undefined,
  draftKey: ReferralPacketCanvasProps["newDraftKey"],
  location: PipelineWorkspaceLocation,
  setActivePage: (page: WorkspaceView) => void,
) {
  const routedWorkspaceRef = useRef("");
  const routeKey = workspaceRouteKey(referralId, draftKey, location);
  const routedPage = workspacePageForLocation(location, referralId);
  useEffect(() => {
    if (routedWorkspaceRef.current === routeKey) return;
    routedWorkspaceRef.current = routeKey;
    setActivePage(routedPage);
  }, [routeKey, routedPage, setActivePage]);
}

function workspaceRouteKey(
  referralId: number | undefined,
  draftKey: ReferralPacketCanvasProps["newDraftKey"],
  location: PipelineWorkspaceLocation,
) {
  return `${referralId ?? draftKey ?? "new"}:${location.view}:${location.assessmentSection ?? ""}:${location.assessmentMode ?? ""}:${location.intakeField ?? ""}`;
}

function getWorkspacePresentation(
  referral: Referral | null,
  admissionDocumentCount: number,
  attachmentCount: number,
  permissionReadOnly = false,
) {
  const usesSourceProfile = referral ? isImportedWorkspace(referral) : false;
  const historicalReadOnly = referral?.workspaceStatus === "historical";
  return {
    readOnly: historicalReadOnly || permissionReadOnly,
    historicalReadOnly,
    usesSourceProfile,
    steps: usesSourceProfile || historicalReadOnly ? importedWorkspaceSteps : referral ? savedWorkspaceSteps : packetSteps,
    filesLabel: "Files",
    admissionTitle: usesSourceProfile ? "Admission documents" : "Required for admission",
    admissionDetail: usesSourceProfile
      ? `${admissionDocumentCount} linked`
      : `${admissionDocumentCount} of ${requirements.length} attached`,
    supportingTitle: usesSourceProfile ? "Supporting files" : "Assessment and supporting files",
    supportingDetail: usesSourceProfile
      ? `${attachmentCount} linked`
      : `${attachmentCount} of ${attachments.length} attached`,
  };
}

function WorkspaceChartFolder({ children }: { children: React.ReactNode }) {
  return <div data-testid="workspace-chart-folder" className={`${folderStyles.recordFolder} ${workspaceFolderStyles.connectedFolder}`}>
    <div className={folderStyles.body}><div className={`${folderStyles.paper} ${folderStyles.recordPaper}`}>{children}</div></div>
  </div>;
}

function WorkspaceStageNavigation({ steps, activePage, onOpen }: {
  steps: ReadonlyArray<WorkspaceStep>;
  activePage: WorkspaceView;
  onOpen: (page: WorkspaceView) => void;
}) {
  return (
    <nav data-guide-target="workspace-stage-nav" aria-label="Workspace stages" className={workspaceFolderStyles.stages}>
      <select aria-label="Workspace view" className={workspaceFolderStyles.phoneStagePicker} value={activePage} onChange={(event) => {
        const view = [...steps, { page: "files" as const }, { page: "activity" as const }].find((step) => String(step.page) === event.target.value)?.page;
        if (view !== undefined) onOpen(view);
      }}>
        {steps.map((step) => <option key={step.page} value={step.page}>{step.label}</option>)}
        <optgroup label="File tools"><option value="files">Files</option><option value="activity">Activity</option></optgroup>
      </select>
      {steps.map((step) => <WorkspaceStageButton key={step.page} {...step} selected={activePage === step.page} onOpen={onOpen} />)}
    </nav>
  );
}

function WorkspaceStageButton({ page, label, selected, onOpen }: {
  page: WorkspaceStep["page"]; label: string; selected: boolean; onOpen: (page: WorkspaceView) => void;
}) {
  return <button type="button" data-guide-target={page === 2 ? "assessment-stage" : label === "Chart" ? "chart-stage" : page === "email" ? "chart-meet-client-tab" : undefined}
    onClick={() => onOpen(page)} aria-current={selected ? "page" : undefined}
    data-folder-stage={page}
    className={workspaceFolderStyles.stageTab}>
    <span className="whitespace-nowrap">{label}</span>
  </button>;
}

function WorkspaceSaveStatus({ status, error, createdWorkspaceId, referralId, hasReferral, saving, dirtyCount, queuedFileCount, onRetry }: {
  status: string; error: string; createdWorkspaceId: number | null; referralId: number | null;
  hasReferral: boolean; saving: boolean; dirtyCount: number; queuedFileCount: number; onRetry?: () => void;
}) {
  const created = createdWorkspaceId !== null && createdWorkspaceId === referralId;
  const presentation = workspaceSavePresentation(status, error, hasReferral, saving, dirtyCount, queuedFileCount);
  const { Icon } = presentation;
  // Confirmed saves do not need a second visible strip below the folder tabs.
  // Keep pending, device-only, and failed saves visible.
  const quiet = !error && !saving && (presentation.confirmed || status === "No unsaved changes" || /^Draft(?: saved.*)?$/.test(status));
  return <div data-testid="workspace-save-status" className={quiet ? "sr-only" : workspaceFolderStyles.saveNotice} aria-live="polite" title={error || status}>
    <FeedbackCue value={status} enabled={presentation.confirmed} />
    <Icon size={13} aria-hidden="true" className={`shrink-0 ${presentation.iconClassName}`} />
    <span className={`shrink-0 ${presentation.textClassName}`}>{presentation.label}</span>
    {created ? <span className="sr-only">Workspace created</span> : null}
    {presentation.label !== status ? <span className="sr-only">{status}</span> : null}
    {error ? <span role="alert" className="min-w-0 max-w-[45ch] truncate text-[11px] font-medium text-[#8b4638]">{error}</span> : null}
    {error && onRetry ? <button type="button" aria-label="Retry saving" onClick={onRetry} disabled={saving} className="shrink-0 text-[11px] font-bold text-[#0c705f] underline underline-offset-2">Retry</button> : null}
  </div>;
}

// The one status that means the edit exists only in this browser's recovery copy.
const deviceOnlySaveStatus = "Saved on this device; not synced";

function workspaceSavePresentation(status: string, error: string, hasReferral: boolean, saving: boolean, dirtyCount: number, queuedFileCount: number) {
  const deviceOnly = status === deviceOnlySaveStatus;
  const confirmed = hasReferral && !saving && dirtyCount === 0 && queuedFileCount === 0
    && !deviceOnly && /^(Saved |All changes saved|Packet uploaded|Updated by )/.test(status);
  if (error) return { label: "Not saved to Pipeline", Icon: CircleAlert, iconClassName: "text-[#a4473c]", textClassName: "text-[#93382d]", confirmed: false };
  if (saving) return { label: "Saving...", Icon: LoaderCircle, iconClassName: "motion-safe:animate-spin text-[#68716c]", textClassName: "text-[#59645e]", confirmed: false };
  if (deviceOnly) return { label: "Saved on this device · waiting to sync", Icon: UploadCloud, iconClassName: "text-[#68716c]", textClassName: "text-[#59645e]", confirmed: false };
  if (status === "No unsaved changes") return { label: status, Icon: CheckCircle2, iconClassName: "text-[#68716c]", textClassName: "text-[#59645e]", confirmed: false };
  if (confirmed) return { label: "Saved to Pipeline", Icon: CheckCircle2, iconClassName: "text-[#0c705f]", textClassName: "text-[#0c705f]", confirmed: true };
  return { label: status, Icon: UploadCloud, iconClassName: "text-[#68716c]", textClassName: "text-[#59645e]", confirmed: false };
}

function WorkspaceSaveControl({
  saving,
  hasReferral,
  hasChanges,
  blocked,
  onSave,
  retry,
}: {
  saving: boolean;
  hasReferral: boolean;
  hasChanges: boolean;
  blocked: boolean;
  onSave: () => void;
  retry: boolean;
}) {
  const control = workspaceSaveControlState(saving, hasReferral, hasChanges, blocked, retry);
  if (!control.visible) return null;
  const Icon = saving ? LoaderCircle : hasReferral ? RefreshCw : Plus;
  return (
    <button
      type="button"
      data-guide-target={control.target}
      aria-label={control.label}
      onClick={onSave}
      disabled={control.disabled}
      aria-busy={saving}
      className={workspaceFolderStyles.createTab}
    >
      <Icon size={20} aria-hidden="true" className={saving ? "motion-safe:animate-spin" : undefined} />
      <span>{control.expandedLabel}</span>
    </button>
  );
}

function workspaceSaveControlState(saving: boolean, hasReferral: boolean, hasChanges: boolean, blocked: boolean, retry: boolean) {
  const mode = hasReferral
    ? { label: "Retry saving", busyLabel: "Saving...", target: undefined }
    : { label: "Create referral", busyLabel: "Creating...", target: "create-workspace" };
  return {
    ...mode,
    visible: !hasReferral || retry,
    disabled: saving || blocked || (hasReferral && !hasChanges),
    expandedLabel: saving ? mode.busyLabel : mode.label,
  };
}

function hasReferralRecord(referral: Referral | null, referralId: number | undefined) {
  return Boolean(referral || referralId);
}

function workspaceSaveIsBlocked(uploadingDocumentIds: Set<string>, remoteChange: RemoteChange | null, saving = false, recovering = false) {
  return uploadingDocumentIds.size > 0 || Boolean(remoteChange?.conflicts.length) || saving || recovering;
}

function workspacePerformanceReady(recovering: boolean, referralId: number | undefined, referral: Referral | null) {
  return !recovering && (!referralId || referral) ? "packet" : undefined;
}

function referralPacketEvidenceVersion(referral: Referral | null) {
  if (!referral?.packetId) return "";
  return `${referral.packetId}:${(referral.packetFields ?? [])
    .map((field) => `${field.field_key}:${field.version}`)
    .join("|")}`;
}

function WorkspaceAssignedWorkControl({ referral, available, onOpen, disabled }: {
  referral: Referral | null;
  available: ReferralPacketCanvasProps["onOpenAssignedWork"];
  onOpen: () => Promise<void>;
  disabled: boolean;
}) {
  if (!referral || !available) return null;
  return <AssignedWorkButton onOpen={() => void onOpen().catch(() => undefined)} disabled={disabled} />;
}

export function ChartSection({
  title,
  complete,
  total,
  children,
}: {
  title: string;
  complete: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <section data-guide-target={chartGuideTarget(title)} aria-label={`${title} chart section`}>
      <ChartBand title={title} detail={`${complete} / ${total}`}>{children}</ChartBand>
    </section>
  );
}

function chartGuideTarget(title: string) {
  if (title === "Identity") return "intake-identity";
  if (title === "Referral details") return "intake-routing";
  if (title === "Medication profile") return "intake-medications";
  return undefined;
}

function ChartCompletionRail({
  fieldCount,
  fieldTotal,
  assessmentSummary,
  continuing,
  hasReferral,
  onContinue,
}: {
  fieldCount: number;
  fieldTotal: number;
  assessmentSummary: {
    captured: number;
    total: number;
    status: string;
    assessmentId?: string;
    scheduledStartAt?: string | null;
    scheduleStatus?: PipelineAssessmentRecord["schedule_status"];
    startedAt?: string | null;
    signedAt?: string | null;
  };
  continuing: boolean;
  hasReferral: boolean;
  onContinue: () => void;
}) {
  const percent = fieldTotal === 0 ? 0 : Math.round((fieldCount / fieldTotal) * 100);
  const action = assessmentRailAction(assessmentSummary);
  const status = assessmentRailStatus(assessmentSummary);

  return (
    <section aria-label="Intake completion" className="grid items-center gap-x-8 gap-y-2 px-5 py-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex items-center justify-between gap-4 md:col-start-1">
        <h2 className="text-[14px] font-bold text-[#111111]">Intake details</h2>
        <span className="text-[13px] font-bold tabular-nums text-[#5c6660]">{fieldCount.toLocaleString()} of {fieldTotal.toLocaleString()} recorded</span>
      </div>
      <div role="progressbar" aria-label="Intake details recorded" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${fieldCount} of ${fieldTotal} intake details recorded`} className="h-1.5 overflow-hidden bg-[#e5e9e6] md:col-start-1">
        <div className="h-full origin-left bg-[#0f8b73] transition-transform duration-150 motion-reduce:transition-none" style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
      <dl className="flex flex-wrap gap-x-8 md:col-start-1">
        <ChartStatusRow label="Assessment" value={status} />
      </dl>
      {hasReferral ? <button
        type="button"
        onClick={onContinue}
        disabled={continuing}
        className="flex min-h-11 w-full items-center justify-between gap-3 bg-[#111111] px-4 py-3 text-left text-[13px] font-bold leading-5 text-white transition-colors hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:bg-[#d2d2d2] md:col-start-2 md:row-start-1 md:row-span-3"
      >
        <span>{action}</span><ArrowRight size={16} className="shrink-0" aria-hidden="true" />
      </button> : null}
    </section>
  );
}

function assessmentRailAction(
  summary: { signedAt?: string | null; startedAt?: string | null; scheduledStartAt?: string | null; scheduleStatus?: PipelineAssessmentRecord["schedule_status"] },
) {
  return assessmentOpenLabel({
    signed_at: summary.signedAt ?? null,
    started_at: summary.startedAt ?? null,
    scheduled_start_at: summary.scheduledStartAt ?? null,
    schedule_status: summary.scheduleStatus,
  });
}

function assessmentRailStatus(summary: { signedAt?: string | null; startedAt?: string | null; scheduledStartAt?: string | null; scheduleStatus?: PipelineAssessmentRecord["schedule_status"] }) {
  if (summary.signedAt) return "Signed";
  if (summary.startedAt) return "In progress";
  return hasActiveAssessmentSchedule({ scheduled_start_at: summary.scheduledStartAt, schedule_status: summary.scheduleStatus }) ? "Scheduled" : "Not scheduled";
}

function ChartStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-[13px] text-[#595959]">{label}</dt>
      <dd className="text-[13px] font-bold text-[#2f4a41]">{value}</dd>
    </div>
  );
}

function PacketPage({
  id,
  title,
  flush = false,
  children,
}: {
  id: string;
  title: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-guide-target={id === "packet-files" ? "workspace-files" : undefined} aria-label={title} className={id === "admission-workflow" || id === "packet-email" ? "overflow-clip bg-white" : "overflow-hidden bg-white"}>
      <h2 className="sr-only">{title}</h2>
      <div className={flush ? undefined : "px-0 py-1 sm:px-2 sm:py-2"}>{children}</div>
    </section>
  );
}

async function loadWorkspaceFileInventory(referralId: number, signal: AbortSignal) {
  const files: ReferralFile[] = [];
  let cursor: string | null = null;
  do {
    const result: {
      files: ReferralFile[];
      next_cursor: string | null;
    } = await fetchPipelineJson<{
      files: ReferralFile[];
      next_cursor: string | null;
    }>(`/api/files?referral_id=${referralId}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal });
    files.push(...result.files);
    cursor = result.next_cursor;
    if (files.length >= 10_000 && cursor) throw new Error("This workspace has too many files to show at once.");
  } while (cursor);
  return files;
}

function countCompleteFields(fields: Record<FieldKey, PacketField>, keys: readonly FieldKey[]) {
  return keys.filter((key) => {
    const value = fields[key].value.trim();
    return Boolean(value) && value !== "Unassigned";
  }).length;
}

function isAssignedValue(value: string) {
  return !isUnassignedOwner(value);
}

function getRequirementReviewValue(requirement: Requirement, localFileName: string | undefined, referral: Referral | null) {
  if (localFileName) return localFileName;
  const savedRequirement = referral?.requirements?.find((item) => item.label === requirement.label || item.id === requirement.id);
  if (savedRequirement?.evidenceDocumentName) return savedRequirement.evidenceDocumentName;
  if (savedRequirement && ["received", "reviewed", "waived", "not_applicable"].includes(savedRequirement.status)) return "Recorded";
  return "";
}

function getEvidenceByType(documents: Record<string, string>) {
  return Object.fromEntries(
    [...requirements, ...attachments]
      .map((definition) => [definition.type, documents[definition.id]?.trim()] as const)
      .filter((entry): entry is readonly [RequirementType, string] => Boolean(entry[1])),
  ) as Partial<Record<RequirementType, string>>;
}

function OwnerPacketField({
  fieldKey,
  field,
  members,
  membersError,
  onRetryMembers,
  ownerPrincipalId,
  confirmedOwnerId,
  onChange,
  onFocus,
}: {
  fieldKey: FieldKey;
  field: PacketField;
  members: WorkspaceMember[];
  membersError: string;
  onRetryMembers: () => void;
  ownerPrincipalId: string;
  confirmedOwnerId: string;
  onChange: (principalId: string) => void;
  onFocus: (key: FieldKey) => void;
}) {
  const hasLegacyOwner = !ownerPrincipalId && !isUnassignedOwner(field.value);
  const hasCurrentOwnerOption = !ownerPrincipalId || members.some((member) => member.principal_id === ownerPrincipalId);
  return (
    <div data-workspace-field={fieldKey} onFocusCapture={() => onFocus(fieldKey)} className="group relative min-h-[82px] min-w-0 bg-white px-5 py-4 sm:px-6 focus-within:z-10 focus-within:outline focus-within:outline-2 focus-within:outline-[#0f8b73]">
      <FeedbackCue value={confirmedOwnerId} />
      <label className="text-[9px] font-black uppercase tracking-[0.09em] text-[#5f6b66] sm:text-[10px]">{field.label}</label>
      <select
        aria-label={field.label}
        value={ownerPrincipalId || (hasLegacyOwner ? "__unlinked" : "")}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-8 w-full border-0 bg-transparent p-0 text-[14px] font-bold text-[#18211d] outline-none"
      >
        <option value="">Unassigned</option>
        {hasLegacyOwner ? <option value="__unlinked" disabled>{field.value} (choose member)</option> : null}
        {!hasCurrentOwnerOption ? <option value={ownerPrincipalId}>{field.value || "Current owner"} · Current owner</option> : null}
        {members.map((member) => (
          <option key={member.principal_id} value={member.principal_id}>
            {member.display_name}{member.identity_status === "provisional" ? " · Microsoft access pending" : ""}
          </option>
        ))}
      </select>
      {membersError ? <div role="alert" className="mt-1 text-[10px] text-[#8a5a10]">{membersError} <button type="button" onClick={onRetryMembers} className="font-bold underline underline-offset-2">Retry</button></div>
        : members.length === 0 ? <div className="mt-1 text-[10px] text-[#8a5a10]">No active members loaded</div> : null}
    </div>
  );
}

function OwnerChangeDialog({
  change,
  currentOwner,
  onConfirm,
  onClose,
}: {
  change: { principalId: string; displayName: string } | null;
  currentOwner: string;
  onConfirm: (change: { principalId: string; displayName: string }, reason: string) => void;
  onClose: () => void;
}) {
  if (!change) return null;
  return (
    <ActionDetailDialog
      title="Reassign referral"
      description={`${currentOwner || "Unassigned"} → ${change.displayName}`}
      label="Handoff reason"
      confirmLabel="Reassign"
      minimumLength={3}
      onConfirm={(reason) => onConfirm(change, reason)}
      onClose={onClose}
    />
  );
}

type EditablePacketFieldProps = {
  fieldKey: FieldKey;
  field: PacketField;
  suggestion?: IntakeFieldSuggestion;
  onAcceptSuggestion?: (key: FieldKey, suggestion: IntakeFieldSuggestion) => void;
  options?: readonly string[];
  className?: string;
  detail?: string;
  directory?: "organization" | "person";
  referralId?: number;
  onChange: (value: string) => void;
  onFocus: (key: FieldKey) => void;
};

export function EditablePacketField({
  fieldKey,
  field,
  suggestion,
  onAcceptSuggestion,
  options,
  className,
  detail,
  directory,
  referralId,
  onChange,
  onFocus,
}: EditablePacketFieldProps) {
  const label = ({ dob: "Date of birth", ssn: "SSN (optional)", community: "Requested community", county: "Client county", referent: "Referral facility / source", responsiblePerson: "Responsible person (optional)" } as Partial<Record<FieldKey, string>>)[fieldKey] ?? field.label;
  const displayField = packetFieldForControl(fieldKey, field, suggestion);
  return (
    <div data-workspace-field={fieldKey} onFocusCapture={() => onFocus(fieldKey)} className={`group relative min-h-[82px] min-w-0 bg-white px-5 py-4 sm:px-6 focus-within:z-10 focus-within:outline focus-within:outline-2 focus-within:outline-[#0f8b73] ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-2">
        <label className="text-[9px] font-black uppercase tracking-[0.09em] text-[#5f6b66] sm:text-[10px]">{label}</label>
      </div>
      <PacketFieldControl fieldKey={fieldKey} field={displayField} options={options} directory={directory} referralId={referralId} label={label} onChange={onChange} />
      {suggestion ? <IntakeSuggestionLabel suggestion={suggestion} label={label} onAccept={() => onAcceptSuggestion?.(fieldKey, suggestion)} /> : null}
      {detail ? <div className="mt-1 text-[12px] font-bold text-[#176f60]" aria-live="polite">{detail}</div> : null}
      <GenderFieldDetail fieldKey={fieldKey} field={field} displayValue={displayField.value} onChange={onChange} />
      {field.sourceFile ? (
        <div className="mt-2 flex items-center gap-1 text-[10px] font-black text-[#317f8f]">
          <CheckCircle2 size={12} />
          {field.sourceFile}
        </div>
      ) : null}
    </div>
  );
}

function packetFieldForControl(fieldKey: FieldKey, field: PacketField, suggestion?: IntakeFieldSuggestion): PacketField {
  const displayField = suggestion && !suggestion.conflicting ? { ...field, value: suggestion.value } : field;
  if (fieldKey !== "gender" || !displayField.value || (genderOptions as readonly string[]).includes(displayField.value)) return displayField;
  return { ...displayField, value: "Other" };
}

function GenderFieldDetail({ fieldKey, field, displayValue, onChange }: {
  fieldKey: FieldKey;
  field: PacketField;
  displayValue: string;
  onChange: (value: string) => void;
}) {
  if (fieldKey !== "gender" || displayValue !== "Other") return null;
  return <input
    aria-label="Specify gender"
    value={field.value === "Other" ? "" : field.value}
    placeholder="Specify gender"
    maxLength={80}
    onChange={(event) => onChange(event.target.value || "Other")}
    className="mt-2 h-9 w-full border-b border-[#aebdb6] bg-[#f7faf8] px-2 text-[14px] font-semibold text-[#18211d] outline-none placeholder:text-[#7a8881] focus:border-[#0f8b73]"
  />;
}

function PacketFieldControl({ fieldKey, field, options, directory, referralId, label, onChange }: Pick<EditablePacketFieldProps, "fieldKey" | "field" | "options" | "directory" | "referralId" | "onChange"> & { label: string }) {
  if (directory) {
    const limits = { organization: stringLimits.source, person: stringLimits.responsiblePerson };
    return <ContactDirectorySuggestion label={label} value={field.value} placeholder={field.placeholder} kind={directory} maxLength={limits[directory]} referralId={referralId} onChange={onChange} />;
  }
  if (options) return (
    <select aria-label={label} value={field.value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-8 w-full border-0 bg-transparent p-0 text-[14px] font-bold text-[#18211d] outline-none">
      <option value="">{field.placeholder || `Select ${field.label.replace(/:$/, "").toLowerCase()}`}</option>
      {field.value && !options.includes(field.value) ? <option value={field.value}>{field.value}</option> : null}
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
  return <input
    {...nativePacketInputProps(fieldKey, field.value)}
    aria-label={label}
    autoComplete="off"
    placeholder={field.placeholder}
    onChange={(event) => onChange(event.target.value)}
    onBlur={fieldKey === "phone" ? (event) => {
      const formatted = formatPhoneForEntry(event.target.value);
      if (formatted !== field.value) onChange(formatted);
    } : undefined}
    className={`mt-1.5 h-9 w-full min-w-0 border-0 bg-transparent p-0 font-bold text-[#18211d] outline-none placeholder:text-[#a0a0a0] ${fieldKey === "name" ? "text-[22px] sm:text-[24px]" : "text-[16px] sm:text-[14px]"}`}
  />;
}

function nativePacketInputProps(key: FieldKey, value: string) {
  if (key === "dob" || key === "referralReceived") {
    const normalized = normalizeCalendarDate(value);
    return { type: !value || normalized ? "date" : "text", value: normalized ?? value, max: calendarToday() };
  }
  const types: Partial<Record<FieldKey, string>> = { phone: "tel", email: "email" };
  return { type: types[key] ?? "text", value };
}

function MedicationProfileField({
  field,
  onChange,
}: {
  field: PacketField;
  onChange: (value: string) => void;
}) {
  const medicationCount = field.value
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .length;

  return (
    <section aria-label={`${field.label} chart field`} className="border border-[#d7ddd9] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-black uppercase tracking-[0.08em] text-[#3f4745]">{field.label}</h3>
          <p className="mt-1 text-[11px] font-semibold text-[#737373]">
            {medicationCount ? `${medicationCount} medication${medicationCount === 1 ? "" : "s"} captured` : "No medications captured yet"}
          </p>
        </div>
      </div>
      <textarea
        aria-label={field.label}
        value={field.value}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-4 min-h-[150px] w-full resize-y border border-[#d7ddd9] bg-[#fbfdfc] p-3 text-[13px] font-medium leading-6 text-[#303638] outline-none placeholder:text-[#9a9a9a] focus:border-[#0f8b73] focus:bg-white"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#e3e6e4] pt-3 text-[10px] text-[#737373]">
        <span>Use one medication per line when possible.</span>
        {field.sourceFile ? <span className="font-black text-[#317f8f]">Source: {field.sourceFile}</span> : <span>Manual chart entry</span>}
      </div>
    </section>
  );
}

const persistedFieldKeys = persistedCanvasFieldKeys;
type PersistedFieldKey = PersistedCanvasFieldKey;

function isPersistedFieldKey(value: DirtyDraftKey): value is PersistedFieldKey {
  return isPersistedCanvasFieldKey(value);
}

function referralDraftValue(referral: Referral, key: PersistedFieldKey) {
  return referralCanvasValue(referral, key);
}

function canvasAdmissionRequirements(current: Referral, values: DraftValueSnapshot, ownerId: string) {
  return createDefaultAdmissionRequirements(
    current.requirements ?? [], getEvidenceByType(values.documents), new Date().toISOString(),
    values.fields.owner.value.trim() || "Unassigned", ownerId || undefined,
    {
      date_of_birth: values.fields.dob.value,
      community: pipelineCommunities.includes(values.fields.community.value.trim() as PipelineCommunity)
        ? values.fields.community.value.trim() : current.community,
      referral_source: values.fields.referent.value,
    },
  );
}

function canvasMutationKey(id: number, keys: ReadonlySet<DirtyDraftKey>, values: DraftValueSnapshot, packetHash: string | undefined, ownerId: string, handoffReason: string) {
  const ownerTouched = keys.has("owner");
  return JSON.stringify([id, [...keys].sort().map((key) => [key, draftKeySignature(key, values)]),
    packetHash, ownerTouched ? ownerId : null, ownerTouched ? handoffReason : null]);
}

function canvasMutationBody(current: Referral, patch: ReturnType<typeof buildCanvasPatch>, clientMutationId: string, ownerTouched: boolean, ownerId: string, handoffReason: string) {
  const expectedSections = normalizeReferralSectionVersions(current.sectionVersions);
  const touchedSections = getReferralPatchSections({
    ...patch,
    ...(ownerTouched ? { requirements: current.requirements ?? [] } : {}),
  } as Record<string, unknown>);
  return JSON.stringify({
    if_match: current.version,
    if_match_sections: Object.fromEntries(touchedSections.map((section) => [section, expectedSections[section]])),
    client_mutation_id: clientMutationId, patch,
    ...(ownerTouched ? { assignee_id: ownerId || undefined } : {}),
    ...(ownerTouched && handoffReason ? { handoff_reason: handoffReason } : {}),
  });
}

function fieldsFromReferral(current: Record<FieldKey, PacketField>, referral: Referral) {
  return Object.fromEntries(persistedFieldKeys.map((key) => [key, {
    ...current[key],
    value: referralDraftValue(referral, key),
    ...(referral.fieldSources?.[key] ? { sourceFile: referral.fieldSources[key] } : { sourceFile: undefined }),
  }])) as Record<FieldKey, PacketField>;
}

function mergeRemoteReferralFields(
  current: Record<FieldKey, PacketField>,
  latest: Referral,
  dirty: ReadonlySet<DirtyDraftKey>,
) {
  const next = { ...current };
  for (const key of persistedFieldKeys) {
    if (dirty.has(key)) continue;
    next[key] = {
      ...current[key],
      value: referralDraftValue(latest, key),
      sourceFile: latest.fieldSources?.[key],
    };
  }
  return next;
}

type RemoteFieldConflictInput = {
  base: Referral;
  latest: Referral;
  dirty: ReadonlySet<DirtyDraftKey>;
  fields: Record<FieldKey, PacketField>;
  conserved: "yes" | "no" | "";
  tags: string;
  documents: Record<string, string>;
  initialPacket: File | null;
};

function buildRemoteFieldConflicts(input: RemoteFieldConflictInput) {
  return [...buildPersistedFieldConflicts(input), ...buildRemoteMetadataConflicts(input)];
}

function buildPersistedFieldConflicts(input: RemoteFieldConflictInput) {
  const conflicts: RemoteFieldConflict[] = [];
  for (const key of persistedFieldKeys) {
    if (!input.dirty.has(key)) continue;
    const baseValue = referralDraftValue(input.base, key);
    const remoteValue = referralDraftValue(input.latest, key);
    const localValue = input.fields[key].value;
    const baseSource = input.base.fieldSources?.[key] ?? "";
    const remoteSource = input.latest.fieldSources?.[key] ?? "";
    const localSource = input.fields[key].sourceFile ?? "";
    if ((baseValue !== remoteValue || baseSource !== remoteSource)
      && (localValue !== remoteValue || localSource !== remoteSource)) {
      conflicts.push({ key, label: input.fields[key].label, localValue, remoteValue });
    }
  }
  return conflicts;
}

function buildRemoteMetadataConflicts(input: RemoteFieldConflictInput) {
  const conflicts: RemoteFieldConflict[] = [];
  if (input.dirty.has("tags")) {
    const baseValue = (input.base.tags ?? []).join(", ");
    const remoteValue = (input.latest.tags ?? []).join(", ");
    const localValue = normalizeTags(input.tags).join(", ");
    if (baseValue !== remoteValue && localValue !== remoteValue) {
      conflicts.push({ key: "tags", label: "Tags", localValue, remoteValue });
    }
  }

  return [...conflicts, ...buildConservedConflicts(input), ...buildRemoteFileConflicts(input)];
}

function buildRemoteFileConflicts(input: RemoteFieldConflictInput) {
  const conflicts: RemoteFieldConflict[] = [];
  if (input.dirty.has("documents")) {
    const baseValue = documentNames(documentsFromReferral(input.base));
    const remoteValue = documentNames(documentsFromReferral(input.latest));
    const localValue = documentNames(input.documents);
    if (baseValue !== remoteValue && localValue !== remoteValue) {
      conflicts.push({ key: "documents", label: "Admission documents", localValue, remoteValue });
    }
  }

  if (input.dirty.has("initialPacket") && input.initialPacket && input.base.documentHash !== input.latest.documentHash) {
    conflicts.push({
      key: "initialPacket",
      label: "Initial packet",
      localValue: input.initialPacket.name,
      remoteValue: input.latest.documentName || "No packet",
    });
  }
  return conflicts;
}

function documentsFromReferral(referral: Referral) {
  return Object.fromEntries(
    [...requirements, ...attachments]
      .map((definition) => [
        definition.id,
        referral.requirements?.find((item) => item.type === definition.type)?.evidenceDocumentName,
      ] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
}

function initialDocumentCategoryFromReferral(referral: Referral): InitialDocumentCategory {
  const faceSheet = referral.requirements?.find((item) => item.type === "face_sheet");
  return referral.documentName && faceSheet?.evidenceDocumentName === referral.documentName
    ? "face_sheet"
    : "referral_packet";
}

function isPacketProjectionPendingError(error: unknown) {
  if (!(error instanceof PipelineApiError) || error.status !== 409) return false;
  const payload = error.payload;
  return Boolean(
    payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && "code" in payload
    && payload.code === "packet_projection_pending",
  );
}

function shouldReloadExtractionConflict(error: unknown, fieldReviewSaved: boolean) {
  return error instanceof PipelineApiError
    && error.status === 409
    && !fieldReviewSaved
    && !isPacketProjectionPendingError(error);
}

function documentNames(documents: Record<string, string>) {
  return Object.values(documents).filter(Boolean).sort().join(", ");
}

function buildCanvasPatch(input: {
  keys: ReadonlySet<DirtyDraftKey>;
  fields: Record<FieldKey, PacketField>;
  conserved: "yes" | "no" | "";
  tags: string[];
  requirements: Referral["requirements"];
  existingFieldSources?: Referral["fieldSources"];
  packet?: { file: File; hash: string };
}): ReferralPatch {
  const { packet, ...canvasInput } = input;
  return buildReferralCanvasPatch({
    ...canvasInput,
    ...(packet
      ? { packet: { name: packet.file.name, size: packet.file.size, hash: packet.hash } }
      : {}),
  });
}

function reviewedPacketFields(
  existing: ExtractedField[],
  result: PacketFieldReviewResult,
  currentPacket: PacketFieldsResponse | null,
) {
  if (currentPacket) return currentPacket.fields;
  return existing.map((field) => field.field_key === result.field_key
    ? {
        ...field,
        version: result.version,
        review_status: result.review_status,
        final_value: result.final_value,
      }
    : field);
}

function prepareReviewedExtraction(input: {
  fieldKey: string;
  packetFields: ExtractedField[];
  currentPacket: PacketFieldsResponse | null;
  currentFields: Record<FieldKey, PacketField>;
  dirtyKeys: ReadonlySet<DirtyDraftKey>;
  allowManualOverride: boolean;
  documentName: string;
  requirements: Referral["requirements"];
  conserved: "yes" | "no" | "";
  tags: string[];
  projectionWasServerOwned: boolean;
  currentReferral: Referral;
}) {
  const mappedKeys = new Set(extractedCanvasFieldKeys(input.fieldKey));
  const extractionDirtyKeys = new Set(input.dirtyKeys);
  for (const key of mappedKeys) extractionDirtyKeys.delete(key);
  const mappedFields = populateFormFromExtraction(
    input.currentFields,
    input.packetFields,
    input.documentName,
    extractionDirtyKeys,
    input.allowManualOverride ? mappedKeys : new Set(),
  );
  const mappedFieldKeys = new Set<PersistedFieldKey>(
    persistedFieldKeys.filter((key) => mappedKeys.has(key) && (
      mappedFields[key].value !== input.currentFields[key].value
      || mappedFields[key].sourceFile !== input.currentFields[key].sourceFile
    )),
  );
  const mappedPatch = buildCanvasPatch({
    keys: mappedFieldKeys,
    fields: mappedFields,
    conserved: input.conserved,
    tags: input.tags,
    requirements: input.requirements,
    existingFieldSources: input.currentReferral.fieldSources,
  });
  const referralPatch: ReferralPatch = {
    ...mappedPatch,
    ...(!input.projectionWasServerOwned ? { packetFields: input.packetFields } : {}),
    ...(!input.projectionWasServerOwned && input.currentPacket
      ? {
          packetReadiness: input.currentPacket.ehr_readiness,
          packetCompleteness: input.currentPacket.packet_completeness,
        }
      : {}),
  };
  return { mappedFieldKeys, mappedFields, referralPatch, currentReferral: input.currentReferral };
}

function resolveDraftCommunity(value: string, fallback: string | undefined): PipelineCommunity {
  const selected = value.trim() as PipelineCommunity;
  if (pipelineCommunities.includes(selected)) return selected;
  if (pipelineCommunities.includes(fallback as PipelineCommunity)) return fallback as PipelineCommunity;
  return "Unassigned";
}

function referralCreateTags(tags: string[], owner: string, community: PipelineCommunity) {
  if (tags.length > 0) return tags;
  const defaults = ["packet-import", "needs-review"];
  if (!isAssignedValue(owner) || community === "Unassigned") defaults.push("needs-assignment");
  return defaults;
}

function initialDocumentInput(packet: File | null, hash: string | undefined) {
  if (!packet) return {};
  return { document: { name: packet.name, size: packet.size, hash } };
}

function packetPatch(packet: File | null, hash: string | undefined) {
  if (!packet || !hash) return undefined;
  return { file: packet, hash };
}

async function resolveInitialDocumentHash(
  packet: File | null,
  existingHash: string | undefined,
  setSavedAt: Dispatch<SetStateAction<string>>,
) {
  if (!packet) return existingHash;
  setSavedAt("Checking packet...");
  return hashPacket(packet);
}

function assertInitialDocumentLinked(
  referral: Referral,
  category: InitialDocumentCategory,
  documentId: string | undefined,
) {
  if (category !== "face_sheet" || !documentId) return;
  const faceSheet = referral.requirements?.find((item) => item.type === "face_sheet");
  if (faceSheet?.evidenceDocumentId !== documentId) {
    throw new Error("The face sheet was stored, but its checklist item was not updated. Retry the upload.");
  }
}

function changedExtractionKeys(
  current: Record<FieldKey, PacketField>,
  extracted: Record<FieldKey, PacketField>,
  dirtyKeys: ReadonlySet<DirtyDraftKey>,
) {
  return new Set<PersistedFieldKey>(persistedFieldKeys.filter((key) => (
    !dirtyKeys.has(key)
    && (extracted[key].value !== current[key].value
      || extracted[key].sourceFile !== current[key].sourceFile)
  )));
}

function mergeExtractedFields(
  current: Record<FieldKey, PacketField>,
  extracted: Record<FieldKey, PacketField>,
  extractedKeys: ReadonlySet<PersistedFieldKey>,
  dirtyKeys: ReadonlySet<DirtyDraftKey>,
) {
  const next = { ...current };
  for (const key of extractedKeys) {
    if (!dirtyKeys.has(key)) next[key] = extracted[key];
  }
  return next;
}

function packetUploadStatusMessage(mock: boolean, pageCount: number) {
  if (!referralDocumentAutofillEnabled) return "Document saved.";
  if (!mock) return "Packet uploaded and extraction started.";
  const pageLabel = pageCount === 1 ? "page" : "pages";
  return `Development local extraction completed. ${pageCount} source ${pageLabel} preserved; confirm the stripped values below.`;
}

function referralBaseDraftValue(referral: Referral | null, key: DirtyDraftKey) {
  if (!referral) return "";
  if (isPersistedFieldKey(key)) return JSON.stringify([
    referralDraftValue(referral, key),
    referral.fieldSources?.[key] ?? "",
  ]);
  if (key === "conserved") return referral.conserved ?? "";
  if (key === "tags") return (referral.tags ?? []).join("\n");
  if (key === "documents") return JSON.stringify(Object.entries(documentsFromReferral(referral)).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify([referral.documentName, referral.documentSizeBytes ?? 0, referral.documentHash ?? ""]);
}

type DraftRestoreSetters = {
  setFields: Dispatch<SetStateAction<Record<FieldKey, PacketField>>>;
  setConserved: Dispatch<SetStateAction<"yes" | "no" | "">>;
  setTagsInput: Dispatch<SetStateAction<string>>;
  setDocuments: Dispatch<SetStateAction<Record<string, string>>>;
  setInitialPacketCategory: Dispatch<SetStateAction<InitialDocumentCategory>>;
  setDirtyKeys: Dispatch<SetStateAction<Set<DirtyDraftKey>>>;
  setRecoveredDraftAt: Dispatch<SetStateAction<string>>;
  setRecoveredPacketName: Dispatch<SetStateAction<string>>;
};

function restoreSessionDraft(draftReference: ReferralRecoveryDraftKey, setters: DraftRestoreSetters) {
  let draft: CanvasSessionDraft | null = null;
  try {
    const raw = window.sessionStorage.getItem(canvasDraftStorageKey(draftReference));
    if (!raw) return null;
    draft = parsePipelineReferralDraft(JSON.parse(raw));
    if (!draft) return null;
  } catch {
    void clearSessionDraft(draftReference);
    return null;
  }

  return applyRecoveryDraft(draft, setters);
}

function applyRecoveryDraft(draft: CanvasSessionDraft, setters: DraftRestoreSetters) {
  const dirty = new Set(draft.dirtyKeys.filter((key) => key !== "initialPacket"));
  setters.setFields((current) => {
    const next = { ...current };
    for (const key of persistedFieldKeys) {
      if (!dirty.has(key)) continue;
      const candidate = draft?.fields[key];
      if (!candidate || typeof candidate.value !== "string") continue;
      next[key] = {
        ...current[key],
        value: candidate.value,
        sourceFile: typeof candidate.sourceFile === "string" ? candidate.sourceFile : undefined,
      };
    }
    return next;
  });
  if (dirty.has("conserved")) setters.setConserved(draft.conserved);
  if (dirty.has("tags")) setters.setTagsInput(draft.tagsInput);
  if (dirty.has("documents")) setters.setDocuments(draft.documents);
  setters.setInitialPacketCategory(draft.initialPacketCategory ?? "face_sheet");
  setters.setDirtyKeys(dirty);
  setters.setRecoveredDraftAt(draft.savedAt);
  setters.setRecoveredPacketName(draft.initialPacketName ?? "");
  return draft;
}

function buildRecoveredDraftConflicts(draft: CanvasSessionDraft, latest: Referral) {
  if (!draft.baseVersion) return [];
  const conflicts: RemoteFieldConflict[] = [];
  for (const key of draft.dirtyKeys) {
    if (key === "initialPacket") continue;
    const baseValue = draft.baseValues?.[key];
    if (baseValue === undefined) continue;
    const remoteComparison = referralBaseDraftValue(latest, key);
    const localComparison = isPersistedFieldKey(key)
      ? JSON.stringify([draft.fields[key]?.value ?? "", draft.fields[key]?.sourceFile ?? ""])
      : key === "conserved"
        ? draft.conserved
        : key === "tags"
          ? normalizeTags(draft.tagsInput).join("\n")
          : JSON.stringify(Object.entries(draft.documents).sort(([left], [right]) => left.localeCompare(right)));
    if (baseValue === remoteComparison || localComparison === remoteComparison) continue;
    conflicts.push({
      key,
      label: dirtyKeyLabel(key),
      localValue: draftDisplayValue(draft, key),
      remoteValue: remoteDisplayValue(latest, key),
    });
  }
  return conflicts;
}

function draftDisplayValue(draft: CanvasSessionDraft, key: DirtyDraftKey) {
  if (isPersistedFieldKey(key)) return draft.fields[key]?.value ?? "";
  if (key === "conserved") return conservedLabel(draft.conserved);
  if (key === "tags") return normalizeTags(draft.tagsInput).join(", ");
  if (key === "documents") return documentNames(draft.documents);
  return draft.initialPacketName ?? "";
}

function remoteDisplayValue(referral: Referral, key: DirtyDraftKey) {
  if (isPersistedFieldKey(key)) return referralDraftValue(referral, key);
  if (key === "conserved") return conservedLabel(referral.conserved ?? "");
  if (key === "tags") return (referral.tags ?? []).join(", ");
  if (key === "documents") return documentNames(documentsFromReferral(referral));
  return referral.documentName;
}

function dirtyKeyLabel(key: DirtyDraftKey) {
  if (isPersistedFieldKey(key)) return initialFields[key].label;
  return {
    conserved: "Conserved",
    tags: "Tags",
    documents: "Admission documents",
    initialPacket: "Initial packet",
  }[key];
}

function conservedLabel(value: Referral["conserved"]) {
  return value === "yes" ? "Yes" : value === "no" ? "No" : "Not entered";
}

function newReferralCreationMutationId(draftReference?: `new-${string}`) {
  return draftReference
    ? `referral-create:${draftReference}`
    : `referral-create:${createMutationId()}`;
}

async function clearSessionDraft(draftReference?: ReferralRecoveryDraftKey) {
  if (usesServerReferralDrafts()) {
    await clearLocalReferralRecovery(draftReference).catch(() => undefined);
    await clearServerReferralDraft(draftReference).catch(() => undefined);
    return;
  }
  try {
    window.sessionStorage.removeItem(canvasDraftStorageKey(draftReference));
  } catch {
    // Session recovery is best effort; canonical data remains server-side.
  }
}

function getConflictReferral(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const referral = (payload as { referral?: unknown }).referral;
  if (!referral || typeof referral !== "object" || Array.isArray(referral)) return null;
  const candidate = referral as Partial<Referral>;
  return Number.isSafeInteger(candidate.id) && typeof candidate.name === "string"
    ? referral as Referral
    : null;
}

function getSuspectedDuplicateReview(payload: unknown): ReferralDuplicateReview | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (value.suspected_duplicate !== true || !Array.isArray(value.candidates)) return null;
  const candidates = parseReferralDuplicateCandidates(value.candidates);
  if (!candidates) return null;
  const confirmationReferralIds = parsePositiveReferralIds(value.confirmation_referral_ids);
  const canConfirmDistinctPerson = canConfirmReferralDuplicate(value, candidates, confirmationReferralIds);
  return {
    canConfirmDistinctPerson,
    confirmationReferralIds: canConfirmDistinctPerson ? confirmationReferralIds : [],
    candidates,
  };
}

const referralDuplicateTextFields = [
  "name",
  "county",
  "community",
  "date_of_birth",
  "referral_received",
  "owner",
  "stage",
] as const;

function parseReferralDuplicateCandidates(value: unknown[]): ReferralDuplicateReview["candidates"] | null {
  const candidates = value.map(parseReferralDuplicateCandidate);
  return candidates.some((candidate) => candidate === null)
    ? null
    : candidates as ReferralDuplicateReview["candidates"];
}

function parseReferralDuplicateCandidate(candidate: unknown): ReferralDuplicateReview["candidates"][number] | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const item = candidate as Record<string, unknown>;
  const hasTextFields = referralDuplicateTextFields.every((field) => typeof item[field] === "string");
  if (!Number.isSafeInteger(item.referral_id) || Number(item.referral_id) <= 0 || !hasTextFields) return null;
  if (!pipelineCommunities.includes(item.community as PipelineCommunity) || typeof item.in_trash !== "boolean") return null;
  return {
    referral_id: Number(item.referral_id),
    name: item.name as string,
    county: item.county as string,
    community: item.community as PipelineCommunity,
    date_of_birth: item.date_of_birth as string,
    referral_received: item.referral_received as string,
    owner: item.owner as string,
    stage: item.stage as string,
    in_trash: item.in_trash,
  };
}

function parsePositiveReferralIds(value: unknown) {
  return Array.isArray(value)
    ? value.filter((id): id is number => Number.isSafeInteger(id) && Number(id) > 0)
    : [];
}

function canConfirmReferralDuplicate(
  value: Record<string, unknown>,
  candidates: ReferralDuplicateReview["candidates"],
  confirmationReferralIds: number[],
) {
  const candidateIds = new Set(candidates.map((candidate) => candidate.referral_id));
  return value.can_confirm_distinct_person === true
    && confirmationReferralIds.length > 0
    && confirmationReferralIds.every((id) => candidateIds.has(id));
}

const duplicateIdentityFields = new Set<FieldKey>(["name", "county", "community"]);

function referralSaveBlockedMessage(uploadingDocumentCount: number, hasConflicts: boolean) {
  if (uploadingDocumentCount > 0) return "Wait for the selected documents to finish uploading before saving again.";
  return hasConflicts ? "Resolve the remote field changes before saving." : "";
}

function referralRecoveryDraftReference(
  referralId: number | undefined,
  newDraftKey: `new-${string}` | undefined,
): ReferralRecoveryDraftKey {
  return referralId ?? newDraftKey;
}

function workspaceHasPendingChanges(
  dirtyKeys: ReadonlySet<DirtyDraftKey>,
  pendingDocuments: Record<string, File>,
  initialPacket: File | null,
) {
  return dirtyKeys.size > 0 || Object.keys(pendingDocuments).length > 0 || Boolean(initialPacket);
}

function workspaceHasQueuedChanges(
  dirtyKeys: ReadonlySet<DirtyDraftKey>,
  pendingDocuments: Record<string, File>,
  initialPacket: File | null,
  additionalFiles: readonly LabeledReferralFile[],
) {
  return workspaceHasPendingChanges(dirtyKeys, pendingDocuments, initialPacket) || additionalFiles.length > 0;
}

function extractionPacketId(referral: Referral | null) {
  return !referralDocumentAutofillEnabled || referral?.workspaceStatus === "historical" ? undefined : referral?.packetId;
}

function activeReferralId(loadedReferral: Referral | null, referral: { id: number } | undefined) {
  return loadedReferral?.id ?? referral?.id;
}

function presenceSection(page: WorkspaceView): ReferralSection {
  if (page === "files") return "documents";
  if (page === "activity" || page === "email") return "workflow";
  if (page === 3) return "assessment";
  if (page === 2) return "assessment";
  return "intake";
}

function presenceSectionLabel(section: ReferralSection) {
  return {
    identity: "Identity",
    intake: "Intake",
    documents: "Documents",
    assessment: "Assessment",
    workflow: "Workflow",
    decision: "Workflow",
  }[section];
}

function dedupePresence(items: ReferralPresenceView[]) {
  const byActorAndSection = new Map<string, ReferralPresenceView>();
  for (const item of items) {
    const key = `${item.actor_id}:${item.section}`;
    const current = byActorAndSection.get(key);
    if (!current || item.expires_at > current.expires_at) byActorAndSection.set(key, item);
  }
  return [...byActorAndSection.values()];
}

function workspaceTagsInput(tags: string[] | undefined) {
  return (tags ?? []).filter((tag) => !isInternalWorkspaceTag(tag)).join(", ");
}

function validateInitialPacketSelection(file: File | undefined): InitialPacketSelectionResult {
  if (!file) return { accepted: false };
  if (file.size === 0 || file.size > maxUploadFileBytes) {
    return { accepted: false, error: "Choose a nonempty file, up to 100 MB." };
  }
  return { accepted: true, file };
}

function isRetryableIntakeSave(error: unknown) {
  return error instanceof PipelineApiError && [0, 429, 500, 502, 503, 504].includes(error.status);
}

function intakeSaveFailureStatus(error: unknown) {
  return isRetryableIntakeSave(error) ? "Not synced · retry Save" : "Pending · you can keep navigating";
}

function buildConservedConflicts(input: RemoteFieldConflictInput) {
  const conflicts: RemoteFieldConflict[] = [];
  if (input.dirty.has("conserved")) {
    const baseValue = input.base.conserved ?? "";
    const remoteValue = input.latest.conserved ?? "";
    const localValue = conservedLabel(input.conserved);
    if (baseValue !== remoteValue && input.conserved !== remoteValue) {
      conflicts.push({
        key: "conserved",
        label: "Conserved",
        localValue,
        remoteValue: conservedLabel(remoteValue),
      });
    }
  }

  return conflicts;
}
