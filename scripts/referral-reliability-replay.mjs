#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredModules = [
  "referral_queue",
  "referral_profile",
  "assessment_detail",
  "missing_info",
  "source_performance",
  "conversion_funnel",
  "ehr_export_queue",
];

const requiredJourneys = [
  "new_referral_intake",
  "packet_review",
  "assessment_completion",
  "missing_info",
  "duplicate_resolution",
  "source_tracking",
  "decision_handoff",
  "ehr_export_queue",
];

const referrals = [
  {
    referral_id: "ref_001",
    full_name: "Robert Thompson",
    date_of_birth: "1951-08-14",
    community: "San Pablo",
    source: "County General ED",
    status: "packet_review",
    priority: "urgent",
    received_at: "2026-06-20T08:00:00.000Z",
    updated_at: "2026-06-20T10:00:00.000Z",
    packet_id: "pkt_001",
    packet_status: "ready_for_review",
    required_fields: {
      med_list_received: null,
      release_on_file: true,
    },
  },
  {
    referral_id: "ref_002",
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
    referral_id: "ref_003",
    full_name: "Patricia Martinez",
    date_of_birth: "1948-02-03",
    community: "Santa Clarita",
    source: "Family Direct",
    status: "accepted",
    priority: "high",
    received_at: "2026-06-21T09:00:00.000Z",
    updated_at: "2026-06-22T09:00:00.000Z",
    packet_id: "pkt_003",
    packet_status: "reviewed",
    ehr_export_status: "queued",
  },
];

const checks = [
  checkOperatingModelRegistry,
  checkApiContracts,
  checkRequestValidationRails,
  checkApiObservabilityGuardrails,
  checkAuthGuardrails,
  checkCommunityLabels,
  checkWorkflowGuardrails,
  checkMissingInfoEnvelope,
  checkDuplicateDetection,
  checkStaleUrgentReferral,
  checkFollowUpContextPatch,
  checkDocsAndRunbooks,
];

