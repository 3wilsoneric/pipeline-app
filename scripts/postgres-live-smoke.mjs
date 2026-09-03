#!/usr/bin/env node

import { randomUUID } from "node:crypto";

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(JSON.stringify({
    ok: false,
    configuration_present: { PIPELINE_DATABASE_URL: false },
    error: "Configure PIPELINE_DATABASE_URL before running the live database smoke check.",
  }, null, 2));
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable"
    ? false
    : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full"
      ? "verify-full"
      : "require",
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
});

const suffix = randomUUID();
const assessmentId = `asm_smoke_${suffix}`;
const documentHash = "a".repeat(64);
const checks = [];
let expectedRollback = false;

try {
  const migrations = await sql`
    select migration_id
    from pipeline.schema_migrations
    where migration_id in ('0001_pipeline_core', '0002_workflow_engine', '0003_operational_hardening', '0004_document_processing', '0005_collaboration', '0006_user_workspace_state', '0007_canonical_client_assessments', '0008_client_workspaces', '0009_assessment_collaboration', '0010_provisional_workspace_members', '0011_historical_material_workspaces', '0012_referral_trash', '0013_search_performance', '0014_workspace_county', '0015_assessor_workflow', '0016_zoom_assessment_method', '0017_referral_received_month', '0018_academy_progress', '0019_operator_training_progress', '0020_allo_canvas_content', '0021_note_practice_lab', '0022_note_lab_pattern_selections', '0023_note_lab_field_reviews', '0024_workspace_month_provenance')
  `;
  checks.push({ name: "required migrations are applied", ok: migrations.length === 24 });

  try {
    await sql.begin(async (tx) => {
      const people = await tx`
        insert into pipeline.people (external_client_id, display_name)
        values (${`smoke-client-${suffix}`}, 'Pipeline smoke record')
        returning person_id
      `;
      const referrals = await tx`
        insert into pipeline.referrals (
          person_id, stage, community, priority, source, tags, document_sha256,
          search_text, data, created_by, created_by_name, updated_by, updated_by_name
        ) values (
          ${people[0].person_id}::uuid, 'New', 'San Pablo', 'standard', 'smoke',
          array['smoke'], ${documentHash}, 'pipeline smoke record', '{}',
          'smoke', 'Pipeline smoke', 'smoke', 'Pipeline smoke'
        )
        returning referral_id
      `;
      const documents = await tx`
        insert into pipeline.documents (
          referral_id, person_id, category, file_name, content_type, byte_size,
          sha256, blob_container, blob_key, processing_status, uploaded_by,
          preview_status, malware_scan_status, page_count
        ) values (
          ${referrals[0].referral_id}, ${people[0].person_id}::uuid,
          'referral_packet', 'synthetic-smoke.pdf', 'application/pdf', 1024,
          ${"b".repeat(64)}, 'smoke', ${`smoke/${suffix}.pdf`}, 'ready_for_review',
          'smoke', 'ready', 'clean', 3
        ) returning document_id
      `;
      await tx`
        insert into pipeline.assessments (
          assessment_id, referral_id, canonical_client_id, status, data,
          created_by, created_by_name, updated_by, updated_by_name
        ) values (
          ${assessmentId}, ${referrals[0].referral_id}, ${`smoke-client-${suffix}`}, 'needs_review',
          ${tx.json({ resident_number: `SMOKE-${suffix}` })},
          'smoke', 'Pipeline smoke', 'smoke', 'Pipeline smoke'
        )
      `;
      await tx`
        insert into pipeline.client_update_outbox (
          update_type, canonical_client_id, assessment_id, source_baseline_date,
          payload, idempotency_key, created_by
        ) values (
          'assessment', ${`smoke-client-${suffix}`}, ${assessmentId}, date '2026-08-18',
          ${tx.json({ synthetic: true })}, ${`smoke-${suffix}`}, 'smoke'
        )
      `;
      await tx`
        insert into pipeline.assessment_field_provenance (
          assessment_id, field_key, source_field_key, confidence, review_status
        ) values (${assessmentId}, 'resident_number', 'smoke.resident_number', 1, 'accepted')
      `;
      await tx`
        insert into pipeline.assessment_unmapped_fields (
          assessment_id, source_field_key, source_value, reason, confidence, review_status
        ) values (${assessmentId}, 'smoke.unknown', ${tx.json("retained")}, 'unmapped', 0.5, 'pending')
      `;
      await tx`
        insert into pipeline.work_items (
          referral_id, person_id, type, label, gate, status, owner_name,
          due_at, next_action, evidence_document_name
        ) values (
          ${referrals[0].referral_id}, ${people[0].person_id}::uuid,
          'tb_test', 'TB test result', 'move_in', 'requested', 'Pipeline smoke',
          now() + interval '1 day', 'Review the synthetic result.', 'synthetic-tb.pdf'
        )
      `;
      await tx`
        insert into pipeline.admission_decisions (
          referral_id, outcome, reason_note, decided_by, decided_by_name
        ) values (
          ${referrals[0].referral_id}, 'declined', 'Synthetic smoke reason',
          'smoke', 'Pipeline smoke'
        )
      `;
      await tx`
        insert into pipeline.resident_links (
          person_id, referral_id, resident_key, community_id, status, match_method,
          created_by, created_by_name
        ) values (
          ${people[0].person_id}::uuid, ${referrals[0].referral_id},
          ${`smoke-resident-${suffix}`}, 'smoke-community', 'candidate', 'manual',
          'smoke', 'Pipeline smoke'
        )
      `;
      await tx`
        insert into pipeline.idempotency_keys (scope, mutation_id, entity_type, entity_id)
        values ('smoke', ${suffix}, 'assessment', ${assessmentId})
      `;
      await tx`
        insert into pipeline.audit_events (
          entity_type, entity_id, action, actor_id, actor_name, to_version
        ) values ('assessment', ${assessmentId}, 'assessment_created', 'smoke', 'Pipeline smoke', 1)
      `;
      await tx`
        insert into pipeline.user_workspace_state (
          principal_id, state_kind, state_key, payload, expires_at
        ) values (
          ${`smoke-user-${suffix}`}, 'referral_draft', 'new',
          ${tx.json({ schema: 1, synthetic: true })}, now() + interval '1 day'
        )
      `;

      const stored = await tx`
        select
          (select count(*) from pipeline.assessments where assessment_id = ${assessmentId}) as assessments,
          (select count(*) from pipeline.assessment_field_provenance where assessment_id = ${assessmentId}) as provenance,
          (select count(*) from pipeline.assessment_unmapped_fields where assessment_id = ${assessmentId}) as unmapped,
          (select count(*) from pipeline.audit_events where entity_id = ${assessmentId}) as audits,
          (select count(*) from pipeline.work_items where referral_id = ${referrals[0].referral_id}) as work_items,
          (select count(*) from pipeline.admission_decisions where referral_id = ${referrals[0].referral_id}) as decisions
          ,(select count(*) from pipeline.documents where document_id = ${documents[0].document_id}::uuid and preview_status = 'ready' and malware_scan_status = 'clean') as documents,
          (select count(*) from pipeline.user_workspace_state where principal_id = ${`smoke-user-${suffix}`}) as workspace_state,
          (select count(*) from pipeline.client_update_outbox where assessment_id = ${assessmentId}) as client_update_outbox
      `;
      checks.push({
        name: "runtime role can transact across workflow records",
        ok: ["assessments", "provenance", "unmapped", "audits", "work_items", "decisions", "documents", "workspace_state", "client_update_outbox"].every((key) => Number(stored[0][key]) === 1),
      });

      await tx`
        insert into pipeline.referrals (
          person_id, stage, community, priority, source, document_sha256,
          search_text, data, created_by, created_by_name, updated_by, updated_by_name
        ) values (
          ${people[0].person_id}::uuid, 'New', 'San Pablo', 'standard', 'smoke',
          ${documentHash}, 'duplicate smoke record', '{}',
          'smoke', 'Pipeline smoke', 'smoke', 'Pipeline smoke'
        )
      `;
    });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "23505") {
      expectedRollback = true;
    } else {
      throw error;
    }
  }

  checks.push({ name: "duplicate packet hashes are rejected", ok: expectedRollback });
  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    checks,
    transaction_rolled_back: expectedRollback,
    configuration_present: { PIPELINE_DATABASE_URL: true },
    note: "The smoke check uses synthetic values, rolls back, and never prints connection or row data.",
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({
    ok: false,
    checks,
    configuration_present: { PIPELINE_DATABASE_URL: true },
    error: "The live PostgreSQL smoke check failed. Review database connectivity, migration state, and runtime grants.",
  }, null, 2));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
