#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_TEST_DATABASE_URL?.trim();
if (!databaseUrl) fail("Configure PIPELINE_TEST_DATABASE_URL before running database capacity certification.");
guardTestDatabase(databaseUrl);

const rowCount = boundedInteger("PIPELINE_DATABASE_SCALE_ROWS", 25_000, 1_000, 1_000_000);
const queryCount = boundedInteger("PIPELINE_DATABASE_SCALE_QUERIES", 200, 20, 5_000);
const concurrency = boundedInteger("PIPELINE_DATABASE_SCALE_CONCURRENCY", 16, 1, 64);
const payloadBytes = boundedInteger("PIPELINE_DATABASE_SCALE_PAYLOAD_BYTES", 512, 0, 16_384);
const p95BudgetMs = boundedInteger("PIPELINE_DATABASE_SCALE_P95_MS", 250, 10, 10_000);
const runId = randomUUID();
const prefix = `capacity-${runId}`;
const sql = postgres(databaseUrl, databaseOptions(Math.min(concurrency + 2, 64)));
const checks = [];
const timings = {};
let cleaned = false;

try {
  const insertedAt = performance.now();
  await seed();
  timings.insert_ms = rounded(performance.now() - insertedAt);

  const counts = await sql`
    select
      (select count(*)::integer from pipeline.people where external_client_id like ${`${prefix}%`}) as people,
      (select count(*)::integer from pipeline.referrals r join pipeline.people p on p.person_id = r.person_id where p.external_client_id like ${`${prefix}%`}) as referrals
  `;
  check("capacity fixture cardinality is exact", Number(counts[0].people) === rowCount && Number(counts[0].referrals) === rowCount, {
    expected: rowCount,
    people: Number(counts[0].people),
    referrals: Number(counts[0].referrals),
  });

  const analyzedAt = performance.now();
  await sql.unsafe("analyze pipeline.people");
  await sql.unsafe("analyze pipeline.referrals");
  timings.analyze_ms = rounded(performance.now() - analyzedAt);

  const planRows = await sql.unsafe(`
    explain (analyze, buffers, format json)
    select referral_id
    from pipeline.referrals
    where deleted_at is null
    order by updated_at desc, referral_id desc
    limit 200
  `);
  const plan = planRows[0]["QUERY PLAN"] ?? planRows[0]["query plan"];
  const serializedPlan = JSON.stringify(plan);
  check("actual planner uses the active-referral paging index", serializedPlan.includes("referrals_active_updated_idx"), {
    expected_index_selected: serializedPlan.includes("referrals_active_updated_idx"),
  });

  const durations = await runQueries();
  const sorted = durations.toSorted((left, right) => left - right);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);
  timings.query_p50_ms = rounded(p50);
  timings.query_p95_ms = rounded(p95);
  timings.query_p99_ms = rounded(p99);
  check("concurrent query p95 remains within budget", p95 <= p95BudgetMs, {
    query_count: queryCount,
    concurrency,
    p95_ms: rounded(p95),
    budget_ms: p95BudgetMs,
  });
  check("every benchmark query returns an operator-bounded page", durations.length === queryCount, {
    completed_queries: durations.length,
    expected_queries: queryCount,
    maximum_page_size: 200,
  });

  const cleanupAt = performance.now();
  await cleanup();
  timings.cleanup_ms = rounded(performance.now() - cleanupAt);
  const residue = await sql`
    select
      (select count(*)::integer from pipeline.people where external_client_id like ${`${prefix}%`}) as people,
      (select count(*)::integer from pipeline.referrals r join pipeline.people p on p.person_id = r.person_id where p.external_client_id like ${`${prefix}%`}) as referrals
  `;
  cleaned = Number(residue[0].people) === 0 && Number(residue[0].referrals) === 0;
  check("capacity fixture cleanup leaves no run-scoped rows", cleaned, {
    people_residue: Number(residue[0].people),
    referral_residue: Number(residue[0].referrals),
  });

  const failed = checks.filter((item) => !item.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    configuration: {
      rows: rowCount,
      queries: queryCount,
      concurrency,
      payload_bytes_per_referral: payloadBytes,
      approximate_payload_mb: rounded((rowCount * payloadBytes) / 1024 / 1024),
      p95_budget_ms: p95BudgetMs,
    },
    timings,
    checks,
    note: "All capacity records are synthetic and run-scoped. Results contain aggregate timings and counts only.",
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: "PostgreSQL capacity certification failed. Review database capacity and schema state.",
    error_code: databaseErrorCode(error),
    completed_checks: checks,
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (!cleaned) await cleanup().catch(() => undefined);
  await sql.end({ timeout: 10 });
}

