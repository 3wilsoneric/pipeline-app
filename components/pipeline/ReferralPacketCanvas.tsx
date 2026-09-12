"use client";

import { useEffect, useEffectEvent, useRef, useState, type Dispatch, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCheck,
  FileText,
  FolderOpen,
  History,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { pipelineCommunities, type PipelineCommunity } from "@/lib/pipeline/community-config";
import {
  californiaCountyOptions,
  isImportedWorkspace,
  isInternalWorkspaceTag,
} from "@/lib/pipeline/workspace-presentation";
import PacketExtractionReview from "@/components/pipeline/PacketExtractionReview";
import AssessmentWorkspace, { assessmentOpenLabel } from "@/components/pipeline/AssessmentWorkspace";
import AssessmentChartWorkspace from "@/components/pipeline/AssessmentChartWorkspace";
import TransferredWorkspaceChart from "@/components/pipeline/TransferredWorkspaceChart";
import { ClientChartFrame, ClientChartHeader, ChartHeaderCell, ChartBand } from "@/components/pipeline/ClientMedicalChart";
import type { AssessmentListResponse } from "@/lib/assessment/assessment-records";
import DeleteWorkspaceDialog from "@/components/pipeline/DeleteWorkspaceDialog";
import ActionDetailDialog from "@/components/pipeline/ActionDetailDialog";
import DuplicateReferralReviewDialog, {
  type ReferralDuplicateReview,
} from "@/components/pipeline/DuplicateReferralReviewDialog";
import ReferralActivityPanel from "@/components/pipeline/ReferralActivityPanel";
import StructuredNarrativeField from "@/components/pipeline/StructuredNarrativeField";
import type {
  Referral,
  ReferralCanvasFieldKey,
  ReferralSection,
  RequirementType,
} from "@/lib/pipeline/referral-types";
import { isUnassignedOwner } from "@/lib/pipeline/referral-ownership";
import type { ReferralCreateInput, ReferralPatch } from "@/lib/pipeline/referral-store";
import {
  fetchCurrentPipelineUser,
  fetchPipelineJson,
  PipelineApiError,
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
import { createDefaultAdmissionRequirements } from "@/lib/pipeline/workflow-records";
import type { ReferralChangeSnapshot, ReferralPresenceView } from "@/lib/pipeline/collaboration-types";
import { getReferralPatchSections, normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import { documentCategoryForRequirement } from "@/lib/pipeline/document-requirements";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";
import {
  allowedUploadContentTypes,
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
  getPacketContentType,
  hashPacket,
  uploadReferralPacket,
  uploadReferralSupportingDocument,
  type InitialDocumentCategory,
} from "@/lib/pipeline/referral-packet-upload";
import {
  extractedCanvasFieldKeys,
  populateFormFromExtraction,
  type ReferralCanvasDirtyKey,
  type ReferralCanvasPacketField,
} from "@/lib/pipeline/referral-canvas-extraction";
import {
  buildReferralCanvasCreateInput,
  buildReferralCanvasPatch,
  isPersistedCanvasFieldKey,
  persistedCanvasFieldKeys,
  referralCanvasValue,
  type PersistedCanvasFieldKey,
} from "@/lib/pipeline/referral-canvas-persistence";
import {
  canvasDraftStorageKey,
  captureReferralSaveSnapshot,
  currentDraftValues,
  mergePendingDocumentNames,
  normalizeTags,
  reconcileSavedDirtyKeys,
  referralDraftSaveStatus,
  referralSaveStatus,
  type ReferralSaveSnapshot,
} from "@/components/pipeline/referral-canvas-save-state";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import ReferralContactsCard from "@/components/pipeline/ReferralContactsCard";

const ReferralWorkflowPanel = dynamic(
  () => import("@/components/pipeline/ReferralWorkflowPanel"),
  {
    loading: () => (
      <p aria-live="polite" className="text-sm text-[#666]">
        Loading workflow…
      </p>
    ),
  },
);

type FieldKey = ReferralCanvasFieldKey;

type PacketField = ReferralCanvasPacketField;

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
  trainingAssessmentMode?: TrainingAssessmentMode;
  trainingAssessmentSection?: AssessmentToolSection;
  trainingIntakeMode?: boolean;
  onReferralSaved?: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onReferralDeleted?: () => void;
  onWorkspaceStageChange?: (stage: WorkspaceStageName) => void;
  onWorkspaceLocationChange?: (location: PipelineWorkspaceLocation) => void;
  onOpenProfile?: (canonicalClientId: string) => void;
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
type WorkspaceView = WorkspaceStage | "workflow" | "files" | "activity";
type WorkspaceStageName = "intake" | "assessment" | "chart";

const packetSteps: ReadonlyArray<{ page: WorkspaceStage; label: string }> = [
  { page: 1, label: "Intake" },
  { page: 2, label: "Assessment" },
  { page: 3, label: "Chart" },
] as const;

const importedWorkspaceSteps: ReadonlyArray<{ page: WorkspaceStage; label: string }> = [
  { page: 1, label: "Chart" },
] as const;

function mutableReferralId(loadedReferral: Referral | null, routeReferralId?: number) {
  if (!loadedReferral || loadedReferral.id !== routeReferralId || loadedReferral.workspaceStatus === "historical") return null;
  return routeReferralId;
}

function visibleWorkspacePage(
  activePage: WorkspaceView,
  steps: ReadonlyArray<{ page: WorkspaceStage; label: string }>,
): WorkspaceView {
  if (steps.length === 1 && activePage === "workflow") return 1;
  if (typeof activePage !== "number" || steps.some((step) => step.page === activePage)) return activePage;
  return steps[0]?.page ?? 1;
}

function showWorkspaceEditingControls(trainingAssessmentMode: TrainingAssessmentMode | undefined, readOnly: boolean) {
  return !trainingAssessmentMode && !readOnly;
}

function showWorkspaceTrashControl(referral: Referral | null, canSupervise: boolean, readOnly: boolean) {
  return Boolean(referral && canSupervise && !readOnly);
}

const initialFields: Record<FieldKey, PacketField> = {
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
  community: { label: "Community:", value: "", placeholder: "Select destination" },
  county: { label: "County:", value: "", placeholder: "Select county" },
  referent: { label: "Referent:", value: "", placeholder: "" },
  responsiblePerson: {
    label: "Responsible Person:",
    value: "",
    placeholder: "",
  },
  phone: { label: "Client phone:", value: "", placeholder: "Phone number" },
  email: { label: "Client email:", value: "", placeholder: "Email address" },
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

const visibleChartFieldKeys: readonly FieldKey[] = [
  "name",
  "gender",
  "age",
  "dob",
  "ssn",
  "owner",
  "referralReceived",
  "admissionDate",
  "community",
  "county",
  "referent",
  "responsiblePerson",
  "phone",
  "email",
  "summary",
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

export default function ReferralPacketCanvas({
  referral,
  newDraftKey,
  initialWorkspaceStage = "intake",
  initialWorkspaceLocation,
  trainingAssessmentMode,
  trainingAssessmentSection,
  trainingIntakeMode = false,
  onReferralSaved,
  onReferralDeleted,
  onWorkspaceStageChange,
  onWorkspaceLocationChange,
  onOpenProfile = () => undefined,
}: ReferralPacketCanvasProps = {}) {
  const [fields, setFields] = useState<Record<FieldKey, PacketField>>(() => ({
    ...initialFields,
    name: { ...initialFields.name, value: referral?.name ?? "" },
  }));
  const [conserved, setConserved] = useState<"yes" | "no" | "">("");
  const [documents, setDocuments] = useState<Record<string, string>>({});
  const [pendingDocuments, setPendingDocuments] = useState<Record<string, File>>({});
  const [uploadingDocumentIds, setUploadingDocumentIds] = useState<Set<string>>(() => new Set());
  const [initialPacket, setInitialPacket] = useState<File | null>(null);
  const [initialPacketCategory, setInitialPacketCategory] = useState<InitialDocumentCategory>("face_sheet");
  const [tagsInput, setTagsInput] = useState("");
  const routedWorkspaceLocation = initialWorkspaceLocationOrStage(initialWorkspaceLocation, initialWorkspaceStage);
  const [activePage, setActivePage] = useState<WorkspaceView>(workspacePageForLocation(routedWorkspaceLocation));
  const [assessmentSummary, setAssessmentSummary] = useState<{
    captured: number;
    total: number;
    status: string;
    assessmentId?: string;
    scheduledStartAt?: string | null;
    startedAt?: string | null;
    signedAt?: string | null;
  }>({
    captured: 0,
    total: 52,
    status: "not_started",
  });
  const [savedAt, setSavedAt] = useState(referral?.id ? "Loading referral..." : "Draft");
  const [loadedReferral, setLoadedReferral] = useState<Referral | null>(null);
  const serverDraftsEnabled = usesServerReferralDrafts() && !trainingIntakeMode;
  const [draftRecoveryLoading, setDraftRecoveryLoading] = useState(serverDraftsEnabled);
  const [isSaving, setIsSaving] = useState(false);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<number | null>(null);
  const [schedulingReferralId, setSchedulingReferralId] = useState<number | null>(null);
  const [reviewBusyFieldKey, setReviewBusyFieldKey] = useState<string>();
  const [isBulkReviewing, setIsBulkReviewing] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [recoveredDraftAt, setRecoveredDraftAt] = useState("");
  const [recoveredPacketName, setRecoveredPacketName] = useState("");
  const [dirtyKeys, setDirtyKeys] = useState<Set<DirtyDraftKey>>(() => new Set());
  const [remoteChange, setRemoteChange] = useState<RemoteChange | null>(null);
  const [extractionConflict, setExtractionConflict] = useState<ExtractionReviewConflict | null>(null);
  const [presence, setPresence] = useState<ReferralPresenceView[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [canSupervise, setCanSupervise] = useState(false);
  const [ownerPrincipalId, setOwnerPrincipalId] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [duplicateReview, setDuplicateReview] = useState<ReferralDuplicateReview | null>(null);
  const [pendingOwnerChange, setPendingOwnerChange] = useState<{ principalId: string; displayName: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const editableReferralId = mutableReferralId(loadedReferral, referral?.id);
  const canvasRef = useRef<HTMLDivElement>(null);
  const loadedReferralRef = useRef<Referral | null>(null);
  const fieldsRef = useRef(fields);
  const tagsInputRef = useRef(tagsInput);
  const documentsRef = useRef(documents);
  const pendingDocumentsRef = useRef(pendingDocuments);
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

  useEffect(() => {
    const referralId = editableReferralId;
    if (!referralId) {
      setAssessmentSummary({ captured: 0, total: 52, status: "not_started" });
      return;
    }
    setAssessmentSummary({ captured: 0, total: 52, status: "not_started" });
    let cancelled = false;
    fetchPipelineJson<AssessmentListResponse>(`/api/referrals/${referralId}/assessments`, { cache: "no-store" })
      .then((payload) => {
        if (cancelled) return;
        const assessment = payload.assessments[0];
        if (!assessment) return;
        setAssessmentSummary({
          captured: 0,
          total: 52,
          status: assessment.status,
          assessmentId: assessment.assessment_id,
          scheduledStartAt: assessment.scheduled_start_at,
          startedAt: assessment.started_at,
          signedAt: assessment.signed_at,
        });
      })
      .catch(() => {
        // Workspace navigation remains usable if the assessment summary cannot be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, [editableReferralId]);

  useEffect(() => {
    let cancelled = false;
    fetchPipelineJson<{ members: WorkspaceMember[]; current_principal_id: string }>("/api/members?scope=assessors", { cache: "no-store" }, { cacheTtlMs: 30_000 })
      .then((payload) => {
        if (cancelled) return;
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
        if (!cancelled) setSaveError("The owner list could not be loaded. Existing work remains available.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentPipelineUser()
      .then(({ user }) => {
        if (!cancelled) setCanSupervise(Boolean(user?.roles.some((role) => role === "admin" || role === "assessment_coordinator")));
      })
      .catch(() => {
        if (!cancelled) setCanSupervise(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const captureRecoveryDraft = (): CanvasSessionDraft | null => {
    const activeDirtyKeys = dirtyKeysRef.current;
    if (activeDirtyKeys.size === 0 && Object.keys(pendingDocumentsRef.current).length === 0) return null;
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

  const persistRecoveryDraft = (reportStatus: boolean) => {
    const draft = captureRecoveryDraft();
    if (!draft) return;
    const revision = draftRevisionRef.current;
    const reference = recoveryDraftReferenceRef.current;
    if (serverDraftsEnabled) {
      void saveServerReferralDraft(reference, draft)
        .then(() => {
          if (reportStatus && !loadedReferralRef.current && draftRevisionRef.current === revision) setSavedAt("Draft saved");
        })
        .catch((error) => {
          if (reportStatus && draftRevisionRef.current === revision) {
            const message = error instanceof Error ? error.message : "Could not save the recovery draft.";
            setSaveError(`${message} Your changes are still open in this tab.`);
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

  const rebaseDraftTracking = (latest: Referral, activeDirtyKeys: ReadonlySet<DirtyDraftKey>) => {
    if (activeDirtyKeys.size === 0) {
      clearDraftTracking();
      return;
    }
    draftBaseVersionRef.current = latest.version;
    draftBaseValuesRef.current = Object.fromEntries(
      [...activeDirtyKeys].map((key) => [key, referralBaseDraftValue(latest, key)]),
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
        void loadServerReferralDraft(newDraftKey).then((draft) => {
          if (cancelled) return;
          const recovered = draft ? restoreDraftTracking(applyRecoveryDraft(draft, setters)) : null;
          setSavedAt(recovered ? "Recovered unsaved changes" : "Draft");
        }).catch(() => {
          if (!cancelled) setSaveError("Could not check for a recovery draft.");
        }).finally(() => {
          if (!cancelled) setDraftRecoveryLoading(false);
        });
      } else {
        setDraftRecoveryLoading(false);
        const recovered = restoreDraftTracking(restoreSessionDraft(newDraftKey, setters));
        setSavedAt(recovered ? "Recovered unsaved changes" : "Draft");
      }
      return () => {
        cancelled = true;
      };
    }
    if (loadedReferralRef.current?.id === referral.id) return;

    let cancelled = false;
    if (serverDraftsEnabled) setDraftRecoveryLoading(true);
    fetchPipelineJson<{ referral?: Referral }>(`/api/referrals/${referral.id}/canvas`, { cache: "no-store" }, { cacheTtlMs: workspaceCanvasCacheTtlMs }).then((canvasPayload) => {
      if (cancelled) return;
      const savedRecord = canvasPayload.referral ?? null;
      const record = savedRecord;
      setLoadedReferral(record);
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
          if (recovered) setSavedAt("Recovered unsaved changes");
        };
        if (serverDraftsEnabled) {
          setDraftRecoveryLoading(true);
          void loadServerReferralDraft(record.id)
            .then((draft) => {
              if (!cancelled) finishRecovery(draft ? restoreDraftTracking(applyRecoveryDraft(draft, setters)) : null);
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
  }, [newDraftKey, referral?.id, serverDraftsEnabled]);

  useEffect(() => {
    const extractedFields = loadedReferral?.packetFields;
    const sourceFile = loadedReferral?.documentName;
    if (loadedReferral?.workspaceStatus === "historical" || !extractedFields?.length) return;

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
    const field = routedWorkspaceLocation.view === "intake" ? routedWorkspaceLocation.intakeField : undefined;
    if (!field || draftRecoveryLoading || activePage !== 1) return;
    if (locallyFocusedFieldRef.current === field) {
      locallyFocusedFieldRef.current = undefined;
      return;
    }
    lastFocusRef.current = field;
    const frame = window.requestAnimationFrame(() => {
      canvasRef.current?.querySelector<HTMLElement>(`[data-workspace-field="${field}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePage, draftRecoveryLoading, newDraftKey, referral?.id, routedWorkspaceLocation.intakeField, routedWorkspaceLocation.view]);

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
    setRemoteChange({
      referral: latest,
      updatedBy: updatedBy?.trim() || latest.updatedBy?.name || "Another user",
      conflicts,
    });
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
    setSaveError("");
    setDuplicateReview((current) => duplicateIdentityFields.has(key) ? null : current);
    setSavedAt("Unsaved changes");
    markDirty(key);
    setFields((current) => {
      const next = {
        ...current,
        [key]: { ...current[key], value },
      };
      fieldsRef.current = next;
      return next;
    });
  };

  const applyOwnerChange = (change: { principalId: string; displayName: string }, handoffReason = "") => {
    handoffReasonRef.current = handoffReason;
    ownerPrincipalIdRef.current = change.principalId;
    setOwnerPrincipalId(change.principalId);
    updateField("owner", change.displayName);
  };

  const attachDocument = (id: string, file: File) => {
    const contentType = getPacketContentType(file);
    if (!(allowedUploadContentTypes as readonly string[]).includes(contentType)) {
      setSaveError("Upload a PDF, JPEG, PNG, TIFF, or HEIC document.");
      return;
    }
    if (file.size > maxUploadFileBytes) {
      setSaveError("Documents must be 100 MB or smaller.");
      return;
    }
    setSavedAt("Unsaved changes");
    markDirty("documents");
    const nextDocuments = { ...documentsRef.current, [id]: file.name };
    const nextPendingDocuments = { ...pendingDocumentsRef.current, [id]: file };
    documentsRef.current = nextDocuments;
    pendingDocumentsRef.current = nextPendingDocuments;
    setDocuments(nextDocuments);
    setPendingDocuments(nextPendingDocuments);
    const currentReferral = loadedReferralRef.current;
    if (currentReferral) void uploadAndLinkSupportingDocument(currentReferral, id, file).catch(() => undefined);
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
    if (Object.keys(nextPendingDocuments).length > 0) return;
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
    markDirty("initialPacket");
    setSaveError("");
    setSavedAt("Unsaved changes");
    return selection;
  };

  const clearInitialPacket = () => {
    initialPacketRef.current = null;
    setInitialPacket(null);
    setSaveError("");
    markDirty("initialPacket");
    setSavedAt("Unsaved changes");
  };

  const openPage = (page: WorkspaceView) => {
    if (page !== 2) setSchedulingReferralId(null);
    setActivePage(page);
    if (typeof page === "number") onWorkspaceStageChange?.(workspaceStageName(page));
    onWorkspaceLocationChange?.(workspaceLocationForPage(page));
    requestAnimationFrame(() => {
      canvasRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
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
  ) => {
    const tags = normalizeTags(tagsInputRef.current);
    const admissionRequirements = createDefaultAdmissionRequirements(
      current.requirements ?? [],
      getEvidenceByType(documentsRef.current),
      new Date().toISOString(),
      fieldsRef.current.owner.value.trim() || "Unassigned",
      ownerPrincipalIdRef.current || undefined,
      {
        date_of_birth: fieldsRef.current.dob.value,
        community: pipelineCommunities.includes(fieldsRef.current.community.value.trim() as PipelineCommunity)
          ? fieldsRef.current.community.value.trim()
          : current.community,
        referral_source: fieldsRef.current.referent.value,
      },
    );
    const patch = buildCanvasPatch({
      keys,
      fields: fieldsRef.current,
      conserved: conservedRef.current,
      tags,
      requirements: admissionRequirements,
      packet,
    });
    if (Object.keys(patch).length === 0) return current;
    const expectedSections = normalizeReferralSectionVersions(current.sectionVersions);
    const touchedSections = getReferralPatchSections(patch as Record<string, unknown>);
    const ownerTouched = keys.has("owner");
    const mutationKey = JSON.stringify([current.id, current.version, patch, ownerPrincipalIdRef.current, handoffReasonRef.current]);
    const clientMutationId = patchMutationIdsRef.current.get(mutationKey) ?? createMutationId();
    patchMutationIdsRef.current.set(mutationKey, clientMutationId);
    const payload = await fetchPipelineJson<{ referral?: Referral; error?: string }>(`/api/referrals/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        if_match: current.version,
        if_match_sections: Object.fromEntries(touchedSections.map((section) => [section, expectedSections[section]])),
        client_mutation_id: clientMutationId,
        patch,
        ...(ownerTouched ? { assignee_id: ownerPrincipalIdRef.current || undefined } : {}),
        ...(ownerTouched && handoffReasonRef.current ? { handoff_reason: handoffReasonRef.current } : {}),
      }),
    });
    if (!payload.referral) throw new Error(payload.error ?? "Could not save this referral.");
    loadedReferralRef.current = payload.referral;
    setLoadedReferral(payload.referral);
    patchMutationIdsRef.current.delete(mutationKey);
    setOwnerPrincipalId(payload.referral.ownerId ?? "");
    if (ownerTouched) handoffReasonRef.current = "";
    return payload.referral;
  };

  const autosaveReferral = useEffectEvent(() => {
    if (!loadedReferralRef.current) return;
    void saveWorkspaceDraft();
  });

  useEffect(() => {
    if (!loadedReferral || trainingIntakeMode || isSaving || saveError || uploadingDocumentIds.size > 0 || remoteChange?.conflicts.length) return;
    if (!workspaceHasPendingChanges(dirtyKeys, pendingDocuments, initialPacket)) return;
    const timer = window.setTimeout(() => {
      autosaveReferral();
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [conserved, dirtyKeys, documents, fields, initialPacket, isSaving, loadedReferral, pendingDocuments, remoteChange?.conflicts.length, saveError, tagsInput, trainingIntakeMode, uploadingDocumentIds.size]);

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
    const payload = await fetchPipelineJson<{ referral?: Referral; error?: string; idempotent_replay?: boolean }>("/api/referrals", {
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
    setSavedAt("Linking extraction...");
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

  const finishReferralSave = async (savedReferral: Referral, snapshot: ReferralSaveSnapshot) => {
    const remainingDirtyKeys = reconcileSavedDirtyKeys(
      dirtyKeysRef.current,
      snapshot,
      currentDraftValues(fieldsRef.current, conservedRef.current, tagsInputRef.current, documentsRef.current, initialPacketRef.current),
      Object.keys(pendingDocumentsRef.current).length === 0,
    );
    dirtyKeysRef.current = remainingDirtyKeys;
    setDirtyKeys(remainingDirtyKeys);
    rebaseDraftTracking(savedReferral, remainingDirtyKeys);
    if (remainingDirtyKeys.size === 0) await clearSessionDraft(savedReferral.id);
    setRecoveredDraftAt("");
    setRecoveredPacketName("");
    setRemoteChange(null);
    setSavedAt(referralSaveStatus(remainingDirtyKeys.size, Boolean(snapshot.initialPacket)));
  };

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
        setCreatedWorkspaceId(savedReferral.id);
        recoveryDraftReferenceRef.current = savedReferral.id;
        onReferralSaved?.({ id: savedReferral.id, name: savedReferral.name, community: savedReferral.community });
        void clearSessionDraft(newDraftKey);
        setSavedAt(snapshot.initialPacket ? "Referral created; uploading packet..." : "Referral created");
      }
      savedReferral = await uploadAndLinkInitialPacket(savedReferral, snapshot, documentHash);
      for (const [requirementId, file] of Object.entries(snapshot.pendingDocuments)) {
        savedReferral = await uploadAndLinkSupportingDocument(savedReferral, requirementId, file);
      }
      await finishReferralSave(savedReferral, snapshot);
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
      return null;
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const saveWorkspaceDraft = async (confirmedDistinctReferralIds: number[] = []): Promise<Referral | null> => {
    if (isSavingRef.current) return null;
    setCreatedWorkspaceId(null);
    setSavedAt(loadedReferralRef.current ? "Saving changes..." : "Creating referral...");
    if (!trainingIntakeMode) return saveDraft(confirmedDistinctReferralIds);
    setSaveError("");
    setSavedAt("Practice changes saved in this tab");
    return null;
  };

  const continueToAssessment = async () => {
    if (trainingIntakeMode) {
      window.location.assign(toPipelinePath("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=schedule&demo=1"));
      return;
    }
    if (!loadedReferralRef.current || isSavingRef.current) return;
    const hasPendingChanges = dirtyKeysRef.current.size > 0
      || Object.keys(pendingDocumentsRef.current).length > 0
      || Boolean(initialPacketRef.current);
    if (hasPendingChanges) {
      const savedReferral = await saveWorkspaceDraft();
      if (!savedReferral) return;
    }
    if (workspaceHasPendingChanges(dirtyKeysRef.current, pendingDocumentsRef.current, initialPacketRef.current)) return;
    setSchedulingReferralId(loadedReferralRef.current.id);
    openPage(2);
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
      const restoredFields = { ...initialFields, name: { ...initialFields.name, value: referral?.name ?? "" } };
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
    setSavedAt(current ? "Saved record restored" : "Draft cleared");
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
  });
  const workspacePresentation = getWorkspacePresentation(
    loadedReferral,
    admissionDocumentCount,
    attachmentCount,
  );
  const { readOnly: historicalReadOnly, steps: workspaceSteps } = workspacePresentation;
  const displayedPage = visibleWorkspacePage(activePage, workspaceSteps);
  const editingControlsVisible = showWorkspaceEditingControls(trainingAssessmentMode, historicalReadOnly);
  const trashControlVisible = showWorkspaceTrashControl(loadedReferral, canSupervise, historicalReadOnly);
  const referralContextPacketFields = (loadedReferral?.packetFields ?? []).filter(
    (field) => extractedCanvasFieldKeys(field.field_key).length > 0,
  );
  const packetEvidenceVersion = loadedReferral?.packetId
    ? `${loadedReferral.packetId}:${(loadedReferral.packetFields ?? [])
        .map((field) => `${field.field_key}:${field.version}`)
        .join("|")}`
    : "";
  const hasPendingWorkspaceChanges = workspaceHasPendingChanges(dirtyKeys, pendingDocuments, initialPacket);
  const referralWorkspaceId = activeReferralId(loadedReferral, referral);
  const hasReferral = hasReferralRecord(loadedReferral, referral?.id);
  const queuedFileCount = Object.keys(pendingDocuments).length + Number(Boolean(initialPacket));
  const saveStatus = referralDraftSaveStatus(savedAt, hasReferral, queuedFileCount);

  const moveWorkspaceToTrash = async () => {
    const current = loadedReferralRef.current;
    if (!current) return;
    setIsDeleting(true);
    setSaveError("");
    try {
      await fetchPipelineJson(`/api/referrals/${current.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_match: current.version, client_mutation_id: deleteMutationIdRef.current }),
      });
      await clearSessionDraft(current.id);
      setDeleteDialogOpen(false);
      onReferralDeleted?.();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The workspace could not be moved to trash.");
      setDeleteDialogOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div ref={canvasRef} data-guide-target="packet-workspace" className="relative h-full overflow-y-auto bg-white text-[#111111]">
      {draftRecoveryLoading ? (
        <div className="absolute inset-0 z-50 flex items-start justify-center bg-white/85 pt-24" role="status" aria-live="polite">
          <div className="border-l-2 border-[#0f8b73] bg-white px-4 py-3 text-[12px] font-black text-[#174f43] shadow-sm">
            Restoring saved work...
          </div>
        </div>
      ) : null}
      <div
        data-testid="packet-workspace"
        inert={draftRecoveryLoading ? true : undefined}
        aria-busy={draftRecoveryLoading}
        className="mx-auto w-full max-w-[1480px] px-2 pb-10 pt-0 sm:px-4 lg:px-6"
      >
        <div className="sticky top-0 z-20 mb-1 bg-white/95 backdrop-blur-sm">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-[#d9d9d9] lg:flex lg:gap-3">
            <h1 data-testid="workspace-identity-title" className="min-w-0 max-w-[10rem] shrink-0 truncate py-3 text-[14px] font-bold text-[#111111] sm:max-w-[18rem] lg:max-w-[26rem]" title={workspaceTitle}>
              {workspaceTitle}
            </h1>
            <WorkspaceStageNavigation steps={workspaceSteps} activePage={displayedPage} onOpen={openPage} />

            <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-1 lg:ml-auto">
              {loadedReferral && editingControlsVisible ? (
                <button
                  type="button"
                  onClick={() => openPage("workflow")}
                  aria-current={displayedPage === "workflow" ? "page" : undefined}
                  aria-label="Admission workflow"
                  title="Workflow"
                  className={`flex h-9 items-center gap-1.5 px-2 text-[10px] font-black transition-colors sm:px-3 ${
                    displayedPage === "workflow"
                      ? "bg-[#eaf6f2] text-[#0c705f]"
                      : "text-[#737373] hover:bg-[#f3f6f4] hover:text-[#0c705f]"
                  }`}
                >
                  <ClipboardCheck size={15} />
                  <span className="hidden xl:inline">Workflow</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => openPage("files")}
                aria-current={displayedPage === "files" ? "page" : undefined}
                aria-label="Workspace files"
                title="Files"
                className={`flex h-9 items-center gap-1.5 px-2 text-[10px] font-black transition-colors sm:px-3 ${
                  displayedPage === "files"
                    ? "bg-[#eaf6f2] text-[#0c705f]"
                    : "text-[#737373] hover:bg-[#f3f6f4] hover:text-[#0c705f]"
                }`}
              >
                <FolderOpen size={15} />
                <span className="hidden xl:inline">{workspacePresentation.filesLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => openPage("activity")}
                aria-current={displayedPage === "activity" ? "page" : undefined}
                aria-label="Workspace activity"
                title="Activity"
                className={`flex h-9 items-center gap-1.5 px-2 text-[10px] font-black transition-colors sm:px-3 ${
                  displayedPage === "activity"
                    ? "bg-[#eef2ff] text-[#3d5799]"
                    : "text-[#737373] hover:bg-[#f3f6f4] hover:text-[#3d5799]"
                }`}
              >
                <History size={15} />
                <span className="hidden xl:inline">Activity</span>
              </button>
              {editingControlsVisible ? (
                <>
                  <WorkspaceSaveControl
                    saving={isSaving}
                    hasReferral={hasReferral}
                    hasChanges={hasPendingWorkspaceChanges}
                    blocked={workspaceSaveIsBlocked(uploadingDocumentIds, remoteChange)}
                    onSave={saveWorkspaceDraft}
                    retry={Boolean(saveError)}
                  />
                </>
              ) : null}
              {trashControlVisible ? (
                <button
                  type="button"
                  aria-label="Move workspace to trash"
                  title="Move workspace to trash"
                  disabled={isSaving || isDeleting}
                  onClick={() => {
                    if (dirtyKeysRef.current.size > 0) {
                      setSaveError("Wait for your changes to save before moving this workspace to trash.");
                      return;
                    }
                    setDeleteDialogOpen(true);
                  }}
                  className="flex h-9 w-9 items-center justify-center text-[#737373] hover:bg-[#fff3f1] hover:text-[#a9473d] disabled:opacity-50"
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          </div>
          {editingControlsVisible ? (
            <WorkspaceSaveStatus
              status={saveStatus}
              error={saveError}
              createdWorkspaceId={createdWorkspaceId}
              referralId={editableReferralId}
              hasReferral={hasReferral}
              saving={isSaving}
              dirtyCount={dirtyKeys.size}
              queuedFileCount={queuedFileCount}
            />
          ) : null}
        </div>

        {recoveredDraftAt ? (
          <section aria-label="Recovered draft" className="mb-3 flex flex-wrap items-center justify-between gap-3 border-l-2 border-[#0f8b73] bg-[#effaf5] px-4 py-3" aria-live="polite">
            <div>
              <div className="text-[12px] font-black text-[#174f43]">
                {serverDraftsEnabled ? "Recovered changes from your account." : "Recovered changes from this browser tab."}
              </div>
              <div className="mt-1 text-[11px] text-[#3c665d]">
                {recoveredPacketName
                  ? `Your field changes are back. Re-select ${recoveredPacketName} before uploading the packet.`
                  : "Review the recovered fields or let autosave store them."}
              </div>
            </div>
            <button type="button" onClick={discardRecoveredDraft} className="h-8 border border-[#0f8b73] px-3 text-[10px] font-black text-[#174f43] hover:bg-white">
              Discard recovered draft
            </button>
          </section>
        ) : null}

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

        {remoteChange ? (
          <section aria-label="Remote changes" className="mb-3 border border-[#d5b75b] bg-[#fffbe8] px-4 py-3" aria-live="assertive">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-black text-[#4e451d]">{remoteChange.updatedBy} updated this referral.</div>
                <div className="mt-1 text-[11px] leading-5 text-[#6a6031]">
                  {remoteChange.conflicts.length > 0
                    ? "Choose which value to keep for the fields changed in both sessions."
                    : "The latest changes were merged into your open draft."}
                </div>
              </div>
              {remoteChange.conflicts.length === 0 ? (
                <button type="button" onClick={() => setRemoteChange(null)} className="text-[11px] font-black text-[#4e451d] hover:text-black">
                  Dismiss
                </button>
              ) : null}
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
        ) : null}

        {extractionConflict ? (
          <section aria-label="Extracted field conflict" className="mb-3 border border-[#d4a39d] bg-[#fff3f1] px-4 py-3" aria-live="assertive">
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
        ) : null}

        <WorkspaceChangeHistory
          activePage={displayedPage}
          referral={loadedReferral}
          onOpenFull={() => openPage("activity")}
        />

        <div key={displayedPage} className="pipeline-step-enter">
          {displayedPage === 1 && historicalReadOnly && loadedReferral ? (
            <PacketPage id="transferred-chart" title="Chart">
              <TransferredWorkspaceChart key={loadedReferral.id} referral={loadedReferral} fields={[
                ...Object.values(fields),
                { label: "Conserved", value: conserved },
              ]} />
            </PacketPage>
          ) : displayedPage === 1 ? (
          <PacketPage id="packet-page-1" title="Intake">
            <IntakeDocumentChecklist
              initialPacket={initialPacket}
              initialPacketCategory={initialPacketCategory}
              recordedName={loadedReferral?.documentName}
              recordedStatus={loadedReferral?.documentStatus}
              packetMessage={loadedReferral?.packetMessage}
              documents={documents}
              pendingDocuments={pendingDocuments}
              referral={loadedReferral}
              uploadingDocumentIds={uploadingDocumentIds}
              onInitialPacketCategoryChange={(category) => {
                setInitialPacketCategory(category);
                if (initialPacket) {
                  markDirty("initialPacket");
                  setSavedAt("Unsaved changes");
                }
              }}
              onInitialPacketSelect={selectInitialPacket}
              onInitialPacketClear={clearInitialPacket}
              onAttach={attachDocument}
            />
            {referralContextPacketFields.length ? (
              <PacketExtractionReview
                fields={referralContextPacketFields}
                fileName={loadedReferral?.documentName || "the uploaded packet"}
                developmentOnly={loadedReferral?.packetMessage?.startsWith("Development")}
                busyFieldKey={reviewBusyFieldKey}
                bulkBusy={isBulkReviewing}
                onAccept={(field) => reviewExtractedField(field, "accept")}
                onAcceptAll={acceptExtractedFields}
                onEdit={(field, value) => reviewExtractedField(field, "edit", value)}
              />
            ) : null}
            <ClientChartFrame label="Referral intake chart">
              <ClientChartHeader title="Referral intake">
                <ChartHeaderCell label="Details captured" value={`${fieldCount} / ${visibleChartFieldKeys.length}`} />
                <ChartHeaderCell label="Save status" value={saveStatus} />
              </ClientChartHeader>
              <div className="min-w-0">
                <ChartSection title="Identity" complete={countCompleteFields(fields, ["name", "gender", "age", "dob", "ssn"])} total={5}>
                  <div className="grid grid-cols-2 gap-px overflow-hidden bg-[#bfcac5] lg:grid-cols-6">
                    {(["name", "gender", "age", "dob", "ssn"] as FieldKey[]).map((key) => (
                      <EditablePacketField
                        key={key}
                        fieldKey={key}
                        field={fields[key]}
                        className={key === "name" ? "col-span-2" : undefined}
                        onChange={(value) => updateField(key, value)}
                        onFocus={focusWorkspaceField}
                      />
                    ))}
                  </div>
                </ChartSection>

                <ChartSection title="Routing and assignment" complete={countCompleteFields(fields, ["owner", "community", "county", "referralReceived", "admissionDate", "referent", "responsiblePerson"])} total={7}>
                  <div aria-label="Referral routing" className="grid gap-px overflow-hidden bg-[#bfcac5] sm:grid-cols-2 lg:grid-cols-3">
                    {(["owner", "community", "county", "referralReceived", "admissionDate", "referent", "responsiblePerson"] as FieldKey[]).map((key) => (
                      key === "owner" ? (
                        <OwnerPacketField
                          key={key}
                          fieldKey={key}
                          field={fields.owner}
                          members={members}
                          ownerPrincipalId={ownerPrincipalId}
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
                          className={key === "responsiblePerson" ? "sm:col-span-2 lg:col-span-1" : undefined}
                          options={key === "community" ? pipelineCommunities : key === "county" ? californiaCountyOptions : undefined}
                          onChange={(value) => updateField(key, value)}
                          onFocus={focusWorkspaceField}
                        />
                      )
                    ))}
                    <div className="min-h-[82px] min-w-0 bg-white px-5 py-4 sm:px-6">
                      <label htmlFor="packet-tags" className="text-[9px] font-black uppercase tracking-[0.09em] text-[#5f6b66] sm:text-[10px]">Tags</label>
                      <input
                        id="packet-tags"
                        aria-label="Tags"
                        value={tagsInput}
                        onChange={(event) => {
                          setTagsInput(event.target.value);
                          markDirty("tags");
                          setSavedAt("Unsaved changes");
                        }}
                        placeholder="urgent, county-intake"
                        className="mt-1.5 h-8 w-full border-0 bg-transparent p-0 text-[14px] font-bold text-[#18211d] outline-none placeholder:text-[#a0a0a0] focus-visible:ring-2 focus-visible:ring-[#0f8b73]"
                      />
                      <div className="mt-1 text-[10px] text-[#737373]">Comma-separated; searchable everywhere.</div>
                    </div>
                    <div className="flex min-h-[82px] min-w-0 flex-wrap items-center justify-between gap-3 bg-white px-5 py-4 sm:px-6">
                      <div className="min-w-0">
                        <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#5f6b66] sm:text-[10px]">Conserved</div>
                        <div className="mt-1 text-[10px] text-[#737373]">Record the current legal status.</div>
                      </div>
                      <div role="group" aria-label="Conserved" className="flex shrink-0 overflow-hidden border border-[#c9ceca] bg-white">
                        {(["yes", "no"] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={conserved === value}
                            onClick={() => {
                              setSaveError("");
                              setConserved(value);
                              markDirty("conserved");
                              setSavedAt("Unsaved changes");
                            }}
                            className={`h-9 min-w-14 border-r border-[#d9ddda] px-3 text-[10px] font-black uppercase last:border-r-0 ${
                              conserved === value
                                ? "bg-[#2f8475] text-white"
                                : "text-[#595959] hover:bg-[#f7faf9]"
                            }`}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </ChartSection>

                <ChartSection title="Contact and coordination" complete={countCompleteFields(fields, ["phone", "email"])} total={2}>
                  <div className="grid gap-px overflow-hidden bg-[#bfcac5] sm:grid-cols-2">
                    {(["phone", "email"] as FieldKey[]).map((key) => (
                      <EditablePacketField
                        key={key}
                        fieldKey={key}
                        field={fields[key]}
                        onChange={(value) => updateField(key, value)}
                        onFocus={focusWorkspaceField}
                      />
                    ))}
                  </div>
                  <div className="border-t border-[#bfcac5] px-5 py-4 sm:px-6"><ReferralContactsCard
                    referralId={editableReferralId ?? undefined}
                    clientPhone={fields.phone.value}
                    clientEmail={fields.email.value}
                  /></div>
                </ChartSection>

                <ChartSection title="Referral summary" complete={countCompleteFields(fields, ["summary"])} total={1}>
                  <div className="px-5 py-4 sm:px-6" data-workspace-field="summary" onFocusCapture={() => focusWorkspaceField("summary")}>
                    <StructuredNarrativeField
                      field={fields.summary}
                      kind="summary"
                      onChange={(value) => updateField("summary", value)}
                      saveStatus={saveStatus}
                      saveError={saveError}
                      saving={isSaving}
                      hasUnsavedChanges={hasPendingWorkspaceChanges}
                      saveActionLabel="Retry saving"
                      onSave={hasReferral && saveError ? () => void saveWorkspaceDraft() : undefined}
                    />
                  </div>
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
                <ChartCompletionRail
                  fieldCount={fieldCount}
                  fieldTotal={visibleChartFieldKeys.length}
                  assessmentSummary={assessmentSummary}
                  continuing={isSaving}
                  blocked={uploadingDocumentIds.size > 0 || Boolean(remoteChange?.conflicts.length)}
                  hasReferral={Boolean(loadedReferral) || trainingIntakeMode}
                  onContinue={() => void continueToAssessment()}
                />
              </aside>
            </ClientChartFrame>
          </PacketPage>
          ) : displayedPage === "files" ? (
            <WorkspaceFilesPage
              presentation={workspacePresentation}
              documents={documents}
              uploadingDocumentIds={uploadingDocumentIds}
              onAttach={attachDocument}
            />
          ) : displayedPage === "workflow" && loadedReferral ? (
            <PacketPage id="admission-workflow" title="Workflow">
              <ReferralWorkflowPanel
                referral={loadedReferral}
                onReferralChange={applyConfirmedWorkflowReferral}
                onOpenIntake={() => openPage(1)}
                onOpenAssessment={() => openPage(2)}
                onOpenFiles={() => openPage("files")}
                onOpenProfile={onOpenProfile}
              />
            </PacketPage>
          ) : displayedPage === 2 ? (
            <PacketPage id="packet-page-2" title="Assessment">
                <AssessmentWorkspace
                  referralId={referralWorkspaceId}
                  trainingAssessmentMode={trainingAssessmentMode}
                  trainingAssessmentSection={trainingAssessmentSection}
                  initialSection={routedWorkspaceLocation.view === "assessment" ? routedWorkspaceLocation.assessmentSection : undefined}
                  assignedAssessorId={loadedReferral?.ownerId}
                  startScheduling={schedulingReferralId === referralWorkspaceId}
                  packetEvidenceVersion={packetEvidenceVersion}
                  onSummaryChange={setAssessmentSummary}
                  onContinueToWorkflow={() => openPage("workflow")}
                  onActiveSectionChange={(section) => {
                    if (activePage === 2) onWorkspaceLocationChange?.({ view: "assessment", assessmentSection: section });
                  }}
                  onAssessmentSaved={async (assessment) => {
                    if (assessment.status !== "complete") return;
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
            <PacketPage id="packet-charts" title="Chart">
              <TransferredWorkspaceChart key={loadedReferral?.id} referral={loadedReferral} fields={[
                ...Object.values(fields), { label: "Conserved", value: conserved },
              ]}><AssessmentChartWorkspace referralId={referralWorkspaceId} embedded /></TransferredWorkspaceChart>
            </PacketPage>
          ) : (
            <PacketPage id="packet-activity" title="Activity">
              <ReferralActivityPanel referralId={referralWorkspaceId} version={loadedReferral?.version} />
            </PacketPage>
          )}
        </div>
      </div>
      {deleteDialogOpen && loadedReferral ? (
        <DeleteWorkspaceDialog
          name={loadedReferral.name}
          busy={isDeleting}
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

function workspacePageForLocation(location: PipelineWorkspaceLocation): WorkspaceView {
  if (location.view === "assessment") return 2;
  if (location.view === "chart") return 3;
  if (location.view === "workflow" || location.view === "files" || location.view === "activity") return location.view;
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
  if (page === "workflow" || page === "files" || page === "activity") return { view: page };
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
  const routedPage = workspacePageForLocation(location);
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
  return `${referralId ?? draftKey ?? "new"}:${location.view}:${location.assessmentSection ?? ""}:${location.intakeField ?? ""}`;
}

function getWorkspacePresentation(
  referral: Referral | null,
  admissionDocumentCount: number,
  attachmentCount: number,
) {
  const usesSourceProfile = referral ? isImportedWorkspace(referral) : false;
  const readOnly = referral?.workspaceStatus === "historical";
  return {
    readOnly,
    usesSourceProfile,
    steps: usesSourceProfile || readOnly ? importedWorkspaceSteps : packetSteps,
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

function WorkspaceStageNavigation({ steps, activePage, onOpen }: {
  steps: ReadonlyArray<{ page: WorkspaceStage; label: string }>;
  activePage: WorkspaceView;
  onOpen: (page: WorkspaceView) => void;
}) {
  const numbered = steps.length > 1;
  return <>
    {numbered ? <label data-guide-target="workspace-stage-nav" className="col-span-2 row-start-2 min-w-0 lg:hidden">
      <span className="sr-only">Workspace stage</span>
      <select data-guide-target="assessment-stage chart-stage" aria-label="Workspace stage"
        value={typeof activePage === "number" ? activePage : 1}
        onChange={(event) => onOpen(Number(event.target.value) as WorkspaceStage)}
        className="h-10 w-full border-0 border-b-2 border-b-[#0f8b73] bg-white px-2 text-[12px] font-bold text-[#111111] outline-none">
        {steps.map(({ page, label }) => <option key={page} value={page}>{`0${page} ${label}`}</option>)}
      </select>
    </label> : <button type="button" onClick={() => onOpen(1)} aria-current={activePage === 1 ? "page" : undefined} className="col-span-2 row-start-2 py-2 text-left text-[12px] font-bold text-[#0c705f] lg:hidden">Chart</button>}
    <nav data-guide-target="workspace-stage-nav" aria-label="Workspace stages" className="hidden min-w-0 gap-1 overflow-x-auto lg:flex">
      {steps.map((step) => <WorkspaceStageButton key={step.page} {...step} numbered={numbered} selected={activePage === step.page} onOpen={onOpen} />)}
    </nav>
  </>;
}

function WorkspaceStageButton({ page, label, numbered, selected, onOpen }: {
  page: WorkspaceStage; label: string; numbered: boolean; selected: boolean; onOpen: (page: WorkspaceView) => void;
}) {
  return <button type="button" data-guide-target={page === 2 ? "assessment-stage" : page === 3 || !numbered ? "chart-stage" : undefined}
    onClick={() => onOpen(page)} aria-current={selected ? "page" : undefined}
    className={`flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[11px] font-black transition-colors ${selected ? "border-[#0f8b73] text-[#111111]" : "border-transparent text-[#737373] hover:text-[#0f8b73]"}`}>
    {numbered ? <span className={`text-[9px] ${selected ? "text-[#0c705f]" : "text-[#595959]"}`}>0{page}</span> : null}
    <span className="whitespace-nowrap">{label}</span>
  </button>;
}

function WorkspaceSaveStatus({ status, error, createdWorkspaceId, referralId, hasReferral, saving, dirtyCount, queuedFileCount }: {
  status: string; error: string; createdWorkspaceId: number | null; referralId: number | null;
  hasReferral: boolean; saving: boolean; dirtyCount: number; queuedFileCount: number;
}) {
  const created = createdWorkspaceId !== null && createdWorkspaceId === referralId;
  const confirmed = hasReferral && !saving && dirtyCount === 0 && queuedFileCount === 0 && /^(Saved |All changes saved|Packet uploaded)/.test(status);
  return <div data-testid="workspace-save-status" className="flex min-h-7 flex-wrap items-center justify-end gap-x-3 gap-y-1 py-1 text-[11px] font-medium" aria-live="polite">
    {created ? <span className="inline-flex items-center gap-1.5 rounded-sm bg-[#eaf5ef] px-2 py-1 font-bold text-[#0c705f]"><CheckCircle2 size={13} aria-hidden="true" />Workspace created</span> : null}
    {error ? <span role="alert" className="min-w-0 break-words text-[#a4473c]">{error}</span> : <span className={`inline-flex items-center gap-1.5 ${confirmed ? "text-[#0c705f]" : "text-[#68716c]"}`}>{confirmed && !created ? <CheckCircle2 size={13} aria-hidden="true" /> : null}{status}</span>}
  </div>;
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
      className="flex h-10 shrink-0 items-center gap-2 bg-[#0b6f5d] px-3 text-[12px] font-bold text-white transition-colors hover:bg-[#075a4b] disabled:cursor-not-allowed disabled:bg-[#b8c3bf] sm:px-4"
    >
      <Icon size={15} aria-hidden="true" className={saving ? "motion-safe:animate-spin" : undefined} />
      <span className="hidden sm:inline">{control.expandedLabel}</span>
      <span className="sm:hidden">{control.compactLabel}</span>
    </button>
  );
}

function workspaceSaveControlState(saving: boolean, hasReferral: boolean, hasChanges: boolean, blocked: boolean, retry: boolean) {
  const mode = hasReferral
    ? { label: "Retry saving", compactLabel: "Retry", busyLabel: "Saving...", target: undefined }
    : { label: "Create referral", compactLabel: "Create", busyLabel: "Creating...", target: "create-workspace" };
  return {
    ...mode,
    visible: !hasReferral || retry,
    disabled: saving || blocked || !hasChanges,
    expandedLabel: saving ? mode.busyLabel : mode.label,
    compactLabel: saving ? "Working..." : mode.compactLabel,
  };
}

function hasReferralRecord(referral: Referral | null, referralId: number | undefined) {
  return Boolean(referral || referralId);
}

function workspaceSaveIsBlocked(uploadingDocumentIds: Set<string>, remoteChange: RemoteChange | null) {
  return uploadingDocumentIds.size > 0 || Boolean(remoteChange?.conflicts.length);
}

function WorkspaceFilesPage({
  presentation,
  documents,
  uploadingDocumentIds,
  onAttach,
}: {
  presentation: ReturnType<typeof getWorkspacePresentation>;
  documents: Record<string, string>;
  uploadingDocumentIds: Set<string>;
  onAttach: (requirementId: string, file: File) => void;
}) {
  return (
    <PacketPage id="packet-files" title={presentation.filesLabel}>
      <DocumentGroup
        title={presentation.admissionTitle}
        detail={presentation.admissionDetail}
        requirements={requirements}
        documents={documents}
        uploadingDocumentIds={uploadingDocumentIds}
        onAttach={onAttach}
        readOnly={presentation.readOnly}
      />
      <DocumentGroup
        title={presentation.supportingTitle}
        detail={presentation.supportingDetail}
        requirements={attachments}
        documents={documents}
        uploadingDocumentIds={uploadingDocumentIds}
        onAttach={onAttach}
        readOnly={presentation.readOnly}
      />
    </PacketPage>
  );
}

function IntakeDocumentChecklist({
  initialPacket,
  initialPacketCategory,
  recordedName,
  recordedStatus,
  packetMessage,
  documents,
  pendingDocuments,
  referral,
  uploadingDocumentIds,
  onInitialPacketCategoryChange,
  onInitialPacketSelect,
  onInitialPacketClear,
  onAttach,
}: {
  initialPacket: File | null;
  initialPacketCategory: InitialDocumentCategory;
  recordedName?: string;
  recordedStatus?: Referral["documentStatus"];
  packetMessage?: string;
  documents: Record<string, string>;
  pendingDocuments: Record<string, File>;
  referral: Referral | null;
  uploadingDocumentIds: Set<string>;
  onInitialPacketCategoryChange: (category: InitialDocumentCategory) => void;
  onInitialPacketSelect: (file: File | undefined) => InitialPacketSelectionResult;
  onInitialPacketClear: () => void;
  onAttach: (requirementId: string, file: File) => void;
}) {
  const documentItems = [...requirements, ...attachments];
  const capturedDocuments = documentItems.filter((item) => (
    !pendingDocuments[item.id] && !uploadingDocumentIds.has(item.id) && getRequirementReviewValue(item, documents[item.id], referral)
  )).length;
  const hasInitialPacket = Boolean(initialPacket || (recordedName && recordedStatus !== "Missing"));

  return (
    <section aria-label="Document checklist" className="mb-6">
      <details
        data-testid="document-checklist-panel"
        className="group bg-white"
      >
        <summary
          data-testid="document-checklist-toggle"
          className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 border-b border-[#d7ddd9] px-1 py-3 outline-none transition-colors hover:bg-[#f7faf9] focus-visible:bg-[#f1f7f4] [&::-webkit-details-marker]:hidden"
        >
          <div className="min-w-0">
            <h2 className="text-[14px] font-black text-[#111111]">Documents</h2>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className={`text-[10px] font-black ${hasInitialPacket && !initialPacket ? "text-[#0f8b73]" : "text-[#8a6a16]"}`}>
              {initialPacket ? "Packet selected" : hasInitialPacket ? "Packet added" : "Packet needed"}
            </span>
            <span className={`text-[10px] font-black ${capturedDocuments === documentItems.length ? "text-[#0f8b73]" : "text-[#737373]"}`}>
              {capturedDocuments} / {documentItems.length} files
            </span>
            <ChevronDown size={16} aria-hidden="true" className="text-[#595959] transition-transform group-open:rotate-180" />
          </div>
        </summary>

        <div className="px-1 pb-4 pt-4">
          <InitialPacketDropzone
            file={initialPacket}
            recordedName={recordedName}
            recordedStatus={recordedStatus}
            message={packetMessage}
            category={initialPacketCategory}
            onCategoryChange={onInitialPacketCategoryChange}
            onSelect={onInitialPacketSelect}
            onClear={onInitialPacketClear}
          />

          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-[11px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Document checklist</h3>
            <span className="text-[10px] font-semibold text-[#737373]">Drop a file into its checklist item</span>
          </div>
          <div className="grid overflow-hidden border-l border-t border-[#d7ddd9] sm:grid-cols-2 xl:grid-cols-4">
            {documentItems.map((requirement) => (
              <DocumentDropRow
                key={requirement.id}
                requirement={requirement}
                fileName={getRequirementReviewValue(requirement, documents[requirement.id], referral)}
                onAttach={(file) => onAttach(requirement.id, file)}
                uploading={uploadingDocumentIds.has(requirement.id)}
                queued={Boolean(pendingDocuments[requirement.id])}
                variant="checklist"
              />
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}


function ChartSection({
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
  if (title === "Routing and assignment") return "intake-routing";
  if (title === "Medication profile") return "intake-medications";
  return undefined;
}

function ChartCompletionRail({
  fieldCount,
  fieldTotal,
  assessmentSummary,
  continuing,
  blocked,
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
    startedAt?: string | null;
    signedAt?: string | null;
  };
  continuing: boolean;
  blocked: boolean;
  hasReferral: boolean;
  onContinue: () => void;
}) {
  const percent = fieldTotal === 0 ? 0 : Math.round((fieldCount / fieldTotal) * 100);
  const action = assessmentOpenLabel({
    signed_at: assessmentSummary.signedAt ?? null,
    started_at: assessmentSummary.startedAt ?? null,
    scheduled_start_at: assessmentSummary.scheduledStartAt ?? null,
  });
  const status = assessmentSummary.signedAt ? "Signed" : assessmentSummary.startedAt ? "In progress" : assessmentSummary.scheduledStartAt ? "Scheduled" : "Not scheduled";

  return (
    <section aria-label="Intake completion" className="grid items-center gap-x-8 gap-y-2 px-5 py-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex items-center justify-between gap-4 md:col-start-1">
        <h2 className="text-[14px] font-bold text-[#111111]">Intake</h2>
        <span className="text-[13px] font-bold tabular-nums text-[#5c6660]">{percent}%</span>
      </div>
      <div role="progressbar" aria-label="Intake details captured" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden bg-[#e5e9e6] md:col-start-1">
        <div className="h-full bg-[#0f8b73] transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <dl className="flex flex-wrap gap-x-8 md:col-start-1">
        <ChartStatusRow label="Details captured" value={`${fieldCount.toLocaleString()} / ${fieldTotal.toLocaleString()}`} />
        <ChartStatusRow
          label="Assessment"
          value={status}
          attention={!assessmentSummary.signedAt}
        />
      </dl>
      {hasReferral ? <button
        type="button"
        onClick={onContinue}
        disabled={continuing || blocked}
        className="flex min-h-11 w-full items-center justify-between gap-3 bg-[#111111] px-4 py-3 text-left text-[13px] font-bold leading-5 text-white transition-colors hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:bg-[#d2d2d2] md:col-start-2 md:row-start-1 md:row-span-3"
      >
        <span>{action}</span><ArrowRight size={16} className="shrink-0" aria-hidden="true" />
      </button> : null}
    </section>
  );
}

function ChartStatusRow({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-[11px] text-[#595959]">{label}</dt>
      <dd className={`text-[11px] font-bold ${attention ? "text-[#9a6411]" : "text-[#0f8b73]"}`}>{value}</dd>
    </div>
  );
}

function PacketPage({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className="overflow-hidden bg-white">
      <h2 className="sr-only">{title}</h2>
      <div className="px-0 py-1 sm:px-2 sm:py-2">{children}</div>
    </section>
  );
}

function InitialPacketDropzone({
  file,
  recordedName,
  recordedStatus,
  message,
  category,
  onCategoryChange,
  onSelect,
  onClear,
}: {
  file: File | null;
  recordedName?: string;
  recordedStatus?: Referral["documentStatus"];
  message?: string;
  category: InitialDocumentCategory;
  onCategoryChange: (category: InitialDocumentCategory) => void;
  onSelect: (file: File | undefined) => InitialPacketSelectionResult;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const displayName = file?.name || recordedName;
  const presentation = initialPacketDropzonePresentation({ file, recordedName, recordedStatus, dragActive });

  const acceptFile = (candidate: File | undefined, fileCount = candidate ? 1 : 0) => {
    if (fileCount > 1) {
      setSelectionError("Choose one initial referral document at a time.");
      return;
    }
    const result = onSelect(candidate);
    if (!result.accepted) {
      setSelectionError(result.error ?? "");
      return;
    }
    setSelectionError("");
    dropzoneRef.current?.dispatchEvent(new CustomEvent("pipeline:guide-complete", { bubbles: true }));
  };

  const resetDragState = () => {
    dragDepthRef.current = 0;
    setDragActive(false);
  };

  return (
    <section data-guide-target="initial-packet" aria-label="Initial referral packet" className="mb-5 border-b border-[#d9d9d9] pb-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[12px] font-black uppercase tracking-[0.12em] text-[#0f8b73]">Initial document</h3>
          <p className="mt-1 text-[11px] leading-5 text-[#595959]">Required for a new referral. Extraction proposes chart values that can be corrected at any time.</p>
        </div>
        <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">
          Document type
          <select
            aria-label="Initial document type"
            value={category}
            onChange={(event) => onCategoryChange(event.target.value as InitialDocumentCategory)}
            className="h-8 border border-[#c9ceca] bg-white px-2 text-[11px] font-semibold normal-case tracking-normal text-[#111111] outline-none focus:border-[#0f8b73]"
          >
            <option value="face_sheet">Face sheet</option>
            <option value="referral_packet">Referral packet</option>
          </select>
        </label>
      </div>

      <div
        ref={dropzoneRef}
        data-guide-target="initial-packet-upload"
        role="group"
        aria-label="Upload initial referral document"
        aria-describedby="initial-packet-help initial-packet-status"
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepthRef.current += 1;
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          resetDragState();
          acceptFile(event.dataTransfer.files?.[0], event.dataTransfer.files?.length ?? 0);
        }}
        className={`flex min-h-[126px] flex-col justify-center gap-4 border-2 border-dashed px-4 py-4 transition-colors sm:flex-row sm:items-center sm:px-5 ${presentation.className}`}
      >
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center ${presentation.iconClassName}`}>
          {displayName ? <FileText size={25} /> : <UploadCloud size={26} />}
        </span>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="truncate text-[15px] font-black text-[#111111]">
            {presentation.title}
          </div>
          <div id="initial-packet-status" aria-live="polite" className="mt-1 text-[11px] leading-5 text-[#595959]">
            {presentation.status}
          </div>
          <div id="initial-packet-help" className="mt-0.5 text-[10px] font-semibold text-[#737373]">PDF, JPEG, PNG, TIFF, or HEIC · 100 MB maximum</div>
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex h-10 items-center justify-center gap-2 bg-[#111111] px-4 text-[11px] font-black text-white hover:bg-[#0f8b73] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73]"
          >
            <UploadCloud size={15} aria-hidden="true" />
            {presentation.actionLabel}
          </button>
          {file ? (
            <button
              type="button"
              onClick={() => {
                onClear();
                setSelectionError("");
                if (inputRef.current) inputRef.current.value = "";
              }}
              aria-label="Remove selected initial referral document"
              title="Remove selected document"
              className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#b8dacf] bg-white text-[#595959] hover:border-[#a04436] hover:text-[#a04436]"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          data-testid="initial-packet-input"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.heic"
          aria-label="Choose initial referral document"
          className="sr-only"
          onChange={(event) => {
            acceptFile(event.target.files?.[0], event.target.files?.length ?? 0);
            event.target.value = "";
          }}
        />
      </div>
      {selectionError ? <p role="alert" className="mt-2 text-[11px] font-semibold leading-5 text-[#a4473c]">{selectionError}</p> : null}
      {message ? <p className="mt-2 text-[11px] leading-5 text-[#737373]">{message}</p> : null}
    </section>
  );
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
  ownerPrincipalId,
  onChange,
  onFocus,
}: {
  fieldKey: FieldKey;
  field: PacketField;
  members: WorkspaceMember[];
  ownerPrincipalId: string;
  onChange: (principalId: string) => void;
  onFocus: (key: FieldKey) => void;
}) {
  const hasLegacyOwner = !ownerPrincipalId && !isUnassignedOwner(field.value);
  const hasCurrentOwnerOption = !ownerPrincipalId || members.some((member) => member.principal_id === ownerPrincipalId);
  return (
    <div data-workspace-field={fieldKey} onFocusCapture={() => onFocus(fieldKey)} className="group relative min-h-[82px] min-w-0 bg-white px-5 py-4 sm:px-6 focus-within:z-10 focus-within:outline focus-within:outline-2 focus-within:outline-[#0f8b73]">
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
      {members.length === 0 ? <div className="mt-1 text-[10px] text-[#8a5a10]">No active members loaded</div> : null}
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

function EditablePacketField({
  fieldKey,
  field,
  options,
  className,
  onChange,
  onFocus,
}: {
  fieldKey: FieldKey;
  field: PacketField;
  options?: readonly string[];
  className?: string;
  onChange: (value: string) => void;
  onFocus: (key: FieldKey) => void;
}) {
  return (
    <div data-workspace-field={fieldKey} onFocusCapture={() => onFocus(fieldKey)} className={`group relative min-h-[82px] min-w-0 bg-white px-5 py-4 sm:px-6 focus-within:z-10 focus-within:outline focus-within:outline-2 focus-within:outline-[#0f8b73] ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-2">
        <label className="text-[9px] font-black uppercase tracking-[0.09em] text-[#5f6b66] sm:text-[10px]">{field.label}</label>
        {field.sourceFile ? <span className="text-[9px] font-black uppercase text-[#317f8f]">Imported</span> : null}
      </div>
      {options ? (
        <select
          aria-label={field.label}
          value={field.value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1.5 h-8 w-full border-0 bg-transparent p-0 text-[14px] font-bold text-[#18211d] outline-none"
        >
          <option value="">{field.placeholder || `Select ${field.label.replace(/:$/, "").toLowerCase()}`}</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input
          aria-label={field.label}
          value={field.value}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={`mt-1.5 h-8 w-full border-0 bg-transparent p-0 font-bold text-[#18211d] outline-none placeholder:text-[#a0a0a0] ${fieldKey === "name" ? "text-[22px] tracking-[-0.025em] sm:text-[24px]" : "text-[14px]"}`}
        />
      )}
      {field.sourceFile ? (
        <div className="mt-2 flex items-center gap-1 text-[10px] font-black text-[#317f8f]">
          <CheckCircle2 size={12} />
          {field.sourceFile}
        </div>
      ) : null}
    </div>
  );
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
        {field.sourceFile ? <span className="text-[9px] font-black uppercase text-[#317f8f]">Imported</span> : null}
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

function DocumentGroup({
  title,
  detail,
  requirements: groupRequirements,
  documents,
  uploadingDocumentIds,
  onAttach,
  readOnly = false,
}: {
  title: string;
  detail: string;
  requirements: Requirement[];
  documents: Record<string, string>;
  uploadingDocumentIds: Set<string>;
  onAttach: (requirementId: string, file: File) => void;
  readOnly?: boolean;
}) {
  return (
    <section aria-label={title} className="mb-6 last:mb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#cfd6d2] px-1 pb-3">
        <h2 className="text-[14px] font-black text-[#111111]">{title}</h2>
        <span className="text-[10px] font-black text-[#595959]">{detail}</span>
      </div>
      <div>
        {groupRequirements.map((requirement) => (
          <DocumentDropRow
            key={requirement.id}
            requirement={requirement}
            fileName={documents[requirement.id]}
            onAttach={(file) => onAttach(requirement.id, file)}
            uploading={uploadingDocumentIds.has(requirement.id)}
            readOnly={readOnly}
          />
        ))}
      </div>
    </section>
  );
}

function DocumentDropRow({
  requirement,
  fileName,
  onAttach,
  uploading = false,
  queued = false,
  readOnly = false,
  variant = "row",
}: {
  requirement: Requirement;
  fileName?: string;
  onAttach: (file: File) => void;
  uploading?: boolean;
  queued?: boolean;
  readOnly?: boolean;
  variant?: "row" | "checklist";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  if (readOnly) return <ReadOnlyDocumentRow requirement={requirement} fileName={fileName} />;
  const isChecklist = variant === "checklist";
  const status = uploading ? "Uploading" : queued ? "Queued" : fileName ? "Received" : "Needed";

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (file) onAttach(file);
      }}
      className={isChecklist
        ? "flex min-h-[112px] flex-col justify-between border-b border-r border-[#d7ddd9] bg-white p-3 transition-colors hover:bg-[#fbfdfc]"
        : "grid gap-2 border-b border-[#e1e4e2] bg-white px-3 py-2.5 transition-colors hover:bg-[#fbfdfc] md:grid-cols-[minmax(0,1fr)_minmax(210px,280px)] md:items-center"}
    >
      <div>
        <div className={`flex gap-2 ${isChecklist ? "items-start" : "items-center"}`}>
          {fileName
            ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[#0f8b73]" />
            : <Circle size={15} className="mt-0.5 shrink-0 text-[#a59b55]" />}
          <div className={`${isChecklist ? "min-h-8 text-[11px] leading-4" : "text-[13px]"} font-black text-[#303638]`}>{requirement.label}</div>
          <span className={`ml-auto shrink-0 text-[9px] font-black uppercase tracking-[0.08em] ${uploading || queued ? "text-[#8a6a16]" : fileName ? "text-[#0f8b73]" : "text-[#8a6a16]"}`}>
            {status}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        aria-label={isChecklist ? `${requirement.label}: ${fileName ? "replace document" : "drop document or browse"}` : undefined}
        className={`flex ${isChecklist ? "mt-3 h-9" : "h-10"} w-full items-center justify-center gap-2 border border-dashed px-3 text-[10px] font-black transition-colors ${fileName ? "border-[#8fc6b7] bg-[#f2faf7] text-[#0c705f] hover:bg-white" : "border-[#d2c77b] bg-[#fffdf0] text-[#6f641b] hover:bg-white"}`}
      >
        {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#c6ba59] border-t-transparent" /> : fileName ? <Check size={15} /> : <UploadCloud size={16} />}
        <span className="max-w-full truncate">{uploading ? "Uploading..." : fileName || (isChecklist ? "Add file" : "Drop document or browse")}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.heic"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onAttach(file);
        }}
      />
    </div>
  );
}

function ReadOnlyDocumentRow({ requirement, fileName }: { requirement: Requirement; fileName?: string }) {
  return (
    <div className="grid gap-2 border-b border-[#e1e4e2] bg-white px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(210px,280px)] md:items-center">
      <div className="flex items-center gap-2">
        <FileText size={15} className="text-[#6f641b]" />
        <div className="text-[13px] font-black text-[#303638]">{requirement.label}</div>
        <span className={`ml-auto text-[9px] font-black uppercase tracking-[0.08em] ${fileName ? "text-[#0f8b73]" : "text-[#747b77]"}`}>
          {fileName ? "Received" : "Not linked"}
        </span>
      </div>
      <div className={`flex h-10 w-full items-center justify-center gap-2 border px-3 text-[10px] font-black ${fileName ? "border-[#8fc6b7] bg-[#f2faf7] text-[#0c705f]" : "border-[#d9ddda] bg-[#f7f8f7] text-[#7c827f]"}`}>
        {fileName ? <Check size={15} /> : <FileText size={15} />}
        <span className="max-w-full truncate">{fileName ?? "No linked source file"}</span>
      </div>
    </div>
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

function buildRemoteFieldConflicts(input: {
  base: Referral;
  latest: Referral;
  dirty: ReadonlySet<DirtyDraftKey>;
  fields: Record<FieldKey, PacketField>;
  conserved: "yes" | "no" | "";
  tags: string;
  documents: Record<string, string>;
  initialPacket: File | null;
}) {
  const conflicts: RemoteFieldConflict[] = [];
  for (const key of persistedFieldKeys) {
    if (!input.dirty.has(key)) continue;
    const baseValue = referralDraftValue(input.base, key);
    const remoteValue = referralDraftValue(input.latest, key);
    const localValue = input.fields[key].value;
    if (baseValue !== remoteValue && localValue !== remoteValue) {
      conflicts.push({ key, label: input.fields[key].label, localValue, remoteValue });
    }
  }

  if (input.dirty.has("tags")) {
    const baseValue = (input.base.tags ?? []).join(", ");
    const remoteValue = (input.latest.tags ?? []).join(", ");
    const localValue = normalizeTags(input.tags).join(", ");
    if (baseValue !== remoteValue && localValue !== remoteValue) {
      conflicts.push({ key: "tags", label: "Tags", localValue, remoteValue });
    }
  }

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
  if (!draft.baseVersion || draft.baseVersion === latest.version) return [];
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

function activeReferralId(loadedReferral: Referral | null, referral: { id: number } | undefined) {
  return loadedReferral?.id ?? referral?.id;
}

function presenceSection(page: WorkspaceView): ReferralSection {
  if (page === "files") return "documents";
  if (page === "activity") return "workflow";
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
  const contentType = getPacketContentType(file);
  if (!(allowedUploadContentTypes as readonly string[]).includes(contentType)) {
    return { accepted: false, error: "Upload a PDF, JPEG, PNG, TIFF, or HEIC referral document." };
  }
  if (file.size > maxUploadFileBytes) {
    return { accepted: false, error: "The initial referral document must be 100 MB or smaller." };
  }
  return { accepted: true, file };
}

function initialPacketDropzonePresentation({
  file,
  recordedName,
  recordedStatus,
  dragActive,
}: {
  file: File | null;
  recordedName?: string;
  recordedStatus?: Referral["documentStatus"];
  dragActive: boolean;
}) {
  if (dragActive) {
    return {
      title: "Release to add the document",
      status: "Face sheet or referral packet",
      actionLabel: "Choose file",
      className: "border-[#0f8b73] bg-[#e6f7f1]",
      iconClassName: "text-[#6f641b]",
    };
  }
  if (file) {
    return {
      title: file.name,
      status: `${formatFileSize(file.size)} · Ready to upload`,
      actionLabel: "Replace file",
      className: "border-[#8fc7b7] bg-[#f4fbf8]",
      iconClassName: "text-[#0f8b73]",
    };
  }
  if (recordedName && recordedStatus !== "Missing") {
    return {
      title: recordedName,
      status: `${recordedStatus} · Choose another file to replace it`,
      actionLabel: "Replace file",
      className: "border-[#8fc7b7] bg-[#f4fbf8]",
      iconClassName: "text-[#0f8b73]",
    };
  }
  return {
    title: "Drop the referral document here",
    status: "Face sheet or referral packet",
    actionLabel: "Choose file",
    className: "border-[#aaa25f] bg-[#fffdf0] hover:border-[#817932] hover:bg-[#fffbe2]",
    iconClassName: "text-[#6f641b]",
  };
}

function WorkspaceChangeHistory({
  activePage,
  referral,
  onOpenFull,
}: {
  activePage: WorkspaceView;
  referral: Referral | null;
  onOpenFull: () => void;
}) {
  if (!referral || activePage === "activity") return null;
  return (
    <div className="mb-3">
      <ReferralActivityPanel
        compact
        referralId={referral.id}
        version={referral.version}
        onOpenFull={onOpenFull}
      />
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}