const results = checks.map((check) => {
  try {
    check();
    return { name: check.name, ok: true };
  } catch (error) {
    return {
      name: check.name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

const failed = results.filter((result) => !result.ok);

console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      checked_at: new Date().toISOString(),
      checks: results,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exit(1);
}

function checkOperatingModelRegistry() {
  const source = readText("lib/reliability/referral-operating-model.ts");

  for (const moduleId of requiredModules) {
    assert(source.includes(`"${moduleId}"`), `Missing module registry id: ${moduleId}`);
  }

  for (const journey of requiredJourneys) {
    assert(source.includes(`"${journey}"`), `Missing core journey: ${journey}`);
  }
}

function checkApiContracts() {
  const source = readText("lib/extraction/contracts.ts");

  for (const shape of [
    "CreateUploadUrlRequest",
    "CreateUploadUrlResponse",
    "PacketStatusResponse",
    "PacketFieldsResponse",
    "ReviewFieldRequest",
    "RetryFieldRequest",
    "FieldAuditEvent",
  ]) {
    assert(source.includes(shape), `Missing API contract shape: ${shape}`);
  }

  assert(
    source.includes('reviewer_id?: string'),
    "reviewer_id must be optional because the server derives reviewer identity",
  );
  assert(
    source.includes("audit_events?: FieldAuditEvent[]") &&
      source.includes("audit_event?: FieldAuditEvent"),
    "Packet field responses should expose audit events",
  );
}

function checkRequestValidationRails() {
  const contracts = readText("lib/extraction/contracts.ts");

  for (const validator of [
    "validateCreateUploadUrlRequest",
    "validateCompleteUploadRequest",
    "validateReviewFieldRequest",
    "validateRetryFieldRequest",
    "decodeRouteParam",
  ]) {
    assert(contracts.includes(`function ${validator}`), `Missing request validator: ${validator}`);
  }

  const routes = [
    ["app/api/uploads/create-url/route.ts", "validateCreateUploadUrlRequest"],
    ["app/api/uploads/complete/route.ts", "validateCompleteUploadRequest"],
    [
      "app/api/packets/[packetId]/fields/[fieldKey]/review/route.ts",
      "validateReviewFieldRequest",
    ],
    [
      "app/api/packets/[packetId]/fields/[fieldKey]/retry/route.ts",
      "validateRetryFieldRequest",
    ],
  ];

  for (const [route, validator] of routes) {
    const source = readText(route);
    assert(source.includes(validator), `${route} must use ${validator}`);
  }

  assert(
    contracts.includes("maxUploadFileBytes"),
    "Upload validation must keep an explicit max file size guardrail",
  );
  for (const expected of [
    "maxJsonBodyBytes",
    "maxUploadFilesPerRequest",
    "maxUploadRequestBytes",
    "allowedUploadContentTypes",
    "readJsonBody",
  ]) {
    assert(contracts.includes(expected), `Missing large-request guardrail: ${expected}`);
  }

  const store = readText("lib/extraction/mock-store.ts");
  const retryRoute = readText("app/api/packets/[packetId]/fields/[fieldKey]/retry/route.ts");
  assert(
    store.includes("addAuditEvent") &&
      store.includes("auditEvents") &&
      store.includes('action: "retry"'),
    "Mock extraction store should preserve review/retry audit events",
  );
  assert(
    retryRoute.includes("retryPacketField") && retryRoute.includes("auth.user"),
    "Retry route should pass the authenticated reviewer identity to the extraction service",
  );
  assert(
    store.includes("input.packet_id ? packets.get") &&
      store.includes("if (!existingPacket) return null") &&
      store.includes("pruneMockState"),
    "Mock extraction store should be idempotent, bounded, and fail missing packets safely",
  );
}

function checkApiObservabilityGuardrails() {
  const logging = readText("lib/observability/api-logging.ts");
  const backend = readText("lib/extraction/backend-config.ts");

  for (const expected of [
    "withApiLogging",
    "x-request-id",
    "console.error(JSON.stringify",
    "Internal server error",
  ]) {
    assert(logging.includes(expected), `Missing API observability guardrail: ${expected}`);
  }

  for (const expected of [
    'type ExtractionBackendMode = "mock" | "manual" | "azure_databricks"',
    "PIPELINE_EXTRACTION_BACKEND",
    "PIPELINE_ALLOW_PRODUCTION_MOCK_EXTRACTION",
    "production_mock_blocked",
    "AZURE_STORAGE_ACCOUNT",
    "DATABRICKS_HOST",
    "DATABRICKS_JOB_ID",
    "DATABRICKS_CLIENT_SECRET",
  ]) {
    assert(backend.includes(expected), `Missing backend readiness guardrail: ${expected}`);
  }

  const routeFiles = [
    "app/api/auth/me/route.ts",
    "app/api/health/route.ts",
    "app/api/uploads/create-url/route.ts",
    "app/api/uploads/complete/route.ts",
    "app/api/packets/[packetId]/fields/route.ts",
    "app/api/packets/[packetId]/status/route.ts",
    "app/api/packets/[packetId]/fields/[fieldKey]/review/route.ts",
    "app/api/packets/[packetId]/fields/[fieldKey]/retry/route.ts",
  ];
  const clinicalRouteFiles = [
    "app/api/clinical/health/route.ts",
    "app/api/clinical/census/route.ts",
    "app/api/clinical/roster/route.ts",
    "app/api/clinical/residents/[residentId]/route.ts",
    "app/api/clinical/medications/summary/route.ts",
  ];

  for (const route of routeFiles) {
    const source = readText(route);
    assert(source.includes("withApiLogging"), `${route} should emit structured request logs`);
  }

  for (const route of routeFiles.filter((route) => !route.includes("/auth/") && !route.includes("/health/"))) {
    const source = readText(route);
    assert(
      source.includes("requireExtractionBackend"),
      `${route} should fail closed unless its configured extraction backend is ready`,
    );
  }

  for (const route of clinicalRouteFiles) {
    const source = readText(route);
    assert(source.includes("withApiLogging"), `${route} should emit structured request logs`);
    assert(source.includes("requirePipelineUser"), `${route} should require Pipeline identity`);
  }
}

function checkAuthGuardrails() {
  const auth = readText("lib/auth/pipeline-auth.ts");
  const proxy = readText("proxy.ts");
  const signInPage = readText("app/sign-in/page.tsx");
  const authMeRoute = readText("app/api/auth/me/route.ts");
  const header = readText("components/pipeline/PipelineHeader.tsx");

  for (const expected of [
    'type AuthMode = "mock" | "headers" | "entra_jwt" | "disabled"',
    'if (configured === "disabled" && isProductionRuntime()) return "entra_jwt"',
    'return process.env.NODE_ENV === "production" ? "entra_jwt" : "mock"',
    'authFailure(401, "Unauthorized")',
    'authFailure(403, "Forbidden")',
    'authFailure(403, "Insufficient role")',
    "jwtVerify",
    "PIPELINE_ENTRA_API_AUDIENCE",
    "PIPELINE_ALLOWED_EMAILS",
    "PIPELINE_ADMIN_EMAILS",
    "PIPELINE_COORDINATOR_EMAILS",
    "PIPELINE_REVIEWER_EMAILS",
  ]) {
    assert(auth.includes(expected), `Missing auth guardrail: ${expected}`);
  }

  assert(
    proxy.includes("isProtectedPath") &&
      auth.includes('const publicPrefixes = ["/sign-in", "/auth", "/api/health", "/api/auth/session"]'),
    "Proxy must preserve protected-path routing and public sign-in/health escape hatches",
  );
  assert(
    proxy.includes('signInUrl.pathname = "/sign-in"') &&
      proxy.includes('pathname.startsWith("/api/")'),
    "Browser auth failures should redirect to sign-in while API auth failures stay JSON 401s",
  );
  assert(
    signInPage.includes("PipelineSignIn") &&
      signInPage.includes("normalizePostLoginPath"),
    "Sign-in page should use the Entra sign-in surface and safe return path",
  );
  assert(
    authMeRoute.includes("requirePipelineUser") && authMeRoute.includes("roles: auth.user.roles"),
    "Auth identity endpoint should return the authenticated platform user and roles",
  );
  assert(
    header.includes("fetchCurrentPipelineUser") && !header.includes(">EW<"),
    "Pipeline header should read authenticated identity instead of displaying fixed initials",
  );
}

function checkCommunityLabels() {
  const files = ["lib/pipeline/community-config.ts", "components/pipeline/ReferralHome.tsx", "components/pipeline/PipelineSidebar.tsx"];

  for (const file of files) {
    const source = readText(file);
    assert(!source.includes("Victoria's Place"), `${file} still says Victoria's Place`);
  }

  const config = readText("lib/pipeline/community-config.ts");
  const overview = readText("components/pipeline/ReferralHome.tsx");
  const sidebar = readText("components/pipeline/PipelineSidebar.tsx");

  assert(config.includes("Victoria's House"), "Shared community registry should expose Victoria's House");
  assert(
    overview.includes("pipelineCommunities"),
    "ReferralHome should read community labels from the shared registry",
  );
  assert(
    sidebar.includes("pipelineSidebarCommunities"),
    "PipelineSidebar should read community labels from the shared registry",
  );
}

function checkWorkflowGuardrails() {
  const operatingModel = readText("lib/reliability/referral-operating-model.ts");
  const workflow = readText("lib/pipeline/referral-workflow.ts");
  const referralHome = readText("components/pipeline/ReferralHome.tsx");

  for (const expected of [
    "getReferralWorkflowBlockers",
    "canTransitionReferralStatus",
    "createReferralAuditEvent",
    "buildDuplicateResolutionEnvelope",
    "buildEhrExportReadinessEnvelope",
  ]) {
    assert(operatingModel.includes(`function ${expected}`), `Missing operating guardrail: ${expected}`);
  }

  for (const expected of [
    "referralStageDefinitions",
    "stageToWorkflowStatus",
    "matchesSearchText",
    "getStageProgressPercent",
  ]) {
    assert(workflow.includes(expected), `Missing workflow policy export: ${expected}`);
  }

  assert(
    referralHome.includes("buildReferralParams") &&
      referralHome.includes("boardStages") &&
      referralHome.includes("getStageLabel"),
    "ReferralHome should use server-side filtering and shared workflow display guardrails",
  );
  assert(
    workflow.includes("matchesSearchText"),
    "Referral workflow should expose forgiving search guardrails",
  );
}

function checkMissingInfoEnvelope() {
  const rows = referrals
    .map((referral) => ({
      referral,
      missing: missingFields(referral),
    }))
    .filter((item) => item.missing.length > 0)
    .map(({ referral, missing }) => ({
      row_id: referral.referral_id,
      label: referral.full_name,
      status: referral.status,
      fields: {
        missing_count: missing.length,
        missing_fields: missing.join(", "),
      },
    }));

  const envelope = {
    journey: "missing_info",
    module: "missing_info",
    truth_state: "partial",
    confidence: 0.72,
    row_count: rows.length,
    scope: { community: "all" },
    trace: [
      { step: "filter_referrals", status: "ok" },
      { step: "compute_missing_fields", status: "ok" },
    ],
    evidence_rows: rows,
    missing_data: ["required_fields"],
    next_action: "Contact source or complete manual entry for missing fields",
    safe_recovery: "needs_human_review",
    artifact: { kind: "review_queue", row_count: rows.length },
    visual_shape: "table",
    data: rows,
    generated_at: new Date().toISOString(),
  };

  validateEnvelope(envelope);
  assert(rows.length === 2, `Expected 2 incomplete referrals, got ${rows.length}`);
  assert(
    rows.some((row) => String(row.fields.missing_fields).includes("med_list_received")),
    "Expected med list missing replay case",
  );
}

function checkDuplicateDetection() {
  assert(
    isDuplicateCandidate(referrals[0], referrals[1]),
    "Expected normalized same-name/DOB duplicate candidate",
  );
  assert(
    !isDuplicateCandidate(referrals[0], referrals[2]),
    "Different person should not be duplicate candidate",
  );
}

function checkStaleUrgentReferral() {
  const stale = freshness(referrals[0], new Date("2026-06-22T12:00:00.000Z"));

  assert(stale.is_stale, "Urgent packet review should be stale after threshold");
  assert(stale.limit_hours === 12, `Urgent threshold should be 12 hours, got ${stale.limit_hours}`);
}

function checkFollowUpContextPatch() {
  const initial = {
    intent: "source_performance",
    scope: {
      community: "all",
      date_from: "2026-05-01",
      date_to: "2026-05-31",
    },
    artifact: "preview",
  };

  const april = patchContext(initial, { date_from: "2026-04-01", date_to: "2026-04-30" });
  const sanPablo = patchContext(april, { community: "San Pablo" });
  const exported = patchContext(sanPablo, { artifact: "csv" });

  assert(exported.scope.community === "San Pablo", "Community follow-up patch leaked context");
  assert(exported.scope.date_from === "2026-04-01", "Date follow-up patch lost April context");
  assert(exported.artifact === "csv", "Export follow-up did not patch artifact");
}

function checkDocsAndRunbooks() {
  for (const file of [
    "docs/AZURE_DATABRICKS_BACKEND_SETUP.md",
    "docs/REFERRAL_PACKET_INGESTION_RUNBOOK.md",
    "docs/EXTRACTION_STACK_IMPLEMENTATION_CHECKLIST.md",
    "docs/PIPELINE_V1_SPEC.md",
  ]) {
    const text = readText(file);
    assert(text.length > 200, `Runbook/spec is empty or too thin: ${file}`);
  }
}

function validateEnvelope(envelope) {
  assert(requiredJourneys.includes(envelope.journey), `Unknown journey: ${envelope.journey}`);
  assert(requiredModules.includes(envelope.module), `Unknown module: ${envelope.module}`);
  assert(envelope.trace.length > 0, "Envelope trace is required");
  assert(envelope.row_count === envelope.evidence_rows.length, "row_count/evidence mismatch");
  assert(envelope.next_action.length > 0, "next_action is required");

  if (envelope.truth_state !== "verified") {
    assert(envelope.safe_recovery !== "none", "Non-verified result needs safe recovery");
  }
}

function missingFields(referral) {
  const missing = [];

  for (const field of ["full_name", "date_of_birth", "community", "source", "packet_id"]) {
    if (isBlank(referral[field])) missing.push(field);
  }

  for (const [field, value] of Object.entries(referral.required_fields ?? {})) {
    if (isBlank(value)) missing.push(field);
  }

  return [...new Set(missing)].sort();
}

function freshness(referral, now) {
  const reference = new Date(referral.updated_at ?? referral.received_at);
  const ageHours = Math.max(0, (now.getTime() - reference.getTime()) / 36e5);
  const limitHours =
    referral.priority === "urgent"
      ? 12
      : referral.priority === "high"
        ? 24
        : referral.priority === "low"
          ? 96
          : 48;

  return {
    age_hours: Math.round(ageHours * 10) / 10,
    is_stale: ageHours > limitHours,
    limit_hours: limitHours,
  };
}

function isDuplicateCandidate(first, second) {
  return (
    first.referral_id !== second.referral_id &&
    Boolean(first.date_of_birth) &&
    first.date_of_birth === second.date_of_birth &&
    normalizeName(first.full_name) === normalizeName(second.full_name)
  );
}

function patchContext(context, patch) {
  const next = structuredClone(context);

  for (const [key, value] of Object.entries(patch)) {
    if (key === "community" || key === "date_from" || key === "date_to") {
      next.scope[key] = value;
    } else {
      next[key] = value;
    }
  }

  return next;
}

function normalizeName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function isBlank(value) {
  return value === undefined || value === null || value === "";
}

function readText(filePath) {
  return readFileSync(join(root, filePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
