import type {
  ExtractedField,
  PacketFieldsResponse,
  PacketStatusResponse,
} from "@/lib/extraction/contracts";
import type { PipelineCommunity } from "@/lib/pipeline/community-config";
import type { ReferralStage as Stage } from "@/lib/pipeline/referral-workflow";

export type Priority = "urgent" | "high" | "standard";
export type WorkspaceOrigin = "pipeline" | "allo" | "import";
export type WorkspaceStatus = "active" | "historical" | "archived";

export const referralSectionNames = [
  "identity",
  "intake",
  "documents",
  "assessment",
  "workflow",
  "decision",
] as const;

export type ReferralSection = (typeof referralSectionNames)[number];
export type ReferralSectionVersions = Record<ReferralSection, number>;

export const referralCanvasFieldKeys = [
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

export type ReferralCanvasFieldKey = (typeof referralCanvasFieldKeys)[number];

export type CanvasWorkflowStage = "pre" | "assessment" | "post";
export type PostAssessmentDecision = "accepted" | "not-accepted" | "pending";

export type RequirementType =
  | "medication_list"
  | "tb_test"
  | "signed_admission_agreement"
  | "conservatorship_document"
  | "lic_602"
  | "lic_601_603"
  | "provider_form"
  | "face_sheet"
  | "payer_verification"
  | "responsible_party"
  | "no_admission_reason";

export type RequirementStatus =
  | "needed"
  | "requested"
  | "received"
  | "reviewed"
  | "waived"
  | "expired";

export type RequirementGate =
  | "pre_assessment"
  | "admission_decision"
  | "move_in"
  | "ehr_export";

export type AdmissionRequirement = {
  id: string;
  version?: number;
  type: RequirementType;
  label: string;
  status: RequirementStatus;
  requiredFor: RequirementGate;
  ownerId?: string;
  owner: string;
  dueAt: string;
  nextStep: string;
  blocker: boolean;
  evidenceDocumentId?: string;
  evidenceDocumentName?: string;
  waiverReason?: string;
  updatedAt: string;
};

export type AdmissionDecision = {
  decisionId: string;
  outcome: "accepted" | "declined";
  reasonCode: string;
  reasonNote: string;
  decidedBy: string;
  decidedByName: string;
  decidedAt: string;
  version: number;
};

export type EhrHandoffStatus = "not_ready" | "ready" | "queued" | "sent" | "failed";

export type EhrHandoffRecord = {
  status: EhrHandoffStatus;
  version: number;
  updatedAt: string;
  queuedAt?: string;
  queuedBy?: string;
  queuedByName?: string;
  sentAt?: string;
  failureReason?: string;
};

export type ManualIntakeAuthorization = {
  mode: "manual_chart";
  reason: string;
  authorizedBy: string;
  authorizedByName: string;
  authorizedAt: string;
};

export type AssessmentProfile = {
  requestedAt: string;
  scheduledDate: string;
  startedAt?: string;
  completedAt?: string;
  preAssessment: {
    demographics: string;
    referralSource: string;
    estimatedLosDays: number;
  };
  assessment: {
    carry: string;
    careNeeds: string;
    riskLevel: string;
  };
  postAssessment: {
    decision: PostAssessmentDecision;
    reason: string;
  };
};

export type AssessmentMetrics = {
  averageDurationMinutes: number;
  averageDurationLabel: string;
  completedCount: number;
  scheduledCount: number;
  preAssessmentOpen: number;
  acceptedCount: number;
  notAcceptedCount: number;
  pendingDecisionCount: number;
};

export type Referral = {
  id: number;
  version?: number;
  sectionVersions?: ReferralSectionVersions;
  updatedBy?: { id: string; name: string };
  /** Stable client identity. A client may have more than one referral episode. */
  clientId?: string;
  workspaceOrigin?: WorkspaceOrigin;
  workspaceStatus?: WorkspaceStatus;
  sourceWorkspaceId?: string;
  sourceWorkspaceName?: string;
  sourceProjectId?: string;
  sourceProjectName?: string;
  sourceMaterialCount?: number;
  name: string;
  date: string;
  stage: Stage;
  community: PipelineCommunity;
  source: string;
  priority: Priority;
  tags?: string[];
  documentName: string;
  documentSizeBytes?: number;
  /** SHA-256 of the original packet bytes. Used to stop exact duplicate intake. */
  documentHash?: string;
  documentStatus: "Missing" | "Uploaded" | "Reviewed";
  /** Stable Entra object id for assignment enforcement. */
  ownerId?: string;
  owner: string;
  note: string;
  createdAt: string;
  updatedAt?: string;
  dob: string;
  gender?: string;
  /** Age as written in the source packet. DOB remains the canonical calculated-age source. */
  reportedAge?: string;
  ssn?: string;
  admissionDate?: string;
  responsiblePerson?: string;
  interview?: string;
  conserved?: "yes" | "no" | "";
  fieldSources?: Partial<Record<ReferralCanvasFieldKey, string>>;
  phone: string;
  email: string;
  payer: string;
  packetId?: string;
  packetStatus?: PacketStatusResponse["status"];
  packetFields?: ExtractedField[];
  packetReadiness?: PacketFieldsResponse["ehr_readiness"];
  packetCompleteness?: PacketFieldsResponse["packet_completeness"];
  packetMessage?: string;
  /** Explicit, audited authorization to complete intake from the chart while source files remain outstanding. */
  manualIntakeAuthorization?: ManualIntakeAuthorization;
  assessment?: AssessmentProfile;
  assessmentDocumentName?: string;
  assessmentDocumentSizeBytes?: number;
  assessmentMessage?: string;
  requirements?: AdmissionRequirement[];
  /** Synchronized decision projection. PostgreSQL stores the authoritative row separately. */
  admissionDecision?: AdmissionDecision;
  /** Pipeline-owned handoff state. This never represents an EHR write unless status is sent. */
  ehrHandoff?: EhrHandoffRecord;
};

export type ReferralFile = {
  id: string;
  name: string;
  category: "Referral packet" | "Face sheet" | "Assessment" | "Medication list" | "TB test" | "Admission agreement" | "Conservatorship" | "LIC 602" | "LIC 601/603" | "Provider form" | "Payer verification" | "Responsible party" | "Other";
  referralId: number | null;
  clientId?: string;
  canonicalClientId?: string;
  referralName: string;
  community: PipelineCommunity | "";
  uploadedAt: string;
  sizeBytes?: number;
  status: "Uploaded" | "Reviewed";
  contentType?: string;
  previewStatus: "pending" | "processing" | "ready" | "failed" | "unavailable";
  pageCount?: number;
  previewUrl?: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
  sourceSystem?: "pipeline" | "alamo_platform" | "allo" | "import";
  identityStatus?: "linked" | "candidate" | "unmatched";
};
