#!/usr/bin/env node

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
if (!databaseUrl) fail("Configure PIPELINE_DATABASE_URL before planning a pilot reset.");
const execute = process.argv.includes("--execute");
const confirmed = process.argv.includes("--confirm=RESET_PIPELINE_PILOT");
if (execute && (process.env.PIPELINE_PILOT_RESET_ENABLED !== "true" || !confirmed)) {
  fail("Execution requires PIPELINE_PILOT_RESET_ENABLED=true and --confirm=RESET_PIPELINE_PILOT.");
}
const sql = postgres(databaseUrl, {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
});

try {
  const plan = await loadPlan(sql);
  if (plan.confirmed_links > 0) fail("Reset refused because a resettable referral has a confirmed clinical resident link.");
  if (!execute) {
    console.log(JSON.stringify({ ok: true, mode: "dry_run", plan, required_tag: "pilot-resettable" }, null, 2));
  } else {
    const deleted = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('pipeline_pilot_reset', 0))`;
      const current = await loadPlan(tx);
      if (current.confirmed_links > 0) throw new Error("confirmed_link_present");
      await tx`
        insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name, metadata)
        values ('system', 'pilot-reset', 'pilot_reset', 'pilot-reset-tool', 'Pilot reset tool', ${tx.json({
          referral_count: current.referrals,
          document_count: current.documents,
          assessment_count: current.assessments,
        })})
      `;
      const referrals = await tx`
        delete from pipeline.referrals
        where 'pilot-resettable' = any(tags) and source = 'Pilot synthetic seed'
        returning referral_id
      `;
      const people = await tx`
        delete from pipeline.people p
        where p.external_client_id like 'pilot-synthetic-%'
          and not exists (select 1 from pipeline.referrals r where r.person_id = p.person_id)
          and not exists (select 1 from pipeline.resident_links l where l.person_id = p.person_id)
        returning person_id
      `;
      return { referrals: referrals.length, orphan_people: people.length };
    });
    console.log(JSON.stringify({ ok: true, mode: "execute", deleted }, null, 2));
  }
} catch {
  fail("Pilot reset failed without reporting record data. Review database permissions and reset eligibility.");
} finally {
  await sql.end({ timeout: 5 });
}

async function loadPlan(client) {
  const rows = await client`
    with targets as (
      select referral_id from pipeline.referrals
      where 'pilot-resettable' = any(tags) and source = 'Pilot synthetic seed'
    )
    select
      (select count(*) from targets) as referrals,
      (select count(*) from pipeline.documents d join targets t on t.referral_id = d.referral_id) as documents,
      (select count(*) from pipeline.assessments a join targets t on t.referral_id = a.referral_id) as assessments,
      (select count(*) from pipeline.resident_links l join targets t on t.referral_id = l.referral_id where l.status = 'confirmed') as confirmed_links
  `;
  return Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}
