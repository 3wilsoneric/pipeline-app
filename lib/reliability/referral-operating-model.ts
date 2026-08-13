export type TruthState = "verified" | "partial" | "empty" | "failed";

export type SafeRecoveryState =
  | "none"
  | "needs_human_review"
  | "retry_available"
  | "manual_entry_required"
  | "blocked_external";

export type WorkflowJourney =
  | "new_referral_intake"
  | "packet_review"
  | "assessment_completion"
  | "missing_info"
  | "duplicate_resolution"
  | "source_tracking"
  | "decision_handoff"
  | "ehr_export_queue";

export type ReferralModuleId =
  | "referral_queue"
  | "referral_profile"
  | "assessment_detail"
  | "missing_info"
  | "source_performance"
  | "conversion_funnel"
  | "ehr_export_queue";

export type ReferralWorkflowStatus =
  | "new"
  | "packet_needed"
  | "packet_review"
  | "assessment"
  | "community_review"
  | "accepted"
  | "declined"
  | "admitted";

export type ReferralPriority = "urgent" | "high" | "standard" | "low";

export type ReferralScope = {
  community?: string;
  date_from?: string;
  date_to?: string;
  source?: string;
  status?: ReferralWorkflowStatus;
  referral_id?: string;
};

export type OperationTraceStep = {
  step: string;
  status: "ok" | "warning" | "failed";
  detail?: string;
};

export type ReferralAuditAction =
  | "create"
  | "update"
  | "status_change"
  | "packet_review"
  | "retry"
  | "export"
  | "error";

export type ReferralAuditEvent = {
  event_id: string;
  referral_id: string;
  actor_id: string;
  action: ReferralAuditAction;
  field?: string;
  from?: string | null;
  to?: string | null;
  reason?: string;
  created_at: string;
};

export type EvidenceRow = {
  row_id: string;
  label: string;
  status: string;
  fields?: Record<string, string | number | boolean | null>;
};

export type ArtifactMetadata = {
  kind: "none" | "csv" | "xlsx" | "json" | "review_queue" | "chart";
  label?: string;
  row_count?: number;
  href?: string;
};

export type ReferralOperationEnvelope<TData> = {
  journey: WorkflowJourney;
  module: ReferralModuleId;
  truth_state: TruthState;
  confidence: number;
  row_count: number;
  scope: ReferralScope;
  trace: OperationTraceStep[];
  evidence_rows: EvidenceRow[];
  missing_data: string[];
  next_action: string;
  safe_recovery: SafeRecoveryState;
  artifact: ArtifactMetadata;
  visual_shape: "none" | "card" | "table" | "worklist" | "timeline" | "chart";
  data: TData;
  generated_at: string;
};

export type ReferralRecord = {
  referral_id: string;
  full_name: string;
  date_of_birth?: string;
  community?: string;
  source?: string;
  status: ReferralWorkflowStatus;
  priority: ReferralPriority;
  received_at: string;
  updated_at?: string;
  packet_id?: string;
  packet_status?: string;
  assessment_completed_at?: string;
  decision_at?: string;
  ehr_export_status?: "not_ready" | "queued" | "exported" | "failed";
  owner?: string;
  due_at?: string;
  next_step?: string;
  required_fields?: Record<string, string | boolean | null | undefined>;
};

export type ReferralWorkflowTransitionCheck = {
  allowed: boolean;
  from: ReferralWorkflowStatus;
  to: ReferralWorkflowStatus;
  blockers: string[];
  warnings: string[];
  next_action: string;
};

export const referralCoreJourneys: readonly WorkflowJourney[] = [
  "new_referral_intake",
  "packet_review",
  "assessment_completion",
  "missing_info",
  "duplicate_resolution",
  "source_tracking",
  "decision_handoff",
  "ehr_export_queue",
] as const;

export const referralModuleRegistry: ReadonlyArray<{
  id: ReferralModuleId;
  label: string;
  default_visual_shape: ReferralOperationEnvelope<unknown>["visual_shape"];
  journeys: readonly WorkflowJourney[];
}> = [
  {
    id: "referral_queue",
    label: "Referral Queue",
    default_visual_shape: "worklist",
    journeys: ["new_referral_intake", "packet_review", "decision_handoff"],
  },
  {
    id: "referral_profile",
    label: "Referral Profile",
    default_visual_shape: "card",
    journeys: ["new_referral_intake", "missing_info", "duplicate_resolution"],
  },
  {
    id: "assessment_detail",
    label: "Assessment Detail",
    default_visual_shape: "timeline",
    journeys: ["assessment_completion", "decision_handoff"],
  },
  {
    id: "missing_info",
    label: "Missing Info",
    default_visual_shape: "table",
    journeys: ["missing_info", "packet_review"],
  },
  {
    id: "source_performance",
    label: "Source Performance",
    default_visual_shape: "chart",
    journeys: ["source_tracking"],
  },
  {
    id: "conversion_funnel",
    label: "Conversion Funnel",
    default_visual_shape: "chart",
    journeys: ["source_tracking", "decision_handoff"],
  },
  {
    id: "ehr_export_queue",
    label: "EHR Export Queue",
    default_visual_shape: "table",
    journeys: ["ehr_export_queue"],
  },
] as const;

