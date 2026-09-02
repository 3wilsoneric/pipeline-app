"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  FileText,
  FolderOpen,
  History,
  Save,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { pipelineCommunities, type PipelineCommunity } from "@/lib/pipeline/community-config";
import { californiaCountyOptions } from "@/lib/pipeline/workspace-presentation";
import PacketExtractionReview from "@/components/pipeline/PacketExtractionReview";
import AssessmentWorkspace from "@/components/pipeline/AssessmentWorkspace";
import AssessmentChartWorkspace from "@/components/pipeline/AssessmentChartWorkspace";
import HistoricalReferralProfile from "@/components/pipeline/HistoricalReferralProfile";
import type { AssessmentListResponse } from "@/lib/assessment/assessment-records";
import DeleteWorkspaceDialog from "@/components/pipeline/DeleteWorkspaceDialog";
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
import { isInternalWorkspaceTag } from "@/lib/pipeline/workspace-presentation";
import {
  allowedUploadContentTypes,
  maxUploadFileBytes,
  type ExtractedField,
  type PacketFieldsResponse,
  type ReviewFieldResponse,
} from "@/lib/extraction/contracts";
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

type FieldKey = ReferralCanvasFieldKey;

type PacketField = ReferralCanvasPacketField;

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
  initialWorkspaceStage?: "intake" | "assessment";
  onReferralSaved?: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onReferralDeleted?: () => void;
};

type DirtyDraftKey = ReferralCanvasDirtyKey;

type CanvasSessionDraft = PipelineReferralDraft;

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
type WorkspaceView = WorkspaceStage | "files" | "activity";

const packetSteps: ReadonlyArray<{ page: WorkspaceStage; label: string }> = [
  { page: 1, label: "Intake" },
  { page: 2, label: "Assessment" },
  { page: 3, label: "Charts" },
] as const;

const historicalSteps: ReadonlyArray<{ page: WorkspaceStage; label: string }> = [
  { page: 1, label: "Profile" },
] as const;

