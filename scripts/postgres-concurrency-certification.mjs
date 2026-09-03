#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_TEST_DATABASE_URL?.trim();
if (!databaseUrl) fail("Configure PIPELINE_TEST_DATABASE_URL before running concurrency certification.");
guardTestDatabase(databaseUrl);

const actorCount = boundedInteger("PIPELINE_DATABASE_CONCURRENCY", 24, 4, 64);
const queueSize = boundedInteger("PIPELINE_DATABASE_QUEUE_SIZE", 48, actorCount, 500);
const runId = randomUUID();
const scope = `database-assurance:${runId}`;
const externalClientId = `database-assurance-${runId}`;
const outboxKey = `database-assurance-outbox-${runId}`;
const sql = postgres(databaseUrl, databaseOptions(Math.min(actorCount + 4, 64)));
const checks = [];
let personId = null;
let referralId = null;

try {
  await requireCurrentSchema();
  await verifyAtomicRollback();
  ({ personId, referralId } = await createRunGraph());
  await verifyOptimisticWriterRace();
  await verifyMutationIdempotencyRace();
  await verifyCommittedRetryExactlyOnce();
  await verifyOutboxIdempotencyRace();
  await verifyExtractionQueueClaims();
  await verifyActiveJobUniqueness();
  await verifyLockTimeoutRecovery();
  await verifyDeadlockRecovery();

  const failed = checks.filter((item) => !item.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    actors: actorCount,
    queued_jobs: queueSize,
    checks,
    note: "All test records are synthetic and run-scoped. Output contains aggregate counts only.",
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: "PostgreSQL concurrency certification failed. Review the failed operation without exposing connection details or row data.",
    error_code: databaseErrorCode(error),
    completed_checks: checks,
  }, null, 2));
  process.exitCode = 1;
} finally {
  await cleanup().catch(() => undefined);
  await sql.end({ timeout: 5 });
}

async function requireCurrentSchema() {
  const rows = await sql`
    select count(*)::integer as count
    from pipeline.schema_migrations
    where migration_id between '0001_pipeline_core' and '0024_workspace_month_provenance'
  `;
  check("latest migration set is available", Number(rows[0].count) === 24, { migrations: Number(rows[0].count) });
}

async function verifyAtomicRollback() {
  const rollbackClientId = `database-assurance-rollback-${runId}`;
  let expectedConstraintFailure = false;
  try {
    await sql.begin(async (tx) => {
      const people = await tx`
        insert into pipeline.people (external_client_id, display_name)
        values (${rollbackClientId}, 'Synthetic database assurance rollback')
        returning person_id
      `;
      await tx`
        insert into pipeline.referrals (
          person_id, stage, community, priority, source, created_by, created_by_name,
          updated_by, updated_by_name
        ) values (
          ${people[0].person_id}::uuid, 'New', 'San Pablo', 'invalid-priority', 'database-assurance',
          'database-assurance', 'Synthetic assurance', 'database-assurance', 'Synthetic assurance'
        )
      `;
    });
  } catch (error) {
    expectedConstraintFailure = databaseErrorCode(error) === "23514";
  }
  const rows = await sql`select count(*)::integer as count from pipeline.people where external_client_id = ${rollbackClientId}`;
  check("injected constraint failure rolls back preceding writes", expectedConstraintFailure && Number(rows[0].count) === 0, {
    residue: Number(rows[0].count),
  });
}

async function createRunGraph() {
  return sql.begin(async (tx) => {
    const people = await tx`
      insert into pipeline.people (external_client_id, display_name)
      values (${externalClientId}, 'Synthetic database assurance client')
      returning person_id
    `;
    const referrals = await tx`
      insert into pipeline.referrals (
        person_id, stage, community, priority, source, search_text, data,
        created_by, created_by_name, updated_by, updated_by_name
      ) values (
        ${people[0].person_id}::uuid, 'New', 'San Pablo', 'standard', 'database-assurance',
        'synthetic database assurance', ${tx.json({ synthetic: true })},
        'database-assurance', 'Synthetic assurance', 'database-assurance', 'Synthetic assurance'
      ) returning referral_id
    `;
    return { personId: people[0].person_id, referralId: Number(referrals[0].referral_id) };
  });
}