export const requiredReferralFieldKeys = [
  "full_name",
  "date_of_birth",
  "community",
  "source",
] as const;

export function createReferralOperationEnvelope<TData>(
  input: Omit<
    ReferralOperationEnvelope<TData>,
    "generated_at" | "confidence" | "row_count" | "truth_state"
  > & {
    confidence?: number;
    row_count?: number;
    truth_state?: TruthState;
  },
): ReferralOperationEnvelope<TData> {
  const rowCount = input.row_count ?? input.evidence_rows.length;
  const truthState =
    input.truth_state ??
    inferTruthState({
      row_count: rowCount,
      missing_data: input.missing_data,
      trace: input.trace,
    });

  return {
    ...input,
    confidence: input.confidence ?? confidenceForTruthState(truthState),
    row_count: rowCount,
    truth_state: truthState,
    generated_at: new Date().toISOString(),
  };
}

export function validateReferralOperationEnvelope<TData>(
  envelope: ReferralOperationEnvelope<TData>,
) {
  const errors: string[] = [];

  if (!referralCoreJourneys.includes(envelope.journey)) {
    errors.push(`Unknown journey: ${envelope.journey}`);
  }

  if (!referralModuleRegistry.some((module) => module.id === envelope.module)) {
    errors.push(`Unknown module: ${envelope.module}`);
  }

  if (envelope.confidence < 0 || envelope.confidence > 1) {
    errors.push("confidence must be between 0 and 1");
  }

  if (envelope.row_count !== envelope.evidence_rows.length) {
    errors.push("row_count must match evidence_rows.length");
  }

  if (envelope.trace.length === 0) {
    errors.push("trace must include at least one step");
  }

  if (!envelope.next_action) {
    errors.push("next_action is required");
  }

  if (envelope.truth_state !== "verified" && envelope.safe_recovery === "none") {
    errors.push("non-verified results require a safe recovery state");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function getMissingReferralFields(referral: ReferralRecord) {
  const missing = requiredReferralFieldKeys.filter((field) => {
    if (field in referral) {
      return isBlank(referral[field as keyof ReferralRecord]);
    }

    return isBlank(referral.required_fields?.[field]);
  });

  const requiredFields = referral.required_fields ?? {};
  const nestedMissing = Object.entries(requiredFields)
    .filter(([, value]) => isBlank(value))
    .map(([field]) => field);

  return Array.from(new Set([...missing, ...nestedMissing])).sort();
}

export function getNextReferralAction(referral: ReferralRecord) {
  const missing = getMissingReferralFields(referral);

  if (missing.length > 0) return `Collect missing fields: ${missing.join(", ")}`;
  if (!referral.packet_id) return "Attach referral packet";
  if (referral.packet_status !== "reviewed") return "Review extracted packet fields";
  if (referral.status === "assessment") return "Complete assessment decision";
  if (referral.status === "accepted" && referral.ehr_export_status !== "exported") {
    return "Queue accepted referral for EHR export";
  }

  return "No immediate action";
}

export function getReferralWorkflowBlockers(
  referral: ReferralRecord,
  targetStatus: ReferralWorkflowStatus = referral.status,
) {
  const blockers: string[] = [];
  if (targetStatus === "declined") return blockers;

  const targetRank = workflowRank(targetStatus);

  if (targetRank >= workflowRank("packet_review") && !referral.packet_id) {
    blockers.push("Attach a referral packet before packet review.");
  }

  if (
    targetRank >= workflowRank("assessment") &&
    referral.packet_status !== "reviewed"
  ) {
    blockers.push("Review and approve extracted packet fields before assessment.");
  }

  if (targetRank >= workflowRank("community_review") && isBlank(referral.owner)) {
    blockers.push("Assign an owner before community review.");
  }

  if (
    (targetStatus === "accepted" || targetStatus === "admitted") &&
    isBlank(referral.community)
  ) {
    blockers.push("Select a receiving community before acceptance.");
  }

  if (targetStatus === "admitted" && referral.ehr_export_status !== "exported") {
    blockers.push("Confirm EHR export before marking admitted.");
  }

  return blockers;
}

export function canTransitionReferralStatus(
  referral: ReferralRecord,
  targetStatus: ReferralWorkflowStatus,
): ReferralWorkflowTransitionCheck {
  const from = referral.status;
  const blockers = [...getReferralWorkflowBlockers(referral, targetStatus)];
  const warnings: string[] = [];

  if (from === targetStatus) {
    return {
      allowed: true,
      from,
      to: targetStatus,
      blockers: [],
      warnings: ["Referral is already in this status."],
      next_action: "No status change needed",
    };
  }

  if (isTerminalWorkflowStatus(from)) {
    blockers.push("Closed referrals cannot move without reopening through admin review.");
  }

  const forwardDelta = workflowRank(targetStatus) - workflowRank(from);
  if (
    targetStatus !== "declined" &&
    forwardDelta > 1 &&
    !(from === "packet_needed" && targetStatus === "packet_review")
  ) {
    blockers.push("Move the referral through the required intermediate stage first.");
  }

  if (targetStatus === "declined") {
    warnings.push("Declining a referral should record a reason and keep an audit event.");
  }

  return {
    allowed: blockers.length === 0,
    from,
    to: targetStatus,
    blockers,
    warnings,
    next_action:
      blockers.length === 0
        ? `Move referral to ${targetStatus}`
        : blockers[0] ?? "Resolve workflow blockers",
  };
}

export function createReferralAuditEvent(input: {
  referral_id: string;
  actor_id: string;
  action: ReferralAuditAction;
  field?: string;
  from?: string | null;
  to?: string | null;
  reason?: string;
  created_at?: string;
}): ReferralAuditEvent {
  const createdAt = input.created_at ?? new Date().toISOString();

  return {
    event_id: stableAuditEventId(input.referral_id, input.action, createdAt),
    referral_id: input.referral_id,
    actor_id: input.actor_id,
    action: input.action,
    field: input.field,
    from: input.from,
    to: input.to,
    reason: input.reason,
    created_at: createdAt,
  };
}

export function buildDuplicateResolutionEnvelope(
  referrals: ReferralRecord[],
  candidate: ReferralRecord,
) {
  const duplicateRows = referrals
    .filter((referral) => isDuplicateReferralCandidate(referral, candidate))
    .map((referral) => ({
      row_id: referral.referral_id,
      label: referral.full_name,
      status: referral.status,
      fields: {
        date_of_birth: referral.date_of_birth ?? null,
        community: referral.community ?? null,
        source: referral.source ?? null,
      },
    }));

  return createReferralOperationEnvelope({
    journey: "duplicate_resolution",
    module: "referral_profile",
    scope: { referral_id: candidate.referral_id },
    trace: [
      { step: "normalize_identity", status: "ok" },
      {
        step: "compare_name_and_dob",
        status: duplicateRows.length > 0 ? "warning" : "ok",
        detail: `${duplicateRows.length} possible duplicate(s)`,
      },
    ],
    evidence_rows: duplicateRows,
    missing_data: duplicateRows.length > 0 ? ["duplicate_resolution"] : [],
    next_action:
      duplicateRows.length > 0
        ? "Review possible duplicate before creating a new referral"
        : "No duplicate candidates found",
    safe_recovery: duplicateRows.length > 0 ? "needs_human_review" : "none",
    artifact: {
      kind: duplicateRows.length > 0 ? "review_queue" : "none",
      label: "Duplicate referral candidates",
      row_count: duplicateRows.length,
    },
    visual_shape: duplicateRows.length > 0 ? "table" : "none",
    data: duplicateRows,
  });
}

export function buildEhrExportReadinessEnvelope(
  referrals: ReferralRecord[],
  scope: ReferralScope = {},
) {
  const rows = referrals
    .filter((referral) => referral.status === "accepted" || referral.status === "admitted")
    .map((referral) => {
      const blockers = getReferralWorkflowBlockers(referral, "accepted");
      const missing = getMissingReferralFields(referral);
      const allBlockers = [...blockers, ...missing.map((field) => `Missing ${field}`)];

      return {
        referral,
        blockers: allBlockers,
      };
    });

  const evidenceRows = rows.map(({ referral, blockers }) => ({
    row_id: referral.referral_id,
    label: referral.full_name,
    status: blockers.length === 0 ? "ready" : "blocked",
    fields: {
      community: referral.community ?? null,
      ehr_export_status: referral.ehr_export_status ?? "not_ready",
      blockers: blockers.join(", "),
    },
  }));
  const blockerCount = rows.filter((row) => row.blockers.length > 0).length;

  return createReferralOperationEnvelope({
    journey: "ehr_export_queue",
    module: "ehr_export_queue",
    scope,
    trace: [
      { step: "filter_accepted_referrals", status: "ok", detail: `${rows.length} checked` },
      {
        step: "compute_ehr_blockers",
        status: blockerCount > 0 ? "warning" : "ok",
        detail: `${blockerCount} blocked`,
      },
    ],
    evidence_rows: evidenceRows,
    missing_data: blockerCount > 0 ? ["ehr_export_blockers"] : [],
    next_action:
      rows.length === 0
        ? "No accepted referrals are ready for EHR export"
        : blockerCount > 0
          ? "Resolve EHR export blockers before writeback"
          : "Queue accepted referrals for EHR export",
    safe_recovery: blockerCount > 0 ? "needs_human_review" : "none",
    artifact: { kind: "review_queue", label: "EHR export readiness", row_count: rows.length },
    visual_shape: "table",
    data: evidenceRows,
  });
}

export function getReferralFreshness(
  referral: ReferralRecord,
  now = new Date(),
) {
  const referenceDate = new Date(referral.updated_at ?? referral.received_at);
  const ageHours = Math.max(0, (now.getTime() - referenceDate.getTime()) / 36e5);
  const urgentLimit = referral.priority === "urgent" ? 12 : 48;
  const highLimit = referral.priority === "high" ? 24 : urgentLimit;
  const limitHours = referral.priority === "low" ? 96 : highLimit;

  return {
    age_hours: Math.round(ageHours * 10) / 10,
    is_stale: ageHours > limitHours,
    limit_hours: limitHours,
  };
}

export function isDuplicateReferralCandidate(
  first: ReferralRecord,
  second: ReferralRecord,
) {
  if (first.referral_id === second.referral_id) return false;

  const sameDob =
    Boolean(first.date_of_birth) &&
    Boolean(second.date_of_birth) &&
    first.date_of_birth === second.date_of_birth;
  const sameName =
    normalizePersonName(first.full_name) === normalizePersonName(second.full_name);

  return sameName && sameDob;
}

export function buildMissingInfoEnvelope(
  referrals: ReferralRecord[],
  scope: ReferralScope = {},
) {
  const rows = referrals
    .map((referral) => ({
      referral,
      missing: getMissingReferralFields(referral),
    }))
    .filter((item) => item.missing.length > 0)
    .map(({ referral, missing }) => ({
      row_id: referral.referral_id,
      label: referral.full_name,
      status: referral.status,
      fields: {
        community: referral.community ?? null,
        missing_count: missing.length,
        missing_fields: missing.join(", "),
        next_action: getNextReferralAction(referral),
      },
    }));

  return createReferralOperationEnvelope({
    journey: "missing_info",
    module: "missing_info",
    scope,
    trace: [
      { step: "filter_referrals", status: "ok", detail: `${referrals.length} checked` },
      { step: "compute_missing_fields", status: "ok", detail: `${rows.length} incomplete` },
    ],
    evidence_rows: rows,
    missing_data: rows.length === 0 ? [] : ["required_fields"],
    next_action:
      rows.length === 0
        ? "No missing required referral fields in scope"
        : "Contact source or complete manual entry for missing fields",
    safe_recovery: rows.length === 0 ? "none" : "needs_human_review",
    artifact: { kind: "review_queue", label: "Missing referral info", row_count: rows.length },
    visual_shape: "table",
    data: rows,
  });
}

function inferTruthState(input: {
  row_count: number;
  missing_data: string[];
  trace: OperationTraceStep[];
}): TruthState {
  if (input.trace.some((step) => step.status === "failed")) return "failed";
  if (input.row_count === 0) return "empty";
  if (input.missing_data.length > 0) return "partial";
  return "verified";
}

function confidenceForTruthState(truthState: TruthState) {
  if (truthState === "verified") return 0.98;
  if (truthState === "partial") return 0.72;
  if (truthState === "empty") return 1;
  return 0;
}

function isBlank(value: unknown) {
  return value === undefined || value === null || value === "" || value === "Unassigned";
}

function normalizePersonName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function workflowRank(status: ReferralWorkflowStatus) {
  const order: ReferralWorkflowStatus[] = [
    "new",
    "packet_needed",
    "packet_review",
    "assessment",
    "community_review",
    "accepted",
    "admitted",
    "declined",
  ];

  return order.indexOf(status);
}

function isTerminalWorkflowStatus(status: ReferralWorkflowStatus) {
  return status === "declined" || status === "admitted";
}

function stableAuditEventId(
  referralId: string,
  action: ReferralAuditAction,
  createdAt: string,
) {
  return `aud_${normalizeForId(referralId)}_${action}_${normalizeForId(createdAt)}`;
}

function normalizeForId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
}
