#!/usr/bin/env node
import postgres from "postgres";

// Reviewed existing cohort only. Never clear a signed, completed, scheduled,
// explicitly edited, or source-evidenced assessment date.
const cohort = [1, 4, 5, 2568, 2600];
const actor = "system:launch-draft-date-correction";
const marker = "launch_draft_date_correction";
const mode = process.argv.includes("--rollback") ? "rollback" : process.argv.includes("--apply") ? "apply" : "plan";
if (!process.env.PIPELINE_DATABASE_URL?.trim()) throw Error("Configure PIPELINE_DATABASE_URL.");
const sql = postgres(process.env.PIPELINE_DATABASE_URL, { ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : "require", max: 1, prepare: false, onnotice() {} });
try {
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('pipeline_launch_draft_dates',0))`;
    if (mode === "rollback") return rollback(tx);
    const rows = await tx`
      select a.assessment_id,a.version,a.assessment_date,a.data->'assessment_date' as before_data_date,a.section_versions
      from pipeline.assessments a join pipeline.referrals r on r.referral_id=a.referral_id
      where a.referral_id in ${tx(cohort)} and a.created_at < '2026-09-12T01:00:00Z'::timestamptz
        and r.deleted_at is null and a.status='draft' and a.signed_at is null
        and a.completed_at is null and a.scheduled_start_at is null
        and a.assessment_date=(a.created_at at time zone 'UTC')::date
        and not exists (select 1 from pipeline.assessment_field_provenance p where p.assessment_id=a.assessment_id
          and p.field_key='assessment_date' and (p.source_field_key<>'system.assessment_date' or p.review_status='edited'))
        and not exists (select 1 from pipeline.audit_events e where e.entity_type='assessment' and e.entity_id=a.assessment_id
          and e.action='assessment_updated' and e.changed_fields @> array['assessment_date']::text[])
      for update of a
    `;
    if (mode === "plan") return { eligible: rows.length };
    for (const row of rows) {
      const changed = await tx`update pipeline.assessments set assessment_date=null,
        data=jsonb_set(data,'{assessment_date}','null'::jsonb),version=version+1,
        section_versions=jsonb_set(section_versions,'{identity}',to_jsonb(coalesce((section_versions->>'identity')::int,1)+1)),
        updated_at=now(),updated_by=${actor},updated_by_name='Launch data correction'
        where assessment_id=${row.assessment_id} and version=${row.version} returning version`;
      if (changed.length!==1) throw Error("Concurrent change; correction rolled back.");
      await tx`insert into pipeline.audit_events(entity_type,entity_id,action,actor_id,actor_name,from_version,to_version,changed_fields,metadata)
        values('assessment',${row.assessment_id},'assessment_updated',${actor},'Launch data correction',${row.version},${changed[0].version},array['assessment_date'],
          ${tx.json({ correction: marker, before_date: row.assessment_date, before_data_date: row.before_data_date, before_sections: row.section_versions })})`;
    }
    if (rows.length) await bump(tx);
    return { corrected: rows.length };
  });
  console.log(JSON.stringify({ ok:true,mode,...result,assessment_answers_deleted:0,documents_deleted:0,owners_changed:0 }));
} catch (error) {
  console.error(JSON.stringify({ok:false,mode,code:error.code??"launch_date_correction_failed"}));
  process.exitCode=1;
} finally { await sql.end(); }

async function rollback(tx) {
  const events=await tx`select distinct on(entity_id) entity_id,to_version,metadata from pipeline.audit_events
    where actor_id=${actor} and metadata->>'correction'=${marker} order by entity_id,created_at desc,audit_event_id desc`;
  for (const event of events) {
    const before=event.metadata;
    const changed=await tx`update pipeline.assessments set assessment_date=${before.before_date}::date,
      data=jsonb_set(data,'{assessment_date}',${tx.json(before.before_data_date ?? null)}),version=version+1,
      section_versions=jsonb_set(section_versions,'{identity}',to_jsonb(coalesce((section_versions->>'identity')::int,1)+1)),
      updated_at=now(),updated_by='system:launch-draft-date-rollback',updated_by_name='Launch data rollback'
      where assessment_id=${event.entity_id} and version=${event.to_version} and updated_by=${actor} returning version`;
    if(changed.length!==1) throw Error("Record changed after correction; automatic rollback refused.");
    await tx`insert into pipeline.audit_events(entity_type,entity_id,action,actor_id,actor_name,from_version,to_version,changed_fields)
      values('assessment',${event.entity_id},'assessment_updated','system:launch-draft-date-rollback','Launch data rollback',${event.to_version},${changed[0].version},array['assessment_date'])`;
  }
  if(events.length) await bump(tx);
  return {restored:events.length};
}
async function bump(tx) {
  await tx`update pipeline.store_revisions set revision=revision+1,updated_at=now()
    where store_name in ('assessments','referrals','client_workspaces')`;
}