async function verifyOptimisticWriterRace() {
  const outcomes = await Promise.all(Array.from({ length: actorCount }, (_, index) => sql`
    update pipeline.referrals
    set summary = ${`synthetic-writer-${index}`}, version = version + 1, updated_at = now()
    where referral_id = ${referralId} and version = 1
    returning version
  `));
  const winners = outcomes.filter((rows) => rows.length === 1).length;
  const finalRows = await sql`select version from pipeline.referrals where referral_id = ${referralId}`;
  check("one optimistic writer wins the stale-version race", winners === 1 && Number(finalRows[0].version) === 2, {
    contenders: actorCount,
    winners,
    final_version: Number(finalRows[0].version),
  });
}

async function verifyMutationIdempotencyRace() {
  const mutationId = `mutation-${runId}`;
  const outcomes = await Promise.all(Array.from({ length: actorCount }, () => sql`
    insert into pipeline.idempotency_keys (scope, mutation_id, entity_type, entity_id)
    values (${scope}, ${mutationId}, 'referral', ${String(referralId)})
    on conflict (scope, mutation_id) do nothing
    returning mutation_id
  `));
  const inserts = outcomes.filter((rows) => rows.length === 1).length;
  const durable = await sql`
    select count(*)::integer as count from pipeline.idempotency_keys
    where scope = ${scope} and mutation_id = ${mutationId}
  `;
  check("competing mutation identifiers collapse to one durable key", inserts === 1 && Number(durable[0].count) === 1, {
    contenders: actorCount,
    inserts,
    durable: Number(durable[0].count),
  });
}

