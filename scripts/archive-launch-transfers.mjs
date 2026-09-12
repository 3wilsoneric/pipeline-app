#!/usr/bin/env node

import postgres from "postgres";

// One-off, bounded launch-data correction. Future referrals never match this
// reviewed cohort, even if someone reuses the old pilot tag.
const referralIds = [1, 2, 3, 4, 5, 2599];
const actor = "system:launch-chart-correction";
const action = "launch_transfer_chart_only";
const mode = process.argv.includes("--rollback") ? "rollback" : process.argv.includes("--apply") ? "apply" : "plan";
const url = process.env.PIPELINE_DATABASE_URL?.trim();
if (!url) throw new Error("Configure PIPELINE_DATABASE_URL.");
const sql = postgres(url, {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : "require",
  max: 1, prepare: false, connect_timeout: 10, onnotice: () => {},
});

try {
  const result = mode === "plan" ? await plan(sql) : await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('pipeline_launch_chart_correction', 0))`;
    return mode === "apply" ? apply(tx) : rollback(tx);
  });
  console.log(JSON.stringify({ ok: true, mode, ...result, clinical_values_changed: false, documents_deleted: 0 }));
} catch (error) {
  // Never write connection strings or database values into operational logs.
  console.error(JSON.stringify({ ok: false, mode, code: error.code ?? "launch_correction_failed" }));
  process.exitCode = 1;
} finally {
  await sql.end();
}

async function targets(tx) {
  return tx`
    select referral_id, version, workspace_status, workflow_status, closed_at, tags,
      (select jsonb_object_agg(key, value) from jsonb_each(data)
        where key in ('workspaceStatus', 'workflowStatus', 'historicalOutcome', 'tags')) as before_data,
      case when stage = 'Accepted / Admitted' or data->'admissionDecision'->>'outcome' = 'accepted' then 'accepted'
        when stage = 'Declined' or data->'admissionDecision'->>'outcome' = 'declined' then 'declined'
        else 'closed' end as next_workflow
    from pipeline.referrals
    where referral_id in ${tx(referralIds)}
      and workspace_origin = 'pipeline' and workspace_status = 'active'
      and 'pilot' = any(tags) and created_at < '2026-09-12T00:00:00Z'::timestamptz
      and deleted_at is null
    order by referral_id
  `;
}

async function plan(tx) {
  const rows = await targets(tx);
  return { eligible: rows.length, reviewed_cohort: referralIds.length };
}

async function apply(tx) {
  const rows = await targets(tx);
  for (const row of rows) {
    const tags = row.tags.filter((tag) => !["pilot", "needs-assessment"].includes(tag));
    const outcome = row.next_workflow === "accepted" ? "admitted" : row.next_workflow === "declined" ? "declined" : "not_recorded";
    const changed = await tx`
      update pipeline.referrals
      set workspace_status = 'historical', workflow_status = ${row.next_workflow},
        closed_at = coalesce(closed_at, now()), tags = ${tags},
        data = data || ${tx.json({ workspaceStatus: "historical", workflowStatus: row.next_workflow, historicalOutcome: outcome, tags })},
        version = version + 1, updated_by = ${actor}, updated_by_name = 'Launch chart correction', updated_at = now()
      where referral_id = ${row.referral_id} and version = ${row.version} and workspace_status = 'active'
      returning version
    `;
    if (changed.length !== 1) throw new Error("Concurrent change; correction rolled back.");
    await tx`
      insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name, from_version, to_version, changed_fields, metadata)
      values ('referral', ${String(row.referral_id)}, ${action}, ${actor}, 'Launch chart correction', ${row.version}, ${changed[0].version},
        array['workspace_status','workflow_status','closed_at','tags'],
        ${tx.json({ before_workspace_status: row.workspace_status, before_workflow_status: row.workflow_status, before_closed_at: row.closed_at, before_tags: row.tags, before_data: row.before_data ?? {} })})
    `;
  }
  if (rows.length) await bumpRevision(tx);
  return { charts_corrected: rows.length };
}

async function rollback(tx) {
  const events = await tx`
    select distinct on (entity_id) entity_id, to_version, metadata
    from pipeline.audit_events where action = ${action} and actor_id = ${actor}
    order by entity_id, created_at desc, audit_event_id desc
  `;
  let restored = 0;
  for (const event of events) {
    const before = event.metadata;
    const changed = await tx`
      update pipeline.referrals
      set workspace_status = ${before.before_workspace_status}, workflow_status = ${before.before_workflow_status},
        closed_at = ${before.before_closed_at}::timestamptz, tags = ${before.before_tags},
        data = (data - array['workspaceStatus','workflowStatus','historicalOutcome','tags']) || ${tx.json(before.before_data)},
        version = version + 1, updated_by = 'system:launch-chart-rollback', updated_by_name = 'Launch chart rollback', updated_at = now()
      where referral_id = ${event.entity_id}::bigint and version = ${event.to_version} and updated_by = ${actor}
      returning version
    `;
    if (!changed.length) throw new Error("Record changed after correction; automatic rollback refused.");
    await tx`
      insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name, from_version, to_version, changed_fields)
      values ('referral', ${event.entity_id}, 'launch_transfer_chart_restored', 'system:launch-chart-rollback', 'Launch chart rollback',
        ${event.to_version}, ${changed[0].version}, array['workspace_status','workflow_status','closed_at','tags'])
    `;
    restored += 1;
  }
  if (restored) await bumpRevision(tx);
  return { charts_restored: restored };
}

async function bumpRevision(tx) {
  await tx`update pipeline.store_revisions set revision = revision + 1, updated_at = now() where store_name in ('referrals','client_workspaces')`;
}
