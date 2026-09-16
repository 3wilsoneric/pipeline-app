#!/usr/bin/env node

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
const apply = process.argv.includes("--apply");
const provisionalId = readArgument("--provisional-id")?.trim();
const targetPrincipalId = readArgument("--entra-principal-id")?.trim().toLowerCase();
const targetDisplayName = readArgument("--display-name")?.trim();
const targetEmail = readArgument("--email")?.trim();

if (!safePrincipal(provisionalId) || !provisionalId.startsWith("provisional:")) fail("Provide a valid --provisional-id.");
if (!entraObjectId(targetPrincipalId)) fail("Provide the immutable Entra object ID with --entra-principal-id.");
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
    const source = await prepareLinkSource(tx);
    if (source.identity_status === 'merged') {
      return { referrals: 0, work_items: 0, assessments: 0, saved_state: 0, idempotent_replay: true };
    }
    const roles = provisionalRoles(source);

    const targetRows = await tx`
      insert into pipeline.workspace_members (
        principal_id, display_name, email, roles, active, last_seen_at,
        identity_status, source_system, source_identity, merged_into_principal_id,
        created_at, updated_at
      ) values (
        ${targetPrincipalId}, ${targetDisplayName}, ${targetEmail}, ${roles}, true, null,
        'entra_linked', null, null, null, now(), now()
      )
      on conflict (principal_id) do update set
        display_name = excluded.display_name,
        email = excluded.email,
        updated_at = now()
      where pipeline.workspace_members.identity_status = 'entra_linked' and pipeline.workspace_members.active
      returning principal_id
    `;
    if (targetRows.length !== 1) throw new Error("target_identity_conflict");

    const referrals = await tx`
      with changed as (
        update pipeline.referrals
        set owner_id = ${targetPrincipalId}, version = version + 1,
          assignment_version = assignment_version + 1, updated_at = now(),
          section_versions = jsonb_set(section_versions, '{intake}',
            to_jsonb(coalesce((section_versions ->> 'intake')::integer, 1) + 1), true),
          data = (case when data ->> 'ownerId' = ${provisionalId} then
            jsonb_set(data, '{ownerId}', to_jsonb(${targetPrincipalId}::text), false) else data end)
            || (case when jsonb_typeof(data -> 'owners') = 'array' then jsonb_build_object('owners', (
              select coalesce(jsonb_agg(case when member ->> 'id' = ${provisionalId} then
                jsonb_set(member, '{id}', to_jsonb(${targetPrincipalId}::text), false) else member end order by position), '[]'::jsonb)
              from jsonb_array_elements(data -> 'owners') with ordinality as owners(member, position)
            )) else '{}'::jsonb end)
        where owner_id = ${provisionalId}
        returning referral_id, version
      )
      insert into pipeline.audit_events (
        entity_type, entity_id, action, actor_id, actor_name,
        from_version, to_version, changed_fields, before_values, after_values
      )
      select 'referral', referral_id::text, 'workspace_member_identity_linked',
        'system:identity-link', 'Pipeline identity linker', version - 1, version,
        array['owner_id', 'owners', 'assignment_version'], jsonb_build_object('owner_id', ${provisionalId}::text),
        jsonb_build_object('owner_id', ${targetPrincipalId}::text)
      from changed returning entity_id
    `;
    const workItems = await tx`
      with changed as (
        update pipeline.work_items
        set owner_id = ${targetPrincipalId}, version = version + 1, updated_at = now()
        where owner_id = ${provisionalId}
        returning work_item_id, version
      )
      insert into pipeline.audit_events (
        entity_type, entity_id, action, actor_id, actor_name,
        from_version, to_version, changed_fields, before_values, after_values
      )
      select 'work_item', work_item_id::text, 'workspace_member_identity_linked',
        'system:identity-link', 'Pipeline identity linker', version - 1, version,
        array['owner_id'], jsonb_build_object('owner_id', ${provisionalId}::text),
        jsonb_build_object('owner_id', ${targetPrincipalId}::text)
      from changed returning entity_id
    `;
    const assessments = await tx`
      with changed as (
        update pipeline.assessments a
        set assessor_id = ${targetPrincipalId}, version = a.version + 1, updated_at = now(),
          section_versions = jsonb_set(a.section_versions, '{identity}',
            to_jsonb(coalesce((a.section_versions ->> 'identity')::integer, 1) + 1), true)
        from pipeline.referrals r
        where a.referral_id = r.referral_id and a.assessor_id = ${provisionalId}
          and a.status <> 'complete' and a.signed_at is null
          and r.workspace_status = 'active' and r.deleted_at is null and r.closed_at is null
        returning a.assessment_id, a.version
      )
      insert into pipeline.audit_events (
        entity_type, entity_id, action, actor_id, actor_name,
        from_version, to_version, changed_fields, before_values, after_values
      )
      select 'assessment', assessment_id, 'workspace_member_identity_linked',
        'system:identity-link', 'Pipeline identity linker', version - 1, version,
        array['assessor_id'], jsonb_build_object('assessor_id', ${provisionalId}::text),
        jsonb_build_object('assessor_id', ${targetPrincipalId}::text)
      from changed returning entity_id
    `;

    await advanceStoreRevisions(tx, referrals.length, workItems.length, assessments.length);

    const savedState = await tx`
      insert into pipeline.user_workspace_state (
        principal_id, state_kind, state_key, payload, version, expires_at, created_at, updated_at
      )
      select ${targetPrincipalId}, state_kind, state_key, payload, version, expires_at, created_at, updated_at
      from pipeline.user_workspace_state
      where principal_id = ${provisionalId} and expires_at > now()
      on conflict (principal_id, state_kind, state_key) do nothing
      returning state_kind, state_key
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
        array['identity_status', 'active', 'merged_into_principal_id'],
        ${tx.json({ identity_status: "provisional", active: true })},
        ${tx.json({ identity_status: "merged", active: false, merged_into_principal_id: targetPrincipalId })},
        ${tx.json({ target_principal_id: targetPrincipalId, referrals: referrals.length,
          work_items: workItems.length, assessments: assessments.length,
          copied_saved_state: savedState.length, source_saved_state_preserved: true,
          signed_and_historical_assessments_preserved: true })}
      )
    `;
    return { referrals: referrals.length, work_items: workItems.length, assessments: assessments.length, saved_state: savedState.length, idempotent_replay: false };
  });

  print({
    ok: true,
    mode: "apply",
    reassigned_referrals: result.referrals,
    reassigned_work_items: result.work_items,
    reassigned_assessments: result.assessments,
    copied_saved_state: result.saved_state,
    idempotent_replay: result.idempotent_replay,
    configuration_present: { PIPELINE_DATABASE_URL: true },
    note: "The provisional member is inactive. Ownership IDs are linked; signed and historical assessments, names, clinical data and existing target roles are unchanged. Nonconflicting unexpired saved state is copied without replacing target or source state.",
  });
} catch (error) {
  const message = error instanceof Error && error.message === "provisional_not_found"
    ? "The active provisional workspace member was not found."
    : error instanceof Error && error.message === "target_identity_conflict"
      ? "The Entra principal conflicts with an inactive, non-linked, or differently merged workspace member."
    : "Workspace member linking failed. No identity values or database details were logged.";
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_DATABASE_URL: true } }, null, 2));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