async function verifyCommittedRetryExactlyOnce() {
  const mutationId = `committed-retry-${runId}`;
  const beforeRows = await sql`select version from pipeline.referrals where referral_id = ${referralId}`;
  const beforeVersion = Number(beforeRows[0].version);
  const outcomes = await Promise.all(Array.from({ length: actorCount }, () => sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`${scope}:${mutationId}`}, 0))`;
    const inserted = await tx`
      insert into pipeline.idempotency_keys (scope, mutation_id, entity_type, entity_id)
      values (${scope}, ${mutationId}, 'referral', ${String(referralId)})
      on conflict (scope, mutation_id) do nothing
      returning mutation_id
    `;
    if (!inserted[0]) return false;
    await tx`
      update pipeline.referrals set version = version + 1, updated_at = now()
      where referral_id = ${referralId}
    `;
    return true;
  })));
  const applied = outcomes.filter(Boolean).length;
  const afterRows = await sql`select version from pipeline.referrals where referral_id = ${referralId}`;
  check("committed retries apply the guarded mutation exactly once", applied === 1 && Number(afterRows[0].version) === beforeVersion + 1, {
    retries: actorCount,
    applied,
    version_delta: Number(afterRows[0].version) - beforeVersion,
  });
}

async function verifyOutboxIdempotencyRace() {
  const outcomes = await Promise.all(Array.from({ length: actorCount }, () => sql`
    insert into pipeline.client_update_outbox (
      update_type, canonical_client_id, source_baseline_date, payload, idempotency_key, created_by
    ) values (
      'new_client', ${externalClientId}, date '2026-08-18', ${sql.json({ synthetic: true })}, ${outboxKey}, 'database-assurance'
    )
    on conflict (idempotency_key) do nothing
    returning client_update_id
  `));
  const inserts = outcomes.filter((rows) => rows.length === 1).length;
  const durable = await sql`select count(*)::integer as count from pipeline.client_update_outbox where idempotency_key = ${outboxKey}`;
  check("competing outbox publications collapse to one event", inserts === 1 && Number(durable[0].count) === 1, {
    contenders: actorCount,
    inserts,
    durable: Number(durable[0].count),
  });
}

async function verifyExtractionQueueClaims() {
  await sql.begin(async (tx) => {
    for (let index = 0; index < queueSize; index += 1) {
      const documents = await tx`
        insert into pipeline.documents (
          referral_id, person_id, category, file_name, content_type, byte_size, sha256,
          blob_container, blob_key, processing_status, uploaded_by, preview_status, malware_scan_status
        ) values (
          ${referralId}, ${personId}::uuid, 'referral_packet', ${`synthetic-${index}.pdf`},
          'application/pdf', 1024, ${digest(`${runId}:queue:${index}`)}, 'database-assurance',
          ${`database-assurance/${runId}/queue/${index}.pdf`}, 'uploaded', 'database-assurance', 'pending', 'clean'
        ) returning document_id
      `;
      await tx`
        insert into pipeline.extraction_jobs (document_id, job_type, status, provider_job_id)
        values (${documents[0].document_id}::uuid, 'referral_packet', 'queued', ${scope})
      `;
    }
  });

  const claimedByWorker = await Promise.all(Array.from({ length: actorCount }, (_, index) => claimUntilEmpty(`worker-${index}`)));
  const claimed = claimedByWorker.flat();
  const unique = new Set(claimed);
  const rows = await sql`
    select
      count(*) filter (where status = 'running')::integer as running,
      count(*) filter (where status = 'queued')::integer as queued
    from pipeline.extraction_jobs where provider_job_id = ${scope}
  `;
  check("SKIP LOCKED workers claim each queued job exactly once", claimed.length === queueSize
    && unique.size === queueSize
    && Number(rows[0].running) === queueSize
    && Number(rows[0].queued) === 0, {
    workers: actorCount,
    claims: claimed.length,
    unique_claims: unique.size,
    remaining_queued: Number(rows[0].queued),
  });
}

async function claimUntilEmpty(workerId) {
  const claimed = [];
  while (true) {
    const rows = await sql.begin(async (tx) => tx`
      with candidate as (
        select extraction_job_id
        from pipeline.extraction_jobs
        where provider_job_id = ${scope} and status = 'queued'
        order by queued_at, extraction_job_id
        for update skip locked
        limit 1
      )
      update pipeline.extraction_jobs job
      set status = 'running', lease_owner = ${workerId}, started_at = coalesce(started_at, now()),
          heartbeat_at = now(), updated_at = now()
      from candidate
      where job.extraction_job_id = candidate.extraction_job_id
      returning job.extraction_job_id
    `);
    if (!rows[0]) return claimed;
    claimed.push(String(rows[0].extraction_job_id));
  }
}

async function verifyActiveJobUniqueness() {
  const documents = await sql`
    insert into pipeline.documents (
      referral_id, person_id, category, file_name, content_type, byte_size, sha256,
      blob_container, blob_key, processing_status, uploaded_by, preview_status, malware_scan_status
    ) values (
      ${referralId}, ${personId}::uuid, 'referral_packet', 'synthetic-active-race.pdf',
      'application/pdf', 1024, ${digest(`${runId}:active`)}, 'database-assurance',
      ${`database-assurance/${runId}/active.pdf`}, 'uploaded', 'database-assurance', 'pending', 'clean'
    ) returning document_id
  `;
  const outcomes = await Promise.all(Array.from({ length: actorCount }, () => sql`
    insert into pipeline.extraction_jobs (document_id, job_type, status, provider_job_id)
    values (${documents[0].document_id}::uuid, 'referral_packet', 'queued', ${`${scope}:active`})
    on conflict (document_id, job_type) where status in ('queued', 'running') do nothing
    returning extraction_job_id
  `));
  const inserts = outcomes.filter((rows) => rows.length === 1).length;
  const durable = await sql`
    select count(*)::integer as count from pipeline.extraction_jobs
    where document_id = ${documents[0].document_id}::uuid and status in ('queued', 'running')
  `;
  check("one active extraction job survives a creation race", inserts === 1 && Number(durable[0].count) === 1, {
    contenders: actorCount,
    inserts,
    active_jobs: Number(durable[0].count),
  });
}

async function verifyLockTimeoutRecovery() {
  const blocker = await sql.reserve();
  let timedOut = false;
  try {
    await blocker`begin`;
    await blocker`select pg_advisory_xact_lock(hashtextextended(${`${scope}:timeout`}, 0))`;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("set local lock_timeout = '200ms'");
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${scope}:timeout`}, 0))`;
      });
    } catch (error) {
      timedOut = databaseErrorCode(error) === "55P03";
    }
    await blocker`rollback`;
  } finally {
    await blocker`rollback`.catch(() => undefined);
    blocker.release();
  }
  let recovered = false;
  await sql.begin(async (tx) => {
    await tx.unsafe("set local lock_timeout = '1s'");
    await tx`select pg_advisory_xact_lock(hashtextextended(${`${scope}:timeout`}, 0))`;
    recovered = true;
  });
  check("lock timeout is bounded and the lock remains recoverable", timedOut && recovered, { timed_out: timedOut, recovered });
}

async function verifyDeadlockRecovery() {
  let arrivals = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  const arrive = async () => {
    arrivals += 1;
    if (arrivals === 2) releaseBarrier();
    await barrier;
  };
  const participant = (first, second) => sql.begin(async (tx) => {
    await tx.unsafe("set local statement_timeout = '5s'");
    await tx`select pg_advisory_xact_lock(hashtextextended(${first}, 0))`;
    await arrive();
    await tx`select pg_advisory_xact_lock(hashtextextended(${second}, 0))`;
  });
  const left = `${scope}:deadlock:left`;
  const right = `${scope}:deadlock:right`;
  const results = await Promise.allSettled([participant(left, right), participant(right, left)]);
  const deadlocks = results.filter((item) => item.status === "rejected" && databaseErrorCode(item.reason) === "40P01").length;
  const fulfilled = results.filter((item) => item.status === "fulfilled").length;
  check("deliberate deadlock aborts one transaction and releases both locks", deadlocks === 1 && fulfilled === 1, {
    deadlock_victims: deadlocks,
    completed_transactions: fulfilled,
  });

  const ordered = [left, right].sort();
  const recovered = await Promise.all(Array.from({ length: 4 }, () => sql.begin(async (tx) => {
    await tx.unsafe("set local statement_timeout = '5s'");
    for (const key of ordered) await tx`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    return true;
  })));
  check("canonical lock ordering succeeds after deadlock recovery", recovered.every(Boolean), { completed_transactions: recovered.length });
}

