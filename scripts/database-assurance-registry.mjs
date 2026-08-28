const control = (id, title, gate) => ({ id, title, gate });

export const databaseAssuranceProfiles = ["local", "integration", "capacity", "disaster"];

export const databaseAssuranceGates = {
  readiness: {
    name: "Schema and repository database contracts",
    profile: "local",
    command: "node",
    args: ["scripts/database-readiness.mjs"],
  },
  query_contracts: {
    name: "Static high-volume query audit",
    profile: "local",
    command: "node",
    args: ["scripts/query-plan-audit.mjs"],
  },
  assurance_contracts: {
    name: "Database assurance harness contracts",
    profile: "local",
    command: "node",
    args: ["scripts/database-assurance-contracts.mjs"],
  },
  migration_plan: {
    name: "Applied migration checksum and plan verification",
    profile: "integration",
    command: "node",
    args: ["scripts/apply-database-migrations.mjs", "--plan"],
    requiredEnv: ["PIPELINE_TEST_DATABASE_URL"],
    useTestDatabaseAsPrimary: true,
  },
  live_smoke: {
    name: "Live PostgreSQL constraints and rollback smoke",
    profile: "integration",
    command: "node",
    args: ["scripts/postgres-live-smoke.mjs"],
    requiredEnv: ["PIPELINE_TEST_DATABASE_URL"],
    useTestDatabaseAsPrimary: true,
  },
  fixtures: {
    name: "Transactional relational graph fixtures",
    profile: "integration",
    command: "node",
    args: ["scripts/postgres-integration-fixtures.mjs"],
    requiredEnv: ["PIPELINE_TEST_DATABASE_URL"],
  },
  query_plans: {
    name: "PostgreSQL index-plan certification",
    profile: "integration",
    command: "node",
    args: ["scripts/postgres-query-plan-fixtures.mjs"],
    requiredEnv: ["PIPELINE_TEST_DATABASE_URL"],
  },
  concurrency: {
    name: "Concurrent writers, queue claims, locks, and failpoints",
    profile: "integration",
    command: "node",
    args: ["scripts/postgres-concurrency-certification.mjs"],
    requiredEnv: ["PIPELINE_TEST_DATABASE_URL"],
  },
  integrity: {
    name: "Aggregate cross-table integrity and health audit",
    profile: "integration",
    command: "node",
    args: ["scripts/postgres-integrity-audit.mjs"],
    requiredEnv: ["PIPELINE_TEST_DATABASE_URL"],
  },
  rollback: {
    name: "Transactional migration rollback drill",
    profile: "integration",
    command: "node",
    args: ["scripts/database-rollback-drill.mjs"],
    requiredEnv: ["PIPELINE_TEST_DATABASE_URL"],
    env: { PIPELINE_ALLOW_MIGRATION_ROLLBACK_DRILL: "true" },
  },
  capacity: {
    name: "Production-shaped data volume and concurrent query benchmark",
    profile: "capacity",
    command: "node",
    args: ["scripts/postgres-capacity-certification.mjs"],
    requiredEnv: ["PIPELINE_TEST_DATABASE_URL"],
    timeoutMs: 30 * 60_000,
  },
  restore: {
    name: "Disposable backup restore and manifest verification",
    profile: "disaster",
    command: "node",
    args: (env) => [
      "scripts/database-restore-verify.mjs",
      "--backup",
      env.PIPELINE_RESTORE_BACKUP_PATH,
      "--confirm-disposable",
    ],
    requiredEnv: ["PIPELINE_TEST_DATABASE_URL", "PIPELINE_RESTORE_BACKUP_PATH"],
    env: { PIPELINE_ALLOW_RESTORE_DRILL: "true" },
  },
};