function readArgument(name) {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function prepareLinkSource(tx) {
  const sources = await tx`select roles, active, identity_status, merged_into_principal_id
    from pipeline.workspace_members where principal_id = ${provisionalId} for update`;
  if (sources.length !== 1) throw new Error("provisional_not_found");
  const targets = await tx`select active, identity_status from pipeline.workspace_members
    where principal_id = ${targetPrincipalId} for update`;
  const source = sources[0];
  const target = targets[0];
  validateLinkTarget(target);
  if (source.identity_status === 'merged') {
    if (source.merged_into_principal_id !== targetPrincipalId || !target) throw new Error("target_identity_conflict");
    return source;
  }
  if (!source.active || source.identity_status !== 'provisional') throw new Error("provisional_not_found");
  return source;
}

function validateLinkTarget(target) {
  if (target && (!target.active || target.identity_status !== 'entra_linked')) throw new Error("target_identity_conflict");
}

function provisionalRoles(source) {
  return Array.isArray(source.roles) ? source.roles.filter((role) => ['reviewer', 'viewer'].includes(role)) : [];
}

async function advanceStoreRevisions(tx, referrals, workItems, assessments) {
  const stores = new Set();
  if (referrals || workItems) stores.add('referrals');
  if (referrals) stores.add('client_workspaces');
  if (workItems) stores.add('workflow');
  if (assessments) stores.add('assessments');
  if (stores.size) await tx`update pipeline.store_revisions set revision = revision + 1, updated_at = now()
    where store_name in ${tx([...stores])}`;
}

function safePrincipal(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[a-zA-Z0-9_.:@-]+$/.test(value);
}

function entraObjectId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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
