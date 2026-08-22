#!/usr/bin/env node

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
const apply = process.argv.includes("--apply");
const provisionalId = readArgument("--provisional-id")?.trim();
const targetPrincipalId = readArgument("--entra-principal-id")?.trim();
const targetDisplayName = readArgument("--display-name")?.trim();
const targetEmail = readArgument("--email")?.trim();

if (!safePrincipal(provisionalId) || !provisionalId.startsWith("provisional:")) fail("Provide a valid --provisional-id.");
if (!safePrincipal(targetPrincipalId) || targetPrincipalId.startsWith("provisional:")) fail("Provide the immutable Entra object ID with --entra-principal-id.");
if (!boundedText(targetDisplayName, 200)) fail("Provide --display-name.");
if (!validEmail(targetEmail)) fail("Provide --email.");
if (!databaseUrl && apply) fail("Configure PIPELINE_DATABASE_URL before linking a workspace member.");

if (!apply) {
  print({
    ok: true,
    mode: "plan",
    configuration_present: { PIPELINE_DATABASE_URL: Boolean(databaseUrl) },
    note: "The provisional identity will be merged into the Entra principal. No database changes were made.",
  });
  process.exit(0);
}

const sql = postgres(databaseUrl, databaseOptions());
try {
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('pipeline_workspace_member_link', 0))`;
    const provisionalRows = await tx`
      select display_name, roles
      from pipeline.workspace_members
      where principal_id = ${provisionalId} and active and identity_status = 'provisional'
      for update
    `;
    if (provisionalRows.length !== 1) throw new Error("provisional_not_found");
    const roles = Array.isArray(provisionalRows[0].roles) ? provisionalRows[0].roles : [];

    const targetRows = await tx`
      insert into pipeline.workspace_members (
        principal_id, display_name, email, roles, active, last_seen_at,
        identity_status, source_system, source_identity, merged_into_principal_id,
        created_at, updated_at
      ) values (
        ${targetPrincipalId}, ${targetDisplayName}, ${targetEmail}, ${roles}, true, now(),
        'entra_linked', null, null, null, now(), now()
      )
      on conflict (principal_id) do update set
        display_name = excluded.display_name,
        email = excluded.email,
        roles = array(
          select distinct role
          from unnest(pipeline.workspace_members.roles || excluded.roles) as role
          order by role
        ),
        active = true,
        last_seen_at = greatest(pipeline.workspace_members.last_seen_at, excluded.last_seen_at),
        updated_at = now()
      where pipeline.workspace_members.identity_status = 'entra_linked'
      returning principal_id
    `;
    if (targetRows.length !== 1) throw new Error("target_identity_conflict");

    const referrals = await tx`
      update pipeline.referrals
      set owner_id = ${targetPrincipalId}, owner_name = ${targetDisplayName}
      where owner_id = ${provisionalId}
      returning referral_id
    `;
    const workItems = await tx`
      update pipeline.work_items
      set owner_id = ${targetPrincipalId}, owner_name = ${targetDisplayName}
      where owner_id = ${provisionalId}
      returning work_item_id
    `;
    const assessments = await tx`
      update pipeline.assessments
      set assessor_id = ${targetPrincipalId}, assessor_name = ${targetDisplayName},
          data = jsonb_set(data, '{assessor}', to_jsonb(${targetDisplayName}::text), true)
      where assessor_id = ${provisionalId}
      returning assessment_id
    `;

    await tx`
      update pipeline.workspace_members
      set identity_status = 'merged', active = false,
          merged_into_principal_id = ${targetPrincipalId}, updated_at = now()
      where principal_id = ${provisionalId}
    `;
    await tx`
      insert into pipeline.audit_events (
        entity_type, entity_id, action, actor_id, actor_name,
        changed_fields, before_values, after_values, metadata
      ) values (
        'workspace_member', ${provisionalId}, 'workspace_member_identity_linked',
        'system:identity-link', 'Pipeline identity linker',
        array['principal_id'],
        ${tx.json({ identity_status: "provisional" })},
        ${tx.json({ identity_status: "entra_linked" })},
        ${tx.json({ target_principal_id: targetPrincipalId })}
      )
    `;
    return { referrals: referrals.length, work_items: workItems.length, assessments: assessments.length };
  });

  print({
    ok: true,
    mode: "apply",
    reassigned_referrals: result.referrals,
    reassigned_work_items: result.work_items,
    reassigned_assessments: result.assessments,
    configuration_present: { PIPELINE_DATABASE_URL: true },
    note: "The provisional member is inactive and all active ownership now uses the Entra principal.",
  });
} catch (error) {
  fail(error instanceof Error && error.message === "provisional_not_found"
    ? "The active provisional workspace member was not found."
    : error instanceof Error && error.message === "target_identity_conflict"
      ? "The Entra principal ID conflicts with a non-linked workspace member."
    : "Workspace member linking failed. No identity values or database details were logged.");
} finally {
  await sql.end({ timeout: 5 });
}

function readArgument(name) {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function safePrincipal(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[a-zA-Z0-9_.:@-]+$/.test(value);
}

function boundedText(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function validEmail(value) {
  return typeof value === "string" && value.length >= 3 && value.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(value);
}

function databaseOptions() {
  return {
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
  };
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}
