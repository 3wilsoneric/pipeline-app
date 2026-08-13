"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  FileText,
  PencilLine,
  Save,
  UploadCloud,
  X,
} from "lucide-react";

import { pipelineCommunities, type PipelineCommunity } from "@/lib/pipeline/community-config";
import PacketExtractionReview from "@/components/pipeline/PacketExtractionReview";
import AssessmentWorkspace from "@/components/pipeline/AssessmentWorkspace";
import ReferralProgressPanel from "@/components/pipeline/ReferralProgressPanel";
import ReferralActivityPanel from "@/components/pipeline/ReferralActivityPanel";
import ReferralRequirementsEditor from "@/components/pipeline/ReferralRequirementsEditor";
import type {
  AdmissionDecision,
  EhrHandoffRecord,
  Referral,
  ReferralCanvasFieldKey,
  ReferralSection,
  RequirementType,
} from "@/lib/pipeline/referral-types";
import type { ReferralProgress } from "@/lib/pipeline/referral-progress";
import { isUnassignedOwner } from "@/lib/pipeline/referral-ownership";
import type { ReferralCreateInput, ReferralPatch } from "@/lib/pipeline/referral-store";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { recordRecentDestination } from "@/lib/pipeline/recent-destinations";
import {
  clearServerReferralDraft,
  loadServerReferralDraft,
  saveServerReferralDraft,
  usesServerReferralDrafts,
} from "@/lib/pipeline/referral-draft-recovery";
import {
  parsePipelineReferralDraft,
  type PipelineReferralDraft,
} from "@/lib/pipeline/user-workspace-state-types";
import { createDefaultAdmissionRequirements } from "@/lib/pipeline/workflow-records";
import type { ReferralChangeSnapshot, ReferralPresenceView } from "@/lib/pipeline/collaboration-types";
import { getReferralPatchSections, normalizeReferralSectionVersions } from "@/lib/pipeline/referral-sections";
import {
  allowedUploadContentTypes,
  maxUploadFileBytes,
  type CompleteUploadResponse,
  type ExtractedField,
  type CreateUploadUrlResponse,
  type PacketFieldsResponse,
  type PacketStatusResponse,
  type ReviewFieldResponse,
} from "@/lib/extraction/contracts";

type FieldKey = ReferralCanvasFieldKey;

type PacketField = {
  label: string;
  value: string;
  placeholder?: string;
  sourceFile?: string;
};

type Requirement = {
  id: string;
  label: string;
  type: RequirementType;
};

type ReviewStep = 1 | 2 | 3 | 4;

type ReviewItem = {
  label: string;
  value: string;
  step: ReviewStep;
  sensitive?: boolean;
};

type ReviewSection = {
  label: string;
  items: ReviewItem[];
};

type ReferralPacketCanvasProps = {
  referral?: {
    id: number;
    name?: string;
    community?: string;
  };
  onReferralSaved?: (referral: Pick<Referral, "id" | "name" | "community">) => void;
};

type PacketUploadResult = {
  packetId: string;
  status: PacketStatusResponse["status"];
  pageCount: number;
  fields?: PacketFieldsResponse;
  mock: boolean;
};

type DirtyDraftKey = FieldKey | "conserved" | "tags" | "documents" | "initialPacket";

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

type NarrativeKind = "summary" | "interview";

type NarrativeSection = {
  key: string;
  label: string;
  placeholder: string;
};

const narrativeSections: Record<NarrativeKind, readonly NarrativeSection[]> = {
  summary: [
    { key: "reason", label: "Reason for referral", placeholder: "Why the client was referred and what prompted this episode." },
    { key: "presentation", label: "Current presentation", placeholder: "Current symptoms, behavior, and level of stability." },
    { key: "concerns", label: "Clinical and safety concerns", placeholder: "Known risks, recent events, and immediate concerns." },
    { key: "strengths", label: "Strengths and goals", placeholder: "Protective factors, engagement, preferences, and goals." },
    { key: "placement", label: "Placement rationale", placeholder: "Why this level of care and community may be appropriate." },
    { key: "additional", label: "Additional context", placeholder: "Relevant detail that does not fit another section." },
  ],
  interview: [
    { key: "perspective", label: "Client perspective", placeholder: "How the client describes the situation and requested support." },
    { key: "mental-status", label: "Mental status and symptoms", placeholder: "Orientation, mood, thought process, hallucinations, and current symptoms." },
    { key: "medication", label: "Medication discussion", placeholder: "Adherence, effectiveness, side effects, refusals, and preferences." },
    { key: "functional", label: "Functional support needs", placeholder: "ADLs, prompting, mobility, supervision, and daily support." },
    { key: "preferences", label: "Preferences and goals", placeholder: "Placement preferences, personal goals, and conditions for success." },
    { key: "additional", label: "Additional notes", placeholder: "Relevant interview detail that does not fit another section." },
  ],
};

const packetSteps = [
  { page: 1, label: "Chart" },
  { page: 2, label: "Required files" },
  { page: 3, label: "Other files" },
  { page: 4, label: "Assessment" },
  { page: 5, label: "Review" },
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
  county: { label: "County:", value: "", placeholder: "" },
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
  interview: {
    label: "Interview",
    value: "",
    placeholder: "Interview notes",
  },
};

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