export const databaseAssuranceDomains = [
  {
    id: "schema",
    name: "Schema and migration safety",
    controls: [
      control("DB-SM-01", "Migration history is append-only and checksum-bound", "readiness"),
      control("DB-SM-02", "Migration execution is serialized with an advisory lock", "readiness"),
      control("DB-SM-03", "Every current migration has a scoped rollback", "readiness"),
      control("DB-SM-04", "Production runtime and migration privileges are separated", "readiness"),
      control("DB-SM-05", "Core workflow state is constrained at the database boundary", "readiness"),
      control("DB-SM-06", "Referral, assessment, document, and audit writes are transactional", "readiness"),
      control("DB-SM-07", "Idempotency and optimistic-version primitives are present", "readiness"),
      control("DB-SM-08", "Retention and soft-delete recovery windows are indexed", "readiness"),
      control("DB-SM-09", "The applied schema matches all migration checksums", "migration_plan"),
      control("DB-SM-10", "A current database reports no pending migration", "migration_plan"),
      control("DB-SM-11", "Migration planning does not mutate the target", "migration_plan"),
      control("DB-SM-12", "Every post-foundation rollback restores its migration surface", "rollback"),
      control("DB-SM-13", "Rollback DDL remains inside one reversible transaction", "rollback"),
      control("DB-SM-14", "The schema is unchanged after the rollback drill", "rollback"),
    ],
  },
  {
    id: "transactions",
    name: "Transactions and constraints",
    controls: [
      control("DB-TX-01", "The runtime role can write the complete workflow graph", "live_smoke"),
      control("DB-TX-02", "Duplicate packet identity is rejected by PostgreSQL", "live_smoke"),
      control("DB-TX-03", "A constraint failure rolls back the complete workflow transaction", "live_smoke"),
      control("DB-TX-04", "Required migration state is visible to the runtime role", "live_smoke"),
      control("DB-TX-05", "Synthetic relational fixtures are queryable as one graph", "fixtures"),
      control("DB-TX-06", "Fixture writes leave no residue after rollback", "fixtures"),
      control("DB-TX-07", "Retention deletes only records past their recovery window", "fixtures"),
      control("DB-TX-08", "Workspace and assessment state remain principal-scoped", "fixtures"),
      control("DB-TX-09", "Injected mid-transaction failures leave no partial rows", "concurrency"),
      control("DB-TX-10", "Committed idempotent retries apply their mutation once", "concurrency"),
    ],
  },
  {
    id: "concurrency",
    name: "Concurrency and queue semantics",
    controls: [
      control("DB-CC-01", "One optimistic writer wins a stale-version race", "concurrency"),
      control("DB-CC-02", "Competing mutation keys collapse to one durable key", "concurrency"),
      control("DB-CC-03", "Competing EHR outbox writes collapse to one event", "concurrency"),
      control("DB-CC-04", "Extraction workers claim each queued job exactly once", "concurrency"),
      control("DB-CC-05", "Only one active extraction job exists per document and type", "concurrency"),
      control("DB-CC-06", "Lock timeout failure is bounded and recoverable", "concurrency"),
      control("DB-CC-07", "A deliberate deadlock aborts one participant without corrupting state", "concurrency"),
      control("DB-CC-08", "Canonical lock ordering succeeds after deadlock recovery", "concurrency"),
    ],
  },
  {
    id: "performance",
    name: "Query and capacity behavior",
    controls: [
      control("DB-QP-01", "High-volume list queries use bounded keyset pagination", "query_contracts"),
      control("DB-QP-02", "Search and community filters have dedicated indexes", "query_contracts"),
      control("DB-QP-03", "Queue consumers use ordered SKIP LOCKED claims", "query_contracts"),
      control("DB-QP-04", "Query contracts reject unbounded directory reads", "query_contracts"),
      control("DB-QP-05", "Certification runs on PostgreSQL 16 or newer", "query_plans"),
      control("DB-QP-06", "Active referral paging selects its intended index", "query_plans"),
      control("DB-QP-07", "Community and retention paging select intended indexes", "query_plans"),
      control("DB-QP-08", "Document and assessment paging select intended indexes", "query_plans"),
      control("DB-QP-09", "Capacity fixtures reach their exact configured cardinality", "capacity"),
      control("DB-QP-10", "The real planner selects indexes without disabling sequential scans", "capacity"),
      control("DB-QP-11", "Concurrent referral reads remain below the configured p95 budget", "capacity"),
      control("DB-QP-12", "Capacity queries remain bounded to operator-sized result sets", "capacity"),
      control("DB-QP-13", "Capacity evidence records insert, query, and cleanup timing", "capacity"),
      control("DB-QP-14", "Capacity fixtures leave no synthetic database residue", "capacity"),
    ],
  },
  {
    id: "integrity",
    name: "Cross-system integrity and recovery",
    controls: [
      control("DB-IN-01", "Referral-bound documents retain the same person identity", "integrity"),
      control("DB-IN-02", "Field evidence cannot point to another referral's document", "integrity"),
      control("DB-IN-03", "Packet upload files remain attached to their reserved referral", "integrity"),
      control("DB-IN-04", "Signed assessments and terminal referrals remain internally coherent", "integrity"),
      control("DB-IN-05", "Published outbox records retain approval and publication evidence", "integrity"),
      control("DB-IN-06", "Database constraints are validated and PUBLIC has no table grants", "integrity"),
      control("DB-RC-01", "The assurance registry is complete, unique, and profile-bounded", "assurance_contracts"),
      control("DB-RC-02", "Live harnesses refuse an unacknowledged production database", "assurance_contracts"),
      control("DB-RC-03", "Reports are PHI-free, aggregate-only, and owner-readable", "assurance_contracts"),
      control("DB-RC-04", "A backup restores into a disposable database with a valid checksum", "restore"),
      control("DB-RC-05", "Restored migration history exactly matches the backup manifest", "restore"),
      control("DB-RC-06", "Restored core-table counts are readable without exposing rows", "restore"),
      control("DB-RC-07", "Restore execution refuses a non-disposable target by default", "restore"),
    ],
  },
];

export const databaseAssuranceControls = databaseAssuranceDomains.flatMap((domain) =>
  domain.controls.map((item) => ({ ...item, domain: domain.id, domainName: domain.name })),
);

export const databaseAssuranceTotals = Object.freeze({
  controls: databaseAssuranceControls.length,
  local: databaseAssuranceControls.filter((item) => gateRank(item.gate) <= 0).length,
  integration: databaseAssuranceControls.filter((item) => gateRank(item.gate) <= 1).length,
  capacity: databaseAssuranceControls.filter((item) => gateRank(item.gate) <= 2).length,
  disaster: databaseAssuranceControls.length,
});

export function profileIncludesGate(profile, gate) {
  return databaseAssuranceProfiles.indexOf(profile) >= databaseAssuranceProfiles.indexOf(gate.profile);
}

function gateRank(gateId) {
  return databaseAssuranceProfiles.indexOf(databaseAssuranceGates[gateId].profile);
}
