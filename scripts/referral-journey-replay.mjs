#!/usr/bin/env node

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const operatingModel = loadTypeScriptModule(root, "lib/reliability/referral-operating-model.ts");

const referrals = [
  {
    referral_id: "ref_urgent_packet",
    full_name: "Robert Thompson",
    date_of_birth: "1951-08-14",
    community: "San Pablo",
    source: "County General ED",
    status: "packet_review",
    priority: "urgent",
    received_at: "2026-06-20T08:00:00.000Z",
    updated_at: "2026-06-20T10:00:00.000Z",
    packet_id: "pkt_urgent_packet",
    packet_status: "ready_for_review",
    required_fields: {
      med_list_received: null,
      release_on_file: true,
    },
  },
  {
    referral_id: "ref_duplicate",
    full_name: "Robert   Thompson",
    date_of_birth: "1951-08-14",
    community: "Turlock",
    source: "Manual",
    status: "new",
    priority: "standard",
    received_at: "2026-06-22T08:00:00.000Z",
    packet_status: "received",
  },
  {
    referral_id: "ref_assessment",
    full_name: "Patricia Martinez",
    date_of_birth: "1948-02-03",
    community: "Santa Clarita",
    source: "Family Direct",
    status: "assessment",
    priority: "high",
    received_at: "2026-06-21T09:00:00.000Z",
    updated_at: "2026-06-22T09:00:00.000Z",
    packet_id: "pkt_assessment",
    packet_status: "reviewed",
    assessment_completed_at: null,
  },
  {
    referral_id: "ref_accepted",
    full_name: "Maria Lee",
    date_of_birth: "1942-11-30",
    community: "Victoria's House",
    source: "Hospitalist",
    status: "accepted",
    priority: "standard",
    received_at: "2026-06-19T09:00:00.000Z",
    updated_at: "2026-06-22T09:00:00.000Z",
    packet_id: "pkt_accepted",
    packet_status: "reviewed",
    decision_at: "2026-06-22T09:00:00.000Z",
    ehr_export_status: "queued",
    owner: "Sarah Johnson",
  },
];

const journeys = [
  runJourney("new referral intake", "new_referral_intake", () => {
    const referral = {
      referral_id: "ref_new",
      full_name: "James Ortega",
      date_of_birth: "1955-05-05",
      community: "JC Wallace",
      source: "Portal",
      status: "new",
      priority: "standard",
      received_at: "2026-06-24T08:00:00.000Z",
    };

    assert(
      operatingModel.getNextReferralAction(referral) === "Attach referral packet",
      "New complete referral should ask for packet attachment",
    );

    return envelope({
      journey: "new_referral_intake",
      module: "referral_queue",
      referral,
      next_action: "Attach referral packet",
      visual_shape: "worklist",
    });
  }),
  runJourney("packet review with missing info", "packet_review", () => {
    assert(
      operatingModel.getNextReferralAction(referrals[0]).includes("med_list_received"),
      "Packet review should expose missing med list",
    );

    return envelope({
      journey: "packet_review",
      module: "missing_info",
      referral: referrals[0],
      next_action: "Collect missing med_list_received before packet can be finalized",
      visual_shape: "table",
      truth_state: "partial",
      safe_recovery: "needs_human_review",
      missing_data: ["med_list_received"],
      evidence_rows: [
        evidence(referrals[0], {
          missing_count: 1,
          missing_fields: "med_list_received",
        }),
      ],
    });
  }),
  runJourney("duplicate resolution", "duplicate_resolution", () => {
    assert(
      operatingModel.isDuplicateReferralCandidate(referrals[0], referrals[1]),
      "Expected same name/DOB duplicate",
    );
    assert(
      !operatingModel.isDuplicateReferralCandidate(referrals[0], referrals[2]),
      "Different name/DOB should not be duplicate",
    );

    return envelope({
      journey: "duplicate_resolution",
      module: "referral_profile",
      referral: referrals[1],
      next_action: "Review possible duplicate before creating a new referral",
      visual_shape: "card",
      evidence_rows: [
        evidence(referrals[0], { duplicate_score: 1, matching_referral_id: referrals[1].referral_id }),
      ],
    });
  }),
  runJourney("assessment completion", "assessment_completion", () => {
    assert(
      operatingModel.getNextReferralAction(referrals[2]) === "Complete assessment decision",
      "Assessment referral should request decision completion",
    );

    return envelope({
      journey: "assessment_completion",
      module: "assessment_detail",
      referral: referrals[2],
      next_action: "Complete assessment decision",
      visual_shape: "timeline",
    });
  }),
  runJourney("source tracking", "source_tracking", () => {
    const bySource = countBy(referrals, "source");

    assert(bySource["County General ED"] === 1, "Expected County General ED source count");
    assert(Object.keys(bySource).length >= 3, "Expected multiple sources");

    return envelope({
      journey: "source_tracking",
      module: "source_performance",
      referral: referrals[0],
      next_action: "Compare source conversion once more accepted/admitted outcomes exist",
      visual_shape: "chart",
      evidence_rows: Object.entries(bySource).map(([source, count]) => ({
        row_id: source,
        label: source,
        status: "source",
        fields: { referral_count: count },
      })),
    });
  }),
  runJourney("decision handoff", "decision_handoff", () => {
    assert(
      operatingModel.getNextReferralAction(referrals[3]) === "Queue accepted referral for EHR export",
      "Accepted referral should remain in handoff until exported",
    );

    return envelope({
      journey: "decision_handoff",
      module: "ehr_export_queue",
      referral: referrals[3],
      next_action: "Queue accepted referral for EHR export",
      visual_shape: "table",
    });
  }),
  runJourney("stale urgent referral recovery", "missing_info", () => {
    const stale = operatingModel.getReferralFreshness(
      referrals[0],
      new Date("2026-06-22T12:30:00.000Z"),
    );

    assert(stale.is_stale, "Urgent packet should be stale after the configured threshold");
    assert(stale.limit_hours === 12, "Urgent stale limit should be 12 hours");

    return envelope({
      journey: "missing_info",
      module: "missing_info",
      referral: referrals[0],
      next_action: "Escalate stale urgent referral and collect missing med list",
      visual_shape: "table",
      truth_state: "partial",
      safe_recovery: "needs_human_review",
      missing_data: ["med_list_received"],
      evidence_rows: [evidence(referrals[0], stale)],
    });
  }),
  runJourney("EHR export queue", "ehr_export_queue", () => {
    assert(referrals[3].ehr_export_status === "queued", "Accepted referral should be export queued");

    const exportEnvelope = operatingModel.buildEhrExportReadinessEnvelope([referrals[3]]);
    const exportValidation = operatingModel.validateReferralOperationEnvelope(exportEnvelope);
    assert(exportValidation.ok, exportValidation.errors.join("; "));
    assert(exportEnvelope.truth_state === "verified", "Export readiness should be verified");

    return envelope({
      journey: "ehr_export_queue",
      module: "ehr_export_queue",
      referral: referrals[3],
      next_action: "Monitor export queue until EHR writeback confirms success",
      visual_shape: "table",
      evidence_rows: [evidence(referrals[3], { ehr_export_status: "queued" })],
    });
  }),
  runJourney("workflow transition guardrails", "decision_handoff", () => {
    const blockedAssessment = operatingModel.canTransitionReferralStatus(
      referrals[0],
      "assessment",
    );
    assert(!blockedAssessment.allowed, "Unreviewed packet should not move to assessment");
    assert(
      blockedAssessment.blockers.some((blocker) => blocker.includes("Review and approve")),
      "Assessment blocker should explain packet review requirement",
    );

    const declinedWithoutPacket = operatingModel.canTransitionReferralStatus(
      {
        referral_id: "ref_decline",
        full_name: "Decline Candidate",
        date_of_birth: "1950-01-01",
        community: "San Pablo",
        source: "Manual",
        status: "new",
        priority: "standard",
        received_at: "2026-06-22T08:00:00.000Z",
      },
      "declined",
    );
    assert(declinedWithoutPacket.allowed, "Decline should not require packet prerequisites");
    assert(
      declinedWithoutPacket.warnings.length > 0,
      "Decline should warn that a reason/audit event is needed",
    );

    const audit = operatingModel.createReferralAuditEvent({
      referral_id: referrals[0].referral_id,
      actor_id: "replay",
      action: "status_change",
      field: "status",
      from: referrals[0].status,
      to: "assessment",
      created_at: "2026-06-30T00:00:00.000Z",
    });
    assert(audit.event_id.startsWith("aud_"), "Audit event should have stable id");

    return envelope({
      journey: "decision_handoff",
      module: "referral_queue",
      referral: referrals[0],
      next_action: blockedAssessment.next_action,
      visual_shape: "worklist",
      truth_state: "partial",
      safe_recovery: "needs_human_review",
      missing_data: blockedAssessment.blockers,
      evidence_rows: [
        evidence(referrals[0], {
          blockers: blockedAssessment.blockers.join(", "),
          warning_count: declinedWithoutPacket.warnings.length,
          audit_event_id: audit.event_id,
        }),
      ],
    });
  }),
];