const initialFields: Record<FieldKey, PacketField> = {
  name: { label: "NAME", value: "", placeholder: "Client name" },
  gender: { label: "GENDER", value: "", placeholder: "" },
  age: { label: "AGE", value: "", placeholder: "" },
  dob: { label: "DOB", value: "", placeholder: "M/D/Y" },
  ssn: { label: "SSN", value: "", placeholder: "" },
  owner: { label: "Owner (@name):", value: "", placeholder: "Assign owner" },
  referralReceived: {
    label: "Referral received:",
    value: "",
    placeholder: "M/D/Y",
  },
  admissionDate: {
    label: "Admission date:",
    value: "",
    placeholder: "M/D/Y",
  },
  community: { label: "Community:", value: "", placeholder: "Select destination" },
  county: { label: "County:", value: "", placeholder: "Select county" },
  referent: { label: "Referent:", value: "", placeholder: "" },
  responsiblePerson: {
    label: "Responsible Person:",
    value: "",
    placeholder: "",
  },
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

export default function ReferralPacketCanvas({ referral, newDraftKey, initialWorkspaceStage = "intake", onReferralSaved, onReferralDeleted }: ReferralPacketCanvasProps = {}) {
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
  const [activePage, setActivePage] = useState<WorkspaceView>(workspacePageForStage(initialWorkspaceStage));
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
  const [savedAt, setSavedAt] = useState(referral?.id ? "Loading workspace..." : "Add documents, then complete intake");
  const [loadedReferral, setLoadedReferral] = useState<Referral | null>(null);
  const [draftRecoveryLoading, setDraftRecoveryLoading] = useState(usesServerReferralDrafts());
  const [isSaving, setIsSaving] = useState(false);
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
  const [isDeleting, setIsDeleting] = useState(false);
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
  const ownerPrincipalIdRef = useRef(ownerPrincipalId);
  useWorkspaceStageRouting(referral?.id, newDraftKey, initialWorkspaceStage, setActivePage);
  const defaultOwnerRef = useRef<{ principalId: string; displayName: string } | null>(null);
  const handoffReasonRef = useRef("");
  const assessmentRoutingReferralRef = useRef<number | null>(null);

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
  }, [initialPacket]);

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
    const referralId = referral?.id;
    if (!referralId) {
      assessmentRoutingReferralRef.current = null;
      setActivePage(1);
      return;
    }
    if (!shouldRouteAssessment(loadedReferral, referralId, assessmentRoutingReferralRef.current)) return;
    assessmentRoutingReferralRef.current = referralId;
    setActivePage(1);
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
        if (!assessment.signed_at && (assessment.scheduled_start_at || assessment.started_at)) setActivePage(2);
      })
      .catch(() => {
        // Intake remains usable if assessment routing cannot be resolved.
      });
    return () => {
      cancelled = true;
    };
  }, [loadedReferral, referral?.id]);

  useEffect(() => {
    let cancelled = false;
    fetchPipelineJson<{ members: WorkspaceMember[]; current_principal_id: string }>("/api/members", { cache: "no-store" })
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

  useEffect(() => {
    if (isSaving || (dirtyKeys.size === 0 && Object.keys(pendingDocuments).length === 0)) return;
    const timer = window.setTimeout(() => {
      if (isSavingRef.current) return;
      const revision = draftRevisionRef.current;
      const draft: CanvasSessionDraft = {
        schema: 1,
        savedAt: new Date().toISOString(),
        baseVersion: loadedReferral?.version,
        baseValues: Object.fromEntries(
          [...dirtyKeys].map((key) => [key, referralBaseDraftValue(loadedReferral, key)]),
        ),
        dirtyKeys: [...dirtyKeys],
        fields: Object.fromEntries(
          persistedFieldKeys.map((key) => [key, {
            value: fields[key].value,
            ...(fields[key].sourceFile ? { sourceFile: fields[key].sourceFile } : {}),
          }]),
        ) as CanvasSessionDraft["fields"],
        conserved,
        tagsInput,
        documents,
        ...(initialPacket ? { initialPacketName: initialPacket.name } : {}),
        initialPacketCategory,
      };
      if (usesServerReferralDrafts()) {
        void saveServerReferralDraft(referral?.id ?? loadedReferral?.id ?? newDraftKey, draft)
          .then(() => {
            if (draftRevisionRef.current === revision) setSavedAt("Recovery draft saved");
          })
          .catch(() => {
            if (draftRevisionRef.current === revision) {
              setSaveError("Could not save the recovery draft. Save the referral before leaving this page.");
            }
          });
        return;
      }
      try {
        window.sessionStorage.setItem(canvasDraftStorageKey(referral?.id ?? loadedReferral?.id ?? newDraftKey), JSON.stringify(draft));
        if (draftRevisionRef.current === revision) setSavedAt("Recovery draft saved");
      } catch {
        setSaveError("This browser could not keep a refresh-recovery draft. Save before leaving this page.");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [conserved, dirtyKeys, documents, fields, initialPacket, initialPacketCategory, isSaving, loadedReferral, newDraftKey, pendingDocuments, referral?.id, tagsInput]);

  useEffect(() => {
    if (dirtyKeys.size === 0) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirtyKeys, pendingDocuments]);

  const markDirty = (key: DirtyDraftKey) => {
    draftRevisionRef.current += 1;
    setDirtyKeys((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (!referral?.id) {
      let cancelled = false;
      const defaultOwner = defaultOwnerRef.current;
      setFields({
        ...initialFields,
        name: { ...initialFields.name },
        owner: { ...initialFields.owner, value: defaultOwner?.displayName ?? "" },
      });
      setOwnerPrincipalId(defaultOwner?.principalId ?? "");
      setConserved("");
      setTagsInput("");
      setDocuments({});
      setInitialPacket(null);
      setInitialPacketCategory("face_sheet");
      setLoadedReferral(null);
      loadedReferralRef.current = null;
      setDirtyKeys(new Set());
      setRemoteChange(null);
      setExtractionConflict(null);
      setPresence([]);
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
      if (usesServerReferralDrafts()) {
        setDraftRecoveryLoading(true);
        void loadServerReferralDraft(newDraftKey).then((draft) => {
          if (cancelled) return;
          const recovered = draft ? applyRecoveryDraft(draft, setters) : null;
          setSavedAt(recovered ? "Recovered unsaved changes" : "Add documents, then complete intake");
        }).catch(() => {
          if (!cancelled) setSaveError("Could not check for a recovery draft.");
        }).finally(() => {
          if (!cancelled) setDraftRecoveryLoading(false);
        });
      } else {
        setDraftRecoveryLoading(false);
        const recovered = restoreSessionDraft(newDraftKey, setters);
        setSavedAt(recovered ? "Recovered unsaved changes" : "Add documents, then complete intake");
      }
      return () => {
        cancelled = true;
      };
    }
    if (loadedReferralRef.current?.id === referral.id) return;

    let cancelled = false;
    if (usesServerReferralDrafts()) setDraftRecoveryLoading(true);
    fetchPipelineJson<{ referral?: Referral }>(`/api/referrals/${referral.id}/canvas`, { cache: "no-store" }).then((canvasPayload) => {
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
        setFields((current) => fieldsFromReferral(current, record));
        setOwnerPrincipalId(record.ownerId ?? "");
        setConserved(record.conserved ?? "");
        setTagsInput(workspaceTagsInput(record.tags));
        setDocuments(documentsFromReferral(record));
        setInitialPacketCategory(initialDocumentCategoryFromReferral(record));
        setDirtyKeys(new Set());
        setRemoteChange(null);
        setExtractionConflict(null);
        setSavedAt("Workspace loaded");
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
        if (usesServerReferralDrafts()) {
          setDraftRecoveryLoading(true);
          void loadServerReferralDraft(record.id)
            .then((draft) => {
              if (!cancelled) finishRecovery(draft ? applyRecoveryDraft(draft, setters) : null);
            })
            .catch(() => {
              if (!cancelled) setSaveError("Could not check for a recovery draft.");
            })
            .finally(() => {
              if (!cancelled) setDraftRecoveryLoading(false);
            });
        } else {
          setDraftRecoveryLoading(false);
          finishRecovery(restoreSessionDraft(record.id, setters));
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
  }, [newDraftKey, referral?.id]);

  useEffect(() => {
    const extractedFields = loadedReferral?.packetFields;
    const sourceFile = loadedReferral?.documentName;
    if (!extractedFields?.length) return;

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
        setDirtyKeys((keys) => new Set([...keys, ...changed]));
        setSavedAt("Extracted values ready to save");
      }
      return next;
    });
  }, [loadedReferral?.documentName, loadedReferral?.packetFields]);

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

  useEffect(() => {
    if (!referral?.id) return;
    let cancelled = false;
    let checking = false;

    const checkForChanges = async () => {
      const current = loadedReferralRef.current;
      if (cancelled || checking || !current) return;
      checking = true;
      try {
        const change = await fetchPipelineJson<ReferralChangeSnapshot>(
          `/api/referrals/${referral.id}/changes?after=${current.version ?? 1}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        setPresence(dedupePresence(change.presence.filter((item) => !item.is_me)));
        if (change.changed) {
          const payload = await fetchPipelineJson<{ referral?: Referral }>(`/api/referrals/${referral.id}`, { cache: "no-store" });
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
  }, [referral?.id]);

  useEffect(() => {
    if (!referral?.id) return;
    const leaseId = crypto.randomUUID();
    const section = presenceSection(activePage);
    let cancelled = false;

    const heartbeat = async () => {
      try {
        await fetchPipelineJson(`/api/referrals/${referral.id}/presence`, {
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
      void fetchPipelineJson(`/api/referrals/${referral.id}/presence`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lease_id: leaseId }),
      }).catch(() => undefined);
    };
  }, [activePage, referral?.id]);

  const updateField = (key: FieldKey, value: string) => {
    setSavedAt("Unsaved changes");
    markDirty(key);
    setFields((current) => ({
      ...current,
      [key]: { ...current[key], value },
    }));
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
    setDocuments((current) => ({ ...current, [id]: file.name }));
    setPendingDocuments((current) => ({ ...current, [id]: file }));
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
      setDocuments(documentsFromReferral(refreshed.referral));
      setPendingDocuments((current) => {
        const next = { ...current };
        delete next[requirementId];
        return next;
      });
      setDirtyKeys((current) => {
        const next = new Set(current);
        if (Object.keys(pendingDocumentsRef.current).every((id) => id === requirementId)) next.delete("documents");
        return next;
      });
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

  const selectInitialPacket = (file: File | undefined) => {
    if (!file) return;

    const contentType = getPacketContentType(file);
    if (!(allowedUploadContentTypes as readonly string[]).includes(contentType)) {
      setSaveError("Upload a PDF, JPEG, PNG, TIFF, or HEIC referral packet.");
      return;
    }
    if (file.size > maxUploadFileBytes) {
      setSaveError("The initial packet must be 100 MB or smaller.");
      return;
    }

    setInitialPacket(file);
    markDirty("initialPacket");
    setSaveError("");
    setSavedAt("Unsaved changes");
  };

  const openPage = (page: WorkspaceView) => {
    setActivePage(normalizeWorkspaceView(page, loadedReferralRef.current?.workspaceStatus));
    requestAnimationFrame(() => {
      canvasRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
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
    const payload = await fetchPipelineJson<{ referral?: Referral; error?: string }>(`/api/referrals/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        if_match: current.version,
        if_match_sections: Object.fromEntries(touchedSections.map((section) => [section, expectedSections[section]])),
        patch,
        ...(ownerTouched ? { assignee_id: ownerPrincipalIdRef.current || undefined } : {}),
        ...(ownerTouched && handoffReasonRef.current ? { handoff_reason: handoffReasonRef.current } : {}),
      }),
    });
    if (!payload.referral) throw new Error(payload.error ?? "Could not save this referral.");
    loadedReferralRef.current = payload.referral;
    setLoadedReferral(payload.referral);
    setOwnerPrincipalId(payload.referral.ownerId ?? "");
    if (ownerTouched) handoffReasonRef.current = "";
    return payload.referral;
  };

  useEffect(() => {
    const current = loadedReferral;
    if (!current || isSaving || remoteChange?.conflicts.length) return;
    const keys = new Set([...dirtyKeys].filter((key) => (
      key !== "initialPacket" && !(key === "documents" && Object.keys(pendingDocuments).length > 0)
    )));
    if (keys.size === 0) return;
    const signatures = new Map([...keys].map((key) => [key, draftKeySignature(key, {
      fields,
      conserved,
      tagsInput,
      documents,
      initialPacket,
    })]));
    const timer = window.setTimeout(async () => {
      setIsSaving(true);
      setSaveError("");
      setSavedAt("Autosaving...");
      try {
        const saved = await persistExistingChanges(current, keys);
        setDirtyKeys((active) => {
          const next = new Set(active);
          for (const key of keys) {
            const signature = draftKeySignature(key, {
              fields: fieldsRef.current,
              conserved: conservedRef.current,
              tagsInput: tagsInputRef.current,
              documents: documentsRef.current,
              initialPacket: initialPacketRef.current,
            });
            if (signature === signatures.get(key)) next.delete(key);
          }
          if (next.size === 0) void clearSessionDraft(saved.id);
          return next;
        });
        setRemoteChange(null);
        setSavedAt(`Autosaved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      } catch (error) {
        if (error instanceof PipelineApiError && error.status === 409) {
          const latest = getConflictReferral(error.payload);
          if (latest) receiveRemoteReferral(latest, latest.updatedBy?.name, true);
        }
        setSaveError(error instanceof Error ? error.message : "Autosave failed. Your recovery draft is still in this tab.");
      } finally {
        setIsSaving(false);
      }
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [conserved, dirtyKeys, documents, fields, initialPacket, isSaving, loadedReferral, pendingDocuments, remoteChange?.conflicts.length, tagsInput]);

  const saveDraft = async () => {
    setSaveError("");
    if (uploadingDocumentIds.size > 0) {
      setSaveError("Wait for the selected documents to finish uploading before saving again.");
      return;
    }
    if (remoteChange?.conflicts.length) {
      setSaveError("Resolve the remote field changes before saving.");
      return;
    }
    setIsSaving(true);
    isSavingRef.current = true;
    let savedReferral = loadedReferral;
    try {
      const referralId = referral?.id ?? loadedReferral?.id;
      const tags = normalizeTags(tagsInput);
      const fallbackCommunity = loadedReferral?.community ?? referral?.community;
      const community: PipelineCommunity = pipelineCommunities.includes(fields.community.value.trim() as PipelineCommunity)
        ? fields.community.value.trim() as PipelineCommunity
        : pipelineCommunities.includes(fallbackCommunity as PipelineCommunity)
          ? fallbackCommunity as PipelineCommunity
          : "Unassigned";
      const admissionRequirements = createDefaultAdmissionRequirements(
        loadedReferral?.requirements ?? [],
        getEvidenceByType(documents),
        new Date().toISOString(),
        fields.owner.value.trim() || "Unassigned",
        ownerPrincipalId || undefined,
        {
          date_of_birth: fields.dob.value,
          community,
          referral_source: fields.referent.value,
        },
      );
      let payload: { referral?: Referral; error?: string };

      if (!referralId && !initialPacket) {
        throw new Error("Upload the initial face sheet or referral packet before creating this referral.");
      }
      if (referralId && !loadedReferral) {
        throw new Error("Wait for the saved referral to finish loading before making changes.");
      }

      let documentHash = loadedReferral?.documentHash;
      if (initialPacket) {
        setSavedAt("Checking packet...");
        documentHash = await hashPacket(initialPacket);
      }

      if (!referralId) {
        const owner = fields.owner.value.trim() || "Unassigned";
        const createTags = tags.length > 0
          ? tags
          : [
              "packet-import",
              "needs-review",
              ...(!isAssignedValue(owner) || community === "Unassigned" ? ["needs-assignment"] : []),
            ];

        const now = new Date();
        const createdReferral: ReferralCreateInput = buildReferralCanvasCreateInput({
          fields,
          conserved,
          community,
          tags: createTags,
          requirements: admissionRequirements,
          createdAt: now.toISOString(),
          ...(initialPacket
            ? { document: { name: initialPacket.name, size: initialPacket.size, hash: documentHash } }
            : {}),
        });

        payload = await fetchPipelineJson<{ referral?: Referral; error?: string }>("/api/referrals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            referral: createdReferral,
            client_mutation_id: createMutationId(),
            ...(ownerPrincipalId ? { assignee_id: ownerPrincipalId } : {}),
          }),
        });
      } else {
        const saved = await persistExistingChanges(
          loadedReferral!,
          dirtyKeys,
          initialPacket && documentHash ? { file: initialPacket, hash: documentHash } : undefined,
        );
        payload = { referral: saved };
      }
      if (!payload.referral) {
        throw new Error(payload.error ?? "Could not save this referral workspace.");
      }
      savedReferral = payload.referral;
      loadedReferralRef.current = savedReferral;
      setLoadedReferral(savedReferral);

      if (initialPacket) {
        setSavedAt("Uploading packet...");
        const upload = await uploadReferralPacket(savedReferral, initialPacket, documentHash!, initialPacketCategory);
        const refreshedWorkspace = await fetchPipelineJson<{ referral?: Referral }>(`/api/referrals/${savedReferral.id}/canvas`, { cache: "no-store" });
        if (!refreshedWorkspace.referral) throw new Error("The document was saved, but the referral workspace could not be refreshed.");
        savedReferral = refreshedWorkspace.referral;
        if (initialPacketCategory === "face_sheet" && upload.document) {
          const faceSheet = savedReferral.requirements?.find((item) => item.type === "face_sheet");
          if (faceSheet?.evidenceDocumentId !== upload.document.document_id) {
            throw new Error("The face sheet was stored, but its checklist item was not updated. Retry the upload.");
          }
        }
        loadedReferralRef.current = savedReferral;
        setLoadedReferral(savedReferral);
        setDocuments(documentsFromReferral(savedReferral));
        setSavedAt("Linking extraction...");
        const extractedForm = upload.fields
          ? populateFormFromExtraction(
              fieldsRef.current,
              upload.fields.fields,
              initialPacket.name,
              dirtyKeys,
            )
          : fieldsRef.current;
        const extractedKeys = new Set<PersistedFieldKey>(persistedFieldKeys.filter((key) => (
          extractedForm[key].value !== fieldsRef.current[key].value
          || extractedForm[key].sourceFile !== fieldsRef.current[key].sourceFile
        )));
        const extractedPatch = buildReferralCanvasPatch({
          keys: extractedKeys,
          fields: extractedForm,
          conserved: conservedRef.current,
          tags: normalizeTags(tagsInputRef.current),
          requirements: savedReferral.requirements ?? [],
        });
        const linkedPayload = await fetchPipelineJson<{ referral?: Referral; error?: string }>(`/api/referrals/${savedReferral.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            if_match: savedReferral.version,
            if_match_sections: normalizeReferralSectionVersions(savedReferral.sectionVersions),
            patch: {
              ...extractedPatch,
              documentName: initialPacket.name,
              documentSizeBytes: initialPacket.size,
              documentHash,
              documentStatus: "Uploaded",
              packetId: upload.packetId,
              packetStatus: upload.status,
              packetFields: upload.fields?.fields,
              packetReadiness: upload.fields?.ehr_readiness,
              packetCompleteness: upload.fields?.packet_completeness,
              packetMessage: upload.mock
                ? `Development local extraction completed. ${upload.pageCount} source page${upload.pageCount === 1 ? "" : "s"} preserved; confirm the stripped values below.`
                : "Packet uploaded and extraction started.",
            },
          }),
        });
        if (!linkedPayload.referral) throw new Error(linkedPayload.error ?? "Could not link the packet to this referral.");
        savedReferral = linkedPayload.referral;
        loadedReferralRef.current = savedReferral;
        setLoadedReferral(savedReferral);
        setFields(extractedForm);
        setInitialPacket(null);
      }

      for (const [requirementId, file] of Object.entries(pendingDocumentsRef.current)) {
        savedReferral = await uploadAndLinkSupportingDocument(savedReferral, requirementId, file);
      }

      setDirtyKeys(new Set());
      setPendingDocuments({});
      if (!referralId) await clearSessionDraft(newDraftKey);
      await clearSessionDraft(savedReferral.id);
      onReferralSaved?.({ id: savedReferral.id, name: savedReferral.name, community: savedReferral.community });
      setRecoveredDraftAt("");
      setRecoveredPacketName("");
      setRemoteChange(null);
      setSavedAt(
        initialPacket
          ? "Packet uploaded and ready for review"
          : `Saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
      );
    } catch (error) {
      let latestConflict: Referral | null = null;
      if (error instanceof PipelineApiError && error.status === 409) {
        latestConflict = getConflictReferral(error.payload);
        if (latestConflict) receiveRemoteReferral(latestConflict, latestConflict.updatedBy?.name, true);
      }
      if (!latestConflict && savedReferral) setLoadedReferral(savedReferral);
      setSaveError(error instanceof Error ? error.message : "Could not save this referral workspace.");
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const reviewExtractedField = async (
    extractedField: ExtractedField,
    action: "accept" | "edit",
    correctedValue?: string,
    allowManualOverride = true,
  ) => {
    if (!loadedReferral?.packetId || !loadedReferral.packetFields) {
      setSaveError("Save and finish extracting the packet before reviewing its values.");
      return;
    }

    setSaveError("");
    setReviewBusyFieldKey(extractedField.field_key);
    let fieldReviewSaved = false;
    try {
      const result = await fetchPipelineJson<ReviewFieldResponse>(
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

      const localFields = loadedReferral.packetFields.map((field) => (
        field.field_key === result.field_key
          ? {
              ...field,
              version: result.version,
              review_status: result.review_status,
              final_value: result.final_value,
            }
          : field
      ));
      const currentPacket = await fetchPipelineJson<PacketFieldsResponse>(
        `/api/packets/${encodeURIComponent(loadedReferral.packetId)}/fields`,
        { cache: "no-store" },
      ).catch(() => null);
      const packetFields = currentPacket?.fields ?? localFields;

      const mappedKeys = new Set(extractedCanvasFieldKeys(extractedField.field_key));
      const extractionDirtyKeys = new Set(dirtyKeysRef.current);
      for (const key of mappedKeys) extractionDirtyKeys.delete(key);
      const mappedFields = populateFormFromExtraction(
        fieldsRef.current,
        packetFields,
        loadedReferral.documentName || "Uploaded packet",
        extractionDirtyKeys,
        allowManualOverride ? mappedKeys : new Set(),
      );
      const mappedFieldKeys = new Set<PersistedFieldKey>(
        persistedFieldKeys.filter((key) => (
          mappedKeys.has(key)
          && (
            mappedFields[key].value !== fieldsRef.current[key].value
            || mappedFields[key].sourceFile !== fieldsRef.current[key].sourceFile
          )
        )),
      );
      const mappedPatch = buildCanvasPatch({
        keys: mappedFieldKeys,
        fields: mappedFields,
        conserved: conservedRef.current,
        tags: normalizeTags(tagsInputRef.current),
        requirements: loadedReferral.requirements ?? [],
      });
      const referralPatch: ReferralPatch = {
        ...mappedPatch,
        packetFields,
        ...(currentPacket
          ? {
              packetReadiness: currentPacket.ehr_readiness,
              packetCompleteness: currentPacket.packet_completeness,
            }
          : {}),
      };
      const currentReferral = loadedReferralRef.current ?? loadedReferral;
      const touchedSections = getReferralPatchSections(referralPatch as Record<string, unknown>);
      const expectedSections = normalizeReferralSectionVersions(currentReferral.sectionVersions);

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
            patch: referralPatch,
          }),
        },
      );
      if (!payload.referral) throw new Error(payload.error ?? "The reviewed value could not be linked to this referral.");

      loadedReferralRef.current = payload.referral;
      setLoadedReferral(payload.referral);
      if (mappedFieldKeys.size > 0) {
        setFields((current) => {
          const next = { ...current };
          for (const key of mappedFieldKeys) next[key] = mappedFields[key];
          return next;
        });
        setDirtyKeys((current) => {
          const next = new Set(current);
          for (const key of mappedFieldKeys) next.delete(key);
          return next;
        });
      }
      setExtractionConflict(null);
      setSavedAt(action === "edit" ? "Correction saved" : "Extracted value confirmed");
    } catch (error) {
      if (error instanceof PipelineApiError && error.status === 409 && !fieldReviewSaved && loadedReferral.packetId) {
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
    if (useLatest) {
      if (isPersistedFieldKey(conflict.key)) {
        const key = conflict.key;
        setFields((current) => ({
          ...current,
          [key]: {
            ...current[key],
            value: referralDraftValue(latest, key),
          },
        }));
      } else if (conflict.key === "tags") {
        setTagsInput(workspaceTagsInput(latest.tags));
      } else if (conflict.key === "documents") {
        setDocuments(documentsFromReferral(latest));
      } else if (conflict.key === "conserved") {
        setConserved(latest.conserved ?? "");
      } else if (conflict.key === "initialPacket") {
        setInitialPacket(null);
      }
      setDirtyKeys((current) => {
        const next = new Set(current);
        next.delete(conflict.key);
        return next;
      });
    }
    setRemoteChange((current) => current ? {
      ...current,
      conflicts: current.conflicts.filter((item) => item.key !== conflict.key),
    } : current);
  };

  const discardRecoveredDraft = () => {
    const current = loadedReferralRef.current;
    if (current) {
      setFields((fields) => fieldsFromReferral(fields, current));
      setConserved(current.conserved ?? "");
      setTagsInput(workspaceTagsInput(current.tags));
      setDocuments(documentsFromReferral(current));
      setInitialPacketCategory(initialDocumentCategoryFromReferral(current));
    } else {
      setFields({ ...initialFields, name: { ...initialFields.name, value: referral?.name ?? "" } });
      setConserved("");
      setTagsInput("");
      setDocuments({});
      setInitialPacketCategory("face_sheet");
    }
    setInitialPacket(null);
    setDirtyKeys(new Set());
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
    loadedReferral?.workspaceStatus,
    admissionDocumentCount,
    attachmentCount,
  );
  const { isHistorical: isHistoricalWorkspace, steps: workspaceSteps } = workspacePresentation;
  const referralContextPacketFields = (loadedReferral?.packetFields ?? []).filter(
    (field) => extractedCanvasFieldKeys(field.field_key).length > 0,
  );
  const packetEvidenceVersion = loadedReferral?.packetId
    ? `${loadedReferral.packetId}:${(loadedReferral.packetFields ?? [])
        .map((field) => `${field.field_key}:${field.version}`)
        .join("|")}`
    : "";

  const moveWorkspaceToTrash = async () => {
    const current = loadedReferralRef.current;
    if (!current) return;
    setIsDeleting(true);
    setSaveError("");
    try {
      await fetchPipelineJson(`/api/referrals/${current.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_match: current.version }),
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
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-b border-[#d9d9d9] lg:flex lg:gap-3">
            <h1 data-testid="workspace-identity-title" className="max-w-[10rem] shrink-0 truncate text-[12px] font-black text-[#111111] sm:max-w-[18rem] lg:max-w-[26rem]" title={workspaceTitle}>
              {workspaceTitle}
            </h1>
            <label data-guide-target="workspace-stage-nav" className="col-span-2 row-start-2 min-w-0 lg:hidden">
              <span className="sr-only">Workspace stage</span>
              <select
                data-guide-target="assessment-stage"
                aria-label="Workspace stage"
                value={typeof activePage === "number" ? activePage : 1}
                onChange={(event) => openPage(Number(event.target.value) as WorkspaceStage)}
                className="h-10 w-full border-0 border-b-2 border-b-[#0f8b73] border-t border-t-[#eeeeee] bg-white px-2 text-[12px] font-black text-[#111111] outline-none"
              >
                {workspaceSteps.map(({ page, label }) => <option key={page} value={page}>{`0${page} ${label}`}</option>)}
              </select>
            </label>
            <nav data-guide-target="workspace-stage-nav" aria-label="Workspace stages" className="hidden min-w-0 flex-1 gap-2 overflow-x-auto sm:gap-3 lg:flex">
              {workspaceSteps.map(({ page, label }) => (
                <button
                  key={page}
                  type="button"
                  data-guide-target={page === 2 ? "assessment-stage" : undefined}
                  onClick={() => openPage(page)}
                  aria-current={activePage === page ? "page" : undefined}
                  className={`flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[11px] font-black transition-colors ${
                    activePage === page
                      ? "border-[#0f8b73] text-[#111111]"
                      : "border-transparent text-[#737373] hover:text-[#0f8b73]"
                  }`}
                >
                  <span className={`text-[9px] ${activePage === page ? "text-[#0c705f]" : "text-[#595959]"}`}>0{page}</span>
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              ))}
            </nav>

            <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-1 lg:border-l lg:border-[#d9d9d9] lg:pl-2">
              <button
                type="button"
                onClick={() => openPage("files")}
                aria-current={activePage === "files" ? "page" : undefined}
                aria-label="Workspace files"
                title="Files"
                className={`flex h-9 items-center gap-1.5 px-2 text-[10px] font-black transition-colors sm:px-3 ${
                  activePage === "files"
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
                aria-current={activePage === "activity" ? "page" : undefined}
                aria-label="Workspace activity"
                title="Activity"
                className={`flex h-9 items-center gap-1.5 px-2 text-[10px] font-black transition-colors sm:px-3 ${
                  activePage === "activity"
                    ? "bg-[#eef2ff] text-[#3d5799]"
                    : "text-[#737373] hover:bg-[#f3f6f4] hover:text-[#3d5799]"
                }`}
              >
                <History size={15} />
                <span className="hidden xl:inline">Activity</span>
              </button>
              <div className="hidden max-w-[28rem] text-right sm:block" aria-live="polite">
                {savedAt !== "Workspace loaded" ? <div className="text-[11px] font-normal text-[#737373]">{savedAt}</div> : null}
                {saveError ? <div className="mt-0.5 text-[11px] font-semibold text-[#a4473c]">{saveError}</div> : null}
              </div>
              <WorkspaceSaveControl
                readOnly={isHistoricalWorkspace}
                saving={isSaving}
                hasReferral={hasReferralRecord(loadedReferral, referral?.id)}
                blocked={workspaceSaveIsBlocked(uploadingDocumentIds, remoteChange)}
                onSave={saveDraft}
              />
              {loadedReferral && canSupervise ? (
                <button
                  type="button"
                  aria-label="Move workspace to trash"
                  title="Move workspace to trash"
                  disabled={isSaving || isDeleting}
                  onClick={() => {
                    if (dirtyKeysRef.current.size > 0) {
                      setSaveError("Save your changes before moving this workspace to trash.");
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
        </div>

        {recoveredDraftAt ? (
          <section aria-label="Recovered draft" className="mb-3 flex flex-wrap items-center justify-between gap-3 border-l-2 border-[#0f8b73] bg-[#effaf5] px-4 py-3" aria-live="polite">
            <div>
              <div className="text-[12px] font-black text-[#174f43]">
                {usesServerReferralDrafts() ? "Recovered changes from your account." : "Recovered changes from this browser tab."}
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
          <div className="mb-3 border-l-2 border-[#4b68ad] bg-[#f4f6ff] px-3 py-2 text-[11px] font-bold text-[#354b85]" aria-live="polite">
            {presence.map((item) => `${item.actor_name} is editing ${presenceSectionLabel(item.section)}`).join(" · ")}
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

        <div key={activePage} className="pipeline-step-enter">
          {activePage === 1 && isHistoricalWorkspace && loadedReferral ? (
            <PacketPage id="historical-profile" title="Profile">
              <HistoricalReferralProfile key={loadedReferral.id} referral={loadedReferral} />
            </PacketPage>
          ) : activePage === 1 ? (
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
              onInitialPacketClear={() => {
                setInitialPacket(null);
                markDirty("initialPacket");
                setSavedAt("Unsaved changes");
              }}
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
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-5">
                <ChartSection title="Identity" detail="Core identifiers for this referral episode" complete={countCompleteFields(fields, ["name", "gender", "age", "dob", "ssn"])} total={5}>
                  <div className="grid overflow-hidden border-l border-t border-[#d7ddd9] bg-white sm:grid-cols-2 lg:grid-cols-5">
                    {(["name", "gender", "age", "dob", "ssn"] as FieldKey[]).map((key) => (
                      <EditablePacketField
                        key={key}
                        field={fields[key]}
                        className={key === "ssn" ? "sm:col-span-2 lg:col-span-1" : undefined}
                        onChange={(value) => updateField(key, value)}
                      />
                    ))}
                  </div>
                </ChartSection>

                <ChartSection title="Routing and assignment" detail="Who owns the referral, where it came from, and where it may be placed" complete={countCompleteFields(fields, ["owner", "community", "county", "referralReceived", "admissionDate", "referent", "responsiblePerson"])} total={7}>
                  <div aria-label="Referral routing" className="grid overflow-hidden border-l border-t border-[#d7ddd9] bg-white sm:grid-cols-2 lg:grid-cols-3">
                    {(["owner", "community", "county", "referralReceived", "admissionDate", "referent", "responsiblePerson"] as FieldKey[]).map((key) => (
                      key === "owner" ? (
                        <OwnerPacketField
                          key={key}
                          field={fields.owner}
                          members={members}
                          ownerPrincipalId={ownerPrincipalId}
                          onChange={(principalId) => {
                            const member = members.find((candidate) => candidate.principal_id === principalId);
                            const current = loadedReferralRef.current;
                            if (current && !isUnassignedOwner(current.owner) && (current.ownerId ?? "") !== principalId) {
                              const reason = window.prompt("Why is this referral being reassigned?")?.trim();
                              if (!reason || reason.length < 3) {
                                setSaveError("Reassignment was cancelled. Add a brief handoff reason to change the owner.");
                                return;
                              }
                              handoffReasonRef.current = reason;
                            }
                            setOwnerPrincipalId(principalId);
                            updateField("owner", member?.display_name ?? "Unassigned");
                          }}
                        />
                      ) : (
                        <EditablePacketField
                          key={key}
                          field={fields[key]}
                          className={key === "responsiblePerson" ? "sm:col-span-2 lg:col-span-1" : undefined}
                          options={key === "community" ? pipelineCommunities : key === "county" ? californiaCountyOptions : undefined}
                          onChange={(value) => updateField(key, value)}
                        />
                      )
                    ))}
                    <div className="min-h-[86px] border-b border-r border-[#d7ddd9] bg-white p-3">
                      <label htmlFor="packet-tags" className="text-[10px] font-black uppercase tracking-[0.08em] text-[#3f4745]">Tags</label>
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
                        className="mt-3 h-8 w-full border-0 bg-transparent p-0 text-[13px] font-semibold text-[#303638] outline-none placeholder:text-[#a0a0a0]"
                      />
                      <div className="mt-1 text-[10px] text-[#737373]">Comma-separated; searchable everywhere.</div>
                    </div>
                    <div className="flex min-h-[86px] items-center justify-between gap-3 border-b border-r border-[#d7ddd9] bg-white p-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#3f4745]">Conserved</div>
                        <div className="mt-1 text-[10px] text-[#737373]">Record the current legal status.</div>
                      </div>
                      <div className="flex overflow-hidden border border-[#c9ceca] bg-white">
                        {(["yes", "no"] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => {
                              setConserved(value);
                              markDirty("conserved");
                              setSavedAt("Unsaved changes");
                            }}
                            className={`h-9 min-w-14 border-r border-[#d9ddda] px-3 text-[10px] font-black uppercase last:border-r-0 ${
                              conserved === value
                                ? "bg-[#111111] text-white"
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

                <ChartSection title="Referral summary" detail="Initial context carried into the assessor's interview" complete={countCompleteFields(fields, ["summary"])} total={1}>
                  <div>
                    <StructuredNarrativeField
                      field={fields.summary}
                      kind="summary"
                      onChange={(value) => updateField("summary", value)}
                    />
                  </div>
                </ChartSection>

                <ChartSection title="Medication profile" detail="Current meds captured before assessment; this seeds the assessment medication section" complete={countCompleteFields(fields, ["currentMedications"])} total={1}>
                  <MedicationProfileField
                    field={fields.currentMedications}
                    onChange={(value) => updateField("currentMedications", value)}
                  />
                </ChartSection>
              </div>

              <aside aria-label="Chart completion" className="space-y-4 xl:sticky xl:top-[54px]">
                <ChartCompletionRail
                  fieldCount={fieldCount}
                  fieldTotal={visibleChartFieldKeys.length}
                  referral={loadedReferral}
                  assessmentSummary={assessmentSummary}
                  onOpenStep={openPage}
                />
              </aside>
            </div>
          </PacketPage>
          ) : activePage === "files" ? (
            <WorkspaceFilesPage
              presentation={workspacePresentation}
              documents={documents}
              uploadingDocumentIds={uploadingDocumentIds}
              onAttach={attachDocument}
            />
          ) : activePage === 2 && !isHistoricalWorkspace ? (
            <PacketPage id="packet-page-2" title="Assessment">
                <AssessmentWorkspace
                  referralId={loadedReferral?.id ?? referral?.id}
                  assignedAssessorId={loadedReferral?.ownerId}
                  packetEvidenceVersion={packetEvidenceVersion}
                  onSummaryChange={setAssessmentSummary}
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
          ) : activePage === 3 && !isHistoricalWorkspace ? (
            <PacketPage id="packet-charts" title="Charts">
              <AssessmentChartWorkspace referralId={loadedReferral?.id ?? referral?.id} />
            </PacketPage>
          ) : (
            <PacketPage id="packet-activity" title="Activity">
              <ReferralActivityPanel referralId={loadedReferral?.id ?? referral?.id} version={loadedReferral?.version} />
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
    </div>
  );
}

function workspacePageForStage(stage: "intake" | "assessment"): WorkspaceStage {
  return stage === "assessment" ? 2 : 1;
}

function useWorkspaceStageRouting(
  referralId: number | undefined,
  draftKey: ReferralPacketCanvasProps["newDraftKey"],
  stage: "intake" | "assessment",
  setActivePage: (page: WorkspaceView) => void,
) {
  const routedWorkspaceRef = useRef("");
  useEffect(() => {
    const routeKey = workspaceRouteKey(referralId, draftKey, stage);
    if (routedWorkspaceRef.current === routeKey) return;
    routedWorkspaceRef.current = routeKey;
    setActivePage(workspacePageForStage(stage));
  }, [draftKey, referralId, setActivePage, stage]);
}

function shouldRouteAssessment(
  referral: Referral | null,
  referralId: number,
  routedReferralId: number | null,
) {
  return Boolean(
    referral
    && referral.id === referralId
    && referral.workspaceStatus !== "historical"
    && routedReferralId !== referralId,
  );
}

function workspaceRouteKey(
  referralId: number | undefined,
  draftKey: ReferralPacketCanvasProps["newDraftKey"],
  stage: "intake" | "assessment",
) {
  return `${referralId ?? draftKey ?? "new"}:${stage}`;
}

function normalizeWorkspaceView(page: WorkspaceView, workspaceStatus: Referral["workspaceStatus"] | undefined) {
  if (workspaceStatus !== "historical") return page;
  return typeof page === "number" ? 1 : page;
}

function getWorkspacePresentation(
  workspaceStatus: Referral["workspaceStatus"] | undefined,
  admissionDocumentCount: number,
  attachmentCount: number,
) {
  const isHistorical = workspaceStatus === "historical";
  return {
    isHistorical,
    steps: isHistorical ? historicalSteps : packetSteps,
    filesLabel: isHistorical ? "Source files" : "Files",
    admissionTitle: isHistorical ? "Admission documents" : "Required for admission",
    admissionDetail: isHistorical
      ? `${admissionDocumentCount} linked`
      : `${admissionDocumentCount} of ${requirements.length} attached`,
    supportingTitle: isHistorical ? "Supporting files" : "Assessment and supporting files",
    supportingDetail: isHistorical
      ? `${attachmentCount} linked`
      : `${attachmentCount} of ${attachments.length} attached`,
  };
}

function WorkspaceSaveControl({
  readOnly,
  saving,
  hasReferral,
  blocked,
  onSave,
}: {
  readOnly: boolean;
  saving: boolean;
  hasReferral: boolean;
  blocked: boolean;
  onSave: () => void;
}) {
  if (readOnly) {
    return <span className="hidden h-9 items-center bg-[#f1f4f2] px-3 text-[9px] font-black uppercase tracking-[0.08em] text-[#66706b] sm:flex">Read only</span>;
  }
  return (
    <button
      type="button"
      data-guide-target="create-workspace"
      onClick={onSave}
      disabled={saving || blocked}
      className="flex h-9 items-center gap-2 bg-[#111111] px-3 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:bg-[#b8b8b8] sm:px-4"
    >
      <Save size={15} />
      <span className="hidden sm:inline">{workspaceSaveLabel(saving, hasReferral, true)}</span>
      <span className="sm:hidden">{workspaceSaveLabel(saving, hasReferral, false)}</span>
    </button>
  );
}

function workspaceSaveLabel(saving: boolean, hasReferral: boolean, expanded: boolean) {
  if (saving) return expanded ? "Saving..." : "Saving";
  if (hasReferral) return expanded ? "Save workspace" : "Save";
  return expanded ? "Create workspace" : "Create";
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
        readOnly={presentation.isHistorical}
      />
      <DocumentGroup
        title={presentation.supportingTitle}
        detail={presentation.supportingDetail}
        requirements={attachments}
        documents={documents}
        uploadingDocumentIds={uploadingDocumentIds}
        onAttach={onAttach}
        readOnly={presentation.isHistorical}
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
  onInitialPacketSelect: (file: File | undefined) => void;
  onInitialPacketClear: () => void;
  onAttach: (requirementId: string, file: File) => void;
}) {
  const documentItems = [...requirements, ...attachments];
  const capturedDocuments = documentItems.filter((item) => (
    getRequirementReviewValue(item, documents[item.id], referral)
  )).length;
  const hasInitialPacket = Boolean(initialPacket || (recordedName && recordedStatus !== "Missing"));

  return (
    <section aria-label="Document checklist" className="mb-6">
      <details data-testid="document-checklist-panel" className="group border-y border-[#d7ddd9] bg-white">
        <summary
          data-testid="document-checklist-toggle"
          className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 border-t-2 border-[#111111] px-3 py-3 outline-none transition-colors hover:bg-[#f7faf9] focus-visible:bg-[#f1f7f4] [&::-webkit-details-marker]:hidden"
        >
          <div className="min-w-0">
            <h2 className="text-[14px] font-black text-[#111111]">Documents</h2>
            <p className="mt-0.5 text-[11px] text-[#737373]">Referral packet and admission files</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className={`text-[10px] font-black ${hasInitialPacket ? "text-[#0f8b73]" : "text-[#8a6a16]"}`}>
              {hasInitialPacket ? "Packet added" : "Packet needed"}
            </span>
            <span className={`text-[10px] font-black ${capturedDocuments === documentItems.length ? "text-[#0f8b73]" : "text-[#737373]"}`}>
              {capturedDocuments} / {documentItems.length} files
            </span>
            <ChevronDown size={16} aria-hidden="true" className="text-[#595959] transition-transform group-open:rotate-180" />
          </div>
        </summary>

        <div className="border-t border-[#d7ddd9] px-3 pb-4 pt-4">
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
  detail,
  complete,
  total,
  children,
}: {
  title: string;
  detail: string;
  complete: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <section data-guide-target={chartGuideTarget(title)} aria-label={`${title} chart section`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-t-2 border-[#111111] pt-3">
        <div>
          <h2 className="text-[14px] font-black text-[#111111]">{title}</h2>
          <p className="mt-0.5 text-[11px] text-[#737373]">{detail}</p>
        </div>
        <span className={`text-[11px] font-black ${complete === total ? "text-[#0f8b73]" : "text-[#737373]"}`}>
          {complete} / {total}
        </span>
      </div>
      {children}
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
  referral,
  assessmentSummary,
  onOpenStep,
}: {
  fieldCount: number;
  fieldTotal: number;
  referral: Referral | null;
  assessmentSummary: {
    captured: number;
    total: number;
    status: string;
    assessmentId?: string;
    scheduledStartAt?: string | null;
    startedAt?: string | null;
    signedAt?: string | null;
  };
  onOpenStep: (page: WorkspaceView) => void;
}) {
  const percent = fieldTotal === 0 ? 0 : Math.round((fieldCount / fieldTotal) * 100);

  return (
    <section aria-label="Chart completion" className="border-t-2 border-[#111111] pt-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[13px] font-black text-[#111111]">Chart completion</h2>
        <span className="text-[22px] font-black text-[#111111]">{percent}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden bg-[#e5e9e6]">
        <div className="h-full bg-[#0f8b73] transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <dl className="mt-4 divide-y divide-[#e3e5e3] border-y border-[#e3e5e3]">
        <ChartStatusRow label="Chart fields" value={`${fieldCount} / ${fieldTotal}`} />
        <ChartStatusRow
          label="Assessment"
          value={assessmentSummary.assessmentId ? assessmentSummary.status.replaceAll("_", " ") : "Not started"}
          attention={assessmentSummary.status !== "complete"}
        />
      </dl>
      <button
        type="button"
        onClick={() => onOpenStep(2)}
        disabled={!referral}
        title={referral ? undefined : "Save the intake before starting the assessment"}
        className="mt-4 flex h-10 w-full items-center justify-center bg-[#111111] px-4 text-[11px] font-black text-white transition-colors hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:bg-[#d2d2d2]"
      >
        {!referral ? "Save intake to continue" : assessmentSummary.assessmentId ? "Continue assessment" : "Start assessment"}
      </button>
    </section>
  );
}

function ChartStatusRow({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-[11px] text-[#595959]">{label}</dt>
      <dd className={`text-[11px] font-black capitalize ${attention ? "text-[#9a6411]" : "text-[#0f8b73]"}`}>{value}</dd>
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
  onSelect: (file: File | undefined) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const displayName = file?.name || recordedName;
  const hasRecordedPacket = Boolean(recordedName && recordedStatus !== "Missing");

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
        data-guide-target="initial-packet-upload"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onSelect(event.dataTransfer.files?.[0]);
        }}
        className={`flex min-h-20 items-center gap-3 border border-dashed px-3 py-3 transition-colors ${
          displayName
            ? "border-[#8fc7b7] bg-[#effaf5]"
            : "border-[#c6ba59] bg-[#fffde8] hover:bg-[#fffbd5]"
        }`}
      >
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${displayName ? "bg-white text-[#0f8b73]" : "bg-[#fff7bd] text-[#6f641b]"}`}>
          {displayName ? <FileText size={19} /> : <UploadCloud size={20} />}
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-[13px] font-black text-[#111111]">
            {displayName || "Drop the initial packet here or browse"}
          </span>
          <span className="mt-0.5 block text-[11px] text-[#595959]">
            {file
              ? `${formatFileSize(file.size)} · Ready to upload`
              : hasRecordedPacket
                ? `${recordedStatus} · Choose another file to replace it`
                : "Upload a face sheet or referral packet to create the referral."}
          </span>
        </button>
        {file ? (
          <button
            type="button"
            onClick={onClear}
            aria-label="Remove selected initial packet"
            title="Remove selected packet"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#b8dacf] bg-white text-[#595959] hover:text-[#a04436]"
          >
            <X size={16} />
          </button>
        ) : null}
        <input
          ref={inputRef}
          data-testid="initial-packet-input"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.heic"
          className="hidden"
          onChange={(event) => onSelect(event.target.files?.[0])}
        />
      </div>
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
  field,
  members,
  ownerPrincipalId,
  onChange,
}: {
  field: PacketField;
  members: WorkspaceMember[];
  ownerPrincipalId: string;
  onChange: (principalId: string) => void;
}) {
  const hasLegacyOwner = !ownerPrincipalId && !isUnassignedOwner(field.value);
  return (
    <div className="group relative min-h-[86px] border-b border-r border-[#d7ddd9] bg-white p-3 focus-within:z-10 focus-within:outline focus-within:outline-2 focus-within:outline-[#0f8b73]">
      <label className="text-[10px] font-black uppercase tracking-[0.08em] text-[#3f4745]">{field.label}</label>
      <select
        aria-label={field.label}
        value={ownerPrincipalId || (hasLegacyOwner ? "__unlinked" : "")}
        onChange={(event) => onChange(event.target.value)}
        className="mt-3 h-8 w-full border-0 bg-transparent p-0 text-[13px] font-semibold text-[#303638] outline-none"
      >
        <option value="">Unassigned</option>
        {hasLegacyOwner ? <option value="__unlinked" disabled>{field.value} (choose member)</option> : null}
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

function EditablePacketField({
  field,
  options,
  className,
  onChange,
}: {
  field: PacketField;
  options?: readonly string[];
  className?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`group relative min-h-[86px] border-b border-r border-[#d7ddd9] bg-white p-3 focus-within:z-10 focus-within:outline focus-within:outline-2 focus-within:outline-[#0f8b73] ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-2">
        <label className="text-[10px] font-black uppercase tracking-[0.08em] text-[#3f4745]">{field.label}</label>
        {field.sourceFile ? <span className="text-[9px] font-black uppercase text-[#317f8f]">Imported</span> : null}
      </div>
      {options ? (
        <select
          aria-label={field.label}
          value={field.value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-3 h-8 w-full border-0 bg-transparent p-0 text-[13px] font-semibold text-[#303638] outline-none"
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
          className="mt-3 h-8 w-full border-0 bg-transparent p-0 text-[13px] font-semibold text-[#303638] outline-none placeholder:text-[#a0a0a0]"
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
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b-2 border-[#111111] px-1 pb-3">
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

function draftKeySignature(
  key: DirtyDraftKey,
  input: {
    fields: Record<FieldKey, PacketField>;
    conserved: "yes" | "no" | "";
    tagsInput: string;
    documents: Record<string, string>;
    initialPacket: File | null;
  },
) {
  if (isPersistedFieldKey(key)) return JSON.stringify([input.fields[key].value, input.fields[key].sourceFile ?? ""]);
  if (key === "conserved") return input.conserved;
  if (key === "tags") return normalizeTags(input.tagsInput).join("\n");
  if (key === "documents") return JSON.stringify(Object.entries(input.documents).sort(([left], [right]) => left.localeCompare(right)));
  return input.initialPacket
    ? JSON.stringify([input.initialPacket.name, input.initialPacket.size, input.initialPacket.lastModified])
    : "";
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

function canvasDraftStorageKey(draftReference?: ReferralRecoveryDraftKey) {
  return `pipeline-referral-draft:${draftReference ?? "new"}`;
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

function normalizeTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}
