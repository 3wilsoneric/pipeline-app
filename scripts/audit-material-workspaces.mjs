#!/usr/bin/env node

import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const outputPath = path.resolve(
  outputArgument?.slice("--output=".length)
    || process.env.PIPELINE_AUDIT_OUTPUT_PATH?.trim()
    || "/tmp/private-material-workspace-audit.json",
);
const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();

if (!databaseUrl) fail("PIPELINE_DATABASE_URL is required.");

const sql = postgres(databaseUrl, {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : "require",
  max: 1,
  prepare: false,
  connection: { application_name: "pipeline-material-workspace-audit" },
  onnotice: () => undefined,
});

try {
  const clients = await sql`
    with material_clients as (
      select
        p.person_id,
        p.external_client_id,
        p.display_name,
        count(distinct d.document_id)::integer as document_count,
        array_remove(array_agg(distinct d.source_canvas_id), null) as source_canvas_ids,
        array_remove(array_agg(distinct d.source_system), null) as source_systems,
        (array_agg(d.client_community order by d.uploaded_at desc, d.document_id desc)
          filter (where nullif(trim(d.client_community), '') is not null))[1]::text as document_community,
        max(d.uploaded_at) as latest_document_at
      from pipeline.people p
      join pipeline.documents d
        on d.person_id = p.person_id
       and d.deleted_at is null
       and d.identity_status = 'linked'
      group by p.person_id, p.external_client_id, p.display_name
    ), referral_summary as (
      select
        r.person_id,
        count(*)::integer as referral_count,
        (array_agg(r.referral_id order by r.updated_at desc, r.referral_id desc))[1] as latest_referral_id,
        (array_agg(r.owner_id order by r.updated_at desc, r.referral_id desc))[1]::text as latest_owner_id,
        (array_agg(r.owner_name order by r.updated_at desc, r.referral_id desc))[1]::text as latest_owner_name,
        (array_agg(r.community order by r.updated_at desc, r.referral_id desc))[1]::text as latest_community
      from pipeline.referrals r
      group by r.person_id
    )
    select
      materials.person_id,
      materials.external_client_id,
      materials.display_name,
      materials.document_count,
      materials.source_canvas_ids,
      materials.source_systems,
      materials.document_community,
      materials.latest_document_at,
      coalesce(referrals.referral_count, 0)::integer as referral_count,
      referrals.latest_referral_id,
      referrals.latest_owner_id,
      referrals.latest_owner_name,
      referrals.latest_community
    from material_clients materials
    left join referral_summary referrals using (person_id)
    order by lower(materials.display_name), materials.person_id
  `;

  const imports = await sql`
    select
      count(*)::integer as total_items,
      count(*) filter (where imported_document_id is not null)::integer as imported_items,
      count(*) filter (where imported_document_id is null)::integer as pending_items,
      count(distinct nullif(trim(source_client_name), ''))::integer as distinct_source_clients
    from pipeline.client_file_import_items
  `;

  const historical = await sql`
    select
      count(distinct r.referral_id)::integer as workspace_count,
      count(distinct r.referral_id) filter (where r.owner_id is not null)::integer as owner_assigned_workspace_count,
      count(distinct r.referral_id) filter (where r.owner_id is null)::integer as owner_unresolved_workspace_count,
      count(distinct d.document_id)::integer as document_count,
      count(distinct d.document_id) filter (where d.malware_scan_status = 'clean')::integer as clean_document_count,
      count(distinct d.document_id) filter (where d.source_external_id is not null)::integer as sourced_document_count
    from pipeline.referrals r
    left join pipeline.documents d on d.referral_id = r.referral_id and d.deleted_at is null
    where r.workspace_origin = 'allo' and r.workspace_status = 'historical'
  `;
  const historicalStages = await sql`
    select stage, count(*)::integer as workspace_count
    from pipeline.referrals
    where workspace_origin = 'allo' and workspace_status = 'historical'
    group by stage
    order by stage
  `;
  const latestBatch = await sql`
    select status, workspace_count, material_count, imported_workspace_count, imported_document_count
    from pipeline.workspace_import_batches
    where source_system = 'allo'
    order by updated_at desc
    limit 1
  `;

  const payload = {
    generated_at: new Date().toISOString(),
    material_client_count: clients.length,
    material_client_without_workspace_count: clients.filter((client) => Number(client.referral_count) === 0).length,
    material_client_with_workspace_count: clients.filter((client) => Number(client.referral_count) > 0).length,
    document_count: clients.reduce((sum, client) => sum + Number(client.document_count), 0),
    imports: imports[0] ?? { total_items: 0, imported_items: 0, pending_items: 0, distinct_source_clients: 0 },
    historical: historical[0] ?? {},
    historical_stages: historicalStages,
    latest_workspace_import_batch: latestBatch[0] ?? null,
    clients,
  };

  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(outputPath, 0o600);

  console.log(JSON.stringify({
    ok: true,
    material_client_count: payload.material_client_count,
    material_client_without_workspace_count: payload.material_client_without_workspace_count,
    material_client_with_workspace_count: payload.material_client_with_workspace_count,
    document_count: payload.document_count,
    pending_import_items: Number(payload.imports.pending_items ?? 0),
    historical: payload.historical,
    historical_stages: payload.historical_stages,
    latest_workspace_import_batch: payload.latest_workspace_import_batch,
    output_written: true,
  }));
} finally {
  await sql.end({ timeout: 5 });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