async function seed() {
  const padding = "x".repeat(payloadBytes);
  await sql.begin(async (tx) => {
    await tx`
      insert into pipeline.people (external_client_id, display_name)
      select ${prefix}::text || '-' || value::text, 'Synthetic capacity client ' || value::text
      from generate_series(1, ${rowCount}::integer) as value
    `;
    await tx`
      insert into pipeline.referrals (
        person_id, stage, community, priority, source, received_date, search_text, data,
        created_by, created_by_name, updated_by, updated_by_name
      )
      select
        person_id,
        case when ordinal % 20 = 0 then 'Packet Review' else 'New' end,
        (array['San Pablo', 'Santa Clarita', 'Turlock', 'Victoria''s Place', 'JC Wallace'])[(ordinal % 5) + 1],
        case when ordinal % 50 = 0 then 'urgent' when ordinal % 10 = 0 then 'high' else 'standard' end,
        'database-capacity',
        date '2026-01-01' + ((ordinal % 240)::integer),
        'synthetic capacity referral ' || ordinal::text,
        jsonb_build_object('synthetic', true, 'padding', ${padding}::text),
        'database-capacity', 'Synthetic capacity', 'database-capacity', 'Synthetic capacity'
      from (
        select person_id, row_number() over (order by external_client_id)::integer as ordinal
        from pipeline.people
        where external_client_id like ${`${prefix}%`}
      ) seeded
    `;
  });
}

async function runQueries() {
  const durations = [];
  let next = 0;
  const workers = Array.from({ length: concurrency }, () => (async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= queryCount) return;
      const startedAt = performance.now();
      if (index % 3 === 0) {
        await sql`
          select referral_id from pipeline.referrals
          where deleted_at is null
          order by updated_at desc, referral_id desc
          limit 200
        `;
      } else if (index % 3 === 1) {
        await sql`
          select referral_id from pipeline.referrals
          where community = 'San Pablo' and deleted_at is null
          order by created_at desc, referral_id desc
          limit 200
        `;
      } else {
        await sql`
          select referral_id from pipeline.referrals
          where received_date >= date '2026-06-01' and received_date < date '2026-07-01'
            and deleted_at is null
          order by received_date desc, referral_id desc
          limit 200
        `;
      }
      durations.push(performance.now() - startedAt);
    }
  })());
  await Promise.all(workers);
  return durations;
}

async function cleanup() {
  await sql.begin(async (tx) => {
    await tx`
      delete from pipeline.referrals r
      using pipeline.people p
      where r.person_id = p.person_id and p.external_client_id like ${`${prefix}%`}
    `;
    await tx`delete from pipeline.people where external_client_id like ${`${prefix}%`}`;
  });
}

function guardTestDatabase(value) {
  const productionUrl = process.env.PIPELINE_DATABASE_URL?.trim();
  if (productionUrl && value === productionUrl && process.env.PIPELINE_ALLOW_TEST_DATABASE_REUSE !== "true") {
    fail("Capacity certification refuses PIPELINE_DATABASE_URL without PIPELINE_ALLOW_TEST_DATABASE_REUSE=true.");
  }
  let database;
  try {
    database = decodeURIComponent(new URL(value).pathname.replace(/^\//, ""));
  } catch {
    fail("PIPELINE_TEST_DATABASE_URL is invalid.");
  }
  if (!/(test|ci|drill|disposable)/i.test(database) && process.env.PIPELINE_ALLOW_TEST_DATABASE_REUSE !== "true") {
    fail("The capacity database name must contain test, ci, drill, or disposable unless explicit reuse is acknowledged.");
  }
}

function databaseOptions(max) {
  return {
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
    max,
    connect_timeout: 10,
    idle_timeout: 10,
    max_lifetime: 120,
    prepare: false,
    onnotice: () => undefined,
  };
}

function check(name, ok, metrics = {}) {
  checks.push({ name, ok: Boolean(ok), metrics });
}

function boundedInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function databaseErrorCode(error) {
  return error && typeof error === "object" && typeof error.code === "string" ? error.code : "database_error";
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_TEST_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}