const failed = journeys.filter((journey) => !journey.ok);

console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      checked_at: new Date().toISOString(),
      journeys,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exit(1);
}

function runJourney(name, expectedJourney, fn) {
  try {
    const result = fn();
    const validation = operatingModel.validateReferralOperationEnvelope(result);

    assert(result.journey === expectedJourney, `Expected ${expectedJourney}, got ${result.journey}`);
    assert(validation.ok, validation.errors.join("; "));

    return {
      name,
      journey: result.journey,
      module: result.module,
      visual_shape: result.visual_shape,
      truth_state: result.truth_state,
      safe_recovery: result.safe_recovery,
      next_action: result.next_action,
      ok: true,
    };
  } catch (error) {
    return {
      name,
      journey: expectedJourney,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function envelope({
  journey,
  module,
  referral,
  next_action,
  visual_shape,
  evidence_rows = [evidence(referral)],
  missing_data = [],
  safe_recovery = "none",
  truth_state,
}) {
  return operatingModel.createReferralOperationEnvelope({
    journey,
    module,
    scope: { community: referral.community, referral_id: referral.referral_id },
    trace: [
      { step: "load_referral", status: "ok", detail: referral.referral_id },
      { step: "select_module", status: "ok", detail: module },
      { step: "compute_next_action", status: "ok", detail: next_action },
    ],
    evidence_rows,
    missing_data,
    next_action,
    safe_recovery,
    artifact: {
      kind: visual_shape === "chart"
        ? "chart"
        : ["table", "worklist"].includes(visual_shape)
          ? "review_queue"
          : "none",
      row_count: evidence_rows.length,
    },
    visual_shape,
    data: evidence_rows,
    truth_state,
  });
}

function evidence(referral, extraFields = {}) {
  return {
    row_id: referral.referral_id,
    label: referral.full_name,
    status: referral.status,
    fields: {
      community: referral.community ?? null,
      priority: referral.priority,
      packet_status: referral.packet_status ?? null,
      ...extraFields,
    },
  };
}

function countBy(rows, key) {
  return rows.reduce((counts, row) => {
    const value = row[key] ?? "Unknown";
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