export default function ReferralPacketCanvas({ referral, onReferralSaved }: ReferralPacketCanvasProps = {}) {
  const [fields, setFields] = useState<Record<FieldKey, PacketField>>(() => ({
    ...initialFields,
    name: { ...initialFields.name, value: referral?.name ?? "" },
  }));
  const [conserved, setConserved] = useState<"yes" | "no" | "">("");
  const [documents, setDocuments] = useState<Record<string, string>>({});
  const [initialPacket, setInitialPacket] = useState<File | null>(null);
  const [tagsInput, setTagsInput] = useState("");
  const [activePage, setActivePage] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [assessmentSummary, setAssessmentSummary] = useState<{
    captured: number;
    total: number;
    status: string;
    assessmentId?: string;
  }>({
    captured: 0,
    total: 52,
    status: "not_started",
  });
  const [savedAt, setSavedAt] = useState(referral?.id ? "Loading saved record..." : "Begin with the chart or import documents");
  const [loadedReferral, setLoadedReferral] = useState<Referral | null>(null);
  const [progress, setProgress] = useState<ReferralProgress | null>(null);
  const [progressLoading, setProgressLoading] = useState(Boolean(referral?.id));
  const [draftRecoveryLoading, setDraftRecoveryLoading] = useState(usesServerReferralDrafts());
  const [isSaving, setIsSaving] = useState(false);
  const [reviewBusyFieldKey, setReviewBusyFieldKey] = useState<string>();
  const [isBulkReviewing, setIsBulkReviewing] = useState(false);
  const [isCompletingPacketReview, setIsCompletingPacketReview] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [recoveredDraftAt, setRecoveredDraftAt] = useState("");
  const [recoveredPacketName, setRecoveredPacketName] = useState("");
  const [dirtyKeys, setDirtyKeys] = useState<Set<DirtyDraftKey>>(() => new Set());
  const [remoteChange, setRemoteChange] = useState<RemoteChange | null>(null);
  const [extractionConflict, setExtractionConflict] = useState<ExtractionReviewConflict | null>(null);
  const [presence, setPresence] = useState<ReferralPresenceView[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const loadedReferralRef = useRef<Referral | null>(null);
  const fieldsRef = useRef(fields);
  const tagsInputRef = useRef(tagsInput);
  const documentsRef = useRef(documents);
  const initialPacketRef = useRef(initialPacket);
  const conservedRef = useRef(conserved);
  const dirtyKeysRef = useRef(dirtyKeys);
  const isSavingRef = useRef(isSaving);

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
    if (dirtyKeys.size === 0) return;
    const timer = window.setTimeout(() => {
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
      };
      if (usesServerReferralDrafts()) {
        void saveServerReferralDraft(referral?.id ?? loadedReferral?.id, draft).catch(() => {
          setSaveError("Could not save the recovery draft. Save the referral before leaving this page.");
        });
        return;
      }
      try {
        window.sessionStorage.setItem(canvasDraftStorageKey(referral?.id ?? loadedReferral?.id), JSON.stringify(draft));
      } catch {
        setSaveError("This browser could not keep a refresh-recovery draft. Save before leaving this page.");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [conserved, dirtyKeys, documents, fields, initialPacket, loadedReferral, referral?.id, tagsInput]);

  useEffect(() => {
    if (dirtyKeys.size === 0) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirtyKeys]);

  const markDirty = (key: DirtyDraftKey) => {
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
      setLoadedReferral(null);
      setProgress(null);
      setProgressLoading(false);
      setDirtyKeys(new Set());
      setRemoteChange(null);
      setExtractionConflict(null);
      setPresence([]);
      const setters = {
        setFields,
        setConserved,
        setTagsInput,
        setDocuments,
        setDirtyKeys,
        setRecoveredDraftAt,
        setRecoveredPacketName,
      };
      if (usesServerReferralDrafts()) {
        setDraftRecoveryLoading(true);
        void loadServerReferralDraft(undefined).then((draft) => {
          if (cancelled) return;
          const recovered = draft ? applyRecoveryDraft(draft, setters) : null;
          setSavedAt(recovered ? "Recovered unsaved changes" : "Begin with the chart or import documents");
        }).catch(() => {
          if (!cancelled) setSaveError("Could not check for a recovery draft.");
        }).finally(() => {
          if (!cancelled) setDraftRecoveryLoading(false);
        });
      } else {
        setDraftRecoveryLoading(false);
        const recovered = restoreSessionDraft(undefined, setters);
        setSavedAt(recovered ? "Recovered unsaved changes" : "Begin with the chart or import documents");
      }
      return () => {
        cancelled = true;
      };
    }
    if (loadedReferralRef.current?.id === referral.id) return;

    let cancelled = false;
    setProgressLoading(true);
    if (usesServerReferralDrafts()) setDraftRecoveryLoading(true);
    Promise.all([
      fetchPipelineJson<{ referral?: Referral }>(`/api/referrals/${referral.id}`, { cache: "no-store" }).catch(() => null),
      fetchPipelineJson<ReferralProgress>(`/api/referrals/${referral.id}/progress`, { cache: "no-store" }).catch(() => null),
      fetchPipelineJson<{ decision?: AdmissionDecision | null }>(`/api/referrals/${referral.id}/decision`, { cache: "no-store" }).catch(() => null),
    ]).then(([recordPayload, progressPayload, decisionPayload]) => {
      if (cancelled) return;
      const savedRecord = (recordPayload as { referral?: Referral } | null)?.referral ?? null;
      const decision = (decisionPayload as { decision?: AdmissionDecision | null } | null)?.decision;
      const record = savedRecord && decision ? { ...savedRecord, admissionDecision: decision } : savedRecord;
      setLoadedReferral(record);
      setProgress((progressPayload as ReferralProgress | null) ?? null);
      if (record) {
        recordRecentDestination({
          id: `referral:${record.id}`,
          kind: "referral",
          screen: "packet",
          title: record.name,
          detail: `${record.community} · Referral packet`,
          referralId: record.id,
          community: record.community,
        });
        setFields((current) => fieldsFromReferral(current, record));
        setConserved(record.conserved ?? "");
        setTagsInput((record.tags ?? []).join(", "));
        setDocuments(documentsFromReferral(record));
        setDirtyKeys(new Set());
        setRemoteChange(null);
        setExtractionConflict(null);
        setSavedAt("Saved record loaded");
        const setters = {
          setFields,
          setConserved,
          setTagsInput,
          setDocuments,
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
    }).finally(() => {
      if (!cancelled) setProgressLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [referral?.id]);

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
    if (!dirty.has("tags")) setTagsInput((latest.tags ?? []).join(", "));
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
    setSavedAt("Unsaved changes");
    markDirty("documents");
    setDocuments((current) => ({ ...current, [id]: file.name }));
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

  const openPage = (page: 1 | 2 | 3 | 4 | 5) => {
    setActivePage(page);
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
    const payload = await fetchPipelineJson<{ referral?: Referral; error?: string }>(`/api/referrals/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        if_match: current.version,
        if_match_sections: Object.fromEntries(touchedSections.map((section) => [section, expectedSections[section]])),
        patch,
      }),
    });
    if (!payload.referral) throw new Error(payload.error ?? "Could not save this referral.");
    loadedReferralRef.current = payload.referral;
    setLoadedReferral(payload.referral);
    return payload.referral;
  };

  useEffect(() => {
    const current = loadedReferral;
    if (!current || isSaving || remoteChange?.conflicts.length) return;
    const keys = new Set([...dirtyKeys].filter((key) => key !== "initialPacket"));
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
          if (next.size === 0) clearSessionDraft(saved.id);
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
  }, [conserved, dirtyKeys, documents, fields, initialPacket, isSaving, loadedReferral, remoteChange?.conflicts.length, tagsInput]);

  const saveDraft = async () => {
    setSaveError("");
    if (remoteChange?.conflicts.length) {
      setSaveError("Resolve the remote field changes before saving.");
      return;
    }
    setIsSaving(true);
    let savedReferral = loadedReferral;
    try {
      const referralId = referral?.id ?? loadedReferral?.id;
      const tags = normalizeTags(tagsInput);
      const admissionRequirements = createDefaultAdmissionRequirements(
        loadedReferral?.requirements ?? [],
        getEvidenceByType(documents),
        new Date().toISOString(),
        fields.owner.value.trim() || "Unassigned",
      );
      let payload: { referral?: Referral; error?: string };

      if (!referralId && !fields.name.value.trim() && !initialPacket) {
        throw new Error("Enter the client name or import a document before creating this referral.");
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
        const name = fields.name.value.trim() || "Pending packet review";
        const community = pipelineCommunities.includes(fields.county.value.trim() as PipelineCommunity)
          ? fields.county.value.trim() as PipelineCommunity
          : "Unassigned";
        const owner = fields.owner.value.trim() || "Unassigned";
        const createTags = tags.length > 0
          ? tags
          : [
              initialPacket ? "packet-import" : "manual-entry",
              initialPacket ? "needs-review" : "needs-documents",
              ...(!isAssignedValue(owner) || community === "Unassigned" ? ["needs-assignment"] : []),
            ];

        const now = new Date();
        const createdReferral: ReferralCreateInput = {
          name,
          date: fields.referralReceived.value.trim() || now.toISOString().slice(0, 10),
          stage: "New",
          community,
          source: fields.referent.value.trim() || "Referral packet",
          priority: "standard",
          tags: createTags,
          documentName: initialPacket?.name ?? "",
          documentSizeBytes: initialPacket?.size,
          documentHash,
          documentStatus: "Missing",
          owner,
          note: fields.summary.value.trim(),
          createdAt: now.toISOString(),
          dob: fields.dob.value.trim(),
          gender: fields.gender.value.trim(),
          reportedAge: fields.age.value.trim(),
          ssn: fields.ssn.value.trim(),
          admissionDate: fields.admissionDate.value.trim(),
          responsiblePerson: fields.responsiblePerson.value.trim(),
          interview: fields.interview.value.trim(),
          conserved,
          fieldSources: fieldSourcesFromFields(fields),
          phone: "",
          email: "",
          payer: "",
          requirements: admissionRequirements,
        };

        payload = await fetchPipelineJson<{ referral?: Referral; error?: string }>("/api/referrals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ referral: createdReferral, client_mutation_id: createMutationId() }),
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
        throw new Error(payload.error ?? "Could not save this referral.");
      }
      savedReferral = payload.referral;
      loadedReferralRef.current = savedReferral;
      setLoadedReferral(savedReferral);

      if (initialPacket) {
        setSavedAt("Uploading packet...");
        const upload = await uploadReferralPacket(savedReferral, initialPacket, documentHash!);
        setSavedAt("Linking extraction...");
        const extractedForm = upload.fields
          ? populateFormFromExtraction(
              fieldsRef.current,
              upload.fields.fields,
              initialPacket.name,
              new Set(),
            )
          : fieldsRef.current;
        const extractedKeys = new Set<PersistedFieldKey>(persistedFieldKeys.filter((key) => (
          extractedForm[key].value !== fieldsRef.current[key].value
          || extractedForm[key].sourceFile !== fieldsRef.current[key].sourceFile
        )));
        const extractedPatch = buildCanvasPatch({
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

      const latestProgress = await fetchPipelineJson<ReferralProgress>(`/api/referrals/${savedReferral.id}/progress`, { cache: "no-store" }).catch(() => null);
      if (latestProgress) setProgress(latestProgress);
      onReferralSaved?.({ id: savedReferral.id, name: savedReferral.name, community: savedReferral.community });
      setDirtyKeys(new Set());
      clearSessionDraft(referralId ? savedReferral.id : undefined);
      clearSessionDraft(savedReferral.id);
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
      setSaveError(error instanceof Error ? error.message : "Could not save this referral.");
    } finally {
      setIsSaving(false);
    }
  };

  const reviewExtractedField = async (
    extractedField: ExtractedField,
    action: "accept" | "edit",
    correctedValue?: string,
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
        await reviewExtractedField(extractedField, "accept");
      }
      const current = loadedReferralRef.current;
      if (current) {
        const latestProgress = await fetchPipelineJson<ReferralProgress>(`/api/referrals/${current.id}/progress`, { cache: "no-store" }).catch(() => null);
        if (latestProgress) setProgress(latestProgress);
      }
      setSavedAt(`${extractedFields.length} extracted values confirmed`);
    } finally {
      setIsBulkReviewing(false);
    }
  };

  const completePacketReview = async () => {
    const initialReferral = loadedReferralRef.current;
    if (!initialReferral?.packetId) {
      setSaveError("Save and extract the packet before completing review.");
      return;
    }
    let current: Referral = initialReferral;
    const packetId = initialReferral.packetId;

    setIsCompletingPacketReview(true);
    setSaveError("");
    setSavedAt("Checking packet review...");
    try {
      const pendingDraftKeys = new Set([...dirtyKeysRef.current].filter((key) => key !== "initialPacket"));
      if (pendingDraftKeys.size > 0) current = await persistExistingChanges(current, pendingDraftKeys);

      if (!isAssignedValue(current.owner)) throw new Error("Assign an owner before continuing to assessment.");
      if (current.community === "Unassigned") throw new Error("Choose a community before continuing to assessment.");

      const packet = await fetchPipelineJson<PacketFieldsResponse>(
        `/api/packets/${encodeURIComponent(packetId)}/fields`,
        { cache: "no-store" },
      );
      if (!packet.ehr_readiness.ready) {
        throw new Error(packet.ehr_readiness.blockers[0] ?? "Complete every extracted-field review before continuing.");
      }

      if (current.packetStatus !== "reviewed" || current.documentStatus !== "Reviewed") {
        const sections = normalizeReferralSectionVersions(current.sectionVersions);
        const updated = await fetchPipelineJson<{ referral?: Referral; error?: string }>(`/api/referrals/${current.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            if_match: current.version,
            if_match_sections: { documents: sections.documents },
            patch: {
              packetStatus: "reviewed",
              documentStatus: "Reviewed",
              packetFields: packet.fields,
              packetReadiness: packet.ehr_readiness,
              packetCompleteness: packet.packet_completeness,
            },
          }),
        });
        if (!updated.referral) throw new Error(updated.error ?? "The completed packet review could not be saved.");
        current = updated.referral;
      }

      const targetsByStage: Partial<Record<Referral["stage"], Referral["stage"][]>> = {
        New: ["Packet Needed", "Packet Review", "Assessment"],
        "Packet Needed": ["Packet Review", "Assessment"],
        "Packet Review": ["Assessment"],
      };
      for (const targetStage of targetsByStage[current.stage] ?? []) {
        const sections = normalizeReferralSectionVersions(current.sectionVersions);
        const transitionResult: { referral?: Referral; error?: string } = await fetchPipelineJson<{ referral?: Referral; error?: string }>(`/api/referrals/${current.id}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            if_match: current.version,
            if_match_section: sections.workflow,
            target_stage: targetStage,
          }),
        });
        if (!transitionResult.referral) throw new Error(transitionResult.error ?? "The referral could not advance to assessment.");
        current = transitionResult.referral;
      }

      loadedReferralRef.current = current;
      setLoadedReferral(current);
      setDirtyKeys(new Set());
      clearSessionDraft(current.id);
      const latestProgress = await fetchPipelineJson<ReferralProgress>(`/api/referrals/${current.id}/progress`, { cache: "no-store" }).catch(() => null);
      if (latestProgress) setProgress(latestProgress);
      setSavedAt("Packet review complete");
      openPage(4);
    } catch (error) {
      if (error instanceof PipelineApiError && error.status === 409) {
        const latest = getConflictReferral(error.payload);
        if (latest) receiveRemoteReferral(latest, latest.updatedBy?.name, true);
      }
      setSaveError(error instanceof Error ? error.message : "The packet review could not be completed.");
      throw error;
    } finally {
      setIsCompletingPacketReview(false);
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
        setTagsInput((latest.tags ?? []).join(", "));
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
      setTagsInput((current.tags ?? []).join(", "));
      setDocuments(documentsFromReferral(current));
    } else {
      setFields({ ...initialFields, name: { ...initialFields.name, value: referral?.name ?? "" } });
      setConserved("");
      setTagsInput("");
      setDocuments({});
    }
    setInitialPacket(null);
    setDirtyKeys(new Set());
    setRemoteChange(null);
    setRecoveredDraftAt("");
    setRecoveredPacketName("");
    clearSessionDraft(current?.id ?? referral?.id);
    setSavedAt(current ? "Saved record restored" : "Draft cleared");
  };

  const fieldCount = countCompleteFields(fields, Object.keys(fields) as FieldKey[]);
  const documentCount = Object.keys(documents).length;
  const admissionDocumentCount = requirements.filter((requirement) => Boolean(documents[requirement.id])).length;
  const attachmentCount = attachments.filter((attachment) => Boolean(documents[attachment.id])).length;
  const reviewSections: ReviewSection[] = [
    {
      label: "Identity",
      items: [
        reviewField("Client name", fields.name.value, 1),
        reviewField("Gender", fields.gender.value, 1),
        reviewField("Age", fields.age.value, 1),
        reviewField("Date of birth", fields.dob.value, 1),
        reviewField("SSN", fields.ssn.value, 1, true),
      ],
    },
    {
      label: "Referral details",
      items: [
        reviewField("Owner", isAssignedValue(fields.owner.value) ? fields.owner.value : "", 1),
        reviewField("Referral received", fields.referralReceived.value, 1),
        reviewField("Admission date", fields.admissionDate.value, 1),
        reviewField("Community", isAssignedValue(fields.county.value) ? fields.county.value : "", 1),
        reviewField("Referent", fields.referent.value, 1),
        reviewField("Responsible person", fields.responsiblePerson.value, 1),
        reviewField("Tags", tagsInput, 1),
      ],
    },
    {
      label: "Narrative",
      items: [
        reviewField("Summary", fields.summary.value, 1),
        reviewField("Interview", fields.interview.value, 1),
      ],
    },
    {
      label: "Documents",
      items: [
        reviewField(
          "Initial packet",
          loadedReferral?.documentStatus !== "Missing" ? loadedReferral?.documentName ?? "Recorded" : "",
          1,
        ),
        ...requirements.map((requirement) => reviewField(requirement.label, getRequirementReviewValue(requirement, documents[requirement.id], loadedReferral), 2)),
        ...attachments.map((requirement) => reviewField(requirement.label, documents[requirement.id] ?? "", 3)),
      ],
    },
    {
      label: "Assessment",
      items: [
        reviewField(
          "Assessment data",
          assessmentSummary.assessmentId
            ? `${assessmentSummary.captured} of ${assessmentSummary.total} fields · ${assessmentSummary.status.replace("_", " ")}`
            : "",
          4,
        ),
      ],
    },
  ];
  const reviewTotal = reviewSections.reduce((total, section) => total + section.items.length, 0);
  const reviewComplete = reviewSections.reduce((total, section) => total + section.items.filter((item) => item.value.trim()).length, 0);
  const reviewPercent = reviewTotal === 0 ? 0 : Math.round((reviewComplete / reviewTotal) * 100);
  const packetCompletionBlockers = getPacketCompletionBlockers(loadedReferral, fields.owner.value, fields.county.value);

  return (
    <div ref={canvasRef} className="relative h-full overflow-y-auto bg-white text-[#111111]">
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
        className="mx-auto w-full max-w-[1480px] px-2 pb-10 pt-3 sm:px-4 lg:px-6"
      >
        <div className="sticky top-0 z-20 mb-2 bg-white/95 pb-1 backdrop-blur-sm">
          <h1 className="sr-only">Referral packet</h1>
          <div className="flex items-center gap-3 border-y border-[#d9d9d9] py-1.5">
            <nav aria-label="Referral packet steps" className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
              {packetSteps.map(({ page, label }) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => openPage(page)}
                  aria-current={activePage === page ? "page" : undefined}
                  className={`flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-[12px] font-black transition-colors ${
                    activePage === page
                      ? "bg-[#e7f3ee] text-[#111111]"
                      : "text-[#737373] hover:bg-[#f7faf9] hover:text-[#0f8b73]"
                  }`}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${activePage === page ? "bg-[#0f8b73] text-white" : "bg-[#eef1ee] text-[#595959]"}`}>
                    {page}
                  </span>
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              ))}
            </nav>

            <div className="flex shrink-0 items-center gap-2 border-l border-[#d9d9d9] pl-3">
              <div className="hidden max-w-[28rem] text-right sm:block" aria-live="polite">
                <div className="text-[12px] font-normal text-[#737373]">{savedAt}</div>
                {saveError ? <div className="mt-0.5 text-[11px] font-semibold text-[#a4473c]">{saveError}</div> : null}
              </div>
              <button
                type="button"
                onClick={saveDraft}
                disabled={isSaving || Boolean(remoteChange?.conflicts.length)}
                className="flex h-10 items-center gap-2 border border-[#111111] bg-[#111111] px-4 text-[12px] font-black text-white hover:border-[#0f8b73] hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:border-[#b8b8b8] disabled:bg-[#b8b8b8]"
              >
                <Save size={15} />
                {isSaving ? "Saving..." : loadedReferral || referral?.id ? "Save chart" : "Create referral"}
              </button>
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

        <div className="mb-4">
          <ReferralProgressPanel compact progress={progress} loading={progressLoading} />
        </div>

        <div key={activePage} className="pipeline-step-enter">
          {activePage === 1 ? (
          <PacketPage id="packet-page-1" title="Chart">
            {loadedReferral?.packetFields?.length ? (
              <PacketExtractionReview
                fields={loadedReferral.packetFields}
                fileName={loadedReferral.documentName || "the uploaded packet"}
                developmentOnly={loadedReferral.packetMessage?.startsWith("Development")}
                busyFieldKey={reviewBusyFieldKey}
                bulkBusy={isBulkReviewing}
                completionBusy={isCompletingPacketReview}
                completionBlockers={packetCompletionBlockers}
                onAccept={(field) => reviewExtractedField(field, "accept")}
                onAcceptAll={acceptExtractedFields}
                onEdit={(field, value) => reviewExtractedField(field, "edit", value)}
                onContinue={completePacketReview}
              />
            ) : null}
            <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 space-y-7">
                <ChartSection title="Identity" detail="Core identifiers for this referral episode" complete={countCompleteFields(fields, ["name", "gender", "age", "dob", "ssn"])} total={5}>
                  <div className="grid gap-px overflow-hidden border border-[#d7ddd9] bg-[#d7ddd9] sm:grid-cols-2 lg:grid-cols-5">
                    {(["name", "gender", "age", "dob", "ssn"] as FieldKey[]).map((key) => (
                      <EditablePacketField
                        key={key}
                        field={fields[key]}
                        onChange={(value) => updateField(key, value)}
                      />
                    ))}
                  </div>
                </ChartSection>

                <ChartSection title="Referral" detail="Routing, ownership, dates, and search classification" complete={countCompleteFields(fields, ["owner", "county", "referralReceived", "admissionDate", "referent", "responsiblePerson"])} total={7}>
                  <div aria-label="Referral routing" className="grid gap-px overflow-hidden border border-[#d7ddd9] bg-[#d7ddd9] sm:grid-cols-2 lg:grid-cols-3">
                    {(["owner", "county", "referralReceived", "admissionDate", "referent", "responsiblePerson"] as FieldKey[]).map((key) => (
                      <EditablePacketField
                        key={key}
                        field={fields[key]}
                        options={key === "county" ? pipelineCommunities : undefined}
                        onChange={(value) => updateField(key, value)}
                      />
                    ))}
                    <div className="min-h-[86px] bg-white p-3 lg:col-span-2">
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
                    <div className="flex min-h-[86px] items-center justify-between gap-3 bg-white p-3">
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

                <ChartSection title="Clinical narrative" detail="Working summary and assessment interview notes" complete={countCompleteFields(fields, ["summary", "interview"])} total={2}>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <StructuredNarrativeField
                      field={fields.summary}
                      kind="summary"
                      onChange={(value) => updateField("summary", value)}
                    />
                    <StructuredNarrativeField
                      field={fields.interview}
                      kind="interview"
                      onChange={(value) => updateField("interview", value)}
                    />
                  </div>
                </ChartSection>
              </div>

              <aside aria-label="Chart completion and documents" className="space-y-5 xl:sticky xl:top-[64px]">
                <ChartCompletionRail
                  fieldCount={fieldCount}
                  fieldTotal={Object.keys(fields).length}
                  documents={documents}
                  referral={loadedReferral}
                  assessmentSummary={assessmentSummary}
                  onOpenStep={openPage}
                />
                <InitialPacketDropzone
                  compact
                  file={initialPacket}
                  recordedName={loadedReferral?.documentName}
                  recordedStatus={loadedReferral?.documentStatus}
                  message={loadedReferral?.packetMessage}
                  onSelect={selectInitialPacket}
                  onClear={() => {
                    setInitialPacket(null);
                    markDirty("initialPacket");
                    setSavedAt("Unsaved changes");
                  }}
                />
              </aside>
            </div>
          </PacketPage>
          ) : activePage === 2 ? (
            <PacketPage id="packet-page-2" title="Required files">
              <div className="mb-5 flex items-center justify-between gap-4 border-b border-[#d9d9d9] pb-4">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-[#0c705f]">Required documents</div>
              </div>
              <span className="shrink-0 border-l-2 border-[#0f8b73] px-3 py-1 text-[11px] font-black text-[#595959]">
                {admissionDocumentCount} / {requirements.length} attached
              </span>
            </div>
            <div className="grid gap-2">
              {requirements.map((requirement) => (
                <DocumentDropRow
                  key={requirement.id}
                  requirement={requirement}
                  fileName={documents[requirement.id]}
                  onAttach={(file) => attachDocument(requirement.id, file)}
                />
              ))}
            </div>
            </PacketPage>
          ) : activePage === 3 ? (
            <PacketPage id="packet-page-3" title="Other files">
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-[#d9d9d9] pb-4">
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-[#0c705f]">Supporting documents</div>
              <span className="shrink-0 border-l-2 border-[#0f8b73] px-3 py-1 text-[11px] font-black text-[#595959]">
                {attachmentCount} / {attachments.length} attached
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {attachments.map((requirement) => (
                <DocumentDropRow
                  key={requirement.id}
                  requirement={requirement}
                  fileName={documents[requirement.id]}
                  onAttach={(file) => attachDocument(requirement.id, file)}
                  compact
                />
              ))}
            </div>
            <div className="mt-8 border-t border-[#d9d9d9] pt-5">
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">
                Packet completion
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="h-2 min-w-[220px] flex-1 overflow-hidden bg-[#d9ded9]">
                  <div
                    className="h-full bg-[#0f8b73] transition-all"
                    style={{
                      width: `${Math.round(((fieldCount + documentCount) / (Object.keys(fields).length + requirements.length + attachments.length)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-[12px] font-black text-[#111111]">
                  {fieldCount + documentCount} items captured
                </span>
              </div>
            </div>
            </PacketPage>
          ) : activePage === 4 ? (
            <PacketPage id="packet-page-4" title="Assessment">
              <AssessmentWorkspace
                referralId={loadedReferral?.id ?? referral?.id}
                onSummaryChange={setAssessmentSummary}
              />
            </PacketPage>
          ) : (
            <DataReview
              clientName={fields.name.value}
              referral={loadedReferral}
              assessmentComplete={assessmentSummary.status === "complete"}
              sections={reviewSections}
              complete={reviewComplete}
              total={reviewTotal}
              percent={reviewPercent}
              onOpenStep={openPage}
              onDecisionSaved={async (updatedReferral) => {
                setLoadedReferral(updatedReferral);
                const latestProgress = await fetchPipelineJson<ReferralProgress>(`/api/referrals/${updatedReferral.id}/progress`, { cache: "no-store" }).catch(() => null);
                if (latestProgress) setProgress(latestProgress);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DataReview({
  clientName,
  referral,
  assessmentComplete,
  sections,
  complete,
  total,
  percent,
  onOpenStep,
  onDecisionSaved,
}: {
  clientName: string;
  referral: Referral | null;
  assessmentComplete: boolean;
  sections: ReviewSection[];
  complete: number;
  total: number;
  percent: number;
  onOpenStep: (page: ReviewStep) => void;
  onDecisionSaved: (referral: Referral) => void | Promise<void>;
}) {
  return (
    <section aria-label="Review" className="py-2 sm:px-2 sm:py-3">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d9d9d9] pb-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">Referral review</div>
          <h2 className="mt-1 text-[24px] font-black text-[#111111]">{clientName.trim() || "Unnamed client"}</h2>
          <p className="mt-1 text-[12px] text-[#737373]">What has been collected for this referral.</p>
        </div>
        <div className="min-w-[180px]">
          <div className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="font-black text-[#111111]">{complete} of {total} items present</span>
            <span className="font-black text-[#0f8b73]">{percent}%</span>
          </div>
          <div className="mt-2 h-2 bg-[#e4e8e3]">
            <div className="h-full bg-[#0f8b73] transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {sections.map((section) => {
          const sectionComplete = section.items.filter((item) => item.value.trim()).length;
          return (
            <section key={section.label} className="border border-[#d9d9d9] bg-white">
              <div className="flex items-center justify-between border-b border-[#d9d9d9] px-4 py-3">
                <h3 className="text-[12px] font-black uppercase tracking-[0.1em] text-[#111111]">{section.label}</h3>
                <span className="text-[11px] font-black text-[#0f8b73]">{sectionComplete}/{section.items.length}</span>
              </div>
              <div className="divide-y divide-[#eeeeee]">
                {section.items.map((item) => {
                  const present = item.value.trim().length > 0;
                  const displayValue = present ? (item.sensitive ? "Entered" : item.value.trim()) : "Not entered";
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => onOpenStep(item.step)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#f7faf9]"
                    >
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${present ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#b98b1c] text-[#b98b1c]"}`}>
                        {present ? <Check size={12} /> : <Circle size={8} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-black text-[#111111]">{item.label}</span>
                        <span className={`mt-0.5 block truncate text-[11px] ${present ? "text-[#595959]" : "text-[#a06d17]"}`}>{displayValue}</span>
                      </span>
                      <ArrowRight size={14} className="shrink-0 text-[#0f8b73]" />
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <ReferralRequirementsEditor referral={referral} onReferralUpdated={onDecisionSaved} />
      <AdmissionDecisionEditor
        referral={referral}
        assessmentComplete={assessmentComplete}
        onSaved={onDecisionSaved}
      />
      <EhrHandoffEditor referral={referral} onSaved={onDecisionSaved} />
      <ReferralActivityPanel referralId={referral?.id} version={referral?.version} />
    </section>
  );
}

function EhrHandoffEditor({
  referral,
  onSaved,
}: {
  referral: Referral | null;
  onSaved: (referral: Referral) => void | Promise<void>;
}) {
  const handoff = referral?.ehrHandoff;
  const [failureReason, setFailureReason] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const accepted = referral?.stage === "Accepted / Admitted" && referral.admissionDecision?.outcome === "accepted";

  const run = async (action: "queue" | "mark_sent" | "mark_failed" | "retry") => {
    if (!referral) return;
    setSaving(true);
    setMessage("");
    try {
      const payload = await fetchPipelineJson<{ referral: Referral; ehr_handoff: EhrHandoffRecord }>(
        `/api/referrals/${referral.id}/ehr-handoff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            if_match: referral.version,
            if_match_section: referral.sectionVersions?.decision ?? 1,
            action,
            failure_reason: action === "mark_failed" ? failureReason.trim() : "",
          }),
        },
      );
      await onSaved(payload.referral);
      setFailureReason("");
      setMessage({
        queue: "EHR handoff queued.",
        retry: "EHR handoff queued again.",
        mark_sent: "EHR handoff recorded as sent.",
        mark_failed: "EHR handoff failure recorded.",
      }[action]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The EHR handoff could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  if (!referral?.admissionDecision || referral.admissionDecision.outcome !== "accepted") return null;

  const status = handoff?.status ?? "not_ready";
  return (
    <section aria-label="EHR handoff" className="mt-5 border-t border-[#d9d9d9] pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">EHR handoff</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[13px] font-black capitalize">{status.replace("_", " ")}</span>
            {handoff?.queuedAt ? (
              <span className="text-[11px] text-[#737373]">Queued {new Date(handoff.queuedAt).toLocaleString()}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(status === "not_ready" || status === "ready") ? (
            <button
              type="button"
              onClick={() => void run("queue")}
              disabled={!accepted || saving}
              className="h-9 bg-[#111111] px-4 text-[10px] font-black uppercase tracking-[0.08em] text-white hover:bg-[#0f8b73] disabled:bg-[#d9d9d9]"
            >
              Queue handoff
            </button>
          ) : null}
          {status === "failed" ? (
            <button type="button" onClick={() => void run("retry")} disabled={saving} className="h-9 bg-[#111111] px-4 text-[10px] font-black uppercase tracking-[0.08em] text-white hover:bg-[#0f8b73] disabled:bg-[#d9d9d9]">
              Retry
            </button>
          ) : null}
          {status === "queued" ? (
            <>
              <button type="button" onClick={() => void run("mark_sent")} disabled={saving} className="h-9 border border-[#0f8b73] px-4 text-[10px] font-black uppercase tracking-[0.08em] text-[#0f8b73] hover:bg-[#effaf5] disabled:text-[#b3b3b3]">
                Mark sent
              </button>
              <input
                value={failureReason}
                onChange={(event) => setFailureReason(event.target.value)}
                placeholder="Failure reason"
                aria-label="EHR handoff failure reason"
                className="h-9 w-44 border border-[#c9ceca] px-3 text-[11px] outline-none focus:border-[#a63d2f]"
              />
              <button type="button" onClick={() => void run("mark_failed")} disabled={saving || !failureReason.trim()} className="h-9 border border-[#a63d2f] px-4 text-[10px] font-black uppercase tracking-[0.08em] text-[#a63d2f] hover:bg-[#fff7f5] disabled:border-[#d9d9d9] disabled:text-[#b3b3b3]">
                Mark failed
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-2 min-h-4 text-[11px] text-[#737373]">
        {message || (!accepted ? "Move the accepted referral to Accepted / Admitted before queueing the handoff." : status === "not_ready" ? "Queue only after the accepted record and EHR requirements are complete." : handoff?.failureReason ?? "")}
      </div>
    </section>
  );
}

function AdmissionDecisionEditor({
  referral,
  assessmentComplete,
  onSaved,
}: {
  referral: Referral | null;
  assessmentComplete: boolean;
  onSaved: (referral: Referral) => void | Promise<void>;
}) {
  const existing = referral?.admissionDecision;
  const [outcome, setOutcome] = useState<AdmissionDecision["outcome"] | "">(existing?.outcome ?? "");
  const [reasonNote, setReasonNote] = useState(existing?.reasonNote ?? "");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOutcome(referral?.admissionDecision?.outcome ?? "");
    setReasonNote(referral?.admissionDecision?.reasonNote ?? "");
  }, [referral?.admissionDecision]);

  const saveDecision = async () => {
    if (!referral || !outcome) return;
    setSaving(true);
    setStatus("");
    try {
      const payload = await fetchPipelineJson<{ referral: Referral; decision: AdmissionDecision }>(
        `/api/referrals/${referral.id}/decision`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            if_match: referral.version,
            if_match_section: referral.sectionVersions?.decision ?? 1,
            outcome,
            reason_note: outcome === "declined" ? reasonNote : "",
          }),
        },
      );
      await onSaved(payload.referral);
      setStatus("Decision saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save the admission decision.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Admission decision" className="mt-5 border-t border-[#d9d9d9] pt-5">
      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">Admission decision</div>
          <div className="mt-2 flex border border-[#c9ceca] bg-white">
            {(["accepted", "declined"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setOutcome(value)}
                disabled={!referral || !assessmentComplete}
                className={`h-10 flex-1 px-4 text-[11px] font-black uppercase ${outcome === value ? "bg-[#111111] text-white" : "text-[#595959] hover:bg-[#f7faf9]"} disabled:cursor-not-allowed disabled:text-[#b3b3b3]`}
              >
                {value === "accepted" ? "Yes" : "No"}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#595959]">Why no admission</span>
          <textarea
            value={reasonNote}
            onChange={(event) => setReasonNote(event.target.value)}
            disabled={outcome !== "declined"}
            rows={2}
            className="mt-2 w-full resize-none border border-[#c9ceca] px-3 py-2 text-[12px] outline-none focus:border-[#0f8b73] disabled:bg-[#f7f7f7]"
          />
        </label>
        <button
          type="button"
          onClick={saveDecision}
          disabled={!referral || !assessmentComplete || !outcome || (outcome === "declined" && !reasonNote.trim()) || saving}
          className="h-10 bg-[#111111] px-5 text-[11px] font-black uppercase text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:bg-[#d9d9d9]"
        >
          {saving ? "Saving" : "Save decision"}
        </button>
      </div>
      <div className="mt-2 min-h-4 text-[11px] text-[#737373]">
        {status || (!referral ? "Save the referral first." : !assessmentComplete ? "Complete the assessment before recording Yes or No." : existing ? `Recorded by ${existing.decidedByName}.` : "")}
      </div>
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
    <section aria-label={`${title} chart section`}>
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

function ChartCompletionRail({
  fieldCount,
  fieldTotal,
  documents,
  referral,
  assessmentSummary,
  onOpenStep,
}: {
  fieldCount: number;
  fieldTotal: number;
  documents: Record<string, string>;
  referral: Referral | null;
  assessmentSummary: { captured: number; total: number; status: string; assessmentId?: string };
  onOpenStep: (page: 1 | 2 | 3 | 4 | 5) => void;
}) {
  const documentItems = [
    ...requirements.map((requirement) => ({ ...requirement, page: 2 as const })),
    ...attachments.map((requirement) => ({ ...requirement, page: 3 as const })),
  ];
  const capturedDocuments = documentItems.filter((item) => getRequirementReviewValue(item, documents[item.id], referral)).length;
  const percent = fieldTotal === 0 ? 0 : Math.round((fieldCount / fieldTotal) * 100);

  return (
    <section aria-label="Chart completion" className="border-t-2 border-[#111111] pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[13px] font-black text-[#111111]">Chart status</h2>
          <p className="mt-1 text-[11px] leading-5 text-[#737373]">One view of what is recorded and what still needs attention.</p>
        </div>
        <span className="text-[22px] font-black text-[#111111]">{percent}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden bg-[#e5e9e6]">
        <div className="h-full bg-[#0f8b73] transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <dl className="mt-4 divide-y divide-[#e3e5e3] border-y border-[#e3e5e3]">
        <ChartStatusRow label="Chart fields" value={`${fieldCount} / ${fieldTotal}`} />
        <ChartStatusRow label="Required files" value={`${capturedDocuments} / ${documentItems.length}`} attention={capturedDocuments < documentItems.length} />
        <ChartStatusRow
          label="Assessment"
          value={assessmentSummary.assessmentId ? assessmentSummary.status.replaceAll("_", " ") : "Not started"}
          attention={assessmentSummary.status !== "complete"}
        />
      </dl>

      <div className="mt-5 flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Documents needed</h3>
        <button type="button" onClick={() => onOpenStep(2)} className="text-[10px] font-black text-[#595959] hover:text-[#0f8b73]">Manage files</button>
      </div>
      <div className="mt-2 divide-y divide-[#e3e5e3] border-y border-[#e3e5e3]">
        {documentItems.map((item) => {
          const value = getRequirementReviewValue(item, documents[item.id], referral);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenStep(item.page)}
              aria-label={`${item.label}: ${value ? "attached" : "missing"}`}
              className="flex min-h-10 w-full items-center gap-2 py-2 text-left hover:bg-[#f7faf9]"
            >
              {value ? <CheckCircle2 size={14} className="shrink-0 text-[#0f8b73]" /> : <Circle size={14} className="shrink-0 text-[#b1b6b3]" />}
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#303638]">{item.label}</span>
              <span className={`text-[9px] font-black uppercase ${value ? "text-[#0f8b73]" : "text-[#9a9a9a]"}`}>{value ? "Ready" : "Missing"}</span>
            </button>
          );
        })}
      </div>
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
      <div className="px-0 py-2 sm:px-2 sm:py-3">{children}</div>
    </section>
  );
}

function InitialPacketDropzone({
  compact = false,
  file,
  recordedName,
  recordedStatus,
  message,
  onSelect,
  onClear,
}: {
  compact?: boolean;
  file: File | null;
  recordedName?: string;
  recordedStatus?: Referral["documentStatus"];
  message?: string;
  onSelect: (file: File | undefined) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const displayName = file?.name || recordedName;
  const hasRecordedPacket = Boolean(recordedName && recordedStatus !== "Missing");

  return (
    <section aria-label="Initial referral packet" className={compact ? "border-t-2 border-[#111111] pt-4" : "mb-5 border-b border-[#d9d9d9] pb-5"}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-black uppercase tracking-[0.12em] text-[#0f8b73]">Import documents</h3>
          <p className="mt-1 text-[11px] leading-5 text-[#595959]">Optional. Upload a face sheet or packet to propose chart values for review.</p>
        </div>
        {!compact ? <span className="text-[11px] font-semibold text-[#737373]">PDF or image, up to 100 MB</span> : null}
      </div>

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onSelect(event.dataTransfer.files?.[0]);
        }}
        className={`flex items-center gap-3 border border-dashed px-3 py-3 transition-colors ${compact ? "min-h-24" : "min-h-20"} ${
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
                : "You can create and complete the chart without importing a file."}
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

function reviewField(label: string, value: string, step: ReviewStep, sensitive = false): ReviewItem {
  return { label, value, step, ...(sensitive ? { sensitive: true } : {}) };
}

function countCompleteFields(fields: Record<FieldKey, PacketField>, keys: readonly FieldKey[]) {
  return keys.filter((key) => {
    const value = fields[key].value.trim();
    return Boolean(value) && value !== "Unassigned";
  }).length;
}

function getPacketCompletionBlockers(referral: Referral | null, owner: string, community: string) {
  const blockers: string[] = [];
  if (!isAssignedValue(owner)) blockers.push("Assign an owner to continue.");
  if (!community.trim() || community === "Unassigned") blockers.push("Choose a community to continue.");
  const unusableField = referral?.packetFields?.find((field) => (
    field.review_status === "rejected" || !(field.final_value ?? field.proposed_value)?.trim()
  ));
  if (unusableField) blockers.push("Correct or supply every extracted value before continuing.");
  return blockers;
}

function isAssignedValue(value: string) {
  return !isUnassignedOwner(value);
}

function getRequirementReviewValue(requirement: Requirement, localFileName: string | undefined, referral: Referral | null) {
  if (localFileName) return localFileName;
  const savedRequirement = referral?.requirements?.find((item) => item.label === requirement.label || item.id === requirement.id);
  if (savedRequirement?.evidenceDocumentName) return savedRequirement.evidenceDocumentName;
  if (savedRequirement && ["received", "reviewed", "waived"].includes(savedRequirement.status)) return "Recorded";
  return "";
}

function getEvidenceByType(documents: Record<string, string>) {
  return Object.fromEntries(
    [...requirements, ...attachments]
      .map((definition) => [definition.type, documents[definition.id]?.trim()] as const)
      .filter((entry): entry is readonly [RequirementType, string] => Boolean(entry[1])),
  ) as Partial<Record<RequirementType, string>>;
}

function EditablePacketField({
  field,
  options,
  onChange,
}: {
  field: PacketField;
  options?: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="group min-h-[86px] border border-transparent bg-white p-3 transition-colors focus-within:border-[#0f8b73] focus-within:bg-[#fbfdfc] hover:bg-[#fbfdfc]">
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
          <option value="">Select community</option>
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

function StructuredNarrativeField({
  field,
  kind,
  onChange,
}: {
  field: PacketField;
  kind: NarrativeKind;
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sections = narrativeSections[kind];
  const values = parseStructuredNarrative(field.value, sections);
  const completedSections = sections.filter((section) => values[section.key]?.trim()).length;
  const previewSections = sections
    .map((section) => ({ ...section, value: values[section.key]?.trim() ?? "" }))
    .filter((section) => section.value)
    .slice(0, 2);

  const closeEditor = useCallback(() => {
    setIsOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  return (
    <>
      <section aria-label={`${field.label} chart field`} className="flex min-h-[190px] flex-col border border-[#d7ddd9] bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-black uppercase tracking-[0.08em] text-[#3f4745]">{field.label}</h3>
            <p className="mt-1 text-[11px] font-semibold text-[#737373]">{completedSections} of {sections.length} sections</p>
          </div>
          {field.sourceFile ? <span className="text-[9px] font-black uppercase text-[#317f8f]">Imported</span> : null}
        </div>

        <div className="mt-4 flex-1 space-y-3">
          {previewSections.length ? previewSections.map((section) => (
            <div key={section.key}>
              <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#737373]">{section.label}</div>
              <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-5 text-[#303638]">{section.value}</p>
            </div>
          )) : (
            <p className="max-w-[36ch] text-[12px] leading-5 text-[#737373]">No {field.label.toLowerCase()} captured yet.</p>
          )}
        </div>

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-[#e3e6e4] pt-3">
          <div className="min-w-0 text-[10px] text-[#737373]">
            {field.sourceFile ? <span className="truncate">Source: {field.sourceFile}</span> : "Manual chart entry"}
          </div>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setIsOpen(true)}
            className="flex h-9 shrink-0 items-center gap-2 border border-[#0c705f] px-3 text-[10px] font-black uppercase tracking-[0.08em] text-[#0c705f] hover:bg-[#effaf5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0c705f]"
          >
            <PencilLine size={14} />
            Edit {field.label.toLowerCase()}
          </button>
        </div>
      </section>

      {isOpen ? (
        <StructuredNarrativeDialog
          title={field.label}
          sections={sections}
          values={values}
          onChange={(sectionKey, value) => {
            onChange(serializeStructuredNarrative(sections, { ...values, [sectionKey]: value }));
          }}
          onClose={closeEditor}
        />
      ) : null}
    </>
  );
}

function StructuredNarrativeDialog({
  title,
  sections,
  values,
  onChange,
  onClose,
}: {
  title: string;
  sections: readonly NarrativeSection[];
  values: Record<string, string>;
  onChange: (sectionKey: string, value: string) => void;
  onClose: () => void;
}) {
  const firstFieldRef = useRef<HTMLTextAreaElement>(null);
  const completedSections = sections.filter((section) => values[section.key]?.trim()).length;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-stretch justify-center bg-black/30 p-0 sm:p-5" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`structured-${title.toLowerCase()}-title`}
        className="flex h-full w-full max-w-[1080px] flex-col overflow-hidden bg-white shadow-[0_24px_70px_rgba(17,17,17,0.2)] sm:h-[calc(100vh-40px)]"
      >
        <header className="flex min-h-[76px] items-center justify-between gap-5 border-b-2 border-[#111111] px-5 sm:px-8">
          <div>
            <h2 id={`structured-${title.toLowerCase()}-title`} className="text-[24px] font-black text-[#111111] sm:text-[30px]">{title}</h2>
            <div className="mt-1 text-[11px] font-black uppercase tracking-[0.08em] text-[#0c705f]">{completedSections} of {sections.length} sections complete</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()} editor`}
            title="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#c9ceca] text-[#303638] hover:border-[#111111] hover:bg-[#f7faf9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73]"
          >
            <X size={19} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-7">
          <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
            {sections.map((section, index) => (
              <label key={section.key} className="block border-t border-[#cfd5d1] pt-3">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-black uppercase tracking-[0.08em] text-[#303638]">{section.label}</span>
                  {values[section.key]?.trim() ? <CheckCircle2 size={15} className="shrink-0 text-[#0c705f]" /> : null}
                </span>
                <textarea
                  ref={index === 0 ? firstFieldRef : undefined}
                  aria-label={`${title}: ${section.label}`}
                  value={values[section.key] ?? ""}
                  placeholder={section.placeholder}
                  onChange={(event) => onChange(section.key, event.target.value)}
                  className="mt-3 min-h-[132px] w-full resize-y border border-[#d7ddd9] bg-[#fbfdfc] p-3 text-[13px] font-medium leading-6 text-[#303638] outline-none placeholder:text-[#9a9a9a] focus:border-[#0f8b73] focus:bg-white"
                />
              </label>
            ))}
          </div>
        </div>

        <footer className="flex min-h-[70px] items-center justify-end border-t border-[#d9d9d9] px-5 sm:px-8">
          <button
            type="button"
            onClick={onClose}
            className="h-10 bg-[#111111] px-6 text-[11px] font-black uppercase tracking-[0.08em] text-white hover:bg-[#0f8b73] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73]"
          >
            Done
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function parseStructuredNarrative(value: string, sections: readonly NarrativeSection[]) {
  const result = Object.fromEntries(sections.map((section) => [section.key, ""])) as Record<string, string>;
  const normalized = value.trim();
  if (!normalized) return result;

  const headingMatches = sections
    .map((section) => ({ section, marker: `## ${section.label}` }))
    .map(({ section, marker }) => ({ section, index: normalized.indexOf(marker), marker }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index);

  if (!headingMatches.length) {
    result[sections[sections.length - 1].key] = normalized;
    return result;
  }

  headingMatches.forEach((match, index) => {
    const start = match.index + match.marker.length;
    const end = headingMatches[index + 1]?.index ?? normalized.length;
    result[match.section.key] = normalized.slice(start, end).trim();
  });
  return result;
}

function serializeStructuredNarrative(sections: readonly NarrativeSection[], values: Record<string, string>) {
  return sections
    .map((section) => ({ section, value: values[section.key]?.trim() ?? "" }))
    .filter(({ value }) => value)
    .map(({ section, value }) => `## ${section.label}\n${value}`)
    .join("\n\n");
}

function DocumentDropRow({
  requirement,
  fileName,
  onAttach,
  compact = false,
}: {
  requirement: Requirement;
  fileName?: string;
  onAttach: (file: File) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (file) onAttach(file);
      }}
      className={`border border-[#d8d9bf] bg-[#fffbd5] p-4 ${compact ? "min-h-[190px]" : "grid gap-3 md:grid-cols-[minmax(0,1fr)_250px] md:items-center"}`}
    >
      <div>
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-[#6f641b]" />
          <div className="text-[13px] font-black text-[#303638]">{requirement.label}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`mt-3 flex w-full items-center justify-center gap-2 border border-dashed border-[#c6ba59] bg-[#fffde8] px-3 text-[11px] font-black text-[#6f641b] hover:bg-white ${compact ? "h-24" : "h-16 md:mt-0"}`}
      >
        {fileName ? <Check size={15} /> : <UploadCloud size={16} />}
        <span className="max-w-full truncate">{fileName ?? "Drop document or browse"}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.heic,.xlsx,.xls,.csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onAttach(file);
        }}
      />
    </div>
  );
}

function populateFormFromExtraction(
  current: Record<FieldKey, PacketField>,
  extractedFields: ExtractedField[],
  sourceFile: string,
  dirty: ReadonlySet<DirtyDraftKey> = new Set(),
) {
  const extractedByKey = new Map(
    extractedFields
      .filter((field) => field.review_status !== "rejected")
      .map((field) => [field.field_key, field] as const),
  );
  const firstName = extractedValue(extractedByKey, ["referral.first_name", "demographics.first_name"]);
  const lastName = extractedValue(extractedByKey, ["referral.last_name", "demographics.last_name"]);
  const directName = extractedValue(extractedByKey, ["referral.full_name", "demographics.full_name"]);
  const compositeName = firstName?.value && lastName?.value
    ? `${firstName.value} ${lastName.value}`
    : "";
  const fullName = directName?.value || compositeName;
  const nameSource = directName?.field ?? firstName?.field ?? lastName?.field;
  const compositeNameConfirmed = Boolean(
    firstName?.field
    && lastName?.field
    && [firstName.field.review_status, lastName.field.review_status].every((status) => (
      status === "accepted" || status === "edited"
    )),
  );

  const updates: Partial<Record<FieldKey, { value: string; field?: ExtractedField; confirmed?: boolean }>> = {
    ...(fullName
      ? {
          name: {
            value: fullName,
            ...(nameSource ? { field: nameSource } : {}),
            ...(directName ? {} : { confirmed: compositeNameConfirmed }),
          },
        }
      : {}),
    dob: extractedValue(extractedByKey, ["referral.date_of_birth", "demographics.date_of_birth"]),
    age: extractedValue(extractedByKey, ["referral.age", "demographics.age"]),
    gender: extractedValue(extractedByKey, ["referral.gender", "demographics.gender"]),
    admissionDate: extractedValue(extractedByKey, ["referral.preferred_admission_date"]),
    referent: extractedValue(extractedByKey, [
      "referral.source",
      "referral.referring_provider",
      "referral.referring_facility",
    ]),
    responsiblePerson: extractedValue(extractedByKey, [
      "referral.emergency_contact",
      "assessment.guardian_contact",
    ]),
    summary: extractedValue(extractedByKey, ["referral.packet_summary"]),
    interview: extractedValue(extractedByKey, ["assessment.presenting_needs", "referral.notes"]),
  };
  const community = extractedValue(extractedByKey, ["assessment.community_preference"]);
  if (community && pipelineCommunities.includes(community.value as PipelineCommunity)) {
    updates.county = community;
  }

  let changed = false;
  const next = { ...current };
  for (const [key, update] of Object.entries(updates) as Array<[
    FieldKey,
    { value: string; field?: ExtractedField; confirmed?: boolean } | undefined,
  ]>) {
    if (!update?.value) continue;
    if (dirty.has(key)) continue;
    const humanConfirmed = update.confirmed
      ?? (update.field?.review_status === "accepted" || update.field?.review_status === "edited");
    if (!humanConfirmed && current[key].value.trim()) continue;
    if (current[key].value === update.value && current[key].sourceFile === sourceFile) continue;

    next[key] = {
      ...current[key],
      value: update.value,
      sourceFile,
    };
    changed = true;
  }

  return changed ? next : current;
}

function extractedCanvasFieldKeys(fieldKey: string): PersistedFieldKey[] {
  const mappings: Record<string, PersistedFieldKey[]> = {
    "referral.first_name": ["name"],
    "demographics.first_name": ["name"],
    "referral.last_name": ["name"],
    "demographics.last_name": ["name"],
    "referral.full_name": ["name"],
    "demographics.full_name": ["name"],
    "referral.date_of_birth": ["dob"],
    "demographics.date_of_birth": ["dob"],
    "referral.age": ["age"],
    "demographics.age": ["age"],
    "referral.gender": ["gender"],
    "demographics.gender": ["gender"],
    "referral.preferred_admission_date": ["admissionDate"],
    "referral.source": ["referent"],
    "referral.referring_provider": ["referent"],
    "referral.referring_facility": ["referent"],
    "referral.emergency_contact": ["responsiblePerson"],
    "assessment.guardian_contact": ["responsiblePerson"],
    "referral.packet_summary": ["summary"],
    "assessment.presenting_needs": ["interview"],
    "referral.notes": ["interview"],
    "assessment.community_preference": ["county"],
  };
  return mappings[fieldKey] ?? [];
}

const persistedFieldKeys = [
  "name",
  "gender",
  "age",
  "dob",
  "ssn",
  "owner",
  "referralReceived",
  "admissionDate",
  "county",
  "referent",
  "responsiblePerson",
  "summary",
  "interview",
] as const;
type PersistedFieldKey = (typeof persistedFieldKeys)[number];

function isPersistedFieldKey(value: DirtyDraftKey): value is PersistedFieldKey {
  return (persistedFieldKeys as readonly string[]).includes(value);
}

function referralDraftValue(referral: Referral, key: PersistedFieldKey) {
  return {
    name: referral.name,
    gender: referral.gender ?? "",
    age: referral.reportedAge ?? "",
    dob: referral.dob,
    ssn: referral.ssn ?? "",
    owner: referral.owner,
    referralReceived: referral.date,
    admissionDate: referral.admissionDate ?? "",
    county: referral.community,
    referent: referral.source,
    responsiblePerson: referral.responsiblePerson ?? "",
    summary: referral.note,
    interview: referral.interview ?? "",
  }[key] ?? "";
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

function documentNames(documents: Record<string, string>) {
  return Object.values(documents).filter(Boolean).sort().join(", ");
}

function fieldSourcesFromFields(fields: Record<FieldKey, PacketField>) {
  return Object.fromEntries(
    persistedFieldKeys
      .map((key) => [key, fields[key].sourceFile?.trim()] as const)
      .filter((entry): entry is readonly [FieldKey, string] => Boolean(entry[1])),
  );
}

function buildCanvasPatch(input: {
  keys: ReadonlySet<DirtyDraftKey>;
  fields: Record<FieldKey, PacketField>;
  conserved: "yes" | "no" | "";
  tags: string[];
  requirements: Referral["requirements"];
  packet?: { file: File; hash: string };
}): ReferralPatch {
  const patch: ReferralPatch = {};
  const fieldPatchKeys: Partial<Record<FieldKey, keyof ReferralPatch>> = {
    name: "name",
    gender: "gender",
    age: "reportedAge",
    dob: "dob",
    ssn: "ssn",
    owner: "owner",
    referralReceived: "date",
    admissionDate: "admissionDate",
    county: "community",
    referent: "source",
    responsiblePerson: "responsiblePerson",
    summary: "note",
    interview: "interview",
  };
  let fieldChanged = false;
  for (const key of persistedFieldKeys) {
    if (!input.keys.has(key)) continue;
    const patchKey = fieldPatchKeys[key];
    if (!patchKey) continue;
    fieldChanged = true;
    (patch as Record<string, unknown>)[patchKey] = input.fields[key].value;
  }
  if (fieldChanged) patch.fieldSources = fieldSourcesFromFields(input.fields);
  if (input.keys.has("conserved")) patch.conserved = input.conserved;
  if (input.keys.has("tags")) patch.tags = input.tags;
  if (input.keys.has("documents")) patch.requirements = input.requirements;
  if (input.keys.has("initialPacket") && input.packet) {
    patch.documentName = input.packet.file.name;
    patch.documentSizeBytes = input.packet.file.size;
    patch.documentHash = input.packet.hash;
    patch.documentStatus = "Missing";
  }
  return patch;
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
  setDirtyKeys: Dispatch<SetStateAction<Set<DirtyDraftKey>>>;
  setRecoveredDraftAt: Dispatch<SetStateAction<string>>;
  setRecoveredPacketName: Dispatch<SetStateAction<string>>;
};

function restoreSessionDraft(referralId: number | undefined, setters: DraftRestoreSetters) {
  let draft: CanvasSessionDraft | null = null;
  try {
    const raw = window.sessionStorage.getItem(canvasDraftStorageKey(referralId));
    if (!raw) return null;
    draft = parsePipelineReferralDraft(JSON.parse(raw));
    if (!draft) return null;
  } catch {
    clearSessionDraft(referralId);
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

function canvasDraftStorageKey(referralId?: number) {
  return `pipeline-referral-draft:${referralId ?? "new"}`;
}

function clearSessionDraft(referralId?: number) {
  if (usesServerReferralDrafts()) {
    void clearServerReferralDraft(referralId).catch(() => undefined);
    return;
  }
  try {
    window.sessionStorage.removeItem(canvasDraftStorageKey(referralId));
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

function presenceSection(page: 1 | 2 | 3 | 4 | 5): ReferralSection {
  if (page === 2 || page === 3) return "documents";
  if (page === 4) return "assessment";
  if (page === 5) return "workflow";
  return "intake";
}

function presenceSectionLabel(section: ReferralSection) {
  return {
    identity: "Identity",
    intake: "Chart",
    documents: "Documents",
    assessment: "Assessment",
    workflow: "Review",
    decision: "Admission decision",
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

function extractedValue(
  fields: Map<string, ExtractedField>,
  fieldKeys: string[],
): { value: string; field: ExtractedField } | undefined {
  for (const fieldKey of fieldKeys) {
    const field = fields.get(fieldKey);
    const value = (field?.final_value ?? field?.proposed_value ?? "").trim();
    if (field && value) return { value, field };
  }
  return undefined;
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

function createMutationId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `referral-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function hashPacket(file: File) {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot verify packet duplicates.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadReferralPacket(referral: Referral, file: File, sha256: string): Promise<PacketUploadResult> {
  const fileId = `file_${createMutationId()}`;
  const reservation = await fetchPipelineJson<CreateUploadUrlResponse>("/api/uploads/create-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      referral_id: String(referral.id),
      submitting_facility: referral.community,
      source_type: "manual",
      files: [
        {
          file_id: fileId,
          filename: file.name,
          content_type: getPacketContentType(file),
          size: file.size,
          sha256,
        },
      ],
    }),
  });

  const target = reservation.uploads.find((upload) => upload.file_id === fileId);
  if (!target) throw new Error("Pipeline did not return an upload target for this packet.");
  const mock = isMockUploadUrl(target.signed_url);

  if (mock) {
    const localUpload = new FormData();
    localUpload.set("packet_id", reservation.packet_id);
    localUpload.set("file_id", fileId);
    localUpload.set("file", file, file.name);
    await fetchPipelineJson<{
      packet_id: string;
      status: "ready_for_review";
      page_count: number;
      fields_total: number;
    }>(
      "/api/uploads/local",
      { method: "POST", body: localUpload },
      { timeoutMs: 120_000, maxResponseBytes: 256 * 1024 },
    );
  } else {
    await putBlob(target.signed_url, file, getPacketContentType(file));
    await putBlob(reservation.sentinel_url, new Blob([]), "application/octet-stream");
  }

  const completed = await fetchPipelineJson<CompleteUploadResponse>("/api/uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      packet_id: reservation.packet_id,
      uploaded_file_ids: [fileId],
    }),
  });
  const status = await fetchPipelineJson<PacketStatusResponse>(`/api/packets/${reservation.packet_id}/status`, {
    cache: "no-store",
  }).catch(() => ({
    packet_id: reservation.packet_id,
    status: completed.status,
    page_count: 0,
    counts: { fields_total: 0, pending_review: 0, conflicts: 0 },
  }));

  const packetFields = ["ready_for_review", "reviewed"].includes(status.status)
    ? await fetchPipelineJson<PacketFieldsResponse>(`/api/packets/${reservation.packet_id}/fields`, { cache: "no-store" }).catch(() => undefined)
    : undefined;

  return {
    packetId: reservation.packet_id,
    status: status.status,
    pageCount: status.page_count,
    fields: packetFields,
    mock,
  };
}

async function putBlob(url: string, body: Blob, contentType: string) {
  const response = await fetch(url, {
    method: "PUT",
    credentials: "omit",
    headers: {
      "Content-Type": contentType,
      "x-ms-blob-type": "BlockBlob",
    },
    body,
  });
  if (!response.ok) throw new Error("The packet could not be written to secure storage. Retry the upload.");
}

function isMockUploadUrl(url: string) {
  try {
    return new URL(url).hostname === "mock-storage.local";
  } catch {
    return false;
  }
}

function getPacketContentType(file: Pick<File, "name" | "type">) {
  const type = file.type.trim().toLowerCase();
  if ((allowedUploadContentTypes as readonly string[]).includes(type)) return type;

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "tif" || extension === "tiff") return "image/tiff";
  if (extension === "heic") return "image/heic";
  return "application/octet-stream";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}