async function cleanup() {
  await sql.begin(async (tx) => {
    await tx`delete from pipeline.client_update_outbox where idempotency_key = ${outboxKey}`;
    await tx`delete from pipeline.idempotency_keys where scope = ${scope}`;
    if (referralId !== null) await tx`delete from pipeline.referrals where referral_id = ${referralId}`;
    if (personId !== null) await tx`delete from pipeline.people where person_id = ${personId}::uuid`;
  });
}

function guardTestDatabase(value) {
  const productionUrl = process.env.PIPELINE_DATABASE_URL?.trim();
  if (productionUrl && value === productionUrl && process.env.PIPELINE_ALLOW_TEST_DATABASE_REUSE !== "true") {
    fail("Concurrency certification refuses PIPELINE_DATABASE_URL without PIPELINE_ALLOW_TEST_DATABASE_REUSE=true.");
  }
  let database;
  try {
    database = decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
  } catch {
    fail("PIPELINE_TEST_DATABASE_URL is invalid.");
  }
  if (!/(test|ci|drill|disposable)/i.test(database) && process.env.PIPELINE_ALLOW_TEST_DATABASE_REUSE !== "true") {
    fail("The certification database name must contain test, ci, drill, or disposable unless explicit reuse is acknowledged.");
  }
}

function databaseOptions(max) {
  return {
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
    max,
    connect_timeout: 10,
    idle_timeout: 10,
    max_lifetime: 60,
    prepare: false,
    onnotice: () => undefined,
  };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function check(name, ok, metrics = {}) {
  checks.push({ name, ok: Boolean(ok), metrics });
}

function boundedInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function databaseErrorCode(error) {
  return error && typeof error === "object" && typeof error.code === "string" ? error.code : "database_error";
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_TEST_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}
